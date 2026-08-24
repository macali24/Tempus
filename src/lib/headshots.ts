/**
 * Physician headshots: a face is a claim about identity.
 *
 * Putting the wrong face on a dossier is the most legible error this app could
 * make: a rep walks into a room expecting one person. So a photo is treated
 * exactly like every other assertion in the pipeline. It has to come from a
 * source that names the physician, it has to be tied to *this NPI*, and the
 * name that source asserts has to agree with the name on the record in hand.
 * Any disagreement withholds the photo and says why, rather than guessing.
 *
 * This is not decoration that happens to be verified. The gate catches a real
 * class of error: the vendor CSV maps NPI 1588184956 to "Jessica Altman", while
 * NPPES and Northwestern Medicine both attribute that NPI to Bilal Anouti. In
 * demo mode that row shows the fallback icon and the reason, because showing
 * Dr. Anouti's face over Dr. Altman's name would be a fabrication.
 *
 * Files live in `public/headshots/{npi}.jpg`, copied from the source rather
 * than hotlinked: a hotlink can be swapped, expire, or be blocked by referrer
 * checks, and a headshot that silently becomes a 404 or someone else's photo is
 * the failure mode this module exists to prevent.
 */
import type { Provider } from '../types';

/** How a photo was tied to the NPI it is filed under, strongest first. */
export type PhotoEvidence =
  /** The source page itself carries this NPI; the publisher makes the link. */
  | 'npi-on-source-page'
  /** The image is served from a path keyed by this NPI by the institution. */
  | 'npi-keyed-asset'
  /** Name and specialty on the source match the NPPES practice address. */
  | 'name-and-practice-address';

export type Headshot = {
  /** The name the source itself asserts. Compared against the record in hand. */
  sourceName: string;
  /** Who published the photo. */
  publisher: string;
  /** Page a reader can open to check the attribution for themselves. */
  sourceUrl: string;
  evidence: PhotoEvidence;
};

/**
 * Hand-audited. Every entry was checked against the NPPES record for that NPI
 * before it was added; anyone whose photo could not be tied to their NPI with
 * one of the three kinds of evidence above is deliberately absent and renders
 * the icon. Absent by design, currently: Clare Anderson (1669122206), Worood
 * Abboud (1245325018), Syed Abutalib (1114183290), Kalid Adab (1346473345),
 * Jacob Adashek (1144780107) and Karim Abou-Nassar (1366770745), whose
 * directories publish a placeholder or no photo at all.
 */
const REGISTRY: Record<string, Headshot> = {
  '1265689889': {
    sourceName: 'Manik Amin, MD',
    publisher: 'UChicago Medicine',
    sourceUrl: 'https://www.uchicagomedicine.org/find-a-physician/physician/manik-amin',
    evidence: 'name-and-practice-address',
  },
  '1033548383': {
    sourceName: 'Yasmin Abaza, MD',
    publisher: 'Northwestern Medicine',
    sourceUrl: 'https://www.nm.org/doctors/1033548383',
    evidence: 'npi-on-source-page',
  },
  '1588184956': {
    sourceName: 'Bilal Anouti, MD',
    publisher: 'Northwestern Medicine',
    sourceUrl: 'https://www.nm.org/doctors/1588184956',
    evidence: 'npi-on-source-page',
  },
  '1114489192': {
    sourceName: 'Juan Alban, MD',
    publisher: 'Northwestern Medicine',
    sourceUrl: 'https://www.nm.org/image/doctor/NPI/1114489192.jpg',
    evidence: 'npi-keyed-asset',
  },
  '1033562327': {
    sourceName: 'Xavier Andrade-Gonzalez, MD',
    publisher: 'Avera Health',
    sourceUrl: 'https://doctors.avera.org/xavier-andrade-gonzalez',
    evidence: 'npi-on-source-page',
  },
  '1497172845': {
    sourceName: 'Ivy Abraham, MD',
    publisher: 'UChicago Medicine',
    sourceUrl: 'https://www.uchicagomedicine.org/find-a-physician/physician/ivy-abraham',
    evidence: 'name-and-practice-address',
  },
  '1518101096': {
    sourceName: 'Wassim Abida, MD, PhD',
    publisher: 'Memorial Sloan Kettering',
    sourceUrl: 'https://www.mskcc.org/cancer-care/doctors/wassim-abida',
    evidence: 'npi-on-source-page',
  },
  '1174962146': {
    sourceName: 'Ghaith Abu-Zeinah, MD',
    publisher: 'Weill Cornell Medicine',
    sourceUrl: 'https://weillcornell.org/ghaith-abu-zeinah-md',
    evidence: 'name-and-practice-address',
  },
  '1285611954': {
    sourceName: 'Gregory A. Abel, MD, MPH',
    publisher: 'Dana-Farber Cancer Institute',
    sourceUrl: 'https://www.dana-farber.org/find-a-doctor/gregory-a-abel',
    evidence: 'npi-on-source-page',
  },
  '1285846790': {
    sourceName: 'Kerin Adelson, MD',
    publisher: 'MD Anderson Cancer Center',
    sourceUrl: 'https://www.mdanderson.org/newsroom/kerin-adelson-md-named-md-anderson-chief-quality-and-value-officer.h00-159617067.html',
    evidence: 'name-and-practice-address',
  },
  '1508958166': {
    sourceName: 'Vahid Afshar-Kharghan, MD',
    publisher: 'MD Anderson Cancer Center',
    sourceUrl: 'https://faculty.mdanderson.org/profiles/vahid_afshar-kharghan.html',
    evidence: 'name-and-practice-address',
  },
};

