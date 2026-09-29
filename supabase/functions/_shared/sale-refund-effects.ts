// Effets d'un remboursement de vente, partagés par owner-refund, cancel-ticket
// et stripe-webhook `charge.refunded`. La règle (plafond, total ou partiel, qui
// peut rembourser) vit dans ./sale-refund.ts ; ici, ce qu'on écrit et à qui on
// le dit.
//
// Chaque effet est déclenché UNE fois, par celui qui GAGNE la mise à jour
// conditionnelle correspondante :
//  - le montant (`refund_amount` passe de l'ancien cumul au nouveau) porte les
//    effets du montant : statistiques client, email, push, notification club ;
//  - le passage du statut à « refunded » porte ceux de la vente entière :
//    compteur de ventes du client, points de fidélité. Les effets d'un billet
//    (places rendues, consos annulées) et des commissions promoteur sont portés
//    par des triggers sur ce même passage.
// Deux chemins qui voient le même remboursement (owner-refund puis le webhook
// qu'il provoque, ou deux livraisons du même événement) ne l'appliquent donc
// jamais deux fois.

import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { type EmailLanguage } from "./email-branding.ts";
import { buildRefund } from "./email-templates.ts";
import { sendAutoPush } from "./auto-push.ts";
import {
  alreadyRefundedCents, fromCents, fullRefundPatch, planChargeRefund, refundCapCents, SALE_TABLE,
  type SaleAmounts, type SaleKind,
} from "./sale-refund.ts";

/**
 * Rembourse une vente chez Stripe.
 *
 * Charge DIRECTE (le seul modèle depuis le 29/09) : le remboursement part du
 * compte connecté qui a encaissé, les frais Yuno restent à Yuno
 * (`refund_application_fee: false`). Ancienne charge plateforme : on ne reverse
 * un transfert que sur une charge à DESTINATION (`transfer_data`) — une charge à
 * jambes séparées n'a aucun transfert attaché, ses jambes sont réduites par le
 * webhook `charge.refunded`.
 *
 * `idempotencyKey` : un même remboursement rejoué (double clic, réponse Stripe
 * perdue puis nouvel essai) rend le remboursement déjà créé au lieu d'en créer
 * un second.
 */
export async function createSaleStripeRefund(
  stripe: Stripe,
  admin: SupabaseClient,
  p: { paymentIntentId: string; amountCents: number; connectedAccountId: string | null; idempotencyKey: string },
): Promise<Stripe.Refund> {
  let reverseTransfer = false;
  if (!p.connectedAccountId) {
    const { data: dist } = await admin.from("revenue_distributions")
      .select("split_mode").eq("payment_intent_id", p.paymentIntentId).maybeSingle();
    reverseTransfer = dist?.split_mode === "destination";
  }
  return await stripe.refunds.create({
    payment_intent: p.paymentIntentId,
    amount: p.amountCents,
    ...(reverseTransfer ? { reverse_transfer: true } : {}),
    refund_application_fee: false,
  }, {
    idempotencyKey: p.idempotencyKey,
    maxNetworkRetries: 2,
    ...(p.connectedAccountId ? { stripeAccount: p.connectedAccountId } : {}),
  });
}

/**
 * Stripe a-t-il répondu par un REFUS ? Sinon (réseau coupé, erreur 5xx, 409 d'une
 * requête jumelle encore en cours) le remboursement a pu passer quand même.
 */
export function isDefiniteStripeRefusal(err: unknown): boolean {
  const e = err as { type?: string; statusCode?: number };
  if (e?.type === "StripeConnectionError") return false;
  return typeof e?.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 409;
}

/**
 * Cumul remboursé de la charge d'un paiement, lu chez Stripe (centimes). Sert à
 * trancher une réponse perdue : `null` si Stripe ne répond pas non plus.
 */
export async function chargeRefundedCents(
  stripe: Stripe,
  paymentIntentId: string,
  connectedAccountId: string | null,
): Promise<number | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge"] },
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
    );
    const charge = pi.latest_charge;
    return charge && typeof charge === "object" ? charge.amount_refunded : null;
  } catch {
    return null;
  }
}

