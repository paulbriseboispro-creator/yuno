/**
 * LE vocabulaire d'argent de l'admin. Un terme = un nom, une définition, UNE
 * source. Toute page de l'admin qui affiche de l'argent prend son libellé et
 * son info-bulle ici (`moneyLabelKey`, `moneyHintKey`), jamais « GMV »,
 * « CA total », « Volume de ventes » ni « Revenus Yuno ».
 *
 * Module pur (testé, src/admin/__tests__/moneyTerms.test.ts).
 * Le dictionnaire est recopié dans docs/designs/ADMIN_REBUILD_PLAN.md (lot 4).
 */

export const MONEY_TERMS = ['sales', 'yunoRevenue', 'fees', 'subs', 'recharges', 'mrr', 'refunds', 'costs', 'margin'] as const;
export type MoneyTerm = (typeof MONEY_TERMS)[number];

/** D'où vient chaque chiffre (RPC et champ). */
export const MONEY_SOURCES: Record<MoneyTerm, string> = {
  sales: 'admin_platform_analytics.totals.gmv',
  yunoRevenue: 'admin_pilot_overview.kpis (fees + subs + recharges)',
  fees: 'admin_platform_analytics.totals.yuno_revenue',
  subs: 'admin_pilot_overview.kpis.subs (_admin_crm_subs, grille crm_pricing_config)',
  recharges: 'admin_pilot_overview.kpis.recharges (_admin_crm_recharges)',
  mrr: '_crm_admin_rows.mrr (somme)',
  refunds: 'admin_platform_analytics.totals.refunds_total',
  costs: 'admin_costs_list (admin_costs + ai_usage_events)',
  margin: 'revenu de Yuno − coûts',
};

export const moneyLabelKey = (t: MoneyTerm) => `adm.money.term.${t}`;
export const moneyHintKey = (t: MoneyTerm) => `adm.money.term.${t}.hint`;

/** Mots qu'aucune page de l'admin réécrite n'affiche plus (test des textes). */
export const BANNED_MONEY_WORDS = ['GMV', 'CA total', 'Volume de ventes', 'Revenus Yuno', 'Total revenue'] as const;

export interface RevenueParts { fees: number; subs: number; recharges: number }

/** Revenu de Yuno = frais de service + abonnements CRM + recharges de Yunits. */
export function yunoRevenue(p: Partial<RevenueParts> | null | undefined): number {
  if (!p) return 0;
  return round2((p.fees ?? 0) + (p.subs ?? 0) + (p.recharges ?? 0));
}

/** Taux de commission : frais de service / ventes de la plateforme, `null` sans ventes. */
export function takeRate(fees: number, sales: number): number | null {
  if (!Number.isFinite(sales) || sales <= 0) return null;
  return fees / sales;
}

/** Marge = revenu de Yuno − coûts. */
export function margin(revenue: number, costs: number): number {
  return round2(revenue - costs);
}

/**
 * Coûts d'un mois : les postes saisis ; l'IA prend la valeur saisie si elle
 * existe, sinon la valeur lue automatiquement.
 */
export interface CostLine { item: string; amount: number }
export function monthCosts(lines: CostLine[], aiAuto: number): { total: number; aiFromAuto: boolean } {
  const hasAi = lines.some((l) => l.item === 'ai');
  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return { total: round2(sum + (hasAi ? 0 : aiAuto || 0)), aiFromAuto: !hasAi };
}

/** Postes de coûts, dans l'ordre d'affichage. */
export const COST_ITEMS = ['resend', 'sms', 'ai', 'supabase', 'cloudflare', 'stripe', 'other'] as const;
export type CostItem = (typeof COST_ITEMS)[number];

/** Part (0..1) des n premiers dans un total ; `null` sous 10 éléments au total (pas de pourcentage). */
export function topShare(top: number, total: number, count: number, minSample = 10): number | null {
  if (count < minSample || total <= 0) return null;
  return top / total;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
