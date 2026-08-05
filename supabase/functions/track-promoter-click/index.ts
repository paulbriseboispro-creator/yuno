import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[TRACK-PROMOTER-CLICK] ${step}`, details ? JSON.stringify(details) : "");
};

// Empreinte non réversible de l'IP (salée) pour dédupliquer les clics côté
// serveur sans stocker l'IP en clair. La garde sessionStorage du client saute à
// la moindre astuce (nouvel onglet, session effacée, 2e appareil, appel anonyme
// direct) → sans dédup serveur, le dénominateur du taux de conversion gonflait
// et était trivialement falsifiable.
const IP_SALT = "yuno_promoter_click_v1";
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${IP_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { promoCode, venueId, organizerId, eventId, source, userAgent, referrer } = await req.json();
    const normalizedPromoCode = typeof promoCode === "string" ? promoCode.trim().toUpperCase() : "";

    // Le code est obligatoire ; la portée ne l'est plus. Une VUE de linktree/hub
    // (/promoteur/:code) n'a ni club ni soirée : on résout alors le promoteur par
    // le code seul (voir le fallback plus bas) et on enregistre une vue
    // event_id=NULL, source='linktree_view'. Les clics event-scopés restent
    // résolus par leur portée comme avant.
    if (!normalizedPromoCode) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing promoCode" }),
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

    // Fallback VUE linktree : aucune portée fournie → on résout par le code seul.
    // Un code appartient à une personne (multi-clubs possible) : on prend le
    // premier promoteur actif. Sans risque — cette fonction ne compte que des
    // vues/clics, jamais d'argent (les conversions résolvent, elles, par portée).
    if (!promoterId && !resolvedVenueId && !resolvedOrganizerId && !eventId) {
      const { data: p } = await supabaseAdmin
        .from("promoters")
        .select("id")
        .ilike("promo_code", normalizedPromoCode)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
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

    const scopedEventId = typeof eventId === "string" && eventId ? eventId : null;

    // Déduplication serveur : même (promoteur, soirée, IP) sur 6 h = un seul clic.
    // Sans IP (rare), on retombe sur la seule garde client.
    const ip = clientIp(req);
    const ipHash = ip ? await hashIp(ip) : null;
    if (ipHash) {
      const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      let dedup = supabaseAdmin
        .from("promoter_clicks")
        .select("id")
        .eq("promoter_id", promoterId)
        .eq("ip_hash", ipHash)
        .gte("clicked_at", sinceIso)
        .limit(1);
      dedup = scopedEventId ? dedup.eq("event_id", scopedEventId) : dedup.is("event_id", null);
      const { data: existing } = await dedup;
      if (existing && existing.length > 0) {
        logStep("Duplicate click skipped", { promoterId, eventId: scopedEventId });
        return new Response(
          JSON.stringify({ ok: true, found: true, deduped: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
    }

    const { error: insertError } = await supabaseAdmin
      .from("promoter_clicks")
      .insert({
        promoter_id: promoterId,
        event_id: scopedEventId,
        source: typeof source === "string" && source ? source : null,
        user_agent: typeof userAgent === "string" ? userAgent : null,
        referrer: typeof referrer === "string" ? referrer : null,
        ip_hash: ipHash,
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
