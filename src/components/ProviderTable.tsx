import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  FilterX,
  MapPin,
  MapPinOff,
  Maximize2,
  Minimize2,
  Search,
} from 'lucide-react';
import { activeFilterCount, NO_FILTERS, type Filters } from '../lib/filters';
import { compact, displayName, practiceAddress, practicePhone, specialty } from '../lib/format';
import { marketRecordFor } from '../lib/market';
import type { LookupStatus } from '../lib/fetching';
import type { ScoredProvider } from '../lib/ranking';
import { matchTrialsToInterest } from '../lib/triggers';
import { Headshot } from './Headshot';

type FilterOptions = { objections: string[]; segments: string[] };

type Props = {
  providers: ScoredProvider[];
  ranked: ScoredProvider[];
  territorySize?: number;
  selectedNpi?: string;
  mappedNpis: Set<string>;
  paymentTargets: Set<string>;
  utilizationStatus: Record<string, LookupStatus>;
  paymentStatus: Record<string, LookupStatus>;
  filters: Filters;
  filterOptions: FilterOptions;
  expanded: boolean;
  loading: boolean;
  enriching: boolean;
  locating: boolean;
  trialsAvailable?: boolean;
  onFiltersChange: (filters: Filters) => void;
  onSelect: (npi: string) => void;
  onOpenProfile: (npi: string) => void;
  onToggleExpanded: () => void;
};

type SortKey =
  | 'rank'
  | 'name'
  | 'score'
  | 'estimatedPatients'
  | 'panelEligiblePatients'
  | 'panelFit'
  | 'opportunity'
  | 'localTrials'
  | 'marketTrials'
  | 'trialSignal'
  | 'engagement'
  | 'recency'
  | 'identity'
  | 'beneficiaries'
  | 'services'
  | 'medicarePayment'
  | 'payments'
  | 'contested'
  | 'lastContact';

type Sort = { key: SortKey; direction: 'asc' | 'desc' };

const DEFAULT_DIRECTION: Record<SortKey, Sort['direction']> = {
  rank: 'asc',
  name: 'asc',
  score: 'desc',
  estimatedPatients: 'desc',
  panelEligiblePatients: 'desc',
  panelFit: 'desc',
  opportunity: 'desc',
  localTrials: 'desc',
  marketTrials: 'desc',
  trialSignal: 'desc',
  engagement: 'desc',
  recency: 'desc',
  identity: 'desc',
  beneficiaries: 'desc',
  services: 'desc',
  medicarePayment: 'desc',
  payments: 'desc',
  contested: 'desc',
  lastContact: 'desc',
};

/**
 * One comparison surface for the entire physician territory.
 *
 * Missing enrichment is intentionally rendered as unavailable rather than 0.
 * CMS and Open Payments are best-effort sources, so absence is not evidence of
 * no utilization or no payments.
 */
