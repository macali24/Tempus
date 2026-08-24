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

function popupCard(p: RankedProvider) {
  const card = document.createElement('div'); card.className = 'popup-card';
  const location = address(p); const taxonomy = p.taxonomies.find(t=>t.primary)?.desc ?? 'Oncology';
  const header = document.createElement('div'); header.className = 'popup-heading';
  const identity = document.createElement('div');
  const label = document.createElement('small'); label.textContent = 'PUBLIC PROVIDER PROFILE';
  const title = document.createElement('strong'); title.textContent = name(p);
  const specialty = document.createElement('span'); specialty.textContent = taxonomy;
  identity.append(label,title,specialty);
  const score = document.createElement('b'); score.className = 'popup-score'; score.textContent = String(p.score); score.title = 'Priority score out of 100';
  header.append(identity,score); card.append(header);
  const metrics = document.createElement('div'); metrics.className = 'popup-metrics';
  [[String(p.cityTrials.length),'Recruiting trials'],[`${p.exactFit}%`,'Specialty fit'],[p.basic.last_updated ?? '—','NPI updated']].forEach(([value,key])=>{const item=document.createElement('div');const b=document.createElement('b');b.textContent=value;const s=document.createElement('span');s.textContent=key;item.append(b,s);metrics.append(item)});card.append(metrics);
  const details = document.createElement('div'); details.className = 'popup-details';
  const addressLine = document.createElement('p'); addressLine.textContent = `${location?.address_1 ?? ''}, ${location?.city ?? ''}, ${location?.state ?? ''}`;
  details.append(addressLine);
  if(location?.telephone_number){const phone=document.createElement('a');phone.href=`tel:${location.telephone_number}`;phone.textContent=location.telephone_number;details.append(phone)}
  card.append(details);
  const note=document.createElement('p');note.className='popup-note';note.textContent=`Priority: 45% specialty fit · 40% local trial activity · 15% NPI recency.`;card.append(note);
  const sources=document.createElement('div');sources.className='popup-sources';
  const npi=document.createElement('a');npi.href=`${NPI_SOURCE}provider-view/${p.number}`;npi.target='_blank';npi.rel='noreferrer';npi.textContent=`NPI ${p.number} ↗`;
  const trials=document.createElement('a');trials.href='https://clinicaltrials.gov/';trials.target='_blank';trials.rel='noreferrer';trials.textContent='Trial source ↗';sources.append(npi,trials);card.append(sources);
  return card;
}

