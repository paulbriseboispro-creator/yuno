// Yuno CRM — abonnement et recharges (lot 4b) : actions `crm_*` de
// `club-subscription` (le quota de fonctions edge est atteint : on ajoute une
// action, jamais une fonction). L'état de l'abonnement se LIT par la RPC
// get_crm_billing et s'ÉCRIT par le webhook Stripe (crm_apply_stripe_subscription,
// crédit des recharges) ; ici on prépare les paiements et on agit chez Stripe.
//
//   crm_overview         carte, factures, prochaine facture, coordonnées, changement prévu
//   crm_checkout         s'abonner (mensuel ou annuel), l'essai Yuno continue chez Stripe
//   crm_switch_interval  mensuel ⇄ annuel, à la PROCHAINE échéance (subscription schedule)
//   crm_cancel           résilier à la fin de la période payée
//   crm_resume           reprendre un abonnement résilié qui court encore
//   crm_portal           changer de carte (portail Stripe, flux carte seulement)
//   crm_billing_details  raison sociale, adresse, SIRET, TVA, e-mail de facturation
//   crm_recharge         acheter des Yunits (paiement unique, facture émise)
//
// Différences voulues avec l'abonnement club de la Suite :
//   • le client Stripe est PROPRE au CRM, rangé sur crm_subscriptions — jamais
//     retrouvé par email (un club de la Suite a peut-être déjà le sien) ;
//   • les prix d'abonnement se retrouvent par lookup_key ; le prix de lancement
//     est garanti tant que l'abonnement vit (le rythme change, pas le palier) ;
//   • une recharge est calculée ici (crmRechargeQuote) et part en price_data.

import Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveReturnOrigin } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import {
  CRM_PRICE_TIERS, crmBaseLookupKey, crmCheckoutTiers, crmPublicPricesActive, crmRechargeQuote, crmScopeKey, parseCrmLookupKey, stripeTrialEnd,
  type CrmInterval, type CrmPriceTier,
} from "../_shared/crm-billing.ts";

export interface CrmActionContext {
  req: Request;
  user: User;
  token: string;
  admin: SupabaseClient;
  stripe: Stripe;
  json: (body: unknown, status?: number) => Response;
  log: (step: string, details?: Record<string, unknown>) => void;
}

export const CRM_ACTIONS = [
  "crm_price_status", "crm_overview", "crm_checkout", "crm_switch_interval", "crm_cancel", "crm_resume",
  "crm_portal", "crm_billing_details", "crm_recharge",
] as const;

