import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolvePaymentSplit, estimateStripeFeeEur } from "../_shared/payment-split.ts";
import { resolvePaymentMode, PAYMENTS_DISABLED_CODE } from "../_shared/payment-guard.ts";
// Yuno commission rate — single source of truth (4%, min 0.99€ / 0.49€ BDE, max 25€ on tables).
import {
  YUNO_TICKET_TABLE_RATE as YUNO_COMMISSION_RATE,
  YUNO_TICKET_TABLE_MIN as YUNO_COMMISSION_MIN,
  YUNO_TICKET_TABLE_MIN_BDE as YUNO_COMMISSION_MIN_BDE,
  YUNO_TABLE_MAX as YUNO_COMMISSION_MAX,
} from "../_shared/commission.ts";
import { getAbsorbYunoFees } from "../_shared/merchant-fees.ts";
import { recordSmsConsent } from "../_shared/sms-consent.ts";
import { resolveAgeDeclaration, AgeDeclarationError, AGE_DECLARATION_REQUIRED_CODE } from "../_shared/age-declaration.ts";
import { t, resolveLang } from "../_shared/i18n.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Production mode - payments go through Stripe Connect
const TEST_MODE = false;

// Stripe fee constants (charged to clubs)
const STRIPE_PERCENT = 0.015;
const STRIPE_FIXED_CENTS = 25;

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-TABLE-CHECKOUT] ${step}`, details ? JSON.stringify(details) : "");
};

const generateQRCode = () => {
  // Cryptographically-random, unguessable code (Deno global crypto). A QR code is
  // a door credential — it must not be guessable from a timestamp.
  return `VP-${crypto.randomUUID()}`;
};

serve(async (req) => {
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

    // Parse request body first to get potential guest checkout data
    const { 
      eventId, 
      packId, 
      zoneId, 
      guestCount, 
      fullName, 
      phone, 
      remarks, 
      newsletterOptIn,
      smsOptIn,
      promoCode,
      // Renommé : le promoteur effectif est résolu plus bas (par id fourni, sinon
      // par code) et porté par la variable `promoterId`.
      promoterId: rawPromoterId,
      cancelUrl,
      // Guest checkout fields
      guestEmail,
      guestFullName,
      guestPhone,
      // Placement fields
      requestedTableId,
      placementStatus,
      // Source tracking
      purchaseSource, trackedLinkId,
      // Déclaration sur l'honneur de majorité
      ageDeclaration,
      // Pré-commande de bouteilles (préparées pour l'arrivée, réglées à la table)
      preOrderBottles,
      // Langue de l'acheteur pour les messages d'erreur (en/fr/es)
      language,
    } = await req.json();
    const lang = resolveLang(language);

    const ALLOWED_SOURCES = ['venue_profile','organizer_profile','dj_profile','explore','promoter','direct'];
    // Default to 'direct' so analytics never show "unknown" — every reservation has a source.
    const safePurchaseSource = ALLOWED_SOURCES.includes(purchaseSource) ? purchaseSource : 'direct';
    // Tracked-link attribution: a UUID or null. Stamped onto the reservation post-create.
    const safeTrackedLinkId = (typeof trackedLinkId === 'string' && /^[0-9a-f-]{36}$/i.test(trackedLinkId)) ? trackedLinkId : null;

    // ── Déclaration sur l'honneur de majorité (bouteilles / bottle service) ───
    // Obligatoire et enregistrée côté serveur, comme pour la commande de boissons.
    // Le vrai contrôle d'identité reste fait par l'établissement à l'entrée.
    let ageRecord: { declaredAt: string; birthDate: string | null; ip: string | null };
    try {
      ageRecord = resolveAgeDeclaration(ageDeclaration, req);
    } catch (e) {
      if (e instanceof AgeDeclarationError) {
        logStep("Age declaration missing — table checkout refused");
        return new Response(
          JSON.stringify({
            success: false,
            error: "Vous devez certifier être majeur. L'établissement vérifiera votre pièce d'identité à l'entrée.",
            code: AGE_DECLARATION_REQUIRED_CODE,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
      throw e;
    }

    // Try to authenticate user
    let user: { id: string; email: string | null } | null = null;
    const authHeader = req.headers.get("Authorization");
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
      if (!userError && userData.user) {
        user = { id: userData.user.id, email: userData.user.email ?? null };
      }
    }

    // Guest checkout: true guest mode — no account creation
    const isGuestCheckout = !user && !!guestEmail;
    if (!user) {
      const checkoutEmail = guestEmail;
      const checkoutFullName = guestFullName || fullName;
      const checkoutPhone = guestPhone || phone;

      if (!checkoutEmail || !checkoutFullName || !checkoutPhone) {
        throw new Error("Authentication required or complete guest information needed");
      }

      logStep("Guest checkout — no account creation", { email: checkoutEmail });
    }

    logStep("User/guest mode resolved", { userId: user?.id, email: user?.email, isGuest: isGuestCheckout });

    // ── Payments kill-switch + demo bypass ────────────────────────────────────
    // Demo (@womber.fr) → simulate a paid reservation with NO Stripe (reuses the
    // TEST_MODE fulfillment below). Real buyer while the kill-switch is ON →
    // refuse before any reservation row is created. Authenticated buyer only.
    const paymentMode = (await resolvePaymentMode(supabaseAdmin, user?.email)).mode;
    if (paymentMode === "blocked") {
      logStep("Payments disabled — checkout refused");
      return new Response(
        JSON.stringify({ success: false, error: "Payments are temporarily unavailable. Please try again later.", code: PAYMENTS_DISABLED_CODE }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }
    const simulate = TEST_MODE || paymentMode === "simulate";

    if (!eventId || !packId) throw new Error("Missing required fields");

    logStep("Request parsed", { eventId, packId, zoneId, guestCount, promoCode });

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, title, venue_id, organizer_user_id, partner_venue_id, partner_organizer_id, event_mode, revenue_split_rules, revenue_split_proposal, split_approved_by_venue, split_approved_by_organizer, is_active, is_bde, tables_mode, tables_enabled, end_at")
      .eq("id", eventId)
      .single();
    if (!event || !event.is_active) throw new Error("Event not found or inactive");
    if (!event.tables_enabled) throw new Error("Table sales not enabled for this event");
    // Une soirée terminée ne se vend plus — même garde que create-ticket-checkout.
    if (event.end_at && new Date(event.end_at) < new Date()) {
      throw new Error("L'événement est déjà terminé");
    }

    logStep("Event found", { eventId: event.id, venueId: event.venue_id, mode: event.event_mode, tablesMode: event.tables_mode });

    const isBasicMode = event.tables_mode === 'basic';
    const effectiveVenueId = event.venue_id || event.partner_venue_id;
    if (!effectiveVenueId) {
      throw new Error("Les tables VIP nécessitent un club partenaire.");
    }
    const effectiveOrganizerId = event.organizer_user_id || event.partner_organizer_id;

    // Check if customer is banned from this venue (account-level OR email-level,
    // including guest checkout). Scoped to effectiveVenueId — never crosses clubs.
    {
      const buyerEmail = user?.email || guestEmail || null;

      if (user) {
        const { data: bannedCustomer } = await supabaseAdmin
          .from("venue_customers")
          .select("is_banned")
          .eq("venue_id", effectiveVenueId)
          .eq("user_id", user.id)
          .eq("is_banned", true)
          .maybeSingle();
        if (bannedCustomer?.is_banned) {
          logStep("Customer is banned (account)", { userId: user.id, venueId: effectiveVenueId });
          throw new Error("Vous n'êtes pas autorisé à réserver une table dans ce club.");
        }
      }

      if (buyerEmail) {
        const { data: emailBanned } = await supabaseAdmin.rpc("is_email_banned", {
          p_venue_id: effectiveVenueId, p_email: buyerEmail,
        });
        if (emailBanned === true) {
          logStep("Customer is banned (email)", { venueId: effectiveVenueId });
          throw new Error("Vous n'êtes pas autorisé à réserver une table dans ce club.");
        }
      }
    }

    // Pack lookup: in basic mode, validate it's scoped to this event
    const packQuery = supabaseAdmin.from("table_packs").select("*").eq("id", packId);
    const { data: pack } = await packQuery.single();
    if (!pack || !pack.is_active) throw new Error("Table pack not found or inactive");
    if (isBasicMode && pack.event_id !== eventId) {
      throw new Error("Pack invalide pour cette soirée.");
    }

    logStep("Pack found", { packId: pack.id, packName: pack.name, basic: isBasicMode });

    // ===== ZONE CAPACITY GUARD =====
    // Prevent overselling: count active reservations in the target zone and block when
    // the zone's `tables_count` is reached. Each reservation consumes exactly 1 table slot.
    const effectiveZoneId = zoneId || pack.zone_id;
    if (effectiveZoneId) {
      const { data: zoneRow } = await supabaseAdmin
        .from("table_zones")
        .select("id, name, tables_count")
        .eq("id", effectiveZoneId)
        .maybeSingle();

      if (zoneRow && zoneRow.tables_count && zoneRow.tables_count > 0) {
        // Count reservations on this zone for this event that hold a slot.
        // Statuses considered as "holding a slot": pending (in checkout), paid, confirmed.
        // Note: pending older than ~30min are flushed by the order cleanup cron.
        const { count: activeCount } = await supabaseAdmin
          .from("table_reservations")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("zone_id", effectiveZoneId)
          .in("status", ["pending", "paid", "confirmed"]);

        const used = activeCount || 0;
        if (used >= zoneRow.tables_count) {
          logStep("Zone capacity reached", { zoneId: effectiveZoneId, used, max: zoneRow.tables_count });
          throw new Error(
            `La zone "${zoneRow.name}" est complète (${used}/${zoneRow.tables_count} tables réservées). ` +
            `Choisis une autre zone ou réessaie plus tard.`
          );
        }
        logStep("Zone capacity OK", { zoneId: effectiveZoneId, used, max: zoneRow.tables_count });
      }
    }

    const { data: venue } = await supabaseAdmin.from("venues").select("id, name, stripe_account_id, stripe_charges_enabled").eq("id", effectiveVenueId).single();
    if (!venue) throw new Error("Venue not found");

    // Resolve organizer Stripe account if co-event
    let organizerStripeAccountId: string | null = null;
    let partnershipRules: Record<string, unknown> | null = null;
    let partnershipId: string | null = null;
    if (effectiveOrganizerId && event.event_mode !== 'solo_venue' && event.event_mode !== 'solo_organizer') {
      const { data: orgProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", effectiveOrganizerId)
        .maybeSingle();
      organizerStripeAccountId = orgProfile?.stripe_connect_account_id ?? null;

      const { data: partnership } = await supabaseAdmin
        .from("venue_organizer_partnerships")
        .select("id, default_split_rules")
        .eq("venue_id", effectiveVenueId)
        .eq("organizer_user_id", effectiveOrganizerId)
        .eq("status", "active")
        .maybeSingle();
      partnershipRules = (partnership?.default_split_rules as Record<string, unknown>) ?? null;
      partnershipId = partnership?.id ?? null;
    }

    // CONTRACT GUARD (1/2): block checkout while a split proposal awaits bilateral approval.
    if (event.revenue_split_proposal && !(event.split_approved_by_venue && event.split_approved_by_organizer)) {
      logStep("Checkout refused — collab split proposal pending", { eventId: event.id });
      throw new Error(t("checkout.collabContractPending", lang));
    }
    // CONTRACT GUARD (2/2): a co-event with NO agreed split at all must not sell.
    // The invitation-onboarding path links partner_venue_id / partner_organizer_id
    // without creating a contract; without this check, sales would open on a
    // hardcoded default split that neither party ever signed.
    // revenue_split_rules is only ever written by a doubly-signed contract.
    const isCoEventForGuard =
      ["co_event", "venue_rental", "org_hosted"].includes(event.event_mode ?? "") ||
      (event.venue_id && event.partner_organizer_id) ||
      (event.organizer_user_id && event.partner_venue_id);
    if (isCoEventForGuard && !event.revenue_split_rules && !event.revenue_split_proposal) {
      logStep("Checkout refused — co-event without signed split contract", { eventId: event.id, eventMode: event.event_mode });
      throw new Error(t("checkout.collabContractMissing", lang));
    }

    logStep("Venue found", { 
      venueId: venue.id, 
      stripeAccountId: venue.stripe_account_id,
      chargesEnabled: venue.stripe_charges_enabled 
    });

    // Create or update venue customer (only for authenticated users)
    const nameParts = (fullName || guestFullName || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    if (user) {
      await supabaseAdmin.rpc('get_or_create_venue_customer', {
        p_venue_id: effectiveVenueId,
        p_user_id: user.id,
        p_email: user.email,
        p_first_name: firstName,
        p_last_name: lastName,
        p_phone: phone,
      });
    }

    // SERVER-SIDE PRICE VALIDATION: Calculate deposit and total from database values
    // Schema: table_packs has base_price, base_capacity, extra_person_price, deposit, deposit_type
    // event_table_settings has preset_id (links to table_pack_presets) and custom_prices (JSONB array)
    // table_pack_presets has packs (JSONB array with packId and customPrice)
    
    let priceOverride: number | null = null;
    
    // Check for event-specific price override
    const { data: eventTableSetting } = await supabaseAdmin
      .from("event_table_settings")
      .select("preset_id, custom_prices")
      .eq("event_id", eventId)
      .maybeSingle();

    if (eventTableSetting?.preset_id) {
      // Check preset for custom price
      const { data: preset } = await supabaseAdmin
        .from("table_pack_presets")
        .select("packs")
        .eq("id", eventTableSetting.preset_id)
        .maybeSingle();
      
      if (preset?.packs && Array.isArray(preset.packs)) {
        const packOverride = preset.packs.find((p: { packId: string; customPrice: number | null }) => p.packId === packId);
        if (packOverride?.customPrice !== null && packOverride?.customPrice !== undefined) {
          priceOverride = packOverride.customPrice;
        }
      }
    } else if (eventTableSetting?.custom_prices && Array.isArray(eventTableSetting.custom_prices)) {
      // Check custom_prices array
      const customPrice = eventTableSetting.custom_prices.find((p: { packId: string; customPrice: number | null }) => p.packId === packId);
      if (customPrice?.customPrice !== null && customPrice?.customPrice !== undefined) {
        priceOverride = customPrice.customPrice;
      }
    }

    // Determine base price: event override > pack default
    const basePrice = priceOverride ?? Number(pack.base_price);
    const extraPersonPrice = Number(pack.extra_person_price) || 0;
    
    // Calculate extra person charges
    const validGuestCount = parseInt(guestCount) || pack.base_capacity;
    const extraPeople = Math.max(0, validGuestCount - pack.base_capacity);
    const extraCharges = extraPeople * extraPersonPrice;
    
    // Calculate total price from database values
    const serverTotalPrice = basePrice + extraCharges;
    
    // Calculate deposit from database values (deposit and deposit_type)
    let serverDeposit: number;
    const depositValue = Number(pack.deposit) || 0;
    const depositType = pack.deposit_type || 'fixed';
    
    if (depositType === 'percentage' && depositValue > 0) {
      serverDeposit = Math.round(serverTotalPrice * (depositValue / 100) * 100) / 100;
    } else if (depositValue > 0) {
      serverDeposit = depositValue;
    } else {
      serverDeposit = serverTotalPrice; // Full payment if no deposit configured
    }

    // Résolution du promoteur à partir de son CODE, comme create-ticket-checkout.
    // Elle manquait totalement ici : la fonction n'acceptait qu'un promoterId, que
    // le client ne peut pas fournir (la table promoters lui est fermée par RLS).
    // Aucune vente de table n'était donc jamais attribuée. Le périmètre couvre le
    // club hôte, le club partenaire, l'organisateur et l'organisateur partenaire.
    let promoterId: string | null = rawPromoterId || null;
    if (!promoterId && promoCode) {
      const scopeOr: string[] = [];
      if (event.venue_id) scopeOr.push(`venue_id.eq.${event.venue_id}`);
      if (event.partner_venue_id) scopeOr.push(`venue_id.eq.${event.partner_venue_id}`);
      if (event.organizer_user_id) scopeOr.push(`organizer_user_id.eq.${event.organizer_user_id}`);
      if (event.partner_organizer_id) scopeOr.push(`organizer_user_id.eq.${event.partner_organizer_id}`);
      if (scopeOr.length > 0) {
        const { data: byCode, error: byCodeErr } = await supabaseAdmin
          .from("promoters")
          .select("id")
          .or(scopeOr.join(","))
          .ilike("promo_code", String(promoCode).trim())
          .eq("is_active", true)
          .limit(1);
        if (byCodeErr) logStep("Promoter lookup by code failed", { error: byCodeErr.message });
        promoterId = byCode?.[0]?.id ?? null;
        logStep("Promoter resolved by code", { promoCode, promoterId });
      }
    }

    // Validate promoter discount from database if provided
    let validatedDiscount = 0;
    if (promoterId && promoCode) {
      const { data: promoter } = await supabaseAdmin
        .from("promoters")
        .select("table_discount_type, table_discount_value, is_active")
        .eq("id", promoterId)
        .eq("is_active", true)
        .maybeSingle();

      if (promoter) {
        if (promoter.table_discount_type === 'percentage' && promoter.table_discount_value) {
          validatedDiscount = Math.round(serverDeposit * (promoter.table_discount_value / 100) * 100) / 100;
        } else if (promoter.table_discount_type === 'fixed' && promoter.table_discount_value) {
          validatedDiscount = Math.min(promoter.table_discount_value, serverDeposit);
        }
      }
    }

    const discountedDeposit = serverDeposit - validatedDiscount;
    
    // Service fee: min(cap, max(floor, 4% of deposit)). BDE events get a reduced
    // floor (0.49€ vs 0.99€). The 25€ cap is table-only and binds above a 625€
    // charge — see _shared/commission.ts for why tables are capped and tickets aren't.
    const commissionMin = event.is_bde ? YUNO_COMMISSION_MIN_BDE : YUNO_COMMISSION_MIN;
    let serviceFeeBase: number;
    if (discountedDeposit > 0) {
      serviceFeeBase = discountedDeposit * YUNO_COMMISSION_RATE;
    } else {
      serviceFeeBase = (serverTotalPrice / 2) * YUNO_COMMISSION_RATE;
    }
    const managementFee = Math.round(
      Math.min(YUNO_COMMISSION_MAX, Math.max(commissionMin, serviceFeeBase)) * 100,
    ) / 100;

    // Fee absorption (co-event: the CLUB / effectiveVenueId is seller of record).
    // When absorbed, the fan does not pay the management fee on top — it comes out of
    // the club's net via the split. Default false → unchanged behavior.
    const feeAbsorbed = await getAbsorbYunoFees(supabaseAdmin, effectiveVenueId);

    // total_price = table price (spending budget), NOT including management fees
    const finalTotalPrice = serverTotalPrice - validatedDiscount;
    const yunoCommission = Math.round(managementFee * 100);
    const qrCode = generateQRCode();

    logStep("Prices calculated server-side", { 
      basePrice,
      extraCharges,
      serverTotalPrice,
      serverDeposit,
      validatedDiscount,
      discountedDeposit,
      managementFee, 
      finalTotalPrice,
      yunoCommission 
    });

    if (simulate) {
      logStep("SIMULATE: Creating paid reservation directly (demo or test mode)");

      // Atomic: locks the governing zone, re-counts under the lock, then inserts.
      // See migration 20260616130000_reserve_table_slot_atomic.sql.
      const { data: reservationId, error: reservationError } = await supabaseAdmin.rpc("reserve_table_slot", {
        _event_id: eventId,
        _zone_id: zoneId,
        _capacity_zone_id: effectiveZoneId,
        _pack_id: packId,
        _user_id: user?.id || null,
        _user_email: user?.email || guestEmail || "",
        _is_guest: isGuestCheckout,
        _guest_count: validGuestCount,
        _deposit: discountedDeposit,
        _total_price: finalTotalPrice,
        _management_fee: managementFee,
        _status: "paid",
        _qr_code: qrCode,
        _full_name: fullName,
        _phone: phone,
        _remarks: remarks,
        _newsletter_opt_in: newsletterOptIn,
        _sms_opt_in: !!smsOptIn,
        _requested_table_id: requestedTableId || null,
        _placement_status: placementStatus || "none",
        _purchase_source: safePurchaseSource,
        _fee_absorbed: feeAbsorbed,
      });

      if (reservationError || !reservationId) {
        logStep("Error creating reservation", { error: reservationError?.message });
        // Surface the zone-full message (and any other guard) to the client.
        throw new Error(reservationError?.message || "Failed to create reservation");
      }
      const reservation = { id: reservationId as string };
      if (safeTrackedLinkId) {
        await supabaseAdmin.from("table_reservations").update({ tracked_link_id: safeTrackedLinkId }).eq('id', reservation.id);
      }
      await supabaseAdmin.from("table_reservations").update({
        age_declared_at: ageRecord.declaredAt,
        age_declaration_birth_date: ageRecord.birthDate,
        age_declaration_ip: ageRecord.ip,
      }).eq('id', reservation.id);

      // Pré-commande : enregistre les bouteilles choisies au checkout comme commande table
      // (préparée pour l'arrivée, réglée à la table). Non bloquant.
      if (Array.isArray(preOrderBottles) && preOrderBottles.length > 0) {
        try {
          const poTotal = preOrderBottles.reduce((s: number, b: any) => s + (Number(b.unitPrice) || 0) * (Number(b.quantity) || 0), 0);
          const { data: poOrder, error: poErr } = await supabaseAdmin
            .from("vip_table_orders")
            .insert({
              table_reservation_id: reservation.id,
              venue_id: event.venue_id,
              user_id: user?.id ?? null,
              status: "preorder",
              total_amount: poTotal,
              notes: "Pré-commande (checkout)",
            })
            .select("id")
            .single();
          if (!poErr && poOrder) {
            const poItems = preOrderBottles
              .filter((b: any) => b.menuItemId && (Number(b.quantity) || 0) > 0)
              .map((b: any) => ({
                order_id: poOrder.id,
                menu_item_id: b.menuItemId,
                quantity: Number(b.quantity),
                unit_price: Number(b.unitPrice) || 0,
                is_included: false,
              }));
            if (poItems.length > 0) await supabaseAdmin.from("vip_table_order_items").insert(poItems);
          } else if (poErr) {
            logStep("Pre-order insert failed (non-blocking)", { error: poErr.message });
          }
        } catch (e) {
          logStep("Pre-order exception (non-blocking)", { error: String(e) });
        }
      }

      // Consentement SMS : profil de l'acheteur + liste VIP du club (helper partagé,
      // même écriture que sur le chemin Stripe live via verify-table-payment).
      // `guestEmail` et non `email` : ce dernier n'existe pas dans cette portée — la
      // version précédente plantait sur un ReferenceError dès qu'un acheteur cochait
      // la case SMS sur une table.
      if (smsOptIn) {
        await recordSmsConsent(supabaseAdmin, {
          venueId: event.venue_id,
          userId: user?.id ?? null,
          phone,
          fullName,
          email: user?.email ?? guestEmail ?? null,
          eventId: event.id,
          isVip: true,
          source: 'table_checkout',
        });
      }

      // Create promoter conversion if applicable — even when the promoter code
      // carries no customer discount (the promoter still drove the booking).
      // Same RPC as the live Stripe path (verify-table-payment): template
      // engine, agency caps and team-leader override all apply.
      if (promoterId) {
        const { data: convResult, error: conversionError } = await supabaseAdmin.rpc('record_promoter_conversion', {
          p_promoter_id: promoterId,
          p_conversion_type: 'table',
          p_amount: finalTotalPrice,
          p_event_id: eventId,
          p_table_reservation_id: reservation.id,
        });
        if (conversionError) {
          logStep("Error creating promoter conversion", { error: conversionError.message });
        } else {
          logStep("Promoter conversion recorded", convResult);
        }
      }

      // Increment venue customer stats atomically
      await supabaseAdmin.rpc('increment_venue_customer_stats', {
        p_venue_id: effectiveVenueId,
        p_user_id: user.id,
        p_order_delta: 0,
        p_ticket_delta: 0,
        p_table_delta: 1,
        p_spent_delta: finalTotalPrice,
      });
      logStep("Venue customer stats incremented", { venueId: effectiveVenueId, spent: finalTotalPrice });

      // Award loyalty points
      let pointsEarned = 0;
      try {
        const { data: pointsData } = await supabaseAdmin.rpc('award_loyalty_points', {
          p_venue_id: effectiveVenueId,
          p_user_id: user.id,
          p_amount: finalTotalPrice,
          p_reference_type: 'table',
          p_reference_id: reservation.id,
          p_description: 'VIP table reservation',
        });
        pointsEarned = pointsData || 0;
        logStep("Loyalty points awarded", { pointsEarned, venueId: effectiveVenueId });
      } catch (loyaltyError) {
        logStep("Error awarding loyalty points (non-blocking)", { error: String(loyaltyError) });
      }

      // ── Notif owner + organizer : nouvelle réservation VIP ──────────────────
      // Le chemin Stripe passe par verify-table-payment (qui envoie la notif). En mode
      // démo/simulate la résa est payée ici sans passer par verify-table-payment : il faut
      // donc déclencher la notif ici, sinon l'owner ne reçoit rien. Non bloquant.
      try {
        const packName = pack.name || 'Table VIP';
        const depositFormatted = Number(discountedDeposit ?? finalTotalPrice ?? 0).toFixed(2);
        const notifMessage = `${packName} · ${fullName || 'Client'} · ${validGuestCount || 1} pers. — ${depositFormatted} €`;
        const notifMeta = {
          pack_name: packName,
          guest_count: validGuestCount,
          deposit: discountedDeposit,
          total_price: finalTotalPrice,
          full_name: fullName,
        };
        if (effectiveVenueId) {
          await supabaseAdmin.from('staff_notifications').insert({
            venue_id: effectiveVenueId,
            target_role: 'owner',
            notification_type: 'table_booked',
            title: 'Nouvelle réservation VIP',
            message: notifMessage,
            priority: 'high',
            reference_type: 'table_reservation',
            reference_id: reservation.id,
            event_id: eventId ?? null,
            metadata: notifMeta,
          });
        }
        if (effectiveOrganizerId) {
          await supabaseAdmin.from('organizer_notifications').insert({
            organizer_user_id: effectiveOrganizerId,
            notification_type: 'table_booked',
            title: 'Nouvelle réservation VIP',
            message: notifMessage,
            priority: 'high',
            reference_type: 'table_reservation',
            reference_id: reservation.id,
            event_id: eventId ?? null,
            metadata: notifMeta,
          });
        }
        logStep("Owner/organizer VIP reservation notification sent (demo path)");
      } catch (notifErr) {
        console.error('VIP reservation notif error (demo, non-blocking):', notifErr);
      }

      // Send VIP request_received email
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-vip-confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ reservation_id: reservation.id, type: 'request_received' })
        });
        logStep("VIP request_received email sent");
      } catch (vipEmailError) {
        console.error('Error sending VIP email:', vipEmailError);
      }

      logStep("TEST MODE: Reservation created successfully", { reservationId: reservation.id, pointsEarned });

      return new Response(JSON.stringify({ 
        success: true, 
        testMode: true, 
        reservationId: reservation.id, 
        qrCode, 
        redirectUrl: `/order-confirmation?type=table&id=${reservation.id}`,
        pointsEarned,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // PRODUCTION MODE: Create Stripe checkout session
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    if (!venue.stripe_account_id) throw new Error("Ce club n'a pas encore configuré ses paiements.");
    if (!venue.stripe_charges_enabled) throw new Error("Le compte Stripe du club n'est pas encore activé.");

    // Atomic: locks the governing zone, re-counts under the lock, then inserts the
    // pending reservation. See migration 20260616130000_reserve_table_slot_atomic.sql.
    const { data: reservationId, error: reservationError } = await supabaseAdmin.rpc("reserve_table_slot", {
      _event_id: eventId,
      _zone_id: zoneId,
      _capacity_zone_id: effectiveZoneId,
      _pack_id: packId,
      _user_id: user?.id || null,
      _user_email: user?.email || guestEmail || "",
      _is_guest: isGuestCheckout,
      _guest_count: validGuestCount,
      _deposit: discountedDeposit,
      _total_price: finalTotalPrice,
      _management_fee: managementFee,
      _status: "pending",
      _qr_code: qrCode,
      _full_name: fullName,
      _phone: phone,
      _remarks: remarks,
      _newsletter_opt_in: newsletterOptIn,
      _sms_opt_in: !!smsOptIn,
      _requested_table_id: requestedTableId || null,
      _placement_status: placementStatus || "none",
      _purchase_source: safePurchaseSource,
      _fee_absorbed: feeAbsorbed,
    });

    if (reservationError || !reservationId) {
      logStep("Error creating pending reservation", { error: reservationError?.message });
      // Surface the zone-full message (and any other guard) to the client.
      throw new Error(reservationError?.message || "Failed to create reservation");
    }
    const reservation = { id: reservationId as string };
    if (safeTrackedLinkId) {
      await supabaseAdmin.from("table_reservations").update({ tracked_link_id: safeTrackedLinkId }).eq('id', reservation.id);
    }
    await supabaseAdmin.from("table_reservations").update({
      age_declared_at: ageRecord.declaredAt,
      age_declaration_birth_date: ageRecord.birthDate,
      age_declaration_ip: ageRecord.ip,
    }).eq('id', reservation.id);

    // Pré-commande : enregistre les bouteilles choisies au checkout comme commande table
    // (préparée pour l'arrivée, réglée à la table). Non bloquant ; survit au pending->paid.
    if (Array.isArray(preOrderBottles) && preOrderBottles.length > 0) {
      try {
        const poTotal = preOrderBottles.reduce((s: number, b: any) => s + (Number(b.unitPrice) || 0) * (Number(b.quantity) || 0), 0);
        const { data: poOrder, error: poErr } = await supabaseAdmin
          .from("vip_table_orders")
          .insert({
            table_reservation_id: reservation.id,
            venue_id: event.venue_id,
            user_id: user?.id ?? null,
            status: "preorder",
            total_amount: poTotal,
            notes: "Pré-commande (checkout)",
          })
          .select("id")
          .single();
        if (!poErr && poOrder) {
          const poItems = preOrderBottles
            .filter((b: any) => b.menuItemId && (Number(b.quantity) || 0) > 0)
            .map((b: any) => ({
              order_id: poOrder.id,
              menu_item_id: b.menuItemId,
              quantity: Number(b.quantity),
              unit_price: Number(b.unitPrice) || 0,
              is_included: false,
            }));
          if (poItems.length > 0) await supabaseAdmin.from("vip_table_order_items").insert(poItems);
        } else if (poErr) {
          logStep("Pre-order insert failed (non-blocking)", { error: poErr.message });
        }
      } catch (e) {
        logStep("Pre-order exception (non-blocking)", { error: String(e) });
      }
    }

    logStep("Pending reservation created", { reservationId: reservation.id });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    // App native (Capacitor) : origine capacitor://localhost refusée par Stripe
    // dans les URLs de retour → rebasculer sur le domaine web + flag native=1.
    const rawOrigin = req.headers.get("origin") || "https://yunoapp.eu";
    const isNativeApp = rawOrigin.startsWith("capacitor://") || rawOrigin === "https://localhost";
    const origin = isNativeApp ? "https://yunoapp.eu" : rawOrigin;
    const nativeFlag = isNativeApp ? "&native=1" : "";

    // Resolve the Stripe Connect split up front. DIRECT = single recipient → the
    // charge runs ON their connected account (they're the seller of record);
    // SEPARATE = co-event split → charge on the platform + webhook transfers.
    // Absorb: fan pays the Stripe transaction cost instead of the management fee; the
    // club absorbs the commission (taken via the application_fee override). Default: fan
    // pays the management fee, club absorbs the Stripe cost (unchanged).
    const transactionFee = feeAbsorbed ? estimateStripeFeeEur(discountedDeposit) : managementFee;
    const grossAmount = discountedDeposit + transactionFee;
    const split = resolvePaymentSplit({
      itemType: "table",
      grossAmount,
      // ALWAYS pass the commission explicitly: `managementFee` is the exact amount the
      // fan is billed on the "Frais de service" line, so it must be the exact
      // application_fee Yuno collects. Letting resolvePaymentSplit recompute 4% of
      // `grossAmount` would bill 4% of (deposit + fee) — i.e. 4% MORE than displayed,
      // silently taken out of the club's payout (0.48€ on a 300€ deposit). It would
      // also re-derive an uncapped fee, defeating the 25€ table cap.
      yunoFeeCentsOverride: Math.round(managementFee * 100),
      isBde: event.is_bde === true,
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
      venueStripeAccountId: venue.stripe_account_id,
      organizerStripeAccountId,
    });
    const connectedAccountId = split.splitMode === "direct" ? split.primary.accountId : null;
    if (connectedAccountId) {
      await supabaseAdmin.from("table_reservations").update({ stripe_connected_account_id: connectedAccountId }).eq('id', reservation.id);
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        // Only add deposit line if there's a deposit to pay
        ...(discountedDeposit > 0 ? [{ price_data: { currency: "eur", product_data: { name: `${pack.name} - ${event.title}` }, unit_amount: Math.round(discountedDeposit * 100) }, quantity: 1 }] : []),
        // Fan-facing fee line mirrors `transactionFee`: in absorb mode that's the Stripe
        // transaction cost (club absorbs the commission via the application_fee override);
        // in the default path it equals `managementFee`, so this is unchanged.
        { price_data: { currency: "eur", product_data: { name: "Frais de service" }, unit_amount: Math.round(transactionFee * 100) }, quantity: 1 },
      ],
      mode: "payment",
      success_url: `${origin}/verify-table-payment?session_id={CHECKOUT_SESSION_ID}&reservation_id=${reservation.id}${nativeFlag}`,
      cancel_url: cancelUrl ? `${origin}${cancelUrl}` : `${origin}/`,
      customer_email: user?.email || guestEmail,
      payment_method_types: ['card', 'link'],
      metadata: { reservationId: reservation.id, eventId, packId, userId: user?.id || '', venueId: effectiveVenueId, promoterId: promoterId || '', promoCode: promoCode || '', trackedLinkId: safeTrackedLinkId || '', isGuest: isGuestCheckout ? 'true' : 'false' },
      payment_intent_data: (() => {
        const stripeFee = Math.round(split.grossAmountCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
        const transferGroup = `EVENT_${event.id}_TBL_${reservation.id}`;
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
          item_type: "table",
          event_id: event.id,
          reservation_id: reservation.id,
          transfer_group: transferGroup,
          split_rules_applied: JSON.stringify(split.effectiveSplit ?? {}).slice(0, 480),
          venue_pct_applied: split.effectiveSplit ? String(split.effectiveSplit.venue_pct) : "",
          organizer_pct_applied: split.effectiveSplit ? String(split.effectiveSplit.organizer_pct) : "",
          partnership_id: partnershipId ?? "",
        };
        // SEPARATE mode (co-event split): charge stays on the platform, webhook fires
        // a transfer to each connected account. `on_behalf_of` = the venue → the venue
        // is the merchant of record (alcohol/bottle seller; customer statement = venue)
        // even though the platform holds and splits the funds.
        if (split.splitMode === "separate") {
          return {
            ...(split.onBehalfOf ? { on_behalf_of: split.onBehalfOf } : {}),
            transfer_group: transferGroup,
            metadata: sharedMetadata,
          };
        }
        // DIRECT mode: the charge runs ON the recipient's connected account (via the
        // `stripeAccount` request option below). The recipient is the seller of record,
        // pays the Stripe fee, and Yuno collects `yunoFeeCents` as the application fee.
        return {
          application_fee_amount: split.yunoFeeCents,
          transfer_group: transferGroup,
          metadata: sharedMetadata,
        };
      })(),
    }, split.splitMode === "direct" ? { stripeAccount: split.primary.accountId } : undefined);

    logStep("Stripe session created", { 
      sessionId: session.id, 
      yunoCommission,
      destination: venue.stripe_account_id 
    });

    return new Response(JSON.stringify({ success: true, sessionId: session.id, url: session.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
  }
});