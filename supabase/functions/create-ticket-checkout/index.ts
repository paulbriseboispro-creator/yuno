import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolvePaymentSplit } from "../_shared/payment-split.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { t, resolveLang } from "../_shared/i18n.ts";
import { resolvePaymentMode, PAYMENTS_DISABLED_CODE } from "../_shared/payment-guard.ts";

// Production mode - payments go through Stripe Connect
const TEST_MODE = false;

// Yuno commission rate for tickets: max(0.99€, 4%)
const YUNO_COMMISSION_RATE = 0.04;
const YUNO_COMMISSION_MIN = 0.99;

// Stripe fee constants (charged to clubs)
const STRIPE_PERCENT = 0.015;
const STRIPE_FIXED_CENTS = 25;

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-TICKET-CHECKOUT] ${step}`, details ? JSON.stringify(details) : "");
};

const generateQRCode = () => {
  // Cryptographically-random, unguessable code (Deno global crypto). The old
  // `Date.now() + Math.random()` scheme was predictable and not collision-safe —
  // a QR code is a door credential, it must not be guessable.
  return `TK-${crypto.randomUUID()}`;
};

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started", { testMode: TEST_MODE });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Parse request body first
    const { 
      eventId, ticketRoundId, quantity, fullName, phone, drinkId, drinkName, 
      newsletterOptIn, smsOptIn, hasInsurance, promoCode, promoterId, attendees,
      guestEmail, guestFullName, guestPhone, packId,
      upsellSelections, cancelUrl,
      purchaseSource, minorAuthDocUrl, language, trackedLinkId,
    } = await req.json();
    const lang = resolveLang(language);

    const ALLOWED_SOURCES = ['venue_profile','organizer_profile','dj_profile','explore','promoter','direct'];
    // Default to 'direct' so analytics never show "unknown" — every ticket has a source.
    const safePurchaseSource = ALLOWED_SOURCES.includes(purchaseSource) ? purchaseSource : 'direct';
    // Tracked-link attribution: a UUID or null. Stored on the ticket + carried in Stripe metadata.
    const safeTrackedLinkId = (typeof trackedLinkId === 'string' && /^[0-9a-f-]{36}$/i.test(trackedLinkId)) ? trackedLinkId : null;

    if (!eventId || !ticketRoundId || !quantity) {
      throw new Error("Missing required fields");
    }

    // Authenticate user OR handle guest checkout
    let user: { id: string; email: string | null } | null = null;
    const authHeader = req.headers.get("Authorization");
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
      if (!userError && userData.user) {
        user = { id: userData.user.id, email: userData.user.email ?? null };
        logStep("User authenticated", { userId: user.id, email: user.email });
      }
    }

    // Guest checkout: true guest mode — no account creation
    const isGuestCheckout = !user && !!guestEmail;
    if (isGuestCheckout) {
      logStep("Guest checkout — no account creation", { guestEmail });
    }

    if (!user && !guestEmail) {
      throw new Error("User not authenticated and no guest info provided");
    }

    // ── Payments kill-switch + demo bypass ────────────────────────────────────
    // Demo (@womber.fr) buyers simulate a paid ticket with NO Stripe call — they
    // reuse the TEST_MODE fulfillment path below (records created as paid, free).
    // A real buyer while the global kill-switch is ON is refused here, before any
    // capacity is held or record created. Based on the authenticated buyer only;
    // guests never simulate.
    const paymentMode = (await resolvePaymentMode(supabaseAdmin, user?.email)).mode;
    if (paymentMode === "blocked") {
      logStep("Payments disabled — checkout refused", { eventId });
      return new Response(
        JSON.stringify({ success: false, error: t("checkout.paymentsDisabled", lang), code: PAYMENTS_DISABLED_CODE }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }
    const simulate = TEST_MODE || paymentMode === "simulate";

    logStep("Request parsed", { eventId, ticketRoundId, quantity, hasInsurance, promoCode, attendeesCount: attendees?.length, simulate });

    // Get event details
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, title, venue_id, organizer_user_id, partner_venue_id, partner_organizer_id, event_mode, revenue_split_rules, is_active, presale_start_at, public_sale_start_at, waitlist_enabled, end_at, ticket_selling_mode, max_tickets, rounds_visibility")
      .eq("id", eventId)
      .single();

    if (eventError || !event) throw new Error("Event not found");
    if (!event.is_active) throw new Error("Event is not active");

    // Check if event has ended
    if (event.end_at && new Date(event.end_at) < new Date()) {
      throw new Error(t("checkout.eventEnded", lang));
    }

    // Sales timing validation
    const now = Date.now();
    const presaleStart = event.presale_start_at ? new Date(event.presale_start_at).getTime() : null;
    const publicStart = event.public_sale_start_at ? new Date(event.public_sale_start_at).getTime() : null;
    const waitlistEnabled = event.waitlist_enabled === true;

    // Private mode: waitlist only, no sales dates
    if (!presaleStart && !publicStart && waitlistEnabled) {
      throw new Error(t("checkout.saleNotOpen", lang));
    }

    const firstSaleDate = presaleStart || publicStart;
    if (firstSaleDate && now < firstSaleDate) {
      throw new Error(t("checkout.salesNotStarted", lang));
    }

    const invalidDateOrder = Boolean(presaleStart && publicStart && publicStart <= presaleStart);
    const isPresaleWindow = Boolean(
      presaleStart && (
        invalidDateOrder
          ? now >= presaleStart
          : (publicStart ? now >= presaleStart && now < publicStart : false)
      ),
    );

    // Block guest users from presale-only events (they can't be on the waitlist)
    const isGuestUser = !!guestEmail && !authHeader;
    if (isGuestUser && isPresaleWindow) {
      throw new Error(t("checkout.presaleMembersOnly", lang));
    }

    // Presale access check
    if (isPresaleWindow) {
      const hasPromoterRef = !!promoterId || !!promoCode;
      let hasWaitlistAccess = false;

      if (user) {
        const filters = [`user_id.eq.${user.id}`];
        const normalizedEmail = user.email?.toLowerCase().trim();
        if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);

        const { data: wlEntry } = await supabaseAdmin
          .from("event_waitlist")
          .select("id, presale_access")
          .eq("event_id", eventId)
          .or(filters.join(","))
          .maybeSingle();

        hasWaitlistAccess = !!wlEntry;
      }

      if (!hasPromoterRef && !hasWaitlistAccess) {
        throw new Error(t("checkout.presaleAccessOnly", lang));
      }
      logStep("Presale access verified", { hasPromoterRef, hasWaitlistAccess, invalidDateOrder });
    }

    logStep("Event found", { eventId: event.id, venueId: event.venue_id });

    // Check if customer is banned (account-level OR email-level — guest checkout too).
    // Both checks are scoped to event.venue_id, so a ban never crosses clubs.
    if (event.venue_id) {
      const buyerEmail = user?.email || guestEmail || null;

      if (user) {
        const { data: bannedCustomer } = await supabaseAdmin
          .from("venue_customers")
          .select("is_banned")
          .eq("venue_id", event.venue_id)
          .eq("user_id", user.id)
          .eq("is_banned", true)
          .maybeSingle();
        if (bannedCustomer?.is_banned) {
          logStep("Customer is banned (account)", { userId: user.id, venueId: event.venue_id });
          throw new Error(t("checkout.notAllowedTickets", lang));
        }
      }

      if (buyerEmail) {
        const { data: emailBanned } = await supabaseAdmin.rpc("is_email_banned", {
          p_venue_id: event.venue_id, p_email: buyerEmail,
        });
        if (emailBanned === true) {
          logStep("Customer is banned (email)", { venueId: event.venue_id });
          throw new Error(t("checkout.notAllowedTickets", lang));
        }
      }
    }

    // Get ticket round details
    const { data: ticketRound, error: roundError } = await supabaseAdmin
      .from("ticket_rounds")
      .select("*")
      .eq("id", ticketRoundId)
      .single();

    if (roundError || !ticketRound) throw new Error("Ticket round not found");
    if (!ticketRound.is_active) throw new Error("Ticket round is not active");

    // Enforce rounds_visibility rules (only meaningful for 'rounds' selling mode)
    if (event.ticket_selling_mode === 'rounds') {
      const visibility = (event as any).rounds_visibility ?? 'sequential';
      if (visibility === 'sequential' || visibility === 'preview_upcoming') {
        // Only the first non-sold-out active round in `position` order is buyable
        const { data: orderedRounds } = await supabaseAdmin
          .from("ticket_rounds")
          .select("id, position, is_active, tickets_sold, max_tickets, ticket_type")
          .eq("event_id", eventId)
          .eq("ticket_type", ticketRound.ticket_type)
          .order("position", { ascending: true });

        const firstAvailable = (orderedRounds || []).find((r: any) =>
          r.is_active && r.tickets_sold < r.max_tickets
        );
        if (!firstAvailable || firstAvailable.id !== ticketRound.id) {
          logStep("Round not yet buyable (visibility rule)", {
            visibility,
            requested: ticketRound.id,
            firstAvailable: firstAvailable?.id,
          });
          throw new Error(t("checkout.tierNotAvailable", lang));
        }
      }
      // 'all_open' → any active, non-sold-out round is buyable (already checked above)
    }

    // Check availability - account for group ticket capacity
    const isGroupRound = ticketRound.is_group === true;
    const groupSize = isGroupRound ? (ticketRound.group_size || 1) : 1;
    const capacityNeeded = quantity * groupSize;
    const availableTickets = ticketRound.max_tickets - ticketRound.tickets_sold;
    if (capacityNeeded > availableTickets) {
      throw new Error(`Only ${Math.floor(availableTickets / groupSize)} group tickets available`);
    }

    logStep("Ticket round validated (pre-reservation)", {
      roundId: ticketRound.id,
      price: ticketRound.price,
      available: availableTickets,
      isGroup: isGroupRound,
      groupSize,
      capacityNeeded,
    });

    // Global capacity check for simple mode (still useful as a fast-fail before atomic reservation)
    if (event.ticket_selling_mode === 'simple' && event.max_tickets) {
      const { data: allRounds } = await supabaseAdmin
        .from("ticket_rounds")
        .select("tickets_sold")
        .eq("event_id", eventId);

      const totalSold = (allRounds || []).reduce((sum: number, r: { tickets_sold: number }) => sum + r.tickets_sold, 0);
      if (totalSold + capacityNeeded > event.max_tickets) {
        logStep("Global capacity exceeded", { totalSold, capacityNeeded, maxTickets: event.max_tickets });
        throw new Error(t("checkout.soldOut", lang));
      }
      logStep("Global capacity check passed", { totalSold, capacityNeeded, maxTickets: event.max_tickets });
    }

    // ATOMIC RESERVATION (anti-oversell): holds capacity for the duration of the Stripe checkout
    // This is locked with FOR UPDATE on ticket_rounds and accounts for other pending reservations.
    let reservationId: string | null = null;
    let reservationExpiresAt: string | null = null;
    if (!simulate) {
      const { data: reservation, error: reservationError } = await supabaseAdmin.rpc(
        'reserve_ticket_capacity',
        {
          _ticket_round_id: ticketRoundId,
          _event_id: eventId,
          _user_id: user?.id || null,
          _guest_email: !user ? guestEmail : null,
          _quantity: quantity,
          _capacity_per_unit: groupSize,
          _ttl_minutes: 10,
        }
      );

      if (reservationError) {
        logStep("Reservation failed (atomic)", { error: reservationError.message });
        // PostgreSQL raises 23514 (check_violation) when capacity is insufficient
        if (reservationError.message?.includes('Insufficient capacity')) {
          throw new Error(t("checkout.soldOutRace", lang));
        }
        throw new Error(t("checkout.reserveFailed", lang));
      }

      const reservationRow = Array.isArray(reservation) ? reservation[0] : reservation;
      reservationId = reservationRow?.reservation_id ?? null;
      reservationExpiresAt = reservationRow?.expires_at ?? null;

      if (!reservationId) {
        throw new Error(t("checkout.reserveInvalid", lang));
      }
      logStep("Atomic reservation created", { reservationId, expiresAt: reservationExpiresAt, capacityHeld: capacityNeeded });
    }


    // Resolve payment destination: venue + organizer (co-event aware)
    let venueStripeAccountId: string | null = null;
    let venueStripeChargesEnabled = false;
    let organizerStripeAccountId: string | null = null;
    let organizerStripeChargesEnabled = false;
    let venueIdForFees: string | null = event.venue_id;
    let payoutSource: 'venue' | 'organizer' = 'venue';

    const effectiveVenueId = event.venue_id || event.partner_venue_id;
    const effectiveOrganizerId = event.organizer_user_id || event.partner_organizer_id;

    if (effectiveVenueId) {
      const { data: venue } = await supabaseAdmin
        .from("venues")
        .select("id, name, stripe_account_id, stripe_charges_enabled")
        .eq("id", effectiveVenueId)
        .maybeSingle();
      venueStripeAccountId = venue?.stripe_account_id ?? null;
      venueStripeChargesEnabled = !!venue?.stripe_charges_enabled;
      venueIdForFees = venue?.id ?? null;
    }
    if (effectiveOrganizerId) {
      const { data: orgProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_connect_account_id, stripe_connect_charges_enabled")
        .eq("id", effectiveOrganizerId)
        .maybeSingle();
      organizerStripeAccountId = orgProfile?.stripe_connect_account_id ?? null;
      organizerStripeChargesEnabled = !!orgProfile?.stripe_connect_charges_enabled;
    }
    payoutSource = event.venue_id ? 'venue' : 'organizer';

    // Load partnership rules if a co-event
    let partnershipRules: Record<string, unknown> | null = null;
    let partnershipId: string | null = null;
    if (effectiveVenueId && effectiveOrganizerId && event.event_mode !== 'solo_venue' && event.event_mode !== 'solo_organizer') {
      const { data: partnership } = await supabaseAdmin
        .from("venue_organizer_partnerships")
        .select("id, default_split_rules, status")
        .eq("venue_id", effectiveVenueId)
        .eq("organizer_user_id", effectiveOrganizerId)
        .eq("status", "active")
        .maybeSingle();
      partnershipRules = (partnership?.default_split_rules as Record<string, unknown>) ?? null;
      partnershipId = partnership?.id ?? null;
    }

    // CONTRACT GUARD: block checkout if a split proposal is awaiting bilateral approval
    if (event.revenue_split_proposal && !(event.split_approved_by_venue && event.split_approved_by_organizer)) {
      throw new Error(
        "Le contrat de partage de revenus pour cette soirée est en attente de validation. " +
        "Le club et l'organisateur doivent tous deux accepter avant l'ouverture des ventes."
      );
    }

    logStep("Payment targets resolved", {
      payoutSource,
      effectiveVenueId,
      effectiveOrganizerId,
      eventMode: event.event_mode,
      hasPartnershipRules: !!partnershipRules,
    });

    // Backwards-compat shim used later in the function
    const stripeAccountId = payoutSource === 'venue' ? venueStripeAccountId : organizerStripeAccountId;
    const stripeChargesEnabled = payoutSource === 'venue' ? venueStripeChargesEnabled : organizerStripeChargesEnabled;
    const venue = { id: venueIdForFees ?? '', name: '', stripe_account_id: stripeAccountId, stripe_charges_enabled: stripeChargesEnabled };

    // SERVER-SIDE PRICE CALCULATION: Use database values only
    const unitPrice = ticketRound.price;
    const subtotal = unitPrice * quantity;
    
    // Find promoter by ID or by promoCode
    let finalPromoterId = promoterId;
    let validatedDiscount = 0;
    
    // If promoterId is not provided but we have a promoCode, look up the promoter
    if (!finalPromoterId && promoCode) {
      logStep("Looking up promoter by promoCode", { promoCode, venueId: event.venue_id });
      const { data: promoterByCode } = await supabaseAdmin
        .from("promoters")
        .select("id, ticket_discount_type, ticket_discount_value")
        .eq("venue_id", event.venue_id)
        .ilike("promo_code", promoCode.trim())
        .eq("is_active", true)
        .single();
      
      if (promoterByCode) {
        finalPromoterId = promoterByCode.id;
        logStep("Found promoter by promoCode", { promoterId: finalPromoterId });
        
        // Calculate discount from this promoter
        if (promoterByCode.ticket_discount_type === 'percentage' && promoterByCode.ticket_discount_value) {
          validatedDiscount = Math.round(subtotal * (promoterByCode.ticket_discount_value / 100) * 100) / 100;
        } else if (promoterByCode.ticket_discount_type === 'fixed' && promoterByCode.ticket_discount_value) {
          validatedDiscount = Math.min(promoterByCode.ticket_discount_value * quantity, subtotal);
        }
      }
    } else if (finalPromoterId) {
      // Validate promoter discount from database using provided promoterId
      const { data: promoter } = await supabaseAdmin
        .from("promoters")
        .select("ticket_discount_type, ticket_discount_value, is_active")
        .eq("id", finalPromoterId)
        .eq("is_active", true)
        .single();

      if (promoter) {
        if (promoter.ticket_discount_type === 'percentage' && promoter.ticket_discount_value) {
          validatedDiscount = Math.round(subtotal * (promoter.ticket_discount_value / 100) * 100) / 100;
        } else if (promoter.ticket_discount_type === 'fixed' && promoter.ticket_discount_value) {
          validatedDiscount = Math.min(promoter.ticket_discount_value * quantity, subtotal);
        }
      }
    }
    
    logStep("Promoter resolved", { finalPromoterId, validatedDiscount, originalPromoterId: promoterId, promoCode });

    const discountedSubtotal = subtotal - validatedDiscount;
    
    const serviceFee = Math.round(Math.max(YUNO_COMMISSION_MIN, discountedSubtotal * YUNO_COMMISSION_RATE) * 100) / 100; // max(0.99€, 4%) service fee
    const insuranceFee = hasInsurance ? Math.round(discountedSubtotal * 0.10 * 100) / 100 : 0; // 10% insurance

    // Validate upsell selections from ticket_upsell_offers
    interface ValidatedUpsell {
      offerId: string;
      offerType: string;
      name: string;
      price: number;
      drinkCount: number;
    }
    const validatedUpsells: ValidatedUpsell[] = [];
    let upsellTotal = 0;

    // Support both new upsellSelections and legacy packId
    if (upsellSelections && Array.isArray(upsellSelections) && upsellSelections.length > 0) {
      for (const sel of upsellSelections) {
        const { data: offer, error: offerError } = await supabaseAdmin
          .from("ticket_upsell_offers")
          .select("*")
          .eq("id", sel.offerId)
          .eq("venue_id", event.venue_id)
          .eq("is_active", true)
          .single();

        if (offerError || !offer) {
          logStep("Upsell offer not found or invalid", { offerId: sel.offerId });
          throw new Error(`Offre upsell introuvable: ${sel.offerId}`);
        }

        // Determine server-side price based on offer type
        let serverPrice = 0;
        let drinkCount = 0;
        if (offer.offer_type === 'drink_pack') {
          serverPrice = Number(offer.pack_price || 0);
          drinkCount = offer.drink_count || 0;
        } else if (offer.offer_type === 'single_drink_discount') {
          serverPrice = Number(offer.discounted_price || 0);
          drinkCount = 1;
        } else if (offer.offer_type === 'cloakroom') {
          serverPrice = Number(offer.cloakroom_price || 0);
        } else if (offer.offer_type === 'combo') {
          serverPrice = Number(offer.discounted_price || 0);
          drinkCount = offer.combo_qty || 0;
        }

        validatedUpsells.push({
          offerId: offer.id,
          offerType: offer.offer_type,
          name: offer.name,
          price: serverPrice,
          drinkCount,
        });
        upsellTotal += serverPrice;
        logStep("Upsell validated", { offerId: offer.id, type: offer.offer_type, price: serverPrice, drinkCount });
      }
    } else if (packId) {
      // Legacy pack support
      const { data: pack, error: packError } = await supabaseAdmin
        .from("upsell_drink_packs")
        .select("id, name, drink_count, pack_price, venue_id, is_active")
        .eq("id", packId)
        .single();
      
      if (packError || !pack) throw new Error("Pack not found");
      if (!pack.is_active) throw new Error("Pack is no longer active");
      if (pack.venue_id !== event.venue_id) throw new Error("Pack does not belong to this venue");
      
      const packPrice = Number(pack.pack_price);
      validatedUpsells.push({
        offerId: pack.id,
        offerType: 'drink_pack',
        name: pack.name,
        price: packPrice,
        drinkCount: pack.drink_count,
      });
      upsellTotal += packPrice;
      logStep("Legacy pack validated", { packId: pack.id, packPrice, drinkCount: pack.drink_count });
    }

    const totalPrice = discountedSubtotal + serviceFee + insuranceFee + upsellTotal;

    // Yuno commission (7% of total)
    const yunoCommission = Math.round(totalPrice * YUNO_COMMISSION_RATE * 100); // in cents

    logStep("Prices calculated server-side", { 
      subtotal,
      discount: validatedDiscount,
      discountedSubtotal,
      serviceFee, 
      insuranceFee, 
      upsellTotal,
      totalPrice,
      yunoCommission 
    });

    // Create/update venue_customer for this venue (only for authenticated users)
    const userEmail = user?.email || guestEmail || '';
    const nameParts = (fullName || guestFullName || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const userPhone = phone || guestPhone || '';
    
    if (user && event.venue_id) {
      await supabaseAdmin.rpc('get_or_create_venue_customer', {
        p_venue_id: event.venue_id,
        p_user_id: user.id,
        p_email: userEmail,
        p_first_name: firstName,
        p_last_name: lastName,
        p_phone: userPhone
      });
      logStep("Venue customer created/updated");
    }

    const qrCode = generateQRCode();

    if (simulate) {
      logStep("SIMULATE: Creating paid ticket directly (demo or test mode)");

      // Create ticket directly with paid status
      const ticketType = ticketRound.ticket_type || 'standard';
      const qrPrefix = ticketType === 'vip' ? 'VIP-TK' : 'TK';
      const qrCode = `${qrPrefix}-${crypto.randomUUID()}`;
      
      const { data: ticket, error: ticketError } = await supabaseAdmin
        .from("tickets")
        .insert({
          event_id: eventId,
          ticket_round_id: ticketRoundId,
          user_id: user?.id || null,
          user_email: user?.email || guestEmail || "",
          quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
          service_fee: serviceFee,
          has_insurance: hasInsurance,
          insurance_fee: insuranceFee,
          status: "paid",
          paid_at: new Date().toISOString(),
          qr_code: qrCode,
          full_name: fullName || guestFullName,
          phone: phone || guestPhone,
          drink_id: drinkId,
          drink_name: drinkName,
          newsletter_opt_in: newsletterOptIn,
          sms_opt_in: !!smsOptIn,
          ticket_type: ticketType,
          is_guest: isGuestCheckout,
          guest_first_name: isGuestCheckout ? firstName : null,
          guest_last_name: isGuestCheckout ? lastName : null,
          guest_phone: isGuestCheckout ? userPhone : null,
          purchase_source: safePurchaseSource,
          tracked_link_id: safeTrackedLinkId,
          minor_auth_doc_url: minorAuthDocUrl || null,
        })
        .select()
        .single();

      if (ticketError) {
        logStep("Error creating ticket", { error: ticketError.message });
        throw new Error("Failed to create ticket");
      }

      // Upsert SMS contact if buyer opted in and phone is available
      if (smsOptIn && event.venue_id && (phone || guestPhone)) {
        const buyerPhone = (phone || guestPhone || '').trim();
        const buyerName = (fullName || guestFullName || '').trim();
        if (buyerPhone.startsWith('+')) {
          await supabaseAdmin.from("venue_sms_contacts").upsert({
            venue_id: event.venue_id,
            user_id: user?.id ?? null,
            phone_e164: buyerPhone,
            full_name: buyerName,
            email: user?.email ?? guestEmail ?? null,
            sms_consent_at: new Date().toISOString(),
            consent_source: 'ticket_checkout',
            source_event_id: event.id,
            is_vip: false,
          }, { onConflict: 'venue_id,phone_e164', ignoreDuplicates: false });
        }
      }

      // Update tickets_sold count - for group tickets, deduct groupSize per ticket
      const soldIncrement = isGroupRound ? quantity * groupSize : quantity;
      await supabaseAdmin
        .from("ticket_rounds")
        .update({ tickets_sold: ticketRound.tickets_sold + soldIncrement })
        .eq("id", ticketRoundId);

      // Create individual attendee entries for nominative tickets
      if (attendees && attendees.length > 0) {
        const attendeeRecords = attendees.map((attendee: { fullName: string; email?: string; phone?: string }, index: number) => ({
          ticket_id: ticket.id,
          full_name: attendee.fullName,
          email: attendee.email || null,
          phone: attendee.phone || null,
          qr_code: `${qrCode}-${index + 1}`,
        }));

        const { error: attendeesError } = await supabaseAdmin
          .from("ticket_attendees")
          .insert(attendeeRecords);

        if (attendeesError) {
          logStep("Error creating attendees", { error: attendeesError.message });
        } else {
          logStep("Attendees created", { count: attendeeRecords.length });
        }
      }

      // Create promoter conversion if applicable (even if discount is 0, we track the conversion)
      if (finalPromoterId) {
        logStep("Creating promoter conversion", { promoterId: finalPromoterId });
        
        // Fetch promoter commission settings
        const { data: promoter } = await supabaseAdmin
          .from("promoters")
          .select("ticket_commission_type, ticket_commission_value, pending_amount")
          .eq("id", finalPromoterId)
          .single();

        if (promoter) {
          let commission = 0;
          if (promoter.ticket_commission_type === 'percentage' && promoter.ticket_commission_value) {
            commission = Math.round(totalPrice * (promoter.ticket_commission_value / 100) * 100) / 100;
          } else if (promoter.ticket_commission_value) {
            commission = promoter.ticket_commission_value * quantity;
          }

          const { error: conversionError } = await supabaseAdmin
            .from("promoter_conversions")
            .insert({
              promoter_id: finalPromoterId,
              ticket_id: ticket.id,
              conversion_type: 'ticket',
              amount: totalPrice,
              commission,
              status: 'pending',
            });

          if (conversionError) {
            logStep("Error creating promoter conversion", { error: conversionError.message });
          } else {
            // Update promoter pending amount
            const newPendingAmount = (promoter.pending_amount || 0) + commission;
            await supabaseAdmin
              .from("promoters")
              .update({ pending_amount: newPendingAmount })
              .eq("id", finalPromoterId);

            logStep("Promoter conversion created successfully", { promoterId: finalPromoterId, commission, newPendingAmount });
          }
        }
      }

      // Increment venue customer stats atomically (only for authenticated users)
      if (user) {
        await supabaseAdmin.rpc('increment_venue_customer_stats', {
          p_venue_id: event.venue_id,
          p_user_id: user.id,
          p_order_delta: 0,
          p_ticket_delta: 1,
          p_table_delta: 0,
          p_spent_delta: totalPrice,
        });
        logStep("Venue customer stats incremented", { venueId: event.venue_id, spent: totalPrice });
      }

      // Award loyalty points (only for authenticated users)
      let pointsEarned = 0;
      if (user) {
        try {
          const { data: pointsData } = await supabaseAdmin.rpc('award_loyalty_points', {
            p_venue_id: event.venue_id,
            p_user_id: user.id,
            p_amount: totalPrice,
            p_reference_type: 'ticket',
            p_reference_id: ticket.id,
            p_description: 'Ticket purchase',
          });
          pointsEarned = pointsData || 0;
          logStep("Loyalty points awarded", { pointsEarned, venueId: event.venue_id });
        } catch (loyaltyError) {
          logStep("Error awarding loyalty points (non-blocking)", { error: String(loyaltyError) });
        }
      }

      // Create upsell selections and credits
      if (validatedUpsells.length > 0) {
        try {
          // Get event end_at for expiration
          const { data: eventForExpiry } = await supabaseAdmin
            .from("events")
            .select("end_at")
            .eq("id", eventId)
            .single();

          for (const upsell of validatedUpsells) {
            // Create ticket_upsell_selection
            await supabaseAdmin
              .from("ticket_upsell_selections")
              .insert({
                ticket_id: ticket.id,
                offer_id: upsell.offerId,
                offer_type: upsell.offerType,
                quantity: 1,
                unit_price: upsell.price,
                total_price: upsell.price,
                credits_remaining: upsell.drinkCount > 0 ? upsell.drinkCount : null,
              });
            logStep("Upsell selection created", { offerId: upsell.offerId, type: upsell.offerType });

            // Create order_pack_credits for drink-related upsells
            if ((upsell.offerType === 'drink_pack' || upsell.offerType === 'single_drink_discount' || upsell.offerType === 'combo') && upsell.drinkCount > 0) {
              await supabaseAdmin
                .from("order_pack_credits")
                .insert({
                  user_id: user.id,
                  venue_id: event.venue_id,
                  pack_id: upsell.offerId,
                  ticket_order_id: ticket.id,
                  total_credits: upsell.drinkCount,
                  used_credits: 0,
                  event_id: eventId,
                  expires_at: eventForExpiry?.end_at || null,
                });
              logStep("Pack credits created for upsell", { offerId: upsell.offerId, credits: upsell.drinkCount });
            }
          }
        } catch (upsellError) {
          logStep("Error creating upsell selections/credits (non-blocking)", { error: String(upsellError) });
        }
      }

      // Create free drink credits if ticket round includes_drink AND venue uses credits mode
      if (ticketRound.includes_drink) {
        // Check venue free_drink_mode
        const { data: venueForDrink } = await supabaseAdmin
          .from("venues")
          .select("free_drink_mode")
          .eq("id", event.venue_id)
          .single();
        
        const drinkMode = venueForDrink?.free_drink_mode || 'credits';
        
        if (drinkMode === 'credits') {
          try {
            const { data: eventForExpiry } = await supabaseAdmin
              .from("events")
              .select("end_at")
              .eq("id", eventId)
              .single();

            await supabaseAdmin
              .from("order_pack_credits")
              .insert({
                user_id: user.id,
                venue_id: event.venue_id,
                pack_id: '00000000-0000-0000-0000-000000000001',
                ticket_order_id: ticket.id,
                total_credits: quantity,
                used_credits: 0,
                event_id: eventId,
                expires_at: eventForExpiry?.end_at || null,
              });
            logStep("Free drink credits created (test mode)", { ticketId: ticket.id, credits: quantity });
          } catch (drinkCreditError) {
            logStep("Error creating free drink credits (non-blocking)", { error: String(drinkCreditError) });
          }
        } else {
          logStep("Free drink credits skipped (bouncer_notify mode)", { ticketId: ticket.id });
        }
      }

      logStep("TEST MODE: Ticket created successfully", { ticketId: ticket.id, pointsEarned });

      return new Response(
        JSON.stringify({
          success: true,
          testMode: true,
          ticketId: ticket.id,
          qrCode,
          redirectUrl: `/order-confirmation?type=ticket&id=${ticket.id}`,
          pointsEarned,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // PRODUCTION MODE: Create Stripe checkout session
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // Verify Stripe Connect is set up (venue OR organizer)
    if (!venue.stripe_account_id) {
      throw new Error(
        payoutSource === 'organizer'
          ? "L'organisateur n'a pas encore activé ses paiements."
          : "Ce club n'a pas encore configuré ses paiements. Veuillez contacter le club."
      );
    }

    if (!venue.stripe_charges_enabled) {
      throw new Error(
        payoutSource === 'organizer'
          ? "Le compte de paiement de l'organisateur n'est pas encore validé."
          : "Le compte Stripe du club n'est pas encore activé. Veuillez contacter le club."
      );
    }

    // Create pending ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .insert({
        event_id: eventId,
        ticket_round_id: ticketRoundId,
        user_id: user?.id || null,
        user_email: user?.email || guestEmail || "",
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        service_fee: serviceFee,
        has_insurance: hasInsurance,
        insurance_fee: insuranceFee,
        status: "pending",
        qr_code: qrCode,
        full_name: fullName || guestFullName,
        phone: phone || guestPhone,
        drink_id: drinkId,
        drink_name: drinkName,
        newsletter_opt_in: newsletterOptIn,
        sms_opt_in: !!smsOptIn,
        is_guest: isGuestCheckout,
        guest_first_name: isGuestCheckout ? firstName : null,
        guest_last_name: isGuestCheckout ? lastName : null,
        guest_phone: isGuestCheckout ? userPhone : null,
        purchase_source: safePurchaseSource,
        tracked_link_id: safeTrackedLinkId,
        reservation_id: reservationId,
        minor_auth_doc_url: minorAuthDocUrl || null,
      })
      .select()
      .single();

    if (ticketError) {
      logStep("Error creating pending ticket", { error: ticketError.message });
      // Free the held capacity since the ticket couldn't be created
      if (reservationId) {
        await supabaseAdmin.rpc('cancel_ticket_reservation', { _reservation_id: reservationId });
      }
      throw new Error("Failed to create ticket");
    }

    logStep("Pending ticket created", { ticketId: ticket.id });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Build line items
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: `${ticketRound.name} - ${event.title}`,
            description: `${quantity} billet(s) à ${unitPrice}€`,
          },
          unit_amount: Math.round(unitPrice * 100),
        },
        quantity,
      },
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: "Frais de service",
            description: "Frais de gestion et de traitement",
          },
          unit_amount: Math.round(serviceFee * 100),
        },
        quantity: 1,
      },
    ];

    if (hasInsurance && insuranceFee > 0) {
      lineItems.push({
        price_data: {
          currency: "eur",
          product_data: {
            name: "Assurance annulation",
            description: "Remboursement garanti en cas d'annulation",
          },
          unit_amount: Math.round(insuranceFee * 100),
        },
        quantity: 1,
      });
    }

    // Add upsell line items
    for (const upsell of validatedUpsells) {
      if (upsell.price > 0) {
        lineItems.push({
          price_data: {
            currency: "eur",
            product_data: {
              name: upsell.name,
              description: upsell.drinkCount > 0 ? `${upsell.drinkCount} consommation(s) incluse(s)` : upsell.offerType,
            },
            unit_amount: Math.round(upsell.price * 100),
          },
          quantity: 1,
        });
      }
    }

    const origin = req.headers.get("origin") || "https://yunoapp.eu";

    // Serialize upsells for Stripe metadata (max 500 chars per value)
    const upsellMeta = JSON.stringify(validatedUpsells.map(u => ({
      id: u.offerId, t: u.offerType, p: u.price, d: u.drinkCount, n: u.name
    })));

    // Create Stripe checkout with Connect and Apple Pay
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: "payment",
      success_url: `${origin}/verify-ticket-payment?session_id={CHECKOUT_SESSION_ID}&ticket_id=${ticket.id}`,
      cancel_url: cancelUrl ? `${origin}${cancelUrl}?payment_cancelled=true` : `${origin}/?payment_cancelled=true`,
      customer_email: user?.email || guestEmail,
      payment_method_types: ['card', 'link'],
      metadata: {
        ticketId: ticket.id,
        eventId,
        ticketRoundId,
        userId: user?.id || '',
        venueId: event.venue_id || '',
        promoCode: promoCode || '',
        promoterId: promoterId || '',
        trackedLinkId: safeTrackedLinkId || '',
        isGuest: isGuestCheckout ? 'true' : 'false',
        upsells: upsellMeta,
        reservationId: reservationId || '',
      },
      payment_intent_data: (() => {
        const split = resolvePaymentSplit({
          itemType: "ticket",
          grossAmount: totalPrice,
          event: {
            id: event.id,
            venue_id: event.venue_id,
            organizer_user_id: event.organizer_user_id,
            partner_venue_id: event.partner_venue_id,
            partner_organizer_id: event.partner_organizer_id,
            event_mode: event.event_mode,
            revenue_split_rules: event.revenue_split_rules,
          },
          partnershipRules,
          venueStripeAccountId,
          organizerStripeAccountId,
        });
        const clientTotalCents = split.grossAmountCents;
        const stripeFee = Math.round(clientTotalCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
        const transferGroup = `EVENT_${event.id}_TK_${ticket.id}`;
        logStep("Split + fee", {
          mode: split.splitMode,
          gross: split.grossAmountCents,
          yunoFee: split.yunoFeeCents,
          stripeFee,
          recipientReceives: split.primary.amountCents,
          primary: split.primary,
          secondary: split.secondary,
          transferGroup,
        });
        const sharedMetadata = {
          split_mode: split.splitMode,
          split_primary_kind: split.primary.kind,
          split_primary_account: split.primary.accountId,
          split_primary_amount: String(split.primary.amountCents),
          split_secondary_kind: split.secondary?.kind ?? "",
          split_secondary_account: split.secondary?.accountId ?? "",
          split_secondary_amount: split.secondary ? String(split.secondary.amountCents) : "0",
          split_primary_venue_id: split.primary.venueId ?? "",
          split_primary_organizer_id: split.primary.organizerId ?? "",
          split_secondary_venue_id: split.secondary?.venueId ?? "",
          split_secondary_organizer_id: split.secondary?.organizerId ?? "",
          yuno_fee_cents: String(split.yunoFeeCents),
          stripe_fee_cents: String(stripeFee),
          stripe_fee_estimated_cents: String(split.stripeFeeEstimatedCents),
          item_type: "ticket",
          event_id: event.id,
          ticket_id: ticket.id,
          transfer_group: transferGroup,
          split_rules_applied: JSON.stringify(split.effectiveSplit ?? {}).slice(0, 480),
          venue_pct_applied: split.effectiveSplit ? String(split.effectiveSplit.venue_pct) : "",
          organizer_pct_applied: split.effectiveSplit ? String(split.effectiveSplit.organizer_pct) : "",
          partnership_id: partnershipId ?? "",
        };
        // SEPARATE mode (co-event with two recipients): charge stays on the platform,
        // webhook fires two transfers to primary + secondary connected accounts.
        if (split.splitMode === "separate") {
          return {
            transfer_group: transferGroup,
            metadata: sharedMetadata,
          };
        }
        // DESTINATION mode (single recipient): the charge lands on Yuno's PLATFORM
        // account (Yuno is merchant of record — no on_behalf_of). Yuno collects the
        // full customer payment, pays the Stripe fee, keeps its commission, and
        // transfers the recipient ONLY its own share (split.primary.amountCents =
        // gross − Yuno fee − Stripe fee). The recipient never sees the gross amount
        // transit its books, and there is no separate "Yuno fee" line on its side.
        return {
          transfer_data: { destination: split.primary.accountId, amount: split.primary.amountCents },
          transfer_group: transferGroup,
          metadata: sharedMetadata,
        };
      })(),
    });

    logStep("Stripe session created", { 
      sessionId: session.id, 
      yunoCommission,
      destination: venue.stripe_account_id 
    });

    // Link the reservation to the Stripe session so verify-ticket-payment can confirm idempotently
    if (reservationId && session.id) {
      await supabaseAdmin
        .from('ticket_reservations')
        .update({ stripe_session_id: session.id })
        .eq('id', reservationId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