interface CrmRow {
  scope_key: string;
  status: string;
  billing_interval: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

const TAX_CODE = "txcd_10000000";
const LIVE_STATUSES = ["trialing", "active", "past_due"];

const refuse = (ctx: CrmActionContext, code: string, status = 403) =>
  ctx.json({ success: false, error: code, code }, status);

/** Portée du compte, vérifiée : titulaire du club ou organisateur lui-même, produit CRM. */
async function resolveScope(ctx: CrmActionContext, body: Record<string, unknown>):
  Promise<{ scope: string; name: string } | Response> {
  const scope = crmScopeKey(body.venue_id, body.organizer_user_id);
  if (!scope) return refuse(ctx, "bad_scope", 400);
  if (scope.startsWith("venue:")) {
    const { data: v } = await ctx.admin.from("venues").select("id, name, owner_id, product")
      .eq("id", scope.slice(6)).maybeSingle();
    if (!v || v.owner_id !== ctx.user.id) return refuse(ctx, "forbidden");
    if (v.product !== "crm") return refuse(ctx, "not_crm_account", 409);
    return { scope, name: v.name ?? "" };
  }
  const orgId = scope.slice(4);
  if (orgId !== ctx.user.id) return refuse(ctx, "forbidden");
  const { data: o } = await ctx.admin.from("organizer_profiles").select("display_name, product")
    .eq("user_id", orgId).maybeSingle();
  if (!o) return refuse(ctx, "forbidden");
  if (o.product !== "crm") return refuse(ctx, "not_crm_account", 409);
  return { scope, name: o.display_name ?? "" };
}

async function loadRow(ctx: CrmActionContext, scope: string): Promise<CrmRow | null> {
  const { data } = await ctx.admin.from("crm_subscriptions")
    .select("scope_key, status, billing_interval, trial_ends_at, stripe_customer_id, stripe_subscription_id")
    .eq("scope_key", scope).maybeSingle();
  return (data as CrmRow | null) ?? null;
}

async function ensureCustomer(ctx: CrmActionContext, scope: string, name: string, row: CrmRow | null): Promise<string> {
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await ctx.stripe.customers.create({
    email: ctx.user.email ?? undefined,
    name: name || undefined,
    metadata: { yuno_product: "crm", scope_key: scope, user_id: ctx.user.id },
  });
  const { error } = await ctx.admin.rpc("crm_set_stripe_customer", { p_scope_key: scope, p_customer_id: customer.id });
  if (error) throw new Error(`crm_set_stripe_customer: ${error.message}`);
  return customer.id;
}

/** Le prix du socle pour ce rythme : le premier palier ACTIF dans l'ordre donné. */
async function basePrice(ctx: CrmActionContext, interval: CrmInterval, prefer?: CrmPriceTier | readonly CrmPriceTier[]): Promise<Stripe.Price | null> {
  const tiers: readonly CrmPriceTier[] = Array.isArray(prefer) ? prefer : prefer ? [prefer as CrmPriceTier] : CRM_PRICE_TIERS;
  const keys = tiers.map((t) => crmBaseLookupKey(interval, t));
  const list = await ctx.stripe.prices.list({ lookup_keys: keys, active: true, limit: 10 });
  for (const k of keys) {
    const p = list.data.find((x: Stripe.Price) => x.lookup_key === k);
    if (p) return p;
  }
  return null;
}

async function liveSubscription(ctx: CrmActionContext, row: CrmRow | null): Promise<Stripe.Subscription | null> {
  if (!row?.stripe_subscription_id) return null;
  const sub = await ctx.stripe.subscriptions.retrieve(row.stripe_subscription_id).catch(() => null);
  return sub && LIVE_STATUSES.includes(sub.status) ? sub : null;
}

const idOf = (x: string | { id: string } | null | undefined): string | null =>
  !x ? null : typeof x === "string" ? x : x.id;

/** Fin de la période en cours (clover : sur l'item). */
function periodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items.data[0] as unknown as { current_period_end?: number } | undefined;
  return item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
}

/** Le changement de rythme prévu par un calendrier (phase suivante), s'il y en a un. */
async function scheduledChange(ctx: CrmActionContext, sub: Stripe.Subscription):
  Promise<{ interval: CrmInterval; at: string } | null> {
  const scheduleId = idOf(sub.schedule as string | { id: string } | null);
  if (!scheduleId) return null;
  const sch = await ctx.stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ["phases.items.price"] }).catch(() => null);
  if (!sch || sch.status !== "active") return null;
  const now = Math.floor(Date.now() / 1000);
  const next = sch.phases.find((p: Stripe.SubscriptionSchedule.Phase) => p.start_date > now);
  const price = next?.items[0]?.price as Stripe.Price | string | undefined;
  if (!next || !price || typeof price === "string") return null;
  const parsed = parseCrmLookupKey(price.lookup_key);
  const interval = parsed?.interval ?? (price.recurring?.interval === "year" ? "year" : "month");
  return { interval, at: new Date(next.start_date * 1000).toISOString() };
}

/** Libère le calendrier d'un abonnement (annule un changement de rythme prévu). */
async function releaseSchedule(ctx: CrmActionContext, sub: Stripe.Subscription): Promise<void> {
  const scheduleId = idOf(sub.schedule as string | { id: string } | null);
  if (!scheduleId) return;
  await ctx.stripe.subscriptionSchedules.release(scheduleId).catch((e: unknown) => {
    ctx.log("CRM schedule release failed", { scheduleId, error: String(e) });
  });
}

