import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from 'https://esm.sh/stripe@18.5.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { recordSmsConsent } from '../_shared/sms-consent.ts';
import { sendAutoPush } from '../_shared/auto-push.ts';
import { restrictedCorsHeaders } from '../_shared/cors.ts';
import { metaContextFromStripeMetadata, enqueueMetaEvent, drainMetaOutboxInBackground, resolveEventScopes } from '../_shared/meta-capi.ts';
import { analyticsContextFromStripeMetadata, captureOrderPaid, clubRevenue } from '../_shared/posthog.ts';
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import { issueSaleInvoice } from "../_shared/sale-invoice.ts";
import { receiptTokenMatches } from "../_shared/receipt-token.ts";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-TABLE-PAYMENT] ${step}${detailsStr}`);
};


/**
 * Tables mises en vente pour une soirée : la règle unique de la base, `_event_table_capacity` (migration 20261226110000) —
 * élite : tables du plan liées à une formule ouverte ; basic : somme des tables_count si toutes les formules sont limitées ;
 * 0 = illimité / inconnu (pas d'alerte de remplissage).
 */
async function eventTableCapacity(admin: SupabaseClient, eventId: string): Promise<number> {
  const { data, error } = await admin.rpc('_event_table_capacity', { p_event_id: eventId });
  if (error) {
    console.error('[VERIFY-TABLE-PAYMENT] _event_table_capacity failed:', error.message);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

  try {
    logStep("Function started");

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2025-08-27.basil',
    });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Optional auth
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      try {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (!authError && user) {
          userId = user.id;
          logStep("User authenticated", { userId });
        }
      } catch {
        logStep("No valid auth session — proceeding as guest verification");
      }
    }

    const { sessionId, reservationId, connectedAccount: bodyConnectedAccount, receiptToken } = await req.json();
    logStep("Verifying payment", { sessionId, reservationId });

    // Seul le webhook (clé service) peut indiquer sur quel compte connecté la
    // charge directe est née : jamais une valeur du navigateur.
    const callerToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const isServiceCaller = callerToken !== '' && callerToken === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // Fetch reservation first — a DIRECT-charge session lives on the connected
    // account, so we need the account to retrieve it.
    const { data: reservation, error: reservationError } = await supabaseAdmin
      .from('table_reservations')
      .select('*, table_packs(name)')
      .eq('id', reservationId)
      .single();

    if (reservationError || !reservation) {
      throw new Error('Reservation not found');
    }
    // Nom de la formule pour les notifications (`pack_name` n'existe pas sur la réservation).
    const packName: string = (reservation.table_packs as { name?: string | null } | null)?.name || 'Table VIP';

    // Retrieve the session from Stripe. Direct charges live on the connected
    // account → pass { stripeAccount } when the reservation carries one.
    // Compte de la charge : la colonne de la réservation, sinon (colonne non
    // posée) celui que le webhook a lu dans l'événement / la métadonnée de la session.
    let connectedAccountId: string | null = (reservation.stripe_connected_account_id as string | null) ?? null;
    let connectedAccountFromHint = false;
    if (!connectedAccountId && isServiceCaller && typeof bodyConnectedAccount === 'string' && /^acct_[A-Za-z0-9]+$/.test(bodyConnectedAccount)) {
      connectedAccountId = bodyConnectedAccount;
      connectedAccountFromHint = true;
      logStep("Connected account missing on the reservation — using the webhook hint", { connectedAccountId });
    }
    const retrieveOpts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, retrieveOpts);
    } catch (retrieveErr) {
      if (!connectedAccountId && reservation.status === 'pending') {
        // Charge directe introuvable faute de compte : le client a pu payer sans
        // que personne ne retrouve la session. Alerte super admin (dédoublonnée).
        await supabaseAdmin.rpc('emit_admin_notification', {
          p_type: 'admin_paid_sale_unfulfilled',
          p_title: 'Paiement de table introuvable',
          p_message: `La session Stripe ${sessionId} de la table ${reservationId} est introuvable : le compte connecté n'est pas posé sur la réservation. Si l'acheteur a payé, retrouver le paiement chez Stripe et valider la table à la main ou rembourser.`.slice(0, 480),
          p_priority: 'high',
          p_reference_type: 'table',
          p_reference_id: reservationId,
          p_metadata: { session_id: sessionId, error: (retrieveErr as Error).message },
          p_dedup_key: `paid_unfulfilled:${sessionId}`,
          p_event_id: reservation.event_id ?? null,
        }).then(() => undefined, () => undefined);
      }
      throw retrieveErr;
    }
    logStep("Stripe session retrieved", { paymentStatus: session.payment_status, direct: !!retrieveOpts });
    if (connectedAccountFromHint) {
      // La colonne manquait : on la pose, owner-refund et les rejeux en ont besoin.
      await supabaseAdmin.from('table_reservations')
        .update({ stripe_connected_account_id: connectedAccountId })
        .eq('id', reservationId).is('stripe_connected_account_id', null);
    }

    if (session.metadata?.reservationId !== reservationId) {
      throw new Error('Session does not match reservation');
    }

    // If user is authenticated, verify ownership
    if (userId && reservation.user_id && reservation.user_id !== userId) {
      throw new Error('Reservation does not belong to this user');
    }

    // I4 — secret de reçu : le QR de la table (qui fait entrer toute la table) et l'e-mail de l'acheteur ne sortent que
    // pour le jeton remis au navigateur de l'acheteur par create-table-checkout (hachage gardé sur la réservation), ou pour
    // le titulaire connecté. session_id + reservation_id, eux, traînent dans l'URL de retour Stripe (outils de mesure).
    const receiptAuthorized = (['refunded', 'cancelled'].includes(String(reservation.status)) ? false : (
      await receiptTokenMatches(receiptToken, reservation.receipt_token_hash as string | null)
      || (!!userId && !!reservation.user_id && reservation.user_id === userId)
    ));

    // ── Effets rejouables après paiement (P2.7, migration 20261226100000) ───────────────────────────────────────────────
    // Chaque effet réussi pose un marqueur (table_effects). Un rejeu (webhook, cron) qui trouve la table `paid` avec un
    // marqueur « started » et des effets manquants relance SEULEMENT ceux-là ; les tables payées avant le déploiement n'ont
    // pas de « started » et ne sont jamais rejouées. Les effets restants (facture, stats, Meta, PostHog) ont leurs propres
    // garde-fous (issue-missing-invoices, outbox Meta, idempotence PostHog).
    const effectScope = async () => {
      const { data: ev } = await supabaseAdmin
        .from('events')
        .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
        .eq('id', reservation.event_id)
        .single();
      return {
        event: ev,
        venueId: ev?.venue_id ?? ev?.partner_venue_id ?? null,
        organizerId: ev?.organizer_user_id ?? ev?.partner_organizer_id ?? null,
      };
    };
    const markEffect = async (key: string) => {
      const { error: markErr } = await supabaseAdmin.rpc('table_effect_done', { p_reservation_id: reservationId, p_key: key });
      if (markErr) console.error(`[VERIFY-TABLE-PAYMENT] table_effect_done(${key}):`, markErr.message);
    };
    const runEffect = async (key: string, fn: () => Promise<boolean>) => {
      try {
        if (await fn()) await markEffect(key);
      } catch (effectErr) {
        console.error(`[VERIFY-TABLE-PAYMENT] effect ${key} failed (non-blocking):`, effectErr);
      }
    };
    // Effet « promoter » : attribution du promoteur (la conversion est idempotente côté base : index unique sur la table).
    const effectPromoter = async (): Promise<boolean> => {
      let ok = true;
      const { event } = await effectScope();
      // Promoter attribution
      const metaPromoterId = session.metadata?.promoterId;
      const metaPromoCode = session.metadata?.promoCode;
      if (metaPromoterId || metaPromoCode) {
        try {
          let resolvedPromoterId = metaPromoterId;
          if (!resolvedPromoterId && metaPromoCode) {
            // Même correctif que verify-ticket-payment : périmètre complet
            // (club hôte, club partenaire, organisateur, organisateur partenaire)
            // et comparaison insensible à la casse.
            const scopeOr: string[] = [];
            if (event?.venue_id) scopeOr.push(`venue_id.eq.${event.venue_id}`);
            if (event?.partner_venue_id) scopeOr.push(`venue_id.eq.${event.partner_venue_id}`);
            if (event?.organizer_user_id) scopeOr.push(`organizer_user_id.eq.${event.organizer_user_id}`);
            if (event?.partner_organizer_id) scopeOr.push(`organizer_user_id.eq.${event.partner_organizer_id}`);
            if (scopeOr.length > 0) {
              const { data: pByCode, error: pErr } = await supabaseAdmin
                .from('promoters')
                .select('id')
                .or(scopeOr.join(','))
                .ilike('promo_code', metaPromoCode)
                .eq('is_active', true)
                .limit(1);
              if (pErr) logStep("Promoter lookup failed", { error: pErr.message, metaPromoCode });
              resolvedPromoterId = pByCode?.[0]?.id;
            }
            if (!resolvedPromoterId) logStep("Promoter not resolved from code", { metaPromoCode });
          }
          if (resolvedPromoterId) {
            const metaDiscount = Number(session.metadata?.promoDiscount || 0);
            const { data: convResult, error: convError } = await supabaseAdmin.rpc('record_promoter_conversion', {
              p_promoter_id: resolvedPromoterId,
              p_conversion_type: 'table',
              // Base BRUT (valeur faciale avant remise), cohérent avec les
              // billets. total_price est le NET (la remise a déjà été retirée au
              // checkout) → on rajoute la remise. service_fee vaut toujours 0 sur
              // une résa (le vrai frais est management_fee), donc on ne le
              // soustrait plus. La remise est reportée à part via p_discount.
              p_amount: (reservation.total_price || 0) + metaDiscount,
              p_event_id: reservation.event_id,
              p_table_reservation_id: reservation.id,
              p_discount: metaDiscount,
            });
            if (convError) { logStep("Promoter conversion FAILED", { error: convError.message }); ok = false; }
            else logStep("Promoter conversion recorded", convResult);
          }
        } catch (promoError) {
          console.error('Error recording promoter conversion:', promoError);
          ok = false;
        }
      }

      return ok;
    };
    // Effet « notify » : cloche du club et de l'organisateur (`table_booked` dédoublonné par réservation) + alertes de remplissage.
    const effectNotify = async (): Promise<boolean> => {
      let ok = true;
      const { venueId: resolvedVenueId, organizerId: resolvedOrganizerId } = await effectScope();
      // ── Owner notifications ──────────────────────────────────────────────
      if (resolvedVenueId) {
        try {
          // 1. table_booked — every confirmed reservation
          const depositFormatted = Number(reservation.deposit ?? reservation.total_price ?? 0).toFixed(2);
          await supabaseAdmin.rpc('emit_staff_notification', {
            p_venue_id: resolvedVenueId,
            p_target_role: 'owner',
            p_type: 'table_booked',
            p_title: 'Nouvelle réservation VIP',
            p_message: `${packName} · ${reservation.full_name ?? 'Client'} · ${reservation.guest_count ?? 1} pers. — ${depositFormatted} €`,
            p_priority: 'high',
            p_reference_type: 'table_reservation',
            p_reference_id: reservationId,
            p_event_id: reservation.event_id ?? null,
            // `link: 'vip_service'` : la cloche ouvre le Service VIP de la soirée (visible de tout gestionnaire).
            p_metadata: {
              pack_name: packName,
              guest_count: reservation.guest_count,
              deposit: reservation.deposit,
              total_price: reservation.total_price,
              full_name: reservation.full_name,
              link: 'vip_service',
            },
            p_dedup_key: `table_booked:${reservationId}`,
          });

          // 2. Table capacity threshold checks
          if (reservation.event_id) {
            // Count total table capacity and confirmed reservations for this event
            const totalCapacity = await eventTableCapacity(supabaseAdmin, reservation.event_id);

            if (totalCapacity > 0) {
              const { count: confirmedCount } = await supabaseAdmin
                .from('table_reservations')
                .select('id', { count: 'exact', head: true })
                .eq('event_id', reservation.event_id)
                .in('status', ['paid', 'confirmed']);

              const booked = confirmedCount ?? 0;
              const pct = booked / totalCapacity;

              if (booked >= totalCapacity) {
                const { count: soCount } = await supabaseAdmin
                  .from('staff_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('venue_id', resolvedVenueId)
                  .eq('notification_type', 'tables_sold_out')
                  .eq('event_id', reservation.event_id)
                  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
                if ((soCount ?? 0) === 0) {
                  await supabaseAdmin.from('staff_notifications').insert({
                    venue_id: resolvedVenueId,
                    target_role: 'owner',
                    notification_type: 'tables_sold_out',
                    title: 'Tables VIP épuisées 🥂',
                    message: `Toutes les tables sont réservées pour cette soirée (${booked}/${totalCapacity})`,
                    priority: 'high',
                    reference_type: 'event',
                    reference_id: reservation.event_id,
                    event_id: reservation.event_id,
                    metadata: { booked, total_capacity: totalCapacity },
                  });
                }
              } else if (pct >= 0.8) {
                const { count: warnCount } = await supabaseAdmin
                  .from('staff_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('venue_id', resolvedVenueId)
                  .eq('notification_type', 'tables_warning')
                  .eq('event_id', reservation.event_id)
                  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
                if ((warnCount ?? 0) === 0) {
                  await supabaseAdmin.from('staff_notifications').insert({
                    venue_id: resolvedVenueId,
                    target_role: 'owner',
                    notification_type: 'tables_warning',
                    title: 'Tables VIP presque complètes',
                    message: `${booked}/${totalCapacity} tables réservées (${Math.round(pct * 100)}%)`,
                    priority: 'high',
                    reference_type: 'event',
                    reference_id: reservation.event_id,
                    event_id: reservation.event_id,
                    metadata: { booked, total_capacity: totalCapacity, pct: Math.round(pct * 100) },
                  });
                }
              }
            }
          }

          logStep("Owner notifications sent for table payment");
        } catch (notifErr) {
          console.error('Owner notif error (table):', notifErr);
          ok = false;
        }
      }

      // ── Organizer notifications ──────────────────────────────────────────
      // Mirror of the owner block, into the organizer's own inbox.
      if (resolvedOrganizerId) {
        try {
          const depositFormatted = Number(reservation.deposit ?? reservation.total_price ?? 0).toFixed(2);
          await supabaseAdmin.rpc('emit_organizer_notification', {
            p_organizer_user_id: resolvedOrganizerId,
            p_type: 'table_booked',
            p_title: 'Nouvelle réservation VIP',
            p_message: `${packName} · ${reservation.full_name ?? 'Client'} · ${reservation.guest_count ?? 1} pers. — ${depositFormatted} €`,
            p_priority: 'high',
            p_reference_type: 'table_reservation',
            p_reference_id: reservationId,
            p_event_id: reservation.event_id ?? null,
            p_metadata: {
              pack_name: packName,
              guest_count: reservation.guest_count,
              deposit: reservation.deposit,
              total_price: reservation.total_price,
              full_name: reservation.full_name,
              link: 'vip_service',
            },
            p_dedup_key: `table_booked:${reservationId}`,
          });

          // Table capacity threshold checks (dedup once per event / 24h)
          if (reservation.event_id) {
            const totalCapacity = await eventTableCapacity(supabaseAdmin, reservation.event_id);

            if (totalCapacity > 0) {
              const { count: confirmedCount } = await supabaseAdmin
                .from('table_reservations')
                .select('id', { count: 'exact', head: true })
                .eq('event_id', reservation.event_id)
                .in('status', ['paid', 'confirmed']);
              const booked = confirmedCount ?? 0;
              const pct = booked / totalCapacity;
              const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

              if (booked >= totalCapacity) {
                const { count: soCount } = await supabaseAdmin
                  .from('organizer_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('organizer_user_id', resolvedOrganizerId)
                  .eq('notification_type', 'tables_sold_out')
                  .eq('event_id', reservation.event_id)
                  .gte('created_at', sinceIso);
                if ((soCount ?? 0) === 0) {
                  await supabaseAdmin.from('organizer_notifications').insert({
                    organizer_user_id: resolvedOrganizerId,
                    notification_type: 'tables_sold_out',
                    title: 'Tables VIP épuisées 🥂',
                    message: `Toutes les tables sont réservées pour cette soirée (${booked}/${totalCapacity})`,
                    priority: 'high',
                    reference_type: 'event',
                    reference_id: reservation.event_id,
                    event_id: reservation.event_id,
                    metadata: { booked, total_capacity: totalCapacity },
                  });
                }
              } else if (pct >= 0.8) {
                const { count: warnCount } = await supabaseAdmin
                  .from('organizer_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('organizer_user_id', resolvedOrganizerId)
                  .eq('notification_type', 'tables_warning')
                  .eq('event_id', reservation.event_id)
                  .gte('created_at', sinceIso);
                if ((warnCount ?? 0) === 0) {
                  await supabaseAdmin.from('organizer_notifications').insert({
                    organizer_user_id: resolvedOrganizerId,
                    notification_type: 'tables_warning',
                    title: 'Tables VIP presque complètes',
                    message: `${booked}/${totalCapacity} tables réservées (${Math.round(pct * 100)}%)`,
                    priority: 'high',
                    reference_type: 'event',
                    reference_id: reservation.event_id,
                    event_id: reservation.event_id,
                    metadata: { booked, total_capacity: totalCapacity, pct: Math.round(pct * 100) },
                  });
                }
              }
            }
          }

          logStep("Organizer notifications sent for table payment");
        } catch (notifErr) {
          console.error('Organizer notif error (table):', notifErr);
          ok = false;
        }
      }
      // ─────────────────────────────────────────────────────────────────────
      return ok;
    };
    // Effet « email » : e-mail « confirmée » (QR + Wallet). Déjà parti ou en file (D6) = fait.
    const effectEmail = async (): Promise<boolean> => {
      const { data: already } = await supabaseAdmin.from('sale_email_deliveries')
        .select('sale_id').eq('kind', 'table').eq('sale_id', reservationId).maybeSingle();
      if (already) return true;
      const { data: queued } = await supabaseAdmin.from('sale_email_queue')
        .select('id').eq('kind', 'table').eq('sale_id', reservationId).eq('status', 'pending').limit(1);
      if (queued && queued.length > 0) return true;
      // Bail de 3 min : un autre appelant (webhook relivré, rejeu du cron) est peut-être en train d'envoyer ; l'effet reste « à faire » pour lui.
      const { data: claimed } = await supabaseAdmin.rpc('claim_sale_email_send', { p_kind: 'table', p_sale_id: reservationId });
      if (claimed === false) return false;
      try {
        const mailRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-vip-confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ reservation_id: reservationId, type: 'confirmed' })
        });
        // 2xx = parti, ou mis en file par la fonction (202, D6). Sinon l'effet reste « à faire » : le rejeu le relance.
        const okMail = mailRes.ok;
        await mailRes.body?.cancel();
        if (okMail) logStep("VIP confirmed email sent");
        return okMail;
      } catch (vipEmailError) {
        console.error('Error sending VIP confirmation email:', vipEmailError);
        return false;
      }
    };

    if (session.payment_status === 'paid') {
      // IDEMPOTENCE. On bascule pending/confirmed → paid de façon ATOMIQUE et un
      // seul appelant gagne la transition ; lui seul exécute les effets de bord
      // (facture, stats club, fidélité, conversion promoteur, notifs, email,
      // push). Sans ça, un rechargement de la page de succès OU la délégation du
      // webhook Stripe (qui appelle désormais cette fonction, comme pour les
      // billets) doublait facture + CA + points. La conversion promoteur était
      // déjà protégée par l'index unique sur table_reservation_id, mais pas le
      // reste. Le filtre in('pending','confirmed') empêche aussi de ressusciter
      // une résa 'refunded'/'cancelled'.
      const { data: transitioned, error: updateError } = await supabaseAdmin
        .from('table_reservations')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_session_id: sessionId,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
        })
        .eq('id', reservationId)
        .in('status', ['pending', 'confirmed'])
        .select('id');

      if (updateError) {
        console.error('Error updating reservation:', updateError);
        throw updateError;
      }

      if (!transitioned || transitioned.length === 0) {
        // Déjà traité par un précédent appel (page de succès rechargée, ou webhook
        // + client en course) : on ne rejoue AUCUN effet de bord, mais on répond
        // paid:true pour que la page de confirmation s'affiche normalement.
        logStep("Already processed — skipping side effects (idempotent)", { reservationId });
        // Rejeu (webhook / cron, clé service) d'une table payée il y a plus de 10 min sous le nouveau code : seuls les effets
        // MANQUANTS repartent. Jamais depuis le navigateur (un rechargement de la page de succès ne rejoue rien).
        if (isServiceCaller && String(reservation.status) === 'paid' && reservation.paid_at
            && Date.now() - new Date(String(reservation.paid_at)).getTime() > 10 * 60 * 1000) {
          const { data: doneKeys } = await supabaseAdmin.rpc('table_effects_done', { p_reservation_id: reservationId });
          const done = new Set<string>(Array.isArray(doneKeys) ? (doneKeys as string[]) : []);
          if (done.has('started')) {
            if (!done.has('promoter')) await runEffect('promoter', effectPromoter);
            if (!done.has('notify')) await runEffect('notify', effectNotify);
            if (!done.has('email')) await runEffect('email', effectEmail);
            logStep("Missing effects replayed", { reservationId, alreadyDone: [...done] });
          }
        }
        const isGuestReservation = session.metadata?.isGuest === 'true' || reservation.is_guest === true;
        return new Response(
          JSON.stringify({
            success: true,
            paid: true,
            alreadyProcessed: true,
            // Statut réel : une réservation annulée / remboursée ne se lit jamais « confirmée » sur la page de retour.
            reservationStatus: String(reservation.status),
            isGuest: isGuestReservation,
            guestEmail: isGuestReservation && receiptAuthorized ? reservation.user_email : undefined,
            // Page de confirmation d'un acheteur sans compte : le QR de la table, avec le jeton de reçu seulement.
            qrCode: receiptAuthorized ? (reservation.qr_code ?? undefined) : undefined,
            receiptRequired: receiptAuthorized ? undefined : true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        );
      }

      logStep("Reservation marked as paid", { reservationId });
      await markEffect('started');

      const effectiveUserId = userId || reservation.user_id;

      // Meta Conversions API — `Purchase` serveur (une seule fois, ici sous la
      // transition atomique). Valeur = prix de la réservation (ce que le client
      // s'engage à dépenser), pas seulement l'acompte encaissé. Même event_id
      // que le pixel de la page de succès (`table:<id>`).
      try {
        const metaCtx = metaContextFromStripeMetadata(session.metadata as Record<string, string> | null);
        const scopes = await resolveEventScopes(supabaseAdmin, reservation.event_id);
        const cd = session.customer_details;
        const bookingCents = Math.round(Number(reservation.total_price || 0) * 100);
        await enqueueMetaEvent(supabaseAdmin, {
          eventName: 'Purchase',
          eventId: `table:${reservationId}`,
          eventKind: 'table',
          orderId: reservationId,
          venueIds: scopes.venueIds,
          organizerUserIds: scopes.organizerIds,
          person: {
            email: cd?.email || session.customer_email || reservation.user_email || null,
            phone: cd?.phone || reservation.phone || reservation.guest_phone || null,
            fullName: reservation.full_name || cd?.name || null,
            externalId: effectiveUserId ?? null,
          },
          custom: {
            valueCents: bookingCents > 0 ? bookingCents : (session.amount_total ?? 0),
            currency: session.currency || 'eur',
            contentIds: [reservation.event_id],
            contentName: scopes.title,
            orderId: reservationId,
            numItems: reservation.guest_count || 1,
          },
          ctx: metaCtx,
        });
        drainMetaOutboxInBackground(supabaseAdmin);
      } catch (metaErr) {
        console.error('[META] purchase enqueue failed (non-blocking):', metaErr);
      }

      // PostHog — `order_paid_server` (une fois, sous la même transition).
      // Valeur = prix de la réservation (l'engagement, comme la Console) ;
      // `paid_online` = l'acompte encaissé maintenant.
      captureOrderPaid(supabaseAdmin, {
        pillar: 'tables',
        orderId: reservationId,
        payment: 'stripe',
        eventId: reservation.event_id,
        value: Number(reservation.total_price || 0),
        clubRevenue: clubRevenue.table(reservation),
        paidOnline: (session.amount_total ?? 0) / 100,
        currency: session.currency,
        quantity: reservation.guest_count || 1,
        hasPromoter: !!(session.metadata?.promoterId || session.metadata?.promoCode),
        hasPromoCode: !!session.metadata?.promoCodeId,
        userId: effectiveUserId ?? null,
        buyerEmail: session.customer_details?.email || session.customer_email || reservation.user_email || null,
        ctx: analyticsContextFromStripeMetadata(session.metadata as Record<string, string> | null),
      });

      const { data: event } = await supabaseAdmin
        .from('events')
        .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
        .eq('id', reservation.event_id)
        .single();

      const resolvedVenueId = event?.venue_id ?? event?.partner_venue_id ?? null;
      const resolvedOrganizerId = event?.organizer_user_id ?? event?.partner_organizer_id ?? null;

      // I1 — double vente : si la table demandée / attribuée est déjà tenue par une AUTRE réservation payée avant celle-ci
      // (le paiement est arrivé après que la place a été rendue), la vente ne tombe JAMAIS — l'argent est pris : la
      // réservation passe en placement à l'arrivée, et le pro comme Yuno sont prévenus. Jamais bloquant.
      try {
        const { data: placement, error: placementErr } = await supabaseAdmin.rpc('table_resolve_paid_conflict', { p_reservation_id: reservationId });
        if (placementErr) {
          logStep("table_resolve_paid_conflict failed", { error: placementErr.message });
        } else if (placement && (placement.conflict === true || placement.zone_overflow === true)) {
          logStep("Paid table conflict resolved", placement);
          const isConflict = placement.conflict === true;
          const title = isConflict ? 'Table déjà vendue : placement à l\'arrivée' : 'Zone au-dessus de son plafond';
          const message = (isConflict
            ? `${packName} · ${reservation.full_name ?? 'Client'} a payé alors que la table demandée était déjà vendue : la réservation est conservée, à placer à l'arrivée.`
            : `${packName} · ${reservation.full_name ?? 'Client'} a payé : la zone ${placement.zone_name ?? ''} dépasse son plafond (${placement.zone_used}/${placement.zone_max}).`).slice(0, 480);
          const meta = { reservation_id: reservationId, pack_name: packName, conflict: placement.conflict, tables: placement.tables ?? [], held_by: placement.held_by ?? [], zone_overflow: placement.zone_overflow, zone_used: placement.zone_used, zone_max: placement.zone_max };
          if (resolvedVenueId) {
            await supabaseAdmin.from('staff_notifications').insert({
              venue_id: resolvedVenueId, target_role: 'owner', notification_type: 'table_booked', title, message, priority: 'high',
              reference_type: 'table_reservation', reference_id: reservationId, event_id: reservation.event_id ?? null, metadata: meta,
            });
          }
          if (resolvedOrganizerId) {
            await supabaseAdmin.from('organizer_notifications').insert({
              organizer_user_id: resolvedOrganizerId, notification_type: 'table_booked', title, message, priority: 'high',
              reference_type: 'table_reservation', reference_id: reservationId, event_id: reservation.event_id ?? null, metadata: meta,
            });
          }
          await supabaseAdmin.rpc('emit_admin_notification', {
            p_type: 'admin_paid_sale_unfulfilled',
            p_title: title,
            p_message: message,
            p_priority: 'high',
            p_reference_type: 'table',
            p_reference_id: reservationId,
            p_metadata: meta,
            p_dedup_key: `table_paid_conflict:${reservationId}`,
            p_event_id: reservation.event_id ?? null,
          }).then(() => undefined, () => undefined);
        }
      } catch (conflictErr) {
        console.error('Paid table conflict handling error (non-blocking):', conflictErr);
      }

      // Consentement SMS marketing — même correctif que côté billets : le chemin
      // Stripe live ne l'enregistrait nulle part, seul le mode démo alimentait la
      // liste du club. Profil + liste VIP du club, une seule fois, au paiement.
      if (reservation.sms_opt_in === true) {
        await recordSmsConsent(supabaseAdmin, {
          venueId: resolvedVenueId,
          userId: effectiveUserId,
          phone: reservation.phone || reservation.guest_phone,
          fullName: reservation.full_name,
          email: reservation.user_email,
          eventId: reservation.event_id,
          isVip: true,
          source: 'table_checkout',
        });
        logStep("SMS consent recorded", { reservationId });
      }

      // Facture (soirée seule ou co-soirée) : numéro attribué par la base, une
      // suite par vendeur. Un échec n'arrête pas la vente mais lève une alerte.
      if (resolvedVenueId || resolvedOrganizerId) {
        const invoiceNumber = await issueSaleInvoice(
          supabaseAdmin,
          { kind: 'table', id: reservationId, eventId: reservation.event_id },
          'verify-table-payment',
        );
        if (invoiceNumber) {
          logStep("Invoice created for table reservation", { invoiceNumber, reservationId, resolvedVenueId, resolvedOrganizerId });
        }
      }

      // Venue customer stats (only for users with IDs)
      if (event?.venue_id && effectiveUserId) {
        try {
          await supabaseAdmin.rpc('get_or_create_venue_customer', {
            p_venue_id: event.venue_id,
            p_user_id: effectiveUserId,
            p_email: reservation.user_email || '',
            p_first_name: reservation.full_name?.split(' ')[0] || null,
            p_last_name: reservation.full_name?.split(' ').slice(1).join(' ') || null,
            p_phone: reservation.phone || null,
          });

          await supabaseAdmin.rpc('increment_venue_customer_stats', {
            p_venue_id: event.venue_id,
            p_user_id: effectiveUserId,
            p_order_delta: 0,
            p_ticket_delta: 0,
            p_table_delta: 1,
            p_spent_delta: reservation.total_price || 0,
          });
          logStep("Venue customer stats updated", { venueId: event.venue_id, spent: reservation.total_price });
        } catch (customerError) {
          console.error('Error updating venue customer:', customerError);
        }

        try {
          const { data: pointsAwarded } = await supabaseAdmin.rpc('award_loyalty_points', {
            p_venue_id: event.venue_id,
            p_user_id: effectiveUserId,
            p_amount: reservation.total_price || 0,
            p_reference_type: 'table',
            p_reference_id: reservation.id,
            p_description: 'VIP table reservation'
          });
          if (pointsAwarded && pointsAwarded > 0) {
            logStep("Loyalty points awarded", { points: pointsAwarded });
          }
        } catch (loyaltyError) {
          console.error('Error awarding loyalty points:', loyaltyError);
        }
      }

      await runEffect('promoter', effectPromoter);

      await runEffect('notify', effectNotify);

      // Payé = confirmé : le client reçoit tout de suite l'e-mail « confirmée » (QR + pass Wallet).
      await runEffect('email', effectEmail);

      // Push confirmation table VIP — registre auto (clé 'purchase_table') :
      // gate super admin + texte dans la langue du client + tracking ?an=.
      let pushSent = false;
      if (effectiveUserId) {
        try {
          const { data: eventForPush } = await supabaseAdmin
            .from('events')
            .select('title')
            .eq('id', reservation.event_id)
            .single();

          const pushRes = await sendAutoPush(supabaseAdmin, {
            key: 'purchase_table',
            userId: effectiveUserId,
            url: '/my-orders?tab=tables',
            vars: {
              event: eventForPush?.title || { fr: 'Événement', en: 'Event', es: 'Evento' },
              amount: String(reservation.total_price ?? ''),
            },
          });
          pushSent = pushRes.sent > 0;
          logStep("Push notification sent for table", { pushSent });
        } catch (pushError) {
          console.error('Push notification error:', pushError);
        }
      }

      const isGuestReservation = session.metadata?.isGuest === 'true' || reservation.is_guest === true;

      return new Response(
        JSON.stringify({ 
          success: true, 
          paid: true, 
          pushSent,
          isGuest: isGuestReservation,
          guestEmail: isGuestReservation && receiptAuthorized ? reservation.user_email : undefined,
          // Page de confirmation d'un acheteur sans compte : le QR de la table, avec le jeton de reçu seulement.
          qrCode: receiptAuthorized ? (reservation.qr_code ?? undefined) : undefined,
          receiptRequired: receiptAuthorized ? undefined : true,
          // Pixel Meta navigateur (Purchase dédoublonné avec l'envoi serveur). Valeur = prix de la réservation.
          metaPurchase: { eventId: reservation.event_id, valueCents: Math.round(Number(reservation.total_price || 0) * 100) || (session.amount_total ?? null), currency: session.currency ?? 'eur' },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, paid: false }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in verify-table-payment:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
