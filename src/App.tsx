import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, ChevronDown, FilterX, Info, LocateFixed, MapPin, Phone, Search, Table2, User, X } from 'lucide-react';
import { fetchProviders, fetchTrials, fetchUtilization, geocodeProviders, ORDERING_TAXONOMIES, type TrialResult } from './api';
import { fetchPaymentsForAll, type PaymentSummary } from './lib/openpayments';
import { rankProviders, WEIGHTS, WEIGHT_LABEL, type ScoredProvider } from './lib/ranking';
import { buildAccounts } from './lib/accounts';
import { marketProviders } from './lib/market';
import { selectTerritory, type Territory } from './lib/territory';
import { applyFilters, activeFilterCount, filterOptions, NO_FILTERS, type Filters } from './lib/filters';
import { availableProviders, type ProviderId } from './lib/llm';
import { matchTrialsToInterest } from './lib/triggers';
import { displayName, practiceAddress, practicePhone, specialty } from './lib/format';
import { TrustPanel } from './components/TrustPanel';
import { BriefPanel } from './components/BriefPanel';
import { NO_AUDIT, type AuditSummary } from './components/AuditCard';
import { MethodPanel } from './components/MethodPanel';
import { AccountPanel } from './components/AccountPanel';
import { Card } from './components/Card';
import { Headshot, HeadshotCredit } from './components/Headshot';
import { ProviderTable } from './components/ProviderTable';
import type { LookupStatus } from './lib/fetching';
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
type WorkspaceView = 'dossier' | 'table';


