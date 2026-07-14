import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fundDjBookingContract, releaseDjBookingBalance, type DjContract } from "../_shared/dj-payout.ts";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";

// Pinned to the account's API version. Newer than the SDK's bundled types
// (which top out at basil), hence the cast. On clover+, a subscription's billing
// period lives on the subscription ITEM, not the subscription object.
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature, x-cron-secret",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-WEBHOOK] ${step}`, details ? JSON.stringify(details) : "");
};

// Price ID -> plan code mapping. All IDs live in Supabase secrets (no hardcoding)
// so the same code resolves plans against the Stripe test account today and the
// live account later — a secrets swap, never a code deploy. Must mirror the
// secret names set for the club-subscription function.
const PRICE_TO_PLAN: Record<string, string> = {};
for (
  const [env, plan] of [
    ["STRIPE_PRICE_ESSENTIAL_MONTHLY", "essential"],
    ["STRIPE_PRICE_PRO_MONTHLY", "pro"],
    ["STRIPE_PRICE_ELITE_MONTHLY", "elite"],
    ["STRIPE_PRICE_ESSENTIAL_ANNUAL", "essential"],
    ["STRIPE_PRICE_PRO_ANNUAL", "pro"],
    ["STRIPE_PRICE_ELITE_ANNUAL", "elite"],
  ] as const
) {
  const id = Deno.env.get(env);
  if (id) PRICE_TO_PLAN[id] = plan;
}

function resolvePlanFromSubscription(subscription: Stripe.Subscription): string {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId && PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];
  if (subscription.metadata?.plan) return subscription.metadata.plan;
  return "essential";
}

// P0-6 — Was the underlying sale refunded before its held transfers were released?
// If so, the refund handler already cancelled the legs; this is a belt-and-braces
// check so the release cron never pays out a refunded sale.
async function saleIsRefunded(
  admin: ReturnType<typeof createClient>,
  row: { ticket_id: string | null; table_reservation_id: string | null; order_id: string | null },
): Promise<boolean> {
  if (row.ticket_id) {
    const { data } = await admin.from("tickets").select("status").eq("id", row.ticket_id).maybeSingle();
    return data?.status === "refunded";
  }
  if (row.table_reservation_id) {
    const { data } = await admin.from("table_reservations").select("status").eq("id", row.table_reservation_id).maybeSingle();
    return data?.status === "cancelled" || data?.status === "refunded";
  }
  if (row.order_id) {
    const { data } = await admin.from("orders").select("status").eq("id", row.order_id).maybeSingle();
    return data?.status === "refunded" || data?.status === "cancelled";
  }
  return false;
}

