/**
 * Règles pures du tunnel d'achat de Yuno Tickets › Analyses › Trafic
 * (`funnel.flow` de tix_ana_visits, migration 20261216100000). Testées.
 */
import type { FunnelChoice, FunnelFlow, FunnelPillar, FunnelSteps } from '@/tickets/analytics/data';

export type FlowView = 'all' | FunnelPillar;
export type FlowStep = keyof FunnelSteps;

/** Les piliers qui ont au moins un choix : le sélecteur ne s'affiche qu'à partir de deux. */
export function flowPillars(flow: FunnelFlow): FunnelPillar[] {
  return (['tickets', 'tables', 'guest_list'] as const).filter((p) => (flow.by_pillar[p]?.selected ?? 0) > 0);
}

/** Les étapes d'une vue : la visite de la page reste commune à tous les piliers. */
export function flowSteps(flow: FunnelFlow, view: FlowView): FunnelSteps {
  if (view === 'all') return flow.steps;
  const p = flow.by_pillar[view];
  return { viewed: flow.steps.viewed, selected: p?.selected ?? 0, checkout: p?.checkout ?? 0, details: p?.details ?? 0, payment: p?.payment ?? 0, purchased: p?.purchased ?? 0 };
}

/** Les étapes affichées. La guest list ne passe pas par un paiement. */
export function flowRows(view: FlowView): FlowStep[] {
  return view === 'guest_list'
    ? ['viewed', 'selected', 'checkout', 'purchased']
    : ['viewed', 'selected', 'checkout', 'payment', 'purchased'];
}

/**
 * Après le choix, la transition qui perd la plus grande part de ses visites
 * (au moins 10 visites au départ). Null sans perte.
 */
export function biggestLoss(steps: FunnelSteps, rows: FlowStep[], min = 10): { from: FlowStep; to: FlowStep; lost: number; of: number; pct: number } | null {
  let best: { from: FlowStep; to: FlowStep; lost: number; of: number; pct: number } | null = null;
  const start = rows.indexOf('selected');
  for (let i = Math.max(start, 0); i < rows.length - 1; i++) {
    const of = steps[rows[i]];
    const lost = of - steps[rows[i + 1]];
    if (of < min || lost <= 0) continue;
    const pct = (lost / of) * 100;
    if (!best || pct > best.pct) best = { from: rows[i], to: rows[i + 1], lost, of, pct };
  }
  return best;
}

/** Le billet le plus laissé sans achat, puis le plus vu « Épuisé ». */
export function choiceHighlights(choices: FunnelChoice[]): { left: FunnelChoice | null; out: FunnelChoice | null } {
  const left = choices.filter((c) => c.left > 0).sort((a, b) => b.left - a.left || b.seats - a.seats)[0] ?? null;
  const out = choices.filter((c) => c.soldout_seen > 0).sort((a, b) => b.soldout_seen - a.soldout_seen)[0] ?? null;
  return { left, out };
}
