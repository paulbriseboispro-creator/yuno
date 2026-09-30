/**
 * La « nuit » d'un horodatage : de 12:00 à 11:59 le lendemain, dans le fuseau
 * du club. Une vente à 02 h du matin compte pour la soirée de la veille.
 * Miroir exact de la fonction SQL `night_date(ts, tz)` (migration
 * `20261001100000_analytics_v3_core.sql`) — testé dans `__tests__/night.test.ts`.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    cache.set(tz, f);
  }
  return f;
}

/** Date locale (YYYY-MM-DD) et heure locale (0-23) d'un instant dans un fuseau. */
export function localDateTime(ts: Date | string, tz = 'Europe/Paris'): { date: string; hour: number; minute: number } {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  const parts = partsFormatter(tz || 'Europe/Paris').formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  // `en-GB` rend « 24 » pour minuit avec hourCycle h24 sur certains moteurs : ramené à 0.
  const hour = Number(get('hour')) % 24;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour, minute: Number(get('minute')) };
}

/** Décale une date ISO (YYYY-MM-DD) de `days` jours, sans fuseau. */
export function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

/** La nuit (YYYY-MM-DD) d'un instant : le jour local si ≥ 12:00, sinon la veille. */
export function nightDate(ts: Date | string, tz = 'Europe/Paris'): string {
  const { date, hour } = localDateTime(ts, tz);
  return hour >= 12 ? date : shiftIsoDate(date, -1);
}

/** Nombre de nuits entre deux instants (positif quand `later` est après). */
export function nightsBetween(earlier: Date | string, later: Date | string, tz = 'Europe/Paris'): number {
  const a = nightDate(earlier, tz), b = nightDate(later, tz);
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
