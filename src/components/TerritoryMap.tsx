import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  MapPin,
  MapPinOff,
  Maximize2,
  Minimize2,
  User,
} from 'lucide-react';
import { MAPBOX_TOKEN } from '../api';
import type { Account } from '../lib/accounts';
import { compact, displayName, practiceAddress, specialty } from '../lib/format';
import type { ScoredProvider } from '../lib/ranking';
import type { ProviderPoint } from '../types';

type Mode = 'providers' | 'accounts';

type Props = {
  city: string;
  state: string;
  points: ProviderPoint[];
  providers: ScoredProvider[];
  /** The complete scored working set, so filters never renumber visible pins. */
  rankedProviders?: ScoredProvider[];
  accounts: Account[];
  mode: Mode;
  selectedNpi?: string;
  selectedAccountId?: string;
  onSelect: (npi: string) => void;
  onSelectAccount: (id: string) => void;
  onShowProviders: () => void;
  onShowAccounts: () => void;
  activeFilters: number;
  locating: boolean;
  /** Symmetric framing for a standalone overview, or offset framing behind the dossier. */
  layout?: 'stage' | 'overview';
  /** The table overview owns its own expansion control, so its map can opt out. */
  allowExpand?: boolean;
  /** Incremented by the territory control to reframe the current result set. */
  fitRequest?: number;
  /** Incremented by list/profile actions, including repeat clicks, to refocus selection. */
  focusRequest?: number;
};

type ProviderFeature = {
  kind: 'providers';
  id: string;
  coordinates: [number, number];
  providers: ScoredProvider[];
  primary: ScoredProvider;
  rank: number;
};

type AccountFeature = {
  kind: 'accounts';
  id: string;
  coordinates: [number, number];
  accounts: Account[];
  primary: Account;
};

type MapFeature = ProviderFeature | AccountFeature;

/**
 * A territory lens in the workspace and a territory explorer when expanded.
 *
 * The compact surface preserves geographic context. Expansion adds the rank,
 * coverage, selected-record detail and result queue that make the geography
 * actionable; it is no longer just a larger basemap.
 */
