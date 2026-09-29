import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fundDjBookingContract, releaseDjBookingBalance, type DjContract } from "../_shared/dj-payout.ts";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { isTieredCollab } from "../_shared/payment-split.ts";
import { heldLegAfterRefund, refundContext, releasedLegReversal } from "../_shared/refund-legs.ts";
import { connectStatusOf, organizerConnectColumns, stateFromV1Account, venueConnectColumns } from "../_shared/stripe-connect-accounts.ts";

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
  admin: SupabaseClient,
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
async function releaseHeldTransfers(stripe: Stripe, admin: SupabaseClient) {
  const nowIso = new Date().toISOString();
  // Les jambes 'failed' sont RE-TENTÉES à chaque passage du cron : un échec de
  // transfer est presque toujours transitoire (solde plateforme insuffisant,
  // compte connecté pas encore actif). Avant ce fix, un échec laissait l'argent
  // bloqué sur la plateforme pour toujours, sans alerte — le partenaire n'était
  // jamais payé. La clé d'idempotence Stripe (release_<row>_<role>) garantit
  // qu'un retry ne peut pas créer un second transfer pour la même jambe.
  const { data: due } = await admin
    .from("revenue_distributions")
    .select("id, payment_intent_id, transfer_group_id, event_id, item_type, ticket_id, table_reservation_id, order_id, primary_account_id, primary_amount_cents, primary_transfer_status, primary_fail_count, secondary_account_id, secondary_amount_cents, secondary_transfer_status, secondary_fail_count")
    .lte("transfers_release_at", nowIso)
    .or("primary_transfer_status.in.(scheduled,failed),secondary_transfer_status.in.(scheduled,failed)")
    .limit(500);
  if ((due?.length ?? 0) === 500) {
    logStep("release: hit the 500-row cap — remainder picked up next run");
  }

  const RETRYABLE = new Set(["scheduled", "failed"]);
  let released = 0;
  let skipped = 0;
  // Colonnes du select ci-dessus — le client Supabase n'est pas typé ici.
  interface HeldDistributionRow {
    id: string;
    payment_intent_id: string;
    transfer_group_id: string | null;
    event_id: string | null;
    item_type: string | null;
    ticket_id: string | null;
    table_reservation_id: string | null;
    order_id: string | null;
    primary_account_id: string | null;
    primary_amount_cents: number | null;
    primary_transfer_status: string;
    secondary_account_id: string | null;
    secondary_amount_cents: number | null;
    secondary_transfer_status: string;
    primary_fail_count: number | null;
    secondary_fail_count: number | null;
  }
  for (const row of (due ?? []) as Array<HeldDistributionRow>) {
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
        }, { idempotencyKey: `release_${row.id}_${role}_${amountCents}` });
        await admin.from("revenue_distributions").update({
          [idCol]: transfer.id,
          [statusCol]: "succeeded",
          [errCol]: null,
        }).eq("id", row.id);
      } catch (e) {
        const failCol = role === "primary" ? "primary_fail_count" : "secondary_fail_count";
        const fails = (Number(role === "primary" ? row.primary_fail_count : row.secondary_fail_count) || 0) + 1;
        await admin.from("revenue_distributions").update({
          [statusCol]: "failed",
          [errCol]: (e as Error).message,
          [failCol]: fails,
        }).eq("id", row.id);
        logStep("release: transfer failed", { role, pi: row.payment_intent_id, error: (e as Error).message, fails });
        // Réessayée à chaque passage du cron, mais plus jamais en silence : au 3e
        // échec (compte Connect restreint, IBAN refusé…), une alerte super admin,
        // une seule fois par jambe.
        if (fails === 3) {
          await admin.rpc("emit_admin_notification", {
            p_type: "admin_transfer_release_failed",
            p_title: "Versement d'une co-soirée bloqué",
            p_message: `${(amountCents / 100).toFixed(2)} € ne partent pas vers ${accountId} (3 échecs) : ${(e as Error).message}`.slice(0, 480),
            p_priority: "high",
            p_reference_type: "revenue_distribution",
            p_reference_id: row.id,
            p_metadata: { role, account_id: accountId, payment_intent_id: row.payment_intent_id, amount_cents: amountCents },
            p_dedup_key: `release_failed:${row.id}:${role}`,
            p_event_id: row.event_id,
          }).then(() => undefined, () => undefined);
        }
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

// ─── Délégation checkout.session.completed → verify-* ─────────────────────────
//
// Filet de l'acheteur qui ferme l'onglet avant le retour (Apple Pay, mobile) :
// le webhook rejoue le traitement de verify-*. Avant, la réponse de verify-*
// était ignorée et le webhook rendait 200 : un échec passager (Stripe ou base
// indisponible) n'était JAMAIS rejoué — client débité, sans billet ni QR.
// Désormais :
//  • échec passager → on lève, le webhook rend une erreur, Stripe REJOUE
//    (verify-* est idempotent : pending→paid atomique, alreadyProcessed) ;
//  • échec définitif (ligne introuvable, session qui ne correspond pas, montant
//    incohérent) → rejouer n'y changera rien : alerte super admin, une par
//    session, et le webhook continue.
const DEFINITIVE_VERIFY_ERRORS = [
  "not found",
  "does not match",
  "does not belong",
  "amount mismatch",
];

async function delegateToVerify(
  admin: SupabaseClient,
  fn: "verify-payment" | "verify-ticket-payment" | "verify-table-payment",
  body: Record<string, string>,
  ref: { kind: "order" | "ticket" | "table"; id: string },
  session: Stripe.Checkout.Session,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Réseau : Stripe rejouera l'événement.
    throw new Error(`${fn} unreachable: ${(err as Error).message}`);
  }
  let payload: Record<string, unknown> | null = null;
  try { payload = await resp.json(); } catch { /* corps non JSON */ }
  logStep(`Delegated ${ref.kind} processing to ${fn}`, {
    id: ref.id,
    ok: resp.ok,
    alreadyProcessed: payload?.alreadyProcessed ?? null,
  });
  if (resp.ok) return;

  const message = String(payload?.error ?? `HTTP ${resp.status}`);
  const definitive = DEFINITIVE_VERIFY_ERRORS.some((m) => message.toLowerCase().includes(m));
  if (!definitive) {
    throw new Error(`${fn} failed for ${ref.kind} ${ref.id}: ${message}`);
  }
  if (session.payment_status === "paid") {
    await admin.rpc("emit_admin_notification", {
      p_type: "admin_paid_sale_unfulfilled",
      p_title: "Paiement encaissé sans vente enregistrée",
      p_message: `Stripe a encaissé ${((session.amount_total ?? 0) / 100).toFixed(2)} € (${ref.kind} ${ref.id}) mais ${fn} refuse : ${message}. Retrouver l'acheteur (${session.customer_details?.email ?? session.customer_email ?? "email inconnu"}) et rembourser ou émettre la vente à la main.`.slice(0, 480),
      p_priority: "high",
      p_reference_type: ref.kind,
      p_reference_id: ref.id,
      p_metadata: { session_id: session.id, payment_intent: session.payment_intent ?? null, error: message },
      p_dedup_key: `paid_unfulfilled:${session.id}`,
      p_event_id: session.metadata?.eventId ?? null,
    }).then(() => undefined, () => undefined);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    // En live, les charges DIRECT naissent sur le compte CONNECTÉ du club : elles
    // n'arrivent que par un endpoint Stripe « Listen to events on Connected
    // accounts », qui a son PROPRE secret de signature (un whsec_ par endpoint).
    // On essaie donc chaque secret configuré. Inerte tant que la seconde env
    // n'existe pas — un seul endpoint, un seul secret, comportement inchangé.
    const webhookSecretConnect = Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT");
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

    // Vérification de signature multi-endpoints : secret plateforme d'abord,
    // puis secret Connect si configuré (voir le commentaire en tête de fonction).
    const signingSecrets = [webhookSecret, webhookSecretConnect].filter(
      (s): s is string => !!s,
    );
    let event: Stripe.Event | null = null;
    let lastSignatureError = "";
    for (const secret of signingSecrets) {
      try {
        event = await stripe.webhooks.constructEventAsync(body, signature, secret);
        break;
      } catch (err) {
        lastSignatureError = (err as Error).message;
      }
    }
    if (!event) {
      logStep("Signature verification failed", { error: lastSignatureError, secretsTried: signingSecrets.length });
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
        // Même projection et mêmes colonnes que stripe-connect (Console) et que
        // l'auto-réparation des checkouts : _shared/stripe-connect-accounts.ts.
        const state = stateFromV1Account(account);
        const orgStatus = connectStatusOf(state);
        const { chargesEnabled, payoutsEnabled, detailsSubmitted } = state;
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
          .update(venueConnectColumns(state))
          .eq("stripe_account_id", account.id);

        if (venueErr) {
          logStep("Error updating venue", { error: venueErr.message });
        }

        const { data: orgRows, error: orgErr } = await supabaseClient
          .from("profiles")
          .update(organizerConnectColumns(state))
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
          // RELIABILITY FALLBACK — même logique que les billets/tables ci-dessous.
          // Si l'acheteur ferme l'onglet avant d'être redirigé vers /verify-payment
          // (typique Apple Pay / mobile), cette fonction ne tournait jamais : la
          // commande passait 'paid' MAIS le token de retrait (QR scanné par le
          // barman) n'était jamais minté, donc la boisson payée devenait
          // impossible à servir — sans email, sans crédit, sans point fidélité.
          // Le webhook est le chemin que Stripe garantit et rejoue, donc on délègue
          // au même traitement. verify-payment bascule pending→paid de façon
          // atomique : si le client a déjà traité, cet appel est un no-op
          // (alreadyProcessed=true).
          await delegateToVerify(supabaseClient, "verify-payment",
            { sessionId: session.id, orderId: metadata.orderId },
            { kind: "order", id: metadata.orderId }, session);
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
          await delegateToVerify(supabaseClient, "verify-ticket-payment",
            { sessionId: session.id, ticketId: metadata.ticketId },
            { kind: "ticket", id: metadata.ticketId }, session);
        }

        if (metadata.reservationId) {
          // RELIABILITY FALLBACK — même logique que les billets ci-dessus. Si
          // l'acheteur ferme l'onglet avant d'être redirigé vers
          // /verify-table-payment (typique Apple Pay / mobile), cette fonction
          // ne tournait jamais : AUCUN effet de bord ne se produisait — pas de
          // conversion promoteur (commission perdue), pas de facture, pas de
          // stats club, et la résa restait en 'confirmed', un statut mort que le
          // remboursement (qui filtre 'paid') ne pouvait plus toucher. Le webhook
          // est le chemin que Stripe garantit et rejoue, donc on délègue au même
          // traitement. verify-table-payment bascule pending/confirmed→paid de
          // façon atomique : si le client a déjà traité, cet appel est un no-op
          // (alreadyProcessed=true).
          await delegateToVerify(supabaseClient, "verify-table-payment",
            { sessionId: session.id, reservationId: metadata.reservationId },
            { kind: "table", id: metadata.reservationId }, session);
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
        let heldForNightClosing = false;
        let lateAfterClosing = false;
        // Décision de rétention posée AU CHECKOUT (métadonnée `hold`). Les
        // sessions créées avant ce champ n'en ont pas : on relit alors les règles.
        const mdHold = typeof md.hold === "string" ? md.hold : undefined;
        if (needsPrimaryTransfer || needsSecondary) {
          let endIso: string | null = null;
          if (md.event_id) {
            const { data: evRow } = await supabaseClient
              .from("events").select("end_at, start_at, revenue_split_rules").eq("id", md.event_id).maybeSingle();
            endIso = (evRow?.end_at as string | null) ?? (evRow?.start_at as string | null) ?? null;
            // Contrat à BARÈME sur le CA de la soirée : billets et tables sont retenus
            // SANS date. Rien ne part avant que l'organisateur ait accepté le décompte
            // de fin de soirée (accept_collab_night_closing pose la date et répartit).
            // Le contrat est verrouillé dès la première vente : les règles lues ici
            // sont celles qui s'appliquaient au checkout.
            heldForNightClosing = (itemType === "ticket" || itemType === "table")
              && (mdHold !== undefined
                ? mdHold === "night_closing"
                : isTieredCollab((evRow?.revenue_split_rules as Record<string, unknown> | null) ?? null));
            // Vente payée APRÈS l'acceptation du décompte (session ouverte avant) :
            // plus aucun décompte ne la libérera. Elle part au club (100 % pendant
            // la vente en barème) à la date normale, et le super admin est prévenu
            // pour que la part de l'organisateur soit régularisée.
            if (heldForNightClosing) {
              const { data: accepted } = await supabaseClient
                .from("collab_night_closings").select("id")
                .eq("event_id", md.event_id).eq("status", "accepted").limit(1);
              if ((accepted?.length ?? 0) > 0) { heldForNightClosing = false; lateAfterClosing = true; }
            }
          }
          if (!heldForNightClosing) {
            const nowMs = Date.now();
            const baseMs = endIso ? new Date(endIso).getTime() : nowMs;
            transfersReleaseAt = new Date(Math.max(baseMs, nowMs) + REFUND_WINDOW_DAYS * 86400000).toISOString();
          }
        }

        // Insert ledger row — INSERTION SEULE, idempotente sur payment_intent_id.
        // Un upsert réécrivait la ligne au rejeu du webhook (« Resend » dans
        // Stripe) : une jambe déjà libérée repassait en 'scheduled', et passé 24 h
        // la clé d'idempotence Stripe était oubliée → second virement.
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
          }, { onConflict: "payment_intent_id", ignoreDuplicates: true });

        if (ledgerErr) {
          // Jamais 200 sur une vente sans grand livre : ses jambes ne partiraient
          // jamais. L'erreur remonte, Stripe rejoue l'événement.
          logStep("Ledger insert error", { error: ledgerErr.message });
          throw new Error(`ledger_insert_failed: ${ledgerErr.message}`);
        }
        if (lateAfterClosing) {
          await supabaseClient.rpc("emit_admin_notification", {
            p_type: "admin_collab_late_sale",
            p_title: "Vente après le décompte d'une co-soirée",
            p_message: `${(grossCents / 100).toFixed(2)} € payés après l'acceptation du décompte : versés au club, part de l'organisateur à régulariser.`,
            p_priority: "high",
            p_reference_type: "payment_intent",
            p_reference_id: pi.id,
            p_metadata: { item_type: itemType, gross_cents: grossCents },
            p_dedup_key: `collab_late_sale:${pi.id}`,
            p_event_id: md.event_id || null,
          }).then(() => undefined, () => undefined);
        }

        // P0-6 — transfers are NOT fired here anymore. They are held ('scheduled') and
        // released by the 'release_held_transfers' cron task once the refund window has
        // closed and the sale wasn't refunded. See releaseHeldTransfers() below.
        if (needsPrimaryTransfer || needsSecondary) {
          logStep(heldForNightClosing ? "Tiered collab: transfers held until night closing" : "Co-event transfers held until release", {
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
              // Sur une charge DIRECTE, `bt.fee` du compte connecté additionne le
              // frais Stripe ET la commission Yuno (application_fee). Seules les
              // lignes `stripe_fee` sont le coût de traitement réel.
              const details: { type?: string; amount?: number }[] = Array.isArray(bt.fee_details) ? bt.fee_details : [];
              const stripeOnly = details.length > 0
                ? details.filter((d) => d.type === "stripe_fee").reduce((sum: number, d) => sum + (d.amount || 0), 0)
                : bt.fee;
              await supabaseClient.from("revenue_distributions").update({
                stripe_fee_real_cents: stripeOnly,
                stripe_fee_charge_id: chargeId,
              }).eq("payment_intent_id", pi.id);
              logStep("Stripe fee reconciled", { realFee: stripeOnly, totalFee: bt.fee, estimated: stripeFeeEstimatedCents });
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

        // Remboursement TOTAL ou PARTIEL ?
        //
        // Passer une ligne à "refunded" déclenche
        // trg_cancel_promoter_conv_on_refund, qui annule 100 % de la commission.
        // Or charge.refunded se déclenche aussi sur un remboursement partiel :
        // rembourser 5€ sur un billet à 60€ faisait perdre au promoteur la
        // totalité de sa commission. On ne bascule donc le statut que sur un
        // remboursement complet ; un partiel laisse la ligne intacte (le
        // détail monétaire est réconcilié dans revenue_distributions plus bas,
        // qui gère déjà le cas partiel).
        //
        // On n'écrit pas "partially_refunded" ici : cette valeur n'est admise
        // que sur les colonnes de statut de transfert de revenue_distributions,
        // et la contrainte orders_status_check la refuserait.
        const isFullRefund = charge.amount_refunded >= charge.amount;
        if (!isFullRefund) {
          logStep("Remboursement partiel — statuts et commissions inchangés", {
            chargeId: charge.id, refunded: charge.amount_refunded, total: charge.amount,
          });
        }

        // Try to find and update the related order/ticket/reservation.
        // NB : la réversion proportionnelle des transferts (SYMMETRIC REFUND, plus
        // bas dans ce même bloc) DOIT tourner y compris sur un partiel — seules les
        // trois bascules de statut ci-dessous sont réservées au remboursement total.
        const piId = charge.payment_intent as string;
        if (piId) {
          // Update orders
          const { data: orderData } = isFullRefund ? await supabaseClient
            .from("orders")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", piId)
            .eq("status", "paid")
            .select("id") : { data: null };
          if (orderData?.length) {
            logStep("Order(s) marked refunded via charge.refunded", { ids: orderData.map(o => o.id) });
          }

          // Update tickets
          const { data: ticketData } = isFullRefund ? await supabaseClient
            .from("tickets")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", piId)
            .eq("status", "paid")
            .select("id") : { data: null };
          if (ticketData?.length) {
            logStep("Ticket(s) marked refunded via charge.refunded", { ids: ticketData.map(t => t.id) });
          }

          // Update table reservations.
          // Deux bugs corrigés ici, qui se cumulaient en fuite d'argent :
          //   1. le filtre portait sur "confirmed", alors qu'une réservation
          //      payée vaut "paid" (verify-table-payment) → 0 ligne touchée, la
          //      table restait vendue et bloquait l'inventaire après remboursement ;
          //   2. on écrivait "cancelled", alors que le trigger de réversion de
          //      commission (trg_cancel_promoter_conv_on_refund) ne se déclenche
          //      que sur "refunded" — comme pour orders et tickets juste au-dessus.
          //      Le club remboursait donc le client tout en payant la commission.
          const { data: resData } = isFullRefund ? await supabaseClient
            .from("table_reservations")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", piId)
            .eq("status", "paid")
            .select("id") : { data: null };
          if (resData?.length) {
            logStep("Reservation(s) marked refunded via charge.refunded", { ids: resData.map(r => r.id) });
          }

          // SYMMETRIC REFUND: reverse both primary and secondary transfers proportionally
          try {
            const { data: dist } = await supabaseClient
              .from("revenue_distributions")
              .select("id, split_mode, refunded_cents, yuno_fee_cents, primary_transfer_id, primary_transfer_status, primary_amount_cents, primary_account_id, secondary_transfer_id, secondary_transfer_status, secondary_amount_cents, secondary_account_id, gross_amount_cents")
              .eq("payment_intent_id", piId)
              .maybeSingle();

            // `amount_refunded` est CUMULÉ ; `refunded_cents` dit ce qui a déjà été
            // appliqué aux jambes. Seul le DELTA est traité, et la mise à jour
            // conditionnelle sert de verrou : une seconde livraison du même
            // événement (ou deux remboursements concurrents) ne l'applique qu'une fois.
            const refundedTotal = charge.amount_refunded;
            const prevRefunded = Number(dist?.refunded_cents) || 0;
            const deltaCents = refundedTotal - prevRefunded;
            let claimed = false;
            if (dist && deltaCents > 0) {
              const { data: claim } = await supabaseClient.from("revenue_distributions")
                .update({ refunded_cents: refundedTotal })
                .eq("id", dist.id).eq("refunded_cents", prevRefunded)
                .select("id");
              claimed = (claim?.length ?? 0) > 0;
              if (!claimed) logStep("Refund delta already applied by a concurrent delivery", { piId, refundedTotal });
            } else if (dist) {
              logStep("Refund already applied to the legs", { piId, refundedTotal, prevRefunded });
            }

            if (dist && claimed) {
              // Part VENDEURS (brut − frais Yuno) : voir _shared/refund-legs.ts.
              const refundInput = {
                grossCents: dist.gross_amount_cents || charge.amount,
                yunoFeeCents: Number(dist.yuno_fee_cents) || 0,
                refundedTotal,
                prevRefunded,
              };
              const { isFull } = refundContext(refundInput);

              // Une jambe :
              //  - retenue ('scheduled') ou jamais partie ('failed') : rien n'a quitté
              //    la plateforme. Remboursement total → annulée ; PARTIEL → réduite au
              //    prorata de ce qui reste de la vente (avant, un partiel annulait
              //    toute la jambe et le reste de la vente sortait du partage).
              //  - déjà versée ('succeeded' ou déjà 'partially_refunded') : on reverse
              //    la part du DELTA ; un échec devient une dette suivie, jamais une perte.
              const handleLeg = async (
                role: "primary" | "secondary",
                transferId: string | null,
                status: string | null,
                accountId: string | null,
                amountCents: number,
              ) => {
                const statusCol = role === "primary" ? "primary_transfer_status" : "secondary_transfer_status";
                const amountCol = role === "primary" ? "primary_amount_cents" : "secondary_amount_cents";
                if (status === "scheduled" || status === "failed") {
                  const kept = heldLegAfterRefund(amountCents, refundInput);
                  if (kept <= 0) {
                    await supabaseClient.from("revenue_distributions")
                      .update({ [statusCol]: "cancelled", [amountCol]: 0 }).eq("id", dist.id);
                    logStep(`${role} transfer cancelled (was held, never fired)`, { piId, was: status });
                  } else {
                    await supabaseClient.from("revenue_distributions")
                      .update({ [amountCol]: kept }).eq("id", dist.id);
                    logStep(`${role} held transfer reduced (partial refund)`, { piId, from: amountCents, to: kept });
                  }
                  return;
                }
                if (!transferId || (status !== "succeeded" && status !== "partially_refunded")) return;
                // Cumul attendu après ce remboursement : sert aussi à reconnaître une
                // reversal déjà faite ailleurs (reverse_transfer d'une charge à
                // destination) sans créer de dette fantôme.
                const { reversal: reversalAmount, expectedCumulative } = releasedLegReversal(amountCents, refundInput);
                if (reversalAmount <= 0) return;
                try {
                  const tr0 = await stripe.transfers.retrieve(transferId);
                  if ((tr0.amount_reversed ?? 0) >= expectedCumulative) {
                    await supabaseClient.from("revenue_distributions")
                      .update({ [statusCol]: isFull ? "refunded" : "partially_refunded" })
                      .eq("id", dist.id);
                    logStep(`${role} transfer already reversed elsewhere — no clawback`, { transferId, amountReversed: tr0.amount_reversed });
                    return;
                  }
                } catch { /* retrieve failed → on tente la reversal, Stripe tranchera */ }
                try {
                  const reversal = await stripe.transfers.createReversal(transferId, {
                    amount: reversalAmount,
                    metadata: {
                      payment_intent_id: piId,
                      refund_amount_cents: String(refundedTotal),
                      refund_delta_cents: String(deltaCents),
                      reason: "client_refund_symmetric",
                      role,
                    },
                  }, { idempotencyKey: `refund_${dist.id}_${role}_${refundedTotal}` });
                  await supabaseClient.from("revenue_distributions")
                    .update({ [statusCol]: isFull ? "refunded" : "partially_refunded" })
                    .eq("id", dist.id);
                  logStep(`${role} transfer reversed`, { transferId, reversalId: reversal.id, amount: reversalAmount, full: isFull });
                } catch (revErr) {
                  const errMsg = (revErr as Error).message;
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
          account: event.account ?? null,
        });
        // Un litige se gagne ou se perd sur les preuves envoyées AVANT l'échéance
        // Stripe (billet scanné à la porte, email de confirmation…). Il était
        // seulement journalisé : personne ne le voyait. Sur une charge directe,
        // c'est le compte du pro qui est débité ; Yuno doit quand même le savoir
        // pour l'aider à répondre.
        const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null;
        let saleRef: { kind: string; id: string; event_id: string | null } | null = null;
        if (piId) {
          for (const [table, kind] of [["tickets", "ticket"], ["table_reservations", "table"], ["orders", "order"]] as const) {
            const { data } = await supabaseClient.from(table).select("id, event_id").eq("stripe_payment_intent_id", piId).limit(1).maybeSingle();
            if (data?.id) { saleRef = { kind, id: data.id, event_id: (data as { event_id?: string | null }).event_id ?? null }; break; }
          }
        }
        const dueBy = dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
          : "inconnue";
        await supabaseClient.rpc("emit_admin_notification", {
          p_type: "admin_payment_disputed",
          p_title: "Litige bancaire ouvert sur une vente",
          p_message: `${(dispute.amount / 100).toFixed(2)} € contestés (motif : ${dispute.reason}). Preuves à envoyer depuis le tableau de bord Stripe ${event.account ? "du vendeur" : "de Yuno"} avant le ${dueBy}.`.slice(0, 480),
          p_priority: "high",
          p_reference_type: saleRef?.kind ?? "dispute",
          p_reference_id: saleRef?.id ?? dispute.id,
          p_metadata: { dispute_id: dispute.id, charge_id: dispute.charge, payment_intent: piId, account: event.account ?? null, reason: dispute.reason },
          p_dedup_key: `dispute:${dispute.id}`,
          p_event_id: saleRef?.event_id ?? null,
        }).then(() => undefined, () => undefined);
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
