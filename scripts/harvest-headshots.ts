/**
 * Headshot harvest.
 *
 * Most physician directories publish a photo under an opaque CMS id, so the
 * only thing tying a face to a person is a name search. That is exactly the
 * match this product refuses to make elsewhere, so those photos are added by
 * hand in headshots.ts or not at all.
 *
 * Two Chicago systems are different, and both are harvested here because both
 * let a machine check the link rather than assume it:
 *
 *   Northwestern Medicine  serves the photo from a path keyed by NPI and
 *                          publishes the profile page at the same key.
 *   UChicago Medicine      publishes the NPI in the body of the profile page,
 *                          so a page found by name slug can be confirmed to be
 *                          about the physician it was looked up for.
 *
 * In both cases the rule is the same: keep the photo only when the name the
 * institution asserts agrees with the name NPPES files for that same NPI. Two
 * independent parties naming the same person is the bar. One party naming them
 * is not, which is why a slug that resolves to a directory landing page is
 * dropped rather than guessed at.
 *
 * Disagreements are printed and dropped, never reconciled. nm.org currently
 * misspells three surnames its own NPPES record spells correctly, and a script
 * that "fixed" those would be inventing the evidence it exists to check.
 *
 * Run: npm run headshots [city] [state]
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ORDERING_TAXONOMIES } from '../src/api';
import type { Headshot, PhotoEvidence } from '../src/lib/headshots';

const [city, state] = [process.argv[2] ?? 'Chicago', process.argv[3] ?? 'IL'];
const IMAGE_DIR = 'public/headshots';
const OUT = 'src/lib/headshots.generated.ts';
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Person = { npi: string; first: string; last: string };
/** What a source found, before the name check decides whether to keep it. */
type Candidate = { bytes: Buffer; asserted: string; sourceUrl: string; evidence: PhotoEvidence };

/** The same market NPPES query the app runs, unbounded by the territory limit. */
async function roster(): Promise<Person[]> {
  const seen = new Map<string, Person>();
  for (const taxonomy of ORDERING_TAXONOMIES) {
    for (const skip of [0, 200]) {
      const q = new URLSearchParams({
        version: '2.1', enumeration_type: 'NPI-1', taxonomy_description: taxonomy,
        city, state, country_code: 'US', limit: '200', skip: String(skip),
      });
      const response = await fetch(`https://npiregistry.cms.hhs.gov/api/?${q}`);
      if (!response.ok) break;
      const results = (await response.json()).results ?? [];
      for (const provider of results) {
        const location = provider.addresses?.find((a: { address_purpose: string }) => a.address_purpose === 'LOCATION') ?? provider.addresses?.[0];
        if (provider.basic?.status !== 'A') continue;
        if (location?.city?.toLowerCase() !== city.toLowerCase() || location?.state !== state) continue;
        seen.set(provider.number, { npi: provider.number, first: provider.basic.first_name ?? '', last: provider.basic.last_name ?? '' });
      }
      if (results.length < 200) break;
      await sleep(120);
    }
  }
  return [...seen.values()];
}

const text = async (url: string) => {
  const response = await fetch(url, { headers: UA, redirect: 'follow' });
  return { ok: response.ok, url: response.url, body: response.ok ? await response.text() : '' };
};

const title = (html: string) => ((html.match(/<title>([^<|]*)/) ?? [, ''])[1]).replace(/\s*-\s*UChicago Medicine.*$/i, '').trim();

/* ------------------------------------------------- Northwestern Medicine */

async function northwestern(person: Person): Promise<Candidate | null> {
  let bytes: Buffer;
  try {
    const response = await fetch(`https://www.nm.org/image/doctor/NPI/${person.npi}.jpg`, { headers: UA });
    if (!response.ok) return null;
    bytes = Buffer.from(await response.arrayBuffer());
  } catch { return null; }
  // A short body is the CMS returning an error page with an image content type.
  if (bytes.length < 5000) return null;

  // The profile page at the same NPI is nm.org naming the subject of the photo.
  let page = '';
  try {
    const result = await text(`https://www.nm.org/doctors/${person.npi}`);
    if (!result.url.includes('search-results')) page = title(result.body);
  } catch { /* the EXIF description below is the fallback naming authority */ }

  // Photographers leave the subject's name in the JPEG description, which is
  // how a photo with no published profile page can still name itself.
  const exif = (bytes.toString('latin1').match(/([A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+)+), (?:MD|M\.D\.|DO)/) ?? [, ''])[1];
  const asserted = page || (exif ? `${exif}, MD` : '');
  if (!asserted) return null;

  return {
    bytes,
    asserted,
    sourceUrl: page ? `https://www.nm.org/doctors/${person.npi}` : `https://www.nm.org/image/doctor/NPI/${person.npi}.jpg`,
    evidence: page ? 'npi-on-source-page' : 'npi-keyed-asset',
  };
}

