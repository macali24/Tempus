import type { Provider } from '../types';

/** Minimum name similarity before an NPI-keyed local row is accepted. */
export const NAME_MATCH_FLOOR = 0.88;

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

export const providerName = (provider: Provider) =>
  `${provider.basic.first_name ?? ''} ${provider.basic.last_name ?? ''}`.trim().replace(/\s+/g, ' ');

/**
 * An exact NPI is necessary but not sufficient for local CRM/vendor data.
 * Checking the row's named physician prevents a stale or mistyped NPI from
 * attaching one real doctor's private note or modelled metrics to another.
 */
export function providerMatchesName(provider: Provider, candidate?: string): boolean {
  return Boolean(candidate) && jaroWinkler(providerName(provider), candidate ?? '') >= NAME_MATCH_FLOOR;
}
