/**
 * Le temps des soirées de clubs externes (`affiliate_events`).
 *
 * Une soirée n'a qu'une DATE (`event_date`) : celle du 25 commence le 25 vers
 * 23 h et finit le 26 au petit matin. Deux erreurs ont coûté cher :
 *   - la déclarer « passée » à minuit (date-fns `isPast`) — le 25/09/2026 la
 *     purge a supprimé les soirées du soir même ;
 *   - filtrer les pages publiques sur la date UTC (`toISOString()`), qui fait
 *     disparaître la soirée à 02 h du matin heure de Madrid, en pleine nuit :
 *     la page soirée renvoyait alors sur l'accueil.
 *
 * Deux règles, un seul fichier :
 *   - PUBLIC : la « nuit en cours » est la date locale (Europe/Paris = même
 *     heure que Madrid) de maintenant − 8 h. Une soirée reste en ligne jusqu'à
 *     8 h le lendemain, puis la journée bascule.
 *   - PRO : une soirée est « terminée » le lendemain à midi (heure de
 *     l'appareil), pour les listes de gestion.
 */

export const NIGHTLIFE_TIME_ZONE = 'Europe/Paris';
export const NIGHT_ROLLOVER_HOUR = 8;
export const AFFILIATE_EVENT_OVER_HOUR = 12;

/** yyyy-MM-dd de l'instant `d` dans le fuseau de la nuit (Europe/Paris). */
export function nightlifeDateOf(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NIGHTLIFE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Ajoute `n` jours à une date yyyy-MM-dd (calendaire, sans fuseau). */
export function addDaysToDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * Date de la nuit EN COURS : borne basse de tout filtre public
 * `.gte('event_date', …)`, et « ce soir » des filtres Aujourd'hui / Demain.
 */
export function currentNightDate(now: Date = new Date()): string {
  return nightlifeDateOf(new Date(now.getTime() - NIGHT_ROLLOVER_HOUR * 3_600_000));
}

/** Les dates (yyyy-MM-dd) du prochain week-end (ven, sam, dim), la nuit en cours comprise. */
export function upcomingWeekendDates(now: Date = new Date()): string[] {
  const start = currentNightDate(now);
  const dates: string[] = [];
  for (let offset = 0; offset <= 7 && dates.length < 3; offset++) {
    const date = addDaysToDate(start, offset);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 5 || dow === 6 || dow === 0) dates.push(date);
  }
  return dates;
}

/** Instant où la soirée datée `eventDate` (yyyy-MM-dd) est considérée finie côté pro. */
export function affiliateEventOverAt(eventDate: string): Date {
  const [y, m, d] = eventDate.split('-').map(Number);
  return new Date(y, m - 1, d + 1, AFFILIATE_EVENT_OVER_HOUR, 0, 0, 0);
}

export function isAffiliateEventOver(eventDate: string, now: Date = new Date()): boolean {
  return now.getTime() >= affiliateEventOverAt(eventDate).getTime();
}

/**
 * Fin d'une soirée externe en date-heure LOCALE ISO (« 2026-09-26T06:00:00 »).
 * Une heure de fermeture du matin (avant midi) ou antérieure à l'ouverture
 * tombe le LENDEMAIN : sans ce décalage, une soirée 23:59 → 06:00 « finissait »
 * le jour même à 06 h, avant d'avoir commencé, et Explore la retirait dès le
 * matin.
 */
export function affiliateEventEndAt(eventDate: string, startTime?: string | null, endTime?: string | null): string {
  const start = (startTime || '22:00').substring(0, 5);
  const end = (endTime || '05:30').substring(0, 5);
  const nextDay = end < '12:00' || end <= start;
  return `${nextDay ? addDaysToDate(eventDate, 1) : eventDate}T${end}:00`;
}