/** Credentials and honorifics carry no identity, so they are not compared. */
const NOT_A_NAME = new Set([
  'md', 'do', 'mbbs', 'mbchb', 'phd', 'mph', 'msc', 'ms', 'mba', 'mha', 'rn', 'np', 'pa',
  'facp', 'fasco', 'fachp', 'dr', 'prof', 'jr', 'sr', 'ii', 'iii', 'iv',
]);

/**
 * Names are compared on letters alone. NPPES files "ABU ZEINAH" where Weill
 * Cornell writes "Abu-Zeinah", and title-casing, middle initials and trailing
 * credentials all vary by source, none of which is a different person.
 */
function nameKey(value: string): { first: string; last: string } {
  const tokens = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[\s,]+/)
    .map(token => token.replace(/[^a-z-]/g, ''))
    // A bare initial distinguishes nobody, and "M.D." leaves an "m" and a "d".
    .filter(token => token.replace(/-/g, '').length > 1 && !NOT_A_NAME.has(token));
  const flat = tokens.map(token => token.replace(/-/g, ''));
  return { first: flat[0] ?? '', last: flat.slice(1).join('') };
}

/** Levenshtein, bounded; only ever asked whether two surnames differ by one. */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return edits + (long.length - j) + (short.length - i) <= 1;
}

/**
 * Whether the source's name and the record's name describe the same person.
 *
 * The first name must match outright. A surname is allowed to differ by a
 * single character, because transliterated names reach different sources spelled
 * differently; the vendor CSV writes "Afsharkhargan" for the "Afsharkharghan"
 * that NPPES and MD Anderson both file. One character is nowhere near enough to
 * confuse two people filed under the same NPI: the mismatches this gate exists
 * to catch ("Altman" against "Anouti") are not near-misses.
 */
function sameName(source: string, record: string): boolean {
  const a = nameKey(source);
  const b = nameKey(record);
  if (!a.first || !a.last || !b.first || !b.last) return false;
  return a.first === b.first && within1(a.last, b.last);
}

/** Guarded so Node scripts (eval, smoke test) can import this module too. */
const BASE: string = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

export type HeadshotResult =
  | { kind: 'photo'; src: string; alt: string; photo: Headshot }
  /** No audited photo exists for this NPI at all. */
  | { kind: 'none' }
  /** A photo exists, but the source names someone else. Never shown. */
  | { kind: 'withheld'; reason: string };

/**
 * The only way a photo reaches the screen. Resolves against the name on the
 * record actually being displayed, so the same NPI can render a face in live
 * mode and the icon in demo mode when the vendor file disagrees about who it is.
 */
export function headshotFor(provider: Provider): HeadshotResult {
  const photo = REGISTRY[provider.number];
  if (!photo) return { kind: 'none' };

  const recordName = `${provider.basic.first_name ?? ''} ${provider.basic.last_name ?? ''}`.trim();
  if (!sameName(photo.sourceName, recordName)) {
    return {
      kind: 'withheld',
      reason: `Photo withheld: ${photo.publisher} attributes NPI ${provider.number} to ${photo.sourceName}, not to the name on this record.`,
    };
  }

  return {
    kind: 'photo',
    src: `${BASE}headshots/${provider.number}.jpg`,
    alt: photo.sourceName,
    photo,
  };
}

/** Exported for the eval script, which asserts the gate against real records. */
export const __test = { nameKey, sameName, REGISTRY };
