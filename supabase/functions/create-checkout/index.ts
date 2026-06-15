import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolvePaymentSplit } from "../_shared/payment-split.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

// Production mode - payments are processed via Stripe
const TEST_MODE = false;

// Yuno commission rate for drinks (3%)
const YUNO_COMMISSION_RATE = 0.03;

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
    const { items, venueId, eventId, cancelUrl, guestEmail, guestFullName, guestPhone } = await req.json();

    if (!items || !venueId || !Array.isArray(items) || items.length === 0) {
      throw new Error("Missing required fields");
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

    // SERVER-SIDE PRICE VALIDATION: Fetch drink prices from database
    const drinkIds = items.map((item: { id: string }) => item.id);
    const { data: drinks, error: drinksError } = await supabaseAdmin
      .from("drinks")
      .select("id, price, promo_price, presale_price, presale_active, name, active, collection")
      .eq("venue_id", venueId)
      .in("id", drinkIds);

    if (drinksError) throw new Error("Failed to fetch drink prices");
    if (!drinks || drinks.length === 0)
      throw new Error("No valid drinks found");

    // Validate all items and calculate server-side total
    let calculatedTotal = 0;
    const validatedItems: ValidatedItem[] = [];

    for (const item of items) {
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

    const { totalDiscount, activeRuleId } = applyCartRules(
      cartRules,
      validatedItems
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
    const clientTotal = discountedTotal + serviceFee;

    logStep("Service fee calculated", {
      discountedTotal,
      serviceFee,
      clientTotal,
      yunoCommission,
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
      status: TEST_MODE ? "paid" : "pending",
      is_guest: isGuest,
    };

    if (isGuest) {
      orderInsert.guest_first_name = guestFirstName;
      orderInsert.guest_last_name = guestLastName;
      orderInsert.guest_phone = guestPhone || null;
    }

    if (TEST_MODE) {
      orderInsert.paid_at = new Date().toISOString();

      logStep("TEST MODE: Creating paid order directly");

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

    // Build line items from validated items with server-side prices
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
      validatedItems.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: {
            name: item.name,
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
        unit_amount: Math.round(serviceFee * 100),
      },
      quantity: 1,
    });

    const origin = req.headers.get("origin") || "https://yuno.app";

    // Create Stripe checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: lineItems,
      mode: "payment",
      success_url: `${origin}/verify-payment?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
      cancel_url: cancelUrl ? `${origin}${cancelUrl}?payment_cancelled=true` : `${origin}/cart?payment_cancelled=true`,
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
        // The "gross" Yuno actually owes to recipients = drinks net (clientTotal − Yuno fee).
        // Yuno fee + Stripe fee always stay on the platform.
        const split = resolvePaymentSplit({
          itemType: "drink",
          grossAmount: clientTotal,
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
        const clientTotalCents = Math.round(clientTotal * 100);
        const stripeFee = Math.round(clientTotalCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
        const applicationFee = split.yunoFeeCents + stripeFee;
        const transferGroup = `EVENT_${eventId || "no-event"}_DR_${order.id}`;
        logStep("Drinks split + fee", {
          mode: split.splitMode,
          gross: split.grossAmountCents,
          yunoFee: split.yunoFeeCents,
          stripeFee,
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
        if (split.splitMode === "separate") {
          // Co-event with two recipients: charge stays on platform, webhook fires both transfers.
          return {
            transfer_group: transferGroup,
            metadata: sharedMetadata,
          } as Stripe.Checkout.SessionCreateParams.PaymentIntentData;
        }
        return {
          application_fee_amount: applicationFee,
          transfer_data: { destination: split.primary.accountId },
          // on_behalf_of makes Stripe debit its processing fee from the connected
          // account, so Yuno keeps exactly `application_fee_amount` (its commission).
          on_behalf_of: split.primary.accountId,
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
        });
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

    const session = await stripe.checkout.sessions.create(sessionParams);

    logStep("Stripe session created", {
      sessionId: session.id,
      yunoCommission,
      totalDiscount,
      clientTotal,
      destination: venue.stripe_account_id,
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
