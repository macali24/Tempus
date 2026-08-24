import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Check, ChevronDown, CircleAlert, ExternalLink, MapPin, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { fetchProviders, fetchTrials, geocodeProviders, MAPBOX_TOKEN } from './api';
import type { Provider, ProviderPoint, RankedProvider, Study } from './types';

const TEMPUS_SOURCE = 'https://www.tempus.com/solutions/xt-cdx/';
const NPI_SOURCE = 'https://npiregistry.cms.hhs.gov/';
const states: Record<string,string> = { IL:'Illinois', NY:'New York', CA:'California', TX:'Texas', MA:'Massachusetts', FL:'Florida', PA:'Pennsylvania', WA:'Washington' };
const name = (p: Provider) => `${p.basic.first_name ?? ''} ${p.basic.last_name ?? ''}${p.basic.credential ? `, ${p.basic.credential}` : ''}`.trim();
const address = (p: Provider) => p.addresses.find(a => a.address_purpose === 'LOCATION') ?? p.addresses[0];

function rank(p: Provider, trials: Study[]): RankedProvider {
  const local = trials.filter(t => t.protocolSection.contactsLocationsModule?.locations?.some(l => l.city?.toLowerCase() === address(p)?.city?.toLowerCase()));
  const exactFit = p.taxonomies.some(t => /oncology/i.test(t.desc)) ? 100 : 40;
  const trialSignal = Math.min(100, local.length * 14);
  const updated = p.basic.last_updated ? new Date(p.basic.last_updated).getTime() : 0;
  const recency = Math.max(10, Math.round(100 - (updated ? (Date.now() - updated) / 2629800000 : 120) * 1.5));
  return { ...p, exactFit, trialSignal, recency, cityTrials: local, score: Math.round(exactFit*.45 + trialSignal*.40 + recency*.15) };
}

