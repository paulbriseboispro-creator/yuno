import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Unified Stripe Connect dispatcher.
// Replaces: organizer-stripe-connect-onboard, organizer-stripe-connect-status,
// stripe-connect-dashboard, stripe-connect-refresh.
// Route via body.action: "onboard" | "status" | "dashboard" | "refresh".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[STRIPE-CONNECT] ${s}`, d ? JSON.stringify(d) : "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

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

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    const origin = req.headers.get("origin") || "https://yunoapp.eu";
    log("Request", { userId: user.id, action });

    // ─────────────────────────────────────────────────────────────────────────
    // action: "onboard"  (← organizer-stripe-connect-onboard)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "onboard") {
      const actorType: "organizer" | "owner" = body.actor_type || "organizer";
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // ─── Organizer path ─────────────────────────────────────────────────────
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

        return json({ success: true, url: accountLink.url, accountId });
      }

      // ─── Owner path ─────────────────────────────────────────────────────────
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
      return json({ success: true, url: accountLink.url, accountId: stripeAccountId });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "status"  (← organizer-stripe-connect-status)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "status") {
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled")
        .eq("id", user.id)
        .maybeSingle();

      if (profileErr) throw profileErr;

      if (!profile?.stripe_connect_account_id) {
        return json({
          connected: false,
          status: "none",
          chargesEnabled: false,
          payoutsEnabled: false,
        });
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

      return json({
        connected: true,
        status,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        requirements: account.requirements,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "dashboard"  (← stripe-connect-dashboard)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "dashboard") {
      const actorType: string = body.actor_type || "owner";
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

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
          return json({ success: true, url: link.url, needsOnboarding: true });
        }

        const loginLink = await stripe.accounts.createLoginLink(profile.stripe_connect_account_id);
        return json({ success: true, url: loginLink.url });
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
        return json({ success: true, url: accountLink.url, needsOnboarding: true });
      }

      const loginLink = await stripe.accounts.createLoginLink(venue.stripe_account_id);
      return json({ success: true, url: loginLink.url });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "refresh"  (← stripe-connect-refresh)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "refresh") {
      let targetVenueId = body.venueId;

      if (!targetVenueId) {
        const { data: venue } = await supabaseAdmin
          .from("venues")
          .select("id, stripe_account_id")
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

          if (profile?.venue_id) {
            targetVenueId = profile.venue_id;
          }
        }
      }

      if (!targetVenueId) throw new Error("No venue found for this user");

      const { data: venue, error: venueError } = await supabaseAdmin
        .from("venues")
        .select("id, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarding_complete")
        .eq("id", targetVenueId)
        .single();

      if (venueError || !venue) throw new Error("Venue not found");

      if (!venue.stripe_account_id) {
        log("No Stripe account connected");
        return json({
          success: true,
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingComplete: false,
        });
      }

      const stripe = new Stripe(stripeKey, { apiVersion: "2025-04-30.basil" });

      const account = await stripe.accounts.retrieve(venue.stripe_account_id);
      log("Stripe account retrieved", {
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      });

      const chargesEnabled = account.charges_enabled ?? false;
      const payoutsEnabled = account.payouts_enabled ?? false;
      const onboardingComplete = account.details_submitted ?? false;

      const { error: updateError } = await supabaseAdmin
        .from("venues")
        .update({
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
          stripe_onboarding_complete: onboardingComplete,
        })
        .eq("id", targetVenueId);

      if (updateError) {
        log("Error updating venue status", { error: updateError.message });
      }

      return json({
        success: true,
        connected: true,
        accountId: venue.stripe_account_id,
        chargesEnabled,
        payoutsEnabled,
        onboardingComplete,
        requiresAction: !chargesEnabled || !onboardingComplete,
      });
    }

    throw new Error(`Unknown or missing action: ${action ?? "(none)"}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { message: msg });
    return json({ error: msg }, 400);
  }
});
