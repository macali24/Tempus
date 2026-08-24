/**
 * Golden-set runner. Exits non-zero on any failure so it can gate CI.
 */
import { CASES } from '../src/eval/golden';

const GREEN = '[32m';
const RED = '[31m';
const RESET = '[0m';

type Row = { id: string; group: string; description: string; passed: boolean; error?: string };

const rows: Row[] = [];
for (const testCase of CASES) {
  try {
    rows.push({ ...testCase, passed: await testCase.run() });
  } catch (error) {
    rows.push({ ...testCase, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const groups = [...new Set(rows.map(r => r.group))];
const pad = (value: string, width: number) => value.padEnd(width);

console.log('\n  Tempus Sales Copilot - golden evaluation\n');
for (const group of groups) {
  const inGroup = rows.filter(r => r.group === group);
  const passed = inGroup.filter(r => r.passed).length;
  console.log(`  ${group}  ${passed}/${inGroup.length}`);
  for (const row of inGroup) {
    const tag = row.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`    ${tag}  ${pad(row.id, 8)} ${row.description}`);
    if (row.error) console.log(`          error: ${row.error}`);
  }
  console.log('');
}

const passed = rows.filter(r => r.passed).length;
const rate = ((passed / rows.length) * 100).toFixed(1);
console.log(`  ${passed}/${rows.length} cases passed (${rate}%)\n`);

if (passed !== rows.length) process.exit(1);
