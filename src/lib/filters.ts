/**
 * Territory filtering.
 *
 * Loading a market is a data fetch; narrowing it is a different act, and the
 * two were previously conflated in one search-looking box. A rep does not
 * search a territory; they slice it: who needs verifying, who has an open
 * concern, which segment, which objection they are prepared to answer today.
 *
 * Filters apply to the already-loaded market, so they are instant and never
 * refetch.
 */
import type { ScoredProvider } from './ranking';

export type Filters = {
  /** Substring match on physician name. */
  query: string;
  /** Only providers whose sources disagree. */
  needsVerification: boolean;
  /** Only providers with a CRM note on file. */
  hasNote: boolean;
  /** Vendor segment, or 'all'. */
  segment: string;
  /** Extracted objection, or 'all'. */
  objection: string;
};

export const NO_FILTERS: Filters = {
  query: '',
  needsVerification: false,
  hasNote: false,
  segment: 'all',
  objection: 'all',
};

const name = (p: ScoredProvider) =>
  `${p.basic.first_name ?? ''} ${p.basic.last_name ?? ''}`.toLowerCase();

export function applyFilters(providers: ScoredProvider[], filters: Filters): ScoredProvider[] {
  const query = filters.query.trim().toLowerCase();
  return providers.filter(provider => {
    if (query && !name(provider).includes(query)) return false;
    if (filters.needsVerification && provider.consensus.contested === 0) return false;
    if (filters.hasNote && !provider.crm) return false;
    if (filters.segment !== 'all' && provider.segment !== filters.segment) return false;
    if (filters.objection !== 'all' && provider.crm?.objection !== filters.objection) return false;
    return true;
  });
}

export const activeFilterCount = (filters: Filters) =>
  Number(Boolean(filters.query.trim())) +
  Number(filters.needsVerification) +
  Number(filters.hasNote) +
  Number(filters.segment !== 'all') +
  Number(filters.objection !== 'all');

/** Options are derived from the loaded market, so no filter can return nothing by construction. */
export function filterOptions(providers: ScoredProvider[]) {
  const objections = [...new Set(providers.map(p => p.crm?.objection).filter(Boolean))].sort() as string[];
  const segments = [...new Set(providers.map(p => p.segment).filter(Boolean))].sort() as string[];
  return { objections, segments };
}
