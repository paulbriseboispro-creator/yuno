import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import Stripe from "https://esm.sh/stripe@18.5.0";
import { type EmailLanguage } from "../_shared/email-branding.ts";
import { buildRefund } from "../_shared/email-templates.ts";

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

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STAFF-CANCEL] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { type, id, qrCode, reason, banCustomer, staffId } = body;

    let authenticatedUserId: string | null = null;

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

    if (!authenticatedUserId && staffId) {
      const { data: staffProfile } = await adminClient
        .from('profiles').select('id').eq('id', staffId).single();
      if (staffProfile) {
        authenticatedUserId = staffId;
        logStep("Authenticated via staffId fallback", { staffId });
      }
    }

    if (!authenticatedUserId) throw new Error('Not authenticated');

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
    let scopeEventId: string | null = null;

    if (type === 'ticket') {
      let ticketQuery = adminClient
        .from('tickets')
        .select('*, ticket_rounds(id, tickets_sold, event_id), events!inner(id, title, venue_id, venues:venue_id(name))');
      if (id) ticketQuery = ticketQuery.eq('id', id);
      else if (qrCode) ticketQuery = ticketQuery.eq('qr_code', qrCode);
      
      const { data: ticket, error: ticketError } = await ticketQuery.single();
      if (ticketError || !ticket) throw new Error('Ticket not found');
      if (ticket.status !== 'paid') throw new Error('Only paid tickets can be cancelled');
      if (ticket.entry_scanned) throw new Error('Cannot cancel: ticket already scanned for entry');

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

      // New formula: refund = (totalPrice - serviceFee) - stripeFee
      originalAmount = Number(ticket.total_price);
      // Absorbed commission was paid by the club, not the fan → fully refundable.
      serviceFee = ticket.fee_absorbed ? 0 : Number(ticket.service_fee || 0);
      const refundableAmount = originalAmount - serviceFee;
      stripeFee = calcStripeFee(Math.round(originalAmount * 100));
      refundAmount = Math.round(Math.max(0, refundableAmount - stripeFee) * 100) / 100;

      logStep("Ticket refund calculation", { originalAmount, serviceFee, stripeFee, refundableAmount, refundAmount });

      await adminClient
        .from('tickets')
        .update({
          status: 'refunded',
          cancelled_at: new Date().toISOString(),
          refund_amount: refundAmount,
          refund_reason: reason || null,
          refunded_by: user.id,
        })
        .eq('id', ticket.id);

      try {
        await adminClient.from('order_pack_credits').delete().eq('ticket_order_id', ticket.id);
        await adminClient.from('ticket_upsell_selections').update({ status: 'cancelled' }).eq('ticket_id', ticket.id);
      } catch (e) { console.error("Error deleting drink credits:", e); }

      // === Auto-cancel linked drink orders for same user & event ===
      let linkedOrdersCancelled = 0;
      let linkedOrdersRefundTotal = 0;
      if (ticket.user_id && ticket.events?.id) {
        try {
          const { data: linkedOrders } = await adminClient
            .from('orders')
            .select('id, total, service_fee, fee_absorbed, stripe_payment_intent_id, stripe_connected_account_id, status, served_at, token_used')
            .eq('user_id', ticket.user_id)
            .eq('event_id', ticket.events.id)
            .eq('status', 'paid')
            .is('served_at', null)
            .eq('token_used', false);

          for (const linkedOrder of linkedOrders || []) {
            const orderTotal = Number(linkedOrder.total);
            const orderServiceFee = linkedOrder.fee_absorbed ? 0 : Number(linkedOrder.service_fee || 0);
            const orderStripeFee = orderTotal > 0 ? calcStripeFee(Math.round(orderTotal * 100)) : 0;
            const orderRefund = Math.round(Math.max(0, orderTotal - orderServiceFee - orderStripeFee) * 100) / 100;

            // Stripe refund for linked order
            if (linkedOrder.stripe_payment_intent_id && orderRefund > 0) {
              try {
                const linkedAccount = (linkedOrder.stripe_connected_account_id as string | null) || null;
                await stripe.refunds.create({
                  payment_intent: linkedOrder.stripe_payment_intent_id,
                  amount: Math.round(orderRefund * 100),
                  ...(linkedAccount ? {} : { reverse_transfer: true }),
                  refund_application_fee: false,
                }, linkedAccount ? { stripeAccount: linkedAccount } : undefined);
                logStep("Linked order Stripe refund", { orderId: linkedOrder.id, amount: orderRefund, direct: !!linkedAccount });
              } catch (stripeErr: any) {
                logStep("Linked order Stripe refund error", { orderId: linkedOrder.id, error: stripeErr.message });
              }
            }

            // Update order status
            await adminClient.from('orders').update({
              status: 'refunded',
              archived: true,
              token_used: true,
              served_at: new Date().toISOString(),
              refund_amount: orderRefund,
              refund_reason: `Auto-cancelled: ticket entry refused${reason ? ` (${reason})` : ''}`,
              refunded_by: user.id,
            }).eq('id', linkedOrder.id);

            linkedOrdersCancelled++;
            linkedOrdersRefundTotal += orderRefund;
          }

          if (linkedOrdersCancelled > 0) {
            logStep("Linked orders auto-cancelled", { count: linkedOrdersCancelled, totalRefund: linkedOrdersRefundTotal });
          }
        } catch (linkedErr) {
          console.error("Error cancelling linked orders:", linkedErr);
        }
      }

      if (ticket.ticket_rounds) {
        await adminClient
          .from('ticket_rounds')
          .update({ tickets_sold: Math.max(0, ticket.ticket_rounds.tickets_sold - ticket.quantity) })
          .eq('id', ticket.ticket_round_id);
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

      // New formula: refund = (total - serviceFee) - stripeFee
      originalAmount = Number(order.total);
      // Absorbed commission was paid by the club, not the fan → fully refundable.
      serviceFee = order.fee_absorbed ? 0 : Number(order.service_fee || 0);
      const refundableAmount = originalAmount - serviceFee;
      stripeFee = calcStripeFee(Math.round(originalAmount * 100));
      refundAmount = Math.round(Math.max(0, refundableAmount - stripeFee) * 100) / 100;

      logStep("Order refund calculation", { originalAmount, serviceFee, stripeFee, refundableAmount, refundAmount });
      // NOTE: the order is NOT marked refunded here. For drink orders we refund
      // on Stripe first (blocking) and only then write the refunded status, so a
      // failed refund can never leave a "refunded" order with no money returned.
    }

    // Venue scoping: a staff member may only cancel/refund items that belong to
    // their own venue. Without this, a barman from one club could refund another
    // club's order. Allowed: platform admins, the venue owner, club-scope staff
    // (profiles.venue_id), and the organizer (or accepted org_staff) of the
    // linked event for org-run events hosted at a partner venue.
    {
      const isAdmin = roles?.some(r => r.role === 'admin') ?? false;
      if (!isAdmin && venueId) {
        let belongsToVenue = false;

        const { data: prof } = await adminClient
          .from('profiles').select('venue_id').eq('id', authenticatedUserId).single();
        if (prof?.venue_id && prof.venue_id === venueId) belongsToVenue = true;

        if (!belongsToVenue) {
          const { data: ownedVenue } = await adminClient
            .from('venues').select('id').eq('id', venueId).eq('owner_id', authenticatedUserId).maybeSingle();
          if (ownedVenue) belongsToVenue = true;
        }

        if (!belongsToVenue && scopeEventId) {
          const { data: evt } = await adminClient
            .from('events').select('organizer_user_id').eq('id', scopeEventId).maybeSingle();
          if (evt?.organizer_user_id === authenticatedUserId) {
            belongsToVenue = true;
          } else if (evt?.organizer_user_id) {
            const { data: orgLink } = await adminClient
              .from('org_staff').select('user_id')
              .eq('organizer_user_id', evt.organizer_user_id)
              .eq('user_id', authenticatedUserId)
              .eq('invitation_status', 'accepted').limit(1);
            if (orgLink && orgLink.length > 0) belongsToVenue = true;
          }
        }

        if (!belongsToVenue) {
          logStep("Venue scope denied", { authenticatedUserId, venueId, scopeEventId });
          throw new Error('Unauthorized: not assigned to this venue');
        }
      }
    }

    // Process Stripe refund.
    if (paymentIntentId && refundAmount > 0) {
      try {
        const refundAmountCents = Math.round(refundAmount * 100);
        // DIRECT charge → refund on the connected account (no transfer to reverse).
        // SEPARATE/platform charge → refund on the platform and reverse the transfers.
        await stripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: refundAmountCents,
          ...(connectedAccountId ? {} : { reverse_transfer: true }),
          refund_application_fee: false,
        }, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined);
        logStep("Stripe refund processed", { paymentIntentId, refundAmountCents, direct: !!connectedAccountId });
      } catch (stripeError: any) {
        logStep("Stripe refund error", { error: stripeError.message, type });
        // For drink orders the DB write happens AFTER this, so aborting here
        // leaves the order untouched (still 'paid') — no phantom "refunded".
        if (type === 'order') {
          throw new Error(`Stripe refund failed, cancellation aborted: ${stripeError.message}`);
        }
        // Ticket path keeps its existing (pre-write) behaviour to avoid
        // destabilising the entry-refusal + linked-orders flow.
      }
    } else {
      logStep("No payment intent - skipping Stripe refund", { paymentIntentId, refundAmount });
    }

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
          refund_amount: refundAmount,
          refund_reason: reason || null,
          refunded_by: user.id,
        })
        .eq('id', orderId)
        .eq('status', 'paid')
        .select();
      if (!refundedRows || refundedRows.length === 0) {
        logStep("Order already refunded/served by a concurrent call — skipping", { orderId });
      }
    }

    // Include linked orders info for email
    const linkedRefundAmt = type === 'ticket' ? (linkedOrdersRefundTotal || 0) : 0;
    const totalEmailRefund = refundAmount + linkedRefundAmt;

    // Send refund email
    if (customerEmail) {
      try {
        const lang: EmailLanguage = "fr";

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

    // Send push notification
    if (customerUserId) {
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({
            user_id: customerUserId,
            payload: {
              title: 'Remboursement traité 💸',
              body: `${refundAmount.toFixed(2)}€ remboursés sur ton moyen de paiement.`,
              url: '/my-orders'
            }
          })
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

    return new Response(
      JSON.stringify({ 
        success: true, refundAmount, serviceFee, stripeFee, originalAmount,
        customerBanned: banCustomer || false,
        linkedOrdersCancelled: linkedCancelled,
        linkedOrdersRefundTotal: linkedRefundTotal,
        totalRefundWithLinked,
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
