import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, FilterX, Info, LocateFixed, MapPin, Phone, Search, User, X } from 'lucide-react';
import { fetchProviders, fetchTrials, fetchUtilization, geocodeProviders, type TrialResult } from './api';
import { fetchPaymentsForAll, type PaymentSummary } from './lib/openpayments';
import { rankProviders, WEIGHTS, WEIGHT_LABEL, type ScoredProvider } from './lib/ranking';
import { buildAccounts } from './lib/accounts';
import { marketProviders } from './lib/market';
import { applyFilters, activeFilterCount, filterOptions, NO_FILTERS, type Filters } from './lib/filters';
import { availableProviders, type ProviderId } from './lib/llm';
import { matchTrialsToInterest } from './lib/triggers';
import { displayName, practiceAddress, practicePhone, specialty } from './lib/format';
import { TrustPanel } from './components/TrustPanel';
import { BriefPanel } from './components/BriefPanel';
import { NO_AUDIT, type AuditSummary } from './components/AuditCard';
import { MethodPanel } from './components/MethodPanel';
import { AccountPanel } from './components/AccountPanel';
import { Headshot, HeadshotCredit } from './components/Headshot';
import type { CmsUtilization, Provider, ProviderPoint } from './types';

// Mapbox is ~1.2 MB of the bundle and the map is spatial context, not the
// critical path; the ranked list and the brief render without waiting for it.
const TerritoryMap = lazy(() =>
  import('./components/TerritoryMap').then(m => ({ default: m.TerritoryMap })),
);

const DEFAULT_MARKET = { city: 'Chicago', state: 'IL' } as const;

/** Where the ranked list came from; shown, never inferred. */
type Source = 'live' | 'demo' | 'none';
type Mode = 'providers' | 'accounts';


