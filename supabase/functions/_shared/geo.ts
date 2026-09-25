// Miroir Deno de src/lib/geo.ts (+ la table fuseau → pays de
// src/lib/countries.ts). Marché d'une soirée / d'un club pour l'analytics
// serveur (PostHog `order_paid_server`). Toute règle ajoutée d'un côté se
// reporte de l'autre, et dans la fonction SQL `analytics_market_country()`.

export const COUNTRY_BY_TIMEZONE: Record<string, string> = {
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES', 'Africa/Ceuta': 'ES', 'Atlantic/Canary': 'ES',
  'Europe/London': 'GB', 'Europe/Belfast': 'GB',
  'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT',
  'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL',
  'Europe/Zurich': 'CH',
  'Europe/Luxembourg': 'LU',
  'Europe/Monaco': 'MC',
  'Europe/Vienna': 'AT',
  'Europe/Warsaw': 'PL',
  'Europe/Dublin': 'IE',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Athens': 'GR',
  'Europe/Prague': 'CZ',
  'Europe/Bucharest': 'RO',
  'Europe/Budapest': 'HU',
  'Europe/Moscow': 'RU',
  'Europe/Istanbul': 'TR',
  'America/New_York': 'US', 'America/Detroit': 'US', 'America/Chicago': 'US',
  'America/Denver': 'US', 'America/Phoenix': 'US', 'America/Los_Angeles': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA',
  'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA',
  'America/St_Johns': 'CA',
  'Africa/Casablanca': 'MA',
  'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN',
  'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
  'America/Recife': 'BR', 'America/Manaus': 'BR',
  'America/Mexico_City': 'MX', 'America/Cancun': 'MX', 'America/Monterrey': 'MX',
  'America/Tijuana': 'MX',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Bogota': 'CO',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'America/Guadeloupe': 'GP',
  'America/Martinique': 'MQ',
  'America/Cayenne': 'GF',
  'Indian/Reunion': 'RE',
  'Indian/Mayotte': 'YT',
  'America/Miquelon': 'PM',
  'Pacific/Noumea': 'NC',
  'Pacific/Tahiti': 'PF', 'Pacific/Marquesas': 'PF', 'Pacific/Gambier': 'PF',
  'Pacific/Wallis': 'WF',
  'America/Nuuk': 'GL', 'America/Godthab': 'GL',
  'Atlantic/Faroe': 'FO',
  'America/Aruba': 'AW',
  'America/Curacao': 'CW',
  'America/Puerto_Rico': 'PR',
};

/** Ville (forme normalisée, clé minuscule sans accents) → pays ISO alpha-2. */
const COUNTRY_BY_CITY: Record<string, string> = {
  paris: 'FR', lyon: 'FR', marseille: 'FR', toulouse: 'FR', bordeaux: 'FR',
  lille: 'FR', nice: 'FR', nantes: 'FR', montpellier: 'FR', strasbourg: 'FR',
  rennes: 'FR', grenoble: 'FR', cannes: 'FR', 'saint-tropez': 'FR',
  biarritz: 'FR', annecy: 'FR', 'aix-en-provence': 'FR', dijon: 'FR',
  madrid: 'ES', barcelona: 'ES', barcelone: 'ES', valencia: 'ES', valence: 'ES',
  sevilla: 'ES', seville: 'ES', malaga: 'ES', ibiza: 'ES', eivissa: 'ES',
  bilbao: 'ES', marbella: 'ES', palma: 'ES', 'palma de mallorca': 'ES',
  alicante: 'ES', granada: 'ES', zaragoza: 'ES', salamanca: 'ES',
  london: 'GB', londres: 'GB', brussels: 'BE', bruxelles: 'BE',
  lisbon: 'PT', lisbonne: 'PT', lisboa: 'PT', geneva: 'CH', geneve: 'CH',
  monaco: 'MC', luxembourg: 'LU', berlin: 'DE', amsterdam: 'NL',
};

/** Alias → nom canonique affiché (une ville = une ligne dans les classements). */
const CITY_ALIASES: Record<string, string> = {
  barcelone: 'Barcelona', valence: 'Valencia', seville: 'Sevilla',
  eivissa: 'Ibiza', 'palma de mallorca': 'Palma', londres: 'London',
  bruxelles: 'Brussels', lisbonne: 'Lisbon', lisboa: 'Lisbon', geneve: 'Geneva',
};

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Ville normalisée : premier segment avant la virgule, sans code postal,
 * alias ramené au nom canonique, casse de titre. `null` si vide.
 */
export function marketCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const first = city.split(',')[0].replace(/\b\d{4,5}\b/g, '').replace(/\s+/g, ' ').trim();
  if (!first) return null;
  const key = fold(first);
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  return first
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Pays ISO alpha-2 du marché : fuseau d'abord, ville en repli, sinon `null`. */
export function marketCountry(
  timezone: string | null | undefined,
  city?: string | null,
): string | null {
  const byTz = timezone ? COUNTRY_BY_TIMEZONE[timezone.trim()] : undefined;
  if (byTz) return byTz;
  if (!city) return null;
  const key = fold(city.split(',')[0].replace(/\b\d{4,5}\b/g, ''));
  return COUNTRY_BY_CITY[key] ?? null;
}

export type MarketSource = {
  timezone?: string | null;
  city?: string | null;
  eventId?: string | null;
  venueId?: string | null;
  organizerUserId?: string | null;
};

/**
 * Propriétés géo standard d'un événement métier lié à une soirée, un club ou
 * un organisateur. Les ids absents ne sont pas posés (pas de `null` qui
 * gonflerait une ventilation « (vide) »).
 */
export function marketProps(src: MarketSource): Record<string, string> {
  const out: Record<string, string> = {};
  const country = marketCountry(src.timezone, src.city);
  const city = marketCity(src.city);
  if (country) out.market_country = country;
  if (city) out.market_city = city;
  if (src.eventId) out.event_id = src.eventId;
  if (src.venueId) out.venue_id = src.venueId;
  if (src.organizerUserId) out.organizer_user_id = src.organizerUserId;
  return out;
}
