/**
 * Repository guard: no em dashes, anywhere.
 *
 * The prompt rule and the output sanitiser cover text a model writes. This
 * covers text people write: source, prose, docs, and the data files that feed
 * the pipeline. It exits non-zero so it can gate CI alongside the golden set.
 *
 * Run: npm run style
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hasEmDash } from '../src/lib/style';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.tsbuild', 'public']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT = /\.(ts|tsx|js|jsx|css|html|md|json|csv|txt|yml|yaml)$/;

const offences: string[] = [];

function walk(dir: string) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!TEXT.test(entry)) continue;
    readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
      if (hasEmDash(line)) offences.push(`${path}:${i + 1}  ${line.trim()}`);
    });
  }
}

walk('.');

if (offences.length) {
  console.log(`\n  \x1b[31mFAILED \x1b[0m  ${offences.length} em dash${offences.length === 1 ? '' : 'es'} found\n`);
  for (const o of offences) console.log(`    ${o}`);
  console.log('\n  Use a comma, a semicolon, a colon or a full stop.\n');
  process.exit(1);
}

console.log('\n  \x1b[32mPASSED \x1b[0m  no em dashes in source, docs or data\n');
