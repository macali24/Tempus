/** End-to-end pipeline check against live federal APIs. */
import { fetchProviders, fetchTrials, fetchUtilization } from '../src/api';
import { fetchPaymentsForAll } from '../src/lib/openpayments';
import { rankProviders } from '../src/lib/ranking';
import { generateBrief } from '../src/lib/generate';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

// NPPES has no CORS in the browser so the app proxies it; in Node we call direct.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = String(input);
  if (url.startsWith('/api/npi')) {
    return realFetch('https://npiregistry.cms.hhs.gov/api/' + url.slice('/api/npi'.length), init);
  }
  if (url.startsWith('/api/')) return Promise.reject(new Error('no local server'));
  return realFetch(input, init);
}) as typeof fetch;

const city = 'Chicago';
const state = 'IL';

const providers = await fetchProviders(city, state);
console.log(`\n  providers            ${providers.length}`);

const [trials, utilization, payments] = await Promise.all([
  fetchTrials(city, state),
  fetchUtilization(providers),
  fetchPaymentsForAll(providers.map(p => p.number).slice(0, 8)),
]);
console.log(`  recruiting trials    ${trials.total} (page of ${trials.studies.length})`);
console.log(`  CMS utilization      ${Object.keys(utilization).length}/${providers.length}`);
const withPayments = Object.values(payments).filter(p => p.records > 0).length;
console.log(`  open payments        ${withPayments}/${Object.keys(payments).length} with records`);

const ranked = rankProviders({ providers, trials: trials.studies, trialTotal: trials.total, utilization, payments });
console.log(`\n  ranked top 5:`);
ranked.slice(0, 5).forEach((p, i) => {
  console.log(
    `   ${i + 1}. ${String(p.score).padStart(3)}  ${(p.basic.first_name + ' ' + p.basic.last_name).padEnd(26)}` +
    ` id=${String(p.consensus.confidence).padStart(3)} joins=${p.consensus.exactJoins}e/${p.consensus.probabilisticJoins}p` +
    ` contested=${p.consensus.contested}${p.crm ? ' crm' : ''}`,
  );
});

const contested = ranked.filter(p => p.consensus.contested > 0);
console.log(`\n  contested providers  ${contested.length}`);
contested.slice(0, 3).forEach(p => console.log(`   - ${p.basic.last_name}: ${p.consensus.warnings[0]}`));

// Generation + validation on the highest-ranked provider that has a CRM note.
const target = ranked.find(p => p.crm) ?? ranked[0];
console.log(`\n  generating for ${target.basic.first_name} ${target.basic.last_name}...`);
for (const kind of ['script', 'objection'] as const) {
  const brief = await generateBrief(kind, target, target.payments);
  console.log(`\n  [${kind}] generator=${brief.report.generator} verifier=${brief.report.verifier} ` +
    `accepted=${brief.report.accepted} withheld=${brief.report.withheld} ${brief.latencyMs}ms`);
  console.log(`   body: ${brief.body.slice(0, 180)}${brief.body.length > 180 ? '…' : ''}`);
  brief.report.claims.forEach(c => {
    const gates = c.gates.map(g => `${g.gate}:${g.status}`).join(' ');
    console.log(`   ${c.verdict === 'accepted' ? '+' : '-'} ${c.text.slice(0, 92)}`);
    console.log(`     ${gates}`);
  });
}

// Adversarial: the injection-carrying CRM note must be blocked.
const poisoned = ranked.find(p => p.number === '1174962146');
console.log(`\n  injection fixture in this market: ${poisoned ? 'present' : 'not in Chicago (New York NPI)'}`);
console.log('');
