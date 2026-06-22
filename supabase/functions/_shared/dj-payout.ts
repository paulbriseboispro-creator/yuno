// Shared DJ secured-booking payout logic.
//
// Used by BOTH stripe-connect (club-triggered actions, verify_jwt=true) and
// stripe-webhook (escrow funding on payment_intent.succeeded + cron auto-release,
// verify_jwt=false). Keeping the transfer/refund logic here means a single source
// of truth and no new edge function (the 402 deploy cap blocks new functions).
//
// Money model: the club pays cachet + Stripe fee. The full charge lands on the
// platform balance (no transfer_data). The acompte is transferred to the DJ as soon
// as the charge succeeds; the balance is held and transferred after the gig (club
// clicks "done" OR cron auto-releases). Yuno keeps nothing (the fee covers Stripe).

import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[DJ-PAYOUT] ${s}`, d ? JSON.stringify(d) : "");

export interface DjContract {
  id: string;
  dj_set_id: string;
  dj_id: string;
  dj_user_id: string;
  status: string;
  currency: string;
  cachet_cents: number;
  acompte_cents: number;
  stripe_fee_cents: number;
  cancellation_policy: string;
  payment_intent_id: string | null;
  charge_id: string | null;
  acompte_transfer_id: string | null;
  balance_transfer_id: string | null;
}

async function djStripeAccount(admin: SupabaseClient, djUserId: string): Promise<string | null> {
  const { data } = await admin
    .from("dj_stripe_accounts")
    .select("stripe_account_id, payouts_enabled")
    .eq("user_id", djUserId)
    .maybeSingle();
  if (!data?.stripe_account_id) return null;
  return data.stripe_account_id as string;
}

// payment_intent.succeeded for an escrowed DJ booking: mark funds held and release
// the acompte to the DJ immediately. Idempotent (safe on webhook replay).
export async function fundDjBookingContract(
  stripe: Stripe,
  admin: SupabaseClient,
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const contractId = pi.metadata?.contract_id;
  if (!contractId) {
    log("escrow PI without contract_id, skipping", { pi: pi.id });
    return;
  }

  const { data: contract } = await admin
    .from("dj_booking_contracts")
    .select("*")
    .eq("id", contractId)
    .maybeSingle();
  if (!contract) {
    log("contract not found", { contractId });
    return;
  }
  const c = contract as DjContract;
  if (c.status === "released" || c.status === "refunded") {
    log("contract already terminal, skipping funding", { contractId, status: c.status });
    return;
  }

  const charge = (pi.latest_charge as string) ?? null;

  // Mark held + store Stripe ids (only the first time).
  if (c.status !== "funds_held") {
    await admin
      .from("dj_booking_contracts")
      .update({ status: "funds_held", payment_intent_id: pi.id, charge_id: charge })
      .eq("id", contractId);
    log("funds held", { contractId, pi: pi.id });
  }

  // Release acompte immediately if any and not already sent.
  if (c.acompte_cents > 0 && !c.acompte_transfer_id) {
    const account = await djStripeAccount(admin, c.dj_user_id);
    if (!account) {
      log("acompte transfer skipped — DJ has no Stripe account", { contractId });
      return;
    }
    try {
      const transfer = await stripe.transfers.create({
        amount: c.acompte_cents,
        currency: c.currency,
        destination: account,
        ...(charge ? { source_transaction: charge } : {}),
        metadata: { contract_id: c.id, role: "dj_acompte" },
      });
      await admin
        .from("dj_booking_contracts")
        .update({ acompte_transfer_id: transfer.id, acompte_released_at: new Date().toISOString() })
        .eq("id", contractId);
      log("acompte transferred", { contractId, transfer: transfer.id, amount: c.acompte_cents });
    } catch (err) {
      log("acompte transfer FAILED (non-blocking, retried on release)", { contractId, error: (err as Error).message });
    }
  }
}

// Transfer the remaining balance to the DJ and close the contract. Mirrors the
// manual "mark set as paid" bookkeeping (dj_sets.fee_paid + dj_payments + djs totals).
// Idempotent: a contract not in funds_held is a no-op.
export async function releaseDjBookingBalance(
  stripe: Stripe,
  admin: SupabaseClient,
  contract: DjContract,
): Promise<{ released: boolean; reason?: string }> {
  if (contract.status !== "funds_held") {
    return { released: false, reason: `status=${contract.status}` };
  }
  if (contract.balance_transfer_id) {
    return { released: false, reason: "already_released" };
  }

  const account = await djStripeAccount(admin, contract.dj_user_id);
  if (!account) return { released: false, reason: "dj_no_stripe_account" };

  // Base the balance on what the DJ ACTUALLY received: if the acompte transfer
  // failed earlier (non-blocking), it was never sent, so release the full cachet.
  const acompteSent = contract.acompte_transfer_id ? contract.acompte_cents : 0;
  const balanceCents = contract.cachet_cents - acompteSent;

  let balanceTransferId: string | null = null;
  if (balanceCents > 0) {
    const transfer = await stripe.transfers.create({
      amount: balanceCents,
      currency: contract.currency,
      destination: account,
      ...(contract.charge_id ? { source_transaction: contract.charge_id } : {}),
      metadata: { contract_id: contract.id, role: "dj_balance" },
    });
    balanceTransferId = transfer.id;
  }

  await admin
    .from("dj_booking_contracts")
    .update({
      status: "released",
      balance_transfer_id: balanceTransferId,
      released_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  // Bookkeeping mirror of the manual flow (handleMarkSetAsPaid).
  const cachetEur = contract.cachet_cents / 100;
  await admin
    .from("dj_sets")
    .update({ fee_paid: true, fee_paid_at: new Date().toISOString() })
    .eq("id", contract.dj_set_id);

  await admin.from("dj_payments").insert({
    dj_id: contract.dj_id,
    dj_set_id: contract.dj_set_id,
    amount: cachetEur,
    description: "Cachet sécurisé Yuno",
  });

  const { data: djRow } = await admin
    .from("djs")
    .select("pending_amount, total_paid")
    .eq("id", contract.dj_id)
    .maybeSingle();
  if (djRow) {
    await admin
      .from("djs")
      .update({
        pending_amount: Math.max(0, (djRow.pending_amount ?? 0) - cachetEur),
        total_paid: (djRow.total_paid ?? 0) + cachetEur,
      })
      .eq("id", contract.dj_id);
  }

  log("balance released", { contractId: contract.id, transfer: balanceTransferId, amount: balanceCents });
  return { released: true };
}

// Cancel after funding: refund the held portion to the club. With the default
// 'acompte_to_dj' policy the acompte stays with the DJ (only the balance is refunded).
// With 'full_refund' the acompte transfer is reversed and the full charge refunded.
export async function refundDjBookingContract(
  stripe: Stripe,
  admin: SupabaseClient,
  contract: DjContract,
): Promise<{ refunded: boolean; reason?: string }> {
  if (contract.status !== "funds_held") {
    return { refunded: false, reason: `status=${contract.status}` };
  }
  if (!contract.payment_intent_id) {
    return { refunded: false, reason: "no_payment_intent" };
  }

  const fullRefund = contract.cancellation_policy === "full_refund";

  // Reverse the acompte only on full_refund.
  if (fullRefund && contract.acompte_transfer_id) {
    try {
      await stripe.transfers.createReversal(contract.acompte_transfer_id, {
        metadata: { contract_id: contract.id, reason: "cancellation_full_refund" },
      });
    } catch (err) {
      log("acompte reversal failed", { contractId: contract.id, error: (err as Error).message });
    }
  }

  // Amount returned to the club: full charge on full_refund, else the held balance
  // (everything not already paid out to the DJ as an acompte).
  const acompteSent = contract.acompte_transfer_id ? contract.acompte_cents : 0;
  const refundAmount = fullRefund
    ? contract.cachet_cents + contract.stripe_fee_cents
    : contract.cachet_cents - acompteSent;

  let refundId: string | null = null;
  if (refundAmount > 0) {
    const refund = await stripe.refunds.create({
      payment_intent: contract.payment_intent_id,
      amount: refundAmount,
      metadata: { contract_id: contract.id, policy: contract.cancellation_policy },
    });
    refundId = refund.id;
  }

  await admin
    .from("dj_booking_contracts")
    .update({ status: "refunded", refund_id: refundId, refunded_at: new Date().toISOString() })
    .eq("id", contract.id);

  log("contract refunded", { contractId: contract.id, refund: refundId, amount: refundAmount, fullRefund });
  return { refunded: true };
}
