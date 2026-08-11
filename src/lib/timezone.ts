import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const PARIS_TIMEZONE = 'Europe/Paris';

/**
 * Convert a date to Paris timezone
 */
export const toParisTime = (date: Date | string): Date => {
  return toZonedTime(date, PARIS_TIMEZONE);
};

/**
 * Convert a Paris timezone date to UTC for storage
 */
export const fromParisTime = (date: Date | string): Date => {
  return fromZonedTime(date, PARIS_TIMEZONE);
};

/**
 * Get current time in Paris timezone
 */
export const nowInParis = (): Date => {
  return toParisTime(new Date());
};

// ─────────────────────────────────────────────────────────────────────────────
// Fuseau horaire par événement
//
// Un événement est stocké en instant absolu (`start_at`/`end_at` en timestamptz).
// Pour AFFICHER une heure murale (« 23h30 ») il faut le fuseau cible. Chaque
// événement porte désormais son fuseau (`events.timezone`, figé à la publication).
// `getEventTimezone` est le SEUL accès : il retombe sur Europe/Paris quand le
// champ est absent (anciennes lignes, objets partiels), donc l'insérer partout
// ne peut jamais casser l'existant — il rend juste les venues hors-Paris exactes.
// ─────────────────────────────────────────────────────────────────────────────

/** Fuseau d'un événement, avec repli sûr sur Europe/Paris. */
export const getEventTimezone = (event?: { timezone?: string | null } | null): string => {
  const tz = event?.timezone;
  return tz && tz.trim() ? tz.trim() : PARIS_TIMEZONE;
};

/**
 * Convertit une heure murale (saisie `datetime-local`, sans fuseau) en UTC ISO,
 * INTERPRÉTÉE dans le fuseau donné. Découple la sauvegarde du fuseau du
 * navigateur de l'owner : « 23:30 » à Paris et « 23:30 » à New York ne
 * produisent pas le même instant.
 */
export const fromWallClockInTz = (wallClock: string, timeZone: string): string => {
  return fromZonedTime(wallClock, timeZone || PARIS_TIMEZONE).toISOString();
};

/**
 * Formate une valeur `datetime-local` (`yyyy-MM-dd'T'HH:mm`) à partir d'un
 * instant UTC, dans le fuseau donné. Sert à pré-remplir le formulaire d'édition.
 */
export const toWallClockInputInTz = (utcValue: string | Date, timeZone: string): string => {
  return formatInTimeZone(new Date(utcValue), timeZone || PARIS_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
};

/**
 * Fuseau par défaut dérivé de la ville d'une venue.
 * Miroir du backfill SQL (migration 20260811120000). Europe/Paris, Madrid et
 * Brussels partagent le même décalage ; seuls London/Lisbon (WET) diffèrent.
 * La valeur reste un simple défaut : l'owner peut toujours choisir un autre fuseau.
 */
export const cityToTimezone = (city?: string | null): string => {
  const c = (city || '').trim().toLowerCase();
  if (!c) return PARIS_TIMEZONE;
  const ES = ['madrid', 'segovia', 'barcelona', 'sevilla', 'seville', 'valencia', 'málaga', 'malaga', 'bilbao', 'ibiza', 'marbella', 'zaragoza', 'alicante', 'granada'];
  const UK = ['london', 'londres', 'manchester', 'birmingham', 'liverpool', 'leeds', 'glasgow', 'edinburgh'];
  const PT = ['lisbon', 'lisboa', 'porto'];
  const BE = ['brussels', 'bruxelles', 'antwerp', 'anvers'];
  if (ES.includes(c)) return 'Europe/Madrid';
  if (UK.includes(c)) return 'Europe/London';
  if (PT.includes(c)) return 'Europe/Lisbon';
  if (BE.includes(c)) return 'Europe/Brussels';
  return PARIS_TIMEZONE;
};

/**
 * Liste des fuseaux proposés dans le sélecteur owner. Focalisée Europe de
 * l'Ouest (le terrain de Yuno) + quelques hubs mondiaux pour l'expansion.
 * `city` sert de libellé (les noms de ville ne se traduisent quasiment pas).
 */
export const SUPPORTED_TIMEZONES: { id: string; city: string }[] = [
  { id: 'Europe/Paris', city: 'Paris' },
  { id: 'Europe/Madrid', city: 'Madrid' },
  { id: 'Europe/London', city: 'London' },
  { id: 'Europe/Lisbon', city: 'Lisboa' },
  { id: 'Europe/Brussels', city: 'Bruxelles' },
  { id: 'Europe/Amsterdam', city: 'Amsterdam' },
  { id: 'Europe/Berlin', city: 'Berlin' },
  { id: 'Europe/Zurich', city: 'Zürich' },
  { id: 'Europe/Rome', city: 'Roma' },
  { id: 'Europe/Athens', city: 'Athína' },
  { id: 'Europe/Bucharest', city: 'București' },
  { id: 'Europe/Istanbul', city: 'İstanbul' },
  { id: 'America/New_York', city: 'New York' },
  { id: 'America/Los_Angeles', city: 'Los Angeles' },
  { id: 'America/Sao_Paulo', city: 'São Paulo' },
  { id: 'Asia/Dubai', city: 'Dubai' },
];

/**
 * Décalage UTC courant d'un fuseau, ex. « UTC+2 ». Pour étiqueter le sélecteur.
 */
export const tzOffsetLabel = (timeZone: string): string => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    return name.replace('GMT', 'UTC') || 'UTC';
  } catch {
    return '';
  }
};
