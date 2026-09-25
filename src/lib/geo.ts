/**
 * Marché d'une soirée, d'un club ou d'un organisateur — pour l'analytics.
 *
 * Aucune table ne porte de colonne pays : la seule donnée de lieu portée par
 * toutes les soirées est le fuseau (`events.timezone`, `venues.timezone`). Le
 * pays se déduit donc du fuseau (`countryFromTimezone`, même table que le
 * champ téléphone), la ville en repli pour une ligne sans fuseau.
 *
 * `market_country` = pays du LIEU (où l'argent se dépense). Le pays du
 * VISITEUR, lui, est `$geoip_country_code`, posé par PostHog : on veut les deux.
 *
 * Miroirs : `supabase/functions/_shared/geo.ts` (capture serveur) et la
 * fonction SQL `analytics_market_country()` (vues de l'entrepôt). Toute règle
 * ajoutée ici se reporte dans les deux.
 */
import { countryFromTimezone } from '@/lib/countries';

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
  const byTz = countryFromTimezone(timezone)?.code;
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
