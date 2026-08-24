import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { BookOpen, Check, ChevronDown, CircleAlert, ExternalLink, FileWarning, LocateFixed, MapPin, RotateCcw, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { fetchProviders, fetchPublications, fetchTrials, fetchUtilization, fetchVerifiedPhotos, geocodeProviders, MAPBOX_TOKEN } from './api';
import { retrieveEvidence, simulatedCrm } from './data';
import type { CmsUtilization, Provider, ProviderPhoto, ProviderPoint, Publication, RankedProvider, Study } from './types';

const TEMPUS_SOURCE = 'https://www.tempus.com/solutions/xt-cdx/';
const NPI_SOURCE = 'https://npiregistry.cms.hhs.gov/';
const states: Record<string,string> = { IL:'Illinois', NY:'New York', CA:'California', TX:'Texas', MA:'Massachusetts', FL:'Florida', PA:'Pennsylvania', WA:'Washington' };
const name = (p: Provider) => `${p.basic.first_name ?? ''} ${p.basic.last_name ?? ''}${p.basic.credential ? `, ${p.basic.credential}` : ''}`.trim();
const address = (p: Provider) => p.addresses.find(a => a.address_purpose === 'LOCATION') ?? p.addresses[0];

function rank(p: Provider, trials: Study[], utilization: Record<string,CmsUtilization>, maxBeneficiaries: number): RankedProvider {
  const local = trials.filter(t => t.protocolSection.contactsLocationsModule?.locations?.some(l => l.city?.toLowerCase() === address(p)?.city?.toLowerCase()));
  const exactFit = p.taxonomies.some(t => /oncology/i.test(t.desc)) ? 100 : 40;
  const trialSignal = Math.min(100, local.length * 8);
  const updated = p.basic.last_updated ? new Date(p.basic.last_updated).getTime() : 0;
  const recency = Math.max(10, Math.round(100 - (updated ? (Date.now() - updated) / 2629800000 : 120) * 1.5));
  const cms=utilization[p.number]; const opportunity=cms&&maxBeneficiaries?Math.round(Math.log1p(cms.beneficiaries)/Math.log1p(maxBeneficiaries)*100):0;
  const crm=simulatedCrm[p.number]; const engagement=crm?.engagement??0; const confidence=(cms?45:0)+(trials.length?25:0)+(p.basic.status==='A'?15:0)+(p.basic.last_updated?15:0);
  const score=Math.round(opportunity*.40+trialSignal*.15+engagement*.15+recency*.15+confidence*.15);
  return { ...p, score, opportunity, exactFit, trialSignal, engagement, recency, confidence, cityTrials:local, utilization:cms, crm };
}

export function App() {
  const [city,setCity] = useState('Chicago'); const [state,setState] = useState('IL');
  const [query,setQuery] = useState({city:'Chicago',state:'IL'}); const [providers,setProviders] = useState<Provider[]>([]);
  const [trials,setTrials] = useState<Study[]>([]); const [points,setPoints] = useState<ProviderPoint[]>([]);
  const [utilization,setUtilization] = useState<Record<string,CmsUtilization>>({});
  const [photos,setPhotos] = useState<Record<string,ProviderPhoto>>({});
  const [profileOpen,setProfileOpen] = useState(false);
  const [methodOpen,setMethodOpen] = useState(false);
  const [selectedNpi,setSelectedNpi] = useState(''); const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const ranked = useMemo(() => {const max=Math.max(...Object.values(utilization).map(item=>item.beneficiaries),1);return providers.map(p=>rank(p,trials,utilization,max)).sort((a,b)=>b.score-a.score)},[providers,trials,utilization]);
  const selected = ranked.find(p=>p.number===selectedNpi) ?? ranked[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  async function load(){
    setLoading(true); setError(''); setPoints([]); setPhotos({}); setUtilization({});
    try {
      const p = await fetchProviders(query.city,query.state);
      setProviders(p); setSelectedNpi(''); setLoading(false);
      const [trialResult, pointResult, photoResult, utilizationResult] = await Promise.allSettled([fetchTrials(query.city,query.state), geocodeProviders(p), fetchVerifiedPhotos(p), fetchUtilization(p)]);
      setTrials(trialResult.status==='fulfilled'?trialResult.value:[]);
      setPoints(pointResult.status==='fulfilled'?pointResult.value:[]);
      setPhotos(photoResult.status==='fulfilled'?photoResult.value:{});
      setUtilization(utilizationResult.status==='fulfilled'?utilizationResult.value:{});
    } catch(e){setProviders([]);setTrials([]);setError(e instanceof Error?e.message:'Public data unavailable.');setLoading(false)}
  }
  useEffect(()=>{load()},[query]);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setProfileOpen(false);setMethodOpen(false)}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
  const chooseProvider=(npi:string)=>{setSelectedNpi(npi);setMethodOpen(false);setProfileOpen(true)};
  return <div className="shell">
    <header className="topbar"><div className="logo"><img src="/tempus-mark.png" alt="Tempus"/><span>tempus</span></div><button className="method-button" onClick={()=>{setProfileOpen(false);setMethodOpen(true)}}><ShieldCheck/> Evidence & assumptions</button><div className="account"><span>John Doe<small>Territory manager</small></span><div className="user">JD</div></div></header>
    <main>
      <section className="hero"><div><h1>{greeting}, John.</h1><p>{loading ? `Loading ${query.city} territory…` : <><strong>{ranked.length}</strong> oncology providers · <strong>{trials.length}</strong> recruiting trials · top priority <strong>{ranked[0]?.score ?? 0}/100</strong></>}</p></div>
        <form className="search" onSubmit={e=>{e.preventDefault();setProfileOpen(false);setMethodOpen(false);setQuery({city:city.trim(),state})}}><Search/><input aria-label="City" value={city} onChange={e=>setCity(e.target.value)} /><div><select aria-label="State" value={state} onChange={e=>setState(e.target.value)}>{Object.entries(states).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select><ChevronDown/></div><button>Search market</button></form>
      </section>
      {error ? <div className="error"><CircleAlert/><div><b>Couldn’t load this market</b><span>{error}</span></div><button onClick={load}>Try again</button></div> : <>
        <section className="workspace">
          <div className="map-wrap"><TerritoryMap points={points} providers={ranked} selectedNpi={selectedNpi} onSelect={chooseProvider}/>{loading&&<div className="map-loading"><span/><b>Building your territory view…</b><small>Matching real provider addresses</small></div>}<div className="map-label"><MapPin/> {query.city}, {query.state}<span>{points.length} locations</span></div></div>
          <aside className="rank-panel"><div className="panel-title"><div><span>Priority list</span><h2>Who to call next</h2></div><b>{ranked.length}</b></div><div className="list">{loading?[1,2,3,4].map(i=><div className="row skeleton" key={i}/>):ranked.slice(0,6).map((p,i)=><button key={p.number} className={`row ${selectedNpi===p.number?'active':''}`} onClick={()=>chooseProvider(p.number)}><span className="number">{i+1}</span><ProviderAvatar provider={p} photo={photos[p.number]}/><span className="person"><b>{name(p)}</b><small>{p.taxonomies.find(t=>t.primary)?.desc??'Oncology'} · {address(p)?.city}</small></span><span className="signal">{p.score}<small>signal</small></span></button>)}</div></aside>
        </section>
        {selected&&<Brief provider={selected} photo={photos[selected.number]}/>}
      </>}
      <footer><ShieldCheck/> Source records are never synthesized <span>Decision support only · Not for clinical use</span></footer>
    </main>
    {profileOpen&&selected&&<ProviderDrawer provider={selected} photo={photos[selected.number]} onClose={()=>setProfileOpen(false)}/>}
    {methodOpen&&<MethodologyDrawer onClose={()=>setMethodOpen(false)}/>}
  </div>
}

function MethodologyDrawer({onClose}:{onClose:()=>void}){return <div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="provider-drawer methodology" role="dialog" aria-modal="true" aria-label="Evidence and assumptions"><button className="drawer-close" onClick={onClose}><X/></button><div className="drawer-hero"><span>Model card</span><h2>Evidence & assumptions</h2><p>What the prototype knows, estimates, and refuses to claim.</p></div><section className="drawer-section"><span>Ranking model</span><h3>Explainable weighted baseline</h3><p>40% CMS opportunity · 15% local trial activity · 15% simulated engagement · 15% NPI freshness · 15% evidence confidence.</p><small>Deterministic by design. A learned ranker requires real conversion outcomes and belongs in Phase 2.</small></section><section className="drawer-section evidence-grid"><span>Data contract</span><div><b>REAL</b><p>NPPES identity, CMS 2024 Medicare utilization, ClinicalTrials.gov studies, PubMed publications, official Tempus claims.</p></div><div className="sim"><b>SIMULATED</b><p>Eight CRM notes: objection, interest, last contact and engagement. Every use is visibly labeled.</p></div></section><section className="drawer-section"><span>Automated guardrails</span><ul><li><Check/> Exact active NPI practice-city match</li><li><Check/> CMS volume labeled as Original Medicare only</li><li><Check/> Full-name + affiliation publication matching</li><li><Check/> NPI-linked or audited official photos only</li><li><Check/> Unsupported objection returns insufficient evidence</li><li><Check/> Missing CRM earns zero engagement points</li></ul></section><section className="drawer-section"><span>Known limitations</span><p>CMS data is annual, excludes Medicare Advantage and commercial populations, and suppresses small counts. City-level trials do not prove physician participation. NPPES does not validate licensure. No score represents clinical quality or treatment suitability.</p></section></aside></div>}

function TerritoryMap({points,providers,selectedNpi,onSelect}:{points:ProviderPoint[];providers:RankedProvider[];selectedNpi?:string;onSelect:(npi:string)=>void}){
  const node=useRef<HTMLDivElement>(null); const map=useRef<mapboxgl.Map|null>(null); const markers=useRef<Map<string,mapboxgl.Marker>>(new Map());
  const fitTerritory=()=>{if(!map.current||!points.length)return;const bounds=new mapboxgl.LngLatBounds();points.forEach(p=>bounds.extend([p.longitude,p.latitude]));map.current.fitBounds(bounds,{padding:80,maxZoom:10.5,pitch:0,bearing:0,duration:900})};
  useEffect(()=>{if(!node.current||map.current)return; mapboxgl.accessToken=MAPBOX_TOKEN;map.current=new mapboxgl.Map({container:node.current,style:'mapbox://styles/mapbox/standard',config:{basemap:{theme:'default',lightPreset:'dawn',show3dObjects:false,showPointOfInterestLabels:true}},center:[-87.6298,41.8781],zoom:10.2,pitch:0,bearing:0,dragRotate:false,pitchWithRotate:false,attributionControl:false});map.current.touchZoomRotate.disableRotation();map.current.addControl(new mapboxgl.NavigationControl({showCompass:false,visualizePitch:false}),'bottom-right');map.current.addControl(new mapboxgl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true}),'bottom-right');map.current.addControl(new mapboxgl.FullscreenControl(),'bottom-right');return()=>{map.current?.remove();map.current=null}},[]);
  useEffect(()=>{if(!map.current||!points.length)return;markers.current.forEach(m=>m.remove());markers.current.clear();const duplicates=new Map<string,number>();points.forEach(point=>{const key=`${point.longitude},${point.latitude}`;const offset=duplicates.get(key)??0;duplicates.set(key,offset+1);const angle=offset*2.4;const radius=offset?0.00035*Math.ceil(offset/2):0;const coords:[number,number]=[point.longitude+Math.cos(angle)*radius,point.latitude+Math.sin(angle)*radius];const p=providers.find(x=>x.number===point.npi);const el=document.createElement('button');el.className='map-marker';el.innerHTML=`<span>${p?.score??''}</span>`;el.setAttribute('aria-label',p?name(p):'Provider');el.onclick=()=>onSelect(point.npi);const marker=new mapboxgl.Marker({element:el}).setLngLat(coords).addTo(map.current!);markers.current.set(point.npi,marker)});fitTerritory()},[points,providers,onSelect]);
  useEffect(()=>{markers.current.forEach((marker,npi)=>marker.getElement().classList.toggle('active',npi===selectedNpi));if(!selectedNpi||!map.current)return;const marker=markers.current.get(selectedNpi);if(!marker)return;map.current.flyTo({center:marker.getLngLat(),zoom:12.8,pitch:0,bearing:0,duration:850,essential:true})},[selectedNpi]);
  return <div className="map-frame"><div ref={node} className="map"/><div className="map-tools"><button onClick={fitTerritory} title="Show all providers"><RotateCcw/> Reset view</button><button onClick={()=>map.current?.getContainer().querySelector<HTMLButtonElement>('.mapboxgl-ctrl-geolocate')?.click()} title="Find my location"><LocateFixed/> Near me</button></div></div>;
}

