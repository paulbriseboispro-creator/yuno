/**
 * Quand une soirée de club externe est-elle FINIE ?
 *
 * Une soirée datée du 25 commence le 25 vers 23 h et se termine le 26 au
 * petit matin : la déclarer « passée » à minuit (date-fns `isPast` sur
 * `event_date`) la faisait disparaître pendant qu'elle se jouait — c'est ce
 * qui a fait purger les soirées du soir même le 2026-09-25. On la considère
 * donc terminée le LENDEMAIN à midi, heure locale de l'appareil.
 */
export const AFFILIATE_EVENT_OVER_HOUR = 12;

/** Instant où la soirée datée `eventDate` (yyyy-MM-dd) est considérée finie. */
export function affiliateEventOverAt(eventDate: string): Date {
  const [y, m, d] = eventDate.split('-').map(Number);
  return new Date(y, m - 1, d + 1, AFFILIATE_EVENT_OVER_HOUR, 0, 0, 0);
}

export function isAffiliateEventOver(eventDate: string, now: Date = new Date()): boolean {
  return now.getTime() >= affiliateEventOverAt(eventDate).getTime();
}
