/**
 * Périodes courtes (24 h / 48 h) des écrans d'analyse de la Console Agence.
 *
 * Sur 24 ou 48 h, une série par jour ou par semaine ne montre qu'une ou deux
 * barres : on passe à une série HORAIRE, en heure locale, qui finit sur
 * l'heure en cours. La clé d'une tranche est l'ISO de son début d'heure, donc
 * `new Date(key)` la relit sans ambiguïté.
 */

/** Au-delà de ce nombre d'heures, les séries restent quotidiennes. */
export const HOURLY_MAX_HOURS = 48;

/** Début de l'heure locale qui contient `d`, en ISO. */
export function hourKey(d: Date): string {
  const h = new Date(d);
  h.setMinutes(0, 0, 0);
  return h.toISOString();
}

/** Les `hours` tranches horaires qui finissent sur l'heure en cours, de la plus ancienne à la plus récente. */
export function hourlyKeys(hours: number, now: Date = new Date()): string[] {
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const keys: string[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    keys.push(new Date(end.getTime() - i * 3_600_000).toISOString());
  }
  return keys;
}

/** Série horaire : chaque valeur de `rows` tombe dans sa tranche, les heures vides restent à 0. */
export function bucketByHour<T>(
  rows: T[],
  hours: number,
  at: (row: T) => string,
  value: (row: T) => number = () => 1,
  now: Date = new Date(),
): { key: string; value: number }[] {
  const map = new Map<string, number>(hourlyKeys(hours, now).map(k => [k, 0]));
  for (const r of rows) {
    const k = hourKey(new Date(at(r)));
    const cur = map.get(k);
    if (cur !== undefined) map.set(k, cur + value(r));
  }
  return [...map.entries()].map(([key, v]) => ({ key, value: v }));
}
