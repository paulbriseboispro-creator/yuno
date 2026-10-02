// Yuno CRM — abonnement (lot 4). Module PUR (aucun import Deno, aucun réseau) :
// importé par `club-subscription` (actions crm_*) et `stripe-webhook`, testé
// par vitest (src/lib/__tests__/crmBilling.test.ts).
//
// Les prix Stripe se retrouvent par leur `lookup_key`
// (`yuno_crm_<offre>_<month|year>[_founder]`, posée par
// scripts/stripe/create-crm-prices.mjs) : aucun identifiant de prix dans le code.

export type CrmPaidPlan = "essential" | "pro" | "business";
export type CrmInterval = "month" | "year";

export const CRM_PAID_PLANS: readonly CrmPaidPlan[] = ["essential", "pro", "business"];

export function isCrmPaidPlan(v: unknown): v is CrmPaidPlan {
  return typeof v === "string" && (CRM_PAID_PLANS as readonly string[]).includes(v);
}

export function crmLookupKey(plan: CrmPaidPlan, interval: CrmInterval, founder: boolean): string {
  return `yuno_crm_${plan}_${interval}${founder ? "_founder" : ""}`;
}

/** Relit une lookup_key CRM ; null si ce n'est pas un prix Yuno CRM. */
export function parseCrmLookupKey(key: unknown): { plan: CrmPaidPlan; interval: CrmInterval; founder: boolean } | null {
  if (typeof key !== "string") return null;
  const m = key.match(/^yuno_crm_(essential|pro|business)_(month|year)(_founder)?$/);
  if (!m) return null;
  return { plan: m[1] as CrmPaidPlan, interval: m[2] as CrmInterval, founder: !!m[3] };
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
  plan: CrmPaidPlan;
  interval: CrmInterval;
  founder: boolean;
  trial_end: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
}

const iso = (unix: number | null | undefined): string | null =>
  typeof unix === "number" && Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : null;

/**
 * Ce que le webhook écrit pour un abonnement Yuno CRM, ou null si l'abonnement
 * n'en est pas un (metadata.yuno_product ≠ crm, portée ou offre illisibles).
 * L'offre se lit d'abord dans la lookup_key du prix (un changement d'offre
 * remplace le prix), puis dans les métadonnées.
 */
export function crmSubscriptionUpdate(sub: StripeSubLike): CrmSubscriptionUpdate | null {
  const md = sub.metadata ?? {};
  if (md.yuno_product !== "crm") return null;
  const scope = typeof md.scope_key === "string" && /^(venue|org):.+$/.test(md.scope_key) ? md.scope_key : null;
  if (!scope) return null;
  const item = sub.items?.data?.[0];
  const fromKey = parseCrmLookupKey(item?.price?.lookup_key);
  const plan = fromKey?.plan ?? (isCrmPaidPlan(md.plan) ? md.plan : null);
  if (!plan) return null;
  const rawInterval = fromKey?.interval ?? item?.price?.recurring?.interval ?? md.interval;
  const interval: CrmInterval = rawInterval === "year" ? "year" : "month";
  const founder = fromKey ? fromKey.founder : md.founder === "1";
  return {
    scope_key: scope,
    subscription_id: sub.id,
    customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_status: sub.status,
    plan,
    interval,
    founder,
    trial_end: iso(sub.trial_end),
    period_end: iso(item?.current_period_end ?? sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
}
