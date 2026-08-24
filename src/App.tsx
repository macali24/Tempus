import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Check, ChevronDown, CircleAlert, ExternalLink, LocateFixed, MapPin, RotateCcw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { fetchProviders, fetchTrials, fetchVerifiedPhotos, geocodeProviders, MAPBOX_TOKEN } from './api';
import type { Provider, ProviderPhoto, ProviderPoint, RankedProvider, Study } from './types';

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
  const [photos,setPhotos] = useState<Record<string,ProviderPhoto>>({}); const [showFormula,setShowFormula] = useState(false);
  const [selectedNpi,setSelectedNpi] = useState(''); const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const ranked = useMemo(() => providers.map(p=>rank(p,trials)).sort((a,b)=>b.score-a.score),[providers,trials]);
  const selected = ranked.find(p=>p.number===selectedNpi) ?? ranked[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  async function load(){
    setLoading(true); setError(''); setPoints([]); setPhotos({});
    try {
      const p = await fetchProviders(query.city,query.state);
      setProviders(p); setSelectedNpi(p[0]?.number??''); setLoading(false);
      const [trialResult, pointResult, photoResult] = await Promise.allSettled([fetchTrials(query.city,query.state), geocodeProviders(p), fetchVerifiedPhotos(p)]);
      setTrials(trialResult.status==='fulfilled'?trialResult.value:[]);
      setPoints(pointResult.status==='fulfilled'?pointResult.value:[]);
      setPhotos(photoResult.status==='fulfilled'?photoResult.value:{});
    } catch(e){setProviders([]);setTrials([]);setError(e instanceof Error?e.message:'Public data unavailable.');setLoading(false)}
  }
  useEffect(()=>{load()},[query]);
  return <div className="shell">
    <header className="topbar"><div className="logo"><img src="/tempus-mark.png" alt="Tempus"/><span>tempus</span></div><div className="account"><span>John Doe<small>Territory manager</small></span><div className="user">JD</div></div></header>
    <main>
      <section className="hero"><div><h1>{greeting}, John.</h1><p>{loading ? `Loading ${query.city} territory…` : <><strong>{ranked.length}</strong> oncology providers · <strong>{trials.length}</strong> recruiting trials · top priority <strong>{ranked[0]?.score ?? 0}/100</strong></>}</p></div>
        <form className="search" onSubmit={e=>{e.preventDefault();setQuery({city:city.trim(),state})}}><Search/><input aria-label="City" value={city} onChange={e=>setCity(e.target.value)} /><div><select aria-label="State" value={state} onChange={e=>setState(e.target.value)}>{Object.entries(states).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select><ChevronDown/></div><button>Search market</button></form>
      </section>
      {error ? <div className="error"><CircleAlert/><div><b>Couldn’t load this market</b><span>{error}</span></div><button onClick={load}>Try again</button></div> : <>
        <section className="pulse"><div><b>{loading?'—':ranked.length}</b><span>oncology providers</span></div><div><b>{loading?'—':trials.length}</b><span>recruiting trials</span></div><div><b>{loading?'—':points.length}</b><span>mapped locations</span></div><p><Sparkles/> Ranked with specialty fit, local trial activity, and record recency. <button onClick={()=>setShowFormula(!showFormula)} aria-expanded={showFormula}>How it works</button></p>{showFormula&&<div className="formula-popover"><b>Priority score</b><span>45% oncology specialty fit</span><span>40% local recruiting-trial activity</span><span>15% NPI record recency</span><small>No patient volume or CRM data is inferred.</small></div>}</section>
        <section className="workspace">
          <div className="map-wrap"><TerritoryMap points={points} providers={ranked} selectedNpi={selected?.number} onSelect={setSelectedNpi}/>{loading&&<div className="map-loading"><span/><b>Building your territory view…</b><small>Matching real provider addresses</small></div>}<div className="map-label"><MapPin/> {query.city}, {query.state}<span>{points.length} locations</span></div></div>
          <aside className="rank-panel"><div className="panel-title"><div><span>Priority list</span><h2>Who to call next</h2></div><b>{ranked.length}</b></div><div className="list">{loading?[1,2,3,4].map(i=><div className="row skeleton" key={i}/>):ranked.slice(0,6).map((p,i)=><button key={p.number} className={`row ${selected?.number===p.number?'active':''}`} onClick={()=>setSelectedNpi(p.number)}><span className="number">{i+1}</span><ProviderAvatar provider={p} photo={photos[p.number]}/><span className="person"><b>{name(p)}</b><small>{p.taxonomies.find(t=>t.primary)?.desc??'Oncology'} · {address(p)?.city}</small></span><span className="signal">{p.score}<small>signal</small></span></button>)}</div></aside>
        </section>
        {selected&&<Brief provider={selected} photo={photos[selected.number]}/>}
      </>}
      <footer><ShieldCheck/> Source records are never synthesized <span>Decision support only · Not for clinical use</span></footer>
    </main>
  </div>
}

function TerritoryMap({points,providers,selectedNpi,onSelect}:{points:ProviderPoint[];providers:RankedProvider[];selectedNpi?:string;onSelect:(npi:string)=>void}){
  const node=useRef<HTMLDivElement>(null); const map=useRef<mapboxgl.Map|null>(null); const markers=useRef<Map<string,mapboxgl.Marker>>(new Map()); const popup=useRef<mapboxgl.Popup|null>(null);
  const fitTerritory=()=>{if(!map.current||!points.length)return;const bounds=new mapboxgl.LngLatBounds();points.forEach(p=>bounds.extend([p.longitude,p.latitude]));map.current.fitBounds(bounds,{padding:80,maxZoom:13,duration:900})};
  useEffect(()=>{if(!node.current||map.current)return; mapboxgl.accessToken=MAPBOX_TOKEN;map.current=new mapboxgl.Map({container:node.current,style:'mapbox://styles/mapbox/light-v11',center:[-87.6298,41.8781],zoom:10.2,attributionControl:false});map.current.addControl(new mapboxgl.NavigationControl({visualizePitch:true}),'bottom-right');map.current.addControl(new mapboxgl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true}),'bottom-right');map.current.addControl(new mapboxgl.FullscreenControl(),'bottom-right');return()=>{map.current?.remove();map.current=null}},[]);
  useEffect(()=>{if(!map.current||!points.length)return;markers.current.forEach(m=>m.remove());markers.current.clear();const duplicates=new Map<string,number>();points.forEach(point=>{const key=`${point.longitude},${point.latitude}`;const offset=duplicates.get(key)??0;duplicates.set(key,offset+1);const angle=offset*2.4;const radius=offset?0.00035*Math.ceil(offset/2):0;const coords:[number,number]=[point.longitude+Math.cos(angle)*radius,point.latitude+Math.sin(angle)*radius];const p=providers.find(x=>x.number===point.npi);const el=document.createElement('button');el.className='map-marker';el.innerHTML=`<span>${p?.score??''}</span>`;el.setAttribute('aria-label',p?name(p):'Provider');el.onclick=()=>onSelect(point.npi);const marker=new mapboxgl.Marker({element:el}).setLngLat(coords).addTo(map.current!);markers.current.set(point.npi,marker)});fitTerritory()},[points,providers,onSelect]);
  useEffect(()=>{markers.current.forEach((marker,npi)=>marker.getElement().classList.toggle('active',npi===selectedNpi));if(!selectedNpi||!map.current)return;const marker=markers.current.get(selectedNpi);const p=providers.find(x=>x.number===selectedNpi);if(!marker||!p)return;const coords=marker.getLngLat();map.current.flyTo({center:coords,zoom:14.8,pitch:38,bearing:-12,duration:1100,essential:true});popup.current?.remove();popup.current=new mapboxgl.Popup({offset:30,closeButton:false,className:'provider-popup'}).setLngLat(coords).setHTML(`<strong>${name(p)}</strong><span>${p.taxonomies.find(t=>t.primary)?.desc??'Oncology'}</span><small>${address(p)?.address_1}</small>`).addTo(map.current)},[selectedNpi,providers]);
  return <div className="map-frame"><div ref={node} className="map"/><div className="map-tools"><button onClick={fitTerritory} title="Show all providers"><RotateCcw/> Reset view</button><button onClick={()=>map.current?.getContainer().querySelector<HTMLButtonElement>('.mapboxgl-ctrl-geolocate')?.click()} title="Find my location"><LocateFixed/> Near me</button></div></div>;
}

