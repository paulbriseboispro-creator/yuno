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

    if (new Date(event.end_at || event.start_at) < new Date()) {
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

    // Create order
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
      return new Response(
        JSON.stringify({ error: "Failed to create order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decrement credits across packs (FIFO)
    let remaining = totalQtyNeeded;
    for (const credit of credits) {
      if (remaining <= 0) break;
      const available = credit.total_credits - credit.used_credits;
      if (available <= 0) continue;
      const use = Math.min(available, remaining);
      await supabaseAdmin
        .from("order_pack_credits")
        .update({ used_credits: credit.used_credits + use })
        .eq("id", credit.id);
      remaining -= use;
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
