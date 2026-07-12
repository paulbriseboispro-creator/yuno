import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolvePaymentSplit, estimateStripeFeeEur } from "../_shared/payment-split.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { resolvePaymentMode, PAYMENTS_DISABLED_CODE } from "../_shared/payment-guard.ts";
// Yuno commission rate — single source of truth (3% drinks).
import { YUNO_DRINK_RATE as YUNO_COMMISSION_RATE } from "../_shared/commission.ts";
import { getAbsorbYunoFees } from "../_shared/merchant-fees.ts";
import { resolveAgeDeclaration, AgeDeclarationError, AGE_DECLARATION_REQUIRED_CODE } from "../_shared/age-declaration.ts";

// Production mode - payments are processed via Stripe
const TEST_MODE = false;

// Stripe fee constants (charged to clubs)
const STRIPE_PERCENT = 0.015;
const STRIPE_FIXED_CENTS = 25;

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-CHECKOUT] ${step}`, details ? JSON.stringify(details) : "");
};

interface CartRule {
  id: string;
  rule_type: string;
  trigger_collection: string | null;
  trigger_min_qty: number;
  discount_percent: number | null;
  reward_collection: string | null;
  reward_drink_id: string | null;
  free_qty: number;
}

interface ValidatedItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  collection: string;
  /** 'bottle' = vip_menu_items vendue sans table (Mode Live). */
  kind?: "drink" | "bottle";
  /** Noms des mixers inclus (par unité) — le prix unitaire les inclut déjà. */
  mixers?: string[];
}

/**
 * Apply cart rules (same logic as frontend useCartRules hook)
 * Returns the total discount amount to apply.
 */
function applyCartRules(
  rules: CartRule[],
  items: ValidatedItem[]
): { totalDiscount: number; activeRuleId: string | null } {
  if (!rules.length || !items.length) return { totalDiscount: 0, activeRuleId: null };

  for (const rule of rules) {
    const triggerCol = rule.trigger_collection;
    const rewardCol = rule.reward_collection || triggerCol;
    const matchingTrigger = triggerCol
      ? items.filter((i) => i.collection === triggerCol)
      : items;
    const triggerQty = matchingTrigger.reduce((s, i) => s + i.quantity, 0);

    const isSameCategory =
      !rule.reward_collection || rule.reward_collection === triggerCol;

    if (isSameCategory) {
      const needed = rule.trigger_min_qty + (rule.free_qty || 1);
      if (triggerQty < needed) continue;

      const unitPrices: { price: number }[] = [];
      matchingTrigger.forEach((item) => {
        for (let i = 0; i < item.quantity; i++)
          unitPrices.push({ price: item.price });
      });
      unitPrices.sort((a, b) => a.price - b.price);

      let totalDisc = 0;
      for (
        let i = 0;
        i < Math.min(rule.free_qty || 1, unitPrices.length);
        i++
      ) {
        totalDisc += unitPrices[i].price * ((rule.discount_percent || 0) / 100);
      }
      return { totalDiscount: totalDisc, activeRuleId: rule.id };
    } else {
      if (triggerQty < rule.trigger_min_qty) continue;

      const rewardItems = items.filter((i) => i.collection === rewardCol);
      const rewardQty = rewardItems.reduce((s, i) => s + i.quantity, 0);
      if (rewardQty < 1) continue;

      const rewardPrices: { price: number }[] = [];
      rewardItems.forEach((item) => {
        for (let i = 0; i < item.quantity; i++)
          rewardPrices.push({ price: item.price });
      });
      rewardPrices.sort((a, b) => a.price - b.price);

      let totalDisc = 0;
      for (
        let i = 0;
        i < Math.min(rule.free_qty || 1, rewardPrices.length);
        i++
      ) {
        totalDisc +=
          rewardPrices[i].price * ((rule.discount_percent || 0) / 100);
      }
      return { totalDiscount: totalDisc, activeRuleId: rule.id };
    }
  }

  return { totalDiscount: 0, activeRuleId: null };
}

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

    // Parse request body
    const { items, venueId, eventId, cancelUrl, guestEmail, guestFullName, guestPhone, trackedLinkId, ageDeclaration, purchaseSource } = await req.json();
    // Tracked-link attribution: a UUID or null. Persisted on the order for revenue attribution.
    const safeTrackedLinkId = (typeof trackedLinkId === 'string' && /^[0-9a-f-]{36}$/i.test(trackedLinkId)) ? trackedLinkId : null;
    // Canal d'achat (ex. 'post_checkout_upsell', 'live') — attribution du taux
    // d'attache boissons/billet. Slug court contrôlé, jamais de texte libre client.
    const safePurchaseSource = (typeof purchaseSource === 'string' && /^[a-z0-9_]{1,40}$/.test(purchaseSource)) ? purchaseSource : null;

    if (!items || !venueId || !Array.isArray(items) || items.length === 0) {
      throw new Error("Missing required fields");
    }

    // ── Déclaration sur l'honneur de majorité (alcool) ────────────────────────
    // Obligatoire et enregistrée côté serveur : le front gate déjà, mais on refuse
    // ici aussi pour qu'un appel API direct ne puisse pas vendre d'alcool sans
    // déclaration. Le vrai contrôle d'identité reste fait par l'établissement à l'entrée.
    let ageRecord: { declaredAt: string; birthDate: string | null; ip: string | null };
    try {
      ageRecord = resolveAgeDeclaration(ageDeclaration, req);
    } catch (e) {
      if (e instanceof AgeDeclarationError) {
        logStep("Age declaration missing — checkout refused", { venueId });
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

    // Authenticate user OR handle guest checkout
    let user: { id: string; email: string | null } | null = null;
    let isGuest = false;
    const authHeader = req.headers.get("Authorization");

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData, error: userError } =
        await supabaseClient.auth.getUser(token);
      if (!userError && userData.user) {
        user = { id: userData.user.id, email: userData.user.email ?? null };
        logStep("User authenticated", { userId: user.id, email: user.email });
      }
    }

    // Guest checkout: true guest mode — no account creation
    if (!user && guestEmail) {
      isGuest = true;
      logStep("Guest checkout — no account creation", { guestEmail });
    }

    if (!user && !guestEmail) {
      throw new Error("User not authenticated and no guest info provided");
    }

    logStep("Request parsed", {
      venueId,
      eventId,
      itemsCount: items.length,
      isGuest,
    });

    // ── Payments kill-switch + demo bypass ────────────────────────────────────
    // Demo (@womber.fr) → simulate a paid drink order with NO Stripe (reuses the
    // TEST_MODE fulfillment below). Real buyer while the kill-switch is ON →
    // refuse before any order row is created. Authenticated buyer only.
    const paymentMode = (await resolvePaymentMode(supabaseAdmin, user?.email)).mode;
    if (paymentMode === "blocked") {
      logStep("Payments disabled — checkout refused", { venueId });
      return new Response(
        JSON.stringify({ success: false, error: "Payments are temporarily unavailable. Please try again later.", code: PAYMENTS_DISABLED_CODE }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }
    const simulate = TEST_MODE || paymentMode === "simulate";

    // Extract guest name parts for order storage
    const guestNameParts = guestFullName?.split(" ") || [];
    const guestFirstName = guestNameParts[0] || "";
    const guestLastName = guestNameParts.slice(1).join(" ") || "";

    // If eventId is provided, verify the event exists, is active, and hasn't ended
    // CRITICAL: Drinks can ONLY be sold for events tied to a Yuno club (venue_id) OR for
    // co-events where the partner_venue_id is set (organizer-led events hosted in a Yuno club).
    let eventForSplit: {
      id: string;
      venue_id: string | null;
      organizer_user_id: string | null;
      partner_venue_id: string | null;
      partner_organizer_id: string | null;
      event_mode: string | null;
      revenue_split_rules: Record<string, unknown> | null;
    } | null = null;
    if (eventId) {
      const { data: event, error: eventError } = await supabaseAdmin
        .from("events")
        .select("id, is_active, end_at, venue_id, organizer_user_id, partner_venue_id, partner_organizer_id, event_mode, revenue_split_rules")
        .eq("id", eventId)
        .single();

      if (eventError || !event) throw new Error("Event not found");
      if (!event.is_active) throw new Error("Event is not active");
      if (new Date(event.end_at) < new Date()) throw new Error("L'événement est déjà terminé");

      // Resolve which venue actually hosts the bar (lead venue OR partner venue in a co-event).
      const drinksVenueId = event.venue_id ?? event.partner_venue_id;
      if (!drinksVenueId) {
        throw new Error(
          "Drink sales are only available for events hosted at a Yuno club. Standalone organizer events cannot sell drinks."
        );
      }
      if (drinksVenueId !== venueId) {
        throw new Error("Event does not belong to this venue");
      }
      eventForSplit = {
        id: event.id,
        venue_id: event.venue_id,
        organizer_user_id: event.organizer_user_id,
        partner_venue_id: event.partner_venue_id,
        partner_organizer_id: event.partner_organizer_id,
        event_mode: event.event_mode,
        revenue_split_rules: (event.revenue_split_rules as Record<string, unknown> | null) ?? null,
      };
    }

    // Get venue details including Stripe Connect account
    const { data: venue, error: venueError } = await supabaseAdmin
      .from("venues")
      .select("id, name, stripe_account_id, stripe_charges_enabled")
      .eq("id", venueId)
      .single();

    if (venueError || !venue) throw new Error("Venue not found");

    logStep("Venue found", {
      venueId: venue.id,
      stripeAccountId: venue.stripe_account_id,
      chargesEnabled: venue.stripe_charges_enabled,
    });

    // Partition drinks / bouteilles solo (Mode Live) : les boissons se valident
    // contre `drinks`, les bouteilles contre `vip_menu_items` (une seule source
    // de vérité prix chacune).
    const drinkRequests = items.filter(
      (item: { kind?: string }) => item.kind !== "bottle"
    );
    const bottleRequests = items.filter(
      (item: { kind?: string }) => item.kind === "bottle"
    );

    // SERVER-SIDE PRICE VALIDATION: Fetch drink prices from database
    let calculatedTotal = 0;
    const validatedItems: ValidatedItem[] = [];

    if (drinkRequests.length > 0) {
      const drinkIds = drinkRequests.map((item: { id: string }) => item.id);
      const { data: drinks, error: drinksError } = await supabaseAdmin
        .from("drinks")
        .select("id, price, promo_price, presale_price, presale_active, name, active, collection")
        .eq("venue_id", venueId)
        .in("id", drinkIds);

      if (drinksError) throw new Error("Failed to fetch drink prices");
      if (!drinks || drinks.length === 0)
        throw new Error("No valid drinks found");

      for (const item of drinkRequests) {
        const drink = drinks.find((d: { id: string }) => d.id === item.id);
        if (!drink) throw new Error(`Drink ${item.id} not found in venue`);
        if (!drink.active)
          throw new Error(`Drink ${drink.name} is not available`);

        const quantity = parseInt(item.quantity);
        if (!quantity || quantity < 1 || quantity > 50)
          throw new Error(`Invalid quantity for ${drink.name}`);

        // Price precedence MUST mirror the client (useStore.ts addToCart): presale
        // wins, then promo_price (whenever set), then the regular price. Skipping
        // promo_price here is what charged the client full price on promo drinks.
        const serverPrice =
          drink.presale_active && drink.presale_price
            ? drink.presale_price
            : drink.promo_price
              ? drink.promo_price
              : drink.price;
        calculatedTotal += serverPrice * quantity;

        validatedItems.push({
          id: drink.id,
          name: drink.name,
          price: serverPrice,
          quantity,
          collection: drink.collection || "",
        });
      }
    }

    // BOUTEILLES SOLO (Mode Live) : validées contre vip_menu_items. Gate :
    // venues.solo_bottle_sale_enabled + solo_sale_enabled par item + catégorie
    // vendable. Prix serveur = bouteille + mixers (par unité) — miroir exact du
    // client (useStore.addBottleToCart).
    if (bottleRequests.length > 0) {
      const { data: soloVenue } = await supabaseAdmin
        .from("venues")
        .select("solo_bottle_sale_enabled")
        .eq("id", venueId)
        .single();
      if (!soloVenue?.solo_bottle_sale_enabled)
        throw new Error("Solo bottle sale is not enabled for this venue");

      const bottleIds = bottleRequests.map((item: { id: string }) => item.id);
      const mixerIds = [
        ...new Set(
          bottleRequests.flatMap(
            (item: { mixerIds?: string[] }) => item.mixerIds ?? []
          )
        ),
      ];
      const { data: vipItems, error: vipError } = await supabaseAdmin
        .from("vip_menu_items")
        .select("id, name, brand, volume_cl, category, price, is_active, solo_sale_enabled, needs_mixer, max_mixers")
        .eq("venue_id", venueId)
        .in("id", [...bottleIds, ...mixerIds]);

      if (vipError) throw new Error("Failed to fetch bottle prices");

      for (const item of bottleRequests) {
        const bottle = (vipItems ?? []).find(
          (b: { id: string }) => b.id === item.id
        );
        if (!bottle) throw new Error(`Bottle ${item.id} not found in venue`);
        if (!bottle.is_active || bottle.solo_sale_enabled === false)
          throw new Error(`Bottle ${bottle.name} is not available for solo sale`);
        if (["mixer", "extra"].includes(bottle.category))
          throw new Error(`Item ${bottle.name} cannot be sold as a bottle`);

        const quantity = parseInt(item.quantity);
        if (!quantity || quantity < 1 || quantity > 50)
          throw new Error(`Invalid quantity for ${bottle.name}`);

        const requestedMixerIds: string[] = item.mixerIds ?? [];
        if (requestedMixerIds.length > Math.max(1, bottle.max_mixers ?? 1))
          throw new Error(`Too many mixers for ${bottle.name}`);

        let mixersTotal = 0;
        const mixerNames: string[] = [];
        for (const mixerId of requestedMixerIds) {
          const mixer = (vipItems ?? []).find(
            (m: { id: string }) => m.id === mixerId
          );
          if (!mixer || !mixer.is_active)
            throw new Error(`Mixer ${mixerId} not found in venue`);
          if (!["mixer", "soft"].includes(mixer.category))
            throw new Error(`Item ${mixer.name} is not a mixer`);
          mixersTotal += Number(mixer.price) || 0;
          mixerNames.push(mixer.name);
        }

        const serverPrice =
          Math.round((Number(bottle.price) + mixersTotal) * 100) / 100;
        calculatedTotal += serverPrice * quantity;

        validatedItems.push({
          id: bottle.id,
          name: [bottle.name, bottle.volume_cl ? `${bottle.volume_cl}cl` : null]
            .filter(Boolean)
            .join(" "),
          price: serverPrice,
          quantity,
          collection: "bottle",
          kind: "bottle",
          mixers: mixerNames,
        });
      }
    }

    if (validatedItems.length === 0) throw new Error("No valid items found");

    logStep("Prices validated server-side", {
      calculatedTotal,
      itemsCount: validatedItems.length,
    });

    // SERVER-SIDE CART RULES: Fetch and apply venue cart rules
    const { data: cartRulesData } = await supabaseAdmin
      .from("upsell_cart_rules")
      .select(
        "id, rule_type, trigger_collection, trigger_min_qty, discount_percent, reward_collection, reward_drink_id, free_qty, priority"
      )
      .eq("venue_id", venueId)
      .eq("is_active", true)
      .eq("rule_type", "percentage_discount")
      .order("priority", { ascending: true });

    const cartRules: CartRule[] = (cartRulesData || []).map((r: any) => ({
      ...r,
      discount_percent: r.discount_percent ? Number(r.discount_percent) : null,
      free_qty: r.free_qty ?? 1,
    }));

    // Les règles d'upsell ciblent les collections de boissons — jamais les
    // bouteilles solo (une règle sans trigger_collection ne doit pas offrir
    // une bouteille).
    const { totalDiscount, activeRuleId } = applyCartRules(
      cartRules,
      validatedItems.filter((i) => i.kind !== "bottle")
    );

    const discountedTotal = Math.round((calculatedTotal - totalDiscount) * 100) / 100;

    logStep("Cart rules applied", {
      totalDiscount,
      activeRuleId,
      calculatedTotal,
      discountedTotal,
    });

    // Service fee (3% of discounted drinks total — YUNO_COMMISSION_RATE)
    const serviceFee =
      Math.round(discountedTotal * YUNO_COMMISSION_RATE * 100) / 100;
    const yunoCommission = Math.round(serviceFee * 100);
    // Fee absorption (invisible to the fan — they always pay a "transaction fee" line):
    //  • default  → fan pays the Yuno commission; the club absorbs the Stripe cost.
    //  • absorb   → fan pays only the Stripe transaction cost; the club absorbs the
    //               Yuno commission (taken via the split's application_fee override).
    const feeAbsorbed = await getAbsorbYunoFees(supabaseAdmin, venueId);
    const transactionFee = feeAbsorbed ? estimateStripeFeeEur(discountedTotal) : serviceFee;
    const clientTotal = discountedTotal + transactionFee;

    logStep("Service fee calculated", {
      discountedTotal,
      serviceFee,
      transactionFee,
      clientTotal,
      yunoCommission,
      feeAbsorbed,
    });

    // Build order insert data
    const orderInsert: Record<string, any> = {
      user_id: user?.id || null,
      user_email: user?.email || guestEmail,
      venue_id: venueId,
      event_id: eventId || null,
      items: validatedItems,
      total: clientTotal,
      service_fee: serviceFee,
      fee_absorbed: feeAbsorbed,
      status: simulate ? "paid" : "pending",
      is_guest: isGuest,
      tracked_link_id: safeTrackedLinkId,
      purchase_source: safePurchaseSource,
      // Déclaration sur l'honneur de majorité (contrôle réel par l'établissement à l'entrée).
      age_declared_at: ageRecord.declaredAt,
      age_declaration_birth_date: ageRecord.birthDate,
      age_declaration_ip: ageRecord.ip,
    };

    if (isGuest) {
      orderInsert.guest_first_name = guestFirstName;
      orderInsert.guest_last_name = guestLastName;
      orderInsert.guest_phone = guestPhone || null;
    }

    if (simulate) {
      orderInsert.paid_at = new Date().toISOString();
      // Mint the pickup token here (production mints it in verify-payment) so the
      // simulated order is fully serveable — the barman can scan it in a demo.
      orderInsert.token = crypto.randomUUID().replace(/-/g, "").substring(0, 16).toUpperCase();
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 12);
      orderInsert.token_expires_at = tokenExpiresAt.toISOString();
      orderInsert.token_used = false;

      logStep("SIMULATE: Creating paid order directly (demo or test mode)");

      const { data: order, error: orderError } = await supabaseAdmin
        .from("orders")
        .insert(orderInsert)
        .select()
        .single();

      if (orderError) {
        logStep("Error creating order", { error: orderError.message });
        throw new Error("Failed to create order");
      }

      logStep("TEST MODE: Order created successfully", {
        orderId: order.id,
        total: clientTotal,
        serviceFee,
      });

      return new Response(
        JSON.stringify({
          success: true,
          testMode: true,
          orderId: order.id,
          redirectUrl: `/order/${order.id}/qr`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // PRODUCTION MODE: Create Stripe checkout session
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    if (!venue.stripe_account_id) {
      throw new Error(
        "Ce club n'a pas encore configuré ses paiements. Veuillez contacter le club."
      );
    }

    if (!venue.stripe_charges_enabled) {
      throw new Error(
        "Le compte Stripe du club n'est pas encore activé. Veuillez contacter le club."
      );
    }

    // Create pending order
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert(orderInsert)
      .select()
      .single();

    if (orderError) {
      logStep("Error creating pending order", { error: orderError.message });
      throw new Error("Failed to create order");
    }

    logStep("Pending order created", {
      orderId: order.id,
      orderNumber: order.order_number,
      total: clientTotal,
      serviceFee,
      isGuest,
    });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // ---- Resolve organizer Stripe account & partnership rules for co-event drink splits ----
    let organizerStripeAccountId: string | null = null;
    let partnershipRules: Record<string, unknown> | null = null;
    let partnershipId: string | null = null;
    if (eventForSplit) {
      const orgId = eventForSplit.organizer_user_id ?? eventForSplit.partner_organizer_id;
      const partnerVenueId = eventForSplit.venue_id ?? eventForSplit.partner_venue_id;
      if (orgId && partnerVenueId) {
        const [{ data: orgProfile }, { data: partnership }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("stripe_account_id, stripe_charges_enabled")
            .eq("id", orgId)
            .maybeSingle(),
          supabaseAdmin
            .from("venue_organizer_partnerships")
            .select("id, default_split_rules, status")
            .eq("venue_id", partnerVenueId)
            .eq("organizer_user_id", orgId)
            .eq("status", "active")
            .maybeSingle(),
        ]);
        if (orgProfile?.stripe_account_id && orgProfile?.stripe_charges_enabled) {
          organizerStripeAccountId = orgProfile.stripe_account_id;
        }
        partnershipRules = (partnership?.default_split_rules as Record<string, unknown>) ?? null;
        partnershipId = partnership?.id ?? null;
      }
    }

    // Resolve the Stripe Connect split. Drinks belong to the venue → DIRECT charge on
    // the venue's connected account (the venue is the seller / alcohol merchant of
    // record). Only a co-event with a configured drink split routes to SEPARATE mode.
    const split = resolvePaymentSplit({
      itemType: "drink",
      grossAmount: clientTotal,
      // In absorb mode the gross no longer contains the commission, so pass it explicitly.
      yunoFeeCentsOverride: feeAbsorbed ? Math.round(serviceFee * 100) : undefined,
      event: eventForSplit ?? {
        id: "",
        venue_id: venueId,
        organizer_user_id: null,
        partner_venue_id: null,
        partner_organizer_id: null,
        event_mode: "solo_venue",
        revenue_split_rules: null,
      },
      partnershipRules,
      venueStripeAccountId: venue.stripe_account_id,
      organizerStripeAccountId,
    });
    const connectedAccountId = split.splitMode === "direct" ? split.primary.accountId : null;
    // Direct charges run ON the connected account, so coupons + the Checkout Session
    // must be created with the same stripeAccount context.
    const stripeRequestOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
    if (connectedAccountId) {
      await supabaseAdmin.from("orders").update({ stripe_connected_account_id: connectedAccountId }).eq("id", order.id);
    }

    // Build line items from validated items with server-side prices
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
      validatedItems.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: {
            // Bouteille solo : les mixers inclus apparaissent sur la ligne Stripe.
            name: item.mixers?.length
              ? `${item.name} (+ ${item.mixers.join(", ")})`
              : item.name,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      }));

    // Add service fee as a separate line item visible to the client
    // Discounts are applied via Stripe coupons (see below), not as line items.
    lineItems.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: "Frais de service (3%)",
        },
        // Mirror `transactionFee`, not the raw commission: in absorb mode the fan pays
        // the Stripe transaction cost and the club absorbs the Yuno commission (via the
        // application_fee override). Default path keeps the two equal, so unchanged.
        unit_amount: Math.round(transactionFee * 100),
      },
      quantity: 1,
    });

    // App native (Capacitor) : l'origine est capacitor://localhost, que Stripe
    // refuse dans les URLs de retour. On rebascule sur le domaine web et on
    // flague native=1 pour que la page verify propose le deep-link yuno://.
    const rawOrigin = req.headers.get("origin") || "https://yunoapp.eu";
    const isNativeApp = rawOrigin.startsWith("capacitor://") || rawOrigin === "https://localhost";
    const origin = isNativeApp ? "https://yunoapp.eu" : rawOrigin;
    const nativeFlag = isNativeApp ? "&native=1" : "";

    // Create Stripe checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: lineItems,
      mode: "payment",
      success_url: `${origin}/verify-payment?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}${nativeFlag}`,
      // cancelUrl peut déjà porter une query (ex. /order/upsell?ticket=…) → &.
      cancel_url: cancelUrl ? `${origin}${cancelUrl}${cancelUrl.includes("?") ? "&" : "?"}payment_cancelled=true` : `${origin}/cart?payment_cancelled=true`,
      customer_email: user?.email || guestEmail,
      payment_method_types: ["card", "link"],
      metadata: {
        orderId: order.id,
        orderNumber: order.order_number || "",
        venueId,
        eventId: eventId || "",
        userId: user?.id || "",
        isGuest: isGuest ? "true" : "false",
      },
      payment_intent_data: (() => {
        const clientTotalCents = Math.round(clientTotal * 100);
        const stripeFee = Math.round(clientTotalCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
        const transferGroup = `EVENT_${eventId || "no-event"}_DR_${order.id}`;
        logStep("Drinks split + fee", {
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
          item_type: "drink",
          event_id: eventId || "",
          order_id: order.id,
          transfer_group: transferGroup,
          split_rules_applied: JSON.stringify(split.effectiveSplit ?? {}).slice(0, 480),
          venue_pct_applied: split.effectiveSplit ? String(split.effectiveSplit.venue_pct) : "",
          organizer_pct_applied: split.effectiveSplit ? String(split.effectiveSplit.organizer_pct) : "",
          partnership_id: partnershipId ?? "",
        };
        // SEPARATE mode (co-event drink split): charge stays on the platform, webhook
        // fires a transfer to each connected account. `on_behalf_of` = the venue → the
        // venue is the merchant of record (alcohol seller; customer statement = venue).
        if (split.splitMode === "separate") {
          return {
            ...(split.onBehalfOf ? { on_behalf_of: split.onBehalfOf } : {}),
            transfer_group: transferGroup,
            metadata: sharedMetadata,
          } as Stripe.Checkout.SessionCreateParams.PaymentIntentData;
        }
        // DIRECT mode: the charge runs ON the venue's connected account (via the
        // `stripeAccount` request option below). The venue is the seller of record
        // (and the alcohol merchant), pays the Stripe fee, and Yuno collects
        // `yunoFeeCents` as the application fee.
        return {
          application_fee_amount: split.yunoFeeCents,
          transfer_group: transferGroup,
          metadata: sharedMetadata,
        } as Stripe.Checkout.SessionCreateParams.PaymentIntentData;
      })(),
    };

    // Apply discount as a Stripe coupon if there's a discount
    if (totalDiscount > 0) {
      try {
        const coupon = await stripe.coupons.create({
          amount_off: Math.round(totalDiscount * 100),
          currency: "eur",
          duration: "once",
          name: "Réduction promo",
        }, stripeRequestOptions);
        sessionParams.discounts = [{ coupon: coupon.id }];
        logStep("Stripe coupon created for discount", {
          couponId: coupon.id,
          amountOff: Math.round(totalDiscount * 100),
        });
      } catch (couponError) {
        logStep("Failed to create coupon, proceeding without", {
          error: String(couponError),
        });
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams, stripeRequestOptions);

    logStep("Stripe session created", {
      sessionId: session.id,
      yunoCommission,
      totalDiscount,
      clientTotal,
      mode: split.splitMode,
      destination: split.primary.accountId,
    });

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
