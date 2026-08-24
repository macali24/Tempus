import type { CmsUtilization, Provider, ProviderPoint, Publication, Study } from './types';
import { fetchWithRetry, mapSettledWithConcurrency, type BulkLookup } from './lib/fetching';

// NPPES does not emit browser CORS headers. Vite proxies this path in development.
const NPI_API = '/api/npi';
const CTG_API = 'https://clinicaltrials.gov/api/v2/studies';
// Guarded so the module can also be imported by Node scripts (eval, smoke test).
export const MAPBOX_TOKEN: string = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN) || '';
const CMS_PROVIDER_DATASET = '4d0b2df0-1e99-4db7-a574-a571d99217f1';

/**
 * NPPES matches `taxonomy_description` exactly against one NUCC taxonomy, so a
 * single-taxonomy query is a specialty filter, not a category. Querying only
 * "Hematology & Oncology" reached 258 of Chicago's 608 oncology-relevant
 * individuals, and skewed the ones it did reach toward haematology: the
 * population xT CDx's solid-tumour intended use fits *least*, while excluding
 * the medical and gynaecologic oncologists it fits best.
 *
 * These are the taxonomies whose holders order comprehensive genomic profiling.
 * A physician registers several taxonomies and NPPES searches all of them, so
 * the same NPI returns under more than one query and is deduplicated on NPI.
 */
export const ORDERING_TAXONOMIES = [
  'Hematology & Oncology',
  'Medical Oncology',
  'Gynecologic Oncology',
  'Surgical Oncology',
] as const;

/**
 * Excluded deliberately. A silent exclusion is indistinguishable from a bug, so
 * each carries the reason it is out and the UI can state it.
 */
export const EXCLUDED_TAXONOMIES: Array<{ taxonomy: string; reason: string }> = [
  {
    taxonomy: 'Radiation Oncology',
    reason: 'Treats with radiation and is rarely the ordering physician for comprehensive genomic profiling.',
  },
  {
    taxonomy: 'Pediatric Hematology-Oncology',
    reason: 'PMA P210011 states no paediatric validation for xT CDx, so there is no labelled indication for this population.',
  },
];

// NPPES caps `limit` at 200 and `skip` at 1000.
const NPPES_PAGE = 200;
const NPPES_MAX_SKIP = 1000;

/** One taxonomy, paged to exhaustion. */
async function fetchByTaxonomy(taxonomy: string, city: string, state: string, signal?: AbortSignal): Promise<Provider[]> {
  const collected: Provider[] = [];
  for (let skip = 0; skip <= NPPES_MAX_SKIP; skip += NPPES_PAGE) {
    const q = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-1', taxonomy_description: taxonomy, city, state, country_code: 'US', limit: String(NPPES_PAGE), skip: String(skip) });
    const response = await fetchWithRetry(`${NPI_API}?${q}`, {}, { signal, timeoutMs: 12_000 });
    if (!response.ok) throw new Error(`NPI Registry returned ${response.status}`);
    const page: Provider[] = (await response.json()).results ?? [];
    collected.push(...page);
    if (page.length < NPPES_PAGE) break;
  }
  return collected;
}

/**
 * `providers` is the market; `total` is its true size.
 *
 * These are the same quantity here, and the pair exists so they cannot drift:
 * the previous query took `limit=20` and returned whatever alphabetical head
 * NPPES happened to emit, which made "the territory" a page size, the same
 * class of error as reporting a trial page as a trial count.
 */
export type ProviderResult = { providers: Provider[]; total: number };

export async function fetchProviders(city: string, state: string, signal?: AbortSignal): Promise<ProviderResult> {
  const pages = await Promise.allSettled(ORDERING_TAXONOMIES.map(taxonomy => fetchByTaxonomy(taxonomy, city, state, signal)));
  const reached = pages.filter((page): page is PromiseFulfilledResult<Provider[]> => page.status === 'fulfilled');
  // Every taxonomy failing means NPPES is unreachable, and the caller falls back
  // to the ingested CSV. A partial failure narrows the territory by one
  // specialty rather than emptying it.
  if (!reached.length) throw new Error(`NPI Registry unreachable for ${ORDERING_TAXONOMIES.length} taxonomy queries.`);

  const byNpi = new Map<string, Provider>();
  reached.forEach(page => page.value.forEach(provider => {
    const location = provider.addresses.find(address => address.address_purpose === 'LOCATION') ?? provider.addresses[0];
    const exactMarket = provider.basic.status === 'A'
      && location?.city?.toLowerCase() === city.trim().toLowerCase()
      && location?.state === state;
    if (exactMarket) byNpi.set(provider.number, provider);
  }));

  if (!byNpi.size) throw new Error('No active oncology providers with an exact practice-location match were found. Try a nearby city.');

  // Deterministic order, so the same market always yields the same list. Rank
  // order is applied downstream and does not depend on this.
  const providers = [...byNpi.values()].sort((a, b) => a.number.localeCompare(b.number));
  return { providers, total: providers.length };
}

