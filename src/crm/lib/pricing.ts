/**
 * Page Tarifs de Yuno CRM (/crm/tarifs) : la grille lue en base
 * (`crm_pricing_config`, ouverte aux visiteurs) et le simulateur du mois.
 * Les recharges suivent les règles de vente réelles (`crmRechargeQuote`,
 * `crmRechargeFor` : le MÊME calcul que la page Yunits et le serveur) ; aucun
 * prix n'est écrit ici en dur. Pures et testées.
 */
import { CRM_RECHARGE, crmRechargeFor, crmRechargeQuote, type CrmRechargeQuote } from '@/lib/crmBilling';

export interface CrmPricingConfig {
  price_month: number;
  price_month_next: number;
  price_year: number;
  monthly_yunits: number;
  annual_bonus_yunits: number;
  trial_days: number;
  trial_yunits: number;
  vat_rate: number;
  purchase_validity_months: number;
  recharge_min: number;
  recharge_max: number;
  yunits_per_euro: number;
  rates: Record<string, number>;
  channels_live: Record<string, boolean>;
  /** Niveau de prix en vigueur pour un NOUVEAU compte (crm_price_tier), posé par usePricingConfig. */
  tier?: 'launch' | 'public';
}

/**
 * Les prix montrés à un nouveau compte selon le niveau (seuil des 50) : au
 * niveau public, le mensuel est `price_month_next` et l'annuel douze fois ce
 * prix (miroir des prix Stripe publics et de get_crm_billing).
 */
export function pricesForTier<T extends Pick<CrmPricingConfig, 'price_month' | 'price_month_next' | 'price_year'>>(cfg: T, tier: 'launch' | 'public'): T & { tier: 'launch' | 'public' } {
  return tier === 'public' ? { ...cfg, tier, price_month: cfg.price_month_next, price_year: cfg.price_month_next * 12 } : { ...cfg, tier };
}

/** Recharges montrées en exemple : de vraies tranches de la page Yunits (sans bonus, puis les deux paliers). */
export function rechargeExamples(): CrmRechargeQuote[] {
  const lowest = CRM_RECHARGE.tiers[CRM_RECHARGE.tiers.length - 1].min;
  const picks = [CRM_RECHARGE.min, CRM_RECHARGE.min * 2, lowest, CRM_RECHARGE.tiers[0].min];
  return picks.map((v) => crmRechargeQuote(v)).filter((q): q is CrmRechargeQuote => !!q);
}

export interface MonthEstimate {
  /** Yunits consommés par les envois du mois. */
  used: number;
  /** Part couverte par les Yunits offerts avec l'abonnement. */
  included: number;
  /** Ce qu'il faut acheter en plus. */
  need: number;
  /** La recharge la moins chère qui couvre le besoin (null : aucune). */
  recharge: CrmRechargeQuote | null;
  /** Prix de la recharge, en euros HT. */
  rechargeEur: number;
  /** Yunits achetés qui restent après le mois (valables un an). */
  left: number;
  /** Abonnement + recharge, en euros HT. */
  total: number;
}

export function estimateMonth(emails: number, sms: number, cfg: Pick<CrmPricingConfig, 'rates' | 'monthly_yunits' | 'price_month'>): MonthEstimate {
  const used = Math.max(0, emails) * (cfg.rates.email ?? 1) + Math.max(0, sms) * (cfg.rates.sms ?? 35);
  const included = Math.min(used, cfg.monthly_yunits);
  const need = Math.max(0, used - cfg.monthly_yunits);
  const recharge = need > 0 ? crmRechargeQuote(crmRechargeFor(need)) : null;
  const rechargeEur = recharge ? recharge.amountCents / 100 : 0;
  return { used, included, need, recharge, rechargeEur, left: recharge ? Math.max(0, recharge.received - need) : 0, total: cfg.price_month + rechargeEur };
}

/** Curseurs du simulateur : une échelle en racine carrée (fine en bas, large en haut), arrondie à un pas lisible. */
export const EMAILS_MAX = 200_000;
export const SMS_MAX = 3_000;
export function snapEmails(v: number): number {
  const x = Math.max(0, Math.min(EMAILS_MAX, v));
  return Math.min(EMAILS_MAX, x < 10_000 ? Math.round(x / 250) * 250 : x < 50_000 ? Math.round(x / 1000) * 1000 : Math.round(x / 5000) * 5000);
}
export function snapSms(v: number): number {
  const x = Math.max(0, Math.min(SMS_MAX, v));
  return Math.min(SMS_MAX, x < 200 ? Math.round(x / 10) * 10 : x < 1000 ? Math.round(x / 50) * 50 : Math.round(x / 100) * 100);
}
/** Position du curseur (0-1000) ⇄ valeur. */
export const toSlider = (v: number, max: number): number => Math.round(1000 * Math.sqrt(Math.max(0, v) / max));
export const fromSlider = (pos: number, max: number): number => max * Math.pow(Math.max(0, Math.min(1000, pos)) / 1000, 2);

/** Profils du simulateur. */
export const PRICING_PROFILES = [
  { id: 'asso', emails: 4_000, sms: 0 },
  { id: 'orga', emails: 45_000, sms: 300 },
  { id: 'club', emails: 90_000, sms: 500 },
] as const;
export type PricingProfileId = (typeof PRICING_PROFILES)[number]['id'];
