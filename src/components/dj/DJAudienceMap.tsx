import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

/**
 * Bubble map of where a DJ's subscribers live. Profiles only store a free-text
 * `city`, so we forward-geocode each city through Mapbox (cached in localStorage)
 * and drop a proportionally-sized marker. Lazy-loaded by DJAnalytics so mapbox-gl
 * stays out of the main bundle. Degrades to null (caller keeps its ranked list) if
 * there's no token or geocoding yields nothing.
 */

interface CityCount { city: string; count: number; }

async function geocodeCity(city: string, token: string): Promise<[number, number] | null> {
  const key = `dj_geo_${city.trim().toLowerCase()}`;
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

export default function DJAudienceMap({ cities }: { cities: CityCount[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
    if (!token || !containerRef.current || cities.length === 0) { setHidden(true); return; }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [2.35, 46.6],
      zoom: 3.6,
      attributionControl: false,
      interactive: true,
    });
    const markers: mapboxgl.Marker[] = [];
    let cancelled = false;

    map.on('load', async () => {
      const max = Math.max(...cities.map(c => c.count), 1);
      const bounds = new mapboxgl.LngLatBounds();
      let placed = 0;

      for (const c of cities) {
        const coords = await geocodeCity(c.city, token);
        if (cancelled || !coords) continue;
        const size = 18 + Math.round(Math.sqrt(c.count / max) * 28); // 18..46px
        const el = document.createElement('div');
        el.title = `${c.city} — ${c.count}`;
        el.style.cssText =
          `width:${size}px;height:${size}px;border-radius:50%;` +
          `background:rgba(232,25,44,0.6);border:2px solid #fff;` +
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
        map.flyTo({ center: bounds.getCenter(), zoom: 6, duration: 600 });
      } else {
        try { map.fitBounds(bounds, { padding: 48, maxZoom: 9, duration: 700 }); } catch { /* noop */ }
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
      style={{ width: '100%', height: 280, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.085)' }} />
  );
}
