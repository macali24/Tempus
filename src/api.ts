import type { CmsUtilization, Provider, ProviderPhoto, ProviderPoint, Publication, Study } from './types';

// NPPES does not emit browser CORS headers. Vite proxies this path in development.
const NPI_API = '/api/npi';
const CTG_API = 'https://clinicaltrials.gov/api/v2/studies';
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';
const CMS_PROVIDER_DATASET = '4d0b2df0-1e99-4db7-a574-a571d99217f1';

export async function fetchProviders(city: string, state: string): Promise<Provider[]> {
  const q = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-1', taxonomy_description: 'Hematology & Oncology', city, state, country_code: 'US', limit: '20' });
  const response = await fetch(`${NPI_API}?${q}`);
  if (!response.ok) throw new Error(`NPI Registry returned ${response.status}`);
  const data = await response.json();
  const results: Provider[] = data.results ?? [];
  const exactMarket = results.filter(provider => {
    const location = provider.addresses.find(address => address.address_purpose === 'LOCATION') ?? provider.addresses[0];
    return provider.basic.status === 'A' && location?.city?.toLowerCase() === city.trim().toLowerCase() && location?.state === state;
  });
  if (!exactMarket.length) throw new Error('No active oncology providers with an exact practice-location match were found. Try a nearby city.');
  return exactMarket;
}

export async function fetchTrials(city: string, state: string): Promise<Study[]> {
  const term = `AREA[OverallStatus]RECRUITING AND AREA[ConditionSearch]cancer AND AREA[LocationCity]\"${city}\" AND AREA[LocationState]\"${state}\"`;
  const q = new URLSearchParams({ 'query.term': term, pageSize: '40', format: 'json', fields: 'NCTId,BriefTitle,OverallStatus,Condition,LocationFacility,LocationCity,LocationState' });
  const response = await fetch(`${CTG_API}?${q}`);
  if (!response.ok) throw new Error(`ClinicalTrials.gov returned ${response.status}`);
  return (await response.json()).studies ?? [];
}

export async function fetchUtilization(providers: Provider[]): Promise<Record<string, CmsUtilization>> {
  const records = await Promise.all(providers.map(async provider => {
    try {
      const q = new URLSearchParams({ 'filter[Rndrng_NPI]':provider.number, size:'1' });
      const response = await fetch(`https://data.cms.gov/data-api/v1/dataset/${CMS_PROVIDER_DATASET}/data?${q}`);
      if (!response.ok) return null;
      const row = (await response.json())?.[0]; if (!row) return null;
      return [provider.number, { beneficiaries:Number(row.Tot_Benes)||0, services:Number(row.Tot_Srvcs)||0, hcpcsCodes:Number(row.Tot_HCPCS_Cds)||0, medicarePayment:Number(row.Tot_Mdcr_Pymt_Amt)||0, year:2024, sourceUrl:'https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-provider' }] as const;
    } catch { return null; }
  }));
  const utilization: Record<string,CmsUtilization> = {};
  records.forEach(record => { if(record) utilization[record[0]] = record[1]; });
  return utilization;
}

export async function fetchPublications(provider: Provider): Promise<Publication[]> {
  const location=provider.addresses.find(item=>item.address_purpose==='LOCATION')??provider.addresses[0];
  const author = `"${provider.basic.last_name ?? ''} ${provider.basic.first_name ?? ''}"[Full Author Name]`;
  const q = new URLSearchParams({ db:'pubmed', term:`${author} AND ${location?.city??''}[Affiliation] AND (oncology OR cancer)`, retmode:'json', retmax:'3', sort:'date', tool:'tempus_sales_copilot', email:'prototype@example.com' });
  const search = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${q}`); if(!search.ok)return [];
  const ids:string[]=(await search.json()).esearchresult?.idlist??[]; if(!ids.length)return [];
  const summary = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json&tool=tempus_sales_copilot&email=prototype@example.com`); if(!summary.ok)return [];
  const data=await summary.json(); return ids.map(id=>({pmid:id,title:data.result?.[id]?.title??'Untitled publication',date:data.result?.[id]?.pubdate,sourceUrl:`https://pubmed.ncbi.nlm.nih.gov/${id}/`}));
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
  const audited: Record<string, ProviderPhoto> = {
    '1265689889': {
      url: 'https://edge.sitecorecloud.io/unichicagomc-81nbqnb3/media/images/ucmc/physician-photos/a-c/amin-manik-bio-261x347.jpg',
      sourceUrl: 'https://www.uchicagomedicine.org/find-a-physician/physician/manik-amin',
    },
    '1588184956': {
      url: 'https://www.nm.org/image/doctor/NPI/1588184956.jpg',
      sourceUrl: 'https://www.cancer.northwestern.edu/find-a-physician/profile.html?xid=64440',
    },
    '1033548383': {
      url: 'https://www.nm.org/image/doctor/NPI/1033548383.jpg',
      sourceUrl: 'https://www.nm.org/doctors/1033548383/yasmin-abaza-md',
    },
  };
  const providerNpis = new Set(providers.map(provider => provider.number));
  const photos: Record<string, ProviderPhoto> = Object.fromEntries(Object.entries(audited).filter(([npi]) => providerNpis.has(npi)));
  const npis = providers.slice(0, 10).map(provider => `"${provider.number}"`).join(' ');
  if (!npis) return photos;
  const sparql = `SELECT ?npi ?item ?image WHERE { VALUES ?npi { ${npis} } ?item wdt:P9450 ?npi; wdt:P18 ?image. }`;
  try {
    const query = new URLSearchParams({ query: sparql, format: 'json' });
    const response = await fetch(`https://query.wikidata.org/sparql?${query}`, { headers: { Accept: 'application/sparql-results+json' } });
    if (!response.ok) return photos;
    const bindings = (await response.json()).results?.bindings ?? [];
    bindings.forEach((binding: { npi?: { value?: string }; item?: { value?: string }; image?: { value?: string } }) => {
      const npi = binding.npi?.value; const image = binding.image?.value; const item = binding.item?.value;
      if (npi && image && item && !photos[npi]) photos[npi] = { url: image, sourceUrl: item };
    });
  } catch { return photos; }
  return photos;
}
