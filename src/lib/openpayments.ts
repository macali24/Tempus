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
 * rows and time out. Always filter by NPI equality (indexed, fast) and match
 * manufacturer names client-side.
 */
const DATASET_2024 = 'e6b17c6a-2534-4207-a4a1-6746a14911ff';
const BASE = `https://openpaymentsdata.cms.gov/api/1/datastore/query/${DATASET_2024}/0`;
export const OPEN_PAYMENTS_SOURCE = 'https://openpaymentsdata.cms.gov/';

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

export async function fetchPayments(npi: string, signal?: AbortSignal): Promise<PaymentSummary | undefined> {
  const query = new URLSearchParams({
    'conditions[0][property]': 'covered_recipient_npi',
    'conditions[0][value]': npi,
    'conditions[0][operator]': '=',
    limit: '100',
  });
  const response = await fetch(`${BASE}?${query}`, { signal });
  if (!response.ok) return undefined;
  const payload = await response.json();
  const rows: Row[] = payload.results ?? [];
  if (!rows.length) {
    return { npi, records: 0, totalUsd: 0, manufacturers: [], competitors: [], top: [], sourceUrl: OPEN_PAYMENTS_SOURCE, year: 2024 };
  }

  const records: PaymentRecord[] = rows.map(row => ({
    manufacturer: row.applicable_manufacturer_or_applicable_gpo_making_payment_name ?? 'Unknown',
    amount: Number(row.total_amount_of_payment_usdollars) || 0,
    date: row.date_of_payment,
    nature: row.nature_of_payment_or_transfer_of_value,
    product: row.name_of_drug_or_biological_or_device_or_medical_supply_1 || undefined,
  }));

  const manufacturers = [...new Set(records.map(r => r.manufacturer))];
  const competitors = manufacturers.filter(m => COMPETITORS.some(c => m.toLowerCase().includes(c)));
  const dates = records.map(r => r.date).filter((d): d is string => Boolean(d)).sort();

  return {
    npi,
    records: records.length,
    totalUsd: Math.round(records.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
    manufacturers,
    competitors,
    latestDate: dates[dates.length - 1],
    specialty: rows[0].covered_recipient_specialty_1,
    top: [...records].sort((a, b) => b.amount - a.amount).slice(0, 5),
    sourceUrl: OPEN_PAYMENTS_SOURCE,
    year: 2024,
  };
}

/** Best-effort enrichment: never let a slow or failing payments lookup block the page. */
export async function fetchPaymentsForAll(npis: string[]): Promise<Record<string, PaymentSummary>> {
  const settled = await Promise.allSettled(npis.map(npi => fetchPayments(npi)));
  const out: Record<string, PaymentSummary> = {};
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) out[npis[index]] = result.value;
  });
  return out;
}
