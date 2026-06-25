import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from 'https://esm.sh/stripe@18.5.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { restrictedCorsHeaders } from '../_shared/cors.ts';

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-TICKET-PAYMENT] ${step}${detailsStr}`);
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

    // Optional auth — guests won't have a session
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

    const { sessionId, ticketId } = await req.json();
    logStep("Verifying payment", { sessionId, ticketId });

    // Fetch ticket first (works for both guest and authenticated) — a DIRECT-charge
    // session lives on the connected account, so we need the account to retrieve it.
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (ticketError || !ticket) {
      throw new Error('Ticket not found');
    }

    // Retrieve the session from Stripe to validate. Direct charges live on the
    // connected account → pass { stripeAccount } when the ticket carries one.
    const retrieveOpts = ticket.stripe_connected_account_id
      ? { stripeAccount: ticket.stripe_connected_account_id as string }
      : undefined;
    const session = await stripe.checkout.sessions.retrieve(sessionId, retrieveOpts);
    logStep("Stripe session retrieved", { paymentStatus: session.payment_status, direct: !!retrieveOpts });

    // Verify session metadata matches ticket
    if (session.metadata?.ticketId !== ticketId) {
      throw new Error('Session does not match ticket');
    }

    // If user is authenticated, verify ownership (skip for guests)
    if (userId && ticket.user_id && ticket.user_id !== userId) {
      throw new Error('Ticket does not belong to this user');
    }

    if (session.payment_status === 'paid') {
      // ATOMIC IDEMPOTENCY LOCK. Only the caller that actually flips the ticket
      // from 'pending' to 'paid' is allowed to run the side effects below
      // (tickets_sold increment, drink credits, invoice, loyalty, stats,
      // promoter conversion, owner notifications, email, push). A page reload,
      // or the Stripe webhook fallback racing the client, finds the ticket
      // already 'paid', the conditional UPDATE returns no row, and we skip them.
      // Without this guard, reloading the success page double-counted revenue and
      // handed out duplicate free drinks / loyalty points / invoices.
      const { data: transitioned, error: updateError } = await supabaseAdmin
        .from('tickets')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_session_id: sessionId,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
        })
        .eq('id', ticketId)
        .eq('status', 'pending')
        .select('id');

      if (updateError) {
        console.error('Error updating ticket:', updateError);
        throw updateError;
      }

      const didTransition = Array.isArray(transitioned) && transitioned.length > 0;
      const isGuestTicket = session.metadata?.isGuest === 'true' || ticket.is_guest === true;
      const effectiveUserId = userId || ticket.user_id;
      let pushSent = false;

      logStep(
        didTransition
          ? "Ticket marked as paid"
          : "Ticket already processed — skipping side effects (idempotent)",
        { ticketId, didTransition },
      );

      // ── Side effects: run EXACTLY ONCE, gated by the atomic transition above ──
      if (didTransition) {

      // Create free drink credits if ticket round includes_drink
      try {
        const { data: ticketRound } = await supabaseAdmin
          .from('ticket_rounds')
          .select('includes_drink')
          .eq('id', ticket.ticket_round_id)
          .single();

        if (ticketRound?.includes_drink && effectiveUserId) {
          const metaEventIdForDrink = session.metadata?.eventId || ticket.event_id;
          const metaVenueIdForDrink = session.metadata?.venueId;
          
          let drinkMode = 'credits';
          if (metaVenueIdForDrink) {
            const { data: venueForDrink } = await supabaseAdmin
              .from('venues')
              .select('free_drink_mode')
              .eq('id', metaVenueIdForDrink)
              .single();
            drinkMode = venueForDrink?.free_drink_mode || 'credits';
          }

          if (drinkMode === 'credits') {
            // Bind the credit to the event night: expire at the event end, or
            // (no end_at) 8h after it starts. Never leave this NULL — a NULL
            // expiry makes the credit unredeemable (cart/use-drink-credit both
            // require expires_at > now()) while still showing on the orders page.
            let drinkExpiresAt: string | null = null;
            if (metaEventIdForDrink) {
              const { data: eventForDrink } = await supabaseAdmin
                .from('events')
                .select('start_at, end_at')
                .eq('id', metaEventIdForDrink)
                .single();
              drinkExpiresAt = eventForDrink?.end_at
                || (eventForDrink?.start_at
                  ? new Date(new Date(eventForDrink.start_at).getTime() + 8 * 60 * 60 * 1000).toISOString()
                  : null);
            }

            if (metaVenueIdForDrink) {
              await supabaseAdmin
                .from('order_pack_credits')
                .insert({
                  user_id: effectiveUserId,
                  venue_id: metaVenueIdForDrink,
                  pack_id: '00000000-0000-0000-0000-000000000001',
                  ticket_order_id: ticketId,
                  total_credits: ticket.quantity,
                  used_credits: 0,
                  event_id: metaEventIdForDrink || null,
                  expires_at: drinkExpiresAt,
                });
              logStep("Free drink credits created", { ticketId, credits: ticket.quantity });
            }
          } else {
            logStep("Free drink credits skipped (bouncer_notify mode)", { ticketId });
          }
        }
      } catch (drinkCreditError) {
        console.error('Error creating free drink credits:', drinkCreditError);
      }

      // Upsells. Fall back to the ticket's own event so pack credits stay bound
      // to the soirée even if checkout metadata omitted eventId.
      const upsellsJson = session.metadata?.upsells;
      const metaEventId = session.metadata?.eventId || ticket.event_id;
      const metaVenueId = session.metadata?.venueId;

      if (upsellsJson) {
        try {
          const upsells = JSON.parse(upsellsJson) as Array<{ id: string; t: string; p: number; d: number; n: string }>;

          let expiresAt: string | null = null;
          if (metaEventId) {
            const { data: eventForExpiry } = await supabaseAdmin
              .from('events')
              .select('start_at, end_at')
              .eq('id', metaEventId)
              .single();
            expiresAt = eventForExpiry?.end_at
              || (eventForExpiry?.start_at
                ? new Date(new Date(eventForExpiry.start_at).getTime() + 8 * 60 * 60 * 1000).toISOString()
                : null);
          }

          for (const upsell of upsells) {
            await supabaseAdmin
              .from('ticket_upsell_selections')
              .insert({
                ticket_id: ticketId,
                offer_id: upsell.id,
                offer_type: upsell.t,
                quantity: 1,
                unit_price: upsell.p,
                total_price: upsell.p,
                credits_remaining: upsell.d > 0 ? upsell.d : null,
              });
            logStep("Upsell selection created after payment", { offerId: upsell.id, type: upsell.t });

            if ((upsell.t === 'drink_pack' || upsell.t === 'single_drink_discount' || upsell.t === 'combo') && upsell.d > 0 && metaVenueId && effectiveUserId) {
              await supabaseAdmin
                .from('order_pack_credits')
                .insert({
                  user_id: effectiveUserId,
                  venue_id: metaVenueId,
                  pack_id: upsell.id,
                  ticket_order_id: ticketId,
                  total_credits: upsell.d,
                  used_credits: 0,
                  event_id: metaEventId || null,
                  expires_at: expiresAt,
                });
              logStep("Pack credits created after payment", { offerId: upsell.id, credits: upsell.d });
            }
          }
        } catch (upsellError) {
          console.error('Error creating upsell selections after payment:', upsellError);
        }
      } else {
        const packId = session.metadata?.packId;
        const packDrinkCount = session.metadata?.packDrinkCount;
        
        if (packId && packDrinkCount && metaVenueId && effectiveUserId) {
          try {
            let expiresAt: string | null = null;
            if (metaEventId) {
              const { data: eventForExpiry } = await supabaseAdmin
                .from('events')
                .select('start_at, end_at')
                .eq('id', metaEventId)
                .single();
              expiresAt = eventForExpiry?.end_at
                || (eventForExpiry?.start_at
                  ? new Date(new Date(eventForExpiry.start_at).getTime() + 8 * 60 * 60 * 1000).toISOString()
                  : null);
            }

            await supabaseAdmin
              .from('order_pack_credits')
              .insert({
                user_id: effectiveUserId,
                venue_id: metaVenueId,
                pack_id: packId,
                ticket_order_id: ticketId,
                total_credits: parseInt(packDrinkCount),
                used_credits: 0,
                event_id: metaEventId || null,
                expires_at: expiresAt,
              });
            logStep("Legacy pack credits created after payment", { packId, credits: packDrinkCount });
          } catch (packError) {
            console.error('Error creating legacy pack credits:', packError);
          }
        }
      }

      // Get event to resolve invoice ownership (venue OR organizer for co-events)
      const { data: event } = await supabaseAdmin
        .from('events')
        .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
        .eq('id', ticket.event_id)
        .single();

      // Resolve effective venue + organizer (works for solo, co-event club-led, and co-event organizer-led)
      const resolvedVenueId = event?.venue_id ?? event?.partner_venue_id ?? null;
      const resolvedOrganizerId = event?.organizer_user_id ?? event?.partner_organizer_id ?? null;

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
                ticket_id: ticketId,
                invoice_number: invoiceNumber,
              });

            logStep("Invoice created for ticket", { invoiceNumber, ticketId, resolvedVenueId, resolvedOrganizerId });
          }
        } catch (invoiceError) {
          console.error('Error creating invoice:', invoiceError);
        }
      }

      // Create or update venue customer and increment stats (only for authenticated users)
      if (event?.venue_id && effectiveUserId) {
        try {
          await supabaseAdmin.rpc('get_or_create_venue_customer', {
            p_venue_id: event.venue_id,
            p_user_id: effectiveUserId,
            p_email: ticket.user_email || '',
            p_first_name: ticket.full_name?.split(' ')[0] || null,
            p_last_name: ticket.full_name?.split(' ').slice(1).join(' ') || null,
            p_phone: ticket.phone || null,
          });

          await supabaseAdmin.rpc('increment_venue_customer_stats', {
            p_venue_id: event.venue_id,
            p_user_id: effectiveUserId,
            p_order_delta: 0,
            p_ticket_delta: 1,
            p_table_delta: 0,
            p_spent_delta: ticket.total_price || 0,
          });

          logStep("Venue customer stats updated", { venueId: event.venue_id, spent: ticket.total_price });
        } catch (customerError) {
          console.error('Error updating venue customer:', customerError);
        }

        // Award loyalty points
        try {
          const { data: pointsAwarded } = await supabaseAdmin.rpc('award_loyalty_points', {
            p_venue_id: event.venue_id,
            p_user_id: effectiveUserId,
            p_amount: ticket.total_price || 0,
            p_reference_type: 'ticket',
            p_reference_id: ticket.id,
            p_description: 'Ticket purchase'
          });
          
          if (pointsAwarded && pointsAwarded > 0) {
            logStep("Loyalty points awarded", { points: pointsAwarded });
          }
        } catch (loyaltyError) {
          console.error('Error awarding loyalty points:', loyaltyError);
        }
      }

      // Increment tickets_sold via atomic confirmation of the reservation (anti-oversell)
      // Falls back to direct increment if no reservation_id (legacy tickets created before PR3)
      if (ticket.reservation_id) {
        const { error: confirmErr } = await supabaseAdmin.rpc('confirm_ticket_reservation', {
          _reservation_id: ticket.reservation_id,
        });
        if (confirmErr) {
          // Non-blocking: payment is already done, log and continue. We must not refund silently here.
          console.error('[VERIFY-TICKET-PAYMENT] confirm_ticket_reservation failed:', confirmErr);
          logStep("Reservation confirm failed — falling back to direct increment", {
            reservationId: ticket.reservation_id,
            error: confirmErr.message,
          });
          const { data: roundData } = await supabaseAdmin
            .from('ticket_rounds')
            .select('tickets_sold')
            .eq('id', ticket.ticket_round_id)
            .single();
          if (roundData) {
            await supabaseAdmin
              .from('ticket_rounds')
              .update({ tickets_sold: (roundData.tickets_sold || 0) + ticket.quantity })
              .eq('id', ticket.ticket_round_id);
          }
        } else {
          logStep("Reservation confirmed atomically", { reservationId: ticket.reservation_id });
        }
      } else {
        // Legacy path (ticket created before PR3 was deployed)
        const { data: roundData } = await supabaseAdmin
          .from('ticket_rounds')
          .select('tickets_sold')
          .eq('id', ticket.ticket_round_id)
          .single();

        if (roundData) {
          await supabaseAdmin
            .from('ticket_rounds')
            .update({ tickets_sold: (roundData.tickets_sold || 0) + ticket.quantity })
            .eq('id', ticket.ticket_round_id);
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
              p_conversion_type: 'ticket',
              p_amount: (ticket.unit_price || 0) * (ticket.quantity || 1),
              p_event_id: ticket.event_id,
              p_ticket_id: ticket.id,
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
          // 1. ticket_sale — every paid ticket
          const roundName = session.metadata?.roundName ?? 'Billet';
          const qty = ticket.quantity ?? 1;
          const totalPriceFormatted = Number(ticket.total_price ?? 0).toFixed(2);
          await supabaseAdmin.from('staff_notifications').insert({
            venue_id: resolvedVenueId,
            target_role: 'owner',
            notification_type: 'ticket_sale',
            title: 'Nouveau billet vendu',
            message: `${qty}x ${roundName} — ${totalPriceFormatted} €${ticket.full_name ? ` · ${ticket.full_name}` : ''}`,
            priority: 'normal',
            reference_type: 'ticket',
            reference_id: ticketId,
            event_id: ticket.event_id ?? null,
            metadata: { quantity: qty, total_price: ticket.total_price, round_name: roundName },
          });

          // 2. promoter_sale — if attributed to a promoter
          if (session.metadata?.promoterId || session.metadata?.promoCode) {
            await supabaseAdmin.from('staff_notifications').insert({
              venue_id: resolvedVenueId,
              target_role: 'owner',
              notification_type: 'promoter_sale',
              title: 'Vente via promoteur',
              message: `${qty}x ${roundName} — ${totalPriceFormatted} € · code "${session.metadata?.promoCode ?? ''}"`,
              priority: 'low',
              reference_type: 'ticket',
              reference_id: ticketId,
              event_id: ticket.event_id ?? null,
              metadata: {
                promoter_id: session.metadata?.promoterId ?? null,
                promo_code: session.metadata?.promoCode ?? null,
                quantity: qty,
                total_price: ticket.total_price,
              },
            });
          }

          // 3. Ticket-round threshold checks
          if (ticket.ticket_round_id) {
            const { data: roundAfter } = await supabaseAdmin
              .from('ticket_rounds')
              .select('name, tickets_sold, max_tickets')
              .eq('id', ticket.ticket_round_id)
              .single();

            if (roundAfter && roundAfter.max_tickets && roundAfter.max_tickets > 0) {
              const sold = roundAfter.tickets_sold ?? 0;
              const max = roundAfter.max_tickets;
              const pct = sold / max;

              if (sold >= max) {
                // Sold out — check dedup (once per round)
                const { count: soCount } = await supabaseAdmin
                  .from('staff_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('venue_id', resolvedVenueId)
                  .eq('notification_type', 'ticket_round_sold_out')
                  .eq('reference_id', ticket.ticket_round_id)
                  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
                if ((soCount ?? 0) === 0) {
                  await supabaseAdmin.from('staff_notifications').insert({
                    venue_id: resolvedVenueId,
                    target_role: 'owner',
                    notification_type: 'ticket_round_sold_out',
                    title: 'Round de billets épuisé 🎟️',
                    message: `"${roundAfter.name}" — complet (${max}/${max} billets vendus)`,
                    priority: 'high',
                    reference_type: 'ticket_round',
                    reference_id: ticket.ticket_round_id,
                    event_id: ticket.event_id ?? null,
                    metadata: { round_name: roundAfter.name, tickets_sold: sold, max_tickets: max },
                  });
                }
              } else if (pct >= 0.8) {
                // Almost sold out — check dedup
                const { count: warnCount } = await supabaseAdmin
                  .from('staff_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('venue_id', resolvedVenueId)
                  .eq('notification_type', 'ticket_round_warning')
                  .eq('reference_id', ticket.ticket_round_id)
                  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
                if ((warnCount ?? 0) === 0) {
                  await supabaseAdmin.from('staff_notifications').insert({
                    venue_id: resolvedVenueId,
                    target_role: 'owner',
                    notification_type: 'ticket_round_warning',
                    title: 'Billets presque épuisés',
                    message: `"${roundAfter.name}" — ${sold}/${max} vendus (${Math.round(pct * 100)}%)`,
                    priority: 'high',
                    reference_type: 'ticket_round',
                    reference_id: ticket.ticket_round_id,
                    event_id: ticket.event_id ?? null,
                    metadata: { round_name: roundAfter.name, tickets_sold: sold, max_tickets: max, pct: Math.round(pct * 100) },
                  });
                }
              }
            }
          }

          logStep("Owner notifications sent for ticket payment");
        } catch (notifErr) {
          console.error('Owner notif error (ticket):', notifErr);
        }
      }

      // ── Organizer notifications ──────────────────────────────────────────
      // Mirror of the owner block, into the organizer's own inbox. Fires for
      // events that have an organizer (standalone org events and co-events).
      if (resolvedOrganizerId) {
        try {
          const roundName = session.metadata?.roundName ?? 'Billet';
          const qty = ticket.quantity ?? 1;
          const totalPriceFormatted = Number(ticket.total_price ?? 0).toFixed(2);
          await supabaseAdmin.from('organizer_notifications').insert({
            organizer_user_id: resolvedOrganizerId,
            notification_type: 'ticket_sale',
            title: 'Nouveau billet vendu',
            message: `${qty}x ${roundName} — ${totalPriceFormatted} €${ticket.full_name ? ` · ${ticket.full_name}` : ''}`,
            priority: 'normal',
            reference_type: 'ticket',
            reference_id: ticketId,
            event_id: ticket.event_id ?? null,
            metadata: { quantity: qty, total_price: ticket.total_price, round_name: roundName },
          });

          // Ticket-round threshold checks (dedup once per round / 24h)
          if (ticket.ticket_round_id) {
            const { data: roundAfter } = await supabaseAdmin
              .from('ticket_rounds')
              .select('name, tickets_sold, max_tickets')
              .eq('id', ticket.ticket_round_id)
              .single();

            if (roundAfter && roundAfter.max_tickets && roundAfter.max_tickets > 0) {
              const sold = roundAfter.tickets_sold ?? 0;
              const max = roundAfter.max_tickets;
              const pct = sold / max;
              const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

              if (sold >= max) {
                const { count: soCount } = await supabaseAdmin
                  .from('organizer_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('organizer_user_id', resolvedOrganizerId)
                  .eq('notification_type', 'ticket_round_sold_out')
                  .eq('reference_id', ticket.ticket_round_id)
                  .gte('created_at', sinceIso);
                if ((soCount ?? 0) === 0) {
                  await supabaseAdmin.from('organizer_notifications').insert({
                    organizer_user_id: resolvedOrganizerId,
                    notification_type: 'ticket_round_sold_out',
                    title: 'Round de billets épuisé 🎟️',
                    message: `"${roundAfter.name}" — complet (${max}/${max} billets vendus)`,
                    priority: 'high',
                    reference_type: 'ticket_round',
                    reference_id: ticket.ticket_round_id,
                    event_id: ticket.event_id ?? null,
                    metadata: { round_name: roundAfter.name, tickets_sold: sold, max_tickets: max },
                  });
                }
              } else if (pct >= 0.8) {
                const { count: warnCount } = await supabaseAdmin
                  .from('organizer_notifications')
                  .select('id', { count: 'exact', head: true })
                  .eq('organizer_user_id', resolvedOrganizerId)
                  .eq('notification_type', 'ticket_round_warning')
                  .eq('reference_id', ticket.ticket_round_id)
                  .gte('created_at', sinceIso);
                if ((warnCount ?? 0) === 0) {
                  await supabaseAdmin.from('organizer_notifications').insert({
                    organizer_user_id: resolvedOrganizerId,
                    notification_type: 'ticket_round_warning',
                    title: 'Billets presque épuisés',
                    message: `"${roundAfter.name}" — ${sold}/${max} vendus (${Math.round(pct * 100)}%)`,
                    priority: 'high',
                    reference_type: 'ticket_round',
                    reference_id: ticket.ticket_round_id,
                    event_id: ticket.event_id ?? null,
                    metadata: { round_name: roundAfter.name, tickets_sold: sold, max_tickets: max, pct: Math.round(pct * 100) },
                  });
                }
              }
            }
          }

          logStep("Organizer notifications sent for ticket payment");
        } catch (notifErr) {
          console.error('Organizer notif error (ticket):', notifErr);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Send ticket confirmation email
      let emailSent = false;
      try {
        const ticketEmail = ticket.user_email;
        const ticketFirstName = ticket.full_name?.split(' ')[0] || '';

        const emailResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-ticket-confirmation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            ticketId,
            email: ticketEmail,
            firstName: ticketFirstName,
            isGuest: isGuestTicket,
          }),
        });
        emailSent = emailResp.ok;
        logStep("Ticket confirmation email", { sent: emailSent, to: ticketEmail });
      } catch (emailError) {
        console.error('Error sending ticket confirmation email:', emailError);
      }

      // Send push notification (only for authenticated users)
      if (effectiveUserId) {
        try {
          const { data: eventForPush } = await supabaseAdmin
            .from('events')
            .select('title, start_at')
            .eq('id', ticket.event_id)
            .single();
          
          const eventDate = eventForPush?.start_at 
            ? new Date(eventForPush.start_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })
            : '';

          const pushResp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
            body: JSON.stringify({
              user_id: effectiveUserId,
              payload: {
                title: 'Ticket confirmé 🎟️',
                body: `${eventDate} – ${eventForPush?.title || 'Événement'}. Ton QR est prêt.`,
                url: '/my-orders?tab=tickets'
              }
            })
          });
          if (pushResp.ok) {
            const pushData = await pushResp.json();
            pushSent = (pushData?.sent || 0) > 0;
          }
          logStep("Push notification sent for ticket", { pushSent });
        } catch (pushError) {
          console.error('Push notification error:', pushError);
        }
      }

      } // ── end side-effects guard: everything above runs exactly once per ticket ──

      // Fetch full ticket details for the guest confirmation page. This is a
      // read-only lookup and stays OUTSIDE the idempotency guard so the page
      // still renders correctly on reloads / when the webhook did the processing.
      let ticketDetails: any = undefined;
      if (isGuestTicket) {
        try {
          const { data: fullTicket } = await supabaseAdmin
            .from('tickets')
            .select(`
              id, qr_code, quantity, unit_price, total_price, full_name, user_email, phone, paid_at, service_fee, insurance_fee,
              events!inner(title, start_at, venue_id, poster_url),
              ticket_rounds!inner(name, price)
            `)
            .eq('id', ticketId)
            .single();

          if (fullTicket) {
            // Standalone organizer events have no venue_id — skip the venue lookup
            // entirely instead of querying `.eq('id', null)` (which errors and would
            // leave the guest confirmation page without an issuer name).
            const ticketVenueId = (fullTicket.events as any).venue_id as string | null;
            const { data: venue } = ticketVenueId
              ? await supabaseAdmin
                  .from('venues')
                  .select('id, name, address, logo_url, legal_name, siret, vat_number, legal_address')
                  .eq('id', ticketVenueId)
                  .maybeSingle()
              : { data: null };

            const { data: inv } = await supabaseAdmin
              .from('invoice_numbers')
              .select('invoice_number')
              .eq('ticket_id', ticketId)
              .maybeSingle();

            ticketDetails = {
              id: fullTicket.id,
              qrCode: fullTicket.qr_code,
              eventTitle: (fullTicket.events as any).title,
              eventDate: (fullTicket.events as any).start_at,
              eventPosterUrl: (fullTicket.events as any).poster_url,
              roundName: (fullTicket.ticket_rounds as any).name,
              roundPrice: (fullTicket.ticket_rounds as any).price,
              quantity: fullTicket.quantity,
              totalPrice: fullTicket.total_price,
              serviceFee: fullTicket.service_fee,
              insuranceFee: fullTicket.insurance_fee,
              unitPrice: fullTicket.unit_price,
              customerName: fullTicket.full_name,
              customerEmail: fullTicket.user_email,
              customerPhone: fullTicket.phone,
              paidAt: fullTicket.paid_at,
              venueName: venue?.name,
              venueAddress: venue?.address,
              venueId: venue?.id,
              venueLogoUrl: venue?.logo_url,
              venueLegalName: venue?.legal_name,
              venueSiret: venue?.siret,
              venueVatNumber: venue?.vat_number,
              venueLegalAddress: venue?.legal_address,
              invoiceNumber: inv?.invoice_number || null,
            };
          }
        } catch (detailError) {
          console.error('Error fetching ticket details for guest:', detailError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          paid: true,
          alreadyProcessed: !didTransition,
          pushSent,
          isGuest: isGuestTicket,
          guestEmail: isGuestTicket ? ticket.user_email : undefined,
          ticketDetails,
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
    console.error('Error in verify-ticket-payment:', error);
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
