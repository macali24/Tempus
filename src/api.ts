import type { Provider, Study } from './types';

// NPPES does not emit browser CORS headers. Vite proxies this path in development.
const NPI_API = '/api/npi';
const CTG_API = 'https://clinicaltrials.gov/api/v2/studies';

export async function fetchProviders(city: string, state: string): Promise<Provider[]> {
  const q = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-1', taxonomy_description: 'Hematology & Oncology', city, state, country_code: 'US', limit: '20' });
  const response = await fetch(`${NPI_API}?${q}`);
  if (!response.ok) throw new Error(`NPI Registry returned ${response.status}`);
  const data = await response.json();
  if (!data.results?.length) throw new Error('No oncology providers found for this market. Try a nearby city.');
  return data.results;
}

export async function fetchTrials(city: string, state: string): Promise<Study[]> {
  const term = `AREA[OverallStatus]RECRUITING AND AREA[ConditionSearch]cancer AND AREA[LocationCity]\"${city}\" AND AREA[LocationState]\"${state}\"`;
  const q = new URLSearchParams({ 'query.term': term, pageSize: '40', format: 'json', fields: 'NCTId,BriefTitle,OverallStatus,Condition,LocationFacility,LocationCity,LocationState' });
  const response = await fetch(`${CTG_API}?${q}`);
  if (!response.ok) throw new Error(`ClinicalTrials.gov returned ${response.status}`);
  return (await response.json()).studies ?? [];
}
