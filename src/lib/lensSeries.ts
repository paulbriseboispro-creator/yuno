/**
 * Les courbes des vues d'ensemble : une soirée se lit en J-N (jours avant la
 * soirée), une période en dates. Ce module remplit les jours sans activité pour
 * que les deux axes soient continus et rend, pour chaque ligne, une `key` stable
 * (l'abscisse) — le composant n'a plus qu'à la mettre en forme.
 */
export interface AxisRow { d?: number; date?: string }

export type AxisPoint<T extends AxisRow> = Omit<T, 'd' | 'date'> & { key: string; d?: number; date?: string };

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Jours continus, du plus ancien au plus récent ; rien à tracer si la série est vide. */
export function fillAxis<T extends AxisRow>(rows: T[], blank: Omit<T, 'd' | 'date'>): AxisPoint<T>[] {
  if (rows.length === 0) return [];
  if (rows.some((r) => r.d != null)) {
    const by = new Map(rows.filter((r) => r.d != null).map((r) => [r.d as number, r]));
    const ds = [...by.keys()];
    const max = Math.max(...ds, 0);
    const min = Math.min(...ds, 0);
    const out: AxisPoint<T>[] = [];
    for (let d = max; d >= min; d--) out.push({ ...blank, ...(by.get(d) ?? {}), key: `d${d}`, d } as AxisPoint<T>);
    return out;
  }
  const by = new Map(rows.filter((r) => r.date).map((r) => [r.date as string, r]));
  const dates = [...by.keys()].sort();
  const out: AxisPoint<T>[] = [];
  for (let ms = toMs(dates[0]); ms <= toMs(dates[dates.length - 1]); ms += DAY_MS) {
    const date = toDate(ms);
    out.push({ ...blank, ...(by.get(date) ?? {}), key: date, date } as AxisPoint<T>);
  }
  return out;
}
