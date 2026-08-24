import type { Provider, ProviderPoint, Study } from './types';

// NPPES does not emit browser CORS headers. Vite proxies this path in development.
const NPI_API = '/api/npi';
const CTG_API = 'https://clinicaltrials.gov/api/v2/studies';
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

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

export async function geocodeProviders(providers: Provider[]): Promise<ProviderPoint[]> {
  const unique = new Map<string, Provider>();
  providers.slice(0, 10).forEach(p => {
    const a = p.addresses.find(x => x.address_purpose === 'LOCATION') ?? p.addresses[0];
    if (a) unique.set(`${a.address_1}|${a.city}|${a.state}|${a.postal_code}`, p);
  });
  const points = await Promise.all([...unique.entries()].map(async ([key, provider]) => {
    const [street, city, state, postal] = key.split('|');
    const q = new URLSearchParams({ q: `${street}, ${city}, ${state} ${postal}`, country: 'US', limit: '1', access_token: MAPBOX_TOKEN });
    try {
      const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${q}`);
      if (!response.ok) return null;
      const feature = (await response.json()).features?.[0];
      const coordinates = feature?.geometry?.coordinates;
      return coordinates ? { npi: provider.number, longitude: coordinates[0], latitude: coordinates[1] } : null;
    } catch { return null; }
  }));
  return points.filter((point): point is ProviderPoint => Boolean(point));
}