export type TrialResult = { studies: Study[]; total: number };

/**
 * `studies` contains every page needed for provider/site matching, while
 * `total` preserves ClinicalTrials.gov's market count. A failed middle page
 * rejects the source instead of presenting a partial list as complete.
 */
export async function fetchTrials(city: string, state: string, signal?: AbortSignal): Promise<TrialResult> {
  const term = `AREA[OverallStatus]RECRUITING AND AREA[ConditionSearch]cancer AND AREA[LocationCity]\"${city}\" AND AREA[LocationState]\"${state}\"`;
  const studies = new Map<string, Study>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  let total = 0;

  do {
    const q = new URLSearchParams({
      'query.term': term,
      pageSize: '100',
      format: 'json',
      countTotal: 'true',
      fields: 'NCTId,BriefTitle,OverallStatus,Condition,LocationFacility,LocationCity,LocationState,LocationZip',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const response = await fetchWithRetry(`${CTG_API}?${q}`, {}, { signal, timeoutMs: 15_000 });
    if (!response.ok) throw new Error(`ClinicalTrials.gov returned ${response.status}`);
    const data = await response.json();
    const page: Study[] = data.studies ?? [];
    page.forEach(study => studies.set(study.protocolSection.identificationModule.nctId, study));
    total = Math.max(total, Number(data.totalCount) || 0);

    const next = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
    if (next && seenTokens.has(next)) throw new Error('ClinicalTrials.gov repeated a page token.');
    if (next) seenTokens.add(next);
    pageToken = next;
  } while (pageToken);

  return { studies: [...studies.values()], total: total || studies.size };
}

export async function fetchUtilization(providers: Provider[], signal?: AbortSignal): Promise<BulkLookup<CmsUtilization>> {
  const unique = [...new Map(providers.map(provider => [provider.number, provider])).values()];
  const records = await mapSettledWithConcurrency(unique, 6, async provider => {
    try {
      const q = new URLSearchParams({ 'filter[Rndrng_NPI]':provider.number, size:'1' });
      const response = await fetchWithRetry(
        `https://data.cms.gov/data-api/v1/dataset/${CMS_PROVIDER_DATASET}/data?${q}`,
        {},
        { signal, timeoutMs: 10_000 },
      );
      if (!response.ok) throw new Error(`CMS utilization returned ${response.status}`);
      const row = (await response.json())?.[0]; if (!row) return null;
      return [provider.number, { beneficiaries:Number(row.Tot_Benes)||0, services:Number(row.Tot_Srvcs)||0, hcpcsCodes:Number(row.Tot_HCPCS_Cds)||0, medicarePayment:Number(row.Tot_Mdcr_Pymt_Amt)||0, year:2024, city:row.Rndrng_Prvdr_City, state:row.Rndrng_Prvdr_State_Abrvtn, specialty:row.Rndrng_Prvdr_Type, sourceUrl:'https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-provider' }] as const;
    } catch (error) {
      if (signal?.aborted) throw error;
      throw error;
    }
  }, signal);
  const utilization: Record<string,CmsUtilization> = {};
  const status: BulkLookup<CmsUtilization>['status'] = {};
  records.forEach((result, index) => {
    const npi = unique[index].number;
    if (result.status === 'rejected') {
      status[npi] = 'error';
    } else if (result.value) {
      utilization[result.value[0]] = result.value[1];
      status[npi] = 'found';
    } else {
      status[npi] = 'empty';
    }
  });
  return { records: utilization, status };
}

export async function fetchPublications(provider: Provider, signal?: AbortSignal): Promise<Publication[]> {
  const location=provider.addresses.find(item=>item.address_purpose==='LOCATION')??provider.addresses[0];
  const author = `"${provider.basic.last_name ?? ''} ${provider.basic.first_name ?? ''}"[Full Author Name]`;
  const q = new URLSearchParams({ db:'pubmed', term:`${author} AND ${location?.city??''}[Affiliation] AND (oncology OR cancer)`, retmode:'json', retmax:'3', sort:'date', tool:'tempus_sales_copilot', email:'prototype@example.com' });
  const search = await fetchWithRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${q}`, {}, { signal, timeoutMs: 10_000 }); if(!search.ok)return [];
  const ids:string[]=(await search.json()).esearchresult?.idlist??[]; if(!ids.length)return [];
  const summary = await fetchWithRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json&tool=tempus_sales_copilot&email=prototype@example.com`, {}, { signal, timeoutMs: 10_000 }); if(!summary.ok)return [];
  const data=await summary.json();
  // Affiliation is not exposed by esummary, so efetch supplies it. It is the only
  // field that lets us cross-check PubMed against the NPPES practice location,
  // which is how an institution change gets detected.
  const affiliations = await fetchAffiliations(ids, signal);
  return ids.map(id=>({pmid:id,title:data.result?.[id]?.title??'Untitled publication',date:data.result?.[id]?.pubdate,sourceUrl:`https://pubmed.ncbi.nlm.nih.gov/${id}/`,affiliation:affiliations[id]}));
}

async function fetchAffiliations(ids: string[], signal?: AbortSignal): Promise<Record<string,string>> {
  try {
    const response = await fetchWithRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml&tool=tempus_sales_copilot&email=prototype@example.com`, {}, { signal, timeoutMs: 10_000 });
    if (!response.ok) return {};
    const xml = await response.text();
    const out: Record<string,string> = {};
    // One <PubmedArticle> per id, returned in request order.
    xml.split('<PubmedArticle>').slice(1).forEach((article, index) => {
      const id = ids[index];
      const affiliation = article.match(/<Affiliation>([\s\S]*?)<\/Affiliation>/)?.[1];
      if (id && affiliation) out[id] = affiliation.replace(/<[^>]+>/g, '').trim();
    });
    return out;
  } catch (error) {
    if (signal?.aborted) throw error;
    return {};
  }
}

export async function sendSlackAlert(payload:{provider:string;npi:string;rank:number;score:number;reason:string;profileUrl:string}){
  const response=await fetch('/api/slack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error??`Slack returned ${response.status}`);return data;
}

export async function geocodeProviders(providers: Provider[], signal?: AbortSignal): Promise<ProviderPoint[]> {
  if (!MAPBOX_TOKEN) return [];

  // Geocode the bounded working territory, not an arbitrary first page. The
  // previous slice(0, 10) meant most ranked rows could never move the map. A
  // site is requested once and its coordinate is then attached to every
  // physician who practises there.
  const providersByAddress = new Map<string, Provider[]>();
  for (const provider of providers) {
    const location = provider.addresses.find(x => x.address_purpose === 'LOCATION') ?? provider.addresses[0];
    if (!location) continue;
    const key = [location.address_1, location.city, location.state, location.postal_code].join('|');
    providersByAddress.set(key, [...(providersByAddress.get(key) ?? []), provider]);
  }

  const addresses = [...providersByAddress.keys()];
  const coordinates = new Map<string, [number, number]>();
  let cursor = 0;

  // A small worker pool keeps a 60-provider territory from turning into a
  // burst of simultaneous geocoder calls while still resolving promptly.
  async function worker() {
    while (cursor < addresses.length) {
      if (signal?.aborted) throw signal.reason;
      const key = addresses[cursor++];
      const [street, city, state, postal] = key.split('|');
      const q = new URLSearchParams({
        q: `${street}, ${city}, ${state} ${postal}`,
        country: 'US',
        limit: '1',
        access_token: MAPBOX_TOKEN,
      });
      try {
        const response = await fetchWithRetry(`https://api.mapbox.com/search/geocode/v6/forward?${q}`, {}, { signal, timeoutMs: 10_000 });
        if (!response.ok) continue;
        const point = (await response.json()).features?.[0]?.geometry?.coordinates;
        if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
          coordinates.set(key, [point[0], point[1]]);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        // One bad address is an unmapped row, not a failed territory.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(6, addresses.length) }, () => worker()));

  return addresses.flatMap(key => {
    const point = coordinates.get(key);
    if (!point) return [];
    return (providersByAddress.get(key) ?? []).map(provider => ({
      npi: provider.number,
      longitude: point[0],
      latitude: point[1],
    }));
  });
}