export function ProviderTable({
  providers,
  ranked,
  territorySize,
  selectedNpi,
  mappedNpis,
  paymentTargets,
  utilizationStatus,
  paymentStatus,
  filters,
  filterOptions,
  expanded,
  loading,
  enriching,
  locating,
  trialsAvailable,
  onFiltersChange,
  onSelect,
  onOpenProfile,
  onToggleExpanded,
}: Props) {
  const [sort, setSort] = useState<Sort>({ key: 'rank', direction: 'asc' });
  const marketRank = useMemo(
    () => new Map(ranked.map((provider, index) => [provider.number, index + 1])),
    [ranked],
  );

  const ordered = useMemo(() => {
    const value = (provider: ScoredProvider): string | number | undefined => {
      switch (sort.key) {
        case 'rank': return marketRank.get(provider.number);
        case 'name': return displayName(provider);
        case 'score': return provider.score;
        case 'estimatedPatients': return provider.estimatedPatients;
        case 'panelEligiblePatients': return provider.estimatedPatients === undefined ? undefined : provider.panelEligiblePatients;
        case 'panelFit': return provider.panelFit;
        case 'opportunity': return provider.opportunity;
        case 'localTrials': return trialsAvailable ? provider.cityTrials.length : undefined;
        case 'marketTrials': return trialsAvailable ? provider.marketTrials : undefined;
        case 'trialSignal': return trialsAvailable ? provider.trialSignal : undefined;
        case 'engagement': return provider.crm ? provider.engagement : undefined;
        case 'recency': return provider.recency;
        case 'identity': return provider.identity;
        case 'beneficiaries': return provider.utilization?.beneficiaries;
        case 'services': return provider.utilization?.services;
        case 'medicarePayment': return provider.utilization?.medicarePayment;
        case 'payments': return provider.payments?.totalUsd;
        case 'contested': return provider.consensus.verifyBeforeCalling
          ? 1000 + provider.consensus.contested * 100 + (100 - provider.consensus.confidence)
          : 0;
        case 'lastContact': return provider.crm?.lastContact;
      }
    };

    return [...providers].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const leftMissing = left === undefined || left === '';
      const rightMissing = right === undefined || right === '';
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (leftMissing && rightMissing) {
        return (marketRank.get(a.number) ?? 0) - (marketRank.get(b.number) ?? 0);
      }
      const comparison = typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right)
        : Number(left) - Number(right);
      if (comparison) return sort.direction === 'asc' ? comparison : -comparison;
      return (marketRank.get(a.number) ?? 0) - (marketRank.get(b.number) ?? 0);
    });
  }, [providers, marketRank, sort, trialsAvailable]);

  const totals = useMemo(() => ({
    patients: providers.reduce((sum, provider) => sum + (provider.estimatedPatients ?? 0), 0),
    eligible: providers.reduce((sum, provider) => sum + provider.panelEligiblePatients, 0),
    estimateCoverage: providers.filter(provider => provider.estimatedPatients !== undefined).length,
    meanScore: providers.length
      ? Math.round(providers.reduce((sum, provider) => sum + provider.score, 0) / providers.length)
      : 0,
    verify: providers.filter(provider => provider.consensus.verifyBeforeCalling).length,
  }), [providers]);

  const updateSort = (key: SortKey) => {
    setSort(current => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: DEFAULT_DIRECTION[key] });
  };

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <section className="provider-table-panel" aria-label="Doctor metrics table" aria-busy={loading || enriching}>
      <header className="provider-table-head">
        <div className="provider-table-title">
          <span className="eyebrow">Doctor comparison</span>
          <div>
            <h1>Ranked doctors</h1>
            <span aria-live="polite" aria-atomic="true">
              {providers.length} visible · {ranked.length} ranked
              {territorySize && territorySize > ranked.length ? ` · ${territorySize} in territory` : ''}
            </span>
            {enriching && <span className="table-enriching" role="status"><i /> Completing public metrics</span>}
          </div>
        </div>

        <div className="provider-table-summary" aria-label="Visible doctor summary">
          <Summary value={totals.meanScore || 'n/a'} label="mean priority" />
          <Summary
            value={totals.patients ? `~${compact(totals.patients)}` : 'n/a'}
            label={`est. patients · ${totals.estimateCoverage}/${providers.length}`}
          />
          <Summary
            value={totals.estimateCoverage ? `~${compact(totals.eligible)}` : 'n/a'}
            label={`panel fit / yr · ${totals.estimateCoverage}/${providers.length}`}
          />
          <Summary value={totals.verify} label="need review" tone={totals.verify ? 'warn' : 'ok'} />
        </div>

        <button
          className="table-expand"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          title={expanded ? 'Restore map and navigation' : 'Expand to full table'}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
          <span>{expanded ? 'Restore view' : 'Full table'}</span>
        </button>
      </header>

      <div className="provider-table-tools">
        <label className="table-search">
          <Search />
          <span className="sr-only">Filter doctors by name</span>
          <input
            placeholder="Filter doctors"
            value={filters.query}
            onChange={event => updateFilter('query', event.target.value)}
          />
        </label>
        <button
          className={`table-filter${filters.needsVerification ? ' on warn' : ''}`}
          onClick={() => updateFilter('needsVerification', !filters.needsVerification)}
          aria-pressed={filters.needsVerification}
        >
          <AlertTriangle /> Needs verifying
        </button>
        <button
          className={`table-filter${filters.hasNote ? ' on' : ''}`}
          onClick={() => updateFilter('hasNote', !filters.hasNote)}
          aria-pressed={filters.hasNote}
        >
          Has CRM note
        </button>
        {filterOptions.segments.length > 1 && (
          <select
            aria-label="Filter by segment"
            className={`table-select${filters.segment !== 'all' ? ' on' : ''}`}
            value={filters.segment}
            onChange={event => updateFilter('segment', event.target.value)}
          >
            <option value="all">All segments</option>
            {filterOptions.segments.map(segment => <option key={segment}>{segment}</option>)}
          </select>
        )}
        {filterOptions.objections.length > 1 && (
          <select
            aria-label="Filter by concern"
            className={`table-select concern${filters.objection !== 'all' ? ' on' : ''}`}
            value={filters.objection}
            onChange={event => updateFilter('objection', event.target.value)}
          >
            <option value="all">All concerns</option>
            {filterOptions.objections.map(objection => <option key={objection}>{objection}</option>)}
          </select>
        )}
        {activeFilterCount(filters) > 0 && (
          <button className="table-clear" onClick={() => onFiltersChange(NO_FILTERS)}>
            <FilterX /> Clear
          </button>
        )}
        <span className="table-scroll-hint">Scroll sideways for every metric</span>
      </div>

      <div className="provider-table-scroll">
        <table className="provider-table">
          <thead>
            <tr className="table-groups" aria-hidden="true">
              <th colSpan={2}>Doctor</th>
              <th colSpan={3}>Priority</th>
              <th colSpan={5}>Patient opportunity</th>
              <th colSpan={5}>Panel and demand</th>
              <th colSpan={4}>Ranking signals</th>
              <th colSpan={6}>Evidence and activity</th>
              <th colSpan={3}>Tumour mix, modelled</th>
              <th colSpan={4}>Contact</th>
            </tr>
            <tr>
              <SortHeader label="Rank" detail="ranked" sortKey="rank" sort={sort} onSort={updateSort} className="rank-col" />
              <SortHeader label="Doctor" detail="specialty" sortKey="name" sort={sort} onSort={updateSort} className="doctor-col" />
              <SortHeader label="Priority" detail="/ 100" sortKey="score" sort={sort} onSort={updateSort} />
              <SortHeader label="Opportunity" detail="signal" sortKey="opportunity" sort={sort} onSort={updateSort} />
              <th><span>Weighted</span><small>drivers</small></th>

              <SortHeader label="Patients" detail="est. / yr" sortKey="estimatedPatients" sort={sort} onSort={updateSort} />
              <SortHeader label="Panel fit" detail="est. / yr" sortKey="panelEligiblePatients" sort={sort} onSort={updateSort} />
              <SortHeader label="Beneficiaries" detail={`${Object.keys(utilizationStatus).length}/${ranked.length} CMS`} sortKey="beneficiaries" sort={sort} onSort={updateSort} />
              <SortHeader label="Services" detail="CMS" sortKey="services" sort={sort} onSort={updateSort} />
              <SortHeader label="Medicare paid" detail="CMS" sortKey="medicarePayment" sort={sort} onSort={updateSort} />

              <th><span>Panel</span><small>recommended</small></th>
              <SortHeader label="Fit score" detail="/ 100" sortKey="panelFit" sort={sort} onSort={updateSort} />
              <SortHeader label="City trials" detail="all fetched" sortKey="localTrials" sort={sort} onSort={updateSort} />
              <th><span>Interest match</span><small>CRM keywords</small></th>
              <SortHeader label="Market trials" detail="true total" sortKey="marketTrials" sort={sort} onSort={updateSort} />

              <SortHeader label="Trial signal" detail="/ 100" sortKey="trialSignal" sort={sort} onSort={updateSort} />
              <SortHeader label="Engagement" detail="/ 100" sortKey="engagement" sort={sort} onSort={updateSort} />
              <SortHeader label="Freshness" detail="/ 100" sortKey="recency" sort={sort} onSort={updateSort} />
              <SortHeader label="Identity" detail="/ 100" sortKey="identity" sort={sort} onSort={updateSort} />

              <SortHeader label="Review" detail="fields" sortKey="contested" sort={sort} onSort={updateSort} />
              <th><span>Source joins</span><small>exact + fuzzy</small></th>
              <SortHeader
                label="Open payments"
                detail={`${enriching ? paymentTargets.size : Object.keys(paymentStatus).length}/${ranked.length} ${enriching ? 'scheduled' : 'attempted'}`}
                sortKey="payments"
                sort={sort}
                onSort={updateSort}
              />
              <th><span>Competitors</span><small>detected</small></th>
              <th><span>Concern</span><small>CRM, simulated</small></th>
              <SortHeader label="Last contact" detail="CRM" sortKey="lastContact" sort={sort} onSort={updateSort} />

              <th><span>CRC / lung</span><small>vendor</small></th>
              <th><span>Breast / heme</span><small>vendor</small></th>
              <th><span>Insuff. tissue</span><small>vendor</small></th>

              <th><span>Practice</span><small>registry</small></th>
              <th><span>Phone</span><small>registry</small></th>
              <th><span>NPI</span><small>registry</small></th>
              <th className="open-cell"><span>Profile</span><small>full detail</small></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }, (_, index) => (
                <tr className="provider-table-skeleton" key={index} aria-hidden="true">
                  <td colSpan={32}><span /></td>
                </tr>
              ))
            ) : ordered.map(provider => {
              const rank = marketRank.get(provider.number) ?? 0;
              const selected = provider.number === selectedNpi;
              const mapped = mappedNpis.has(provider.number);
              const market = marketRecordFor(provider);
              const paymentTargeted = paymentTargets.has(provider.number);
              const cmsMissing = enriching
                ? 'Loading'
                : missingLookupLabel(utilizationStatus[provider.number], 'No 2024 row');
              const paymentMissing = enriching && paymentTargeted
                ? 'Loading'
                : missingLookupLabel(paymentStatus[provider.number], 'No records');
              const relevantTrials = matchTrialsToInterest(provider.cityTrials, provider.crm?.interest).length;
              const components = provider.components
                .slice()
                .sort((a, b) => b.contribution - a.contribution)
                .slice(0, 2);

              return (
                <tr
                  key={provider.number}
                  className={selected ? 'selected' : ''}
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onSelect(provider.number)}
                  onDoubleClick={() => onOpenProfile(provider.number)}
                  onKeyDown={event => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelect(provider.number);
                  }}
                >
                  <td className="rank-col">
                    <span className="table-rank" data-top={rank <= 3 ? rank : undefined}>{rank}</span>
                  </td>
                  <th scope="row" className="doctor-col">
                    <span className="table-doctor">
                      <Headshot provider={provider} />
                      <span>
                        <b>{displayName(provider)}</b>
                        <small>{specialty(provider)}{provider.segment ? ` · ${provider.segment}` : ''}</small>
                      </span>
                    </span>
                  </th>
                  <td><Metric value={provider.score} emphasis /></td>
                  <td><Metric value={provider.opportunity} meter /></td>
                  <td className="drivers-cell">
                    {components.map(component => (
                      <span key={component.key} title={`${component.label}: ${component.value}/100 × ${Math.round(component.weight * 100)}%`}>
                        {shortDriver(component.key)} <b>{component.contribution}</b>
                      </span>
                    ))}
                  </td>

                  <td>{provider.estimatedPatients !== undefined
                    ? <Value primary={`~${provider.estimatedPatients.toLocaleString()}`} secondary={provider.opportunityCorroborated ? 'CMS record present' : 'unverified model'} tone={provider.opportunityCorroborated ? 'ok' : 'warn'} />
                    : <Unavailable />}
                  </td>
                  <td>{provider.estimatedPatients !== undefined
                    ? <Value primary={`~${provider.panelEligiblePatients.toLocaleString()}`} secondary="modelled" />
                    : <Unavailable />}
                  </td>
                  <td>{provider.utilization
                    ? <Value primary={provider.utilization.beneficiaries.toLocaleString()} secondary={String(provider.utilization.year)} />
                    : <Unavailable label={cmsMissing} />}
                  </td>
                  <td>{provider.utilization
                    ? <Value primary={provider.utilization.services.toLocaleString()} secondary={`${provider.utilization.hcpcsCodes} HCPCS`} />
                    : <Unavailable label={cmsMissing} />}
                  </td>
                  <td>{provider.utilization
                    ? <Value primary={usd(provider.utilization.medicarePayment)} secondary="Original Medicare" />
                    : <Unavailable label={cmsMissing} />}
                  </td>

                  <td><Value primary={provider.panelAssay} secondary={provider.panelRationale} truncate /></td>
                  <td><Metric value={provider.panelFit} meter /></td>
                  <td>{trialsAvailable === undefined
                    ? <Unavailable label="Loading" />
                    : trialsAvailable ? <Metric value={provider.cityTrials.length} /> : <Unavailable />}
                  </td>
                  <td>{!provider.crm?.interest
                    ? <Unavailable label="No CRM interest" />
                    : trialsAvailable === undefined
                      ? <Unavailable label="Loading" />
                      : trialsAvailable ? <Metric value={relevantTrials} /> : <Unavailable />}
                  </td>
                  <td>{trialsAvailable === undefined
                    ? <Unavailable label="Loading" />
                    : trialsAvailable
                      ? <Value primary={provider.marketTrials.toLocaleString()} secondary="recruiting" />
                      : <Unavailable />}
                  </td>

                  <td>{trialsAvailable === undefined
                    ? <Unavailable label="Loading" />
                    : trialsAvailable ? <Metric value={provider.trialSignal} meter /> : <Unavailable />}
                  </td>
                  <td>{provider.crm
                    ? <Metric value={provider.engagement} meter />
                    : <Unavailable label="No CRM note" />}
                  </td>
                  <td><Metric value={provider.recency} meter /></td>
                  <td><Metric value={provider.identity} meter tone={provider.identity < 50 ? 'warn' : 'ok'} /></td>

                  <td>{provider.consensus.verifyBeforeCalling
                    ? <Value
                        primary={provider.consensus.contested ? `${provider.consensus.contested} contested` : 'Low confidence'}
                        secondary="verify first"
                        tone="warn"
                        icon={<AlertTriangle />}
                      />
                    : <Value primary="Clear" secondary={`${provider.consensus.confidence}/100 confidence`} tone="ok" icon={<CheckCircle2 />} />}
                  </td>
                  <td><Value primary={`${provider.consensus.exactJoins} exact`} secondary={`${provider.consensus.probabilisticJoins} probabilistic`} /></td>
                  <td>{provider.payments
                    ? <Value
                        primary={usd(provider.payments.totalUsd)}
                        secondary={`${provider.payments.records} record${provider.payments.records === 1 ? '' : 's'}${provider.payments.latestDate ? ` · ${provider.payments.latestDate}` : ''}`}
                        truncate
                      />
                    : <Unavailable label={paymentMissing} />}
                  </td>
                  <td>{provider.payments
                    ? <Value primary={String(provider.payments.competitors.length)} secondary={provider.payments.competitors.join(', ') || 'none detected'} truncate />
                    : <Unavailable label={paymentMissing} />}
                  </td>
                  <td>{provider.crm
                    ? <Value primary={provider.crm.objection || 'No concern'} secondary={provider.crm.interest || 'No interest logged'} truncate tone="sim" />
                    : <Unavailable label="No note" />}
                  </td>
                  <td>{provider.crm
                    ? <Value primary={provider.crm.lastContact} secondary="simulated CRM" tone="sim" />
                    : <Unavailable label="No note" />}
                  </td>

                  <td>{market
                    ? <Value primary={`${market.mix.colorectal}% / ${market.mix.lung}%`} secondary="CRC / lung" />
                    : <Unavailable />}
                  </td>
                  <td>{market
                    ? <Value primary={`${market.mix.breast}% / ${market.mix.heme}%`} secondary="breast / heme" />
                    : <Unavailable />}
                  </td>
                  <td>{market
                    ? <Value primary={`${Math.round(market.insufficientTissueRate * 100)}%`} secondary="modelled" />
                    : <Unavailable />}
                  </td>

                  <td className="practice-cell">
                    <Value
                      primary={practiceAddress(provider) || 'Unavailable'}
                      secondary={mapped ? 'Mapped' : locating ? 'Locating' : 'Not mapped'}
                      icon={mapped ? <MapPin /> : <MapPinOff />}
                      tone={mapped ? undefined : 'muted'}
                      truncate
                    />
                  </td>
                  <td><span className="table-mono">{practicePhone(provider) || 'Unavailable'}</span></td>
                  <td>
                    <Value
                      primary={provider.number}
                      secondary={`${provider.basic.status === 'A' ? 'Active' : provider.basic.status || 'Status unavailable'}${provider.basic.last_updated ? ` · updated ${provider.basic.last_updated}` : ''}`}
                      truncate
                    />
                  </td>
                  <td className="open-cell">
                    <button
                      className="table-open-profile"
                      onClick={event => {
                        event.stopPropagation();
                        onOpenProfile(provider.number);
                      }}
                      aria-label={`Open profile for ${displayName(provider)}`}
                      title="Open full profile"
                    >
                      <ArrowRight />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && !ordered.length && (
          <div className="provider-table-empty" role="status">
            <b>No doctors match these filters.</b>
            <button onClick={() => onFiltersChange(NO_FILTERS)}>Clear filters</button>
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ value, label, tone }: { value: string | number; label: string; tone?: 'ok' | 'warn' }) {
  return <div data-tone={tone}><b>{value}</b><span>{label}</span></div>;
}