/* ----------------------------------------------------- UChicago Medicine */

const slug = (person: Person) => `${person.first} ${person.last}`
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, '-');

async function uchicago(person: Person): Promise<Candidate | null> {
  const url = `https://www.uchicagomedicine.org/find-a-physician/physician/${slug(person)}`;
  let page;
  try { page = await text(url); } catch { return null; }
  if (!page.ok) return null;

  // A slug that does not resolve returns the directory landing page with a 200,
  // so the NPI in the body is what proves this page is about this physician.
  if (!page.body.includes(person.npi)) return null;

  const image = (page.body.match(/https:\/\/edge\.sitecorecloud\.io[^"'> ]*physician-photos[^"'> ]*/) ?? [])[0];
  const asserted = title(page.body);
  if (!image || !asserted) return null;

  let bytes: Buffer;
  try {
    const response = await fetch(image.replace(/&amp;/g, '&'), { headers: UA });
    if (!response.ok) return null;
    bytes = Buffer.from(await response.arrayBuffer());
  } catch { return null; }
  if (bytes.length < 5000) return null;

  return { bytes, asserted, sourceUrl: url, evidence: 'npi-on-source-page' };
}

const SOURCES = [
  { publisher: 'Northwestern Medicine', find: northwestern },
  { publisher: 'UChicago Medicine', find: uchicago },
];

/* ------------------------------------------------------------- the check */

/**
 * Names reduced to comparable letters. This is deliberately stricter than the
 * runtime gate in headshots.ts, which forgives a single character to absorb
 * transliteration: at harvest time there is no reason to accept a near miss,
 * because dropping a photo costs an icon and keeping a wrong one costs a face.
 */
const key = (value: string) => value
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[\s,]+/).map(token => token.replace(/[^a-z-]/g, ''))
  .filter(token => token.replace(/-/g, '').length > 1
    && !['md', 'do', 'phd', 'mph', 'mbbs', 'ms', 'msc', 'mba', 'jr', 'sr', 'ii', 'iii'].includes(token))
  .map(token => token.replace(/-/g, ''));

const agree = (asserted: string, nppes: string) => {
  const [a, b] = [key(asserted), key(nppes)];
  return Boolean(a[0]) && a[0] === b[0] && a.slice(1).join('') === b.slice(1).join('');
};

const people = await roster();
console.log(`\n  Harvesting headshots for ${people.length} active ${city}, ${state} providers`);
console.log(`  Sources: ${SOURCES.map(s => s.publisher).join(', ')}\n`);

const kept: Array<Headshot & { npi: string }> = [];
const rejected: string[] = [];

for (const person of people) {
  for (const source of SOURCES) {
    const found = await source.find(person).catch(() => null);
    await sleep(60);
    if (!found) continue;

    const nppes = `${person.first} ${person.last}`;
    if (!agree(found.asserted, nppes)) {
      rejected.push(`${RED}${person.npi}${RESET}  NPPES "${nppes}" against ${source.publisher} "${found.asserted}"`);
      continue;
    }

    writeFileSync(join(IMAGE_DIR, `${person.npi}.jpg`), found.bytes);
    kept.push({ npi: person.npi, sourceName: found.asserted, publisher: source.publisher, sourceUrl: found.sourceUrl, evidence: found.evidence });
    console.log(`  ${GREEN}KEEP${RESET}  ${person.npi}  ${found.asserted.padEnd(38)}${DIM}${source.publisher}${RESET}`);
    break;
  }
}

// Photographic originals run to 90 KB each, which is a megabyte of avatars
// nobody sees at more than 78 pixels.
for (const hit of kept) {
  const path = join(IMAGE_DIR, `${hit.npi}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78', '-Z', '360', path, '--out', path], { stdio: 'ignore' });
}

const entries = [...kept]
  .sort((x, y) => x.sourceName.localeCompare(y.sourceName))
  .map(hit => `  '${hit.npi}': {
    sourceName: '${hit.sourceName.replace(/'/g, "\\'")}',
    publisher: '${hit.publisher}',
    sourceUrl: '${hit.sourceUrl}',
    evidence: '${hit.evidence}',
  },`).join('\n');

writeFileSync(OUT, `// GENERATED by scripts/harvest-headshots.ts; do not edit by hand.
// Run \`npm run headshots\` to re-verify every face against NPPES and refresh.
import type { Headshot } from './headshots';

export const GENERATED_HEADSHOTS: Record<string, Headshot> = {
${entries}
};
`);

const byPublisher = SOURCES.map(s => `${kept.filter(k => k.publisher === s.publisher).length} ${s.publisher}`).join(', ');
console.log(`\n  ${kept.length} headshots verified by two parties and written to ${IMAGE_DIR} (${byPublisher})`);
if (rejected.length) {
  console.log(`  ${rejected.length} rejected, kept out rather than reconciled:\n`);
  for (const line of rejected) console.log(`    ${line}`);
}
console.log('');
