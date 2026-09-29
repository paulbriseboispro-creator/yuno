import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import Stripe from "https://esm.sh/stripe@18.5.0";
import { buildRefund } from "../_shared/email-templates.ts";
import { sendAutoPush } from "../_shared/auto-push.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import { alreadyRefundedCents, fromCents, refundCapCents, toCents } from "../_shared/sale-refund.ts";
import {
  applyFullRefundEffects, customerEmailLanguage, decrementCustomerSpent, loadSaleRefundContext,
  refundSaleOnStripe, type SaleRefundContext,
} from "../_shared/sale-refund-effects.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Stripe fee calculation: 1.5% + 0.25€
const STRIPE_PERCENT = 0.015;
const STRIPE_FIXED_CENTS = 25;

function calcStripeFee(totalPriceCents: number): number {
  return (Math.round(totalPriceCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS) / 100;
}

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STAFF-CANCEL] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

  try {
    logStep("Function started");

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { type, id, qrCode, reason, banCustomer, staffId } = body;

    let authenticatedUserId: string | null = null;

    // Identity MUST come from a verified JWT — never from a body field. A prior
    // `staffId` body fallback let any caller holding the public anon key (shipped
    // in the front bundle) impersonate any staff/admin by passing their UUID,
    // which unlocked arbitrary Stripe refunds and customer bans. Removed.
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (!authError && user) {
        authenticatedUserId = user.id;
        logStep("Authenticated via Supabase Auth", { userId: user.id });
      }
    }

    if (!authenticatedUserId) throw new Error('Not authenticated');

    // Accès assisté Yuno : annuler un billet déclenche un remboursement Stripe.
    // Même raison qu'owner-refund — écriture service_role, donc hors de portée
    // des triggers.
    if (await isSupportSessionToken(adminClient, (req.headers.get('Authorization') ?? '').replace('Bearer ', ''))) {
      return new Response(JSON.stringify({ error: 'support_session_forbidden' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
      });
    }


    const { data: roles } = await adminClient
      .from('user_roles').select('role').eq('user_id', authenticatedUserId);
    const allowedRoles = ['bouncer', 'barman', 'owner', 'manager', 'admin', 'organizer'];
    let isAllowed = roles?.some(r => allowedRoles.includes(r.role)) ?? false;

    // Also accept organizer-side bouncer staff (org_staff with role='bouncer')
    if (!isAllowed) {
      const { data: orgStaff } = await adminClient
        .from('org_staff')
        .select('role, invitation_status')
        .eq('user_id', authenticatedUserId)
        .eq('invitation_status', 'accepted')
        .in('role', ['bouncer', 'barman', 'cloakroom']);
      if (orgStaff && orgStaff.length > 0) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      throw new Error('Unauthorized: Staff role required');
    }

    const user = { id: authenticatedUserId };
    if (!type || !['ticket', 'order'].includes(type)) throw new Error('type must be "ticket" or "order"');
    if (!id && !qrCode) throw new Error('Either id or qrCode is required');

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2025-08-27.basil',
    });

    let refundAmount = 0;
    let originalAmount = 0;
    let serviceFee = 0;
    let stripeFee = 0;
    let customerEmail = '';
    let customerUserId = '';
    let customerFirstName = '';
    let customerLastName = '';
    let customerPhone = '';
    let venueId = '';
    // Connected account the charge ran on (DIRECT charge) — null for platform/separate charges.
    let connectedAccountId: string | null = null;
    let venueName = '';
    let eventTitle = '';
    let paymentIntentId = '';
    let ticketId: string | null = null;
    let orderId: string | null = null;
    let cancelledTicketId: string | null = null;
    let scopeEventId: string | null = null;
    // Hors du bloc ticket : ces totaux sont relus après (email, push, réponse).
    // Déclarés dans le bloc, leur lecture en aval levait une ReferenceError sur
    // toute annulation de billet.
    let linkedOrdersCancelled = 0;
    let linkedOrdersRefundTotal = 0;
    // Remboursements Stripe refusés : jamais écrits « remboursé » en silence.
    const refundFailures: { kind: 'ticket' | 'order'; id: string; amount: number; error: string }[] = [];
    let orderLocked = false;
    // Cumul déjà rendu sur la vente avant cette annulation (remboursement partiel
    // antérieur depuis la Console), et contexte pour les statistiques du client.
    let prevRefundCents = 0;
    let saleCtx: SaleRefundContext | null = null;
    // Les ventes liées (consos du billet refusé) remboursées ici, pour les stats.
    const linkedRefunded: { ctx: SaleRefundContext; cents: number }[] = [];

    /**
     * Portée du staff, vérifiée AVANT toute écriture et tout remboursement.
     * Avant, le billet passait « remboursé », les consos liées étaient
     * remboursées sur Stripe et le compteur décrémenté… puis la portée levait
     * — sans rien défaire. Et sur une soirée d'organisateur (venue_id NULL) il
     * n'y avait aucune vérification du tout.
     */
    const isAdmin = roles?.some(r => r.role === 'admin') ?? false;
    const assertInScope = async (eventId: string | null, clubIds: (string | null | undefined)[]) => {
      if (isAdmin) return;
      const clubs = clubIds.filter((v): v is string => !!v);
      const { data: prof } = await adminClient
        .from('profiles').select('venue_id').eq('id', authenticatedUserId).single();
      if (prof?.venue_id && clubs.includes(prof.venue_id)) return;
      if (clubs.length > 0) {
        const { data: owned } = await adminClient
          .from('venues').select('id').in('id', clubs).eq('owner_id', authenticatedUserId).limit(1);
        if (owned && owned.length > 0) return;
      }
      if (eventId) {
        const { data: evt } = await adminClient
          .from('events').select('organizer_user_id, partner_organizer_id').eq('id', eventId).maybeSingle();
        if (evt && (evt.organizer_user_id === authenticatedUserId || evt.partner_organizer_id === authenticatedUserId)) return;
        const { data: doorStaff } = await adminClient.rpc('is_event_door_staff', {
          _user_id: authenticatedUserId, _event_id: eventId,
        });
        if (doorStaff === true) return;
        const { data: partnerStaff } = await adminClient.rpc('is_event_partner_venue_staff', {
          _user_id: authenticatedUserId, _event_id: eventId,
        });
        if (partnerStaff === true) return;
        // Staff opérationnel de l'organisateur (barman, vestiaire) accepté.
        const orgIds = [evt?.organizer_user_id, evt?.partner_organizer_id].filter((v): v is string => !!v);
        if (orgIds.length > 0) {
          const { data: orgLink } = await adminClient
            .from('org_staff').select('user_id')
            .in('organizer_user_id', orgIds)
            .eq('user_id', authenticatedUserId)
            .eq('invitation_status', 'accepted').limit(1);
          if (orgLink && orgLink.length > 0) return;
        }
      }
      logStep("Venue scope denied", { authenticatedUserId, clubs, eventId });
      throw new Error('Unauthorized: not assigned to this venue');
    };

    if (type === 'ticket') {
      let ticketQuery = adminClient
        .from('tickets')
        .select('*, events!inner(id, title, venue_id, partner_venue_id, venues:venue_id(name))');
      if (id) ticketQuery = ticketQuery.eq('id', id);
      else if (qrCode) ticketQuery = ticketQuery.eq('qr_code', qrCode);
      
      const { data: ticket, error: ticketError } = await ticketQuery.single();
      cancelledTicketId = ticket?.id ?? null;
      if (ticketError || !ticket) throw new Error('Ticket not found');
      if (ticket.status !== 'paid') throw new Error('Only paid tickets can be cancelled');
      if (ticket.entry_scanned) throw new Error('Cannot cancel: ticket already scanned for entry');
      await assertInScope(ticket.events?.id ?? null, [ticket.events?.venue_id, ticket.events?.partner_venue_id]);

      ticketId = ticket.id;
      scopeEventId = ticket.events?.id || null;
      venueId = ticket.events.venue_id;
      venueName = ticket.events.venues?.name || '';
      eventTitle = ticket.events.title || '';
      customerEmail = ticket.user_email;
      customerUserId = ticket.user_id;
      customerFirstName = ticket.full_name?.split(' ')[0] || '';
      customerLastName = ticket.full_name?.split(' ').slice(1).join(' ') || '';
      customerPhone = ticket.phone || '';
      paymentIntentId = ticket.stripe_payment_intent_id || '';
      connectedAccountId = (ticket.stripe_connected_account_id as string | null) || null;

      // Remboursement à la porte = plafond côté club (frais Yuno et assurance
      // jamais rendus, comme dans la Console : `refundCapCents`) − frais Stripe,
      // que le club a payés et ne récupère pas − ce qui a déjà été rendu. Avant,
      // l'assurance annulation était rendue en plus, prise sur le compte du club.
      originalAmount = Number(ticket.total_price);
      serviceFee = ticket.fee_absorbed ? 0 : Number(ticket.service_fee || 0);
      stripeFee = calcStripeFee(Math.round(originalAmount * 100));
      prevRefundCents = alreadyRefundedCents(ticket);
      refundAmount = fromCents(Math.max(0, refundCapCents('ticket', ticket) - toCents(stripeFee) - prevRefundCents));

      logStep("Ticket refund calculation", { originalAmount, serviceFee, stripeFee, prevRefundCents, refundAmount });

      // Verrou « premier arrivé » : un videur qui annule pendant qu'un autre
      // scanne, ou deux annulations simultanées → une seule gagne, les autres
      // s'arrêtent AVANT tout remboursement.
      // Conditionné aussi sur le montant lu : un remboursement partiel lancé au
      // même instant depuis la Console ne peut pas être écrasé.
      let claim = adminClient
        .from('tickets')
        .update({
          status: 'refunded',
          cancelled_at: new Date().toISOString(),
          refund_amount: fromCents(prevRefundCents + toCents(refundAmount)),
          refund_reason: reason || null,
          refunded_by: user.id,
        })
        .eq('id', ticket.id)
        .eq('status', 'paid')
        .eq('entry_scanned', false);
      claim = ticket.refund_amount == null ? claim.is('refund_amount', null) : claim.eq('refund_amount', ticket.refund_amount);
      const { data: claimed, error: claimError } = await claim.select('id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) {
        throw new Error('Cannot cancel: ticket was just scanned or cancelled on another device');
      }

      // Le passage à « refunded » vient de rendre les places du billet à la jauge
      // et de supprimer ses crédits boissons (trigger `trg_release_refunded_ticket`).
      saleCtx = await loadSaleRefundContext(adminClient, 'ticket', ticket);

      // === Auto-cancel linked drink orders for same user & event ===
      if (ticket.user_id && ticket.events?.id) {
        try {
          const { data: linkedOrders } = await adminClient
            .from('orders')
            .select('id, total, service_fee, fee_absorbed, refund_amount, stripe_payment_intent_id, stripe_connected_account_id, status, served_at, token_used, user_id, user_email, venue_id, event_id')
            .eq('user_id', ticket.user_id)
            .eq('event_id', ticket.events.id)
            .eq('status', 'paid')
            .is('served_at', null)
            .eq('token_used', false);

          for (const linkedOrder of linkedOrders || []) {
            const orderTotal = Number(linkedOrder.total);
            const orderStripeFee = orderTotal > 0 ? calcStripeFee(Math.round(orderTotal * 100)) : 0;
            const orderPrevCents = alreadyRefundedCents(linkedOrder);
            const orderRefundCents = Math.max(0, refundCapCents('order', linkedOrder) - toCents(orderStripeFee) - orderPrevCents);
            const orderCumulativeCents = orderPrevCents + orderRefundCents;
            const orderRefund = fromCents(orderRefundCents);

            // Verrou AVANT Stripe : jeton consommé (plus servable) et montant
            // posé. Le webhook `charge.refunded` que ce remboursement provoque
            // trouvera le montant déjà enregistré et ne préviendra pas le client
            // une seconde fois.
            let lockLinked = adminClient.from('orders')
              .update({ token_used: true, refund_amount: fromCents(orderCumulativeCents) })
              .eq('id', linkedOrder.id)
              .eq('status', 'paid')
              .eq('token_used', false)
              .is('served_at', null);
            lockLinked = linkedOrder.refund_amount == null
              ? lockLinked.is('refund_amount', null)
              : lockLinked.eq('refund_amount', linkedOrder.refund_amount);
            const { data: lockedLinked } = await lockLinked.select('id');
            if (!lockedLinked || lockedLinked.length === 0) continue;

            // Stripe refund for linked order
            let linkedRefundOk = true;
            if (linkedOrder.stripe_payment_intent_id && orderRefundCents > 0) {
              const linkedAccount = (linkedOrder.stripe_connected_account_id as string | null) || null;
              const linkedRefund = await refundSaleOnStripe(stripe, adminClient, {
                paymentIntentId: linkedOrder.stripe_payment_intent_id,
                amountCents: orderRefundCents,
                connectedAccountId: linkedAccount,
                idempotencyKey: `staff-cancel:order:${linkedOrder.id}:${orderCumulativeCents}`,
                expectedCumulativeCents: orderCumulativeCents,
              });
              if (linkedRefund.ok) {
                logStep("Linked order Stripe refund", { orderId: linkedOrder.id, amount: orderRefund, direct: !!linkedAccount });
              } else {
                logStep("Linked order Stripe refund error", { orderId: linkedOrder.id, error: linkedRefund.error });
                linkedRefundOk = false;
                refundFailures.push({ kind: 'order', id: linkedOrder.id, amount: orderRefund, error: linkedRefund.error });
              }
            }
            // Stripe a refusé : la commande reste payée (et servable) plutôt que
            // d'afficher « remboursée » à un client qui n'a rien reçu.
            if (!linkedRefundOk) {
              await adminClient.from('orders')
                .update({ token_used: false, refund_amount: linkedOrder.refund_amount ?? null })
                .eq('id', linkedOrder.id)
                .eq('status', 'paid');
              continue;
            }

            // Update order status
            const { data: linkedDone } = await adminClient.from('orders').update({
              status: 'refunded',
              archived: true,
              token_used: true,
              served_at: new Date().toISOString(),
              refund_reason: `Auto-cancelled: ticket entry refused${reason ? ` (${reason})` : ''}`,
              refunded_by: user.id,
            }).eq('id', linkedOrder.id).eq('status', 'paid').select('id');

            linkedOrdersCancelled++;
            linkedOrdersRefundTotal += orderRefund;
            if (linkedDone && linkedDone.length > 0) {
              linkedRefunded.push({ ctx: await loadSaleRefundContext(adminClient, 'order', linkedOrder), cents: orderRefundCents });
            }
          }

          if (linkedOrdersCancelled > 0) {
            logStep("Linked orders auto-cancelled", { count: linkedOrdersCancelled, totalRefund: linkedOrdersRefundTotal });
          }
        } catch (linkedErr) {
          console.error("Error cancelling linked orders:", linkedErr);
        }
      }

    } else if (type === 'order') {
      let orderQuery = adminClient
        .from('orders')
        .select('*, venues!inner(id, stripe_account_id, name)');
      if (id) orderQuery = orderQuery.eq('id', id);
      else if (qrCode) orderQuery = orderQuery.eq('token', qrCode);
      
      const { data: order, error: orderError } = await orderQuery.single();
      if (orderError || !order) throw new Error('Order not found');
      if (order.status !== 'paid') throw new Error('Only paid orders can be cancelled');
      if (order.served_at || order.token_used) throw new Error('Cannot cancel: order already served');
      await assertInScope(order.event_id || null, [order.venue_id]);
      // Une seule boisson servie suffit : on ne rembourse pas ici une commande
      // entamée (le remboursement serait total pour une commande à moitié bue).
      const orderItems = Array.isArray(order.items) ? order.items as Array<{ served?: boolean; servedUnits?: boolean[] }> : [];
      if (orderItems.some(it => it?.served === true || (Array.isArray(it?.servedUnits) && it.servedUnits.some(Boolean)))) {
        throw new Error('Cannot cancel: part of this order was already served');
      }
      // Remboursement = plafond côté club − frais Stripe gardés − déjà rendu.
      originalAmount = Number(order.total);
      serviceFee = order.fee_absorbed ? 0 : Number(order.service_fee || 0);
      stripeFee = calcStripeFee(Math.round(originalAmount * 100));
      prevRefundCents = alreadyRefundedCents(order);
      refundAmount = fromCents(Math.max(0, refundCapCents('order', order) - toCents(stripeFee) - prevRefundCents));
      logStep("Order refund calculation", { originalAmount, serviceFee, stripeFee, prevRefundCents, refundAmount });

      // Verrou AVANT Stripe : le jeton est consommé, donc aucun barman ne peut
      // servir cette commande pendant qu'on la rembourse (bar_redeem_units
      // refuse un jeton consommé), et le montant est posé, donc le webhook
      // `charge.refunded` ne rejouera pas ce remboursement. Rendu si Stripe échoue.
      let lock = adminClient
        .from('orders')
        .update({ token_used: true, refund_amount: fromCents(prevRefundCents + toCents(refundAmount)) })
        .eq('id', order.id)
        .eq('status', 'paid')
        .eq('token_used', false);
      lock = order.refund_amount == null ? lock.is('refund_amount', null) : lock.eq('refund_amount', order.refund_amount);
      const { data: locked, error: lockError } = await lock.select('id');
      if (lockError) throw lockError;
      if (!locked || locked.length === 0) {
        throw new Error('Cannot cancel: order was just served or cancelled on another device');
      }
      orderLocked = true;

      orderId = order.id;
      scopeEventId = order.event_id || null;
      venueId = order.venue_id;
      venueName = order.venues?.name || '';
      customerEmail = order.user_email || '';
      customerUserId = order.user_id || '';
      paymentIntentId = order.stripe_payment_intent_id || '';
      connectedAccountId = (order.stripe_connected_account_id as string | null) || null;

      // Fetch event title if available
      if (order.event_id) {
        const { data: evt } = await adminClient.from('events').select('title').eq('id', order.event_id).single();
        eventTitle = evt?.title || '';
      }

      saleCtx = await loadSaleRefundContext(adminClient, 'order', order);
      // NOTE: the order is NOT marked refunded here. For drink orders we refund
      // on Stripe first (blocking) and only then write the refunded status, so a
      // failed refund can never leave a "refunded" order with no money returned.
    }

    // Process Stripe refund.
    let mainRefundOk = true;
    if (paymentIntentId && refundAmount > 0) {
      const expectedCumulativeCents = prevRefundCents + toCents(refundAmount);
      const mainRefund = await refundSaleOnStripe(stripe, adminClient, {
        paymentIntentId,
        amountCents: toCents(refundAmount),
        connectedAccountId,
        idempotencyKey: `staff-cancel:${type}:${ticketId ?? orderId}:${expectedCumulativeCents}`,
        expectedCumulativeCents,
      });
      if (mainRefund.ok) {
        logStep("Stripe refund processed", { paymentIntentId, refundAmount, direct: !!connectedAccountId });
      } else {
        mainRefundOk = false;
        logStep("Stripe refund error", { error: mainRefund.error, type });
        // For drink orders the DB write happens AFTER this, so aborting here
        // leaves the order untouched (still 'paid') — no phantom "refunded".
        if (type === 'order') {
          // Rien n'a été remboursé : la commande redevient servable.
          if (orderLocked && orderId) {
            await adminClient.from('orders')
              .update({ token_used: false, refund_amount: prevRefundCents > 0 ? fromCents(prevRefundCents) : null })
              .eq('id', orderId).eq('status', 'paid');
          }
          throw new Error(`Stripe refund failed, cancellation aborted: ${mainRefund.error}`);
        }
        // Billet : l'entrée est déjà refusée et le billet invalidé (verrou posé
        // plus haut), on ne le ranime pas. Mais l'argent n'est PAS rendu : le
        // montant enregistré revient à ce qui a vraiment été rendu, le client
        // n'est pas prévenu d'un remboursement qui n'a pas eu lieu, et le super
        // admin rembourse à la main — depuis Stripe, le webhook `charge.refunded`
        // enregistrera alors le montant et préviendra le client.
        if (ticketId) {
          await adminClient.from('tickets')
            .update({ refund_amount: prevRefundCents > 0 ? fromCents(prevRefundCents) : null })
            .eq('id', ticketId);
        }
        refundFailures.push({ kind: 'ticket', id: cancelledTicketId ?? String(id ?? qrCode ?? ''), amount: refundAmount, error: mainRefund.error });
      }
    } else {
      logStep("No payment intent - skipping Stripe refund", { paymentIntentId, refundAmount });
    }
    // Montant réellement rendu sur la vente annulée.
    const refundedNow = mainRefundOk ? refundAmount : 0;

    // Money is back (or there was nothing to refund): now record the refund.
    // Guarded by status='paid' so a retry / double-scan can't refund twice.
    if (type === 'order' && orderId) {
      const { data: refundedRows } = await adminClient
        .from('orders')
        .update({
          status: 'refunded',
          served_at: new Date().toISOString(),
          archived: true,
          token_used: true,
          refund_reason: reason || null,
          refunded_by: user.id,
        })
        .eq('id', orderId)
        .eq('status', 'paid')
        .select();
      if (!refundedRows || refundedRows.length === 0) {
        logStep("Order already refunded/served by a concurrent call — skipping", { orderId });
      } else if (saleCtx) {
        await decrementCustomerSpent(adminClient, saleCtx, toCents(refundedNow));
        await applyFullRefundEffects(adminClient, saleCtx);
      }
    }

    // Billet : il est passé « refunded » au verrou (places et crédits rendus par
    // le trigger) ; la dépense du client ne baisse que de ce qui a été rendu.
    if (type === 'ticket' && saleCtx) {
      await decrementCustomerSpent(adminClient, saleCtx, toCents(refundedNow));
      await applyFullRefundEffects(adminClient, saleCtx);
    }
    for (const linked of linkedRefunded) {
      await decrementCustomerSpent(adminClient, linked.ctx, linked.cents);
      await applyFullRefundEffects(adminClient, linked.ctx);
    }

    // Include linked orders info for email
    const linkedRefundAmt = type === 'ticket' ? (linkedOrdersRefundTotal || 0) : 0;
    const totalEmailRefund = refundedNow + linkedRefundAmt;

    // Send refund email — seulement pour de l'argent réellement rendu.
    if (customerEmail && totalEmailRefund > 0) {
      try {
        const lang = await customerEmailLanguage(adminClient, customerUserId);

        const mail = buildRefund({
          lang,
          firstName: customerFirstName || undefined,
          eventTitle: eventTitle || undefined,
          venueName,
          amount: `${totalEmailRefund.toFixed(2)} €`,
          reason: reason || undefined,
        });

        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";

        if (resendApiKey) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: `Yuno <${fromEmail}>`,
              to: [customerEmail],
              subject: mail.subject,
              html: mail.html,
            }),
          });
          logStep("Refund email sent", { to: customerEmail });
        }
      } catch (emailError) {
        console.error("Email error:", emailError);
      }
    }

    // Push remboursement — registre auto (clé 'refund_confirmed') :
    // gate super admin + langue du client + tracking ?an=.
    if (customerUserId && totalEmailRefund > 0) {
      try {
        await sendAutoPush(adminClient, {
          key: 'refund_confirmed',
          userId: customerUserId,
          url: '/my-orders',
          vars: { amount: totalEmailRefund.toFixed(2) },
        });
      } catch (pushError) {
        console.error('Push notification error:', pushError);
      }
    }

    // Create incident record
    if (venueId && customerUserId && reason) {
      try {
        const { data: customerId } = await adminClient.rpc('get_or_create_venue_customer', {
          p_venue_id: venueId, p_user_id: customerUserId, p_email: customerEmail,
          p_first_name: customerFirstName || null, p_last_name: customerLastName || null,
          p_phone: customerPhone || null,
        });

        if (customerId) {
          await adminClient.from('customer_incidents').insert({
            venue_customer_id: customerId, venue_id: venueId, reported_by: user.id,
            incident_type: banCustomer ? 'ban' : 'refund', reason,
            ticket_id: ticketId, order_id: orderId,
            details: `Refund: ${refundAmount.toFixed(2)}€ (service fee kept: ${serviceFee.toFixed(2)}€, stripe fee: ${stripeFee.toFixed(2)}€)`,
          });

          if (banCustomer) {
            await adminClient.from('venue_customers').update({
              is_banned: true, banned_at: new Date().toISOString(),
              banned_by: user.id, ban_reason: reason,
            }).eq('id', customerId);
          }
        }
      } catch (incidentError) {
        logStep("Error creating incident", { error: incidentError });
      }
    }

    // Re-credit loyalty points for orders
    if (type === 'order' && orderId) {
      try {
        const { data: redemption } = await adminClient
          .from('reward_redemptions')
          .select('id, points_spent, customer_loyalty_id, status')
          .eq('order_id', orderId).eq('status', 'used').maybeSingle();

        if (redemption) {
          const { data: currentLoyalty } = await adminClient
            .from('customer_loyalty')
            .select('current_balance, total_points_spent')
            .eq('id', redemption.customer_loyalty_id).single();

          if (currentLoyalty) {
            await adminClient.from('customer_loyalty').update({
              current_balance: currentLoyalty.current_balance + redemption.points_spent,
              total_points_spent: Math.max(0, currentLoyalty.total_points_spent - redemption.points_spent),
            }).eq('id', redemption.customer_loyalty_id);
          }

          await adminClient.from('reward_redemptions').update({ status: 'cancelled' }).eq('id', redemption.id);
          await adminClient.from('loyalty_transactions').insert({
            customer_loyalty_id: redemption.customer_loyalty_id, venue_id: venueId,
            transaction_type: 'adjustment', points: redemption.points_spent,
            description: 'Points re-credited (order refunded)', reference_type: 'refund', reference_id: orderId,
          });
        }
      } catch (loyaltyError) {
        console.error('Error re-crediting loyalty points:', loyaltyError);
      }
    }

    // Re-credit loyalty points for tickets
    if (type === 'ticket' && ticketId && customerUserId && venueId) {
      try {
        const { data: redemption } = await adminClient
          .from('reward_redemptions')
          .select('id, points_spent, customer_loyalty_id, status')
          .eq('ticket_id', ticketId).eq('status', 'used').maybeSingle();

        if (redemption) {
          const { data: currentLoyalty } = await adminClient
            .from('customer_loyalty')
            .select('current_balance, total_points_spent')
            .eq('id', redemption.customer_loyalty_id).single();

          if (currentLoyalty) {
            await adminClient.from('customer_loyalty').update({
              current_balance: currentLoyalty.current_balance + redemption.points_spent,
              total_points_spent: Math.max(0, currentLoyalty.total_points_spent - redemption.points_spent),
            }).eq('id', redemption.customer_loyalty_id);
          }

          await adminClient.from('reward_redemptions').update({ status: 'cancelled' }).eq('id', redemption.id);
          await adminClient.from('loyalty_transactions').insert({
            customer_loyalty_id: redemption.customer_loyalty_id, venue_id: venueId,
            transaction_type: 'adjustment', points: redemption.points_spent,
            description: 'Points re-credited (ticket refunded)', reference_type: 'refund', reference_id: ticketId,
          });
        }
      } catch (loyaltyError) {
        console.error('Error re-crediting loyalty points for ticket:', loyaltyError);
      }
    }

    // Include linked orders in total for ticket cancellations
    const linkedCancelled = type === 'ticket' ? (linkedOrdersCancelled || 0) : 0;
    const linkedRefundTotal = type === 'ticket' ? (linkedOrdersRefundTotal || 0) : 0;
    const totalRefundWithLinked = refundAmount + linkedRefundTotal;

    logStep("Cancellation complete", { type, id, refundAmount, serviceFee, stripeFee, reason, banCustomer, linkedCancelled, linkedRefundTotal });

    if (refundFailures.length > 0) {
      const total = refundFailures.reduce((sum, f) => sum + f.amount, 0);
      await adminClient.rpc('emit_admin_notification', {
        p_type: 'admin_refund_failed',
        p_title: 'Remboursement Stripe refusé',
        p_message: `${total.toFixed(2)} € n'ont pas pu être remboursés par Stripe lors d'une annulation à la porte (${refundFailures.map((f) => `${f.kind} ${f.id}`).join(', ')}) : ${refundFailures[0].error}. À rembourser à la main.`.slice(0, 480),
        p_priority: 'high',
        p_reference_type: refundFailures[0].kind,
        p_reference_id: refundFailures[0].id,
        p_metadata: { failures: refundFailures, cancelled_by: user.id },
        p_dedup_key: `refund_failed:${type}:${refundFailures[0].id}`,
        p_event_id: null,
      }).then(() => undefined, () => undefined);
    }

    return new Response(
      JSON.stringify({ 
        success: true, refundAmount, serviceFee, stripeFee, originalAmount,
        customerBanned: banCustomer || false,
        linkedOrdersCancelled: linkedCancelled,
        linkedOrdersRefundTotal: linkedRefundTotal,
        totalRefundWithLinked,
        refundFailed: refundFailures.length > 0,
        message: `${type === 'ticket' ? 'Billet' : 'Commande'} annulé(e). Remboursement de ${refundAmount.toFixed(2)}€${linkedCancelled > 0 ? ` + ${linkedCancelled} commande(s) liée(s): ${linkedRefundTotal.toFixed(2)}€` : ''} (frais de service: ${serviceFee.toFixed(2)}€, frais Stripe: ${stripeFee.toFixed(2)}€)` 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[STAFF-CANCEL] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
