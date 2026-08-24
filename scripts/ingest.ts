/**
 * Source ingestion: the three inputs the brief calls for, each in its own
 * format, each with its own parser:
 *
 *   kb/*.md                      Product knowledge base (Markdown)
 *   data/crm/*.txt               CRM notes (plain text, one per physician)
 *   data/market-intelligence.csv Market intelligence (CSV)
 *
 * Nothing about a physician is hard-coded in application source. Editing a text
 * file and re-running this changes what the copilot says.
 *
 * Objections are EXTRACTED from prose here rather than read from a labelled
 * field, because a real Salesforce note does not come with an enum attached.
 *
 * Source text is stripped of em dashes on the way in. The ban is a product
 * rule, not a model rule, so a note typed with one must not carry it into copy
 * a rep reads aloud.
 *
 * Run: npm run ingest
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripEmDashes } from '../src/lib/style';
import { __test as headshots } from '../src/lib/headshots';

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function frontmatter(raw: string) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { meta, body: m[2] };
}

const numbers = (s: string) => new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => n.replace(/,/g, '')));

/* ------------------------------------------------------ 1. knowledge base */

type Chunk = {
  id: string; assay: string; section: string; text: string; grade: string;
  source: string; url: string; accessed: string; topics: string[]; headline?: string;
};

const chunks: Chunk[] = [];
for (const file of readdirSync('kb').filter(f => f.endsWith('.md')).sort()) {
  const { meta, body } = frontmatter(readFileSync(join('kb', file), 'utf8'));
  const base = file.replace(/\.md$/, '');

  for (const block of body.split(/^## /m).slice(1)) {
    const lines = block.split('\n');
    const section = lines[0].trim();
    let topics: string[] = [];
    let headline: string | undefined;
    const text: string[] = [];

    for (const line of lines.slice(1)) {
      if (line.startsWith('topics:')) { topics = line.slice(7).split(',').map(t => t.trim()).filter(Boolean); continue; }
      if (line.startsWith('headline:')) { headline = line.slice(9).trim(); continue; }
      text.push(line);
    }
    const content = text.join('\n').trim();
    if (!content) continue;

    // A headline is a shorter way of saying the same thing; it may not introduce
    // a number the source never stated.
    if (headline) {
      const missing = [...numbers(headline)].filter(n => !numbers(content).has(n));
      if (missing.length) throw new Error(`${file} § ${section}: headline states ${missing.join(', ')}, absent from source text`);
    }

    chunks.push({
      id: `${base}-${slug(section)}`.slice(0, 60),
      assay: meta.assay ?? 'platform', section: stripEmDashes(section), text: stripEmDashes(content),
      grade: meta.grade ?? 'C', source: stripEmDashes(meta.source ?? file),
      url: meta.url ?? '', accessed: meta.accessed ?? '', topics,
      headline: headline && stripEmDashes(headline),
    });
  }
}

/* ------------------------------------------------------------ 2. CRM notes */

/**
 * Objection taxonomy. A note is scored against every concern's vocabulary and
 * the best-supported one wins, with the matched phrases retained so the
 * extraction can be shown rather than asserted.
 */
const OBJECTIONS: Array<{ label: string; cues: string[] }> = [
  { label: 'turnaround time', cues: ['turnaround', 'how long', 'delay', 'took forever', 'in time', 'results take', 'time for care'] },
  { label: 'tissue requirements', cues: ['tissue', 'specimen', 'biopsy', 'sample', 'exhausted', 'insufficient'] },
  { label: 'workflow burden', cues: ['workflow', 'ordering', 'add work', 'onboarding', 'who does', 'stretched', 'operational', 'breaks when'] },
  { label: 'clinical utility', cues: ['actionable', 'changes management', 'noise', 'translate', 'utility', 'on-label', 'exploratory'] },
  { label: 'evidence quality', cues: ['peer-reviewed', 'evidence', 'fda approved', 'ldt', 'overstate', 'marketing language', 'verbatim'] },
  { label: 'cost and coverage', cues: ['coverage', 'cost', 'financial', 'reimburse', 'price', 'finance'] },
  { label: 'data integration', cues: ['integrat', 'review process', 'fit existing', 'existing review'] },
];

type CrmNote = {
  npi: string; physician: string; note: string; interest: string;
  lastContact: string; objection: string; objectionCues: string[]; engagement: number; simulated: true;
};

const notes: CrmNote[] = [];
for (const file of readdirSync('data/crm').filter(f => f.endsWith('.txt')).sort()) {
  const { meta, body } = frontmatter(readFileSync(join('data/crm', file), 'utf8'));
  const interestLine = body.match(/Interest noted:\s*(.+?)\.?\s*$/m);
  const prose = body.replace(/Interest noted:.*$/m, '').trim();
  const haystack = prose.toLowerCase();

  const scored = OBJECTIONS.map(o => {
    const hits = o.cues.filter(c => haystack.includes(c));
    return { label: o.label, hits, score: hits.length };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];

  // Engagement is a function of how recently they engaged, not a magic number.
  const days = Math.max(0, (Date.now() - new Date(meta.last_contact).getTime()) / 86_400_000);
  const engagement = Math.max(20, Math.min(100, Math.round(100 - days / 3)));

  notes.push({
    npi: meta.npi, physician: meta.physician ?? '', note: stripEmDashes(prose),
    interest: stripEmDashes(interestLine?.[1]?.trim() ?? 'oncology'),
    lastContact: meta.last_contact ?? '',
    objection: best.score ? best.label : 'unspecified',
    objectionCues: best.hits,
    engagement, simulated: true,
  });
}

/* ------------------------------------------------- 3. market intelligence */

type MarketRow = {
  npi: string; physician: string; city: string; state: string;
  specialty: string; estimatedPatients: number; segment: string; source: string;
  /** Vendor-modelled tumour mix, as a share of annual patients. */
  mix: { colorectal: number; lung: number; breast: number; heme: number };
  /** Vendor-modelled share of cases where FFPE tissue is inadequate. */
  insufficientTissueRate: number;
  /** Vendor-modelled call-planning site. Never a named institution. */
  practiceAddress: string;
  postalCode: string;
};

const csv = readFileSync('data/market-intelligence.csv', 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));
const header = csv[0].split(',').map(h => h.trim());
const rows: MarketRow[] = csv.slice(1).map(line => {
  const cells = line.split(',');
  const get = (name: string) => cells[header.indexOf(name)]?.trim() ?? '';
  return {
    npi: get('npi'), physician: stripEmDashes(get('physician')), city: get('city'), state: get('state'),
    specialty: get('specialty'), estimatedPatients: Number(get('est_annual_oncology_patients')) || 0,
    segment: get('segment'), source: stripEmDashes(get('source')),
    mix: {
      colorectal: Number(get('pct_colorectal')) || 0,
      lung: Number(get('pct_lung')) || 0,
      breast: Number(get('pct_breast')) || 0,
      heme: Number(get('pct_heme')) || 0,
    },
    insufficientTissueRate: Number(get('insufficient_tissue_rate')) || 0,
    practiceAddress: stripEmDashes(get('practice_address')),
    postalCode: get('postal_code'),
  };
}).filter(r => r.npi);

// A mix that exceeds the whole panel is a broken vendor file, not a low score.
for (const r of rows) {
  const total = r.mix.colorectal + r.mix.lung + r.mix.breast + r.mix.heme;
  if (total > 100) throw new Error(`market CSV: ${r.physician} (${r.npi}) tumour mix sums to ${total}%`);
}

/* ------------------------------------------------- 4. headshot registry */

/*
 * A registry entry with no image behind it renders a broken frame in place of
 * a face, which is the one failure the headshot gate exists to prevent. So the
 * pairing is checked here rather than discovered in a browser: every audited
 * NPI must have a file, and every file must be claimed by an audited NPI.
 */
const HEADSHOT_DIR = 'public/headshots';
const registered = Object.keys(headshots.REGISTRY);
const onDisk = readdirSync(HEADSHOT_DIR).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, ''));

