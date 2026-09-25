/**
 * Série des ventes d'Analytics › Ventes › Vue d'ensemble : le CA de chaque
 * pilier, jour par jour sur la période choisie (mois par mois au-delà de trois
 * mois), SANS trou — un jour sans vente est une barre à zéro, pas un jour qui
 * disparaît de l'axe.
 *
 * Les dates d'entrée sont des jours calendaires de Paris (`yyyy-MM-dd`), telles
 * que `useAnalyticsData` les produit.
 */

export type SalesPillar = 'tickets' | 'tables' | 'drinks';

export interface SalesDayRow {
  date: string;
  revenue: number;
}

export interface SalesPoint {
  /** `yyyy-MM-dd` (jour) ou `yyyy-MM` (mois). */
  key: string;
  tickets: number;
  tables: number;
  drinks: number;
  total: number;
}

export interface SalesSeries {
  unit: 'day' | 'month';
  points: SalesPoint[];
}

/** Au-delà de ce nombre de jours, la série passe au mois. */
export const MONTH_THRESHOLD_DAYS = 92;

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param byPillar lignes par pilier (dates `yyyy-MM-dd`)
 * @param from premier jour de la période, ou `null` (« tout le temps » : le
 *             premier jour qui a une vente)
 * @param to dernier jour de la période (aujourd'hui)
 */
export function buildSalesSeries(
  byPillar: Partial<Record<SalesPillar, SalesDayRow[]>>,
  from: string | null,
  to: string,
): SalesSeries {
  const pillars: SalesPillar[] = ['tickets', 'tables', 'drinks'];
  const all = pillars.flatMap((p) => (byPillar[p] ?? []).map((r) => r.date)).filter(Boolean).sort();
  const start = from ?? all[0] ?? to;
  if (toUtc(start) > toUtc(to)) return { unit: 'day', points: [] };

  const spanDays = Math.round((toUtc(to) - toUtc(start)) / DAY_MS) + 1;
  const unit: SalesSeries['unit'] = spanDays > MONTH_THRESHOLD_DAYS ? 'month' : 'day';
  const keyOf = (day: string) => (unit === 'month' ? day.slice(0, 7) : day);

  const points = new Map<string, SalesPoint>();
  for (let ms = toUtc(start); ms <= toUtc(to); ms += DAY_MS) {
    const k = keyOf(fromUtc(ms));
    if (!points.has(k)) points.set(k, { key: k, tickets: 0, tables: 0, drinks: 0, total: 0 });
  }
  for (const p of pillars) {
    for (const r of byPillar[p] ?? []) {
      const pt = points.get(keyOf(r.date));
      if (!pt) continue; // hors période
      pt[p] += r.revenue;
      pt.total += r.revenue;
    }
  }
  return { unit, points: [...points.values()] };
}
