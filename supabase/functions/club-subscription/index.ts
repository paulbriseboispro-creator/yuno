import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolvePaymentMode, PAYMENTS_DISABLED_CODE } from "../_shared/payment-guard.ts";
import { SUBSCRIPTIONS_ENABLED } from "../_shared/venue-plan.ts";

// Pinned to the account's API version. Newer than the SDK's bundled types
// (which top out at basil), hence the cast. On clover+, a subscription's billing
// period lives on the subscription ITEM, not the subscription object — see
// periodBoundsOf() below.
const STRIPE_API_VERSION = "2025-12-15.clover" as unknown as Stripe.LatestApiVersion;

// Resolve the current billing period regardless of API version: item-level first
// (clover+), falling back to the subscription level (basil and earlier).
function periodBoundsOf(subscription: Stripe.Subscription): { start: number | null; end: number | null } {
  const item = subscription.items?.data?.[0] as unknown as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const sub = subscription as unknown as { current_period_start?: number; current_period_end?: number };
  return {
    start: item?.current_period_start ?? sub.current_period_start ?? null,
    end: item?.current_period_end ?? sub.current_period_end ?? null,
  };
}

// Unified club subscription dispatcher.
// Replaces: check-club-subscription, create-club-subscription, manage-club-subscription.
// Route via body.action: "check" | "create" | "manage".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CLUB-SUBSCRIPTION] ${step}`, details ? JSON.stringify(details) : "");
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

// Yuno Pricing GTM v1.0
//   monthly: Core free, Essential 39€, Pro 69€, Elite 99€
//   annual : 2 months free (= monthly × 10) → Essential 390€, Pro 690€, Elite 990€
//
// All paid price IDs live in Supabase secrets (no hardcoding) so the same code
// runs against the Stripe test account today and the live account later — a
// secrets swap, never a code deploy:
//   STRIPE_PRICE_{ESSENTIAL,PRO,ELITE}_{MONTHLY,ANNUAL}
// Core is free (0€) and never goes through Stripe checkout, so it has no price ID.
const PLAN_PRICES_MONTHLY: Record<string, string> = {
  essential: Deno.env.get("STRIPE_PRICE_ESSENTIAL_MONTHLY") ?? "",
  pro: Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? "",
  elite: Deno.env.get("STRIPE_PRICE_ELITE_MONTHLY") ?? "",
};
const PLAN_PRICES_ANNUAL: Record<string, string> = {
  essential: Deno.env.get("STRIPE_PRICE_ESSENTIAL_ANNUAL") ?? "",
  pro: Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") ?? "",
  elite: Deno.env.get("STRIPE_PRICE_ELITE_ANNUAL") ?? "",
};

type BillingCycle = "monthly" | "annual";

function priceForPlan(planCode: string, cycle: BillingCycle): string {
  return (cycle === "annual" ? PLAN_PRICES_ANNUAL : PLAN_PRICES_MONTHLY)[planCode] ?? "";
}

// Reverse map (both cycles) → plan code, used to resolve the plan from a Stripe sub.
const PRICE_TO_PLAN: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [plan, id] of Object.entries(PLAN_PRICES_MONTHLY)) if (id) map[id] = plan;
  for (const [plan, id] of Object.entries(PLAN_PRICES_ANNUAL)) if (id) map[id] = plan;
  return map;
})();

function resolvePlan(subscription: Stripe.Subscription): string {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId && PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];
  if (subscription.metadata?.plan) return subscription.metadata.plan;
  return "essential";
}