function ProviderAvatar({provider,photo}:{provider:Provider;photo?:ProviderPhoto}){return photo?<span className="doctor-photo" title="NPI-matched official public photo"><img src={photo.url} alt={name(provider)}/></span>:<span className="doctor-photo fallback" title="No identity-verified public photo found">{provider.basic.first_name?.[0]}{provider.basic.last_name?.[0]}</span>}

function objectionResponse(p: RankedProvider){
  if(!p.crm)return { text:'No CRM concern is available. Add a real note before generating an objection response.', evidence:[] };
  const evidence=retrieveEvidence(`${p.crm.objection} ${p.crm.interest}`);
  if(!evidence.length)return { text:`Insufficient evidence: the Tempus knowledge base does not contain a supported metric for “${p.crm.objection}.” Ask a discovery question and follow up with an approved source rather than guessing.`, evidence:[] };
  return { text:`Acknowledge the concern directly: “That is a fair question about ${p.crm.objection}. The approved evidence says: ${evidence[0].claim} I would first confirm whether that capability addresses your workflow before discussing next steps.”`, evidence };
}

function meetingScript(p: RankedProvider){const evidence=retrieveEvidence(p.crm?.interest??'clinical utility')[0];const signal=p.utilization?`${p.utilization.beneficiaries} Original Medicare beneficiaries and ${Math.round(p.utilization.services)} services reported in CMS’s ${p.utilization.year} data`:`an active oncology practice record`;return `“Dr. ${p.basic.last_name}, public data shows ${signal}, alongside ${p.cityTrials.length} recruiting cancer ${p.cityTrials.length===1?'trial':'trials'} in this market. ${evidence?.claim??'I would like to understand where comprehensive genomic profiling fits your current workflow.'} Given your interest in ${p.crm?.interest??'oncology care'}, could we spend 15 minutes identifying where the evidence is relevant—and where it is not?”`}