/** Ce que dit une facture : abonnement (et son rythme), recharge (sa description), autre. */
function invoiceKind(inv: Stripe.Invoice): { kind: "subscription" | "recharge" | "other"; interval: CrmInterval | null; title: string } {
  const line = inv.lines?.data?.[0];
  if (String(inv.billing_reason ?? "").startsWith("subscription")) {
    const span = line?.period ? line.period.end - line.period.start : 0;
    return { kind: "subscription", interval: span > 40 * 86400 ? "year" : "month", title: "" };
  }
  if (inv.metadata?.kind === "recharge") return { kind: "recharge", interval: null, title: inv.description ?? line?.description ?? "" };
  return { kind: "other", interval: null, title: inv.description ?? line?.description ?? "" };
}

export async function handleCrmAction(ctx: CrmActionContext, action: string, body: Record<string, unknown>): Promise<Response> {
  // Argent : jamais pendant un accès assisté (la session est celle du pro).
  if (await isSupportSessionToken(ctx.admin, ctx.token)) return refuse(ctx, "support_session_forbidden");

  // ── crm_price_status (super admin) ────────────────────────────────────────
  // LECTURE seule chez Stripe : les quatre prix du socle, actifs ou non. Rien
  // n'est activé ici (l'activation des prix publics est un geste de Paul dans
  // Stripe) ; l'état observé est rangé en base pour que le niveau affiché
  // (crm_price_tier) suive ce que le checkout peut réellement facturer.
  if (action === "crm_price_status") {
    const { data: adminRole } = await ctx.admin.from("user_roles").select("user_id")
      .eq("user_id", ctx.user.id).eq("role", "admin").maybeSingle();
    if (!adminRole) return refuse(ctx, "forbidden");
    const keys = (["month", "year"] as const).flatMap((i) => CRM_PRICE_TIERS.map((t) => crmBaseLookupKey(i, t)));
    const list = await ctx.stripe.prices.list({ lookup_keys: keys, limit: 20 });
    const prices = keys.map((k) => {
      const p = list.data.find((x: Stripe.Price) => x.lookup_key === k);
      return { lookup_key: k, found: !!p, active: p?.active ?? false, amount: p?.unit_amount != null ? p.unit_amount / 100 : null };
    });
    const publicActive = crmPublicPricesActive(prices);
    await ctx.admin.rpc("crm_set_price_state", { p_public_active: publicActive });
    return ctx.json({ success: true, prices, public_active: publicActive });
  }

  const resolved = await resolveScope(ctx, body);
  if (resolved instanceof Response) return resolved;
  const { scope, name } = resolved;
  const { origin } = resolveReturnOrigin(ctx.req);
  const back = `${origin}/crm/account/billing`;
  const row = await loadRow(ctx, scope);

  // ── crm_overview ──────────────────────────────────────────────────────────
  if (action === "crm_overview") {
    if (!row?.stripe_customer_id) {
      return ctx.json({ success: true, customer: null, card: null, invoices: [], has_more: false, upcoming: null, scheduled: null, subscription: null });
    }
    const customer = await ctx.stripe.customers.retrieve(row.stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method", "tax_ids"],
    });
    if ((customer as Stripe.DeletedCustomer).deleted) return refuse(ctx, "no_customer", 409);
    const cus = customer as Stripe.Customer;
    const sub = await liveSubscription(ctx, row);

    // La carte : celle de l'abonnement, sinon celle du client.
    let pm: Stripe.PaymentMethod | null = null;
    const subPm = sub?.default_payment_method;
    if (subPm) pm = typeof subPm === "string" ? await ctx.stripe.paymentMethods.retrieve(subPm).catch(() => null) : subPm;
    if (!pm) {
      const cusPm = cus.invoice_settings?.default_payment_method;
      pm = !cusPm ? null : typeof cusPm === "string" ? await ctx.stripe.paymentMethods.retrieve(cusPm).catch(() => null) : cusPm;
    }
    const card = pm?.card
      ? { kind: "card", brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year }
      : pm?.sepa_debit ? { kind: "sepa", brand: "sepa", last4: pm.sepa_debit.last4 ?? "", exp_month: null, exp_year: null } : null;

    const limit = Math.min(Math.max(Number(body.invoices_limit) || 12, 1), 50);
    const invoices = await ctx.stripe.invoices.list({ customer: cus.id, limit });
    let upcoming: { amount: number; at: string | null } | null = null;
    if (sub && !sub.cancel_at_period_end) {
      const preview = await ctx.stripe.invoices.createPreview({ customer: cus.id, subscription: sub.id }).catch(() => null);
      if (preview) upcoming = { amount: preview.total, at: preview.next_payment_attempt ? new Date(preview.next_payment_attempt * 1000).toISOString() : (preview.period_end ? new Date(preview.period_end * 1000).toISOString() : null) };
    }
    const item = sub?.items.data[0];
    const parsed = parseCrmLookupKey(item?.price?.lookup_key);
    const vat = (cus.tax_ids?.data ?? []).find((t: Stripe.TaxId) => t.type === "eu_vat");

    return ctx.json({
      success: true,
      customer: {
        name: cus.name ?? "",
        email: cus.email ?? "",
        line1: cus.address?.line1 ?? "",
        line2: cus.address?.line2 ?? "",
        postal_code: cus.address?.postal_code ?? "",
        city: cus.address?.city ?? "",
        country: cus.address?.country ?? "FR",
        siret: cus.metadata?.siret ?? "",
        vat: vat?.value ?? "",
      },
      card,
      invoices: invoices.data
        .filter((i: Stripe.Invoice) => i.status !== "draft")
        .map((i: Stripe.Invoice) => ({
          id: i.id,
          number: i.number,
          at: new Date(i.created * 1000).toISOString(),
          total: i.total,
          currency: i.currency,
          status: i.status,
          ...invoiceKind(i),
          pdf: i.invoice_pdf ?? null,
          url: i.hosted_invoice_url ?? null,
        })),
      has_more: invoices.has_more,
      upcoming,
      scheduled: sub ? await scheduledChange(ctx, sub) : null,
      subscription: sub ? {
        status: sub.status,
        interval: parsed?.interval ?? (item?.price?.recurring?.interval === "year" ? "year" : "month"),
        tier: parsed?.tier ?? null,
        unit_amount: item?.price?.unit_amount ?? null,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        period_end: periodEnd(sub) ? new Date((periodEnd(sub) as number) * 1000).toISOString() : null,
        trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      } : null,
    });
  }

  // ── crm_portal (changer de carte) ─────────────────────────────────────────
  if (action === "crm_portal") {
    if (!row?.stripe_customer_id) return refuse(ctx, "no_customer", 409);
    const portal = await ctx.stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${back}?card=updated`,
      flow_data: { type: "payment_method_update", after_completion: { type: "redirect", redirect: { return_url: `${back}?card=updated` } } },
    });
    return ctx.json({ success: true, url: portal.url });
  }

  // ── crm_billing_details ───────────────────────────────────────────────────
  if (action === "crm_billing_details") {
    const str = (k: string, max = 200) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");
    const email = str("email", 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return refuse(ctx, "bad_email", 400);
    const country = (str("country", 2) || "FR").toUpperCase();
    const siret = str("siret", 20).replace(/\s+/g, "");
    if (siret && !/^\d{14}$/.test(siret)) return refuse(ctx, "bad_siret", 400);
    const vat = str("vat", 20).replace(/\s+/g, "").toUpperCase();
    const customerId = await ensureCustomer(ctx, scope, name, row);
    await ctx.stripe.customers.update(customerId, {
      name: str("name") || undefined,
      email: email || undefined,
      address: { line1: str("line1"), line2: str("line2") || undefined, postal_code: str("postal_code", 12), city: str("city", 80), country },
      metadata: { siret: siret || "" },
    });
    const existing = await ctx.stripe.customers.listTaxIds(customerId, { limit: 10 });
    const current = existing.data.find((t: Stripe.TaxId) => t.type === "eu_vat");
    if ((current?.value ?? "") !== vat) {
      if (vat) {
        try {
          await ctx.stripe.customers.createTaxId(customerId, { type: "eu_vat", value: vat });
        } catch (e) {
          ctx.log("CRM VAT refused", { error: String(e) });
          return refuse(ctx, "bad_vat", 400);
        }
      }
      if (current) await ctx.stripe.customers.deleteTaxId(customerId, current.id);
    }
    return ctx.json({ success: true });
  }

  // ── crm_recharge ──────────────────────────────────────────────────────────
  if (action === "crm_recharge") {
    const quote = crmRechargeQuote(body.yunits);
    if (!quote) return refuse(ctx, "bad_amount", 400);
    // Un compte en pause ne recharge pas : rien ne pourrait partir.
    const { data: plan } = await ctx.admin.rpc("crm_effective_plan", { p_scope_key: scope });
    if (plan === "paused") return refuse(ctx, "crm_paused", 402);
    const customerId = await ensureCustomer(ctx, scope, name, row);
    const label = `Recharge Yuno CRM · ${quote.received.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ")} Yunits`;
    const metadata = {
      yuno_product: "crm", kind: "recharge", scope_key: scope, user_id: ctx.user.id,
      yunits_base: String(quote.base), yunits_received: String(quote.received), bonus_pct: String(quote.bonusPct),
    };
    const session = await ctx.stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: quote.amountCents,
          tax_behavior: "exclusive",
          product_data: { name: label, tax_code: TAX_CODE },
        },
      }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      invoice_creation: { enabled: true, invoice_data: { description: label, metadata } },
      payment_intent_data: { metadata },
      metadata,
      success_url: `${origin}/crm/yunits?recharge=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/crm/yunits?recharge=canceled`,
    });
    ctx.log("CRM recharge checkout created", { scope, base: quote.base });
    return ctx.json({ success: true, url: session.url });
  }

  const interval: CrmInterval = body.interval === "year" ? "year" : "month";
  const sub = await liveSubscription(ctx, row);

  // ── crm_cancel / crm_resume ───────────────────────────────────────────────
  if (action === "crm_cancel" || action === "crm_resume") {
    if (!sub) return refuse(ctx, "no_subscription", 409);
    // Un abonnement tenu par un calendrier refuse cancel_at_period_end : on le libère.
    if (action === "crm_cancel") await releaseSchedule(ctx, sub);
    const updated = await ctx.stripe.subscriptions.update(sub.id, { cancel_at_period_end: action === "crm_cancel" });
    const end = periodEnd(updated);
    ctx.log(`CRM subscription ${action}`, { scope });
    return ctx.json({ success: true, cancel_at_period_end: !!updated.cancel_at_period_end, period_end: end ? new Date(end * 1000).toISOString() : null });
  }

  // ── crm_switch_interval ───────────────────────────────────────────────────
  if (action === "crm_switch_interval") {
    if (!sub) return refuse(ctx, "no_subscription", 409);
    const item = sub.items.data[0];
    const cur = parseCrmLookupKey(item?.price?.lookup_key);
    const curInterval: CrmInterval = cur?.interval ?? (item?.price?.recurring?.interval === "year" ? "year" : "month");
    // Revenir au rythme actuel = annuler le changement prévu.
    if (curInterval === interval) {
      await releaseSchedule(ctx, sub);
      return ctx.json({ success: true, scheduled: null });
    }
    // Le palier (lancement / public) suit l'abonnement : on ne change que le rythme.
    const price = await basePrice(ctx, interval, cur?.tier ?? undefined) ?? await basePrice(ctx, interval);
    if (!price) return refuse(ctx, "billing_not_configured", 409);
    if (sub.cancel_at_period_end) return refuse(ctx, "subscription_ending", 409);

    // Pendant l'essai, rien n'est encore payé : on change le prix tout de suite.
    if (sub.status === "trialing") {
      await releaseSchedule(ctx, sub);
      await ctx.stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: "none",
        metadata: { ...sub.metadata, interval, tier: parseCrmLookupKey(price.lookup_key)?.tier ?? "" },
      });
      return ctx.json({ success: true, scheduled: null, immediate: true });
    }

    // Sinon : à la prochaine échéance, par un calendrier à deux phases.
    const scheduleId = idOf(sub.schedule as string | { id: string } | null)
      ?? (await ctx.stripe.subscriptionSchedules.create({ from_subscription: sub.id })).id;
    const sch = await ctx.stripe.subscriptionSchedules.retrieve(scheduleId);
    const now = Math.floor(Date.now() / 1000);
    const current = sch.phases.find((p: Stripe.SubscriptionSchedule.Phase) => p.start_date <= now && p.end_date > now) ?? sch.phases[0];
    const curPrice = idOf(current.items[0]?.price as string | { id: string });
    if (!curPrice) return refuse(ctx, "billing_not_configured", 409);
    const phases = [
      { items: [{ price: curPrice, quantity: 1 }], start_date: current.start_date, end_date: current.end_date },
      { items: [{ price: price.id, quantity: 1 }], duration: { interval, interval_count: 1 }, proration_behavior: "none" },
    ];
    await ctx.stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      phases,
    } as unknown as Stripe.SubscriptionScheduleUpdateParams);
    ctx.log("CRM interval switch scheduled", { scope, interval, at: current.end_date });
    return ctx.json({ success: true, scheduled: { interval, at: new Date(current.end_date * 1000).toISOString() } });
  }

  // ── crm_checkout ──────────────────────────────────────────────────────────
  if (action !== "crm_checkout") return refuse(ctx, "unknown_action", 400);
  if (sub) return refuse(ctx, "already_subscribed", 409);
  // Le niveau vient de la base (seuil des 50, abonné existant = lancement) ;
  // le lancement reste TOUJOURS le repli : jamais un paiement qui échoue parce
  // que le prix public n'est pas (encore) actif chez Stripe.
  const { data: dueTier } = await ctx.admin.rpc("crm_price_tier_for", { p_scope_key: scope });
  const tiers = crmCheckoutTiers(dueTier);
  const price = await basePrice(ctx, interval, tiers);
  if (!price) {
    ctx.log("CRM price missing", { interval });
    return refuse(ctx, "billing_not_configured", 409);
  }
  if (dueTier === "public" && parseCrmLookupKey(price.lookup_key)?.tier !== "public") {
    // Le public était dû mais n'est pas actif : l'affichage revient au lancement.
    await ctx.admin.rpc("crm_set_price_state", { p_public_active: false });
    ctx.log("CRM public price inactive, launch used", { interval });
  }
  const tier = parseCrmLookupKey(price.lookup_key)?.tier ?? "launch";
  const customerId = await ensureCustomer(ctx, scope, name, row);
  const metadata = { yuno_product: "crm", scope_key: scope, plan: "base", interval, tier, user_id: ctx.user.id };

  // L'essai offert par Yuno continue : on ne paie qu'à sa fin.
  const trialEnd = stripeTrialEnd(row?.status ?? null, row?.trial_ends_at ?? null);
  const session = await ctx.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    payment_method_collection: "always",
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    success_url: `${back}?checkout=success`,
    cancel_url: `${back}?checkout=canceled`,
    metadata,
    subscription_data: {
      metadata,
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
  });
  ctx.log("CRM checkout created", { scope, interval, tier, trialEnd });
  return ctx.json({ success: true, url: session.url });
}
