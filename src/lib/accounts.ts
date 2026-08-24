/**
 * Account layer.
 *
 * The brief describes territories of "clinics and hospital systems" and meetings
 * with a Chief Medical Officer. A CMO does not buy for themselves; they buy for
 * a site. Ranking individual physicians cannot represent the thing being bought,
 * so this module rolls physicians up into the practice sites they share.
 *
 * The grouping key is the NPPES practice address, normalised: suite and floor
 * are dropped, and the street number is bucketed, because a campus spans
 * adjacent numbers (675 and 676 N Saint Clair are one Chicago site, six blocks
 * of oncology under one roof).
 *
 * NPPES does not name the institution for an individual NPI, so an account is
 * labelled by its address and carries a PROBABLE institution name only when
 * another source asserted one, never invented.
 */
import type { ScoredProvider } from './ranking';
import { titleCase } from './format';

export type Account = {
  id: string;
  /** Normalised street address of the primary site, always factual. */
  site: string;
  /** Every distinct address rolled into this account. */
  sites: string[];
  zip: string;
  city: string;
  state: string;
  /** Institution name asserted by another source, with how many agreed. */
  probableInstitution?: { name: string; sources: number };
  providers: ScoredProvider[];
  /** Highest provider score in the account, who gets you in the door. */
  topScore: number;
  /** Combined CMS beneficiaries across resolved physicians. */
  beneficiaries: number;
  /** Physicians whose records disagree or whose identity confidence is low. */
  contested: number;
  /** Objection themes raised by more than one physician at the site. */
  themes: Array<{ objection: string; count: number }>;
};

const SUITE = /\s+(STE|SUITE|FL|FLOOR|UNIT|RM|ROOM|BLDG|BUILDING|DEPT|#)\b.*$/i;

/** Campus-level key: drop the suite, bucket the street number to the block. */
export function siteKey(address1: string, zip: string): string {
  const street = address1.toUpperCase().replace(SUITE, '').trim();
  const match = street.match(/^(\d+)\s+(.*)$/);
  const normalized = match
    ? `${Math.floor(Number(match[1]) / 10) * 10} ${match[2]}`
    : street;
  return `${normalized}|${zip.slice(0, 5)}`;
}

const prettyStreet = (address1: string) => titleCase(address1.replace(SUITE, '').trim());

/**
 * ClinicalTrials.gov sponsors routinely anonymise a site as "Research Site",
 * "Local Institution" or "Investigative Site" rather than naming it. These are
 * placeholders, not institutions: grouping on one merges unrelated hospitals
 * under a label that names nothing, and showing one tells a rep they are
 * walking into a building called Research Site. Treated as no assertion.
 */
const PLACEHOLDER_FACILITY = /^(research|investigative|clinical|study|trial)\s*(site|center|centre|facility)$|^local institution$|^site\s*\d*$/i;

const cleanInstitution = (value: string): string | undefined => {
  const name = value.replace(/\s*\(\s*Site\s*\d+\s*\)\s*$/i, '').trim();
  return name && !PLACEHOLDER_FACILITY.test(name) ? name : undefined;
};

/** The institution a source named for this physician, if any source did. */
function namedInstitution(provider: ScoredProvider): string | undefined {
  for (const assertion of provider.entity.assertions) {
    if (assertion.field !== 'institution') continue;
    const name = cleanInstitution(assertion.value);
    if (name) return name;
  }
  return undefined;
}

export function buildAccounts(providers: ScoredProvider[]): Account[] {
  // Group by named institution where a source supplied one, so a campus spread
  // across several streets is one conversation with one CMO. Physicians whose
  // institution nobody named fall back to their own site.
  const groups = new Map<string, ScoredProvider[]>();

  for (const provider of providers) {
    const location = provider.addresses.find(a => a.address_purpose === 'LOCATION') ?? provider.addresses[0];
    if (!location) continue;
    const institution = namedInstitution(provider);
    const key = institution ?? siteKey(location.address_1, location.postal_code ?? '');
    groups.set(key, [...(groups.get(key) ?? []), provider]);
  }

  const accounts: Account[] = [];

  for (const [key, members] of groups) {
    const first = members[0];
    const location = first.addresses.find(a => a.address_purpose === 'LOCATION') ?? first.addresses[0];

    // An institution name is only shown when a source asserted it. The most
    // corroborated assertion across the site's physicians wins.
    const claims = new Map<string, number>();
    for (const provider of members) {
      for (const assertion of provider.entity.assertions) {
        if (assertion.field !== 'institution') continue;
        const name = cleanInstitution(assertion.value);
        if (name) claims.set(name, (claims.get(name) ?? 0) + 1);
      }
    }
    const best = [...claims.entries()].sort((a, b) => b[1] - a[1])[0];

    const objections = new Map<string, number>();
    for (const provider of members) {
      if (provider.crm?.objection) {
        objections.set(provider.crm.objection, (objections.get(provider.crm.objection) ?? 0) + 1);
      }
    }

    const sites = [...new Set(members.map(p => {
      const l = p.addresses.find(a => a.address_purpose === 'LOCATION') ?? p.addresses[0];
      return prettyStreet(l?.address_1 ?? '');
    }).filter(Boolean))];

    accounts.push({
      id: key,
      site: prettyStreet(location.address_1),
      sites,
      zip: (location.postal_code ?? '').slice(0, 5),
      city: titleCase(location.city ?? ''),
      state: location.state ?? '',
      probableInstitution: best ? { name: best[0], sources: best[1] } : undefined,
      providers: [...members].sort((a, b) => b.score - a.score),
      topScore: Math.max(...members.map(p => p.score)),
      beneficiaries: members.reduce((sum, p) => sum + (p.utilization?.beneficiaries ?? 0), 0),
      contested: members.filter(p => p.consensus.verifyBeforeCalling).length,
      themes: [...objections.entries()]
        .map(([objection, count]) => ({ objection, count }))
        .sort((a, b) => b.count - a.count),
    });
  }

  // Sites with more oncologists are worth more of a rep's day than a single
  // high scorer, but the strongest individual still breaks ties.
  return accounts.sort(
    (a, b) => b.providers.length - a.providers.length || b.topScore - a.topScore,
  );
}

/**
 * A CMO conversation is about the site, not one clinician. This states what is
 * true of the group and never invents a shared position.
 */
export function accountAngle(account: Account): string {
  const n = account.providers.length;
  const who = `${n} oncologist${n === 1 ? '' : 's'}`;
  const shared = account.themes.filter(t => t.count > 1);

  if (shared.length) {
    const theme = shared[0];
    return `${who} at this site, and ${theme.count} of them have independently raised ${theme.objection}. That is a site-level workflow question, not a physician preference, worth putting to whoever owns the pathway.`;
  }
  if (n > 1) {
    const list = account.themes.slice(0, 2).map(t => t.objection).join(' and ');
    return list
      ? `${who} at this site raising different concerns (${list}). No shared blocker yet; use the strongest relationship to get a pathway conversation.`
      : `${who} at this site with no recorded concerns. Open with discovery before proposing anything.`;
  }
  return `Single oncologist at this site. Treat as an individual conversation rather than an account.`;
}
