import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-CLUB-SUBSCRIPTION] ${step}`, details ? JSON.stringify(details) : "");
};

// Plan code -> Stripe price ID mapping
const PLAN_PRICES: Record<string, string> = {
  essential: "price_1T91TpFIpANRmEzezOMFPZuQ",
  pro: "price_1T91TpFIpANRmEzeuhtRxCUJ",
  elite: "price_1T2Em8FIpANRmEze5eAaeE7o",
};

// Reverse mapping: price ID -> plan code
const PRICE_TO_PLAN: Record<string, string> = {};
for (const [plan, priceId] of Object.entries(PLAN_PRICES)) {
  PRICE_TO_PLAN[priceId] = plan;
}
// price_1T2Em8FIpANRmEze5eAaeE7o is the elite price (already in PLAN_PRICES)

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
    const planCode = body.planCode || "elite";
    const priceId = PLAN_PRICES[planCode];
    if (!priceId) throw new Error(`Invalid plan code: ${planCode}`);

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

    const { data: venue } = await supabaseClient
      .from("venues")
      .select("id, name")
      .eq("id", targetVenueId)
      .single();

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-04-30.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing customer found", { customerId });

      // Check Stripe directly for existing active/trialing subscriptions
      const existingSubs = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
      const activeOrTrialing = existingSubs.data.find((s) =>
        ["active", "trialing", "past_due"].includes(s.status)
      );

      if (activeOrTrialing) {
        // If user wants to change plan, use Stripe subscription update
        const currentPriceId = activeOrTrialing.items.data[0]?.price?.id;
        if (currentPriceId === priceId) {
          logStep("Already on this plan", { subscriptionId: activeOrTrialing.id });
          return new Response(
            JSON.stringify({ success: false, error: "You are already on this plan" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Update subscription to new price (prorate)
        logStep("Updating subscription to new plan", { from: currentPriceId, to: priceId });
        await stripe.subscriptions.update(activeOrTrialing.id, {
          items: [{
            id: activeOrTrialing.items.data[0].id,
            price: priceId,
          }],
          proration_behavior: "create_prorations",
          metadata: { venue_id: targetVenueId, user_id: user.id, plan: planCode },
        });

        // Update local DB
        await supabaseClient
          .from("venue_subscriptions")
          .upsert({
            venue_id: targetVenueId,
            subscription_plan: planCode,
            updated_at: new Date().toISOString(),
          }, { onConflict: "venue_id" });

        logStep("Subscription updated", { subscriptionId: activeOrTrialing.id, newPlan: planCode });
        return new Response(
          JSON.stringify({ success: true, updated: true, plan: planCode }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
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

    const origin = req.headers.get("origin") || "https://yunoapp.eu";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      payment_method_collection: "if_required",
      success_url: `${origin}/owner/billing?subscription=success`,
      cancel_url: `${origin}/owner/billing?subscription=canceled`,
      metadata: { venue_id: targetVenueId, user_id: user.id, plan: planCode },
      subscription_data: {
        trial_period_days: 30,
        metadata: { venue_id: targetVenueId, user_id: user.id, plan: planCode },
      },
    });

    logStep("Checkout session created", { sessionId: session.id, plan: planCode, price: priceId });

    return new Response(
      JSON.stringify({ success: true, sessionId: session.id, url: session.url }),
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
