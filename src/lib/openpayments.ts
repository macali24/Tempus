/**
 * CMS Open Payments: industry payments to physicians.
 *
 * This is the source that changes what a rep should SAY, not just who they call.
 * A physician already receiving payments from a comprehensive-genomic-profiling
 * competitor has been educated on CGP and needs a differentiation conversation;
 * one with no such history needs a clinical-utility conversation.
 *
 * Join note: `covered_recipient_npi` gives an exact NPI join, no fuzzy matching.
 *
 * Performance note: `like` conditions on this dataset scan tens of millions of
 * rows and time out. Always filter by NPI equality or a bounded NPI `IN` batch
 * (indexed, fast), and match manufacturer names client-side.
 */
import { chunksOf, fetchWithRetry, mapSettledWithConcurrency, type BulkLookup } from './fetching';

const DATASET_2024 = 'e6b17c6a-2534-4207-a4a1-6746a14911ff';
const BASE = `https://openpaymentsdata.cms.gov/api/1/datastore/query/${DATASET_2024}/0`;
export const OPEN_PAYMENTS_SOURCE = 'https://openpaymentsdata.cms.gov/';
const PAGE_SIZE = 500;
const BATCH_SIZE = 10;
const BATCH_CONCURRENCY = 2;

/** Comprehensive genomic profiling companies competing for the same order. */
const COMPETITORS = ['foundation medicine', 'guardant', 'natera', 'exact sciences', 'caris', 'neogenomics', 'myriad genetics', 'invitae'];

export type PaymentRecord = {
  manufacturer: string;
  amount: number;
  date?: string;
  nature?: string;
  product?: string;
};

export type PaymentSummary = {
  npi: string;
  records: number;
  totalUsd: number;
  manufacturers: string[];
  /** Competitor manufacturers detected, lowercased match on known CGP vendors. */
  competitors: string[];
  latestDate?: string;
  specialty?: string;
  top: PaymentRecord[];
  sourceUrl: string;
  year: number;
};

type Row = Record<string, string | undefined>;

const PROPERTIES = [
  'covered_recipient_npi',
  'applicable_manufacturer_or_applicable_gpo_making_payment_name',
  'total_amount_of_payment_usdollars',
  'date_of_payment',
  'nature_of_payment_or_transfer_of_value',
  'name_of_drug_or_biological_or_device_or_medical_supply_1',
  'covered_recipient_specialty_1',
];

async function fetchPaymentRows(npis: string[], signal?: AbortSignal): Promise<Row[]> {
  const query = new URLSearchParams({
    'conditions[0][property]': 'covered_recipient_npi',
    'conditions[0][operator]': 'IN',
    limit: String(PAGE_SIZE),
  });
  npis.forEach(npi => query.append('conditions[0][value][]', npi));
  PROPERTIES.forEach(property => query.append('properties[]', property));

  const rows: Row[] = [];
  let offset = 0;
  let total: number | undefined;

  do {
    query.set('offset', String(offset));
    const response = await fetchWithRetry(`${BASE}?${query}`, {}, { signal, timeoutMs: 12_000 });
    if (!response.ok) throw new Error(`CMS Open Payments returned ${response.status}`);
    const payload = await response.json();
    const page: Row[] = payload.results ?? [];
    const advertised = Number(payload.count);
    if (Number.isFinite(advertised)) total = advertised;

    if (!page.length && total !== undefined && offset < total) {
      throw new Error(`CMS Open Payments stopped at ${offset} of ${total} records.`);
    }

    rows.push(...page);
    offset += page.length;
    if (total === undefined && page.length < PAGE_SIZE) break;
  } while (total === undefined ? true : offset < total);

  return rows;
}

function summarizePayments(npi: string, rows: Row[]): PaymentSummary {
  const matching = rows.filter(row => row.covered_recipient_npi === npi);
  if (!matching.length) {
    return { npi, records: 0, totalUsd: 0, manufacturers: [], competitors: [], top: [], sourceUrl: OPEN_PAYMENTS_SOURCE, year: 2024 };
  }

  const records: PaymentRecord[] = matching.map(row => ({
    manufacturer: row.applicable_manufacturer_or_applicable_gpo_making_payment_name ?? 'Unknown',
    amount: Number(row.total_amount_of_payment_usdollars) || 0,
    date: row.date_of_payment,
    nature: row.nature_of_payment_or_transfer_of_value,
    product: row.name_of_drug_or_biological_or_device_or_medical_supply_1 || undefined,
  }));

  const manufacturers = [...new Set(records.map(record => record.manufacturer))];
  const competitors = manufacturers.filter(manufacturer => COMPETITORS.some(candidate => manufacturer.toLowerCase().includes(candidate)));
  const dates = records.map(record => record.date).filter((date): date is string => Boolean(date)).sort();

  return {
    npi,
    records: records.length,
    totalUsd: Math.round(records.reduce((sum, record) => sum + record.amount, 0) * 100) / 100,
    manufacturers,
    competitors,
    latestDate: dates[dates.length - 1],
    specialty: matching[0].covered_recipient_specialty_1,
    top: [...records].sort((a, b) => b.amount - a.amount).slice(0, 5),
    sourceUrl: OPEN_PAYMENTS_SOURCE,
    year: 2024,
  };
}

export async function fetchPayments(npi: string, signal?: AbortSignal): Promise<PaymentSummary | undefined> {
  const rows = await fetchPaymentRows([npi], signal);
  return summarizePayments(npi, rows);
}

/**
 * Best-effort all-provider enrichment. Batching keeps 60 physicians from
 * becoming 60 simultaneous requests, and each batch is complete only after
 * every page advertised by DKAN has arrived.
 */
export async function fetchPaymentsForAll(npis: string[], signal?: AbortSignal): Promise<BulkLookup<PaymentSummary>> {
  const unique = [...new Set(npis.filter(Boolean))];
  const batches = chunksOf(unique, BATCH_SIZE);
  const settled = await mapSettledWithConcurrency(
    batches,
    BATCH_CONCURRENCY,
    async batch => ({ batch, rows: await fetchPaymentRows(batch, signal) }),
    signal,
  );

  const out: Record<string, PaymentSummary> = {};
  const status: BulkLookup<PaymentSummary>['status'] = {};
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      batches[index].forEach(npi => { status[npi] = 'error'; });
      return;
    }
    result.value.batch.forEach(npi => {
      const summary = summarizePayments(npi, result.value.rows);
      out[npi] = summary;
      status[npi] = summary.records > 0 ? 'found' : 'empty';
    });
  });
  return { records: out, status };
}

/*
 * Keeping the aggregation above in one place is important: a successful empty
 * query becomes an explicit zero-record summary, while a failed or partial
 * batch remains absent and is rendered as unavailable rather than zero.
 */