export function App() {
  const [city,setCity] = useState('Chicago'); const [state,setState] = useState('IL');
  const [query,setQuery] = useState({city:'Chicago',state:'IL'}); const [providers,setProviders] = useState<Provider[]>([]);
  const [trials,setTrials] = useState<Study[]>([]); const [points,setPoints] = useState<ProviderPoint[]>([]);
  const [photos,setPhotos] = useState<Record<string,ProviderPhoto>>({});
  const [selectedNpi,setSelectedNpi] = useState(''); const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const ranked = useMemo(() => providers.map(p=>rank(p,trials)).sort((a,b)=>b.score-a.score),[providers,trials]);
  const selected = ranked.find(p=>p.number===selectedNpi) ?? ranked[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  async function load(){
    setLoading(true); setError(''); setPoints([]); setPhotos({});
    try {
      const p = await fetchProviders(query.city,query.state);
      setProviders(p); setSelectedNpi(''); setLoading(false);
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
        <section className="workspace">
          <div className="map-wrap"><TerritoryMap points={points} providers={ranked} selectedNpi={selectedNpi} onSelect={setSelectedNpi}/>{loading&&<div className="map-loading"><span/><b>Building your territory view…</b><small>Matching real provider addresses</small></div>}<div className="map-label"><MapPin/> {query.city}, {query.state}<span>{points.length} locations</span></div></div>
          <aside className="rank-panel"><div className="panel-title"><div><span>Priority list</span><h2>Who to call next</h2></div><b>{ranked.length}</b></div><div className="list">{loading?[1,2,3,4].map(i=><div className="row skeleton" key={i}/>):ranked.slice(0,6).map((p,i)=><button key={p.number} className={`row ${selectedNpi===p.number?'active':''}`} onClick={()=>setSelectedNpi(p.number)}><span className="number">{i+1}</span><ProviderAvatar provider={p} photo={photos[p.number]}/><span className="person"><b>{name(p)}</b><small>{p.taxonomies.find(t=>t.primary)?.desc??'Oncology'} · {address(p)?.city}</small></span><span className="signal">{p.score}<small>signal</small></span></button>)}</div></aside>
        </section>
        {selected&&<Brief provider={selected} photo={photos[selected.number]}/>}
      </>}
      <footer><ShieldCheck/> Source records are never synthesized <span>Decision support only · Not for clinical use</span></footer>
    </main>
  </div>
}

function TerritoryMap({points,providers,selectedNpi,onSelect}:{points:ProviderPoint[];providers:RankedProvider[];selectedNpi?:string;onSelect:(npi:string)=>void}){
  const node=useRef<HTMLDivElement>(null); const map=useRef<mapboxgl.Map|null>(null); const markers=useRef<Map<string,mapboxgl.Marker>>(new Map()); const popup=useRef<mapboxgl.Popup|null>(null);
  const fitTerritory=()=>{if(!map.current||!points.length)return;popup.current?.remove();const bounds=new mapboxgl.LngLatBounds();points.forEach(p=>bounds.extend([p.longitude,p.latitude]));map.current.fitBounds(bounds,{padding:80,maxZoom:10.5,pitch:0,bearing:0,duration:900})};
  useEffect(()=>{if(!node.current||map.current)return; mapboxgl.accessToken=MAPBOX_TOKEN;map.current=new mapboxgl.Map({container:node.current,style:'mapbox://styles/mapbox/standard',config:{basemap:{theme:'default',lightPreset:'dawn',show3dObjects:false,showPointOfInterestLabels:true}},center:[-87.6298,41.8781],zoom:10.2,pitch:0,bearing:0,dragRotate:false,pitchWithRotate:false,attributionControl:false});map.current.touchZoomRotate.disableRotation();map.current.addControl(new mapboxgl.NavigationControl({showCompass:false,visualizePitch:false}),'bottom-right');map.current.addControl(new mapboxgl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true}),'bottom-right');map.current.addControl(new mapboxgl.FullscreenControl(),'bottom-right');return()=>{map.current?.remove();map.current=null}},[]);
  useEffect(()=>{if(!map.current||!points.length)return;markers.current.forEach(m=>m.remove());markers.current.clear();const duplicates=new Map<string,number>();points.forEach(point=>{const key=`${point.longitude},${point.latitude}`;const offset=duplicates.get(key)??0;duplicates.set(key,offset+1);const angle=offset*2.4;const radius=offset?0.00035*Math.ceil(offset/2):0;const coords:[number,number]=[point.longitude+Math.cos(angle)*radius,point.latitude+Math.sin(angle)*radius];const p=providers.find(x=>x.number===point.npi);const el=document.createElement('button');el.className='map-marker';el.innerHTML=`<span>${p?.score??''}</span>`;el.setAttribute('aria-label',p?name(p):'Provider');el.onclick=()=>onSelect(point.npi);const marker=new mapboxgl.Marker({element:el}).setLngLat(coords).addTo(map.current!);markers.current.set(point.npi,marker)});fitTerritory()},[points,providers,onSelect]);
  useEffect(()=>{markers.current.forEach((marker,npi)=>marker.getElement().classList.toggle('active',npi===selectedNpi));if(!selectedNpi||!map.current)return;const marker=markers.current.get(selectedNpi);const p=providers.find(x=>x.number===selectedNpi);if(!marker||!p)return;const coords=marker.getLngLat();map.current.flyTo({center:coords,zoom:12.8,pitch:0,bearing:0,duration:850,essential:true});popup.current?.remove();popup.current=new mapboxgl.Popup({offset:30,closeButton:true,className:'provider-popup',maxWidth:'340px'}).setLngLat(coords).setDOMContent(popupCard(p)).addTo(map.current)},[selectedNpi,providers]);
  return <div className="map-frame"><div ref={node} className="map"/><div className="map-tools"><button onClick={fitTerritory} title="Show all providers"><RotateCcw/> Reset view</button><button onClick={()=>map.current?.getContainer().querySelector<HTMLButtonElement>('.mapboxgl-ctrl-geolocate')?.click()} title="Find my location"><LocateFixed/> Near me</button></div></div>;
}

function ProviderAvatar({provider,photo}:{provider:Provider;photo?:ProviderPhoto}){return photo?<span className="doctor-photo" title="NPI-matched official public photo"><img src={photo.url} alt={name(provider)}/></span>:<span className="doctor-photo fallback" title="No identity-verified public photo found">{provider.basic.first_name?.[0]}{provider.basic.last_name?.[0]}</span>}

function Brief({provider:p,photo}:{provider:RankedProvider;photo?:ProviderPhoto}){const trial=p.cityTrials[0]?.protocolSection.identificationModule.briefTitle;return <section className="brief"><div className="brief-profile"><ProviderAvatar provider={p} photo={photo}/><div><small>Recommended conversation</small><h2>{name(p)}</h2><p><MapPin/> {address(p)?.address_1}, {address(p)?.city}</p></div><div className="profile-links"><a href={`${NPI_SOURCE}provider-view/${p.number}`} target="_blank" rel="noreferrer">NPI record <ExternalLink/></a>{photo&&<a href={photo.sourceUrl} target="_blank" rel="noreferrer">Photo source <ExternalLink/></a>}</div></div><div className="brief-content"><article className="next-step"><span><Sparkles/> Suggested opener</span><p>“Dr. {p.basic.last_name}, I noticed {trial?`local recruitment for ${trial}`:`active oncology research in ${address(p)?.city}`}. Tempus xT CDx offers FDA-approved 648-gene tissue-based profiling for malignant solid tumors. Could we spend 15 minutes on where comprehensive profiling fits your workflow?”</p><small><ShieldCheck/> AI-drafted from cited facts · review before use</small></article><div className="quick-facts"><h3>Why now</h3><div><Check/><span><b>{p.cityTrials.length} recruiting cancer trials</b><small>Same-city ClinicalTrials.gov records</small></span></div><div><Check/><span><b>648-gene FDA-approved test</b><small>Official Tempus xT CDx product page</small></span></div><a href={TEMPUS_SOURCE} target="_blank" rel="noreferrer">View supporting evidence <ExternalLink/></a></div></div></section>}
