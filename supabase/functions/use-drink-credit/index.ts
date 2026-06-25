import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Support both single-drink and batch modes
    const eventId = body.eventId;
    const items: { drinkId: string; qty: number }[] = body.items
      ? body.items
      : body.drinkId
        ? [{ drinkId: body.drinkId, qty: 1 }]
        : [];

    if (!eventId || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing eventId or items" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalQtyNeeded = items.reduce((s, i) => s + (i.qty || 1), 0);

    // Fetch all available credits for this user & venue (derive venue from event)
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, title, start_at, end_at, venue_id")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Drink credits are spendable only DURING the event night. Open the window
    // a couple of hours before the official start (early arrivals / doors) and
    // keep it open a couple of hours past the end (bar collection grace). A free
    // welcome drink can't be claimed days early, nor after the party is over.
    const REDEEM_LEAD_MS = 2 * 60 * 60 * 1000;
    const REDEEM_GRACE_MS = 2 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const startMs = new Date(event.start_at).getTime();
    const endMs = new Date(event.end_at || event.start_at).getTime();

    if (nowMs < startMs - REDEEM_LEAD_MS) {
      return new Response(
        JSON.stringify({ error: "Cette conso est utilisable uniquement le soir de l'événement." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (nowMs > endMs + REDEEM_GRACE_MS) {
      return new Response(JSON.stringify({ error: "L'événement est déjà terminé" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const venueId = event.venue_id;

    // Fetch credits with remaining balance, scoped to event and not expired
    const { data: credits, error: creditsError } = await supabaseAdmin
      .from("order_pack_credits")
      .select("*")
      .eq("user_id", user.id)
      .eq("venue_id", venueId)
      .eq("event_id", eventId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });

    if (creditsError || !credits) {
      return new Response(JSON.stringify({ error: "Failed to fetch credits" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const availableCredits = credits.reduce(
      (sum, c) => sum + (c.total_credits - c.used_credits),
      0
    );

    if (availableCredits < totalQtyNeeded) {
      return new Response(
        JSON.stringify({ error: "Not enough credits", available: availableCredits, needed: totalQtyNeeded }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all drinks
    const drinkIds = [...new Set(items.map((i) => i.drinkId))];
    const { data: drinks, error: drinksError } = await supabaseAdmin
      .from("drinks")
      .select("id, name, price, img_url, venue_id")
      .in("id", drinkIds)
      .eq("venue_id", venueId)
      .eq("active", true);

    if (drinksError || !drinks || drinks.length !== drinkIds.length) {
      return new Response(
        JSON.stringify({ error: "Some drinks not found or not from this venue" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const drinkMap = new Map(drinks.map((d) => [d.id, d]));

    // Generate order token
    const orderToken = uuidv4().replace(/-/g, "").substring(0, 16).toUpperCase();
    const tokenExpiresAt = new Date(event.end_at || event.start_at);
    tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 2);

    // Build order items
    const orderItems = items.flatMap((item) => {
      const drink = drinkMap.get(item.drinkId)!;
      return Array.from({ length: item.qty || 1 }, () => ({
        drinkId: drink.id,
        name: drink.name,
        unitPrice: 0,
        qty: 1,
        eventId,
        eventTitle: event.title,
        imgUrl: drink.img_url,
        isCreditRedemption: true,
      }));
    });

    // Consume credits ATOMICALLY and BEFORE creating the order. Each pack is
    // decremented under a row lock via consume_pack_credit (returns the amount
    // actually taken), so two concurrent redemptions can never hand out more
    // free drinks than were purchased. The stale in-memory read above is only a
    // fast fail; this loop is the authoritative guard.
    const releaseAll = async (taken: { id: string; amount: number }[]) => {
      for (const c of taken) {
        await supabaseAdmin.rpc("release_pack_credit", { p_credit_id: c.id, p_amount: c.amount });
      }
    };

    let remaining = totalQtyNeeded;
    const consumed: { id: string; amount: number }[] = [];
    for (const credit of credits) {
      if (remaining <= 0) break;
      const { data: took, error: consumeErr } = await supabaseAdmin.rpc("consume_pack_credit", {
        p_credit_id: credit.id,
        p_want: remaining,
      });
      if (consumeErr) {
        console.error("Credit consume error:", consumeErr);
        await releaseAll(consumed);
        return new Response(
          JSON.stringify({ error: "Failed to consume credits" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const amount = Number(took) || 0;
      if (amount > 0) {
        consumed.push({ id: credit.id, amount });
        remaining -= amount;
      }
    }

    if (remaining > 0) {
      // Lost a race with a concurrent redemption: not enough credits left.
      await releaseAll(consumed);
      return new Response(
        JSON.stringify({ error: "Not enough credits", needed: totalQtyNeeded }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Credits are now reserved — create the order.
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        user_email: user.email,
        venue_id: venueId,
        event_id: eventId,
        items: orderItems,
        total: 0,
        status: "paid",
        paid_at: new Date().toISOString(),
        token: orderToken,
        token_expires_at: tokenExpiresAt.toISOString(),
        token_used: false,
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order creation error:", orderError);
      // The order didn't persist — give the credits back.
      await releaseAll(consumed);
      return new Response(
        JSON.stringify({ error: "Failed to create order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Credits used: ${totalQtyNeeded}, order: ${order.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        orderId: order.id,
        token: orderToken,
        creditsUsed: totalQtyNeeded,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Error in use-drink-credit:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