export function App() {
  const [city,setCity] = useState('Chicago'); const [state,setState] = useState('IL');
  const [query,setQuery] = useState({city:'Chicago',state:'IL'}); const [providers,setProviders] = useState<Provider[]>([]);
  const [trials,setTrials] = useState<Study[]>([]); const [points,setPoints] = useState<ProviderPoint[]>([]);
  const [selectedNpi,setSelectedNpi] = useState(''); const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const ranked = useMemo(() => providers.map(p=>rank(p,trials)).sort((a,b)=>b.score-a.score),[providers,trials]);
  const selected = ranked.find(p=>p.number===selectedNpi) ?? ranked[0];

  async function load(){ setLoading(true); setError(''); setPoints([]); try { const [p,t]=await Promise.all([fetchProviders(query.city,query.state),fetchTrials(query.city,query.state)]); setProviders(p);setTrials(t);setSelectedNpi(p[0]?.number??''); setPoints(await geocodeProviders(p)); } catch(e){setError(e instanceof Error?e.message:'Public data unavailable.')} finally{setLoading(false)} }
  useEffect(()=>{load()},[query]);
  return <div className="shell">
    <header className="topbar"><a className="logo" href="#"><span>t</span> tempus<span className="product">signal</span></a><div className="source-status"><i/> Live public data <b>•</b> NPPES + ClinicalTrials.gov</div><button className="user">AM</button></header>
    <main>
      <section className="hero"><div><span className="kicker">Territory workspace</span><h1>Find the right conversation.</h1><p>Real provider and clinical-trial signals, distilled into one clear next step.</p></div>
        <form className="search" onSubmit={e=>{e.preventDefault();setQuery({city:city.trim(),state})}}><Search/><input aria-label="City" value={city} onChange={e=>setCity(e.target.value)} /><div><select aria-label="State" value={state} onChange={e=>setState(e.target.value)}>{Object.entries(states).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select><ChevronDown/></div><button>Search market</button></form>
      </section>
      {error ? <div className="error"><CircleAlert/><div><b>Couldn’t load this market</b><span>{error}</span></div><button onClick={load}>Try again</button></div> : <>
        <section className="pulse"><div><b>{loading?'—':ranked.length}</b><span>oncology providers</span></div><div><b>{loading?'—':trials.length}</b><span>recruiting trials</span></div><div><b>{loading?'—':points.length}</b><span>mapped locations</span></div><p><Sparkles/> Ranked with specialty fit, local trial activity, and record recency. <button title="45% specialty fit, 40% trial activity, 15% record recency">How it works</button></p></section>
        <section className="workspace">
          <div className="map-wrap"><TerritoryMap points={points} providers={ranked} selectedNpi={selected?.number} onSelect={setSelectedNpi}/>{loading&&<div className="map-loading"><span/><b>Building your territory view…</b><small>Matching real provider addresses</small></div>}<div className="map-label"><MapPin/> {query.city}, {query.state}<span>{points.length} locations</span></div></div>
          <aside className="rank-panel"><div className="panel-title"><div><span>Priority list</span><h2>Who to call next</h2></div><b>{ranked.length}</b></div><div className="list">{loading?[1,2,3,4].map(i=><div className="row skeleton" key={i}/>):ranked.slice(0,6).map((p,i)=><button key={p.number} className={`row ${selected?.number===p.number?'active':''}`} onClick={()=>setSelectedNpi(p.number)}><span className="number">{i+1}</span><span className="person"><b>{name(p)}</b><small>{p.taxonomies.find(t=>t.primary)?.desc??'Oncology'} · {address(p)?.city}</small></span><span className="signal">{p.score}<small>signal</small></span></button>)}</div></aside>
        </section>
        {selected&&<Brief provider={selected}/>} 
      </>}
      <footer><ShieldCheck/> Source records are never synthesized <span>Decision support only · Not for clinical use</span></footer>
    </main>
  </div>
}

function TerritoryMap({points,providers,selectedNpi,onSelect}:{points:ProviderPoint[];providers:RankedProvider[];selectedNpi?:string;onSelect:(npi:string)=>void}){
  const node=useRef<HTMLDivElement>(null); const map=useRef<mapboxgl.Map|null>(null); const markers=useRef<mapboxgl.Marker[]>([]);
  useEffect(()=>{if(!node.current||map.current)return; mapboxgl.accessToken=MAPBOX_TOKEN;map.current=new mapboxgl.Map({container:node.current,style:'mapbox://styles/mapbox/light-v11',center:[-87.6298,41.8781],zoom:10.2,attributionControl:false});map.current.addControl(new mapboxgl.NavigationControl({showCompass:false}),'bottom-right');return()=>{map.current?.remove();map.current=null}},[]);
  useEffect(()=>{if(!map.current||!points.length)return;markers.current.forEach(m=>m.remove());const bounds=new mapboxgl.LngLatBounds();markers.current=points.map(point=>{const p=providers.find(x=>x.number===point.npi);const el=document.createElement('button');el.className=`map-marker ${point.npi===selectedNpi?'active':''}`;el.innerHTML=`<span>${p?.score??''}</span>`;el.setAttribute('aria-label',p?name(p):'Provider');el.onclick=()=>onSelect(point.npi);bounds.extend([point.longitude,point.latitude]);return new mapboxgl.Marker({element:el}).setLngLat([point.longitude,point.latitude]).addTo(map.current!)});map.current.fitBounds(bounds,{padding:70,maxZoom:13,duration:700})},[points,providers,selectedNpi,onSelect]);
  return <div ref={node} className="map"/>;
}

function Brief({provider:p}:{provider:RankedProvider}){const trial=p.cityTrials[0]?.protocolSection.identificationModule.briefTitle;return <section className="brief"><div className="brief-profile"><span className="initials">{p.basic.first_name?.[0]}{p.basic.last_name?.[0]}</span><div><small>Recommended conversation</small><h2>{name(p)}</h2><p><MapPin/> {address(p)?.address_1}, {address(p)?.city}</p></div><a href={`${NPI_SOURCE}provider-view/${p.number}`} target="_blank" rel="noreferrer">NPI record <ExternalLink/></a></div><div className="brief-content"><article className="next-step"><span><Sparkles/> Suggested opener</span><p>“Dr. {p.basic.last_name}, I noticed {trial?`local recruitment for ${trial}`:`active oncology research in ${address(p)?.city}`}. Tempus xT CDx offers FDA-approved 648-gene tissue-based profiling for malignant solid tumors. Could we spend 15 minutes on where comprehensive profiling fits your workflow?”</p><small><ShieldCheck/> AI-drafted from cited facts · review before use</small></article><div className="quick-facts"><h3>Why now</h3><div><Check/><span><b>{p.cityTrials.length} recruiting cancer trials</b><small>Same-city ClinicalTrials.gov records</small></span></div><div><Check/><span><b>648-gene FDA-approved test</b><small>Official Tempus xT CDx product page</small></span></div><a href={TEMPUS_SOURCE} target="_blank" rel="noreferrer">View supporting evidence <ExternalLink/></a></div></div></section>}