/**
 * Rembourse et TRANCHE l'issue : `ok` dès que Stripe a rendu l'argent, y compris
 * quand la réponse s'est perdue en route (on relit alors le cumul de la charge).
 * `ok: false` = rien n'est parti ; l'appelant défait son verrou.
 */
export async function refundSaleOnStripe(
  stripe: Stripe,
  admin: SupabaseClient,
  p: {
    paymentIntentId: string;
    amountCents: number;
    connectedAccountId: string | null;
    idempotencyKey: string;
    /** Cumul remboursé attendu sur la charge une fois ce remboursement passé. */
    expectedCumulativeCents: number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createSaleStripeRefund(stripe, admin, p);
    return { ok: true };
  } catch (err) {
    if (!isDefiniteStripeRefusal(err)) {
      const seen = await chargeRefundedCents(stripe, p.paymentIntentId, p.connectedAccountId);
      if (seen !== null && seen >= p.expectedCumulativeCents) return { ok: true };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ce qu'il faut savoir de la vente pour prévenir le client et le club. */
export interface SaleRefundContext {
  kind: SaleKind;
  id: string;
  /** Club de la soirée (ou club partenaire d'une co-soirée) ; "" sans club. */
  venueId: string;
  venueName: string;
  eventTitle: string;
  customerEmail: string;
  customerUserId: string;
}

interface SaleRowForContext {
  id: string;
  user_id?: string | null;
  user_email?: string | null;
  venue_id?: string | null;
  event_id?: string | null;
}

/**
 * Résout le club EFFECTIF de la vente : celui de la commande, sinon celui de la
 * soirée, sinon le club partenaire d'une co-soirée menée par un organisateur
 * (`events.venue_id` y est NULL).
 */
export async function loadSaleRefundContext(
  admin: SupabaseClient,
  kind: SaleKind,
  row: SaleRowForContext,
): Promise<SaleRefundContext> {
  let venueId = (kind === "order" ? row.venue_id : null) || "";
  let eventTitle = "";
  if (row.event_id) {
    const { data: evt } = await admin.from("events")
      .select("title, venue_id, partner_venue_id").eq("id", row.event_id).maybeSingle();
    eventTitle = evt?.title || "";
    if (!venueId) venueId = evt?.venue_id || evt?.partner_venue_id || "";
  }
  let venueName = "";
  if (venueId) {
    const { data: v } = await admin.from("venues").select("name").eq("id", venueId).maybeSingle();
    venueName = v?.name || "";
  }
  return {
    kind,
    id: row.id,
    venueId,
    venueName,
    eventTitle,
    customerEmail: row.user_email || "",
    customerUserId: row.user_id || "",
  };
}

/**
 * Passe la vente « remboursée », une seule fois. Rend `true` à l'appelant qui a
 * fait le passage — c'est lui, et lui seul, qui appelle `applyFullRefundEffects`.
 */
export async function markSaleFullyRefunded(admin: SupabaseClient, kind: SaleKind, id: string): Promise<boolean> {
  const { data, error } = await admin.from(SALE_TABLE[kind])
    .update(fullRefundPatch(kind))
    .eq("id", id)
    .neq("status", "refunded")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function customerEmailLanguage(admin: SupabaseClient, userId: string): Promise<EmailLanguage> {
  if (!userId) return "en";
  const { data } = await admin.from("profiles").select("preferred_language").eq("id", userId).maybeSingle();
  const l = data?.preferred_language;
  return l === "fr" || l === "es" || l === "en" ? l : "en";
}

/** La dépense du client dans ce club baisse du montant rendu. */
export async function decrementCustomerSpent(admin: SupabaseClient, ctx: SaleRefundContext, amountCents: number): Promise<void> {
  if (!ctx.venueId || !ctx.customerUserId || amountCents <= 0) return;
  try {
    await admin.rpc("increment_venue_customer_stats", {
      p_venue_id: ctx.venueId, p_user_id: ctx.customerUserId,
      p_order_delta: 0, p_ticket_delta: 0, p_table_delta: 0, p_spent_delta: -fromCents(amountCents),
    });
  } catch (e) { console.error("[SALE-REFUND] stats (amount) error:", e); }
}

const TYPE_LABELS_FR: Record<SaleKind, string> = { order: "commande", ticket: "billet", table_reservation: "table VIP" };

/**
 * Effets du MONTANT rendu (à appeler par le gagnant de la mise à jour du cumul) :
 * dépense du client décomptée, email et push au client, notification au club.
 * Ne lève jamais : le remboursement est déjà fait, un effet raté se journalise.
 */
export async function applyRefundAmountEffects(
  admin: SupabaseClient,
  ctx: SaleRefundContext,
  amountCents: number,
  opts: { reason?: string | null; source: "yuno" | "stripe_dashboard" },
): Promise<void> {
  const amount = fromCents(amountCents);
  if (amount <= 0) return;

  await decrementCustomerSpent(admin, ctx, amountCents);

  if (ctx.customerEmail) {
    try {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (resendApiKey) {
        const mail = buildRefund({
          lang: await customerEmailLanguage(admin, ctx.customerUserId),
          eventTitle: ctx.eventTitle || undefined,
          venueName: ctx.venueName,
          amount: `${amount.toFixed(2)} €`,
          reason: opts.reason?.trim() || undefined,
        });
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
          body: JSON.stringify({ from: `Yuno <${fromEmail}>`, to: [ctx.customerEmail], subject: mail.subject, html: mail.html }),
          // Un Resend qui traîne ne doit pas suspendre le remboursement.
          signal: AbortSignal.timeout(10000),
        });
      }
    } catch (e) { console.error("[SALE-REFUND] email error:", e); }
  }

  // Registre auto (clé 'refund_confirmed') : gate super admin + langue du client.
  if (ctx.customerUserId) {
    try {
      await sendAutoPush(admin, {
        key: "refund_confirmed",
        userId: ctx.customerUserId,
        url: "/my-orders",
        vars: { amount: amount.toFixed(2) },
      });
    } catch (e) { console.error("[SALE-REFUND] push error:", e); }
  }

  if (ctx.venueId) {
    try {
      await admin.from("staff_notifications").insert({
        venue_id: ctx.venueId,
        target_role: "owner",
        notification_type: "refund_issued",
        title: "Remboursement effectué",
        message: `${TYPE_LABELS_FR[ctx.kind]} — ${amount.toFixed(2)} € remboursés${opts.source === "stripe_dashboard" ? " (depuis Stripe)" : ""}`,
        priority: "high",
        reference_type: ctx.kind,
        reference_id: ctx.id,
        metadata: { type: ctx.kind, amount, reason: opts.reason ?? null, source: opts.source },
      });
    } catch (e) { console.error("[SALE-REFUND] owner notification error:", e); }
  }
}

/**
 * Effets de la vente ENTIÈREMENT rendue (à appeler par le gagnant de
 * `markSaleFullyRefunded`) : la vente ne compte plus dans l'historique du client,
 * et les points de fidélité qu'elle avait rapportés sont retirés.
 */
export async function applyFullRefundEffects(admin: SupabaseClient, ctx: SaleRefundContext): Promise<void> {
  if (!ctx.venueId || !ctx.customerUserId) return;

  try {
    await admin.rpc("increment_venue_customer_stats", {
      p_venue_id: ctx.venueId, p_user_id: ctx.customerUserId,
      p_order_delta: ctx.kind === "order" ? -1 : 0,
      p_ticket_delta: ctx.kind === "ticket" ? -1 : 0,
      p_table_delta: ctx.kind === "table_reservation" ? -1 : 0,
      p_spent_delta: 0,
    });
  } catch (e) { console.error("[SALE-REFUND] stats (count) error:", e); }

  try {
    const { data: txns } = await admin.from("loyalty_transactions")
      .select("id, points, customer_loyalty_id")
      .eq("reference_id", ctx.id)
      .eq("transaction_type", "earn");
    for (const txn of txns || []) {
      const { data: cl } = await admin.from("customer_loyalty")
        .select("current_balance, total_points_earned").eq("id", txn.customer_loyalty_id).maybeSingle();
      if (cl) {
        await admin.from("customer_loyalty").update({
          current_balance: Math.max(0, cl.current_balance - txn.points),
          total_points_earned: Math.max(0, cl.total_points_earned - txn.points),
        }).eq("id", txn.customer_loyalty_id);
      }
      await admin.from("loyalty_transactions").insert({
        customer_loyalty_id: txn.customer_loyalty_id,
        venue_id: ctx.venueId,
        transaction_type: "adjustment",
        points: -txn.points,
        description: "Points removed (refund)",
        reference_type: "refund",
        reference_id: ctx.id,
      });
    }
  } catch (e) { console.error("[SALE-REFUND] loyalty rollback error:", e); }
}

type SaleRow = SaleAmounts & SaleRowForContext & { status: string | null };

const SALE_COLUMNS: Record<SaleKind, string> = {
  order: "id, status, total, service_fee, fee_absorbed, refund_amount, user_id, user_email, venue_id, event_id",
  ticket: "id, status, total_price, service_fee, insurance_fee, fee_absorbed, refund_amount, user_id, user_email, event_id",
  table_reservation: "id, status, total_price, service_fee, management_fee, deposit, fee_absorbed, refund_amount, user_id, user_email, event_id",
};

/**
 * Remboursement constaté chez Stripe (`charge.refunded`) : la vente enregistre ce
 * que Stripe a réellement rendu, qu'il ait été fait depuis Yuno ou depuis le
 * tableau de bord Stripe du pro (charge directe : le pro peut rembourser seul,
 * depuis son compte).
 *
 * Idempotent par le CUMUL : `charge.amount_refunded` est le total rendu sur la
 * charge ; la vente ne retient que le plus grand cumul vu, par une mise à jour
 * conditionnelle sur l'ancien. Un remboursement fait depuis Yuno a déjà posé
 * son cumul avant d'appeler Stripe : son webhook ne trouve rien de nouveau.
 * Deux livraisons du même événement : la seconde ne gagne rien. Un partiel
 * enregistre son montant et laisse la vente payée ; un total la passe
 * « remboursée » (places rendues, consos annulées, jeton de commande consommé).
 *
 * Lève en cas d'erreur de base : Stripe relivrera l'événement, sans risque.
 */
export async function recordChargeRefund(
  admin: SupabaseClient,
  p: { paymentIntentId: string; chargeAmountCents: number; chargeRefundedCents: number },
): Promise<{ matched: number; recorded: number; completed: number }> {
  const found: { kind: SaleKind; row: SaleRow }[] = [];
  for (const kind of ["order", "ticket", "table_reservation"] as const) {
    const { data, error } = await admin.from(SALE_TABLE[kind])
      .select(SALE_COLUMNS[kind]).eq("stripe_payment_intent_id", p.paymentIntentId);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as SaleRow[]) {
      found.push({ kind, row });
    }
  }

  let recorded = 0;
  let completed = 0;
  // Une vente = un paiement (vérifié en base le 29/09). Si un paiement portait un
  // jour plusieurs ventes, le cumul Stripe ne dirait pas laquelle a été rendue :
  // on ne bascule alors que sur une charge ENTIÈREMENT rendue, sans écrire de montant.
  const single = found.length === 1;
  for (const { kind, row } of found) {
    const already = alreadyRefundedCents(row);
    const plan = single
      ? planChargeRefund(refundCapCents(kind, row), already, p.chargeAmountCents, p.chargeRefundedCents)
      : { cumulativeCents: already, deltaCents: 0, isFull: p.chargeRefundedCents >= p.chargeAmountCents };

    let ctx: SaleRefundContext | null = null;
    const context = async () => (ctx ??= await loadSaleRefundContext(admin, kind, row));

    if (plan.deltaCents > 0) {
      let q = admin.from(SALE_TABLE[kind])
        .update({ refund_amount: fromCents(plan.cumulativeCents), refunded_at: new Date().toISOString() })
        .eq("id", row.id);
      q = row.refund_amount === null || row.refund_amount === undefined
        ? q.is("refund_amount", null)
        : q.eq("refund_amount", row.refund_amount);
      const { data: won, error } = await q.select("id");
      if (error) throw error;
      if (won && won.length > 0) {
        recorded++;
        await applyRefundAmountEffects(admin, await context(), plan.deltaCents, { source: "stripe_dashboard" });
      }
    }

    if (plan.isFull && row.status !== "refunded") {
      if (await markSaleFullyRefunded(admin, kind, row.id)) {
        completed++;
        await applyFullRefundEffects(admin, await context());
      }
    }
  }
  return { matched: found.length, recorded, completed };
}
