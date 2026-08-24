import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Minimize2, Move } from 'lucide-react';
import { MAPBOX_TOKEN } from '../api';
import type { ScoredProvider } from '../lib/ranking';
import type { ProviderPoint } from '../types';

type Props = {
  points: ProviderPoint[];
  providers: ScoredProvider[];
  selectedNpi?: string;
  onSelect: (npi: string) => void;
  /** Incremented by the territory control to reframe the current result set. */
  fitRequest?: number;
};

/**
 * Territory context as the surface the workspace sits on.
 *
 * The map is the background of the stage rather than a card inside it: the
 * reading column frosts it into a paper texture, and the right of the screen
 * leaves it sharp so the territory is legible without ever taking a turn of
 * attention. Full screen is still one click away for close work.
 */
export function TerritoryMap({ points, providers, selectedNpi, onSelect, fitRequest }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    // Mapbox throws synchronously where WebGL is unavailable. Unguarded, that
    // escapes the effect and React unmounts the whole tree, so one missing GPU
    // turns the entire workspace into a blank page. Degrade to a note instead.
    try {
      map.current = new mapboxgl.Map({
        container: container.current,
        style: 'mapbox://styles/mapbox-map-design/cmclxnhzb008001sb6g3m49ko',
        config: { basemap: { lightPreset: 'day', show3dObjects: false, showPointOfInterestLabels: false } },
        center: [-87.6298, 41.8781],
        zoom: 10,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      });
      map.current.touchZoomRotate.disableRotation();
      // The style paints on the first frame after the container settles; the
      // stage grid settles a tick after mount, so nudge the canvas once the
      // browser has actually laid it out.
      requestAnimationFrame(() => map.current?.resize());
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

  // Mapbox caches canvas dimensions at construction. This container is a
  // full-bleed layer behind a grid that settles after mount, and full screen
  // changes it again, so the canvas has to be told whenever the box changes or
  // it renders at the wrong size.
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  // Full screen changes both the canvas size and how much of it the page
  // covers, so the territory is re-framed for the new box rather than left
  // sitting under the reading column's old offset.
  useEffect(() => {
    const timer = setTimeout(() => {
      map.current?.resize();
      if (points.length) {
        map.current?.fitBounds(boundsOf(points), { padding: framePadding(), maxZoom: 12, duration: 500 });
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    if (!map.current || !points.length) return;
    markers.current.forEach(m => m.remove());
    markers.current.clear();

    const seen = new Map<string, number>();
    points.forEach(point => {
      const key = `${point.longitude.toFixed(5)},${point.latitude.toFixed(5)}`;
      const offset = seen.get(key) ?? 0;
      seen.set(key, offset + 1);
      const radius = offset ? 0.0005 * Math.ceil(offset / 2) : 0;
      const coords: [number, number] = [
        point.longitude + Math.cos(offset * 2.4) * radius,
        point.latitude + Math.sin(offset * 2.4) * radius,
      ];

      const provider = providers.find(p => p.number === point.npi);
      const el = document.createElement('button');
      el.className = `pin${provider?.consensus.contested ? ' contested' : ''}`;
      el.title = provider
        ? `${provider.basic.first_name ?? ''} ${provider.basic.last_name ?? ''} · ${provider.score}`
        : '';
      el.onclick = () => onSelectRef.current(point.npi);
      markers.current.set(
        point.npi,
        new mapboxgl.Marker({ element: el }).setLngLat(coords).addTo(map.current!),
      );
    });

    map.current.fitBounds(boundsOf(points), { padding: framePadding(), maxZoom: 12, duration: 600 });
  }, [points, providers]);

  useEffect(() => {
    markers.current.forEach((marker, npi) => marker.getElement().classList.toggle('on', npi === selectedNpi));
    const marker = selectedNpi ? markers.current.get(selectedNpi) : undefined;
    if (marker && map.current) {
      map.current.easeTo({ center: marker.getLngLat(), offset: centreOffset(), duration: 600 });
    }
  }, [selectedNpi]);

  useEffect(() => {
    if (!map.current || !points.length || fitRequest === undefined) return;
    map.current.fitBounds(boundsOf(points), { padding: framePadding(), maxZoom: 12, duration: 500 });
  }, [fitRequest]);

  // Collapsed, the reading column covers the left of the map, so the territory
  // is framed into the clear right-hand band instead of the geometric centre.
  function framePadding() {
    const width = container.current?.clientWidth ?? 0;
    if (expanded || width < 900) return 40;
    return { top: 96, bottom: 80, right: 96, left: Math.round(width * 0.56) };
  }
  function centreOffset(): [number, number] {
    const width = container.current?.clientWidth ?? 0;
    if (expanded || width < 900) return [0, 0];
    return [Math.round(width * 0.28), 0];
  }

  return (
    <div className={`map-shell${expanded ? ' expanded' : ''}`}>
      <div ref={container} className="map-el" />
      {!MAPBOX_TOKEN && <div className="map-note">Set VITE_MAPBOX_TOKEN to enable the map.</div>}
      {failed && <div className="map-note">Map unavailable: this browser reports no WebGL support.</div>}
      {MAPBOX_TOKEN && !failed && !points.length && (
        <div className="map-note"><span className="spinner" /> Locating practices</div>
      )}
      {!failed && MAPBOX_TOKEN && (
        <button
          className="map-expand"
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Return to workspace' : 'Open the full territory'}
        >
          {expanded ? <Minimize2 /> : <Move />}
          {expanded ? 'Close map' : 'Full territory'}
        </button>
      )}
    </div>
  );
}

function boundsOf(points: ProviderPoint[]) {
  const bounds = new mapboxgl.LngLatBounds();
  points.forEach(p => bounds.extend([p.longitude, p.latitude]));
  return bounds;
}
