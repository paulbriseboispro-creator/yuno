// Un acheteur qui revient en arrière depuis Stripe sans payer laisse derrière lui
// une réservation « pending » (10 min), un usage de code promo retenu (30 min) et
// une session Stripe encore payable (31 min). Sans nettoyage, sa tentative suivante
// se heurte à ses propres restes : la limite « N billets par personne » compte sa
// réservation en vol comme un billet acheté, et un code à usages limités se croit
// épuisé. Un nouveau checkout REMPLACE donc les essais non payés du même acheteur
// sur la même soirée.
//
// Règle de sécurité : on ne relâche que ce qu'on a PROUVÉ non payé. Une session
// `complete` n'est jamais touchée, et une session illisible (réseau, compte
// inconnu) laisse sa réservation en place — elle expirera seule, comme avant.
import Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { releasePromoRedemption } from "./promo-codes.ts";

// Une réservation sans session liée est peut-être le checkout d'un autre onglet
// en train de se créer : on lui laisse le temps de finir.
const UNLINKED_GRACE_MS = 2 * 60_000;
// Au-delà de la fenêtre de la session Stripe (31 min) plus une marge, il ne reste rien à relâcher.
const LOOKBACK_MS = 40 * 60_000;

export async function releaseAbandonedTicketCheckouts(
  supabase: SupabaseClient,
  opts: {
    eventId: string;
    userId: string | null;
    guestEmail: string | null;
    stripeKey: string;
    /** Compte connecté qui porte les sessions en charge directe, s'il y en a un. */
    stripeAccountId: string | null;
    log: (step: string, details?: Record<string, unknown>) => void;
  },
): Promise<number> {
  const { eventId, userId, guestEmail, stripeKey, stripeAccountId, log } = opts;
  const email = guestEmail?.trim() || null;
  if (!userId && !email) return 0;

  try {
    let query = supabase
      .from("ticket_reservations")
      .select("id, status, stripe_session_id, created_at")
      .eq("event_id", eventId)
      .in("status", ["pending", "expired"])
      .gt("created_at", new Date(Date.now() - LOOKBACK_MS).toISOString());
    query = userId
      ? query.eq("user_id", userId)
      : query.in("guest_email", [email!, email!.toLowerCase()]);
    const { data: rows, error } = await query;
    if (error || !rows?.length) {
      if (error) log("Abandoned checkouts lookup failed", { error: error.message });
      return 0;
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    // Session en charge directe : elle vit sur le compte connecté. Repli sans compte
    // au cas où le mode de règlement a changé depuis la tentative.
    const accountOptions: Array<Stripe.RequestOptions | undefined> = stripeAccountId
      ? [{ stripeAccount: stripeAccountId }, undefined]
      : [undefined];

    let released = 0;
    for (const row of rows as Array<{ id: string; status: string; stripe_session_id: string | null; created_at: string }>) {
      try {
        if (row.stripe_session_id) {
          let session: Stripe.Checkout.Session | null = null;
          let sessionOptions: Stripe.RequestOptions | undefined;
          for (const options of accountOptions) {
            try {
              session = await stripe.checkout.sessions.retrieve(row.stripe_session_id, undefined, options);
              sessionOptions = options;
              break;
            } catch (_) { /* on essaie l'autre compte */ }
          }
          if (!session) continue; // illisible : on ne devine pas
          if (session.status === "complete" || session.payment_status === "paid") continue; // payé
          if (session.status === "open") {
            try {
              await stripe.checkout.sessions.expire(row.stripe_session_id, undefined, sessionOptions);
            } catch (_) {
              // Payée entre-temps ? On relit avant de décider.
              const again = await stripe.checkout.sessions.retrieve(row.stripe_session_id, undefined, sessionOptions);
              if (again.status !== "expired") continue;
            }
          }
          await releasePromoRedemption(supabase, session.metadata?.promoRedemptionId || null);
        } else if (Date.now() - new Date(row.created_at).getTime() < UNLINKED_GRACE_MS) {
          continue;
        }

        if (row.status === "pending") {
          await supabase.rpc("cancel_ticket_reservation", { _reservation_id: row.id });
        }
        released++;
      } catch (e) {
        log("Abandoned checkout release failed", { reservationId: row.id, error: String(e) });
      }
    }
    if (released > 0) log("Abandoned checkouts released", { released });
    return released;
  } catch (e) {
    // Le nettoyage ne doit jamais empêcher un achat : au pire, l'ancien délai s'applique.
    log("Abandoned checkouts cleanup failed", { error: String(e) });
    return 0;
  }
}
