/**
 * Gate 4 proof.
 *
 * Gates 1-3 are deterministic and cheap. The question this answers is whether
 * gate 4 earns its cost, so the fixture is a claim that PASSES gates 1-3 and
 * can only be caught by an independent model reading the evidence:
 *
 *   "Tempus xT CDx is validated for use in pediatric patients."
 *
 * It contains no number (numeric guard passes), and it cites a real grade-A
 * chunk (grade gate passes). Nothing but entailment can reject it.
 *
 * Two stub providers stand in for Gemini and Groq so the cross-model path runs
 * end to end without credentials. The assertions below check the wiring the
 * real keys would use, including that the verifier is never the generator.
 */
import { createServer } from 'node:http';
import { setGatewayBase, complete } from '../src/lib/llm';
import { validateClaims, type EvidenceItem } from '../src/lib/validator';
import { KB } from '../src/lib/kb';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const seenBy: Record<string, string[]> = { generator: [], verifier: [] };

const server = createServer((request, response) => {
  const send = (body: unknown) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
  };
  if (request.url === '/api/llm/status') return send({ providers: ['gemini', 'groq'] });

  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    const { provider, prompt, system } = JSON.parse(raw || '{}');

    // The verifier is whichever provider receives the auditor system prompt.
    const isVerifier = typeof system === 'string' && system.includes('evidence auditor');
    seenBy[isVerifier ? 'verifier' : 'generator'].push(provider);

    if (!isVerifier) {
      return send({
        model: `${provider}-stub`,
        text: JSON.stringify({
          claims: [
            { text: 'Tempus xT CDx is validated for use in pediatric patients.', evidenceIds: ['xt-cdx-indication-intended-use'] },
            { text: 'It reports microsatellite instability status.', evidenceIds: ['xt-cdx-performance-msi-concordance-against-ihc'] },
          ],
        }),
      });
    }

    // Stand-in auditor: the evidence says "previously diagnosed solid malignant
    // neoplasms" and says nothing about paediatric validation.
    const unsupported = /pediatric/i.test(prompt);
    return send({
      model: `${provider}-stub`,
      text: JSON.stringify(
        unsupported
          ? { verdict: 'unsupported', reason: 'the evidence states no pediatric indication' }
          : { verdict: 'supported', reason: 'stated directly in the cited span' },
      ),
    });
  });
});

await new Promise<void>(resolve => server.listen(0, resolve));
const port = (server.address() as { port: number }).port;
setGatewayBase(`http://127.0.0.1:${port}`);

const pool: EvidenceItem[] = KB.map(chunk => ({ kind: 'kb' as const, ...chunk }));

const drafted = await complete('draft', { system: 'you draft sales copy' });
const claims = JSON.parse(drafted.text).claims;
const report = await validateClaims(claims, pool, drafted.provider, 'Routine note about specimen handling.');

server.close();

const bad = report.claims.find(c => /pediatric/i.test(c.text))!;
const good = report.claims.find(c => /microsatellite/i.test(c.text))!;
const gateOf = (claim: typeof bad) => claim.gates.find(g => g.gate === 'entailment')!;

const checks: Array<[string, boolean, string]> = [
  ['Generator ran on a real provider', drafted.provider === 'gemini', `used ${drafted.provider}`],
  ['Verifier ran (not skipped)', gateOf(good).status !== 'skipped', gateOf(good).status],
  ['Verifier is NOT the generator', report.verifier !== report.generator, `${report.generator} drafted, ${report.verifier} checked`],
  ['Verifier never saw the generator prompt', !seenBy.verifier.includes(report.generator), `verifier calls: ${seenBy.verifier.join(', ')}`],
  ['Unsupported claim passed gates 1-3', bad.gates.filter(g => g.gate !== 'entailment').every(g => g.status !== 'fail'), 'injection/grade/numeric all clean'],
  ['Gate 4 caught it', gateOf(bad).status === 'fail', gateOf(bad).reason],
  ['Unsupported claim withheld', bad.verdict === 'withheld', bad.verdict],
  ['Supported claim survived', good.verdict === 'accepted', good.verdict],
];

console.log('\n  Gate 4: cross-model entailment\n');
let failures = 0;
for (const [label, passed, detail] of checks) {
  if (!passed) failures++;
  console.log(`    ${passed ? GREEN + 'PASS' + RESET : RED + 'FAIL' + RESET}  ${label.padEnd(42)} ${detail}`);
}
console.log(`\n  Final copy would omit: "${bad.text}"\n`);
process.exit(failures ? 1 : 0);
