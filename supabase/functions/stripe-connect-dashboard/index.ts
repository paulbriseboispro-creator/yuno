import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("User not authenticated");
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const actorType: string = body.actor_type || "owner";

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || "https://yunoapp.eu";

    if (actorType === "organizer") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.stripe_connect_account_id) {
        throw new Error("Stripe Connect non configuré.");
      }

      const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);
      if (!account.details_submitted) {
        const link = await stripe.accountLinks.create({
          account: profile.stripe_connect_account_id,
          refresh_url: `${origin}/organizer-app/settings?stripe=refresh`,
          return_url: `${origin}/organizer-app/settings?stripe=success`,
          type: "account_onboarding",
        });
        return new Response(
          JSON.stringify({ success: true, url: link.url, needsOnboarding: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      const loginLink = await stripe.accounts.createLoginLink(profile.stripe_connect_account_id);
      return new Response(
        JSON.stringify({ success: true, url: loginLink.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Default: owner flow
    let targetVenueId = body.venueId;
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
      }
    }

    if (!targetVenueId) throw new Error("No venue found for this user");

    const { data: venue, error: venueError } = await supabaseAdmin
      .from("venues")
      .select("id, stripe_account_id")
      .eq("id", targetVenueId)
      .single();

    if (venueError || !venue) throw new Error("Venue not found");
    if (!venue.stripe_account_id) throw new Error("No Stripe account connected");

    const account = await stripe.accounts.retrieve(venue.stripe_account_id);
    if (!account.details_submitted) {
      const accountLink = await stripe.accountLinks.create({
        account: venue.stripe_account_id,
        refresh_url: `${origin}/owner/venue?stripe=refresh`,
        return_url: `${origin}/owner/venue?stripe=success`,
        type: "account_onboarding",
      });
      return new Response(
        JSON.stringify({ success: true, url: accountLink.url, needsOnboarding: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const loginLink = await stripe.accounts.createLoginLink(venue.stripe_account_id);
    return new Response(
      JSON.stringify({ success: true, url: loginLink.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
