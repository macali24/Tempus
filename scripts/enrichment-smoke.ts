/** Live, read-only coverage check against public federal APIs. No LLM calls. */
import { fetchProviders, fetchTrials, fetchUtilization, ORDERING_TAXONOMIES } from '../src/api';
import { fetchPaymentsForAll } from '../src/lib/openpayments';
import { selectTerritory } from '../src/lib/territory';

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('/api/npi')) {
    return realFetch(`https://npiregistry.cms.hhs.gov/api/${url.slice('/api/npi'.length)}`, init);
  }
  return realFetch(input, init);
}) as typeof fetch;

const market = await fetchProviders('Chicago', 'IL');
const territory = selectTerritory(market.providers);
const npis = territory.working.map(provider => provider.number);
const [trials, utilization, payments] = await Promise.all([
  fetchTrials('Chicago', 'IL'),
  fetchUtilization(territory.working),
  fetchPaymentsForAll(npis),
]);

const utilizationErrors = Object.values(utilization.status).filter(status => status === 'error').length;
const paymentErrors = Object.values(payments.status).filter(status => status === 'error').length;
const utilizationFound = Object.values(utilization.status).filter(status => status === 'found').length;
const paymentFound = Object.values(payments.status).filter(status => status === 'found').length;

console.log(`Market: ${market.total} providers across ${ORDERING_TAXONOMIES.length} taxonomies`);
console.log(`Working set: ${territory.working.length}`);
console.log(`CMS: ${Object.keys(utilization.status).length}/${npis.length} terminal · ${utilizationFound} rows · ${utilizationErrors} errors`);
console.log(`Open Payments: ${Object.keys(payments.status).length}/${npis.length} terminal · ${paymentFound} with records · ${paymentErrors} errors`);
console.log(`ClinicalTrials.gov: ${trials.studies.length}/${trials.total} studies fetched`);

if (npis.length !== 60) throw new Error(`Expected 60 working providers, received ${npis.length}.`);
if (Object.keys(utilization.status).length !== npis.length || utilizationErrors) {
  throw new Error('CMS utilization did not produce one non-error terminal status per provider.');
}
if (Object.keys(payments.status).length !== npis.length || paymentErrors) {
  throw new Error('Open Payments did not produce one non-error terminal status per provider.');
}
if (trials.studies.length !== trials.total) {
  throw new Error('ClinicalTrials.gov pagination did not fetch the advertised market total.');
}