// P0-6 — Release co-event transfers whose refund window has closed. Called by the
// 'release-held-co-event-transfers' pg_cron job. Fires the held ('scheduled') primary
// and secondary transfers from the platform balance to the connected accounts, unless
// the sale was refunded in the meantime (then the legs are cancelled, money stays put).
async function releaseHeldTransfers(stripe: Stripe, admin: ReturnType<typeof createClient>) {
  const nowIso = new Date().toISOString();
  // Les jambes 'failed' sont RE-TENTÉES à chaque passage du cron : un échec de
  // transfer est presque toujours transitoire (solde plateforme insuffisant,
  // compte connecté pas encore actif). Avant ce fix, un échec laissait l'argent
  // bloqué sur la plateforme pour toujours, sans alerte — le partenaire n'était
  // jamais payé. La clé d'idempotence Stripe (release_<row>_<role>) garantit
  // qu'un retry ne peut pas créer un second transfer pour la même jambe.
  const { data: due } = await admin
    .from("revenue_distributions")
    .select("id, payment_intent_id, transfer_group_id, event_id, item_type, ticket_id, table_reservation_id, order_id, primary_account_id, primary_amount_cents, primary_transfer_status, secondary_account_id, secondary_amount_cents, secondary_transfer_status")
    .lte("transfers_release_at", nowIso)
    .or("primary_transfer_status.in.(scheduled,failed),secondary_transfer_status.in.(scheduled,failed)")
    .limit(500);
  if ((due?.length ?? 0) === 500) {
    logStep("release: hit the 500-row cap — remainder picked up next run");
  }

  const RETRYABLE = new Set(["scheduled", "failed"]);
  let released = 0;
  let skipped = 0;
  for (const row of (due ?? []) as Array<Record<string, any>>) {
    // Refunded before release → cancel any still-pending legs, never pay out.
    if (await saleIsRefunded(admin, row)) {
      await admin.from("revenue_distributions").update({
        primary_transfer_status: RETRYABLE.has(row.primary_transfer_status) ? "cancelled" : row.primary_transfer_status,
        secondary_transfer_status: RETRYABLE.has(row.secondary_transfer_status) ? "cancelled" : row.secondary_transfer_status,
      }).eq("id", row.id);
      skipped++;
      continue;
    }

    // The transfer needs the charge as source_transaction.
    let charge: string | null = null;
    let currency = "eur";
    try {
      const pi = await stripe.paymentIntents.retrieve(row.payment_intent_id);
      charge = (pi.latest_charge as string) ?? null;
      currency = pi.currency || "eur";
    } catch (e) {
      logStep("release: PI retrieve failed", { pi: row.payment_intent_id, error: (e as Error).message });
      continue;
    }
    if (!charge) continue;

    const fireLeg = async (
      role: "primary" | "secondary",
      accountId: string | null,
      amountCents: number,
    ) => {
      const statusCol = role === "primary" ? "primary_transfer_status" : "secondary_transfer_status";
      const idCol = role === "primary" ? "primary_transfer_id" : "secondary_transfer_id";
      const errCol = role === "primary" ? "primary_transfer_error" : "secondary_transfer_error";
      if (!accountId || amountCents <= 0) {
        await admin.from("revenue_distributions").update({ [statusCol]: "not_required" }).eq("id", row.id);
        return;
      }
      try {
        const transfer = await stripe.transfers.create({
          amount: amountCents,
          currency,
          destination: accountId,
          source_transaction: charge!,
          transfer_group: row.transfer_group_id ?? undefined,
          metadata: {
            payment_intent_id: row.payment_intent_id,
            event_id: row.event_id || "",
            item_type: row.item_type || "",
            role,
            released: "1",
          },
        }, { idempotencyKey: `release_${row.id}_${role}` });
        await admin.from("revenue_distributions").update({
          [idCol]: transfer.id,
          [statusCol]: "succeeded",
          [errCol]: null,
        }).eq("id", row.id);
      } catch (e) {
        await admin.from("revenue_distributions").update({
          [statusCol]: "failed",
          [errCol]: (e as Error).message,
        }).eq("id", row.id);
        logStep("release: transfer failed", { role, pi: row.payment_intent_id, error: (e as Error).message });
      }
    };

    if (RETRYABLE.has(row.primary_transfer_status)) {
      await fireLeg("primary", row.primary_account_id, row.primary_amount_cents || 0);
    }
    if (RETRYABLE.has(row.secondary_transfer_status)) {
      await fireLeg("secondary", row.secondary_account_id, row.secondary_amount_cents || 0);
    }
    released++;
  }
  return { due: due?.length ?? 0, released, skipped };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

    // ─────────────────────────────────────────────────────────────────────────
    // Cron-invoked task path (no Stripe signature; authorized via x-cron-secret).
    // Hosts the DJ secured-booking auto-release: X days after the gig, any contract
    // still held but never confirmed by the club is released to the DJ (the safety
    // net so a passive club can't strand a paid DJ).
    // ─────────────────────────────────────────────────────────────────────────
    if (req.headers.get("x-cron-secret")) {
      const auth = await authorizeCronRequest(req);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: auth.status,
        });
      }
      const payload = await req.json().catch(() => ({}));
      const admin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } },
      );

      if (payload.task === "dj_booking_auto_release") {
        const { data: due } = await admin
          .from("dj_booking_contracts")
          .select("*")
          .eq("status", "funds_held")
          .lte("auto_release_at", new Date().toISOString());
        let released = 0;
        for (const c of (due ?? []) as DjContract[]) {
          try {
            const r = await releaseDjBookingBalance(stripe, admin, c);
            if (r.released) released++;
          } catch (err) {
            logStep("DJ auto-release failed", { contractId: c.id, error: (err as Error).message });
          }
        }
        logStep("DJ auto-release run", { due: due?.length ?? 0, released });
        return new Response(JSON.stringify({ success: true, due: due?.length ?? 0, released }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (payload.task === "release_held_transfers") {
        const result = await releaseHeldTransfers(stripe, admin);
        logStep("Held-transfer release run", result);
        return new Response(JSON.stringify({ success: true, ...result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Unknown task" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) throw new Error("No stripe-signature header");

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      logStep("Signature verification failed", { error: (err as Error).message });
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Event received", { type: event.type, id: event.id });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const chargesEnabled = account.charges_enabled ?? false;
        const payoutsEnabled = account.payouts_enabled ?? false;
        const detailsSubmitted = account.details_submitted ?? false;
        logStep("Account updated", {
          accountId: account.id,
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          profileType: account.metadata?.profile_type ?? "venue",
        });

        // A connected account belongs EITHER to a venue (owner) OR an organizer.
        // Owners are mirrored in `venues.stripe_account_id`; organizers in
        // `profiles.stripe_connect_account_id`. We attempt both updates scoped by
        // the (unique) account id — the one that doesn't match is a harmless no-op.
        // Without the organizer branch, an organizer who finishes Stripe onboarding
        // stays `charges_enabled=false` in the DB until they reopen their dashboard,
        // which blocks ticket checkout. The webhook is the path Stripe retries, so
        // syncing here closes that gap for both roles.

        const { error: venueErr } = await supabaseClient
          .from("venues")
          .update({
            stripe_charges_enabled: chargesEnabled,
            stripe_payouts_enabled: payoutsEnabled,
            stripe_onboarding_complete: detailsSubmitted,
          })
          .eq("stripe_account_id", account.id);

        if (venueErr) {
          logStep("Error updating venue", { error: venueErr.message });
        }

        // Organizer status mirrors organizer-stripe-connect-status so the two paths
        // (webhook push + on-demand poll) always agree.
        const hasRequirements =
          (account.requirements?.currently_due?.length ?? 0) > 0 ||
          (account.requirements?.past_due?.length ?? 0) > 0;
        let orgStatus: "pending" | "active" | "restricted" = "pending";
        if (chargesEnabled && payoutsEnabled) orgStatus = "active";
        else if (detailsSubmitted && hasRequirements) orgStatus = "restricted";

        const { data: orgRows, error: orgErr } = await supabaseClient
          .from("profiles")
          .update({
            stripe_connect_status: orgStatus,
            stripe_connect_charges_enabled: chargesEnabled,
            stripe_connect_payouts_enabled: payoutsEnabled,
            stripe_connect_onboarded_at: orgStatus === "active" ? new Date().toISOString() : null,
          })
          .eq("stripe_connect_account_id", account.id)
          .select("id");

        if (orgErr) {
          logStep("Error updating organizer profile", { error: orgErr.message });
        } else if (orgRows && orgRows.length > 0) {
          logStep("Organizer Stripe status updated", { status: orgStatus, chargesEnabled, payoutsEnabled });
        } else {
          logStep("Venue Stripe status updated");
        }

        // DJ secured-booking payee accounts (dj_stripe_accounts, keyed on stripe_account_id).
        // Same push/poll mirroring as venues/organizers; on completion, unblock contracts
        // that were waiting on this DJ's onboarding.
        const { data: djAcctRows } = await supabaseClient
          .from("dj_stripe_accounts")
          .update({
            status: orgStatus,
            charges_enabled: chargesEnabled,
            payouts_enabled: payoutsEnabled,
            onboarding_complete: detailsSubmitted,
            onboarded_at: orgStatus === "active" ? new Date().toISOString() : null,
          })
          .eq("stripe_account_id", account.id)
          .select("user_id");
        if (djAcctRows && djAcctRows.length > 0) {
          logStep("DJ Stripe status updated", { status: orgStatus, payoutsEnabled });
          if (payoutsEnabled) {
            for (const row of djAcctRows) {
              await supabaseClient.rpc("advance_dj_contracts_after_onboarding", { p_user_id: row.user_id });
            }
          }
        }
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};
        logStep("Checkout session completed", { sessionId: session.id, metadata });

        if (metadata.orderId) {
          await supabaseClient
            .from("orders")
            .update({ status: "paid", stripe_session_id: session.id, stripe_payment_intent_id: session.payment_intent as string })
            .eq("id", metadata.orderId)
            .eq("status", "pending");
          logStep("Order marked as paid (backup)", { orderId: metadata.orderId });
        }

        if (metadata.ticketId) {
          // RELIABILITY FALLBACK. If the buyer closed the tab before being
          // redirected to /verify-ticket-payment, that function never ran and
          // none of the side effects fired (tickets_sold stays un-incremented,
          // no confirmation email, no invoice, no drink credits, no loyalty).
          // The webhook is the path Stripe guarantees and retries, so we delegate
          // to the exact same processing here. verify-ticket-payment flips the
          // ticket pending->paid atomically, so if the client already processed
          // it this call is a harmless no-op (alreadyProcessed=true).
          try {
            const verifyResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-ticket-payment`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ sessionId: session.id, ticketId: metadata.ticketId }),
            });
            let body: Record<string, unknown> | null = null;
            try { body = await verifyResp.json(); } catch { /* non-JSON body */ }
            logStep("Delegated ticket processing to verify-ticket-payment", {
              ticketId: metadata.ticketId,
              ok: verifyResp.ok,
              alreadyProcessed: body?.alreadyProcessed ?? null,
            });
          } catch (verifyErr) {
            // Best-effort: never fail the webhook over this. Stripe retries the
            // event and the call is idempotent, so a transient failure self-heals.
            logStep("verify-ticket-payment delegation failed (Stripe will retry)", {
              ticketId: metadata.ticketId,
              error: (verifyErr as Error).message,
            });
          }
        }

        if (metadata.reservationId) {
          await supabaseClient
            .from("table_reservations")
            .update({ status: "confirmed", stripe_session_id: session.id, stripe_payment_intent_id: session.payment_intent as string })
            .eq("id", metadata.reservationId)
            .eq("status", "pending");
          logStep("Reservation confirmed (backup)", { reservationId: metadata.reservationId });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        let venueId = subscription.metadata?.venue_id;
        
        if (!venueId) {
          const customerId = subscription.customer as string;
          const { data: venueSub } = await supabaseClient
            .from("venue_subscriptions")
            .select("venue_id")
            .eq("stripe_customer_id", customerId)
            .limit(1)
            .maybeSingle();
          
          if (venueSub?.venue_id) {
            venueId = venueSub.venue_id;
            logStep("Resolved venue_id from stripe_customer_id", { customerId, venueId });
          } else {
            logStep("No venue_id in metadata and no matching customer, skipping", { customerId });
            break;
          }
        }

        const toISO = (val: unknown): string | null => {
          if (!val) return null;
          if (typeof val === "number") return new Date(val * 1000).toISOString();
          if (typeof val === "string") return new Date(val).toISOString();
          return null;
        };

        const trialEnd = toISO(subscription.trial_end);
        const { start: periodStartRaw, end: periodEndRaw } = periodBoundsOf(subscription);
        const periodStart = toISO(periodStartRaw) ?? new Date().toISOString();
        const periodEnd = toISO(periodEndRaw) ?? new Date().toISOString();
        const subscriptionPlan = resolvePlanFromSubscription(subscription);

        logStep("Subscription upsert", {
          venueId,
          status: subscription.status,
          trialEnd,
          subscriptionId: subscription.id,
          subscriptionPlan,
        });

        await supabaseClient
          .from("venue_subscriptions")
          .upsert({
            venue_id: venueId,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer as string,
            status: subscription.status,
            subscription_plan: subscriptionPlan,
            current_period_start: periodStart,
            current_period_end: periodEnd,
            trial_end: trialEnd,
            updated_at: new Date().toISOString(),
          }, { onConflict: "venue_id" });

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        let venueId = subscription.metadata?.venue_id;
        
        if (!venueId) {
          const customerId = subscription.customer as string;
          const { data: venueSub } = await supabaseClient
            .from("venue_subscriptions")
            .select("venue_id")
            .eq("stripe_customer_id", customerId)
            .limit(1)
            .maybeSingle();
          venueId = venueSub?.venue_id;
        }
        
        if (!venueId) break;

        logStep("Subscription canceled", { venueId, subscriptionId: subscription.id });

        await supabaseClient
          .from("venue_subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("venue_id", venueId);

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string;
        if (!subId) break;

        logStep("Payment failed for subscription", { subscriptionId: subId });

        await supabaseClient
          .from("venue_subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subId);

        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        logStep("Payment intent succeeded", { id: pi.id, amount: pi.amount });

        const md = pi.metadata || {};

        // DJ secured booking escrow: the charge lands on the platform (no transfer_data,
        // no revenue_distributions row). Mark funds held and release the acompte to the
        // DJ now; the balance waits for the gig confirmation / auto-release.
        if (md.escrow === "dj_booking") {
          await fundDjBookingContract(stripe, supabaseClient, pi);
          break;
        }

        const itemType = md.item_type;
        if (!itemType) {
          logStep("No split metadata, skipping ledger");
          break;
        }

        const grossCents = pi.amount;
        const yunoFeeCents = parseInt(md.yuno_fee_cents || "0", 10) || 0;
        const stripeFeeEstimatedCents = parseInt(md.stripe_fee_estimated_cents || "0", 10) || 0;
        // "separate" → platform charge + webhook transfers. "direct" → charge already
        // on the connected account (no transfer to fire). Legacy rows → "destination".
        const splitMode = (md.split_mode === "separate"
          ? "separate"
          : md.split_mode === "direct"
            ? "direct"
            : "destination") as "separate" | "destination" | "direct";
        const transferGroup = md.transfer_group || null;
        const primaryAccount = md.split_primary_account || null;
        const primaryAmountCents = parseInt(md.split_primary_amount || "0", 10) || (grossCents - yunoFeeCents);
        const secondaryAccount = md.split_secondary_account || null;
        const secondaryAmountCents = parseInt(md.split_secondary_amount || "0", 10) || 0;
        const needsSecondary = !!secondaryAccount && secondaryAmountCents > 0;
        // In SEPARATE mode the platform must also fire the primary transfer.
        const needsPrimaryTransfer = splitMode === "separate" && !!primaryAccount && primaryAmountCents > 0;

        // Parse audit snapshot from metadata
        let splitRulesApplied: Record<string, unknown> | null = null;
        try {
          if (md.split_rules_applied) splitRulesApplied = JSON.parse(md.split_rules_applied);
        } catch (_e) {
          splitRulesApplied = null;
        }
        const venuePctApplied = md.venue_pct_applied ? Number(md.venue_pct_applied) : null;
        const organizerPctApplied = md.organizer_pct_applied ? Number(md.organizer_pct_applied) : null;
        const partnershipId = md.partnership_id || null;

        // P0-6 — HOLD: we no longer transfer to the connected accounts at sale time.
        // Compute a release date (event end + refund window) and mark transfers
        // 'scheduled'. The 'release_held_transfers' cron task fires them once the window
        // has closed and the sale wasn't refunded. A refund before release reverses
        // nothing (no money ever left the platform) → eliminates the refund-after-payout
        // loss (R1). DIRECT charges are unaffected (single recipient, money already on
        // their own account, no platform-held split to protect).
        const REFUND_WINDOW_DAYS = 2;
        let transfersReleaseAt: string | null = null;
        if (needsPrimaryTransfer || needsSecondary) {
          let endIso: string | null = null;
          if (md.event_id) {
            const { data: evRow } = await supabaseClient
              .from("events").select("end_at, start_at").eq("id", md.event_id).maybeSingle();
            endIso = (evRow?.end_at as string | null) ?? (evRow?.start_at as string | null) ?? null;
          }
          const nowMs = Date.now();
          const baseMs = endIso ? new Date(endIso).getTime() : nowMs;
          transfersReleaseAt = new Date(Math.max(baseMs, nowMs) + REFUND_WINDOW_DAYS * 86400000).toISOString();
        }

        // Insert ledger row (idempotent on payment_intent_id)
        const { error: ledgerErr } = await supabaseClient
          .from("revenue_distributions")
          .upsert({
            payment_intent_id: pi.id,
            event_id: md.event_id || null,
            item_type: itemType,
            ticket_id: md.ticket_id || null,
            table_reservation_id: md.reservation_id || null,
            order_id: md.order_id || null,
            gross_amount_cents: grossCents,
            yuno_fee_cents: yunoFeeCents,
            split_mode: splitMode,
            transfer_group_id: transferGroup,
            primary_account_id: primaryAccount,
            primary_amount_cents: primaryAmountCents,
            primary_recipient_kind: md.split_primary_kind || null,
            primary_recipient_venue_id: md.split_primary_venue_id || null,
            primary_recipient_organizer_id: md.split_primary_organizer_id || null,
            primary_transfer_status: needsPrimaryTransfer ? "scheduled" : "not_required",
            secondary_account_id: secondaryAccount,
            secondary_amount_cents: secondaryAmountCents,
            secondary_recipient_kind: md.split_secondary_kind || null,
            secondary_recipient_venue_id: md.split_secondary_venue_id || null,
            secondary_recipient_organizer_id: md.split_secondary_organizer_id || null,
            secondary_transfer_status: needsSecondary ? "scheduled" : "not_required",
            transfers_release_at: transfersReleaseAt,
            // Audit snapshot — what contract was actually applied at sale time
            split_rules_applied: splitRulesApplied,
            venue_pct_applied: venuePctApplied,
            organizer_pct_applied: organizerPctApplied,
            partnership_id: partnershipId,
            stripe_fee_estimated_cents: stripeFeeEstimatedCents,
          }, { onConflict: "payment_intent_id" });

        if (ledgerErr) {
          logStep("Ledger upsert error", { error: ledgerErr.message });
        }

        // P0-6 — transfers are NOT fired here anymore. They are held ('scheduled') and
        // released by the 'release_held_transfers' cron task once the refund window has
        // closed and the sale wasn't refunded. See releaseHeldTransfers() below.
        if (needsPrimaryTransfer || needsSecondary) {
          logStep("Co-event transfers held until release", {
            releaseAt: transfersReleaseAt,
            primaryCents: needsPrimaryTransfer ? primaryAmountCents : 0,
            secondaryCents: needsSecondary ? secondaryAmountCents : 0,
          });
        }

        // Reconcile actual Stripe processing fee from balance_transaction.
        // Best effort — purely for audit (no monetary correction). The estimated
        // fee was already used to compute transfer amounts; any small delta stays
        // in the platform balance, as designed.
        try {
          const chargeId = pi.latest_charge as string | null;
          if (chargeId) {
            // DIRECT charges live on the connected account → retrieve with its context
            // (event.account is set for Connect events; undefined for platform events).
            const ch = await stripe.charges.retrieve(
              chargeId,
              { expand: ["balance_transaction"] },
              event.account ? { stripeAccount: event.account } : undefined,
            );
            const bt = ch.balance_transaction as Stripe.BalanceTransaction | null;
            if (bt && typeof bt === "object" && typeof bt.fee === "number") {
              await supabaseClient.from("revenue_distributions").update({
                stripe_fee_real_cents: bt.fee,
                stripe_fee_charge_id: chargeId,
              }).eq("payment_intent_id", pi.id);
              logStep("Stripe fee reconciled", { realFee: bt.fee, estimated: stripeFeeEstimatedCents });
            }
          }
        } catch (recErr) {
          logStep("Stripe fee reconciliation failed (non-blocking)", { error: (recErr as Error).message });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        logStep("Charge refunded", { chargeId: charge.id, amount: charge.amount_refunded });

        // Try to find and update the related order/ticket/reservation
        const piId = charge.payment_intent as string;
        if (piId) {
          // Update orders
          const { data: orderData } = await supabaseClient
            .from("orders")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", piId)
            .eq("status", "paid")
            .select("id");
          if (orderData?.length) {
            logStep("Order(s) marked refunded via charge.refunded", { ids: orderData.map(o => o.id) });
          }

          // Update tickets
          const { data: ticketData } = await supabaseClient
            .from("tickets")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", piId)
            .eq("status", "paid")
            .select("id");
          if (ticketData?.length) {
            logStep("Ticket(s) marked refunded via charge.refunded", { ids: ticketData.map(t => t.id) });
          }

          // Update table reservations
          const { data: resData } = await supabaseClient
            .from("table_reservations")
            .update({ status: "cancelled" })
            .eq("stripe_payment_intent_id", piId)
            .eq("status", "confirmed")
            .select("id");
          if (resData?.length) {
            logStep("Reservation(s) cancelled via charge.refunded", { ids: resData.map(r => r.id) });
          }

          // SYMMETRIC REFUND: reverse both primary and secondary transfers proportionally
          try {
            const { data: dist } = await supabaseClient
              .from("revenue_distributions")
              .select("id, split_mode, primary_transfer_id, primary_transfer_status, primary_amount_cents, primary_account_id, secondary_transfer_id, secondary_transfer_status, secondary_amount_cents, secondary_account_id, gross_amount_cents")
              .eq("payment_intent_id", piId)
              .maybeSingle();

            if (dist) {
              const refundedCents = charge.amount_refunded;
              const grossCents = dist.gross_amount_cents || charge.amount;
              const isFull = refundedCents >= grossCents;

              // Reverse one leg.
              //  - 'scheduled' (held, never fired) → just cancel: no money left the
              //    platform, nothing to claw back. This is the safe-by-design path when
              //    the refund happens before the release window closes.
              //  - 'succeeded' (already paid out) → attempt the reversal; on failure
              //    record a clawback (tracked debt) instead of losing money silently.
              const handleLeg = async (
                role: "primary" | "secondary",
                transferId: string | null,
                status: string | null,
                accountId: string | null,
                amountCents: number,
              ) => {
                const statusCol = role === "primary" ? "primary_transfer_status" : "secondary_transfer_status";
                // 'scheduled' (jamais parti) ET 'failed' (jamais parti non plus) :
                // simple annulation, l'argent n'a pas quitté la plateforme.
                if (status === "scheduled" || status === "failed") {
                  await supabaseClient.from("revenue_distributions")
                    .update({ [statusCol]: "cancelled" }).eq("id", dist.id);
                  logStep(`${role} transfer cancelled (was held, never fired)`, { piId, was: status });
                  return;
                }
                if (!transferId || status !== "succeeded") return;
                const reversalAmount = grossCents > 0
                  ? Math.min(amountCents, Math.round((amountCents * refundedCents) / grossCents))
                  : 0;
                if (reversalAmount <= 0) return;
                try {
                  const reversal = await stripe.transfers.createReversal(transferId, {
                    amount: reversalAmount,
                    metadata: {
                      payment_intent_id: piId,
                      refund_amount_cents: String(refundedCents),
                      reason: "client_refund_symmetric",
                      role,
                    },
                  });
                  await supabaseClient.from("revenue_distributions")
                    .update({ [statusCol]: isFull ? "refunded" : "partially_refunded" })
                    .eq("id", dist.id);
                  logStep(`${role} transfer reversed`, { transferId, reversalId: reversal.id, amount: reversalAmount, full: isFull });
                } catch (revErr) {
                  const errMsg = (revErr as Error).message;
                  // Faux positif classique : owner-refund a posé reverse_transfer:true,
                  // Stripe a DÉJÀ reversé ce transfer, et notre createReversal échoue en
                  // « already reversed ». Vérifier l'état réel avant d'enregistrer une
                  // dette — sinon chaque refund post-libération crée un clawback fantôme.
                  try {
                    const tr = await stripe.transfers.retrieve(transferId);
                    if ((tr.amount_reversed ?? 0) >= reversalAmount) {
                      await supabaseClient.from("revenue_distributions")
                        .update({ [statusCol]: isFull ? "refunded" : "partially_refunded" })
                        .eq("id", dist.id);
                      logStep(`${role} transfer already reversed elsewhere — no clawback`, { transferId, amountReversed: tr.amount_reversed });
                      return;
                    }
                  } catch { /* retrieve failed → fall through to the clawback record */ }
                  // Money is OUT and could not be clawed back → record the debt, never lose it silently.
                  await supabaseClient.from("transfer_clawbacks").insert({
                    payment_intent_id: piId,
                    revenue_distribution_id: dist.id,
                    role,
                    account_id: accountId,
                    transfer_id: transferId,
                    amount_cents: reversalAmount,
                    reason: "client_refund_reversal_failed",
                    error: errMsg,
                  });
                  logStep(`${role} transfer reversal FAILED → clawback recorded`, { transferId, amount: reversalAmount, error: errMsg });
                }
              };

              await handleLeg("primary", dist.primary_transfer_id, dist.primary_transfer_status, dist.primary_account_id, dist.primary_amount_cents || 0);
              await handleLeg("secondary", dist.secondary_transfer_id, dist.secondary_transfer_status, dist.secondary_account_id, dist.secondary_amount_cents || 0);
            }
          } catch (revErr) {
            const errMsg = (revErr as Error).message;
            logStep("Transfer reversal handler FAILED", { error: errMsg, piId });
            // Never throw — the client refund must succeed regardless. Record the debt.
            await supabaseClient.from("transfer_clawbacks").insert({
              payment_intent_id: piId,
              role: "secondary",
              reason: "refund_handler_exception",
              error: errMsg,
            });
          }
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        logStep("Dispute created", {
          disputeId: dispute.id,
          amount: dispute.amount,
          reason: dispute.reason,
          chargeId: dispute.charge,
        });
        // Log for manual review — disputes require human intervention
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