function ProviderDrawer({provider:p,photo,onClose}:{provider:RankedProvider;photo?:ProviderPhoto;onClose:()=>void}){
  const location=address(p); const specialty=p.taxonomies.find(t=>t.primary)?.desc??'Oncology';
  const [publications,setPublications]=useState<Publication[]>([]); const [pubLoading,setPubLoading]=useState(true); const response=objectionResponse(p);
  useEffect(()=>{let active=true;setPubLoading(true);fetchPublications(p).then(items=>{if(active)setPublications(items)}).catch(()=>{if(active)setPublications([])}).finally(()=>{if(active)setPubLoading(false)});return()=>{active=false}},[p.number]);
  return <div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="provider-drawer" role="dialog" aria-modal="true" aria-label={`${name(p)} public profile`}>
    <button className="drawer-close" onClick={onClose} aria-label="Close profile"><X/></button>
    <div className="drawer-hero"><ProviderAvatar provider={p} photo={photo}/><span>Public provider profile</span><h2>{name(p)}</h2><p>{specialty}</p>{photo&&<a href={photo.sourceUrl} target="_blank" rel="noreferrer">Verified photo source <ExternalLink/></a>}</div>
    <div className="drawer-metrics"><div><b>{p.score}</b><span>Priority score</span></div><div><b>{p.utilization?.beneficiaries??'—'}</b><span>Medicare beneficiaries</span></div><div><b>{p.cityTrials.length}</b><span>Recruiting trials</span></div></div>
    <section className="drawer-section"><span>Practice details</span><h3>{location?.address_1}</h3><p>{location?.city}, {location?.state} {location?.postal_code?.slice(0,5)}</p>{location?.telephone_number&&<a href={`tel:${location.telephone_number}`}>{location.telephone_number}</a>}</section>
    <section className="drawer-section"><span>Why this provider</span><p>{p.utilization?`CMS reported ${p.utilization.beneficiaries} Original Medicare beneficiaries, ${Math.round(p.utilization.services)} services, and ${p.utilization.hcpcsCodes} distinct HCPCS codes in ${p.utilization.year}. `:'CMS provider utilization was unavailable. '}{p.cityTrials.length} recruiting cancer {p.cityTrials.length===1?'trial is':'trials are'} active in the same city. These are opportunity proxies, not total patient volume.</p><div className="score-bars"><ScoreBar label="Opportunity" value={p.opportunity}/><ScoreBar label="Trial activity" value={p.trialSignal}/><ScoreBar label="Engagement" value={p.engagement}/><ScoreBar label="Freshness" value={p.recency}/><ScoreBar label="Confidence" value={p.confidence}/></div></section>
    <section className="drawer-section crm-card"><div className="section-label"><span>CRM context</span><b>SIMULATED</b></div>{p.crm?<><h3>{p.crm.objection}</h3><p>{p.crm.note}</p><small>Interest: {p.crm.interest} · Last contact: {p.crm.lastContact}</small></>:<p>No CRM note is available. This provider receives no engagement points.</p>}</section>
    <section className="drawer-section answer-card"><span>Objection handler</span><h3>{p.crm?`Concern: ${p.crm.objection}`:'Evidence-safe response'}</h3><p>{response.text}</p>{response.evidence.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.source} · accessed {item.accessed} <ExternalLink/></a>)}</section>
    <section className="drawer-section script-card"><span>30-second meeting script</span><blockquote>{meetingScript(p)}</blockquote><small><ShieldCheck/> Drafted only from displayed public evidence and labeled CRM context. Review before use.</small></section>
    <section className="drawer-section publications"><span>Recent research signal</span>{pubLoading?<p>Checking PubMed…</p>:publications.length?publications.map(item=><a key={item.pmid} href={item.sourceUrl} target="_blank" rel="noreferrer"><BookOpen/><span><b>{item.title}</b><small>PubMed · {item.date??'date unavailable'}</small></span><ExternalLink/></a>):<p><FileWarning/> No confidently matched PubMed results found. No publication signal was added.</p>}</section>
    <div className="drawer-sources"><div><ShieldCheck/><span><b>Evidence ledger</b><small>NPI updated {p.basic.last_updated??'date unavailable'} · public-data limitations apply</small></span></div><a href={`${NPI_SOURCE}provider-view/${p.number}`} target="_blank" rel="noreferrer">Open NPI record <ExternalLink/></a>{p.utilization&&<a href={p.utilization.sourceUrl} target="_blank" rel="noreferrer">Open CMS utilization source <ExternalLink/></a>}<a href="https://clinicaltrials.gov/" target="_blank" rel="noreferrer">Open trial source <ExternalLink/></a></div>
  </aside></div>
}

