import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[STRIPE-CONNECT-ONBOARD] ${s}`, d ? JSON.stringify(d) : "");

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
    log("User authenticated", { userId: user.id });

    const body = await req.json().catch(() => ({}));
    const actorType: "organizer" | "owner" = body.actor_type || "organizer";
    const origin = req.headers.get("origin") || "https://yunoapp.eu";
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // ─── Organizer path ───────────────────────────────────────────────────────
    if (actorType === "organizer") {
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from("profiles")
        .select("id, email, profile_type, organization_name, stripe_connect_account_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileErr || !profile) throw new Error("Profile not found");
      if (profile.profile_type !== "organizer") {
        throw new Error("Stripe Connect onboarding réservé aux organisateurs.");
      }

      let accountId = profile.stripe_connect_account_id;
      if (!accountId) {
        log("Creating new organizer Express account");
        const account = await stripe.accounts.create({
          type: "express",
          country: "FR",
          email: profile.email ?? user.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: {
            name: profile.organization_name ?? undefined,
            product_description: "Vente de billets pour événements",
            mcc: "7929",
          },
          metadata: { user_id: user.id, profile_type: "organizer", platform: "yuno" },
        });
        accountId = account.id;
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_connect_account_id: accountId, stripe_connect_status: "pending" })
          .eq("id", user.id);
        log("Organizer Stripe account created", { accountId });
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${origin}/organizer-app/settings?stripe=refresh`,
        return_url: `${origin}/organizer-app/settings?stripe=success`,
        type: "account_onboarding",
      });

      return new Response(
        JSON.stringify({ success: true, url: accountLink.url, accountId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // ─── Owner path ───────────────────────────────────────────────────────────
    const { venueId, refreshUrl, returnUrl } = body;
    let targetVenueId = venueId;

    if (!targetVenueId) {
      const { data: venue } = await supabaseAdmin
        .from("venues")
        .select("id")
        .eq("owner_id", user.id)
        .single();

      if (venue) {
        targetVenueId = venue.id;
      } else {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("venue_id")
          .eq("id", user.id)
          .single();
        if (profile?.venue_id) targetVenueId = profile.venue_id;
        else throw new Error("No venue found for this user");
      }
    }

    log("Target venue", { venueId: targetVenueId });

    const { data: venue, error: venueError } = await supabaseAdmin
      .from("venues")
      .select("id, name, stripe_account_id")
      .eq("id", targetVenueId)
      .single();

    if (venueError || !venue) throw new Error("Venue not found");

    let stripeAccountId = venue.stripe_account_id;
    if (!stripeAccountId) {
      log("Creating new owner Express account");
      const account = await stripe.accounts.create({
        type: "express",
        country: "FR",
        email: user.email,
        business_type: "company",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: venue.name,
          product_description: "Vente de tickets et services de boîte de nuit",
          mcc: "7929",
        },
        metadata: { venue_id: targetVenueId, platform: "yuno" },
      });
      stripeAccountId = account.id;
      log("Owner Stripe account created", { accountId: stripeAccountId });
      const { error: updateError } = await supabaseAdmin
        .from("venues")
        .update({ stripe_account_id: stripeAccountId })
        .eq("id", targetVenueId);
      if (updateError) throw new Error("Failed to save Stripe account ID");
    } else {
      log("Using existing owner Stripe account", { accountId: stripeAccountId });
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl || `${origin}/owner/venue?stripe=refresh`,
      return_url: returnUrl || `${origin}/owner/venue?stripe=success`,
      type: "account_onboarding",
    });

    log("Onboarding link created", { url: accountLink.url });
    return new Response(
      JSON.stringify({ success: true, url: accountLink.url, accountId: stripeAccountId }),
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