export function App() {
  const market = DEFAULT_MARKET;

  const [providers, setProviders] = useState<Provider[]>([]);
  const [trials, setTrials] = useState<TrialResult>({ studies: [], total: 0 });
  const [utilization, setUtilization] = useState<Record<string, CmsUtilization>>({});
  const [payments, setPayments] = useState<Record<string, PaymentSummary>>({});
  const [points, setPoints] = useState<ProviderPoint[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState<Source>('live');
  const [selectedNpi, setSelectedNpi] = useState('');
  const [mode, setMode] = useState<Mode>('providers');
  const [accountId, setAccountId] = useState('');
  const [methodOpen, setMethodOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [models, setModels] = useState<ProviderId[]>([]);
  const [fitRequest, setFitRequest] = useState(0);
  // Claim and source counts belong to the brief's pipeline but are read at the
  // top of the page, so the brief reports them up rather than duplicating work.
  const [audit, setAudit] = useState<AuditSummary>(NO_AUDIT);

  const ranked = useMemo(
    () =>
      rankProviders({
        providers,
        trials: trials.studies,
        trialTotal: trials.total,
        utilization,
        payments,
      }),
    [providers, trials, utilization, payments],
  );
  const visible = useMemo(() => applyFilters(ranked, filters), [ranked, filters]);
  const options = useMemo(() => filterOptions(ranked), [ranked]);
  const activeFilters = activeFilterCount(filters);
  const selected = ranked.find(p => p.number === selectedNpi) ?? visible[0] ?? ranked[0];
  const accounts = useMemo(() => buildAccounts(visible), [visible]);
  const account = accounts.find(a => a.id === accountId);
  // The account the currently selected physician belongs to, used to fill the
  // context column with colleagues rather than whitespace.
  const selectedAccount = selected ? accounts.find(a => a.providers.some(p => p.number === selected.number)) : undefined;
  const sharedTheme = selectedAccount?.themes.find(t => t.count > 1);
  const contested = ranked.filter(p => p.consensus.contested > 0).length;
  const relevantTrials = selected
    ? matchTrialsToInterest(selected.cityTrials, selected.crm?.interest).length
    : 0;
  const mapProviders = account?.providers ?? visible;
  const mapProviderIds = new Set(mapProviders.map(provider => provider.number));
  const mapPoints = points.filter(point => mapProviderIds.has(point.npi));

  useEffect(() => {
    availableProviders().then(setModels);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setError('');
      setPoints([]);
      setUtilization({});
      setPayments({});
      // The ingested CSV is the spine of the ranked list; NPPES is enrichment
      // that makes it better, not a dependency that can take it away.
      let found: Provider[];
      let sourceKind: Source = 'live';
      try {
        found = await fetchProviders(market.city, market.state);
      } catch (e) {
        const fallback = marketProviders(market.city, market.state);
        if (!fallback.length) {
          if (!live) return;
          setProviders([]);
          setTrials({ studies: [], total: 0 });
          setError(e instanceof Error ? e.message : 'Public data unavailable.');
          setSource('none');
          setLoading(false);
          return;
        }
        found = fallback;
        sourceKind = 'demo';
      }

      if (!live) return;
      setProviders(found);
      setSource(sourceKind);
      setSelectedNpi('');
      setLoading(false);

      // Enrichment is best-effort and parallel: a failing source degrades one
      // signal rather than the whole territory. allSettled never rejects, so
      // there is no path here that can take the ranked list back down.
      const [trialResult, utilizationResult, paymentResult, pointResult] = await Promise.allSettled([
        fetchTrials(market.city, market.state),
        fetchUtilization(found),
        fetchPaymentsForAll(found.map(p => p.number).slice(0, 12)),
        geocodeProviders(found),
      ]);
      if (!live) return;
      setTrials(trialResult.status === 'fulfilled' ? trialResult.value : { studies: [], total: 0 });
      setUtilization(utilizationResult.status === 'fulfilled' ? utilizationResult.value : {});
      setPayments(paymentResult.status === 'fulfilled' ? paymentResult.value : {});
      setPoints(pointResult.status === 'fulfilled' ? pointResult.value : []);
    })();
    return () => {
      live = false;
    };
  }, [market]);

  useEffect(() => { setAudit(NO_AUDIT); }, [selected?.number]);
  const onAudit = useCallback((summary: AuditSummary) => setAudit(summary), []);

  const openProvider = useCallback((npi: string) => {
    setAccountId('');
    setMode('providers');
    setSelectedNpi(npi);
  }, []);

  const showProviders = () => {
    if (account?.providers[0]) openProvider(account.providers[0].number);
    else { setMode('providers'); setAccountId(''); }
  };
  const showAccounts = () => {
    setMode('accounts');
    setAccountId((selectedAccount ?? accounts[0])?.id ?? '');
  };
  const toggleVerification = () => {
    const next = !filters.needsVerification;
    setFilters({ ...filters, needsVerification: next });
    setMode('providers');
    setAccountId('');
    if (next) {
      const first = ranked.find(provider => provider.consensus.contested > 0);
      if (first) setSelectedNpi(first.number);
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><img src="/tempus-mark.png" alt="" /></span>
          <span>
            <b>Tempus</b>
            <span className="brand-sub">Territory copilot</span>
          </span>
        </div>

        <div className="spacer" />
        <div className="status">
          {source === 'demo' && (
            <span
              className="chip warn"
              title="NPPES was unreachable. Providers come from the ingested market-intelligence CSV; live enrichment is still applied where it succeeds."
            >
              <span className="dot" />
              Demo data: CSV only
            </span>
          )}
          <button className="btn ghost" onClick={() => setMethodOpen(true)}>
            <Info />
            How this works
          </button>
        </div>
      </header>

      <div className="work">
        {/* ------------------------------------------------------ the queue */}
        <aside className="queue">
          <div className="queue-head">
            <div className="segmented small">
              <button className={mode === 'providers' ? 'on' : ''} onClick={() => { setMode('providers'); setAccountId(''); }}>
                <User /> Providers
              </button>
              <button className={mode === 'accounts' ? 'on' : ''} onClick={() => setMode('accounts')}>
                <Building2 /> Accounts
              </button>
            </div>
            <span className="count">{loading ? '…' : mode === 'providers' ? visible.length : accounts.length}</span>
          </div>

          <div className="filters">
            <div className="filter-search">
              <Search />
              <input
                aria-label="Filter by name"
                placeholder="Filter by name"
                value={filters.query}
                onChange={e => setFilters({ ...filters, query: e.target.value })}
              />
              {activeFilters > 0 && (
                <button className="icon-btn" title="Clear filters" onClick={() => setFilters(NO_FILTERS)}>
                  <FilterX />
                </button>
              )}
            </div>

            <div className="filter-chips">
              <button
                className={`fchip${filters.needsVerification ? ' on' : ''}`}
                onClick={() => setFilters({ ...filters, needsVerification: !filters.needsVerification })}
              >
                <AlertTriangle /> Needs verifying
              </button>
              <button
                className={`fchip${filters.hasNote ? ' on' : ''}`}
                onClick={() => setFilters({ ...filters, hasNote: !filters.hasNote })}
              >
                Has note
              </button>
              {options.segments.length > 1 && (
                <select
                  aria-label="Segment"
                  className={`fselect${filters.segment !== 'all' ? ' on' : ''}`}
                  value={filters.segment}
                  onChange={e => setFilters({ ...filters, segment: e.target.value })}
                >
                  <option value="all">Any segment</option>
                  {options.segments.map(seg => <option key={seg} value={seg}>{seg}</option>)}
                </select>
              )}
              {options.objections.length > 1 && (
                <select
                  aria-label="Objection"
                  className={`fselect${filters.objection !== 'all' ? ' on' : ''}`}
                  value={filters.objection}
                  onChange={e => setFilters({ ...filters, objection: e.target.value })}
                >
                  <option value="all">Any concern</option>
                  {options.objections.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </div>
          </div>

          {mode === 'providers' && (
            <p className="queue-legend">
              Higher score means greater estimated eligible-patient impact and stronger evidence confidence.
            </p>
          )}

          <div className="queue-list">
            {loading ? (
              Array.from({ length: 7 }, (_, i) => <div className="skel" key={i} />)
            ) : mode === 'providers' ? (
              visible.map((provider, index) => (
                <button
                  key={provider.number}
                  className={`qrow${provider.number === selected?.number && !account ? ' on' : ''}`}
                  data-top={index + 1}
                  data-band={band(provider.score)}
                  onClick={() => { setSelectedNpi(provider.number); setAccountId(''); }}
                >
                  <span className="qrank">{index + 1}</span>
                  <Headshot provider={provider} />
                  <span className="who">
                    <b>{displayName(provider)}</b>
                    {(provider.estimatedPatients || provider.crm || provider.consensus.contested > 0) && (
                      <span className="sub">
                        {provider.consensus.contested > 0 && (
                          <AlertTriangle style={{ width: 11, color: 'var(--amber)', flex: '0 0 auto' }} />
                        )}
                        <span>
                          {[
                            provider.estimatedPatients && `~${provider.estimatedPatients.toLocaleString()} patients`,
                            provider.crm?.objection,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    )}
                    <span className="qbar"><i style={{ width: `${provider.score}%` }} /></span>
                  </span>
                  <span className="score"><b>{provider.score}</b></span>
                </button>
              ))
            ) : (
              accounts.map(item => {
                const shared = item.themes.find(t => t.count > 1);
                return (
                  <button
                    key={item.id}
                    className={`qrow acct${item.id === accountId ? ' on' : ''}`}
                    onClick={() => setAccountId(item.id)}
                  >
                    <span className="who">
                      <b>{item.probableInstitution?.name ?? item.site}</b>
                      <span className="sub">
                        <span>
                          {item.providers.length} oncologist{item.providers.length === 1 ? '' : 's'}
                          {shared && ` · ${shared.count}× ${shared.objection}`}
                        </span>
                      </span>
                    </span>
                    <span className="score"><b>{item.providers.length}</b></span>
                  </button>
                );
              })
            )}
            {!loading && !visible.length && !error && (
              <div className="empty-state">
                {ranked.length
                  ? <>No provider matches these filters. <button className="linkish" onClick={() => setFilters(NO_FILTERS)}>Clear</button></>
                  : 'No active oncology providers matched this market.'}
              </div>
            )}
          </div>
        </aside>

        {/* ----------------------------------------------------- the stage */}
        <main className="stage">
          {/* The territory is the ground the workspace stands on: sharp where
              the page is open, frosted under the reading column by the veil. */}
          <div className="stage-map">
            <Suspense fallback={null}>
              <TerritoryMap
                points={mapPoints}
                providers={mapProviders}
                selectedNpi={account ? account.providers[0]?.number : selected?.number}
                onSelect={openProvider}
                fitRequest={fitRequest}
              />
            </Suspense>
          </div>
          <div className="stage-veil" />

          {error ? (
            <div className="stage-body">
              <div className="stage-scroll">
                <div className="stage-column">
                  <div className="err">
                    <b>Could not load this market</b>
                    <span>{error}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : account ? (
            <>
              <div className="stage-head">
                <div className="stage-column">
                  <div className="dossier">
                    <div className="dossier-id">
                      <span className="eyebrow">Account</span>
                      <h1>{account.probableInstitution?.name ?? account.site}</h1>
                      <dl className="dossier-facts">
                        <div><dt><MapPin /></dt><dd>{account.site}, {account.city}, {account.state} {account.zip}</dd></div>
                        <div><dt>Sites</dt><dd>{account.sites.length}</dd></div>
                        <div><dt>Concerns</dt><dd>{account.themes.length} on record</dd></div>
                        {account.contested > 0 && (
                          <div className="flag"><dt><AlertTriangle /></dt><dd>{account.contested} record{account.contested === 1 ? '' : 's'} to verify</dd></div>
                        )}
                      </dl>
                    </div>
                    <div className="dossier-score">
                      <b>{account.providers.length}</b>
                      <span className="cap">oncologists</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="stage-body">
                <div className="stage-scroll">
                  <div className="stage-column">
                    <AccountPanel
                      account={account}
                      onSelectProvider={npi => openProvider(npi)}
                    />
                  </div>
                </div>

                <aside className="stage-context">
                  <TerritoryControl
                    city={market.city}
                    state={market.state}
                    providers={visible.length}
                    accounts={accounts.length}
                    mode={mode}
                    contested={contested}
                    verificationActive={filters.needsVerification}
                    onProviders={showProviders}
                    onAccounts={showAccounts}
                    onVerification={toggleVerification}
                    onFit={() => setFitRequest(value => value + 1)}
                  />
                </aside>
              </div>
            </>
          ) : !selected ? (
            <div className="stage-body">
              <div className="stage-scroll">
                <div className="stage-column">
                  <div className="empty-state">Select a provider.</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ------------------------------------- who you are calling */}
              <div className="stage-head">
                <div className="stage-column">
                  <div className="dossier">
                    <div className="dossier-face">
                      <Headshot provider={selected} size="lg" />
                      <HeadshotCredit provider={selected} />
                    </div>
                    <div className="dossier-id">
                      <span className="eyebrow">#{visible.findIndex(p => p.number === selected.number) + 1 || 1} in {market.city}</span>
                      <h1>{displayName(selected)}</h1>
                      <p className="dossier-role">{specialty(selected)}</p>
                      <dl className="dossier-facts">
                        {practiceAddress(selected) && (
                          <div><dt><MapPin /></dt><dd>{practiceAddress(selected)}</dd></div>
                        )}
                        {practicePhone(selected) && (
                          <div><dt><Phone /></dt><dd><a href={`tel:${practicePhone(selected).replace(/\D/g, '')}`}>{practicePhone(selected)}</a></dd></div>
                        )}
                        {selectedAccount?.probableInstitution && (
                          <div><dt><Building2 /></dt><dd>{selectedAccount.probableInstitution.name}<em> (asserted, unverified)</em></dd></div>
                        )}
                        <div><dt>NPI</dt><dd className="mono">{selected.number}</dd></div>
                        {selected.segment && <div><dt>Segment</dt><dd>{selected.segment}</dd></div>}
                        {selected.crm && <div><dt>Last contact</dt><dd>{selected.crm.lastContact}</dd></div>}
                        {selected.consensus.verifyBeforeCalling && (
                          <div className="flag"><dt><AlertTriangle /></dt><dd>Verify this record before calling</dd></div>
                        )}
                      </dl>
                    </div>
                    <div className="dossier-score">
                      <ScoreRing value={selected.score} />
                      <span className="cap">priority</span>
                    </div>
                  </div>

                  {/* Evidence used to be a second tab. It is the same page now:
                      the numbers live here, and each one is the way into the
                      section of the dossier that has to justify it. */}
                  <div className="signal-strip">
                    <Signal
                      value={selected.consensus.confidence}
                      suffix="/100"
                      label="identity confidence"
                      target="ev-identity"
                      tone={selected.consensus.confidence >= 70 ? 'ok' : selected.consensus.confidence >= 45 ? 'warn' : 'bad'}
                    />
                    <Signal
                      value={selected.consensus.contested}
                      label={selected.consensus.contested === 1 ? 'contested field' : 'contested fields'}
                      target="ev-consensus"
                      tone={selected.consensus.contested > 0 ? 'warn' : 'ok'}
                    />
                    <Signal
                      value={audit.ready ? audit.verified : 'n/a'}
                      label="claims verified"
                      target="ev-audit"
                      tone={audit.ready && audit.withheld > 0 ? 'warn' : audit.ready ? 'ok' : undefined}
                    />
                    <Signal
                      value={audit.ready ? audit.sources.length : 'n/a'}
                      label="sources cited"
                      target="ev-audit"
                    />
                    <Signal
                      value={selected.estimatedPatients ? `~${selected.estimatedPatients.toLocaleString()}` : 'n/a'}
                      label={selected.opportunityCorroborated ? 'est. patients · corroborated' : 'est. patients · unverified'}
                      target="ev-opportunity"
                      tone={selected.estimatedPatients && !selected.opportunityCorroborated ? 'warn' : undefined}
                    />
                    <Signal
                      value={selected.panelFit}
                      suffix="/100"
                      label={`fit · ${selected.panelAssay}`}
                      target="ev-panel"
                    />
                  </div>
                </div>
              </div>

              <div className="stage-body">
                <div className="stage-scroll">
                  <div className="stage-column">
                    <BriefPanel provider={selected} onAudit={onAudit} />

                    <div className="section-rule">
                      <span className="eyebrow">Evidence &amp; verification</span>
                      <span>everything the copy above rests on</span>
                    </div>

                    <TrustPanel provider={selected} all={ranked} audit={audit} />
                  </div>
                </div>

                <aside className="stage-context">
                  <TerritoryControl
                    city={market.city}
                    state={market.state}
                    providers={visible.length}
                    accounts={accounts.length}
                    mode={mode}
                    contested={contested}
                    relevantTrials={relevantTrials}
                    verificationActive={filters.needsVerification}
                    onProviders={showProviders}
                    onAccounts={showAccounts}
                    onVerification={toggleVerification}
                    onFit={() => setFitRequest(value => value + 1)}
                  />

                  {selectedAccount && selectedAccount.providers.length > 1 && (
                    <div className="context-card">
                      <div className="context-head">
                        <h3>Same site</h3>
                        <span>{selectedAccount.providers.length - 1} colleague{selectedAccount.providers.length === 2 ? '' : 's'}</span>
                      </div>
                      <div className="colleagues">
                        {selectedAccount.providers
                          .filter(p => p.number !== selected.number)
                          .slice(0, 5)
                          .map(p => (
                            <button key={p.number} className="colleague" onClick={() => setSelectedNpi(p.number)}>
                              <span className="cname">{displayName(p)}</span>
                              {p.crm && <span className="cobj">{p.crm.objection}</span>}
                              <span className="cscore">{p.score}</span>
                            </button>
                          ))}
                      </div>
                      {sharedTheme && (
                        <div className="shared-theme">
                          <AlertTriangle />
                          <span>
                            <b>{sharedTheme.count} physicians here</b> independently raised “{sharedTheme.objection}”.
                            That reads as a site-level constraint, worth raising with whoever owns the pathway.
                          </span>
                        </div>
                      )}
                      <button className="ctx-link" onClick={() => { setMode('accounts'); setAccountId(selectedAccount.id); }}>
                        Open account view <ArrowRight style={{ width: 13 }} />
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            </>
          )}
        </main>
      </div>

      {methodOpen && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setMethodOpen(false); }}>
          <div className="overlay-card" role="dialog" aria-modal="true" aria-label="Method and assumptions">
            <div className="overlay-head">
              <h2>Method &amp; assumptions</h2>
              <button className="icon-btn" onClick={() => setMethodOpen(false)} aria-label="Close"><X /></button>
            </div>
            <div className="overlay-body">
              <MethodPanel weights={WEIGHTS} labels={WEIGHT_LABEL} models={models} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One number from the evidence trail, and the way into the section that has to
 * justify it. Every figure in the strip is answerable, so every figure is a
 * button; a readout the reader cannot open would only raise the question.
 */
function Signal({
  value, suffix, label, target, tone,
}: {
  value: number | string;
  suffix?: string;
  label: string;
  target: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <button className="signal" data-tone={tone} onClick={() => reveal(target)} title={`Show ${label}`}>
      <b>{value}{suffix && <em>{suffix}</em>}</b>
      <span>{label}</span>
    </button>
  );
}

function TerritoryControl({
  city, state, providers, accounts, mode, contested, relevantTrials,
  verificationActive, onProviders, onAccounts, onVerification, onFit,
}: {
  city: string;
  state: string;
  providers: number;
  accounts: number;
  mode: Mode;
  contested: number;
  relevantTrials?: number;
  verificationActive: boolean;
  onProviders: () => void;
  onAccounts: () => void;
  onVerification: () => void;
  onFit: () => void;
}) {
  return (
    <div className="context-card territory-control">
      <div className="context-head">
        <h3>{city} territory</h3>
        <span>{state}</span>
      </div>

      <div className="territory-modes" role="group" aria-label="Map view">
        <button className={mode === 'providers' ? 'on' : ''} onClick={onProviders}>
          <User /><span>Providers</span><b>{providers}</b>
        </button>
        <button className={mode === 'accounts' ? 'on' : ''} onClick={onAccounts}>
          <Building2 /><span>Accounts</span><b>{accounts}</b>
        </button>
      </div>

      {relevantTrials !== undefined && (
        <div className="territory-insight">
          <b>{relevantTrials}</b>
          <span>trials match this physician’s stated focus</span>
        </div>
      )}

      <button
        className={`territory-action${verificationActive ? ' on' : ''}`}
        onClick={onVerification}
        disabled={contested === 0}
      >
        <AlertTriangle />
        <span>{verificationActive ? 'Showing' : 'Show'} records needing verification</span>
        <b>{contested}</b>
      </button>
      <button className="territory-action" onClick={onFit}>
        <LocateFixed />
        <span>Fit map to current results</span>
      </button>
    </div>
  );
}

/**
 * Open the disclosure the number came from and bring it into view. Cards are
 * <details>, so this is what replaces the old tab switch: the evidence was
 * never a different page, only a different depth.
 */
function reveal(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  if (element instanceof HTMLDetailsElement) element.open = true;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  element.classList.remove('revealed');
  // Restart the highlight even when the same signal is clicked twice.
  void element.offsetWidth;
  element.classList.add('revealed');
  setTimeout(() => element.classList.remove('revealed'), 1600);
}

/** Score bands drive rank colour in the queue and in the ring. */
function band(score: number) {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
}

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The priority score, as a dial. The number alone reads as a label; an arc
 * makes "90 out of 100" legible without the rep doing arithmetic.
 */
function ScoreRing({ value }: { value: number }) {
  return (
    <div className="score-ring" data-band={band(value)}>
      <svg viewBox="0 0 62 62" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop className="g-a" offset="0%" />
            <stop className="g-b" offset="100%" />
          </linearGradient>
        </defs>
        <circle className="track" cx="31" cy="31" r={RING_R} />
        <circle
          className="fill"
          cx="31"
          cy="31"
          r={RING_R}
          strokeDasharray={`${(Math.max(0, Math.min(100, value)) / 100) * RING_C} ${RING_C}`}
        />
      </svg>
      <span className="num">{value}</span>
    </div>
  );
}
