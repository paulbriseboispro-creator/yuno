// Yuno CRM — abonnement et Yunits (lot 4b). Module PUR (aucun import Deno,
// aucun réseau) : importé par `club-subscription` (actions crm_*),
// `stripe-webhook` et le front, testé par vitest
// (src/lib/__tests__/crmBilling.test.ts).
//
// Une seule offre, le socle (décision du 02/10) : 29 € HT par mois au
// lancement, 39 € ensuite pour les nouveaux comptes ; l'annuel coûte douze
// mois et ajoute 30 000 Yunits d'un coup. Les prix Stripe se retrouvent par
// leur `lookup_key` (`yuno_crm_base_<month|year>_<launch|public>`, posée par
// scripts/stripe/create-crm-prices.mjs) : aucun identifiant de prix dans le code.
// Les recharges ne passent pas par un prix enregistré : le montant se calcule
// ici (500 Yunits par euro, bonus par palier) et part en `price_data`.

export type CrmInterval = "month" | "year";
export type CrmPriceTier = "launch" | "public";

export const CRM_PRICE_TIERS: readonly CrmPriceTier[] = ["launch", "public"];

export function crmBaseLookupKey(interval: CrmInterval, tier: CrmPriceTier): string {
  return `yuno_crm_base_${interval}_${tier}`;
}

/** Relit une lookup_key d'abonnement CRM ; null si ce n'est pas un prix du socle. */
export function parseCrmLookupKey(key: unknown): { interval: CrmInterval; tier: CrmPriceTier } | null {
  if (typeof key !== "string") return null;
  const m = key.match(/^yuno_crm_base_(month|year)_(launch|public)$/);
  if (!m) return null;
  return { interval: m[1] as CrmInterval, tier: m[2] as CrmPriceTier };
}

export function crmScopeKey(venueId: unknown, organizerUserId: unknown): string | null {
  const v = typeof venueId === "string" && venueId.trim() ? venueId.trim() : null;
  const o = typeof organizerUserId === "string" && /^[0-9a-f-]{36}$/i.test(organizerUserId) ? organizerUserId : null;
  if ((v === null) === (o === null)) return null; // une portée, et une seule
  return v ? `venue:${v}` : `org:${o}`;
}

/** L'essai offert par Yuno se prolonge chez Stripe s'il reste au moins 48 h (exigence Stripe). */
export function stripeTrialEnd(status: string | null, trialEndsAt: string | null, now: Date = new Date()): number | null {
  if (status !== "trialing" || !trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end) || end - now.getTime() < 48 * 3600_000) return null;
  return Math.floor(end / 1000);
}

// ── Recharges de Yunits ─────────────────────────────────────────────────────
// Miroir de crm_pricing_config() (recharge_min/max/step, yunits_per_euro,
// bonus_tiers) : le serveur recalcule toujours, le front n'affiche qu'un devis.

export const CRM_RECHARGE = {
  min: 5_000,
  max: 300_000,
  step: 5_000,
  perEuro: 500,
  /** Du palier le plus haut au plus bas : le premier atteint donne le bonus. */
  tiers: [{ min: 50_000, pct: 15 }, { min: 25_000, pct: 10 }] as const,
  validityMonths: 12,
} as const;

export interface CrmRechargeQuote {
  /** Yunits achetés (ce que le client paie). */
  base: number;
  bonusPct: number;
  /** Yunits reçus, bonus compris. */
  received: number;
  /** Prix HT en centimes. */
  amountCents: number;
}

export function crmRechargeBonusPct(base: number): number {
  for (const t of CRM_RECHARGE.tiers) if (base >= t.min) return t.pct;
  return 0;
}

/** Devis d'une recharge, ou null si le montant n'est pas une tranche permise. */
export function crmRechargeQuote(base: unknown): CrmRechargeQuote | null {
  const n = typeof base === "number" ? base : typeof base === "string" ? Number(base) : NaN;
  if (!Number.isInteger(n) || n < CRM_RECHARGE.min || n > CRM_RECHARGE.max || n % CRM_RECHARGE.step !== 0) return null;
  const bonusPct = crmRechargeBonusPct(n);
  return {
    base: n,
    bonusPct,
    received: Math.round(n * (1 + bonusPct / 100)),
    amountCents: Math.round((n / CRM_RECHARGE.perEuro) * 100),
  };
}

/** Plus petite recharge qui couvre `missing` Yunits (bonus compris), plafonnée au maximum. */
export function crmRechargeFor(missing: number): number {
  for (let v = CRM_RECHARGE.min; v <= CRM_RECHARGE.max; v += CRM_RECHARGE.step) {
    if ((crmRechargeQuote(v)?.received ?? 0) >= missing) return v;
  }
  return CRM_RECHARGE.max;
}

/** Ce que le webhook crédite pour une session de recharge payée, ou null. */
export function crmRechargeFromSession(session: {
  id: string;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
}): { scope_key: string; received: number; base: number; session_id: string } | null {
  const md = session.metadata ?? {};
  if (md.yuno_product !== "crm" || md.kind !== "recharge") return null;
  if (session.payment_status !== "paid") return null;
  const scope = typeof md.scope_key === "string" && /^(venue|org):.+$/.test(md.scope_key) ? md.scope_key : null;
  const quote = crmRechargeQuote(md.yunits_base);
  if (!scope || !quote) return null;
  // Le reçu est recalculé, jamais lu dans la métadonnée seule.
  return { scope_key: scope, received: quote.received, base: quote.base, session_id: session.id };
}

// ── Webhook d'abonnement ────────────────────────────────────────────────────

/** Forme minimale d'un abonnement Stripe lue par le webhook (clover : période sur l'item). */
export interface StripeSubLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ current_period_end?: number | null; price?: { lookup_key?: string | null; recurring?: { interval?: string | null } | null } | null }> } | null;
}

export interface CrmSubscriptionUpdate {
  scope_key: string;
  subscription_id: string;
  customer_id: string;
  stripe_status: string;
  interval: CrmInterval;
  /** Prix de lancement : garanti tant que l'abonnement vit. */
  founder: boolean;
  trial_end: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
}

const iso = (unix: number | null | undefined): string | null =>
  typeof unix === "number" && Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : null;

/**
 * Ce que le webhook écrit pour un abonnement Yuno CRM, ou null si l'abonnement
 * n'en est pas un (metadata.yuno_product ≠ crm, portée illisible). Le rythme se
 * lit d'abord dans la lookup_key du prix (un changement de rythme remplace le
 * prix), puis dans le prix, puis dans les métadonnées.
 */
export function crmSubscriptionUpdate(sub: StripeSubLike): CrmSubscriptionUpdate | null {
  const md = sub.metadata ?? {};
  if (md.yuno_product !== "crm") return null;
  const scope = typeof md.scope_key === "string" && /^(venue|org):.+$/.test(md.scope_key) ? md.scope_key : null;
  if (!scope) return null;
  const item = sub.items?.data?.[0];
  const fromKey = parseCrmLookupKey(item?.price?.lookup_key);
  const rawInterval = fromKey?.interval ?? item?.price?.recurring?.interval ?? md.interval;
  const interval: CrmInterval = rawInterval === "year" ? "year" : "month";
  const founder = fromKey ? fromKey.tier === "launch" : md.tier === "launch";
  return {
    scope_key: scope,
    subscription_id: sub.id,
    customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_status: sub.status,
    interval,
    founder,
    trial_end: iso(sub.trial_end),
    period_end: iso(item?.current_period_end ?? sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
}
