import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from 'https://esm.sh/stripe@18.5.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { restrictedCorsHeaders } from '../_shared/cors.ts';

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { sessionId, orderId } = await req.json();

    logStep("Verifying payment", { sessionId, orderId });

    // Try to authenticate user (optional for guest orders)
    let userId: string | null = null;
    try {
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (!authError && user) {
        userId = user.id;
        logStep("User authenticated", { userId });
      }
    } catch {
      logStep("No user auth - checking via Stripe metadata");
    }

    // Fetch order first — a DIRECT-charge session lives on the connected account,
    // so we need the account to retrieve it.
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      throw new Error('Order not found');
    }

    // Retrieve the session from Stripe to validate. Direct charges live on the
    // connected account → pass { stripeAccount } when the order carries one.
    const retrieveOpts = order.stripe_connected_account_id
      ? { stripeAccount: order.stripe_connected_account_id as string }
      : undefined;
    const session = await stripe.checkout.sessions.retrieve(sessionId, retrieveOpts);
    logStep("Stripe session retrieved", { paymentStatus: session.payment_status, direct: !!retrieveOpts });

    // Verify session metadata matches order
    if (session.metadata?.orderId !== orderId) {
      throw new Error('Session does not match order');
    }

    // If user is authenticated, verify ownership
    if (userId && order.user_id !== userId) {
      throw new Error('Order does not belong to this user');
    }

    // Verify payment amount matches order total
    if (session.amount_total !== Math.round(order.total * 100)) {
      throw new Error('Payment amount mismatch');
    }

    if (session.payment_status === 'paid') {
      // Generate token for QR code
      const token = crypto.randomUUID().replace(/-/g, '').substring(0, 16).toUpperCase();
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 12);

      // Update order status to paid using service role
      const { error } = await supabaseAdmin
        .from('orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_session_id: sessionId,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
          token,
          token_expires_at: tokenExpiresAt.toISOString(),
          token_used: false,
        })
        .eq('id', orderId);

      if (error) {
        console.error('Error updating order:', error);
        throw error;
      }

      logStep("Order marked as paid", { orderId, orderNumber: order.order_number });

      // Create invoice — resolve ownership for co-events (venue OR organizer)
      try {
        let resolvedVenueId: string | null = order.venue_id ?? null;
        let resolvedOrganizerId: string | null = null;

        if (order.event_id) {
          const { data: ev } = await supabaseAdmin
            .from('events')
            .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
            .eq('id', order.event_id)
            .maybeSingle();
          if (ev) {
            resolvedVenueId = resolvedVenueId ?? ev.venue_id ?? ev.partner_venue_id ?? null;
            resolvedOrganizerId = ev.organizer_user_id ?? ev.partner_organizer_id ?? null;
          }
        }

        if (resolvedVenueId || resolvedOrganizerId) {
          const { data: invoiceNumber } = await supabaseAdmin.rpc('generate_invoice_number', {
            p_venue_id: resolvedVenueId,
            p_organizer_user_id: resolvedOrganizerId,
          });

          if (invoiceNumber) {
            await supabaseAdmin
              .from('invoice_numbers')
              .insert({
                venue_id: resolvedVenueId,
                organizer_user_id: resolvedOrganizerId,
                order_id: orderId,
                invoice_number: invoiceNumber,
              });

            logStep("Invoice created", { invoiceNumber, resolvedVenueId, resolvedOrganizerId });
          }
        }
      } catch (invoiceError) {
        console.error('Error creating invoice:', invoiceError);
      }

      // Create or update venue customer + award loyalty points
      let pointsEarned = 0;
      
      if (order.venue_id && order.user_id) {
        try {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('first_name, last_name, email')
            .eq('id', order.user_id)
            .single();

          await supabaseAdmin.rpc('get_or_create_venue_customer', {
            p_venue_id: order.venue_id,
            p_user_id: order.user_id,
            p_email: order.user_email || profile?.email,
            p_first_name: order.guest_first_name || profile?.first_name || null,
            p_last_name: order.guest_last_name || profile?.last_name || null,
            p_phone: order.guest_phone || null,
          });

          await supabaseAdmin.rpc('increment_venue_customer_stats', {
            p_venue_id: order.venue_id,
            p_user_id: order.user_id,
            p_order_delta: 1,
            p_ticket_delta: 0,
            p_table_delta: 0,
            p_spent_delta: order.total || 0,
          });

          logStep("Venue customer stats updated", { venueId: order.venue_id, spent: order.total });
        } catch (customerError) {
          console.error('Error creating venue customer:', customerError);
        }

        // Award loyalty points
        try {
          const { data: pointsAwarded } = await supabaseAdmin.rpc('award_loyalty_points', {
            p_venue_id: order.venue_id,
            p_user_id: order.user_id,
            p_amount: order.total,
            p_reference_type: 'order',
            p_reference_id: order.id,
            p_description: 'Drink order'
          });
          
          if (pointsAwarded && pointsAwarded > 0) {
            pointsEarned = pointsAwarded;
            logStep("Loyalty points awarded", { points: pointsAwarded });
          }
        } catch (loyaltyError) {
          console.error('Error awarding loyalty points:', loyaltyError);
        }
      }

      // Get venue details
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('name, address')
        .eq('id', order.venue_id)
        .single();

      // Get user profile
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('first_name, email')
        .eq('id', order.user_id)
        .single();

      const recipientEmail = profile?.email || order.user_email;
      const recipientName = order.guest_first_name || profile?.first_name;

      // Send order confirmation email
      try {
        const emailResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-order-confirmation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({
            orderId: order.id,
            orderNumber: order.order_number,
            email: recipientEmail,
            firstName: recipientName,
            items: order.items,
            total: order.total,
            venueName: venue?.name || 'Our Venue',
            venueAddress: venue?.address,
            isGuest: order.is_guest || false,
          }),
        });
        
        if (emailResponse.ok) {
          logStep("Order confirmation email sent successfully");
        } else {
          const errorText = await emailResponse.text();
          console.error('Failed to send confirmation email:', errorText);
        }
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
      }

      // Owner notification: new drink order paid
      if (order.venue_id) {
        try {
          const itemsSummaryNotif = Array.isArray(order.items)
            ? (order.items as any[]).slice(0, 3).map((i: any) => `${i.quantity}x ${i.name}`).join(', ')
            : 'Commande boissons';
          await supabaseAdmin.from('staff_notifications').insert({
            venue_id: order.venue_id,
            target_role: 'owner',
            notification_type: 'new_order',
            title: 'Nouvelle commande boissons',
            message: `${itemsSummaryNotif}${(order.items as any[])?.length > 3 ? ` +${(order.items as any[]).length - 3}` : ''} — ${Number(order.total).toFixed(2)} €`,
            priority: 'normal',
            reference_type: 'order',
            reference_id: orderId,
            event_id: order.event_id ?? null,
            metadata: { total: order.total, items_count: Array.isArray(order.items) ? (order.items as any[]).length : 0 },
          });
          logStep("Owner notification: new_order");
        } catch (notifErr) { console.error('Owner notif error (new_order):', notifErr); }
      }

      // Send push notification for order confirmation
      let pushSent = false;
      try {
        const itemsSummary = Array.isArray(order.items)
          ? (order.items as any[]).map((i: any) => `${i.quantity}x ${i.name}`).join(', ')
          : 'Commande';
        const pushResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({
            user_id: order.user_id,
            // Confirmation d'achat client : app Yuno uniquement.
            platforms: ['ios'],
            payload: { title: 'Commande confirmée 🍸', body: `${itemsSummary} – Paiement validé.`, url: '/my-orders' }
          })
        });
        if (pushResp.ok) {
          const pushData = await pushResp.json();
          pushSent = (pushData?.sent || 0) > 0;
        }
      } catch (pushErr) { console.error('Push error:', pushErr); }

      return new Response(
        JSON.stringify({ 
          success: true, 
          paid: true, 
          pointsEarned, 
          pushSent, 
          orderNumber: order.order_number,
          isGuest: order.is_guest || false,
          guestEmail: order.is_guest ? order.user_email : undefined,
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
    console.error('Error in verify-payment:', error);
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
