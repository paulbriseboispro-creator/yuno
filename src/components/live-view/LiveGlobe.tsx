import { useEffect, useRef, useState } from 'react';
import mapboxgl, { type GeoJSONSource } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Minus, Plus, LocateFixed } from 'lucide-react';
import type { LiveBurst, LiveLocation, LivePoint } from '@/lib/liveView';

/**
 * Le globe de la vue en direct. Un vrai globe Mapbox (projection `globe`),
 * mais épuré : fond `#0a0a0c` (celui des dashboards pro), continents `#1B1B1E` sans
 * aucune étiquette, ni route, ni ville — seuls comptent les points.
 *
 *   - un point rouge par visiteur en ce moment (halo qui respire),
 *   - un anneau blanc sur le club,
 *   - à chaque fait nouveau, une onde (blanche pour une visite, rouge pour
 *     une vente) et, pour une vente localisée, un arc tracé vers le club.
 *
 * Lazy-loadé par LiveView : mapbox-gl reste hors du bundle principal.
 * Sans jeton Mapbox, LiveView affiche son propre repli — ce composant
 * n'est alors jamais monté.
 */

const RED = '#E8192C';
const WHITE = '#FFFFFF';
const BURST_MS = 1600;
const ARC_DRAW_MS = 900;
const ARC_FADE_MS = 1600;

interface Props {
  points: LivePoint[];
  home: { lat: number; lng: number; name: string | null } | null;
  bursts: LiveBurst[];
  locations: LiveLocation[];
  reducedMotion: boolean;
  labels: { zoomIn: string; zoomOut: string; recenter: string };
  /** Zones couvertes par les superpositions (chiffre, carte release) : la caméra les évite. */
  padding: { top: number; right: number; bottom: number; left: number };
}

const STYLE: mapboxgl.StyleSpecification = {
  version: 8,
  name: 'yuno-live',
  sources: {
    countries: { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0a0c' } },
    {
      id: 'land',
      type: 'fill',
      source: 'countries',
      'source-layer': 'country_boundaries',
      filter: ['any', ['==', ['get', 'worldview'], 'all'], ['in', 'US', ['get', 'worldview']]],
      paint: { 'fill-color': '#1B1B1E', 'fill-opacity': 1 },
    },
    {
      id: 'land-line',
      type: 'line',
      source: 'countries',
      'source-layer': 'country_boundaries',
      filter: ['any', ['==', ['get', 'worldview'], 'all'], ['in', 'US', ['get', 'worldview']]],
      paint: { 'line-color': '#2C2C31', 'line-width': 0.6, 'line-opacity': 0.9 },
    },
  ],
};

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

function toRad(d: number) { return (d * Math.PI) / 180; }
function toDeg(r: number) { return (r * 180) / Math.PI; }

/** Points intermédiaires d'un grand cercle (slerp) entre deux positions. */
function greatCircle(a: [number, number], b: [number, number], n = 48): [number, number][] {
  const [lng1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lng2, lat2] = [toRad(b[0]), toRad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
  ));
  if (d < 1e-6) return [a, b];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return out;
}

function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

