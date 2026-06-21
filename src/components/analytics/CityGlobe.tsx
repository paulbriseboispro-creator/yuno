import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

/**
 * Zoomable 3D globe of where a venue's / organizer's crowd comes from, one bubble
 * per city sized + labelled by head-count. Profiles only store a free-text `city`,
 * so we forward-geocode each city through Mapbox (cached in localStorage, shared
 * key with any other Yuno city map) and drop a proportional marker on the globe.
 *
 * Lazy-loaded by OwnerCustomerOrigins so mapbox-gl stays out of the main bundle.
 * Degrades to null (caller keeps its ranked city list) if there's no token or
 * geocoding yields nothing.
 */

interface CityCount { city: string; count: number; }

async function geocodeCity(city: string, token: string): Promise<[number, number] | null> {
  const key = `yuno_geo_${city.trim().toLowerCase()}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached) as [number, number];
  } catch { /* ignore */ }
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(city)}.json?access_token=${token}&types=place&limit=1`;
    const res = await fetch(url);
    const json = await res.json();
    const center = json?.features?.[0]?.center;
    if (Array.isArray(center) && center.length === 2) {
      try { localStorage.setItem(key, JSON.stringify(center)); } catch { /* quota */ }
      return center as [number, number];
    }
  } catch { /* network / quota */ }
  return null;
}

export default function CityGlobe({ cities }: { cities: CityCount[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
    if (!token || !containerRef.current || cities.length === 0) { setHidden(true); return; }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: { name: 'globe' },          // ← true zoomable 3D globe
      center: [2.35, 46.6],
      zoom: 1.4,
      attributionControl: false,
      interactive: true,
    });
    map.scrollZoom.enable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const markers: mapboxgl.Marker[] = [];
    let cancelled = false;

    map.on('style.load', () => {
      // Subtle space + atmosphere so the globe reads as a globe, on-brand dark.
      map.setFog({
        color: 'rgb(10,10,12)',
        'high-color': 'rgb(30,12,16)',
        'horizon-blend': 0.06,
        'space-color': 'rgb(6,6,8)',
        'star-intensity': 0.12,
      });
    });

    map.on('load', async () => {
      const max = Math.max(...cities.map(c => c.count), 1);
      const bounds = new mapboxgl.LngLatBounds();
      let placed = 0;

      for (const c of cities) {
        const coords = await geocodeCity(c.city, token);
        if (cancelled || !coords) continue;
        const size = 20 + Math.round(Math.sqrt(c.count / max) * 30); // 20..50px
        const el = document.createElement('div');
        el.title = `${c.city} — ${c.count}`;
        el.style.cssText =
          `width:${size}px;height:${size}px;border-radius:50%;` +
          `background:rgba(232,25,44,0.62);border:2px solid #fff;` +
          `box-shadow:0 0 0 4px rgba(232,25,44,0.12),0 2px 8px rgba(0,0,0,0.5);` +
          `display:flex;align-items:center;justify-content:center;` +
          `color:#fff;font-size:11px;font-weight:700;line-height:1;cursor:default;`;
        el.textContent = String(c.count);
        markers.push(new mapboxgl.Marker(el).setLngLat(coords).addTo(map));
        bounds.extend(coords);
        placed++;
      }

      if (cancelled) return;
      if (placed === 0) { setHidden(true); return; }
      if (placed === 1) {
        map.flyTo({ center: bounds.getCenter(), zoom: 4.5, duration: 700 });
      } else {
        // Cap the zoom so the view stays globe-like instead of flattening to a street map.
        try { map.fitBounds(bounds, { padding: 56, maxZoom: 4.2, duration: 800 }); } catch { /* noop */ }
      }
    });

    return () => {
      cancelled = true;
      markers.forEach(m => m.remove());
      map.remove();
    };
  }, [cities]);

  if (hidden) return null;
  return (
    <div ref={containerRef}
      style={{ width: '100%', height: 420, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.085)', background: '#060608' }} />
  );
}