export function TerritoryMap({
  city,
  state,
  points,
  providers,
  rankedProviders,
  accounts,
  mode,
  selectedNpi,
  selectedAccountId,
  onSelect,
  onSelectAccount,
  onShowProviders,
  onShowAccounts,
  activeFilters,
  locating,
  layout = 'stage',
  allowExpand = true,
  fitRequest,
  focusRequest,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker[]>>(new Map());
  const expansionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraIntent = useRef<'overview' | 'selection'>('selection');
  const cameraInitialized = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const onSelectRef = useRef(onSelect);
  const onSelectAccountRef = useRef(onSelectAccount);
  onSelectRef.current = onSelect;
  onSelectAccountRef.current = onSelectAccount;

  const pointByNpi = useMemo(
    () => new Map(points.map(point => [point.npi, point] as const)),
    [points],
  );
  const mappedProviderIds = useMemo(() => new Set(points.map(point => point.npi)), [points]);
  const mappedAccountIds = useMemo(
    () => new Set(accounts.filter(account => account.providers.some(provider => mappedProviderIds.has(provider.number))).map(account => account.id)),
    [accounts, mappedProviderIds],
  );
  const rankByNpi = useMemo(
    () => new Map((rankedProviders ?? providers).map((provider, index) => [provider.number, index + 1])),
    [rankedProviders, providers],
  );
  const features = useMemo<MapFeature[]>(
    () => mode === 'providers'
      ? buildProviderFeatures(providers, pointByNpi, rankByNpi)
      : buildAccountFeatures(accounts, pointByNpi),
    [mode, providers, accounts, pointByNpi, rankByNpi],
  );

  const selectedProvider = providers.find(provider => provider.number === selectedNpi);
  const selectedAccount = accounts.find(account => account.id === selectedAccountId);
  const selectedKey = mode === 'providers'
    ? selectedNpi ? `provider:${selectedNpi}` : ''
    : selectedAccountId ? `account:${selectedAccountId}` : '';
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const selectionCoordinates = useMemo(
    () => mode === 'providers'
      ? uniqueCoordinates(selectedNpi && pointByNpi.has(selectedNpi)
        ? [[pointByNpi.get(selectedNpi)!.longitude, pointByNpi.get(selectedNpi)!.latitude]]
        : [])
      : uniqueCoordinates((selectedAccount?.providers ?? []).flatMap(provider => {
        const point = pointByNpi.get(provider.number);
        return point ? [[point.longitude, point.latitude] as [number, number]] : [];
      })),
    [mode, selectedNpi, selectedAccount, pointByNpi],
  );
  const spatialSignature = useMemo(
    () => features.map(feature => `${feature.kind}:${feature.id}`).sort().join('|'),
    [features],
  );
  const selectionSpatialSignature = useMemo(
    () => selectionCoordinates.map(coordinates => coordinates.join(',')).sort().join('|'),
    [selectionCoordinates],
  );
  const expandedRef = useRef(expanded);
  const selectionCoordinatesRef = useRef(selectionCoordinates);
  const mapReadyRef = useRef(mapReady);
  const showSelectionRef = useRef(showSelection);
  const showOverviewRef = useRef(showOverview);
  expandedRef.current = expanded;
  selectionCoordinatesRef.current = selectionCoordinates;
  mapReadyRef.current = mapReady;
  showSelectionRef.current = showSelection;
  showOverviewRef.current = showOverview;
  const resultCount = mode === 'providers' ? providers.length : accounts.length;
  const mappedCount = mode === 'providers' ? mappedProviderIds.size : mappedAccountIds.size;
  const verificationCount = mode === 'providers'
    ? providers.filter(provider => provider.consensus.verifyBeforeCalling).length
    : accounts.filter(account => account.contested > 0).length;

  useEffect(() => {
    if (!container.current || map.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    try {
      const instance = new mapboxgl.Map({
        container: container.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-87.6298, 41.8781],
        zoom: 10,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      });
      map.current = instance;
      instance.touchZoomRotate.disableRotation();
      instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      instance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      instance.once('load', () => {
        setMapReady(true);
        instance.resize();
      });
      instance.on('error', event => {
        const message = event.error?.message ?? '';
        if (!instance.isStyleLoaded() && /401|403|access token|style/i.test(message)) setFailed(true);
      });
      requestAnimationFrame(() => instance.resize());
    } catch {
      map.current = null;
      setFailed(true);
      return;
    }
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Mapbox caches its canvas dimensions. Preserve deliberate manual panning on
  // ordinary resizes, but replay the camera when the responsive topology
  // changes or a selected site would otherwise fall outside the safe frame.
  useEffect(() => {
    if (!container.current) return;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let previousTopology = cameraLayoutKey();
    let topologyChangePending = false;
    const observer = new ResizeObserver(() => {
      map.current?.resize();
      const nextTopology = cameraLayoutKey();
      topologyChangePending ||= nextTopology !== previousTopology;
      previousTopology = nextTopology;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!mapReadyRef.current) return;
        if (expansionTimer.current) {
          topologyChangePending = false;
          return;
        }
        if (topologyChangePending) {
          topologyChangePending = false;
          if (cameraIntent.current === 'selection') showSelectionRef.current(240);
          else showOverviewRef.current(240);
          return;
        }
        if (cameraIntent.current === 'selection' && selectionIsOutsideFrame()) {
          showSelectionRef.current(240);
        }
      }, 140);
    });
    observer.observe(container.current);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        return;
      }
      if (event.key !== 'Tab' || !frame.current) return;
      const controls = [...frame.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter(element => element.offsetParent !== null && !element.hasAttribute('disabled'));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !frame.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  // Expansion opens on the whole current territory. Choosing a row or marker
  // after that cancels this delayed fit and moves to the selected result.
  useEffect(() => {
    if (expansionTimer.current) clearTimeout(expansionTimer.current);
    cameraIntent.current = expanded ? 'overview' : 'selection';
    expansionTimer.current = setTimeout(() => {
      map.current?.resize();
      if (expanded) showOverviewRef.current();
      else showSelectionRef.current();
      expansionTimer.current = null;
    }, 220);
    return () => {
      if (expansionTimer.current) clearTimeout(expansionTimer.current);
      expansionTimer.current = null;
    };
  }, [expanded]);

  // Rebuild the current layer, clearing first even when it becomes empty. The
  // old early return left stale pins behind after filters or account changes.
  useEffect(() => {
    clearMarkers(markers.current);
    if (!map.current || !mapReady || !features.length) return;

    for (const feature of features) {
      const element = markerElement(feature);
      element.onclick = () => {
        if (feature.kind === 'providers') {
          const selectedAtSite = feature.providers.find(provider => `provider:${provider.number}` === selectedKeyRef.current);
          onSelectRef.current((selectedAtSite ?? feature.primary).number);
        } else {
          const selectedAtSite = feature.accounts.find(account => `account:${account.id}` === selectedKeyRef.current);
          onSelectAccountRef.current((selectedAtSite ?? feature.primary).id);
        }
      };
      const marker = new mapboxgl.Marker({ element }).setLngLat(feature.coordinates).addTo(map.current);
      if (feature.kind === 'providers') {
        feature.providers.forEach(provider => addMarker(markers.current, `provider:${provider.number}`, marker));
      } else {
        feature.accounts.forEach(account => addMarker(markers.current, `account:${account.id}`, marker));
      }
    }

    markSelection(markers.current, selectedKey);
  }, [features, mapReady]);

  // A spatial result-set change (filtering, geocoding, or switching layers)
  // gets an overview. The first mapped result instead honors the initial
  // selected profile. Score-only enrichment cannot move the camera because it
  // does not change the spatial signature.
  useEffect(() => {
    if (!mapReady || !features.length) return;
    if (!cameraInitialized.current) {
      cameraInitialized.current = true;
      showSelection();
    } else {
      showOverview();
    }
  }, [spatialSignature, mapReady]);

  useEffect(() => {
    markSelection(markers.current, selectedKey);
    if (!mapReady) return;
    if (expansionTimer.current) {
      clearTimeout(expansionTimer.current);
      expansionTimer.current = null;
    }
    showSelection();
  }, [selectedKey, focusRequest, selectionSpatialSignature]);

  useEffect(() => {
    if (fitRequest === undefined) return;
    if (expansionTimer.current) {
      clearTimeout(expansionTimer.current);
      expansionTimer.current = null;
    }
    showOverview();
  }, [fitRequest]);

  function framePadding(): mapboxgl.PaddingOptions {
    const width = container.current?.clientWidth ?? 0;
    const height = container.current?.clientHeight ?? 0;
    const mobileExplorer = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const stackedWorkspace = typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches;
    if (expandedRef.current && mobileExplorer) {
      return { top: 52, right: 52, bottom: Math.round(height * 0.48) + 34, left: 42 };
    }
    if (expandedRef.current) return { top: 70, right: 72, bottom: 70, left: 414 };
    if (layout === 'overview') return { top: 42, right: 54, bottom: 48, left: 54 };
    if (stackedWorkspace) return { top: 40, right: 40, bottom: 40, left: 40 };
    return { top: 96, bottom: 80, right: 96, left: Math.round(width * 0.56) };
  }

  function cameraLayoutKey() {
    const mobileExplorer = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const stackedWorkspace = typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches;
    if (expandedRef.current) return mobileExplorer ? 'expanded-mobile' : 'expanded-desktop';
    if (layout === 'overview') return 'overview';
    return stackedWorkspace ? 'stage-stacked' : 'stage-desktop';
  }

  function selectionIsOutsideFrame() {
    const instance = map.current;
    const host = container.current;
    const coordinates = selectionCoordinatesRef.current;
    if (!instance || !host || !coordinates.length) return false;
    const padding = framePadding();
    const markerGutter = 18;
    const left = padding.left ?? 0;
    const right = padding.right ?? 0;
    const top = padding.top ?? 0;
    const bottom = padding.bottom ?? 0;
    return coordinates.some(coordinate => {
      const point = instance.project(coordinate);
      return point.x < left + markerGutter
        || point.x > host.clientWidth - right - markerGutter
        || point.y < top + markerGutter
        || point.y > host.clientHeight - bottom - markerGutter;
    });
  }

  function showOverview(duration = 550) {
    cameraIntent.current = 'overview';
    fitFeatures(map.current, features, framePadding(), duration);
  }

  function showSelection(duration = 650) {
    const selectedFeature = featureForSelection(features, selectedKey);
    if (!map.current || !selectedFeature || !selectionCoordinates.length) {
      showOverview(duration);
      return;
    }
    cameraIntent.current = 'selection';
    const selectedRecordCount = selectedFeature.kind === 'providers'
      ? selectedFeature.providers.length
      : selectedAccount?.providers.length ?? selectedFeature.primary.providers.length;
    focusSelection(
      map.current,
      selectionCoordinates,
      selectedFeature,
      features,
      selectedRecordCount,
      framePadding(),
      expanded,
      layout,
      duration,
    );
  }

  const loadingMessage = !mapReady ? 'Loading territory map' : locating ? 'Locating practices' : '';
  const emptyMessage = !locating && mapReady && resultCount > 0 && !mappedCount
    ? `No ${mode === 'providers' ? 'practice' : 'account'} locations could be mapped.`
    : '';

  return (
    <div
      className={`map-shell${expanded ? ' expanded' : ''}${layout === 'overview' ? ' overview' : ''}`}
      onMouseDown={event => {
        if (expanded && event.target === event.currentTarget) setExpanded(false);
      }}
    >
      <div ref={frame} className="map-frame" role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? `${city} territory explorer` : undefined}>
        <div ref={container} className="map-el" />

        {!MAPBOX_TOKEN && <div className="map-note">Set VITE_MAPBOX_TOKEN to enable the territory map.</div>}
        {failed && <div className="map-note">Map unavailable. Check WebGL and the Mapbox token.</div>}
        {MAPBOX_TOKEN && !failed && loadingMessage && (
          <div className="map-note"><span className="spinner" /> {loadingMessage}</div>
        )}
        {MAPBOX_TOKEN && !failed && emptyMessage && <div className="map-note">{emptyMessage}</div>}

        {!expanded && MAPBOX_TOKEN && !failed && !loadingMessage && mappedCount > 0 && (
          <div className="map-glance" aria-label={`${mappedCount} of ${resultCount} results mapped`}>
            <span>{mode === 'providers' ? 'Ranked providers' : 'Account coverage'}</span>
            <b>{mappedCount}<em> / {resultCount}</em></b>
            <small>{features.length} mapped location{features.length === 1 ? '' : 's'}</small>
          </div>
        )}

        {expanded && (
          <TerritoryExplorer
            city={city}
            state={state}
            mode={mode}
            providers={providers}
            accounts={accounts}
            selectedProvider={selectedProvider}
            selectedAccount={selectedAccount}
            mappedProviderIds={mappedProviderIds}
            mappedAccountIds={mappedAccountIds}
            mappedCount={mappedCount}
            locations={features.length}
            verificationCount={verificationCount}
            activeFilters={activeFilters}
            focusRequest={focusRequest}
            rankByNpi={rankByNpi}
            onSelect={onSelect}
            onSelectAccount={onSelectAccount}
            onShowProviders={onShowProviders}
            onShowAccounts={onShowAccounts}
            onOpenDossier={() => setExpanded(false)}
          />
        )}

        {allowExpand && !failed && MAPBOX_TOKEN && (
          <button
            className="map-expand"
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
            title={expanded ? 'Return to workspace' : 'Explore the ranked territory'}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
            {expanded ? 'Close map' : 'Explore territory'}
          </button>
        )}
      </div>
    </div>
  );
}

function TerritoryExplorer({
  city,
  state,
  mode,
  providers,
  accounts,
  selectedProvider,
  selectedAccount,
  mappedProviderIds,
  mappedAccountIds,
  mappedCount,
  locations,
  verificationCount,
  activeFilters,
  focusRequest,
  rankByNpi,
  onSelect,
  onSelectAccount,
  onShowProviders,
  onShowAccounts,
  onOpenDossier,
}: {
  city: string;
  state: string;
  mode: Mode;
  providers: ScoredProvider[];
  accounts: Account[];
  selectedProvider?: ScoredProvider;
  selectedAccount?: Account;
  mappedProviderIds: Set<string>;
  mappedAccountIds: Set<string>;
  mappedCount: number;
  locations: number;
  verificationCount: number;
  activeFilters: number;
  focusRequest?: number;
  rankByNpi: Map<string, number>;
  onSelect: (npi: string) => void;
  onSelectAccount: (id: string) => void;
  onShowProviders: () => void;
  onShowAccounts: () => void;
  onOpenDossier: () => void;
}) {
  const total = mode === 'providers' ? providers.length : accounts.length;
  const resultsRef = useRef<HTMLDivElement>(null);
  const selectedResultKey = mode === 'providers' ? selectedProvider?.number : selectedAccount?.id;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = resultsRef.current;
      const row = list?.querySelector<HTMLElement>('.explorer-result.on');
      if (!list || !row) return;
      const listBox = list.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return;
      list.scrollTo({ top: list.scrollTop + rowBox.top - listBox.top - 5, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedResultKey, focusRequest]);

  return (
    <aside className="territory-explorer">
      <header className="explorer-head">
        <span className="eyebrow">Territory explorer</span>
        <h2>{city}, {state}</h2>
        <p>
          {mappedCount} of {total} visible {mode} mapped across {locations} location{locations === 1 ? '' : 's'}.
          {activeFilters > 0 && ` ${activeFilters} active filter${activeFilters === 1 ? '' : 's'}.`}
        </p>
      </header>

      <div className="explorer-modes" role="group" aria-label="Territory layer">
        <button className={mode === 'providers' ? 'on' : ''} onClick={onShowProviders}>
          <User /> Providers <b>{providers.length}</b>
        </button>
        <button className={mode === 'accounts' ? 'on' : ''} onClick={onShowAccounts}>
          <Building2 /> Accounts <b>{accounts.length}</b>
        </button>
      </div>

      <div className="explorer-metrics">
        <div><b>{mappedCount}</b><span>mapped</span></div>
        <div><b>{locations}</b><span>locations</span></div>
        <div data-tone={verificationCount > 0 ? 'warn' : undefined}><b>{verificationCount}</b><span>to verify</span></div>
      </div>

      <div className="explorer-legend" aria-label="Map marker legend">
        <span><i className="legend-rank">1</i> best rank at site</span>
        <span><i className="legend-count">3</i> grouped records</span>
        <span><AlertTriangle /> verify</span>
      </div>

      {mode === 'providers' && selectedProvider && (
        <ProviderFocus
          provider={selectedProvider}
          rank={rankByNpi.get(selectedProvider.number) ?? 0}
          mapped={mappedProviderIds.has(selectedProvider.number)}
          onOpen={onOpenDossier}
        />
      )}
      {mode === 'accounts' && selectedAccount && (
        <AccountFocus
          account={selectedAccount}
          mapped={mappedAccountIds.has(selectedAccount.id)}
          onOpen={onOpenDossier}
        />
      )}

      <div className="explorer-list-head">
        <b>{mode === 'providers' ? 'Priority queue' : 'Account coverage'}</b>
        <span>{mode === 'providers' ? 'ranked by impact' : 'ranked by oncologists'}</span>
      </div>

      <div ref={resultsRef} className="explorer-results">
        {mode === 'providers' ? providers.map(provider => {
          const isSelected = provider.number === selectedProvider?.number;
          const isMapped = mappedProviderIds.has(provider.number);
          return (
            <button
              key={provider.number}
              className={`explorer-result${isSelected ? ' on' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(provider.number)}
            >
              <span className="result-rank">{rankByNpi.get(provider.number) ?? '–'}</span>
              <span className="result-main">
                <b>{displayName(provider)}</b>
                <small>{provider.panelAssay} · {provider.panelEligiblePatients ? `~${compact(provider.panelEligiblePatients)} modelled fit` : specialty(provider)}</small>
              </span>
              <span className={`result-location${isMapped ? '' : ' unavailable'}`} title={isMapped ? 'Location mapped' : 'Location unavailable'}>
                {isMapped ? <MapPin /> : <MapPinOff />}
              </span>
              <span className="result-score">{provider.score}</span>
            </button>
          );
        }) : accounts.map((account, index) => {
          const isSelected = account.id === selectedAccount?.id;
          const isMapped = mappedAccountIds.has(account.id);
          return (
            <button
              key={account.id}
              className={`explorer-result${isSelected ? ' on' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelectAccount(account.id)}
            >
              <span className="result-rank">{index + 1}</span>
              <span className="result-main">
                <b>{account.probableInstitution?.name ?? account.site}</b>
                <small>{account.providers.length} oncologist{account.providers.length === 1 ? '' : 's'} · top score {account.topScore}</small>
              </span>
              <span className={`result-location${isMapped ? '' : ' unavailable'}`} title={isMapped ? 'Location mapped' : 'Location unavailable'}>
                {isMapped ? <MapPin /> : <MapPinOff />}
              </span>
              <span className="result-score">{account.providers.length}</span>
            </button>
          );
        })}
        {!total && <div className="explorer-empty">No results match the current filters.</div>}
      </div>
    </aside>
  );
}

function ProviderFocus({ provider, rank, mapped, onOpen }: { provider: ScoredProvider; rank: number; mapped: boolean; onOpen: () => void }) {
  return (
    <section className="explorer-focus">
      <div className="focus-kicker">
        <span>#{Math.max(rank, 1)} priority</span>
        <b>{provider.score}<em>/100</em></b>
      </div>
      <h3>{displayName(provider)}</h3>
      <p>{specialty(provider)}</p>
      <div className="focus-address">
        {mapped ? <MapPin /> : <MapPinOff />}
        <span>{practiceAddress(provider) || 'Practice location unavailable'}</span>
      </div>
      <div className="focus-facts">
        <div><b>{provider.panelEligiblePatients ? `~${compact(provider.panelEligiblePatients)}` : 'n/a'}</b><span>modelled panel fit / yr</span></div>
        <div><b>{provider.panelAssay}</b><span>recommended panel</span></div>
        <div data-tone={provider.consensus.contested > 0 ? 'warn' : 'ok'}>
          <b>{provider.consensus.contested > 0 ? provider.consensus.contested : 'Clear'}</b>
          <span>{provider.consensus.contested > 0 ? 'fields to verify' : 'identity record'}</span>
        </div>
      </div>
      {provider.crm?.objection && (
        <div className="focus-concern"><span>Known concern</span><b>{provider.crm.objection}</b></div>
      )}
      <button className="explorer-open" onClick={onOpen}>Open full profile <ArrowRight /></button>
    </section>
  );
}

function AccountFocus({ account, mapped, onOpen }: { account: Account; mapped: boolean; onOpen: () => void }) {
  const shared = account.themes.find(theme => theme.count > 1);
  return (
    <section className="explorer-focus">
      <div className="focus-kicker">
        <span>{account.sites.length} site{account.sites.length === 1 ? '' : 's'}</span>
        <b>{account.providers.length}<em> oncologists</em></b>
      </div>
      <h3>{account.probableInstitution?.name ?? account.site}</h3>
      <p>{account.probableInstitution ? 'Institution asserted by a source, unverified' : 'NPPES practice site'}</p>
      <div className="focus-address">
        {mapped ? <MapPin /> : <MapPinOff />}
        <span>{account.site}, {account.city}, {account.state} {account.zip}</span>
      </div>
      <div className="focus-facts">
        <div><b>{account.topScore}</b><span>top provider score</span></div>
        <div><b>{account.beneficiaries ? compact(account.beneficiaries) : 'n/a'}</b><span>CMS beneficiaries</span></div>
        <div data-tone={account.contested > 0 ? 'warn' : 'ok'}><b>{account.contested || 'Clear'}</b><span>{account.contested ? 'records to verify' : 'identity records'}</span></div>
      </div>
      {shared && (
        <div className="focus-concern"><span>Shared site concern · {shared.count} physicians</span><b>{shared.objection}</b></div>
      )}
      <button className="explorer-open" onClick={onOpen}>Open account dossier <ArrowRight /></button>
    </section>
  );
}

function buildProviderFeatures(
  providers: ScoredProvider[],
  pointByNpi: Map<string, ProviderPoint>,
  rankByNpi: Map<string, number>,
): ProviderFeature[] {
  const sites = new Map<string, { coordinates: [number, number]; providers: ScoredProvider[] }>();

  for (const provider of providers) {
    const point = pointByNpi.get(provider.number);
    if (!point) continue;
    const key = `${point.longitude.toFixed(5)},${point.latitude.toFixed(5)}`;
    const site = sites.get(key) ?? { coordinates: [point.longitude, point.latitude] as [number, number], providers: [] };
    site.providers.push(provider);
    sites.set(key, site);
  }

  return [...sites.entries()].map(([id, site]) => ({
    kind: 'providers',
    id,
    coordinates: site.coordinates,
    providers: site.providers,
    primary: site.providers[0],
    rank: rankByNpi.get(site.providers[0].number) ?? 1,
  }));
}

function buildAccountFeatures(accounts: Account[], pointByNpi: Map<string, ProviderPoint>): AccountFeature[] {
  const sites = new Map<string, { coordinates: [number, number]; accounts: Account[] }>();
  for (const account of accounts) {
    const coordinates = uniqueCoordinates(account.providers.flatMap(provider => {
      const point = pointByNpi.get(provider.number);
      return point ? [[point.longitude, point.latitude] as [number, number]] : [];
    }));
    for (const location of coordinates) {
      const key = `${location[0].toFixed(5)},${location[1].toFixed(5)}`;
      const site = sites.get(key) ?? { coordinates: location, accounts: [] };
      site.accounts.push(account);
      sites.set(key, site);
    }
  }
  return [...sites.entries()].map(([id, site]) => ({
    kind: 'accounts',
    id,
    coordinates: site.coordinates,
    accounts: site.accounts,
    primary: site.accounts[0],
  }));
}

function markerElement(feature: MapFeature) {
  const element = document.createElement('button');
  const contested = feature.kind === 'providers'
    ? feature.providers.some(provider => provider.consensus.verifyBeforeCalling)
    : feature.accounts.some(account => account.contested > 0);
  const score = feature.kind === 'providers' ? feature.primary.score : feature.primary.topScore;
  element.className = `territory-pin ${feature.kind === 'accounts' ? 'account' : 'provider'}${contested ? ' contested' : ''}`;
  element.dataset.band = scoreBand(score);
  element.type = 'button';
  element.setAttribute('aria-pressed', 'false');

  const label = document.createElement('span');
  label.className = 'pin-label';
  if (feature.kind === 'providers') {
    label.textContent = feature.rank <= 99 ? String(feature.rank) : '•';
    const names = feature.providers.slice(0, 2).map(displayName).join(', ');
    element.title = `${names}${feature.providers.length > 2 ? ` and ${feature.providers.length - 2} more` : ''} · top score ${score}`;
    element.setAttribute('aria-label', `Rank ${feature.rank}, ${displayName(feature.primary)}, score ${score}`);
  } else {
    const physicians = feature.accounts.reduce((sum, account) => sum + account.providers.length, 0);
    label.textContent = String(physicians);
    const name = feature.primary.probableInstitution?.name ?? feature.primary.site;
    element.title = `${name} · ${physicians} oncologists · top score ${score}`;
    element.setAttribute('aria-label', `${name}, ${physicians} oncologists, top score ${score}`);
  }
  element.append(label);

  const grouped = feature.kind === 'providers' ? feature.providers.length : feature.accounts.length;
  if (grouped > 1) {
    const count = document.createElement('span');
    count.className = 'pin-count';
    count.textContent = String(grouped);
    count.setAttribute('aria-hidden', 'true');
    element.append(count);
  }
  return element;
}

function addMarker(markerMap: Map<string, mapboxgl.Marker[]>, key: string, marker: mapboxgl.Marker) {
  markerMap.set(key, [...(markerMap.get(key) ?? []), marker]);
}

function clearMarkers(markerMap: Map<string, mapboxgl.Marker[]>) {
  new Set([...markerMap.values()].flat()).forEach(marker => marker.remove());
  markerMap.clear();
}

function markSelection(markerMap: Map<string, mapboxgl.Marker[]>, selectedKey: string) {
  new Set([...markerMap.values()].flat()).forEach(marker => {
    const element = marker.getElement();
    element.classList.remove('on');
    element.setAttribute('aria-pressed', 'false');
    element.style.removeProperty('z-index');
  });
  const selected = selectedKey ? markerMap.get(selectedKey) ?? [] : [];
  selected.forEach(marker => {
    const element = marker.getElement();
    element.classList.add('on');
    element.setAttribute('aria-pressed', 'true');
    element.style.zIndex = '20';
  });
}

function fitFeatures(
  map: mapboxgl.Map | null,
  features: MapFeature[],
  padding: mapboxgl.PaddingOptions,
  duration = 550,
) {
  if (!map || !features.length) return;
  map.stop();
  clearRetainedPadding(map);
  const bounds = features.length === 1
    ? new mapboxgl.LngLat(...features[0].coordinates).toBounds(6_000)
    : features.reduce(
      (result, feature) => result.extend(feature.coordinates),
      new mapboxgl.LngLatBounds(),
    );
  map.fitBounds(bounds, {
    padding,
    maxZoom: 13,
    duration,
    essential: false,
    retainPadding: false,
  });
}

function focusSelection(
  map: mapboxgl.Map,
  targetCoordinates: Array<[number, number]>,
  selectedFeature: MapFeature,
  features: MapFeature[],
  selectedRecordCount: number,
  padding: mapboxgl.PaddingOptions,
  expanded: boolean,
  layout: 'stage' | 'overview',
  duration = 650,
) {
  const targets = uniqueCoordinates(targetCoordinates);
  if (!targets.length) return;
  map.stop();
  clearRetainedPadding(map);

  let bounds: mapboxgl.LngLatBounds;
  if (targets.length === 1) {
    const adaptiveRadius = adaptiveFocusRadiusKm(selectedFeature, features, selectedRecordCount);
    const radiusKm = layout === 'overview' ? Math.min(6, adaptiveRadius) : adaptiveRadius;
    bounds = new mapboxgl.LngLat(...targets[0]).toBounds(radiusKm * 1_000);
  } else {
    // Accounts can span more than one practice site. Include every mapped site
    // and a small geographic gutter instead of focusing only the first doctor.
    bounds = new mapboxgl.LngLatBounds();
    targets.forEach(coordinates => {
      bounds.extend(new mapboxgl.LngLat(...coordinates).toBounds(2_000));
    });
  }

  map.fitBounds(bounds, {
    padding,
    maxZoom: expanded ? 15 : layout === 'overview' ? 13.5 : 14.25,
    duration,
    essential: false,
    retainPadding: false,
  });
}

function adaptiveFocusRadiusKm(selected: MapFeature, features: MapFeature[], groupedRecords: number) {
  const distances = features
    .filter(feature => feature.kind !== selected.kind || feature.id !== selected.id)
    .map(feature => distanceKm(selected.coordinates, feature.coordinates))
    .filter(distance => distance > 0)
    .sort((a, b) => a - b);
  if (!distances.length) return groupedRecords > 1 ? 4 : 7;
  if (groupedRecords > 1 && distances[0] > 2) return 4;

  // When many distinct sites form a compact group, include that whole local
  // group while allowing a tighter camera than the normal two-kilometre floor.
  // This is the case where extra zoom materially separates neighboring pins.
  const denseCluster = distances.filter(distance => distance <= 2);
  if (denseCluster.length >= 5) {
    return Math.min(2.3, Math.max(0.6, denseCluster[denseCluster.length - 1] * 1.15));
  }

  // Four neighboring sites provide enough local context without allowing a
  // remote outlier to collapse a dense city cluster into a territory overview.
  const fourthNeighbor = distances[Math.min(3, distances.length - 1)];
  return Math.min(12, Math.max(2, fourthNeighbor * 1.2));
}

function distanceKm(a: [number, number], b: [number, number]) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b[1] - a[1]);
  const longitudeDelta = radians(b[0] - a[0]);
  const latitudeA = radians(a[1]);
  const latitudeB = radians(b[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function featureForSelection(features: MapFeature[], selectedKey: string) {
  return features.find(feature => feature.kind === 'providers'
    ? feature.providers.some(provider => `provider:${provider.number}` === selectedKey)
    : feature.accounts.some(account => `account:${account.id}` === selectedKey));
}

function uniqueCoordinates(coordinates: Array<[number, number]>) {
  const seen = new Set<string>();
  return coordinates.filter(([longitude, latitude]) => {
    const key = `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clearRetainedPadding(map: mapboxgl.Map) {
  const padding = map.getPadding();
  if (padding.top || padding.right || padding.bottom || padding.left) {
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
  }
}

function scoreBand(score: number) {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
}
