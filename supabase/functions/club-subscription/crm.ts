// Yuno CRM — abonnement (lot 4) : actions `crm_checkout` et `crm_portal` de
// `club-subscription` (le quota de fonctions edge est atteint : on ajoute une
// action, jamais une fonction). La lecture de l'état passe par la RPC
// get_crm_billing ; l'écriture d'une offre payée par le webhook Stripe
// (crm_apply_stripe_subscription). Ici on ne fait que préparer le paiement.
//
// Différences voulues avec l'abonnement club de la Suite :
//   • le client Stripe est PROPRE au CRM, rangé sur crm_subscriptions — jamais
//     retrouvé par email (un club de la Suite a peut-être déjà le sien, et
//     `create` changerait le prix de son abonnement) ;
//   • les prix se retrouvent par lookup_key (scripts/stripe/create-crm-prices.mjs) ;
//   • le portail a sa propre configuration : résilier, payer, factures, mais
//     PAS de changement d'offre (les prix de la Suite y seraient proposés).

import Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveReturnOrigin } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { crmLookupKey, crmScopeKey, isCrmPaidPlan, stripeTrialEnd, type CrmInterval } from "../_shared/crm-billing.ts";

export interface CrmActionContext {
  req: Request;
  user: User;
  token: string;
  admin: SupabaseClient;
  stripe: Stripe;
  json: (body: unknown, status?: number) => Response;
  log: (step: string, details?: Record<string, unknown>) => void;
}

interface CrmRow {
  scope_key: string;
  plan: string;
  status: string;
  founder: boolean;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

const refuse = (ctx: CrmActionContext, code: string, status = 403) =>
  ctx.json({ success: false, error: code, code }, status);

/** Portée du compte, vérifiée : titulaire du club ou organisateur lui-même, produit CRM. */
async function resolveScope(ctx: CrmActionContext, body: Record<string, unknown>):
  Promise<{ scope: string; base: "/owner" | "/organizer-app"; name: string } | Response> {
  const scope = crmScopeKey(body.venue_id, body.organizer_user_id);
  if (!scope) return refuse(ctx, "bad_scope", 400);
  if (scope.startsWith("venue:")) {
    const { data: v } = await ctx.admin.from("venues").select("id, name, owner_id, product")
      .eq("id", scope.slice(6)).maybeSingle();
    if (!v || v.owner_id !== ctx.user.id) return refuse(ctx, "forbidden");
    if (v.product !== "crm") return refuse(ctx, "not_crm_account", 409);
    return { scope, base: "/owner", name: v.name ?? "" };
  }
  const orgId = scope.slice(4);
  if (orgId !== ctx.user.id) return refuse(ctx, "forbidden");
  const { data: o } = await ctx.admin.from("organizer_profiles").select("display_name, product")
    .eq("user_id", orgId).maybeSingle();
  if (!o) return refuse(ctx, "forbidden");
  if (o.product !== "crm") return refuse(ctx, "not_crm_account", 409);
  return { scope, base: "/organizer-app", name: o.display_name ?? "" };
}

async function loadRow(ctx: CrmActionContext, scope: string): Promise<CrmRow | null> {
  const { data } = await ctx.admin.from("crm_subscriptions")
    .select("scope_key, plan, status, founder, trial_ends_at, stripe_customer_id, stripe_subscription_id")
    .eq("scope_key", scope).maybeSingle();
  return (data as CrmRow | null) ?? null;
}

/** Configuration du portail réservée au CRM, créée une fois puis retrouvée par sa métadonnée. */
async function crmPortalConfiguration(stripe: Stripe): Promise<string> {
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = list.data.find((c) => c.metadata?.yuno_product === "crm");
  if (found) return found.id;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Yuno CRM" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
    },
    metadata: { yuno_product: "crm" },
  });
  return created.id;
}

export async function handleCrmAction(ctx: CrmActionContext, action: string, body: Record<string, unknown>): Promise<Response> {
  // Argent : jamais pendant un accès assisté (la session est celle du pro).
  if (await isSupportSessionToken(ctx.admin, ctx.token)) return refuse(ctx, "support_session_forbidden");

  const resolved = await resolveScope(ctx, body);
  if (resolved instanceof Response) return resolved;
  const { scope, base } = resolved;
  const { origin } = resolveReturnOrigin(ctx.req);
  const row = await loadRow(ctx, scope);

  if (action === "crm_portal") {
    if (!row?.stripe_customer_id) return refuse(ctx, "no_customer", 409);
    const configuration = await crmPortalConfiguration(ctx.stripe);
    const portal = await ctx.stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      configuration,
      return_url: `${origin}${base}/crm/billing`,
    });
    return ctx.json({ success: true, url: portal.url });
  }

  // ── crm_checkout ──────────────────────────────────────────────────────────
  const plan = body.plan;
  if (!isCrmPaidPlan(plan)) return refuse(ctx, "bad_plan", 400);
  const interval: CrmInterval = body.interval === "year" ? "year" : "month";

  const { data: seats } = await ctx.admin.rpc("crm_founder_seats_left");
  const founder = !!row?.founder || Number(seats ?? 0) > 0;
  const key = crmLookupKey(plan, interval, founder);
  const prices = await ctx.stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) {
    ctx.log("CRM price missing", { key });
    return refuse(ctx, "billing_not_configured", 409);
  }
  const metadata = { yuno_product: "crm", scope_key: scope, plan, interval, founder: founder ? "1" : "0", user_id: ctx.user.id };

  // Déjà abonné : on change le prix de CET abonnement (prorata), sans nouveau paiement.
  if (row?.stripe_subscription_id) {
    const current = await ctx.stripe.subscriptions.retrieve(row.stripe_subscription_id).catch(() => null);
    if (current && ["trialing", "active", "past_due"].includes(current.status)) {
      const item = current.items.data[0];
      if (item?.price?.id === price.id) return refuse(ctx, "already_on_plan", 409);
      await ctx.stripe.subscriptions.update(current.id, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
        metadata,
      });
      ctx.log("CRM subscription updated", { scope, plan, interval });
      return ctx.json({ success: true, updated: true });
    }
  }

  let customerId = row?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await ctx.stripe.customers.create({
      email: ctx.user.email ?? undefined,
      name: resolved.name || undefined,
      metadata: { yuno_product: "crm", scope_key: scope, user_id: ctx.user.id },
    });
    customerId = customer.id;
    const { error } = await ctx.admin.rpc("crm_set_stripe_customer", { p_scope_key: scope, p_customer_id: customerId });
    if (error) throw new Error(`crm_set_stripe_customer: ${error.message}`);
  }

  // L'essai offert par Yuno continue : on ne paie qu'à sa fin.
  const trialEnd = stripeTrialEnd(row?.status ?? null, row?.trial_ends_at ?? null);
  const session = await ctx.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    payment_method_collection: "always",
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    success_url: `${origin}${base}/crm/billing?checkout=success`,
    cancel_url: `${origin}${base}/crm/billing?checkout=canceled`,
    metadata,
    subscription_data: {
      metadata,
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
  });
  ctx.log("CRM checkout created", { scope, plan, interval, founder, trialEnd });
  return ctx.json({ success: true, url: session.url });
}
