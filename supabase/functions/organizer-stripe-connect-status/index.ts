import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[ORG-CONNECT-STATUS] ${s}`, d ? JSON.stringify(d) : "");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("User not authenticated");
    const user = userData.user;

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) throw profileErr;

    if (!profile?.stripe_connect_account_id) {
      return new Response(
        JSON.stringify({
          connected: false,
          status: "none",
          chargesEnabled: false,
          payoutsEnabled: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);

    const chargesEnabled = !!account.charges_enabled;
    const payoutsEnabled = !!account.payouts_enabled;
    const detailsSubmitted = !!account.details_submitted;
    const hasRequirements =
      (account.requirements?.currently_due?.length ?? 0) > 0 ||
      (account.requirements?.past_due?.length ?? 0) > 0;

    let status: "none" | "pending" | "active" | "restricted" = "pending";
    if (chargesEnabled && payoutsEnabled) status = "active";
    else if (detailsSubmitted && hasRequirements) status = "restricted";
    else status = "pending";

    await supabaseAdmin
      .from("profiles")
      .update({
        stripe_connect_status: status,
        stripe_connect_charges_enabled: chargesEnabled,
        stripe_connect_payouts_enabled: payoutsEnabled,
        stripe_connect_onboarded_at: status === "active" ? new Date().toISOString() : null,
      })
      .eq("id", user.id);

    log("Status synced", { userId: user.id, status, chargesEnabled, payoutsEnabled });

    return new Response(
      JSON.stringify({
        connected: true,
        status,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        requirements: account.requirements,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { message: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