function billingIntervalOf(subscription: Stripe.Subscription): BillingCycle {
  return subscription.items?.data?.[0]?.price?.recurring?.interval === "year"
    ? "annual"
    : "monthly";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("User not authenticated");
    const user = userData.user;
    if (!user.email) throw new Error("User email not available");

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    logStep("Request", { userId: user.id, action });

    // ─────────────────────────────────────────────────────────────────────────
    // action: "check"  (← check-club-subscription)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "check") {
      let targetVenueId = body.venueId;

      if (!targetVenueId) {
        const { data: venue } = await supabaseClient
          .from("venues").select("id").eq("owner_id", user.id).single();
        if (venue) {
          targetVenueId = venue.id;
        } else {
          const { data: profile } = await supabaseClient
            .from("profiles").select("venue_id").eq("id", user.id).single();
          if (profile?.venue_id) targetVenueId = profile.venue_id;
        }
      }

      if (!targetVenueId) throw new Error("No venue found for this user");

      // DB-FIRST: respect collab plan granted via partnership
      const { data: existingSub } = await supabaseClient
        .from("venue_subscriptions")
        .select("subscription_plan, status, plan_source, current_period_start, current_period_end, trial_end, stripe_subscription_id, stripe_customer_id, is_early_adopter, price_locked")
        .eq("venue_id", targetVenueId)
        .maybeSingle();

      const isEarlyAdopter = !!existingSub?.is_early_adopter;
      const priceLocked = !!existingSub?.price_locked;

      if (existingSub?.subscription_plan === "collab") {
        logStep("Collab plan detected in DB, bypassing Stripe", { venueId: targetVenueId });
        return json({
          success: true,
          subscribed: true,
          status: existingSub.status || "active",
          subscriptionPlan: "collab",
          currentPeriodStart: existingSub.current_period_start,
          currentPeriodEnd: existingSub.current_period_end,
          isTrial: false,
          trialEnd: null,
          daysRemaining: null,
          isEarlyAdopter,
          priceLocked,
          billingInterval: null,
        });
      }

      // DB-FIRST: early adopter on the 3-month free grant (no Stripe sub yet).
      // Once they convert (stripe_subscription_id set) Stripe becomes the source of truth below.
      if (isEarlyAdopter && !existingSub?.stripe_subscription_id) {
        const trialEndDate = existingSub?.trial_end ? new Date(existingSub.trial_end) : null;
        const stillFree = trialEndDate ? trialEndDate.getTime() > Date.now() : false;
        if (stillFree) {
          const daysRemaining = Math.max(
            0,
            Math.ceil((trialEndDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          );
          logStep("Early adopter free period active", { venueId: targetVenueId, daysRemaining });
          return json({
            success: true,
            subscribed: true,
            status: "trialing",
            subscriptionPlan: existingSub?.subscription_plan || "core",
            currentPeriodStart: existingSub?.current_period_start ?? null,
            currentPeriodEnd: existingSub?.trial_end ?? null,
            isTrial: true,
            trialEnd: existingSub?.trial_end ?? null,
            daysRemaining,
            isEarlyAdopter: true,
            priceLocked,
            billingInterval: null,
          });
        }
        // Free period elapsed and never converted → fall back to Core (paywall), keep flag.
        logStep("Early adopter free period elapsed, no conversion", { venueId: targetVenueId });
        return json({
          success: true,
          subscribed: false,
          status: "inactive",
          subscriptionPlan: "core",
          isTrial: false,
          trialEnd: existingSub?.trial_end ?? null,
          daysRemaining: 0,
          isEarlyAdopter: true,
          priceLocked,
          billingInterval: null,
        });
      }

      const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });

      if (customers.data.length === 0) {
        logStep("No customer found");
        const fallbackPlan = (existingSub?.subscription_plan as string) || "core";
        return json({ success: true, subscribed: false, status: "inactive", subscriptionPlan: fallbackPlan, isTrial: false, trialEnd: null, daysRemaining: null, isEarlyAdopter, priceLocked, billingInterval: null });
      }

      const customerId = customers.data[0].id;
      logStep("Customer found", { customerId });

      const allSubs = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
      const subscription = allSubs.data.find((s) =>
        s.status === "active" || s.status === "trialing" || s.status === "past_due"
      );

      if (!subscription) {
        logStep("No active subscription found");
        await supabaseClient
          .from("venue_subscriptions")
          .upsert({
            venue_id: targetVenueId,
            stripe_customer_id: customerId,
            status: "inactive",
            subscription_plan: "core",
            updated_at: new Date().toISOString(),
          }, { onConflict: "venue_id" });

        return json({ success: true, subscribed: false, status: "inactive", subscriptionPlan: "core", isTrial: false, trialEnd: null, daysRemaining: null, isEarlyAdopter, priceLocked, billingInterval: null });
      }

      const toISO = (val: unknown): string | null => {
        if (!val) return null;
        if (typeof val === "number") return new Date(val * 1000).toISOString();
        if (typeof val === "string") return new Date(val).toISOString();
        return null;
      };
      const toDate = (val: unknown): Date | null => {
        if (!val) return null;
        if (typeof val === "number") return new Date(val * 1000);
        if (typeof val === "string") return new Date(val);
        return null;
      };

      const { start: periodStartRaw, end: periodEndRaw } = periodBoundsOf(subscription);
      const currentPeriodStart = toISO(periodStartRaw) ?? new Date().toISOString();
      const currentPeriodEnd = toISO(periodEndRaw) ?? new Date().toISOString();
      const status = subscription.status;
      const isTrial = status === "trialing";
      const trialEnd = toISO(subscription.trial_end);
      const subscriptionPlan = resolvePlan(subscription);
      const billingInterval = billingIntervalOf(subscription);

      let daysRemaining: number | null = null;
      if (isTrial && subscription.trial_end) {
        const now = new Date();
        const trialEndDate = toDate(subscription.trial_end);
        if (trialEndDate) {
          daysRemaining = Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }

      logStep("Subscription found", { subscriptionId: subscription.id, status, isTrial, daysRemaining, subscriptionPlan });

      await supabaseClient
        .from("venue_subscriptions")
        .upsert({
          venue_id: targetVenueId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: customerId,
          status: status,
          subscription_plan: subscriptionPlan,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          trial_end: trialEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: "venue_id" });

      return json({
        success: true,
        subscribed: status === "active" || status === "trialing",
        status,
        subscriptionId: subscription.id,
        subscriptionPlan,
        currentPeriodStart,
        currentPeriodEnd,
        isTrial,
        trialEnd,
        daysRemaining,
        isEarlyAdopter,
        priceLocked,
        billingInterval,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "create"  (← create-club-subscription)
    // ─────────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    // action: "activate_free"  (période de lancement — SUBSCRIPTIONS_ENABLED=false)
    // Un club en plan `collab` (démo auto-accordée via partenariat orga) active
    // son propre compte club, gratuitement, sans Stripe. Le plan passe à 'core'
    // (le front sert l'expérience complète tant que l'abonnement est coupé).
    // plan_source reste 'collab_auto' : le trigger
    // activate_collab_plan_on_partnership ne rétrograde en collab que les rangées
    // 'core' + plan_source='paid', donc une prochaine co-soirée ne réverrouille
    // pas un club activé.
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "activate_free") {
      if (SUBSCRIPTIONS_ENABLED) {
        return json({ success: false, error: "Free activation is only available while subscriptions are off.", code: "subscriptions_enabled" }, 200);
      }

      let targetVenueId = body.venueId;
      if (!targetVenueId) {
        const { data: venue } = await supabaseClient
          .from("venues").select("id").eq("owner_id", user.id).single();
        if (venue) targetVenueId = venue.id;
      }
      if (!targetVenueId) throw new Error("No venue found for this user");

      // Écriture → propriété stricte requise (pas le fallback profiles.venue_id,
      // qui couvre aussi le staff).
      const { data: ownedVenue } = await supabaseClient
        .from("venues").select("id, owner_id").eq("id", targetVenueId).single();
      if (!ownedVenue || ownedVenue.owner_id !== user.id) {
        return json({ success: false, error: "Only the venue owner can activate the club.", code: "not_owner" }, 200);
      }

      const now = new Date().toISOString();
      const { error: upsertError } = await supabaseClient
        .from("venue_subscriptions")
        .upsert({
          venue_id: targetVenueId,
          subscription_plan: "core",
          status: "active",
          plan_source: "collab_auto",
          trial_end: null,
          updated_at: now,
        }, { onConflict: "venue_id" });
      if (upsertError) throw upsertError;

      logStep("FREE activation granted (launch period, no Stripe)", { venueId: targetVenueId });
      return json({ success: true, activated: true, plan: "core" });
    }

    if (action === "create") {
      let targetVenueId = body.venueId;
      const planCode = body.planCode || "elite";
      const billingCycle: BillingCycle = body.billingCycle === "annual" ? "annual" : "monthly";

      // Elite is defined but NOT purchasable at launch — its features are unbuilt.
      // The billing UI hides its CTA; this rejects any direct attempt (defense in depth).
      if (planCode === "elite") {
        return json({ success: false, error: "Elite is not available yet.", code: "elite_not_available" }, 200);
      }

      if (!targetVenueId) {
        const { data: venue } = await supabaseClient
          .from("venues").select("id").eq("owner_id", user.id).single();
        if (venue) {
          targetVenueId = venue.id;
        } else {
          const { data: profile } = await supabaseClient
            .from("profiles").select("venue_id").eq("id", user.id).single();
          if (profile?.venue_id) targetVenueId = profile.venue_id;
        }
      }

      if (!targetVenueId) throw new Error("No venue found for this user");

      // ── Payments kill-switch + demo bypass ──────────────────────────────────
      // Resolved BEFORE the Stripe price lookup so a demo subscription works even
      // when the STRIPE_PRICE_* secrets aren't configured yet.
      const paymentMode = (await resolvePaymentMode(supabaseClient, user.email)).mode;
      if (paymentMode === "blocked") {
        return json({ success: false, error: "Payments are temporarily unavailable. Please try again later.", code: PAYMENTS_DISABLED_CODE }, 200);
      }
      if (paymentMode === "simulate") {
        // Demo (@womber.fr): grant the plan as active with no Stripe. Period runs
        // one month (or one year) from now to mirror the chosen billing cycle.
        const now = new Date();
        const periodEnd = new Date(now);
        if (billingCycle === "annual") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        else periodEnd.setMonth(periodEnd.getMonth() + 1);
        await supabaseClient
          .from("venue_subscriptions")
          .upsert({
            venue_id: targetVenueId,
            subscription_plan: planCode,
            status: "active",
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            trial_end: null,
            updated_at: now.toISOString(),
          }, { onConflict: "venue_id" });
        logStep("DEMO subscription granted (no Stripe)", { venueId: targetVenueId, planCode, billingCycle });
        return json({ success: true, updated: true, plan: planCode, billingCycle, demo: true });
      }

      const priceId = priceForPlan(planCode, billingCycle);
      if (!priceId) {
        const cycleKey = billingCycle === "annual" ? "ANNUAL" : "MONTHLY";
        throw new Error(
          `Price not configured for plan "${planCode}" (${billingCycle}). Set STRIPE_PRICE_${planCode.toUpperCase()}_${cycleKey}.`,
        );
      }

      const { data: venue } = await supabaseClient
        .from("venues").select("id, name").eq("id", targetVenueId).single();

      // Early adopters already used their 3-month free grant. When they convert,
      // they get NO extra trial, and picking annual freezes their price for life.
      const { data: subRow } = await supabaseClient
        .from("venue_subscriptions")
        .select("is_early_adopter")
        .eq("venue_id", targetVenueId)
        .maybeSingle();
      const isEarlyAdopter = !!subRow?.is_early_adopter;
      const lockPrice = isEarlyAdopter && billingCycle === "annual";

      const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      let customerId: string;

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        logStep("Existing customer found", { customerId });

        const existingSubs = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
        const activeOrTrialing = existingSubs.data.find((s) =>
          ["active", "trialing", "past_due"].includes(s.status)
        );

        if (activeOrTrialing) {
          const currentPriceId = activeOrTrialing.items.data[0]?.price?.id;
          if (currentPriceId === priceId) {
            logStep("Already on this plan", { subscriptionId: activeOrTrialing.id });
            return json({ success: false, error: "You are already on this plan" }, 400);
          }

          logStep("Updating subscription to new plan", { from: currentPriceId, to: priceId });
          await stripe.subscriptions.update(activeOrTrialing.id, {
            items: [{
              id: activeOrTrialing.items.data[0].id,
              price: priceId,
            }],
            proration_behavior: "create_prorations",
            metadata: { venue_id: targetVenueId, user_id: user.id, plan: planCode },
          });

          await supabaseClient
            .from("venue_subscriptions")
            .upsert({
              venue_id: targetVenueId,
              subscription_plan: planCode,
              ...(lockPrice ? { price_locked: true } : {}),
              updated_at: new Date().toISOString(),
            }, { onConflict: "venue_id" });

          logStep("Subscription updated", { subscriptionId: activeOrTrialing.id, newPlan: planCode, billingCycle, lockPrice });
          return json({ success: true, updated: true, plan: planCode, billingCycle });
        }
      } else {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: {
            venue_id: targetVenueId,
            venue_name: venue?.name || "",
            user_id: user.id,
          },
        });
        customerId = customer.id;
        logStep("New customer created", { customerId });
      }

      // Standard offer: 14-day trial, credit card required at signup (filters
      // curious sign-ups, lifts conversion). Early adopters converting after their
      // free 3 months get NO extra trial — they pay immediately.
      const trialDays = isEarlyAdopter ? 0 : 14;

      const origin = req.headers.get("origin") || "https://yunoapp.eu";
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        payment_method_collection: "always",
        success_url: `${origin}/owner/billing?subscription=success`,
        cancel_url: `${origin}/owner/billing?subscription=canceled`,
        metadata: { venue_id: targetVenueId, user_id: user.id, plan: planCode, billing_cycle: billingCycle },
        subscription_data: {
          ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
          metadata: { venue_id: targetVenueId, user_id: user.id, plan: planCode, billing_cycle: billingCycle },
        },
      });

      // Freeze the price for annual early adopters (optimistic; harmless if checkout is abandoned).
      if (lockPrice) {
        await supabaseClient
          .from("venue_subscriptions")
          .upsert({
            venue_id: targetVenueId,
            price_locked: true,
            updated_at: new Date().toISOString(),
          }, { onConflict: "venue_id" });
      }

      logStep("Checkout session created", { sessionId: session.id, plan: planCode, price: priceId, billingCycle, trialDays, lockPrice });
      return json({ success: true, sessionId: session.id, url: session.url });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "manage"  (← manage-club-subscription)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "manage") {
      const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length === 0) {
        throw new Error("No Stripe customer found for this user");
      }
      const customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });

      const origin = req.headers.get("origin") || "https://yunoapp.eu";
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/owner/venue`,
      });
      logStep("Billing portal session created", { url: portalSession.url });

      return json({ url: portalSession.url });
    }

    throw new Error(`Unknown or missing action: ${action ?? "(none)"}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return json({ error: errorMessage }, 400);
  }
});