export default function LiveGlobe({ points, home, bursts, locations, reducedMotion, labels, padding }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ points, home, bursts, locations, reducedMotion, padding });
  latest.current = { points, home, bursts, locations, reducedMotion, padding };
  const spinRef = useRef({ enabled: false, interacting: false, resumeAt: 0 });
  const fitKeyRef = useRef('');

  // ── Création de la carte (une fois) ─────────────────────────────────────
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
    if (!token || !containerRef.current) return;
    mapboxgl.accessToken = token;
    const start = latest.current.home ? [latest.current.home.lng, latest.current.home.lat] as [number, number] : [2.35, 46.6] as [number, number];
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLE,
      projection: 'globe',
      center: start,
      zoom: 1.65,
      minZoom: 0.7,
      maxZoom: 7,
      attributionControl: false,
      logoPosition: 'bottom-right',
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      scrollZoom: false,
      doubleClickZoom: true,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __lvMap?: mapboxgl.Map }).__lvMap = map;

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(10,10,10)',
        'high-color': 'rgb(26,10,13)',
        'horizon-blend': 0.035,
        'space-color': 'rgb(5,5,7)',
        'star-intensity': 0.18,
      });
      map.addSource('lv-visitors', { type: 'geojson', data: EMPTY });
      map.addSource('lv-home', { type: 'geojson', data: EMPTY });
      map.addSource('lv-bursts', { type: 'geojson', data: EMPTY });
      map.addSource('lv-arcs', { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: 'lv-arcs', type: 'line', source: 'lv-arcs',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': RED, 'line-width': 1.6, 'line-opacity': ['get', 'o'] },
      });
      map.addLayer({
        id: 'lv-bursts', type: 'circle', source: 'lv-bursts',
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ['get', 'c'],
          'circle-stroke-width': 1.4,
          'circle-stroke-opacity': ['get', 'o'],
          'circle-pitch-alignment': 'map',
        },
      });
      map.addLayer({
        id: 'lv-visitors-halo', type: 'circle', source: 'lv-visitors',
        paint: {
          'circle-radius': ['get', 'halo'],
          'circle-color': RED,
          'circle-opacity': ['get', 'haloOpacity'],
          'circle-blur': 0.6,
        },
      });
      map.addLayer({
        id: 'lv-visitors', type: 'circle', source: 'lv-visitors',
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': RED,
          'circle-stroke-color': WHITE,
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'lv-home-ring', type: 'circle', source: 'lv-home',
        paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': WHITE, 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.75 },
      });
      map.addLayer({
        id: 'lv-home', type: 'circle', source: 'lv-home',
        paint: { 'circle-radius': 3, 'circle-color': WHITE },
      });
      setReady(true);
    });

    const pauseSpin = () => { spinRef.current.interacting = true; spinRef.current.resumeAt = performance.now() + 7000; };
    map.on('mousedown', pauseSpin);
    map.on('touchstart', pauseSpin);
    map.on('wheel', pauseSpin);
    map.on('dragstart', pauseSpin);
    map.on('zoomstart', pauseSpin);

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Padding caméra : un changement de superpositions force un recadrage ──
  const paddingKey = `${padding.top},${padding.right},${padding.bottom},${padding.left}`;
  useEffect(() => { fitKeyRef.current = ''; }, [paddingKey]);

  // ── Données statiques : visiteurs + club ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const homeFc: FC = home
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [home.lng, home.lat] }, properties: {} }] }
      : EMPTY;
    (map.getSource('lv-home') as GeoJSONSource | undefined)?.setData(homeFc);

    // Recadrage : uniquement quand l'ensemble des lieux change (jamais à chaque tick).
    const located = points.filter((p) => p.lat != null && p.lng != null) as Array<LivePoint & { lat: number; lng: number }>;
    const key = located.map((p) => `${p.lat!.toFixed(1)},${p.lng!.toFixed(1)}`).sort().join('|') + (home ? `#${home.lat},${home.lng}` : '');
    if (key !== fitKeyRef.current) {
      fitKeyRef.current = key;
      if (located.length === 0) {
        spinRef.current.enabled = !reducedMotion;
        if (home) map.easeTo({ center: [home.lng, home.lat], zoom: Math.min(map.getZoom(), 2.2), padding, duration: reducedMotion ? 0 : 900 });
      } else {
        spinRef.current.enabled = false;
        const bounds = new mapboxgl.LngLatBounds();
        located.forEach((p) => bounds.extend([p.lng, p.lat]));
        if (home) bounds.extend([home.lng, home.lat]);
        try {
          map.stop();
          // `padding` de fitBounds REMPLACE celui de la carte : on passe le nôtre + marge.
          map.fitBounds(bounds, {
            padding: { top: padding.top + 30, right: padding.right + 30, bottom: padding.bottom + 30, left: padding.left + 30 },
            maxZoom: 3.4,
            duration: reducedMotion ? 0 : 1100,
          });
        } catch { /* bornes dégénérées : on garde la vue */ }
      }
    }
  }, [points, home, ready, reducedMotion, paddingKey, padding]);

  // ── Boucle d'animation : halos, ondes, arcs, rotation d'attente ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let raf = 0;
    let last = 0;
    let spinning = false;
    const arcCache = new Map<string, [number, number][]>();

    const startSpin = () => {
      if (spinning) return;
      spinning = true;
      const c = map.getCenter();
      map.easeTo({ center: [c.lng - 18, c.lat], duration: 42000, easing: (n) => n, essential: false });
    };
    const onMoveEnd = () => { spinning = false; };
    map.on('moveend', onMoveEnd);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps suffisent
      last = now;
      const { points, bursts, home, reducedMotion } = latest.current;

      // Visiteurs : agrégés par lieu (0,01° ≈ 1 km), halo qui respire.
      const buckets = new Map<string, { lng: number; lat: number; n: number }>();
      for (const p of points) {
        if (p.lat == null || p.lng == null) continue;
        const k = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
        const b = buckets.get(k);
        if (b) b.n += 1; else buckets.set(k, { lng: p.lng, lat: p.lat, n: 1 });
      }
      const breath = reducedMotion ? 0.5 : (Math.sin(now / 700) + 1) / 2; // 0..1
      const visitorsFc: FC = {
        type: 'FeatureCollection',
        features: [...buckets.values()].map((b) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
          properties: {
            r: 3.5 + Math.min(6, Math.sqrt(b.n) * 1.6),
            halo: 8 + Math.min(10, Math.sqrt(b.n) * 2) + breath * 6,
            haloOpacity: 0.18 + breath * 0.2,
            n: b.n,
          },
        })),
      };
      (map.getSource('lv-visitors') as GeoJSONSource | undefined)?.setData(visitorsFc);

      // Ondes + arcs.
      const burstFeatures: FC['features'] = [];
      const arcFeatures: FC['features'] = [];
      for (const b of bursts) {
        const age = now - b.bornAt;
        const color = b.kind === 'visit' ? WHITE : RED;
        const rings = b.kind === 'visit' ? 1 : 2;
        for (let i = 0; i < rings; i++) {
          const t = Math.min(1, Math.max(0, (age - i * 260) / BURST_MS));
          if (t <= 0 || t >= 1) continue;
          const e = reducedMotion ? 0.55 : easeOut(t);
          burstFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
            properties: { r: 4 + e * (b.kind === 'visit' ? 26 : 40), o: (1 - t) * 0.85, c: color },
          });
        }
        if (b.kind !== 'visit' && home && !reducedMotion) {
          const far = Math.abs(home.lat - b.lat) + Math.abs(home.lng - b.lng) > 0.08;
          if (far) {
            let pts = arcCache.get(b.id);
            if (!pts) { pts = greatCircle([b.lng, b.lat], [home.lng, home.lat]); arcCache.set(b.id, pts); }
            const draw = Math.min(1, age / ARC_DRAW_MS);
            const fade = age <= ARC_DRAW_MS ? 1 : Math.max(0, 1 - (age - ARC_DRAW_MS) / ARC_FADE_MS);
            if (fade > 0) {
              const n = Math.max(2, Math.round(easeOut(draw) * (pts.length - 1)) + 1);
              arcFeatures.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: pts.slice(0, n) },
                properties: { o: 0.9 * fade },
              });
            }
          }
        }
      }
      (map.getSource('lv-bursts') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: burstFeatures });
      (map.getSource('lv-arcs') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: arcFeatures });

      // Rotation d'attente : seulement sans visiteur, sans interaction, sans reduced-motion.
      const s = spinRef.current;
      if (s.interacting && now > s.resumeAt) s.interacting = false;
      if (s.enabled && !s.interacting && !reducedMotion && document.visibilityState === 'visible') startSpin();
      else if (spinning && (!s.enabled || s.interacting)) { map.stop(); spinning = false; }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      map.off('moveend', onMoveEnd);
    };
  }, [ready]);

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    fitKeyRef.current = '';
    spinRef.current.interacting = false;
    const h = latest.current.home;
    map.easeTo({ center: h ? [h.lng, h.lat] : [2.35, 46.6], zoom: 1.65, padding: latest.current.padding, duration: latest.current.reducedMotion ? 0 : 800 });
  };

  const btn = 'flex h-9 w-9 items-center justify-center rounded-lg cursor-pointer transition-colors duration-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E8192C]';
  const btnStyle: React.CSSProperties = { color: 'rgba(255,255,255,0.58)', background: 'rgba(10,10,12,0.72)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.085)' };

  return (
    <div className="absolute inset-0">
      {/* Style inline : mapbox-gl.css pose `position: relative` sur `.mapboxgl-map`,
          ce qui écraserait la classe `absolute` et réduirait le globe à 0 px. */}
      <div ref={containerRef} className="lv-globe" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#0a0a0c' }} />
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button type="button" aria-label={labels.zoomIn} className={btn} style={btnStyle} onClick={() => { spinRef.current.interacting = true; spinRef.current.resumeAt = performance.now() + 7000; mapRef.current?.zoomIn({ duration: 350 }); }}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label={labels.zoomOut} className={btn} style={btnStyle} onClick={() => { spinRef.current.interacting = true; spinRef.current.resumeAt = performance.now() + 7000; mapRef.current?.zoomOut({ duration: 350 }); }}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label={labels.recenter} className={btn} style={btnStyle} onClick={recenter}>
          <LocateFixed className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
