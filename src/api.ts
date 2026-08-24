import type { Provider, ProviderPhoto, ProviderPoint, Study } from './types';

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
  const coordinateCache = new Map<string, Promise<[number, number] | null>>();
  const points = await Promise.all(providers.slice(0, 10).map(async provider => {
    const a = provider.addresses.find(x => x.address_purpose === 'LOCATION') ?? provider.addresses[0];
    if (!a) return null;
    const key = `${a.address_1}|${a.city}|${a.state}|${a.postal_code}`;
    const [street, city, state, postal] = key.split('|');
    if (!coordinateCache.has(key)) coordinateCache.set(key, (async () => {
      const q = new URLSearchParams({ q: `${street}, ${city}, ${state} ${postal}`, country: 'US', limit: '1', access_token: MAPBOX_TOKEN });
      try { const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${q}`); if (!response.ok) return null; return (await response.json()).features?.[0]?.geometry?.coordinates ?? null; }
      catch { return null; }
    })());
    const coordinates = await coordinateCache.get(key)!;
    return coordinates ? { npi: provider.number, longitude: coordinates[0], latitude: coordinates[1] } : null;
  }));
  return points.filter((point): point is ProviderPoint => Boolean(point));
}

export async function fetchVerifiedPhotos(providers: Provider[]): Promise<Record<string, ProviderPhoto>> {
  const entries = await Promise.all(providers.slice(0, 10).map(async provider => {
    const fullName = `${provider.basic.first_name ?? ''} ${provider.basic.last_name ?? ''}`.trim();
    if (!fullName) return null;
    try {
      const response = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(`${fullName} oncologist`)}&limit=5`);
      if (!response.ok) return null;
      const pages = (await response.json()).pages ?? [];
      const exact = pages.find((page: { title?: string; description?: string; thumbnail?: { url?: string } }) =>
        page.title?.replaceAll('_',' ').toLowerCase() === fullName.toLowerCase() &&
        /oncolog|physician|doctor|medical|cancer/i.test(page.description ?? '') && page.thumbnail?.url);
      if (!exact) return null;
      const url = exact.thumbnail.url.startsWith('//') ? `https:${exact.thumbnail.url}` : exact.thumbnail.url;
      return [provider.number, { url: url.replace(/\/\d+px-/, '/240px-'), sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(exact.title)}` }] as const;
    } catch { return null; }
  }));
  const photos: Record<string, ProviderPhoto> = {};
  entries.forEach(entry => { if (entry) photos[entry[0]] = entry[1]; });
  return photos;
}
