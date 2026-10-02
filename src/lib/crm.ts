// Yuno CRM — lectures pures des écrans de la Console CRM (testées :
// src/lib/__tests__/crm.test.ts). Les chiffres viennent des RPC
// get_crm_overview / get_crm_nights / get_crm_night_report ; ici on ne fait
// que les mettre en forme, jamais les recalculer.

export interface CrmCurvePoint {
  /** Jours calendaires avant la soirée (fuseau de la soirée) ; 0 = le jour J. */
  d: number;
  tickets: number;
}

/**
 * Courbe CUMULÉE des billets vendus, de J-`maxD` à J-0. Un jour sans vente
 * garde le total de la veille ; les ventes plus anciennes que J-`maxD` entrent
 * dans le premier point (rien ne disparaît du total).
 */
export function cumulativeCurve(points: readonly CrmCurvePoint[], maxD: number): { d: number; total: number }[] {
  const byD = new Map<number, number>();
  let before = 0;
  for (const p of points) {
    const d = Math.max(0, Math.round(p.d));
    if (d > maxD) before += p.tickets;
    else byD.set(d, (byD.get(d) ?? 0) + p.tickets);
  }
  const out: { d: number; total: number }[] = [];
  let total = before;
  for (let d = maxD; d >= 0; d--) {
    total += byD.get(d) ?? 0;
    out.push({ d, total });
  }
  return out;
}

/** Fenêtre utile de la courbe : de la première vente à J-0, bornée à 60 jours. */
export function curveWindow(...curves: readonly (readonly CrmCurvePoint[] | null | undefined)[]): number {
  let max = 7;
  for (const c of curves) for (const p of c ?? []) if (p.tickets > 0) max = Math.max(max, Math.round(p.d));
  return Math.min(max, 60);
}

/** Total vendu à J-`d` ou plus tôt (pour comparer deux soirées au même moment). */
export function soldBy(points: readonly CrmCurvePoint[], d: number): number {
  return points.reduce((sum, p) => (p.d >= d ? sum + p.tickets : sum), 0);
}

/** Jours calendaires restants avant une soirée (0 le jour J, négatif après). */
export function daysUntil(startAt: string, now: Date = new Date(), timeZone = 'Europe/Paris'): number {
  const day = (dt: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
    return Date.parse(`${parts}T00:00:00Z`);
  };
  return Math.round((day(new Date(startAt)) - day(now)) / 86_400_000);
}

/** Part de nouveaux acheteurs en %, ou null sous 10 acheteurs (MIN_SAMPLE). */
export function newBuyersShare(newBuyers: number, buyers: number): number | null {
  if (buyers < 10) return null;
  return Math.round((newBuyers / buyers) * 100);
}
