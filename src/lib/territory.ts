/**
 * Territory sizing.
 *
 * Widening the NPPES query from one taxonomy to four turned a Chicago market
 * from 11 physicians into several hundred, which is the honest size of the
 * territory but not the size of a working call list. Enrichment is per
 * physician: one CMS utilization call, one Open Payments call, one geocode
 * each. Fanning those out across the whole market would spend hundreds of
 * requests to rank people a rep will never reach this quarter.
 *
 * So the market is reported at full size and a bounded working set is enriched.
 * The bound is applied by *known account first*, never alphabetically: a
 * physician carrying an ingested CRM note or a vendor row is someone the
 * business already has a relationship or an estimate for, and dropping them to
 * enrich a stranger whose surname starts with A is the exact failure the old
 * `limit=20` produced.
 */
import type { Provider } from '../types';
import { crmNoteFor } from '../data';
import { marketRecordFor } from './market';

/** How many physicians get live enrichment. */
export const TERRITORY_LIMIT = 60;

/** True when a source we already hold says something about this physician. */
const known = (provider: Provider) =>
  Boolean(crmNoteFor(provider)) || Boolean(marketRecordFor(provider));

export type Territory = {
  /** The physicians that receive live enrichment and enter the ranked list. */
  working: Provider[];
  /** Every physician the market query resolved, before the bound. */
  total: number;
  /** How many of `total` were left unenriched, stated rather than hidden. */
  omitted: number;
};

export function selectTerritory(providers: Provider[], limit = TERRITORY_LIMIT): Territory {
  const ordered = [...providers].sort((a, b) => Number(known(b)) - Number(known(a)));
  const working = ordered.slice(0, limit);
  return { working, total: providers.length, omitted: Math.max(0, providers.length - working.length) };
}
