import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CHECK-CLUB-SUBSCRIPTION] ${step}`, details ? JSON.stringify(details) : "");
};

// Price ID -> plan code mapping
const PRICE_TO_PLAN: Record<string, string> = {
  "price_1T91TpFIpANRmEzezOMFPZuQ": "essential",
  "price_1T91TpFIpANRmEzeuhtRxCUJ": "pro",
  "price_1T2Em8FIpANRmEze5eAaeE7o": "elite",
};

function resolvePlan(subscription: Stripe.Subscription): string {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId && PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];
  // Check metadata
  if (subscription.metadata?.plan) return subscription.metadata.plan;
  return "essential";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("User not authenticated");
    
    const user = userData.user;
    if (!user.email) throw new Error("User email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const body = await req.json().catch(() => ({}));
    let targetVenueId = body.venueId;

    if (!targetVenueId) {
      const { data: venue } = await supabaseClient
        .from("venues")
        .select("id")
        .eq("owner_id", user.id)
        .single();
      
      if (venue) {
        targetVenueId = venue.id;
      } else {
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("venue_id")
          .eq("id", user.id)
          .single();
        
        if (profile?.venue_id) {
          targetVenueId = profile.venue_id;
        }
      }
    }

    if (!targetVenueId) throw new Error("No venue found for this user");

    // ----- DB-FIRST: respect collab plan granted via partnership -----
    const { data: existingSub } = await supabaseClient
      .from("venue_subscriptions")
      .select("subscription_plan, status, plan_source, current_period_start, current_period_end, trial_end, stripe_subscription_id, stripe_customer_id")
      .eq("venue_id", targetVenueId)
      .maybeSingle();

    // Treat any 'collab' plan as the free Pro demo, regardless of plan_source
    if (existingSub?.subscription_plan === "collab") {
      logStep("Collab plan detected in DB, bypassing Stripe", { venueId: targetVenueId });
      return new Response(
        JSON.stringify({
          success: true,
          subscribed: true,
          status: existingSub.status || "active",
          subscriptionPlan: "collab",
          currentPeriodStart: existingSub.current_period_start,
          currentPeriodEnd: existingSub.current_period_end,
          isTrial: false,
          trialEnd: null,
          daysRemaining: null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-04-30.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      logStep("No customer found");
      // Never overwrite a non-paid existing plan (collab handled above; keep whatever DB has)
      const fallbackPlan = (existingSub?.subscription_plan as string) || "core";
      return new Response(
        JSON.stringify({ success: true, subscribed: false, status: "inactive", subscriptionPlan: fallbackPlan, isTrial: false, trialEnd: null, daysRemaining: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
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

      return new Response(
        JSON.stringify({ success: true, subscribed: false, status: "inactive", subscriptionPlan: "core", isTrial: false, trialEnd: null, daysRemaining: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
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

    const currentPeriodStart = toISO(subscription.current_period_start) ?? new Date().toISOString();
    const currentPeriodEnd = toISO(subscription.current_period_end) ?? new Date().toISOString();
    const status = subscription.status;
    const isTrial = status === "trialing";
    const trialEnd = toISO(subscription.trial_end);
    const subscriptionPlan = resolvePlan(subscription);
    
    let daysRemaining: number | null = null;
    if (isTrial && subscription.trial_end) {
      const now = new Date();
      const trialEndDate = toDate(subscription.trial_end);
      if (trialEndDate) {
        daysRemaining = Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      }
    }

    logStep("Subscription found", { subscriptionId: subscription.id, status, isTrial, daysRemaining, subscriptionPlan });

    // Sync to venue_subscriptions
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

    return new Response(
      JSON.stringify({
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
