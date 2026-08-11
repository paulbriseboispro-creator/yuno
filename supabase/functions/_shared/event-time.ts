// Formatage des dates/heures d'événement côté serveur (edge functions Deno).
//
// RÈGLE D'OR : le runtime Deno tourne en UTC. Un `toLocale*` SANS option
// `timeZone` rend l'heure UTC brute — une soirée à 23h30 Paris (stockée
// `21:30Z` en `timestamptz`) s'affiche alors « 21h30 ». C'est LE bug des
// notifications. Ces helpers imposent TOUJOURS un fuseau (défaut Europe/Paris)
// pour qu'on ne puisse plus jamais l'oublier.
//
// Toujours passer `event.timezone` quand la ligne est disponible ; à défaut,
// le fuseau retombe sur Europe/Paris (comportement historique correct pour les
// venues françaises/espagnoles, toutes en UTC+1/+2).

export const DEFAULT_EVENT_TZ = "Europe/Paris";

/** Fuseau non vide, sinon le défaut plateforme. */
export const eventTz = (tz?: string | null): string =>
  tz && tz.trim() ? tz.trim() : DEFAULT_EVENT_TZ;

/**
 * Heure seule dans le fuseau de l'événement, ex. « 23:30 ».
 */
export function formatEventTime(
  startAt: string | Date,
  tz?: string | null,
  locale = "fr-FR",
): string {
  return new Date(startAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: eventTz(tz),
  });
}

/**
 * Date (avec heure optionnelle si `hour`/`minute` sont dans `opts`) dans le
 * fuseau de l'événement. Les options de composants restent libres ; seul
 * `timeZone` est imposé.
 */
export function formatEventDate(
  startAt: string | Date,
  opts: Intl.DateTimeFormatOptions,
  tz?: string | null,
  locale = "fr-FR",
): string {
  return new Date(startAt).toLocaleDateString(locale, {
    ...opts,
    timeZone: eventTz(tz),
  });
}
