import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[TRACK-PROMOTER-CLICK] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { promoCode, venueId, organizerId, eventId, source, userAgent, referrer } = await req.json();
    const normalizedPromoCode = typeof promoCode === "string" ? promoCode.trim().toUpperCase() : "";

    if (!normalizedPromoCode || (!venueId && !organizerId && !eventId)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing promoCode or scope (venueId / organizerId / eventId)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Resolve scope from event if needed
    let resolvedVenueId: string | null = venueId || null;
    let resolvedOrganizerId: string | null = organizerId || null;

    if (!resolvedVenueId && !resolvedOrganizerId && eventId) {
      const { data: evt } = await supabaseAdmin
        .from("events")
        .select("venue_id, organizer_user_id, partner_organizer_id, partner_venue_id")
        .eq("id", eventId)
        .maybeSingle();
      if (evt) {
        resolvedVenueId = evt.venue_id || evt.partner_venue_id || null;
        resolvedOrganizerId = evt.organizer_user_id || evt.partner_organizer_id || null;
      }
    }

    // Look up promoter — prefer venue scope first, then organizer
    let promoterId: string | null = null;

    if (resolvedVenueId) {
      const { data: p } = await supabaseAdmin
        .from("promoters")
        .select("id")
        .eq("venue_id", resolvedVenueId)
        .ilike("promo_code", normalizedPromoCode)
        .eq("is_active", true)
        .maybeSingle();
      if (p?.id) promoterId = p.id;
    }

    if (!promoterId && resolvedOrganizerId) {
      const { data: p } = await supabaseAdmin
        .from("promoters")
        .select("id")
        .eq("organizer_user_id", resolvedOrganizerId)
        .ilike("promo_code", normalizedPromoCode)
        .eq("is_active", true)
        .maybeSingle();
      if (p?.id) promoterId = p.id;
    }

    if (!promoterId) {
      logStep("Promoter not found", { promoCode, resolvedVenueId, resolvedOrganizerId, eventId });
      return new Response(
        JSON.stringify({ ok: true, found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from("promoter_clicks")
      .insert({
        promoter_id: promoterId,
        event_id: typeof eventId === "string" && eventId ? eventId : null,
        source: typeof source === "string" && source ? source : null,
        user_agent: typeof userAgent === "string" ? userAgent : null,
        referrer: typeof referrer === "string" ? referrer : null,
      });

    if (insertError) {
      logStep("Insert click error", { promoterId, error: insertError.message });
      return new Response(
        JSON.stringify({ ok: false, error: insertError.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    logStep("Click recorded", { promoterId, resolvedVenueId, resolvedOrganizerId, eventId, source });
    return new Response(
      JSON.stringify({ ok: true, found: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    logStep("Unhandled error", { error: String(err) });
    return new Response(
      JSON.stringify({ ok: false, error: "Unhandled error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