export function App() {
  const market = DEFAULT_MARKET;

  const [providers, setProviders] = useState<Provider[]>([]);
  const [trials, setTrials] = useState<TrialResult>({ studies: [], total: 0 });
  const [trialsAvailable, setTrialsAvailable] = useState<boolean | undefined>(undefined);
  const [utilization, setUtilization] = useState<Record<string, CmsUtilization>>({});
  const [payments, setPayments] = useState<Record<string, PaymentSummary>>({});
  const [utilizationStatus, setUtilizationStatus] = useState<Record<string, LookupStatus>>({});
  const [paymentStatus, setPaymentStatus] = useState<Record<string, LookupStatus>>({});
  const [paymentTargets, setPaymentTargets] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState<ProviderPoint[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [enrichmentLoading, setEnrichmentLoading] = useState(true);
  // Market size is reported separately from the ranked working set, so its
  // enrichment bound can never be mistaken for the size of the territory.
  const [territory, setTerritory] = useState<Territory | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState<Source>('live');
  const [selectedNpi, setSelectedNpi] = useState('');
  const [mode, setMode] = useState<Mode>('providers');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('dossier');
  const [tableExpanded, setTableExpanded] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [methodOpen, setMethodOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [models, setModels] = useState<ProviderId[]>([]);
  const [fitRequest, setFitRequest] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
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
        utilizationStatus,
        paymentStatus,
      }),
    [providers, trials, utilization, payments, utilizationStatus, paymentStatus],
  );
  const visible = useMemo(() => applyFilters(ranked, filters), [ranked, filters]);
  const rankByNpi = useMemo(
    () => new Map(ranked.map((provider, index) => [provider.number, index + 1])),
    [ranked],
  );
  const options = useMemo(() => filterOptions(ranked), [ranked]);
  const activeFilters = activeFilterCount(filters);
  const selected = visible.find(p => p.number === selectedNpi) ?? visible[0];
  const accounts = useMemo(() => buildAccounts(visible), [visible]);
  const account = accounts.find(a => a.id === accountId) ?? (mode === 'accounts' ? accounts[0] : undefined);
  // The account the currently selected physician belongs to, used to fill the
  // context column with colleagues rather than whitespace.
  const selectedAccount = selected ? accounts.find(a => a.providers.some(p => p.number === selected.number)) : undefined;
  const sharedTheme = selectedAccount?.themes.find(t => t.count > 1);
  const needsVerification = ranked.filter(p => p.consensus.verifyBeforeCalling).length;
  const relevantTrials = selected?.crm?.interest && trialsAvailable
    ? matchTrialsToInterest(selected.cityTrials, selected.crm?.interest).length
    : undefined;
  // The map remains a territory view even when one account is open. Selection
  // highlights and moves to that account rather than erasing every other site.
  const mapProviders = visible;
  const mapProviderIds = new Set(visible.map(provider => provider.number));
  const mapPoints = points.filter(point => mapProviderIds.has(point.npi));

  useEffect(() => {
    availableProviders().then(setModels);
  }, []);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError('');
      setPoints([]);
      setLocationsLoading(true);
      setEnrichmentLoading(true);
      setTrialsAvailable(undefined);
      setUtilization({});
      setPayments({});
      setUtilizationStatus({});
      setPaymentStatus({});
      setPaymentTargets(new Set());
      // The ingested CSV is the spine of the ranked list; NPPES is enrichment
      // that makes it better, not a dependency that can take it away.
      let found: Provider[];
      let sourceKind: Source = 'live';
      let scope: Territory | null = null;
      try {
        const resolved = await fetchProviders(market.city, market.state, controller.signal);
        scope = selectTerritory(resolved.providers);
        found = scope.working;
      } catch (e) {
        if (controller.signal.aborted) return;
        const fallback = marketProviders(market.city, market.state);
        if (!fallback.length) {
          if (!live) return;
          setProviders([]);
          setTrials({ studies: [], total: 0 });
          setTrialsAvailable(false);
          setError(e instanceof Error ? e.message : 'Public data unavailable.');
          setSource('none');
          setLoading(false);
          setLocationsLoading(false);
          setEnrichmentLoading(false);
          return;
        }
        found = fallback;
        sourceKind = 'demo';
      }

      if (!live) return;
      setProviders(found);
      setTerritory(scope);
      setSource(sourceKind);
      setSelectedNpi('');
      setLoading(false);

      // Enrichment is best-effort and parallel: a failing source degrades one
      // signal rather than the whole territory. allSettled never rejects, so
      // there is no path here that can take the ranked list back down.
      // Location is its own delivery path. A slow utilization or payment source
      // must not hold an already-resolved map in the "Locating" state.
      void geocodeProviders(found, controller.signal)
        .then(resolvedPoints => {
          if (!live) return;
          setPoints(resolvedPoints);
          setLocationsLoading(false);
        })
        .catch(() => {
          if (!live) return;
          setPoints([]);
          setLocationsLoading(false);
        });

      const targetNpis = found.map(provider => provider.number);
      setPaymentTargets(new Set(targetNpis));
      const [trialResult, utilizationResult, paymentResult] = await Promise.allSettled([
        fetchTrials(market.city, market.state, controller.signal),
        fetchUtilization(found, controller.signal),
        fetchPaymentsForAll(targetNpis, controller.signal),
      ]);
      if (!live) return;
      setTrials(trialResult.status === 'fulfilled' ? trialResult.value : { studies: [], total: 0 });
      setTrialsAvailable(trialResult.status === 'fulfilled');
      setUtilization(utilizationResult.status === 'fulfilled' ? utilizationResult.value.records : {});
      setUtilizationStatus(utilizationResult.status === 'fulfilled' ? utilizationResult.value.status : {});
      setPayments(paymentResult.status === 'fulfilled' ? paymentResult.value.records : {});
      setPaymentStatus(paymentResult.status === 'fulfilled' ? paymentResult.value.status : {});
      setEnrichmentLoading(false);
    })();
    return () => {
      live = false;
      controller.abort(new DOMException('Superseded territory load', 'AbortError'));
    };
  }, [market]);

  useEffect(() => { setAudit(NO_AUDIT); }, [selected?.number]);
  const onAudit = useCallback((summary: AuditSummary) => setAudit(summary), []);

  useEffect(() => {
    if (!tableExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTableExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tableExpanded]);

  // A filter can remove the selected row in either workspace. Keep the queue,
  // dossier and map pointed at the same visible result.
  useEffect(() => {
    if (loading || !visible.length) return;
    if (!visible.some(provider => provider.number === selectedNpi)) {
      setSelectedNpi(visible[0].number);
    }
  }, [loading, visible, selectedNpi]);

  useEffect(() => {
    if (mode !== 'accounts' || !accounts.length) return;
    if (!accounts.some(candidate => candidate.id === accountId)) setAccountId(accounts[0].id);
  }, [mode, accounts, accountId]);

  // A selection can originate from the map, table, account panel or colleague
  // list. If its queue row is outside the scrollport, bring it to the top so
  // the selected record is never highlighted somewhere the user cannot see.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = document.querySelector<HTMLElement>('.queue-list');
      const row = list?.querySelector<HTMLElement>('.qrow.on');
      if (!list || !row) return;
      const listBox = list.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return;
      list.scrollTo({ top: list.scrollTop + rowBox.top - listBox.top - 8, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, selectedNpi, accountId, focusRequest]);

  const openProvider = useCallback((npi: string) => {
    setAccountId('');
    setMode('providers');
    setSelectedNpi(npi);
    setFocusRequest(value => value + 1);
  }, []);

  const openProviderDossier = useCallback((npi: string) => {
    setWorkspaceView('dossier');
    setTableExpanded(false);
    openProvider(npi);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.stage-head h1')?.focus());
  }, [openProvider]);

  const openAccount = useCallback((id: string) => {
    setMode('accounts');
    setAccountId(id);
    setFocusRequest(value => value + 1);
  }, []);

  const showProviders = () => {
    if (account?.providers[0]) openProvider(account.providers[0].number);
    else { setMode('providers'); setAccountId(''); }
  };
  const showAccounts = () => {
    const id = (selectedAccount ?? accounts[0])?.id;
    if (id) openAccount(id);
    else { setMode('accounts'); setAccountId(''); }
  };
  const toggleVerification = () => {
    const next = !filters.needsVerification;
    setFilters({ ...filters, needsVerification: next });
    setMode('providers');
    setAccountId('');
    if (next) {
      const first = ranked.find(provider => provider.consensus.verifyBeforeCalling);
      if (first) setSelectedNpi(first.number);
    }
  };

  const toggleTableView = () => {
    if (workspaceView === 'table') {
      setWorkspaceView('dossier');
      setTableExpanded(false);
      return;
    }
    setWorkspaceView('table');
    setMode('providers');
    setAccountId('');
    if (!visible.some(provider => provider.number === selectedNpi)) {
      setSelectedNpi(visible[0]?.number ?? '');
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><img src="/tempus-mark.png" alt="" /></span>
          <span>
            <b>Tempus</b>
            <span className="brand-sub">Sales Copilot</span>
          </span>
        </div>

        <button
          className={`workspace-table-toggle${workspaceView === 'table' ? ' on' : ''}`}
          onClick={toggleTableView}
          aria-pressed={workspaceView === 'table'}
          aria-label="Doctor table view"
          title={workspaceView === 'table' ? 'Return to doctor profile' : 'Open doctor table'}
        >
          <Table2 />
          <span className="sr-only">Doctor table view</span>
        </button>

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
          {territory && territory.omitted > 0 && (
            <span
              className="chip"
              title={`NPPES resolved ${territory.total} oncology physicians from ${ORDERING_TAXONOMIES.length} configured NUCC taxonomy searches. Ranking and best-effort enrichment run on the first ${territory.working.length}, ordered by whether a CRM note or vendor row already exists for them. The rest remain outside the ranked working set.`}
            >
              <span className="dot" />
              {territory.working.length} of {territory.total} ranked
            </span>
          )}
          <button className="btn ghost" onClick={() => setMethodOpen(true)}>
            <Info />
            How this works
          </button>
        </div>
      </header>

      <div className={`work${workspaceView === 'table' ? ' table-mode' : ''}${tableExpanded ? ' table-full' : ''}`}>
        {workspaceView === 'table' ? (
          <main className={`provider-table-workspace${tableExpanded ? ' expanded' : ''}`}>
            {!tableExpanded && (
              <section className="provider-table-map" aria-label={`${market.city} territory map`}>
                <div className="provider-table-map-label">
                  <span className="eyebrow">Territory map</span>
                  <b>{market.city}, {market.state}</b>
                  <small>{locationsLoading ? `Locating ${visible.length} visible doctors` : `${mapPoints.length} of ${visible.length} visible doctors mapped`}</small>
                </div>
                <Suspense fallback={<div className="provider-table-map-loading"><span className="spinner" /> Loading map</div>}>
                  <TerritoryMap
                    city={market.city}
                    state={market.state}
                    points={mapPoints}
                    providers={mapProviders}
                    rankedProviders={ranked}
                    accounts={accounts}
                    mode="providers"
                    selectedNpi={selected?.number}
                    onSelect={openProvider}
                    onSelectAccount={openAccount}
                    onShowProviders={showProviders}
                    onShowAccounts={showAccounts}
                    activeFilters={activeFilters}
                    locating={locationsLoading}
                    fitRequest={fitRequest}
                    focusRequest={focusRequest}
                    layout="overview"
                    allowExpand={false}
                  />
                </Suspense>
              </section>
            )}

            {error ? (
              <div className="provider-table-error">
                <div className="err"><b>Could not load this market</b><span>{error}</span></div>
              </div>
            ) : (
              <ProviderTable
                providers={visible}
                ranked={ranked}
                territorySize={territory?.total}
                selectedNpi={selected?.number}
                mappedNpis={new Set(points.map(point => point.npi))}
                filters={filters}
                filterOptions={options}
                expanded={tableExpanded}
                loading={loading}
                enriching={enrichmentLoading}
                locating={locationsLoading}
                trialsAvailable={trialsAvailable}
                paymentTargets={paymentTargets}
                utilizationStatus={utilizationStatus}
                paymentStatus={paymentStatus}
                onFiltersChange={setFilters}
                onSelect={openProvider}
                onOpenProfile={openProviderDossier}
                onToggleExpanded={() => setTableExpanded(value => !value)}
              />
            )}
          </main>
        ) : (
          <>
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
                  data-top={rankByNpi.get(provider.number) ?? index + 1}
                  data-band={band(provider.score)}
                  onClick={() => openProvider(provider.number)}
                >
                  <span className="qrank">{rankByNpi.get(provider.number) ?? index + 1}</span>
                  <Headshot provider={provider} />
                  <span className="who">
                    <b>{displayName(provider)}</b>
                    {(provider.estimatedPatients || provider.crm || provider.consensus.verifyBeforeCalling) && (
                      <span className="sub">
                        {provider.consensus.verifyBeforeCalling && (
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
                    onClick={() => openAccount(item.id)}
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
                city={market.city}
                state={market.state}
                points={mapPoints}
                providers={mapProviders}
                rankedProviders={ranked}
                accounts={accounts}
                mode={mode}
                selectedNpi={account ? account.providers[0]?.number : selected?.number}
                selectedAccountId={account?.id}
                onSelect={openProvider}
                onSelectAccount={openAccount}
                onShowProviders={showProviders}
                onShowAccounts={showAccounts}
                activeFilters={activeFilters}
                locating={locationsLoading}
                fitRequest={fitRequest}
                focusRequest={focusRequest}
              />
            </Suspense>
          </div>
          <div className="stage-veil" />

          <aside className="stage-context" aria-label="Territory controls">
            <TerritoryControl
              city={market.city}
              state={market.state}
              providers={visible.length}
              accounts={accounts.length}
              mode={mode}
              contested={needsVerification}
              relevantTrials={mode === 'providers' ? relevantTrials : undefined}
              verificationActive={filters.needsVerification}
              onProviders={showProviders}
              onAccounts={showAccounts}
              onVerification={toggleVerification}
              onFit={() => setFitRequest(value => value + 1)}
            />
          </aside>

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
                      <h1 tabIndex={-1}>{account.probableInstitution?.name ?? account.site}</h1>
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
                      <span className="eyebrow">#{rankByNpi.get(selected.number) ?? 1} in the {market.city} working set</span>
                      <h1 tabIndex={-1}>{displayName(selected)}</h1>
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
                      value={selected.estimatedPatients
                        ? `~${selected.estimatedPatients.toLocaleString()}`
                        : selected.utilization?.beneficiaries.toLocaleString() ?? 'n/a'}
                      label={selected.estimatedPatients
                        ? selected.opportunityCorroborated ? 'est. patients · CMS row present' : 'est. patients · unverified model'
                        : selected.utilization ? 'CMS beneficiaries · fallback' : 'volume unavailable'}
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

                    {selectedAccount && selectedAccount.providers.length > 1 && (
                      <div className="same-site-inline">
                        <Card
                          title="Same site"
                          lede={`${selectedAccount.providers.length - 1} colleague${selectedAccount.providers.length === 2 ? '' : 's'} at this account`}
                        >
                          <div className="colleagues">
                            {selectedAccount.providers
                              .filter(provider => provider.number !== selected.number)
                              .slice(0, 5)
                              .map(provider => (
                                <button key={provider.number} className="colleague" onClick={() => openProvider(provider.number)}>
                                  <span className="cname">{displayName(provider)}</span>
                                  {provider.crm && <span className="cobj">{provider.crm.objection}</span>}
                                  <span className="cscore">{provider.score}</span>
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
                          <button className="ctx-link" onClick={() => openAccount(selectedAccount.id)}>
                            Open account view <ArrowRight style={{ width: 13 }} />
                          </button>
                        </Card>
                      </div>
                    )}

                    <div className="section-rule">
                      <span className="eyebrow">Evidence &amp; verification</span>
                      <span>everything the copy above rests on</span>
                    </div>

                    <TrustPanel provider={selected} all={ranked} audit={audit} />
                  </div>
                </div>

              </div>
            </>
          )}
        </main>
          </>
        )}
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
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !control.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const run = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div ref={control} className={`territory-control${open ? ' open' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="territory-trigger"
        aria-expanded={open}
        aria-controls="territory-tools"
        aria-haspopup="true"
        onClick={() => setOpen(value => !value)}
      >
        <LocateFixed />
        <span><b>{city} territory</b><small>{state} · map tools</small></span>
        <ChevronDown />
      </button>

      {open && <div id="territory-tools" className="context-card territory-popover">
        <div className="context-head">
          <h3>Map tools</h3>
          <span>{city}, {state}</span>
        </div>

        <div className="territory-modes" role="group" aria-label="Map view">
          <button className={mode === 'providers' ? 'on' : ''} onClick={() => run(onProviders)}>
            <User /><span>Providers</span><b>{providers}</b>
          </button>
          <button className={mode === 'accounts' ? 'on' : ''} onClick={() => run(onAccounts)}>
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
          onClick={() => run(onVerification)}
          disabled={contested === 0}
        >
          <AlertTriangle />
          <span>{verificationActive ? 'Showing' : 'Show'} records needing verification</span>
          <b>{contested}</b>
        </button>
        <button className="territory-action" onClick={() => run(onFit)}>
          <LocateFixed />
          <span>Fit map to current results</span>
        </button>
      </div>}
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
