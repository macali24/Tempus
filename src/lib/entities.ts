/**
 * Entity resolution across six public sources.
 *
 * A physician is not one record. They appear in NPPES, CMS utilization, CMS Open
 * Payments, ClinicalTrials.gov, PubMed and Wikidata under different keys. Three
 * of those join on NPI; the rest only offer a name plus an affiliation string,
 * so they require probabilistic linkage.
 *
 * Every link records HOW it was made and how much to trust it. Downstream
 * consensus and generation both read that confidence rather than assuming a
 * match is a match.
 */
import type { CmsUtilization, Provider, Study } from '../types';
import type { PaymentSummary } from './openpayments';
import { marketRecord, MARKET_SOURCE_URL } from './market';

export type SourceId = 'nppes' | 'cms-utilization' | 'open-payments' | 'clinicaltrials' | 'pubmed' | 'wikidata' | 'market-csv';
export type MatchMethod = 'npi-exact' | 'name-affiliation' | 'name-facility' | 'unmatched';
export type AssertionField = 'practiceCity' | 'institution' | 'specialty' | 'activeStatus';

export type SourceLink = {
  source: SourceId;
  matched: boolean;
  method: MatchMethod;
  /** 0–1. Exact NPI joins are 1.0; probabilistic links carry their similarity. */
  confidence: number;
  detail: string;
  url?: string;
};

export type Assertion = {
  field: AssertionField;
  value: string;
  source: SourceId;
  confidence: number;
  observedAt?: string;
  url?: string;
};

export type ResolvedEntity = {
  npi: string;
  displayName: string;
  links: SourceLink[];
  assertions: Assertion[];
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  nppes: 'NPPES NPI Registry',
  'cms-utilization': 'CMS Medicare Utilization',
  'open-payments': 'CMS Open Payments',
  clinicaltrials: 'ClinicalTrials.gov',
  pubmed: 'PubMed',
  wikidata: 'Wikidata',
  'market-csv': 'Market intelligence CSV',
};

/* ---------------------------------------------------------------- matching */

