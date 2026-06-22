import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { releaseDjBookingBalance, refundDjBookingContract } from "../_shared/dj-payout.ts";

// Unified Stripe Connect dispatcher.
// Replaces: organizer-stripe-connect-onboard, organizer-stripe-connect-status,
// stripe-connect-dashboard, stripe-connect-refresh.
// Route via body.action: "onboard" | "status" | "dashboard" | "refresh".
// Also hosts DJ secured-booking escrow actions (actor_type "dj" onboarding +
// "dj_booking_checkout" | "dj_booking_release" | "dj_booking_cancel") so no new
// edge function is needed — the 402 deploy cap blocks new functions.

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

      // ─── DJ path (secured-booking payee) ──────────────────────────────────────
      // A DJ's Stripe account is PER PERSON (keyed on user_id), not per djs row
      // (a person has N djs rows, one per venue). Stored in dj_stripe_accounts.
      if (actorType === "dj") {
        const { data: acct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        let accountId = acct?.stripe_account_id ?? null;
        if (!accountId) {
          log("Creating new DJ Express account");
          const account = await stripe.accounts.create({
            type: "express",
            country: "FR",
            email: user.email,
            business_type: "individual",
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
            business_profile: {
              product_description: "Prestation de DJ (cachet)",
              mcc: "7929",
            },
            metadata: { user_id: user.id, profile_type: "dj", platform: "yuno" },
          });
          accountId = account.id;
          await supabaseAdmin
            .from("dj_stripe_accounts")
            .upsert({ user_id: user.id, stripe_account_id: accountId, status: "pending" });
          log("DJ Stripe account created", { accountId });
        }

        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${origin}/dj/bookings?stripe=refresh`,
          return_url: `${origin}/dj/bookings?stripe=success`,
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
      // ─── DJ status (dj_stripe_accounts, keyed on user_id) ────────────────────
      if (body.actor_type === "dj") {
        const { data: acct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!acct?.stripe_account_id) {
          return json({ connected: false, status: "none", chargesEnabled: false, payoutsEnabled: false });
        }

        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const account = await stripe.accounts.retrieve(acct.stripe_account_id);
        const chargesEnabled = !!account.charges_enabled;
        const payoutsEnabled = !!account.payouts_enabled;
        const detailsSubmitted = !!account.details_submitted;
        const hasRequirements =
          (account.requirements?.currently_due?.length ?? 0) > 0 ||
          (account.requirements?.past_due?.length ?? 0) > 0;
        let djStatus: "none" | "pending" | "active" | "restricted" = "pending";
        if (chargesEnabled && payoutsEnabled) djStatus = "active";
        else if (detailsSubmitted && hasRequirements) djStatus = "restricted";

        await supabaseAdmin
          .from("dj_stripe_accounts")
          .update({
            status: djStatus,
            charges_enabled: chargesEnabled,
            payouts_enabled: payoutsEnabled,
            onboarding_complete: detailsSubmitted,
            onboarded_at: djStatus === "active" ? new Date().toISOString() : null,
          })
          .eq("user_id", user.id);

        // Onboarding done → unblock any contracts waiting on the DJ's Stripe setup.
        if (payoutsEnabled) {
          await supabaseAdmin.rpc("advance_dj_contracts_after_onboarding", { p_user_id: user.id });
        }

        return json({ connected: true, status: djStatus, chargesEnabled, payoutsEnabled, detailsSubmitted, requirements: account.requirements });
      }

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

      if (actorType === "dj") {
        const { data: acct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!acct?.stripe_account_id) throw new Error("Stripe Connect non configuré.");

        const account = await stripe.accounts.retrieve(acct.stripe_account_id);
        if (!account.details_submitted) {
          const link = await stripe.accountLinks.create({
            account: acct.stripe_account_id,
            refresh_url: `${origin}/dj/bookings?stripe=refresh`,
            return_url: `${origin}/dj/bookings?stripe=success`,
            type: "account_onboarding",
          });
          return json({ success: true, url: link.url, needsOnboarding: true });
        }
        const loginLink = await stripe.accounts.createLoginLink(acct.stripe_account_id);
        return json({ success: true, url: loginLink.url });
      }

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

    // ─────────────────────────────────────────────────────────────────────────
    // DJ secured booking — escrow actions (club side, JWT-authenticated).
    // Authorization reuses RLS: a user-scoped client can only SELECT the contract
    // if they are the booker or the DJ. Paying/releasing is booker-only, so we
    // also require the caller is NOT the DJ.
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "dj_booking_checkout" || action === "dj_booking_release" || action === "dj_booking_cancel") {
      const contractId: string = body.contractId || body.contract_id;
      if (!contractId) throw new Error("contractId is required");

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
      );
      const { data: visible } = await userClient
        .from("dj_booking_contracts")
        .select("id, dj_user_id")
        .eq("id", contractId)
        .maybeSingle();
      if (!visible) throw new Error("Contract not found or unauthorized");
      const callerIsDj = visible.dj_user_id === user.id;

      const { data: contract } = await supabaseAdmin
        .from("dj_booking_contracts")
        .select("*, dj:djs(stage_name, first_name, last_name)")
        .eq("id", contractId)
        .maybeSingle();
      if (!contract) throw new Error("Contract not found");

      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // ── Checkout: the club pays the cachet (+ Stripe fee) into Yuno escrow. ──
      if (action === "dj_booking_checkout") {
        if (callerIsDj) throw new Error("Only the booker can pay");
        if (contract.status !== "pending_payment") {
          throw new Error(`Contract not ready for payment (status=${contract.status})`);
        }
        const { data: djAcct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("payouts_enabled")
          .eq("user_id", contract.dj_user_id)
          .maybeSingle();
        if (!djAcct?.payouts_enabled) throw new Error("DJ Stripe account not ready for payouts");

        const total = contract.cachet_cents + contract.stripe_fee_cents;
        const djName = contract.dj?.stage_name
          || `${contract.dj?.first_name ?? ""} ${contract.dj?.last_name ?? ""}`.trim()
          || "DJ";

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [{
            price_data: {
              currency: contract.currency,
              product_data: { name: `Cachet DJ — ${djName}`, description: "Paiement sécurisé Yuno (séquestre)" },
              unit_amount: total,
            },
            quantity: 1,
          }],
          success_url: body.successUrl || `${origin}/owner/djs?booking=paid`,
          cancel_url: body.cancelUrl || `${origin}/owner/djs?booking=cancelled`,
          customer_email: user.email ?? undefined,
          payment_method_types: ["card"],
          payment_intent_data: {
            metadata: {
              escrow: "dj_booking",
              contract_id: contract.id,
              dj_user_id: contract.dj_user_id,
              cachet_cents: String(contract.cachet_cents),
              acompte_cents: String(contract.acompte_cents),
            },
          },
          metadata: { escrow: "dj_booking", contract_id: contract.id },
        });
        return json({ success: true, url: session.url });
      }

      // ── Release: the club confirms the gig happened → transfer the balance. ──
      if (action === "dj_booking_release") {
        if (callerIsDj) throw new Error("Only the booker can confirm the gig");
        const res = await releaseDjBookingBalance(stripe, supabaseAdmin, contract);
        return json({ success: res.released, reason: res.reason });
      }

      // ── Cancel after funding: refund the held balance to the club. ──
      if (action === "dj_booking_cancel") {
        const res = await refundDjBookingContract(stripe, supabaseAdmin, contract);
        return json({ success: res.refunded, reason: res.reason });
      }
    }

    throw new Error(`Unknown or missing action: ${action ?? "(none)"}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { message: msg });
    return json({ error: msg }, 400);
  }
});
