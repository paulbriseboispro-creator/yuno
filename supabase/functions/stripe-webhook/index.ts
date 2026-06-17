import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
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
        const itemType = md.item_type;
        if (!itemType) {
          logStep("No split metadata, skipping ledger");
          break;
        }

        const grossCents = pi.amount;
        const yunoFeeCents = parseInt(md.yuno_fee_cents || "0", 10) || 0;
        const stripeFeeEstimatedCents = parseInt(md.stripe_fee_estimated_cents || "0", 10) || 0;
        const splitMode = (md.split_mode === "separate" ? "separate" : "destination") as "separate" | "destination";
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

        // Insert ledger row (idempotent on payment_intent_id)
        const { data: ledger, error: ledgerErr } = await supabaseClient
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
            primary_transfer_status: needsPrimaryTransfer ? "pending" : "not_required",
            secondary_account_id: secondaryAccount,
            secondary_amount_cents: secondaryAmountCents,
            secondary_recipient_kind: md.split_secondary_kind || null,
            secondary_recipient_venue_id: md.split_secondary_venue_id || null,
            secondary_recipient_organizer_id: md.split_secondary_organizer_id || null,
            secondary_transfer_status: needsSecondary ? "pending" : "not_required",
            // Audit snapshot — what contract was actually applied at sale time
            split_rules_applied: splitRulesApplied,
            venue_pct_applied: venuePctApplied,
            organizer_pct_applied: organizerPctApplied,
            partnership_id: partnershipId,
            stripe_fee_estimated_cents: stripeFeeEstimatedCents,
          }, { onConflict: "payment_intent_id" })
          .select("id, primary_transfer_status, secondary_transfer_status")
          .maybeSingle();

        if (ledgerErr) {
          logStep("Ledger upsert error", { error: ledgerErr.message });
        }

        // SEPARATE mode → fire PRIMARY transfer first (charge sits on the platform).
        if (needsPrimaryTransfer && ledger?.primary_transfer_status === "pending") {
          try {
            const charge = pi.latest_charge as string;
            const transfer = await stripe.transfers.create({
              amount: primaryAmountCents,
              currency: pi.currency,
              destination: primaryAccount!,
              source_transaction: charge,
              transfer_group: transferGroup ?? undefined,
              metadata: {
                payment_intent_id: pi.id,
                event_id: md.event_id || "",
                item_type: itemType,
                role: "primary",
              },
            });
            await supabaseClient.from("revenue_distributions").update({
              primary_transfer_id: transfer.id,
              primary_transfer_status: "succeeded",
              primary_transfer_attempts: 1,
            }).eq("payment_intent_id", pi.id);
            logStep("Primary transfer succeeded", { transferId: transfer.id, amount: primaryAmountCents });
          } catch (transferErr) {
            const errMsg = (transferErr as Error).message;
            await supabaseClient.from("revenue_distributions").update({
              primary_transfer_status: "failed",
              primary_transfer_error: errMsg,
              primary_transfer_attempts: 1,
            }).eq("payment_intent_id", pi.id);
            logStep("Primary transfer FAILED", { error: errMsg });
          }
        }

        // Fire SECONDARY transfer if needed (works for both modes —
        // separate uses platform charge, destination uses on_behalf_of constraints).
        if (needsSecondary && ledger?.secondary_transfer_status === "pending") {
          try {
            const charge = pi.latest_charge as string;
            const transfer = await stripe.transfers.create({
              amount: secondaryAmountCents,
              currency: pi.currency,
              destination: secondaryAccount!,
              source_transaction: charge,
              transfer_group: transferGroup ?? undefined,
              metadata: {
                payment_intent_id: pi.id,
                event_id: md.event_id || "",
                item_type: itemType,
                role: "secondary",
              },
            });
            await supabaseClient.from("revenue_distributions").update({
              secondary_transfer_id: transfer.id,
              secondary_transfer_status: "succeeded",
              secondary_transfer_attempts: 1,
            }).eq("payment_intent_id", pi.id);
            logStep("Secondary transfer succeeded", { transferId: transfer.id, amount: secondaryAmountCents });
          } catch (transferErr) {
            const errMsg = (transferErr as Error).message;
            await supabaseClient.from("revenue_distributions").update({
              secondary_transfer_status: "failed",
              secondary_transfer_error: errMsg,
              secondary_transfer_attempts: 1,
            }).eq("payment_intent_id", pi.id);
            logStep("Secondary transfer FAILED", { error: errMsg });
          }
        }

        // Reconcile actual Stripe processing fee from balance_transaction.
        // Best effort — purely for audit (no monetary correction). The estimated
        // fee was already used to compute transfer amounts; any small delta stays
        // in the platform balance, as designed.
        try {
          const chargeId = pi.latest_charge as string | null;
          if (chargeId) {
            const ch = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
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
              .select("id, split_mode, primary_transfer_id, primary_transfer_status, primary_amount_cents, secondary_transfer_id, secondary_transfer_status, secondary_amount_cents, gross_amount_cents")
              .eq("payment_intent_id", piId)
              .maybeSingle();

            if (dist) {
              const refundedCents = charge.amount_refunded;
              const grossCents = dist.gross_amount_cents || charge.amount;
              const isFull = refundedCents >= grossCents;

              // 1) Reverse PRIMARY transfer (only exists in separate mode — destination
              //    mode is auto-handled by Stripe via reverse_transfer on the refund itself)
              if (dist.primary_transfer_id && dist.primary_transfer_status === "succeeded") {
                const primaryCents = dist.primary_amount_cents || 0;
                const primaryReversal = grossCents > 0
                  ? Math.min(primaryCents, Math.round((primaryCents * refundedCents) / grossCents))
                  : 0;
                if (primaryReversal > 0) {
                  const reversal = await stripe.transfers.createReversal(dist.primary_transfer_id, {
                    amount: primaryReversal,
                    metadata: {
                      payment_intent_id: piId,
                      refund_amount_cents: String(refundedCents),
                      reason: "client_refund_symmetric",
                      role: "primary",
                    },
                  });
                  await supabaseClient
                    .from("revenue_distributions")
                    .update({
                      primary_transfer_status: isFull ? "refunded" : "partially_refunded",
                      primary_transfer_error: null,
                    })
                    .eq("id", dist.id);
                  logStep("Primary transfer reversed", {
                    transferId: dist.primary_transfer_id,
                    reversalId: reversal.id,
                    amount: primaryReversal,
                    full: isFull,
                  });
                }
              }

              // 2) Reverse SECONDARY transfer
              if (dist.secondary_transfer_id && dist.secondary_transfer_status === "succeeded") {
                const secondaryCents = dist.secondary_amount_cents || 0;
                const reversalAmount = grossCents > 0
                  ? Math.min(secondaryCents, Math.round((secondaryCents * refundedCents) / grossCents))
                  : 0;
                if (reversalAmount > 0) {
                  const reversal = await stripe.transfers.createReversal(dist.secondary_transfer_id, {
                    amount: reversalAmount,
                    metadata: {
                      payment_intent_id: piId,
                      refund_amount_cents: String(refundedCents),
                      reason: "client_refund_symmetric",
                      role: "secondary",
                    },
                  });
                  await supabaseClient
                    .from("revenue_distributions")
                    .update({
                      secondary_transfer_status: isFull ? "refunded" : "partially_refunded",
                      secondary_transfer_error: null,
                    })
                    .eq("id", dist.id);
                  logStep("Secondary transfer reversed", {
                    transferId: dist.secondary_transfer_id,
                    reversalId: reversal.id,
                    amount: reversalAmount,
                    full: isFull,
                  });
                }
              }
            }
          } catch (revErr) {
            const errMsg = (revErr as Error).message;
            logStep("Transfer reversal FAILED", { error: errMsg, piId });
            // Best-effort: log but do not throw — client refund must succeed regardless.
            await supabaseClient
              .from("revenue_distributions")
              .update({ secondary_transfer_error: `Reversal failed: ${errMsg}` })
              .eq("payment_intent_id", piId);
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