/** Jaro-Winkler similarity, the standard metric for personal-name linkage. */
export function jaroWinkler(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const window = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array<boolean>(s1.length).fill(false);
  const m2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = m2[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < s1.length && prefix < s2.length && s1[prefix] === s2[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export const normalizeCity = (value?: string) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Institution strings differ wildly across sources; strip the noise before comparing. */
export function normalizeInstitution(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(department|dept|division|of|the|inc|llc|university|univ|medical center|medicine|hospital|health system|health|center|centre)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Confidence that two institution strings denote the same place. */
export function institutionSimilarity(a: string, b: string): number {
  const na = normalizeInstitution(a);
  const nb = normalizeInstitution(b);
  if (!na || !nb) return 0;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const shared = [...ta].filter(t => tb.has(t)).length;
  const jaccard = shared / (ta.size + tb.size - shared);
  return Math.max(jaccard, jaroWinkler(na, nb) * 0.8);
}

export const providerName = (p: Provider) =>
  `${p.basic.first_name ?? ''} ${p.basic.last_name ?? ''}`.trim().replace(/\s+/g, ' ');

const NPI_URL = (npi: string) => `https://npiregistry.cms.hhs.gov/provider-view/${npi}`;

/* -------------------------------------------------------------- resolution */

export type ResolutionInput = {
  provider: Provider;
  utilization?: CmsUtilization;
  payments?: PaymentSummary;
  trials: Study[];
  publications: Array<{ pmid: string; title: string; affiliation?: string; date?: string; sourceUrl: string }>;
  wikidataMatched?: boolean;
  wikidataUrl?: string;
};

/** Minimum name similarity before a probabilistic link is accepted at all. */
export const NAME_MATCH_FLOOR = 0.88;

export function resolveEntity(input: ResolutionInput): ResolvedEntity {
  const { provider, utilization, payments, trials, publications } = input;
  const npi = provider.number;
  const location = provider.addresses.find(a => a.address_purpose === 'LOCATION') ?? provider.addresses[0];
  const links: SourceLink[] = [];
  const assertions: Assertion[] = [];

  // 1. NPPES: the anchor record.
  links.push({ source: 'nppes', matched: true, method: 'npi-exact', confidence: 1, detail: `NPI ${npi}`, url: NPI_URL(npi) });
  if (location?.city) {
    assertions.push({ field: 'practiceCity', value: location.city, source: 'nppes', confidence: 1, observedAt: provider.basic.last_updated, url: NPI_URL(npi) });
  }
  const primaryTaxonomy = provider.taxonomies.find(t => t.primary)?.desc;
  if (primaryTaxonomy) {
    assertions.push({ field: 'specialty', value: primaryTaxonomy, source: 'nppes', confidence: 1, observedAt: provider.basic.last_updated, url: NPI_URL(npi) });
  }
  assertions.push({ field: 'activeStatus', value: provider.basic.status === 'A' ? 'active' : 'inactive', source: 'nppes', confidence: 1, url: NPI_URL(npi) });

  // 2. CMS utilization: exact NPI join.
  if (utilization) {
    links.push({ source: 'cms-utilization', matched: true, method: 'npi-exact', confidence: 1, detail: `${utilization.beneficiaries} beneficiaries · ${utilization.year}`, url: utilization.sourceUrl });
    if (utilization.city) {
      assertions.push({ field: 'practiceCity', value: utilization.city, source: 'cms-utilization', confidence: 1, observedAt: String(utilization.year), url: utilization.sourceUrl });
    }
    if (utilization.specialty) {
      assertions.push({ field: 'specialty', value: utilization.specialty, source: 'cms-utilization', confidence: 1, observedAt: String(utilization.year), url: utilization.sourceUrl });
    }
  } else {
    links.push({ source: 'cms-utilization', matched: false, method: 'unmatched', confidence: 0, detail: 'No Medicare fee-for-service record returned' });
  }

  // 3. Open Payments: exact NPI join on covered_recipient_npi.
  if (payments && payments.records > 0) {
    links.push({ source: 'open-payments', matched: true, method: 'npi-exact', confidence: 1, detail: `${payments.records} payments · ${payments.manufacturers.length} manufacturers`, url: payments.sourceUrl });
    if (payments.specialty) {
      assertions.push({ field: 'specialty', value: payments.specialty, source: 'open-payments', confidence: 1, observedAt: payments.latestDate, url: payments.sourceUrl });
    }
  } else {
    links.push({ source: 'open-payments', matched: false, method: 'unmatched', confidence: 0, detail: 'No industry payments reported for this NPI' });
  }

  // 4. ClinicalTrials.gov: probabilistic, on facility text.
  const facilityMatch = matchTrialFacility(provider, trials);
  if (facilityMatch) {
    links.push({
      source: 'clinicaltrials',
      matched: true,
      method: 'name-facility',
      confidence: facilityMatch.confidence,
      detail: facilityMatch.namesInstitution
        ? facilityMatch.facility
        : `Trial activity in this city; no site matched this ZIP`,
      url: `https://clinicaltrials.gov/study/${facilityMatch.nctId}`,
    });
    // Only a ZIP-level match earns the right to name where someone works.
    if (facilityMatch.namesInstitution) {
      assertions.push({ field: 'institution', value: facilityMatch.facility, source: 'clinicaltrials', confidence: facilityMatch.confidence, url: `https://clinicaltrials.gov/study/${facilityMatch.nctId}` });
    }
  } else {
    links.push({ source: 'clinicaltrials', matched: false, method: 'unmatched', confidence: 0, detail: 'No same-city facility confidently linked to this provider' });
  }

  // 5. PubMed: probabilistic, on author name plus affiliation.
  if (publications.length) {
    const withAffiliation = publications.find(p => p.affiliation);
    const confidence = withAffiliation ? 0.75 : 0.6;
    links.push({ source: 'pubmed', matched: true, method: 'name-affiliation', confidence, detail: `${publications.length} matched publication${publications.length === 1 ? '' : 's'}`, url: publications[0].sourceUrl });
    if (withAffiliation?.affiliation) {
      assertions.push({ field: 'institution', value: withAffiliation.affiliation, source: 'pubmed', confidence, observedAt: withAffiliation.date, url: withAffiliation.sourceUrl });
      const city = cityFromAffiliation(withAffiliation.affiliation);
      if (city) {
        assertions.push({ field: 'practiceCity', value: city, source: 'pubmed', confidence: confidence * 0.8, observedAt: withAffiliation.date, url: withAffiliation.sourceUrl });
      }
    }
  } else {
    links.push({ source: 'pubmed', matched: false, method: 'unmatched', confidence: 0, detail: 'No publication passed full-name and affiliation matching' });
  }

  // 6. Market intelligence CSV: vendor file, joined on NPI but NOT trusted.
  // It is the input most likely to be stale, so its city and specialty are
  // asserted at reduced confidence and left to disagree with the federal
  // sources rather than being reconciled quietly.
  const market = marketRecord(npi);
  if (market) {
    links.push({
      source: 'market-csv',
      matched: true,
      method: 'npi-exact',
      confidence: 0.6,
      detail: `${market.estimatedPatients.toLocaleString()} est. annual patients · ${market.segment} · ${market.source}`,
      url: MARKET_SOURCE_URL,
    });
    if (market.city) {
      assertions.push({ field: 'practiceCity', value: market.city, source: 'market-csv', confidence: 0.6, url: MARKET_SOURCE_URL });
    }
    if (market.specialty) {
      assertions.push({ field: 'specialty', value: market.specialty, source: 'market-csv', confidence: 0.6, url: MARKET_SOURCE_URL });
    }
  } else {
    links.push({ source: 'market-csv', matched: false, method: 'unmatched', confidence: 0, detail: 'Not present in the vendor market file' });
  }

  // 7. Wikidata: exact, via property P9450 (US NPI).
  links.push(
    input.wikidataMatched
      ? { source: 'wikidata', matched: true, method: 'npi-exact', confidence: 1, detail: 'P9450 equals this NPI', url: input.wikidataUrl }
      : { source: 'wikidata', matched: false, method: 'unmatched', confidence: 0, detail: 'No Wikidata item carries this NPI' },
  );

  return { npi, displayName: providerName(provider), links, assertions };
}

/** Cities appearing in PubMed affiliation strings, used to cross-check location. */
const AFFILIATION_CITIES = ['chicago', 'boston', 'new york', 'houston', 'los angeles', 'philadelphia', 'seattle', 'miami', 'rochester', 'baltimore', 'cleveland', 'san francisco', 'dallas', 'atlanta', 'st louis', 'nashville', 'durham', 'ann arbor', 'pittsburgh'];

export function cityFromAffiliation(affiliation: string): string | undefined {
  const lower = affiliation.toLowerCase();
  const hit = AFFILIATION_CITIES.find(city => lower.includes(city));
  return hit ? hit.replace(/\b\w/g, c => c.toUpperCase()) : undefined;
}

/**
 * Link a physician to a trial site.
 *
 * City alone is not enough: every oncologist in Chicago shares a city with
 * hundreds of trial sites, so a city match would hand each of them whichever
 * facility happened to be listed first: a confident, wrong institution name.
 * A ZIP match is required before we will NAME the institution; a city-only
 * overlap is recorded as market activity with no institution asserted.
 */
function matchTrialFacility(provider: Provider, trials: Study[]) {
  const location = provider.addresses.find(a => a.address_purpose === 'LOCATION') ?? provider.addresses[0];
  const city = normalizeCity(location?.city);
  const zip = (location?.postal_code ?? '').slice(0, 5);
  if (!city) return undefined;

  let best: { facility: string; nctId: string; confidence: number; namesInstitution: boolean } | undefined;
  for (const study of trials) {
    for (const site of study.protocolSection.contactsLocationsModule?.locations ?? []) {
      if (!site.facility || normalizeCity(site.city) !== city) continue;
      const zipMatch = Boolean(zip) && (site.zip ?? '').slice(0, 5) === zip;
      // ClinicalTrials.gov publishes no NPI for site staff, so even a ZIP match
      // is capped well below an identifier join.
      const confidence = zipMatch ? 0.72 : 0.45;
      if (!best || confidence > best.confidence) {
        best = {
          facility: site.facility,
          nctId: study.protocolSection.identificationModule.nctId,
          confidence,
          namesInstitution: zipMatch,
        };
      }
    }
  }
  return best;
}