const missing = registered.filter(npi => !existsSync(join(HEADSHOT_DIR, `${npi}.jpg`)));
const orphaned = onDisk.filter(npi => !registered.includes(npi));
if (missing.length || orphaned.length) {
  if (missing.length) console.error(`\n  Headshot registry names ${missing.length} NPI(s) with no image: ${missing.join(', ')}`);
  if (orphaned.length) console.error(`\n  ${HEADSHOT_DIR} holds ${orphaned.length} unattributed image(s): ${orphaned.join(', ')}`);
  console.error('\n  Every face must be attributable to a source. Fix src/lib/headshots.ts.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ emit */

const emit = (path: string, banner: string, body: string) => writeFileSync(path, `${banner}\n${body}`);
const BANNER = (from: string) =>
  `// GENERATED by scripts/ingest.ts from ${from}; do not edit by hand.\n// Run \`npm run ingest\` after changing any source file.`;

emit('src/lib/kb.generated.ts', BANNER('kb/*.md'),
  `import type { KbChunk } from './kb';\n\nexport const GENERATED_KB: KbChunk[] = ${JSON.stringify(chunks, null, 2)} as KbChunk[];\n`);

emit('src/lib/crm.generated.ts', BANNER('data/crm/*.txt'),
  `import type { CrmNote } from '../types';\n\nexport const GENERATED_CRM: Record<string, CrmNote> = ${JSON.stringify(Object.fromEntries(notes.map(n => [n.npi, n])), null, 2)} as Record<string, CrmNote>;\n`);

emit('src/lib/market.generated.ts', BANNER('data/market-intelligence.csv'),
  `import type { MarketRecord } from './market';\n\nexport const GENERATED_MARKET: MarketRecord[] = ${JSON.stringify(rows, null, 2)};\n`);

console.log(`\n  Ingested three source formats\n`);
console.log(`    Markdown  kb/*.md                        ${String(chunks.length).padStart(3)} chunks`);
console.log(`    Text      data/crm/*.txt                 ${String(notes.length).padStart(3)} notes`);
console.log(`    CSV       data/market-intelligence.csv    ${String(rows.length).padStart(3)} providers`);
console.log(`    JPEG      public/headshots/*.jpg         ${String(registered.length).padStart(3)} attributed headshots\n`);
for (const n of notes.slice(0, 4)) {
  console.log(`    extracted "${n.objection}" from ${n.npi} via [${n.objectionCues.join(', ') || 'no cue'}]`);
}
console.log('');
