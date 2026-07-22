import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { promoCode } = await req.json();
    if (!promoCode) {
      return new Response(JSON.stringify({ error: "Missing promoCode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find ALL active promoter profiles matching this promo_code (venue OR organizer scoped)
    const { data: allMatches, error } = await supabase
      .from("promoters")
      .select("id, promo_code, venue_id, organizer_user_id, user_id, first_name, last_name, profile_image_url, created_at")
      .ilike("promo_code", promoCode)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error || !allMatches || allMatches.length === 0) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Un code = une personne (garanti par trigger DB depuis 2026-07). Défense en
    // profondeur pour les données historiques : si deux users partagent encore le
    // code, on ne garde QUE les profils du détenteur le plus ancien — sinon la
    // page mélangeait l'identité de l'un avec les clubs de l'autre.
    const primary = allMatches[0];
    const promoters = allMatches.filter((p) => p.user_id === primary.user_id);

    // Fetch profile name
    let profileName: { first_name: string | null; last_name: string | null } | null = null;
    if (primary.user_id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", primary.user_id)
        .single();
      if (prof) profileName = prof;
    }

    const firstName = profileName?.first_name || primary.first_name || null;
    const lastName = profileName?.last_name || primary.last_name || null;

    // Split scopes
    const venueIds = [...new Set(promoters.map(p => p.venue_id).filter(Boolean) as string[])];
    const organizerIds = [...new Set(promoters.map(p => p.organizer_user_id).filter(Boolean) as string[])];

    // Fetch venues. venues n'a PAS de colonne slug : l'id texte EST le slug
    // public (/club/:id). Sélectionner "slug" faisait échouer toute la requête
    // (42703) en silence → aucun nom/logo de club sur le hub et des cartes
    // d'événement qui retombaient sur la home au clic.
    const { data: venues } = venueIds.length > 0
      ? await supabase.from("venues").select("id, name, logo_url").in("id", venueIds)
      : { data: [] };
    const venueMap = new Map((venues || []).map(v => [v.id, v]));

    // Fetch organizer profiles for org-scoped promoters
    const { data: organizers } = organizerIds.length > 0
      ? await supabase.from("organizer_profiles").select("user_id, display_name, logo_url, slug").in("user_id", organizerIds)
      : { data: [] };
    const organizerMap = new Map((organizers || []).map(o => [o.user_id, o]));

    const now = new Date().toISOString();

    // Linkage authoritative : le linktree ne liste QUE les soirées auxquelles le
    // promoteur est rattaché (promoter_event_assignments, status active). Sans ce
    // filtre il promouvait — et pouvait vendre — des soirées sur lesquelles il ne
    // touchait aucune commission. Le rattachement se fait à l'unité (page Owner)
    // ou en masse via le toggle « Relier à tous les événements » (auto_assign_events,
    // qui backfill les assignations). Aucune assignation ⇒ aucune soirée listée.
    const promoterIds = promoters.map((p) => p.id);
    const { data: assignedRows } = await supabase
      .from("promoter_event_assignments")
      .select("event_id")
      .in("promoter_id", promoterIds)
      .eq("status", "active");
    const assignedEventIds = new Set((assignedRows || []).map((r) => r.event_id));

    // Colonnes du select sur events (utilisées pour le filtrage + sérialisées telles quelles)
    interface PromoterEventRow {
      id: string;
      title: string;
      start_at: string;
      end_at: string | null;
      poster_url: string | null;
      music_genre: string | null;
      ticketing_enabled: boolean | null;
      venue_id: string | null;
      organizer_user_id: string | null;
      partner_organizer_id: string | null;
      partner_venue_id: string | null;
    }

    // Upcoming venue events — le club peut être hôte (venue_id) OU partenaire
    // d'un co-event (partner_venue_id) : les deux comptent pour ses promoteurs.
    let venueEvents: PromoterEventRow[] = [];
    if (venueIds.length > 0) {
      const venueOr = venueIds.flatMap(id => [
        `venue_id.eq.${id}`,
        `partner_venue_id.eq.${id}`,
      ]).join(",");
      const { data } = await supabase
        .from("events")
        .select("id, title, start_at, end_at, poster_url, music_genre, ticketing_enabled, venue_id, organizer_user_id, partner_organizer_id, partner_venue_id")
        .or(venueOr)
        .eq("is_active", true)
        .gte("end_at", now)
        .order("start_at", { ascending: true })
        .limit(30);
      venueEvents = (data || []).filter((e) => assignedEventIds.has(e.id));
    }

    // Upcoming organizer events (lead OR partner)
    let organizerEvents: PromoterEventRow[] = [];
    if (organizerIds.length > 0) {
      const orFilter = organizerIds.flatMap(id => [
        `organizer_user_id.eq.${id}`,
        `partner_organizer_id.eq.${id}`,
      ]).join(",");
      const { data } = await supabase
        .from("events")
        .select("id, title, start_at, end_at, poster_url, music_genre, ticketing_enabled, venue_id, organizer_user_id, partner_organizer_id, partner_venue_id")
        .or(orFilter)
        .eq("is_active", true)
        .gte("end_at", now)
        .order("start_at", { ascending: true })
        .limit(30);
      organizerEvents = (data || []).filter((e) => assignedEventIds.has(e.id));
    }

    // Build venues payload (clubs) — l'id texte du club est son slug public.
    const venuesPayload = venueIds.map(vid => {
      const v = venueMap.get(vid);
      return {
        venue_id: vid,
        venue_name: v?.name || null,
        venue_logo_url: v?.logo_url || null,
        venue_slug: vid,
        events: (venueEvents || []).filter(e => e.venue_id === vid || e.partner_venue_id === vid),
      };
    });

    // Build organizers payload (BDE/orgs)
    const organizersPayload = organizerIds.map(oid => {
      const o = organizerMap.get(oid);
      const evts = organizerEvents.filter(e => e.organizer_user_id === oid || e.partner_organizer_id === oid);
      return {
        organizer_id: oid,
        organizer_name: o?.display_name || null,
        organizer_logo_url: o?.logo_url || null,
        organizer_slug: o?.slug || null,
        events: evts,
      };
    });

    return new Response(
      JSON.stringify({
        promo_code: primary.promo_code,
        first_name: firstName,
        last_name: lastName,
        profile_image_url: primary.profile_image_url,
        venues: venuesPayload,
        organizers: organizersPayload,
        // Backward-compat
        venue_id: primary.venue_id,
        venue_name: primary.venue_id ? venueMap.get(primary.venue_id)?.name || null : null,
        venue_logo_url: primary.venue_id ? venueMap.get(primary.venue_id)?.logo_url || null : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[resolve-promoter-link] error", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
