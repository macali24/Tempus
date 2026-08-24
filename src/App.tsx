import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BadgeCheck, BookOpen, ChevronDown, CircleAlert, ExternalLink, FileCheck2, FlaskConical, MapPin, RefreshCw, Search, ShieldCheck, Sparkles, Stethoscope, Target, Users } from 'lucide-react';
import { fetchProviders, fetchTrials } from './api';
import type { Provider, RankedProvider, Study } from './types';

const TEMPUS_SOURCE = 'https://www.tempus.com/solutions/xt-cdx/';
const NPI_SOURCE = 'https://npiregistry.cms.hhs.gov/';
const CTG_SOURCE = 'https://clinicaltrials.gov/';

const stateNames: Record<string, string> = { IL: 'Illinois', NY: 'New York', CA: 'California', TX: 'Texas', MA: 'Massachusetts', FL: 'Florida', PA: 'Pennsylvania', WA: 'Washington' };

function providerName(p: Provider) {
  const b = p.basic;
  return `${b.first_name ?? ''} ${b.last_name ?? ''}${b.credential ? `, ${b.credential}` : ''}`.trim();
}

function practiceAddress(p: Provider) {
  return p.addresses.find(a => a.address_purpose === 'LOCATION') ?? p.addresses[0];
}

function rankProvider(p: Provider, trials: Study[]): RankedProvider {
  const address = practiceAddress(p);
  const cityTrials = trials.filter(t => t.protocolSection.contactsLocationsModule?.locations?.some(l => l.city?.toLowerCase() === address?.city?.toLowerCase()));
  const oncology = p.taxonomies.some(t => /oncology/i.test(t.desc));
  const exactFit = oncology ? 100 : 40;
  const trialSignal = Math.min(100, cityTrials.length * 14);
  const lastUpdated = p.basic.last_updated ? new Date(p.basic.last_updated).getTime() : 0;
  const monthsOld = lastUpdated ? (Date.now() - lastUpdated) / 2629800000 : 120;
  const recency = Math.max(10, Math.round(100 - monthsOld * 1.5));
  const score = Math.round(exactFit * .45 + trialSignal * .40 + recency * .15);
  return { ...p, score, exactFit, trialSignal, recency, cityTrials };
}

