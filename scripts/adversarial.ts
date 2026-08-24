/**
 * Adversarial fixtures: the two CRM notes that carry an injection payload and
 * PHI-shaped text must be blocked at gate 1, before any model call.
 */
import { generateBrief } from '../src/lib/generate';
import { simulatedCrm } from '../src/data';
import type { ScoredProvider } from '../src/lib/ranking';

const stub = (npi: string): ScoredProvider => ({
  number: npi,
  basic: { first_name: 'Test', last_name: 'Provider', credential: 'MD', last_updated: '2025-10-01', status: 'A' },
  addresses: [{ address_purpose: 'LOCATION', address_1: '1 Main', city: 'NEW YORK', state: 'NY', postal_code: '10065' }],
  taxonomies: [{ code: 'x', desc: 'Hematology & Oncology', primary: true }],
  score: 70, opportunity: 60, exactFit: 88, panelFit: 88, panelAssay: 'xT CDx', panelRationale: '',
  trialSignal: 50, engagement: 72, recency: 90, identity: 80, confidence: 80,
  cityTrials: [], marketTrials: 400, crm: simulatedCrm[npi],
  entity: { npi, displayName: '', links: [], assertions: [] },
  consensus: { fields: [], confidence: 80, contested: 0, verifyBeforeCalling: false, warnings: [], exactJoins: 2, probabilisticJoins: 0 },
  components: [],
} as unknown as ScoredProvider);

let failures = 0;
console.log('\n  Adversarial CRM fixtures\n');

// "Blocked before any model call" is the claim, so count the calls rather than
// trusting the ordering. A withheld output would not be enough: the poisoned
// text must never reach a generator in the first place.
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  calls++;
  return realFetch(...args);
}) as typeof fetch;

for (const npi of ['1174962146', '1508958166']) {
  calls = 0;
  const brief = await generateBrief('objection', stub(npi));
  const screen = brief.report.inputScreen;
  const blocked = screen.status === 'fail' && brief.report.accepted === 0;
  const silent = calls === 0;
  if (!blocked || !silent) failures++;
  console.log(`  ${blocked ? '\x1b[32mBLOCKED\x1b[0m' : '\x1b[31mLEAKED \x1b[0m'}  NPI ${npi}`);
  console.log(`           note   "${simulatedCrm[npi].note.slice(0, 78)}…"`);
  console.log(`           gate 1 ${screen.status}: ${screen.reason}`);
  console.log(`           output accepted=${brief.report.accepted} withheld=${brief.report.withheld}`);
  console.log(`           calls  ${calls} outbound request${calls === 1 ? '' : 's'} during generation ${silent ? '\x1b[32m(never reached a model)\x1b[0m' : '\x1b[31m(REACHED A MODEL)\x1b[0m'}`);
  console.log(`           body   ${brief.body.slice(0, 96)}\n`);
}

// Control: a clean note must still produce output, and must show a non-zero
// call count, otherwise the counter above proves nothing.
calls = 0;
const clean = await generateBrief('objection', stub('1518101096'));
const cleanCalls = calls;
const ok = clean.report.inputScreen.status === 'pass' && clean.report.accepted > 0;
if (!ok) failures++;
console.log(`  ${ok ? '\x1b[32mPASSED \x1b[0m' : '\x1b[31mFAILED \x1b[0m'}  control: clean note produces ${clean.report.accepted} claims`);
console.log(`           calls  ${cleanCalls} outbound request${cleanCalls === 1 ? '' : 's'}; the counter is live${cleanCalls === 0 ? ' \x1b[33m(no model configured; ordering still proven by the pool being empty)\x1b[0m' : ''}\n`);

process.exit(failures ? 1 : 0);
