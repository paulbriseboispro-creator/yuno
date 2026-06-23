// Forward-geocode a city name to coordinates via Mapbox, mirroring the pattern
// already used in ExploreHeader / VenueMapSearch. Results are cached in
// localStorage (city names are stable) so we never re-hit the API for a city we
// already resolved — the DJ marketplace radius filter calls this on every booker.

export interface LatLng { lat: number; lng: number }

const CACHE_PREFIX = 'yuno.geocode.v1:';

function cacheKey(city: string): string {
  return CACHE_PREFIX + city.trim().toLowerCase();
}

function readCache(city: string): LatLng | null {
  try {
    const raw = localStorage.getItem(cacheKey(city));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.lat === 'number' && typeof v?.lng === 'number') return v;
    return null;
  } catch {
    return null;
  }
}

function writeCache(city: string, coords: LatLng): void {
  try {
    localStorage.setItem(cacheKey(city), JSON.stringify(coords));
  } catch {
    // localStorage full / unavailable — geocoding still works, just uncached.
  }
}

/**
 * Geocode a city name → { lat, lng }, or null when the token is missing, the city
 * is empty, or Mapbox returns no match. Never throws (the caller degrades to "no
 * radius filter" rather than breaking the page).
 */
export async function geocodeCity(city: string | null | undefined): Promise<LatLng | null> {
  const q = (city ?? '').trim();
  if (!q) return null;

  const cached = readCache(q);
  if (cached) return cached;

  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
        `?access_token=${token}&types=place&limit=1`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const center = data?.features?.[0]?.center; // [lng, lat]
    if (!Array.isArray(center) || center.length < 2) return null;
    const coords: LatLng = { lat: center[1], lng: center[0] };
    writeCache(q, coords);
    return coords;
  } catch {
    return null;
  }
}
