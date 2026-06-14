import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-CONNECT-REFRESH] ${step}`, details ? JSON.stringify(details) : "");
};

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
    logStep("User authenticated", { userId: user.id });

    const body = await req.json().catch(() => ({}));
    let targetVenueId = body.venueId;

    if (!targetVenueId) {
      const { data: venue } = await supabaseClient
        .from("venues")
        .select("id, stripe_account_id")
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

    const { data: venue, error: venueError } = await supabaseClient
      .from("venues")
      .select("id, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarding_complete")
      .eq("id", targetVenueId)
      .single();

    if (venueError || !venue) throw new Error("Venue not found");

    if (!venue.stripe_account_id) {
      logStep("No Stripe account connected");
      return new Response(
        JSON.stringify({
          success: true,
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingComplete: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-04-30.basil" });

    const account = await stripe.accounts.retrieve(venue.stripe_account_id);
    logStep("Stripe account retrieved", { 
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    });

    const chargesEnabled = account.charges_enabled ?? false;
    const payoutsEnabled = account.payouts_enabled ?? false;
    const onboardingComplete = account.details_submitted ?? false;

    const { error: updateError } = await supabaseClient
      .from("venues")
      .update({
        stripe_charges_enabled: chargesEnabled,
        stripe_payouts_enabled: payoutsEnabled,
        stripe_onboarding_complete: onboardingComplete,
      })
      .eq("id", targetVenueId);

    if (updateError) {
      logStep("Error updating venue status", { error: updateError.message });
    }

    return new Response(
      JSON.stringify({
        success: true,
        connected: true,
        accountId: venue.stripe_account_id,
        chargesEnabled,
        payoutsEnabled,
        onboardingComplete,
        requiresAction: !chargesEnabled || !onboardingComplete,
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
