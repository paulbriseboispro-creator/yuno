import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from 'https://esm.sh/stripe@18.5.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-TABLE-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
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

    const { sessionId, reservationId } = await req.json();
    logStep("Verifying payment", { sessionId, reservationId });

    // Fetch reservation first — a DIRECT-charge session lives on the connected
    // account, so we need the account to retrieve it.
    const { data: reservation, error: reservationError } = await supabaseAdmin
      .from('table_reservations')
      .select('*')
      .eq('id', reservationId)
      .single();

    if (reservationError || !reservation) {
      throw new Error('Reservation not found');
    }

    // Retrieve the session from Stripe. Direct charges live on the connected
    // account → pass { stripeAccount } when the reservation carries one.
    const retrieveOpts = reservation.stripe_connected_account_id
      ? { stripeAccount: reservation.stripe_connected_account_id as string }
      : undefined;
    const session = await stripe.checkout.sessions.retrieve(sessionId, retrieveOpts);
    logStep("Stripe session retrieved", { paymentStatus: session.payment_status, direct: !!retrieveOpts });

    if (session.metadata?.reservationId !== reservationId) {
      throw new Error('Session does not match reservation');
    }

    // If user is authenticated, verify ownership
    if (userId && reservation.user_id && reservation.user_id !== userId) {
      throw new Error('Reservation does not belong to this user');
    }

    if (session.payment_status === 'paid') {
      const { error: updateError } = await supabaseAdmin
        .from('table_reservations')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_session_id: sessionId,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
        })
        .eq('id', reservationId);

      if (updateError) {
        console.error('Error updating reservation:', updateError);
        throw updateError;
      }

      logStep("Reservation marked as paid", { reservationId });

      const effectiveUserId = userId || reservation.user_id;

      const { data: event } = await supabaseAdmin
        .from('events')
        .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
        .eq('id', reservation.event_id)
        .single();

      const resolvedVenueId = event?.venue_id ?? event?.partner_venue_id ?? null;
      const resolvedOrganizerId = event?.organizer_user_id ?? event?.partner_organizer_id ?? null;

      // Create invoice (works for solo + co-events of all kinds)
      if (resolvedVenueId || resolvedOrganizerId) {
        try {
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
                table_reservation_id: reservationId,
                invoice_number: invoiceNumber,
              });
            logStep("Invoice created for table reservation", { invoiceNumber, reservationId, resolvedVenueId, resolvedOrganizerId });
          }
        } catch (invoiceError) {
          console.error('Error creating invoice:', invoiceError);
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

      // Promoter attribution
      const metaPromoterId = session.metadata?.promoterId;
      const metaPromoCode = session.metadata?.promoCode;
      if (metaPromoterId || metaPromoCode) {
        try {
          let resolvedPromoterId = metaPromoterId;
          if (!resolvedPromoterId && metaPromoCode) {
            const { data: pByCode } = await supabaseAdmin
              .from('promoters')
              .select('id')
              .eq('venue_id', event?.venue_id)
              .eq('promo_code', metaPromoCode)
              .eq('is_active', true)
              .maybeSingle();
            resolvedPromoterId = pByCode?.id;
          }
          if (resolvedPromoterId) {
            const { data: convResult } = await supabaseAdmin.rpc('record_promoter_conversion', {
              p_promoter_id: resolvedPromoterId,
              p_conversion_type: 'table',
              p_amount: (reservation.total_price || 0) - (reservation.service_fee || 0),
              p_event_id: reservation.event_id,
              p_table_reservation_id: reservation.id,
            });
            logStep("Promoter conversion recorded", convResult);
          }
        } catch (promoError) {
          console.error('Error recording promoter conversion:', promoError);
        }
      }

      // ── Owner notifications ──────────────────────────────────────────────
      if (resolvedVenueId) {
        try {
          // 1. table_booked — every confirmed reservation
          const packName = reservation.pack_name ?? 'Table VIP';
          const depositFormatted = Number(reservation.deposit ?? reservation.total_price ?? 0).toFixed(2);
          await supabaseAdmin.from('staff_notifications').insert({
            venue_id: resolvedVenueId,
            target_role: 'owner',
            notification_type: 'table_booked',
            title: 'Nouvelle réservation VIP',
            message: `${packName} · ${reservation.full_name ?? 'Client'} · ${reservation.guest_count ?? 1} pers. — ${depositFormatted} €`,
            priority: 'high',
            reference_type: 'table_reservation',
            reference_id: reservationId,
            event_id: reservation.event_id ?? null,
            metadata: {
              pack_name: packName,
              guest_count: reservation.guest_count,
              deposit: reservation.deposit,
              total_price: reservation.total_price,
              full_name: reservation.full_name,
            },
          });

          // 2. Table capacity threshold checks
          if (reservation.event_id) {
            // Count total table capacity and confirmed reservations for this event
            const { data: zones } = await supabaseAdmin
              .from('table_zones')
              .select('id, max_tables')
              .eq('venue_id', resolvedVenueId)
              .eq('event_id', reservation.event_id);

            const totalCapacity = (zones ?? []).reduce((sum: number, z: any) => sum + (z.max_tables ?? 0), 0);

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
        }
      }

      // ── Organizer notifications ──────────────────────────────────────────
      // Mirror of the owner block, into the organizer's own inbox.
      if (resolvedOrganizerId) {
        try {
          const packName = reservation.pack_name ?? 'Table VIP';
          const depositFormatted = Number(reservation.deposit ?? reservation.total_price ?? 0).toFixed(2);
          await supabaseAdmin.from('organizer_notifications').insert({
            organizer_user_id: resolvedOrganizerId,
            notification_type: 'table_booked',
            title: 'Nouvelle réservation VIP',
            message: `${packName} · ${reservation.full_name ?? 'Client'} · ${reservation.guest_count ?? 1} pers. — ${depositFormatted} €`,
            priority: 'high',
            reference_type: 'table_reservation',
            reference_id: reservationId,
            event_id: reservation.event_id ?? null,
            metadata: {
              pack_name: packName,
              guest_count: reservation.guest_count,
              deposit: reservation.deposit,
              total_price: reservation.total_price,
              full_name: reservation.full_name,
            },
          });

          // Table capacity threshold checks (dedup once per event / 24h)
          if (reservation.event_id) {
            const { data: zones } = await supabaseAdmin
              .from('table_zones')
              .select('id, max_tables')
              .eq('event_id', reservation.event_id);
            const totalCapacity = (zones ?? []).reduce((sum: number, z: any) => sum + (z.max_tables ?? 0), 0);

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
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Send VIP email
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-vip-confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ reservation_id: reservationId, type: 'request_received' })
        });
        logStep("VIP request_received email sent");
      } catch (vipEmailError) {
        console.error('Error sending VIP confirmation email:', vipEmailError);
      }

      // Push notification (only for users with IDs)
      let pushSent = false;
      if (effectiveUserId) {
        try {
          const { data: eventForPush } = await supabaseAdmin
            .from('events')
            .select('title')
            .eq('id', reservation.event_id)
            .single();

          const pushResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
            body: JSON.stringify({
              user_id: effectiveUserId,
              payload: {
                title: 'Table confirmée 🥂',
                body: `VIP – ${eventForPush?.title || 'Événement'} – ${reservation.total_price}€`,
                url: '/my-orders?tab=tables'
              }
            })
          });
          if (pushResp.ok) {
            const pushData = await pushResp.json();
            pushSent = (pushData?.sent || 0) > 0;
          }
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
          guestEmail: isGuestReservation ? reservation.user_email : undefined,
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