function ScoreBar({label,value}:{label:string;value:number}){return <div><span>{label}</span><i><b style={{width:`${value}%`}}/></i><strong>{value}</strong></div>}

function Brief({provider:p,photo}:{provider:RankedProvider;photo?:ProviderPhoto}){const trial=p.cityTrials[0]?.protocolSection.identificationModule.briefTitle;return <section className="brief"><div className="brief-profile"><ProviderAvatar provider={p} photo={photo}/><div><small>Recommended conversation</small><h2>{name(p)}</h2><p><MapPin/> {address(p)?.address_1}, {address(p)?.city}</p></div><div className="profile-links"><a href={`${NPI_SOURCE}provider-view/${p.number}`} target="_blank" rel="noreferrer">NPI record <ExternalLink/></a>{photo&&<a href={photo.sourceUrl} target="_blank" rel="noreferrer">Photo source <ExternalLink/></a>}</div></div><div className="brief-content"><article className="next-step"><span><Sparkles/> Suggested opener</span><p>“Dr. {p.basic.last_name}, I noticed {trial?`local recruitment for ${trial}`:`active oncology research in ${address(p)?.city}`}. Tempus xT CDx offers FDA-approved 648-gene tissue-based profiling for malignant solid tumors. Could we spend 15 minutes on where comprehensive profiling fits your workflow?”</p><small><ShieldCheck/> AI-drafted from cited facts · review before use</small></article><div className="quick-facts"><h3>Why now</h3><div><Check/><span><b>{p.cityTrials.length} recruiting cancer trials</b><small>Same-city ClinicalTrials.gov records</small></span></div><div><Check/><span><b>648-gene FDA-approved test</b><small>Official Tempus xT CDx product page</small></span></div><a href={TEMPUS_SOURCE} target="_blank" rel="noreferrer">View supporting evidence <ExternalLink/></a></div></div></section>}