export function App() {
  const [city, setCity] = useState('Chicago');
  const [state, setState] = useState('IL');
  const [query, setQuery] = useState({ city: 'Chicago', state: 'IL' });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [trials, setTrials] = useState<Study[]>([]);
  const [selectedNpi, setSelectedNpi] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'brief' | 'evidence'>('brief');

  async function load() {
    setLoading(true); setError('');
    try {
      const [p, t] = await Promise.all([fetchProviders(query.city, query.state), fetchTrials(query.city, query.state)]);
      setProviders(p); setTrials(t); setSelectedNpi(p[0]?.number ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load public data.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [query]);

  const ranked = useMemo(() => providers.map(p => rankProvider(p, trials)).sort((a, b) => b.score - a.score), [providers, trials]);
  const selected = ranked.find(p => p.number === selectedNpi) ?? ranked[0];
  const topTrial = selected?.cityTrials[0];
  const trialTitle = topTrial?.protocolSection.identificationModule.briefTitle;

  function submit(e: React.FormEvent) { e.preventDefault(); setQuery({ city: city.trim(), state }); }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><span>Signal</span></div>
      <nav>
        <a className="active"><Target size={18}/> Territory</a>
        <a><Users size={18}/> Providers</a>
        <a><FlaskConical size={18}/> Clinical signals</a>
        <a><BookOpen size={18}/> Knowledge</a>
      </nav>
      <div className="sidebar-foot"><div className="live-dot"/><div><strong>Public data live</strong><span>NPPES + ClinicalTrials.gov</span></div></div>
    </aside>

    <main>
      <header>
        <div><p className="eyebrow">Territory intelligence</p><h1>Good morning, Alex.</h1><p className="subhead">Here’s where your attention can make the biggest difference today.</p></div>
        <button className="avatar" aria-label="Profile">AM</button>
      </header>

      <form className="market-search" onSubmit={submit}>
        <MapPin size={18}/><input value={city} onChange={e => setCity(e.target.value)} aria-label="City" placeholder="City"/>
        <div className="select-wrap"><select value={state} onChange={e => setState(e.target.value)} aria-label="State">{Object.entries(stateNames).map(([code,name]) => <option key={code} value={code}>{name}</option>)}</select><ChevronDown size={15}/></div>
        <button type="submit"><Search size={17}/> Explore market</button>
      </form>

      {error ? <div className="error"><CircleAlert/><div><strong>Live data unavailable</strong><p>{error}</p></div><button onClick={load}>Try again</button></div> : <>
        <section className="stat-row">
          <div className="stat hero-stat"><span>Market pulse</span><strong>{loading ? '—' : ranked.length}</strong><p>oncology providers returned</p><Users/></div>
          <div className="stat"><span>Recruiting now</span><strong>{loading ? '—' : trials.length}</strong><p>local cancer trials</p><FlaskConical/></div>
          <div className="stat"><span>Priority signal</span><strong>{loading ? '—' : ranked[0]?.score ?? 0}<small>/100</small></strong><p>top opportunity score</p><ArrowUpRight/></div>
        </section>

        <div className="content-grid">
          <section className="provider-panel">
            <div className="section-head"><div><p className="eyebrow">Recommended outreach</p><h2>Provider priority</h2></div><span className="fresh"><RefreshCw size={13}/> Live results</span></div>
            <div className="formula"><Sparkles size={15}/><span><b>Explainable rank:</b> 45% specialty fit · 40% local trial signal · 15% record recency</span></div>
            <div className="provider-list">
              {loading ? [1,2,3,4].map(i => <div className="provider-row skeleton" key={i}/>) : ranked.slice(0,8).map((p, i) => {
                const address = practiceAddress(p); const active = p.number === selected?.number;
                return <button className={`provider-row ${active ? 'selected' : ''}`} key={p.number} onClick={() => setSelectedNpi(p.number)}>
                  <span className="rank">{String(i+1).padStart(2,'0')}</span>
                  <span className="provider-main"><strong>{providerName(p)}</strong><span>{p.taxonomies.find(t => t.primary)?.desc ?? p.taxonomies[0]?.desc}</span><small>{address?.city}, {address?.state} · NPI {p.number}</small></span>
                  <span className="score"><b>{p.score}</b><small>signal</small></span>
                </button>})}
            </div>
          </section>

          {selected && <section className="brief-panel">
            <div className="brief-top"><div className="monogram">{selected.basic.first_name?.[0]}{selected.basic.last_name?.[0]}</div><div><p className="eyebrow">Today’s top brief</p><h2>{providerName(selected)}</h2><span><MapPin size={13}/>{practiceAddress(selected)?.city}, {practiceAddress(selected)?.state}</span></div><a href={`${NPI_SOURCE}provider-view/${selected.number}`} target="_blank" rel="noreferrer" title="View NPI record"><ExternalLink size={17}/></a></div>
            <div className="tabs"><button className={tab==='brief'?'active':''} onClick={()=>setTab('brief')}>Meeting brief</button><button className={tab==='evidence'?'active':''} onClick={()=>setTab('evidence')}>Evidence</button></div>
            {tab === 'brief' ? <div className="brief-body">
              <div className="insight-card"><div className="icon blue"><Target size={17}/></div><div><label>WHY THIS PROVIDER</label><p>Oncology specialty match with <b>{selected.cityTrials.length} recruiting cancer {selected.cityTrials.length === 1 ? 'trial' : 'trials'}</b> in the same city. This is a territory signal—not an estimate of patient volume.</p></div></div>
              <div className="insight-card featured"><div className="icon green"><Sparkles size={17}/></div><div><label>30-SECOND OPENING <span>SYNTHESIZED</span></label><p>“Dr. {selected.basic.last_name}, I noticed {trialTitle ? `the local research community is recruiting for ${trialTitle}` : `${practiceAddress(selected)?.city} has active recruiting oncology studies`}. Tempus xT CDx offers FDA-approved, 648-gene tissue-based profiling for malignant solid tumors. I’d value 15 minutes to understand how comprehensive profiling fits your current workflow and where evidence gaps remain.”</p><div className="guardrail"><ShieldCheck size={14}/> Review before use · no treatment recommendation</div></div></div>
              <div className="insight-card"><div className="icon amber"><Stethoscope size={17}/></div><div><label>OBJECTION PREP</label><p><b>If asked about clinical scope:</b> “xT CDx is an FDA-approved 648-gene tissue-based NGS test for molecular profiling of malignant solid tumors, with colorectal cancer companion diagnostic claims.”</p><a href={TEMPUS_SOURCE} target="_blank" rel="noreferrer">Tempus xT CDx source <ExternalLink size={12}/></a></div></div>
            </div> : <Evidence selected={selected} />}
          </section>}
        </div>
      </>}
      <footer><span><FileCheck2 size={14}/> No synthetic source records</span><span>Prototype for decision support · Not for clinical use</span></footer>
    </main>
  </div>;
}

function Evidence({selected}:{selected: RankedProvider}) {
  const address = practiceAddress(selected);
  return <div className="evidence-list">
    <div><BadgeCheck/><span><b>Provider identity & specialty</b><small>NPPES NPI Registry · NPI {selected.number}</small></span><a href={`${NPI_SOURCE}provider-view/${selected.number}`} target="_blank" rel="noreferrer"><ExternalLink/></a></div>
    <div><FlaskConical/><span><b>{selected.cityTrials.length} recruiting local cancer studies</b><small>ClinicalTrials.gov API · {address?.city}, {address?.state}</small></span><a href={CTG_SOURCE} target="_blank" rel="noreferrer"><ExternalLink/></a></div>
    <div><BookOpen/><span><b>xT CDx: FDA-approved 648-gene tissue test</b><small>Tempus official product page</small></span><a href={TEMPUS_SOURCE} target="_blank" rel="noreferrer"><ExternalLink/></a></div>
    <div className="score-breakdown"><p>Score breakdown</p><ScoreLine label="Specialty fit" value={selected.exactFit}/><ScoreLine label="Local trial signal" value={selected.trialSignal}/><ScoreLine label="Record recency" value={selected.recency}/></div>
  </div>;
}

function ScoreLine({label,value}:{label:string,value:number}) { return <div className="score-line"><span>{label}</span><div><i style={{width:`${value}%`}}/></div><b>{value}</b></div>; }
