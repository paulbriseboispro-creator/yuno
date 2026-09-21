// Vue en direct (« Live View ») — types + helpers partagés par le hook, le
// globe et le panneau. Le serveur (RPC `get_live_view`, migration
// 20260921150000) fait TOUS les calculs : ici on ne fait que typer, libeller
// et, à défaut de coordonnées serveur, géocoder un nom de ville (cache
// localStorage partagé avec CityGlobe — même clé `yuno_geo_<ville>`).

export type LiveStage = 'browsing' | 'cart' | 'checkout' | 'paid';
export type LiveFeedKind = 'visit' | 'ticket' | 'table' | 'guestlist' | 'order';
export type LivePageKind =
  | 'venue' | 'event' | 'tickets' | 'tables' | 'guestlist' | 'checkout' | 'drinks' | 'explore' | 'other';

export interface LivePoint {
  session: string;
  stage: LiveStage;
  path: string | null;
  seen: string;
  eventTitle: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  device: string | null;
  source: string | null;
}

export interface LiveFeedItem {
  kind: LiveFeedKind;
  id: string;
  ts: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  source: string | null;
  device: string | null;
  pageType: string | null;
  eventTitle: string | null;
  amount: number | null;
  qty: number | null;
  returning: boolean;
}

export interface LiveLocation {
  city: string | null;
  country: string | null;
  countryCode: string | null;
  n: number;
  lat: number | null;
  lng: number | null;
}

export interface LivePage {
  path: string;
  n: number;
  eventTitle: string | null;
}

export interface LiveRound {
  id: string;
  name: string;
  price: number;
  sold: number;
  max: number;
  active: boolean;
  soldOut: boolean;
}

export interface LiveRelease {
  eventId: string;
  title: string;
  startAt: string;
  endAt: string;
  publishedAt: string | null;
  poster: string | null;
  ticketsSoldOut: boolean;
  maxTickets: number | null;
  sales10m: number;
  sales60m: number;
  salesToday: number;
  salesTotal: number;
  revenue60m: number;
  tables60m: number;
  guests60m: number;
  viewersNow: number;
  /** 60 cases, de la plus ancienne (il y a 59 min) à maintenant. */
  series: number[];
  rounds: LiveRound[];
}

export interface LiveSales {
  tickets: { orders: number; qty: number; amount: number };
  tables: { orders: number; guests: number; amount: number };
  guestlist: { orders: number };
  drinks: { orders: number; amount: number };
}

export interface LiveSnapshot {
  ok: true;
  now: string;
  tz: string;
  dayStart: string;
  home: { lat: number; lng: number; name: string | null } | null;
  visitorsNow: number;
  sessionsToday: number;
  points: LivePoint[];
  behavior: Record<LiveStage, number>;
  pages: LivePage[];
  locations: LiveLocation[];
  sales: LiveSales;
  feed: LiveFeedItem[];
  release: LiveRelease | null;
  watch: { eventIds: string[]; guestListIds: string[] };
}

export interface LiveBurst {
  id: string;
  kind: LiveFeedKind;
  lat: number;
  lng: number;
  /** performance.now() de l'apparition. */
  bornAt: number;
}

/** Ce que regarde un visiteur, déduit du chemin (miroir des routes publiques de App.tsx). */
export function classifyPath(path: string | null | undefined): LivePageKind {
  if (!path) return 'other';
  if (/^\/(ticket|tickets)(\/|$)|\/tickets(\/|$)/.test(path)) return 'tickets';
  if (/\/(table|tables|vip)(\/|$)/.test(path)) return 'tables';
  if (/guest-?list|\/gl\//.test(path)) return 'guestlist';
  if (/checkout|payment|verify/.test(path)) return 'checkout';
  if (/^\/(order|menu|drinks|bar)(\/|$)|\/order(\/|$)/.test(path)) return 'drinks';
  if (/^\/event(s)?\//.test(path)) return 'event';
  if (/^\/(club|venue|v)\//.test(path)) return 'venue';
  if (/^\/explore|^\/$/.test(path)) return 'explore';
  return 'other';
}

/** Libellé court d'une ville « PARIS, FR » (mono uppercase, pas d'emoji). */
export function placeLabel(p: { city: string | null; country: string | null; countryCode: string | null }, unknown: string): string {
  const city = p.city?.trim();
  const cc = p.countryCode?.trim().toUpperCase();
  const country = p.country?.trim();
  if (city && cc) return `${city}, ${cc}`;
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return unknown;
}

export function timeAgoLabel(ts: string | number, nowMs: number, t: (k: string) => string): string {
  const at = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const s = Math.max(0, Math.round((nowMs - at) / 1000));
  if (s < 5) return t('lv.ago.now');
  if (s < 60) return t('lv.ago.s').replace('{n}', String(s));
  const m = Math.round(s / 60);
  if (m < 60) return t('lv.ago.m').replace('{n}', String(m));
  const h = Math.round(m / 60);
  return t('lv.ago.h').replace('{n}', String(h));
}

export function fmtEuro(n: number, language: string): string {
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2, minimumFractionDigits: 0 }).format(n);
}

export function fmtInt(n: number, language: string): string {
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale).format(n);
}

// ── Géocodage de secours (ville → coordonnées) ────────────────────────────
// Les sessions enrichies depuis la migration 20260921150000 portent leurs
// coordonnées ; les plus anciennes n'ont qu'un nom de ville. On les résout
// côté client via Mapbox, en cache, pour ne pas laisser un point de côté.

const geoMemory = new Map<string, [number, number] | null>();
const geoInFlight = new Map<string, Promise<[number, number] | null>>();

export function geoCacheKey(city: string | null, country: string | null): string | null {
  const c = city?.trim().toLowerCase();
  if (!c) return null;
  return `yuno_geo_${c}${country ? `_${country.trim().toLowerCase()}` : ''}`;
}

export async function geocodePlace(city: string | null, country: string | null): Promise<[number, number] | null> {
  const key = geoCacheKey(city, country);
  if (!key) return null;
  if (geoMemory.has(key)) return geoMemory.get(key) ?? null;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as [number, number];
      geoMemory.set(key, parsed);
      return parsed;
    }
  } catch { /* stockage indisponible : on géocode quand même */ }
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  if (!token) return null;
  const pending = geoInFlight.get(key);
  if (pending) return pending;
  const q = [city, country].filter(Boolean).join(', ');
  const p = (async () => {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&types=place,region,country&limit=1`;
      const res = await fetch(url);
      const json = await res.json();
      const center = json?.features?.[0]?.center;
      const coords = Array.isArray(center) && center.length === 2 ? (center as [number, number]) : null;
      geoMemory.set(key, coords);
      if (coords) { try { localStorage.setItem(key, JSON.stringify(coords)); } catch { /* quota */ } }
      return coords;
    } catch {
      geoMemory.set(key, null);
      return null;
    } finally {
      geoInFlight.delete(key);
    }
  })();
  geoInFlight.set(key, p);
  return p;
}

/** Lecture synchrone du cache (pour compléter un snapshot sans attendre). */
export function geocodeCached(city: string | null, country: string | null): [number, number] | null {
  const key = geoCacheKey(city, country);
  if (!key) return null;
  if (geoMemory.has(key)) return geoMemory.get(key) ?? null;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as [number, number];
      geoMemory.set(key, parsed);
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}