function SortHeader({
  label,
  detail,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  detail: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(sortKey)}>
        <span>{label}</span>
        <small>{detail}</small>
        {active
          ? sort.direction === 'asc' ? <ArrowUp /> : <ArrowDown />
          : <ArrowUpDown />}
      </button>
    </th>
  );
}

function Metric({
  value,
  meter,
  emphasis,
  muted,
  tone,
}: {
  value: number;
  meter?: boolean;
  emphasis?: boolean;
  muted?: boolean;
  tone?: 'ok' | 'warn';
}) {
  return (
    <span
      className={`table-metric${meter ? ' with-meter' : ''}${emphasis ? ' emphasis' : ''}${muted ? ' muted' : ''}`}
      data-tone={tone}
    >
      <b>{value}</b>
      {meter && <i><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>}
    </span>
  );
}

function Value({
  primary,
  secondary,
  tone,
  icon,
  truncate,
}: {
  primary: string;
  secondary?: string;
  tone?: 'ok' | 'warn' | 'sim' | 'muted';
  icon?: ReactNode;
  truncate?: boolean;
}) {
  return (
    <span className={`table-value${truncate ? ' truncate' : ''}`} data-tone={tone} title={truncate ? [primary, secondary].filter(Boolean).join(' · ') : undefined}>
      <b>{icon}{primary}</b>
      {secondary && <small>{secondary}</small>}
    </span>
  );
}

function Unavailable({ label = 'Unavailable' }: { label?: string }) {
  return <span className="table-unavailable">{label}</span>;
}

function missingLookupLabel(status: LookupStatus | undefined, empty: string) {
  if (status === 'empty') return empty;
  if (status === 'error') return 'Fetch failed';
  return 'Not queried';
}

function shortDriver(key: string) {
  const names: Record<string, string> = {
    opportunity: 'Opp.',
    panelFit: 'Fit',
    trialSignal: 'Trials',
    engagement: 'Eng.',
    recency: 'Fresh',
    identity: 'ID',
  };
  return names[key] ?? key;
}

function usd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}