function ProviderAvatar({provider,photo}:{provider:Provider;photo?:ProviderPhoto}){return photo?<span className="doctor-photo" title="Exact-match public profile photo"><img src={photo.url} alt={name(provider)}/></span>:<span className="doctor-photo fallback" title="No exact-match public photo found">{provider.basic.first_name?.[0]}{provider.basic.last_name?.[0]}</span>}

function Brief({provider:p,photo}:{provider:RankedProvider;photo?:ProviderPhoto}){const trial=p.cityTrials[0]?.protocolSection.identificationModule.briefTitle;return <section className="brief"><div className="brief-profile"><ProviderAvatar provider={p} photo={photo}/><div><small>Recommended conversation</small><h2>{name(p)}</h2><p><MapPin/> {address(p)?.address_1}, {address(p)?.city}</p></div><a href={`${NPI_SOURCE}provider-view/${p.number}`} target="_blank" rel="noreferrer">NPI record <ExternalLink/></a></div><div className="brief-content"><article className="next-step"><span><Sparkles/> Suggested opener</span><p>“Dr. {p.basic.last_name}, I noticed {trial?`local recruitment for ${trial}`:`active oncology research in ${address(p)?.city}`}. Tempus xT CDx offers FDA-approved 648-gene tissue-based profiling for malignant solid tumors. Could we spend 15 minutes on where comprehensive profiling fits your workflow?”</p><small><ShieldCheck/> AI-drafted from cited facts · review before use</small></article><div className="quick-facts"><h3>Why now</h3><div><Check/><span><b>{p.cityTrials.length} recruiting cancer trials</b><small>Same-city ClinicalTrials.gov records</small></span></div><div><Check/><span><b>648-gene FDA-approved test</b><small>Official Tempus xT CDx product page</small></span></div><a href={TEMPUS_SOURCE} target="_blank" rel="noreferrer">View supporting evidence <ExternalLink/></a></div></div></section>}
