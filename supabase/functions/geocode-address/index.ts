import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Mode: enrich-session — IP → country/city via ipapi.co, store in visitor_sessions
    if (body.mode === "enrich-session" || body.session_id) {
      const { session_id } = body;
      if (!session_id || typeof session_id !== "string") {
        return new Response(JSON.stringify({ error: "invalid session_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const fwd = req.headers.get("x-forwarded-for") || "";
      const ip = (fwd.split(",")[0] || "").trim();
      if (!ip || ip === "127.0.0.1" || ip.startsWith("::")) {
        return new Response(JSON.stringify({ skipped: true, reason: "no_public_ip" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      let geo: any = null;
      try {
        const res = await fetch(`https://ipapi.co/${ip}/json/`, { headers: { "User-Agent": "Yuno-Analytics/1.0" } });
        if (res.ok) geo = await res.json();
      } catch (_) {}
      if (!geo || geo.error) {
        return new Response(JSON.stringify({ skipped: true, reason: "lookup_failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const update: Record<string, unknown> = {};
      if (geo.country_name) update.country = geo.country_name;
      if (geo.country) update.country_code = geo.country;
      if (geo.region) update.region = geo.region;
      if (geo.city) update.city = geo.city;
      if (geo.latitude) update.latitude = geo.latitude;
      if (geo.longitude) update.longitude = geo.longitude;
      if (Object.keys(update).length === 0) {
        return new Response(JSON.stringify({ skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error } = await supabase.from("visitor_sessions").update(update).eq("session_id", session_id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, ...update }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
    
    if (!mapboxToken) {
      console.error('Geocode: MAPBOX_PUBLIC_TOKEN not configured');
      throw new Error("Mapbox token not configured");
    }

    // Mode 1: Reverse geocoding { lat, lng, reverse: true }
    if (body.reverse && body.lat != null && body.lng != null) {
      console.log(`Reverse geocoding: ${body.lat}, ${body.lng}`);
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${body.lng},${body.lat}.json?access_token=${mapboxToken}&types=place&limit=1`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Mapbox error: ${response.statusText}`);
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const city = feature.text || feature.place_name;
        console.log(`Reverse geocoded -> ${city}`);
        return new Response(
          JSON.stringify({ city, name: feature.place_name, success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ city: null, name: null, success: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mode 2: City search { query: "paris" }
    if (body.query && typeof body.query === 'string') {
      console.log(`City search: ${body.query}`);
      const encoded = encodeURIComponent(body.query);
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${mapboxToken}&types=place&limit=10&autocomplete=true&fuzzyMatch=false`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Mapbox error: ${response.statusText}`);
      const data = await response.json();
      
      const queryLower = body.query.toLowerCase();
      const seen = new Set<string>();
      const results = (data.features || [])
        .filter((f: any) => f.text?.toLowerCase().startsWith(queryLower))
        .map((f: any) => ({
          name: f.place_name,
          city: f.text,
          place_name: f.place_name,
          lat: f.center[1],
          lng: f.center[0],
          latitude: f.center[1],
          longitude: f.center[0],
        }))
        .filter((r: any) => {
          if (seen.has(r.place_name)) return false;
          seen.add(r.place_name);
          return true;
        })
        .slice(0, 5);
      
      console.log(`Found ${results.length} cities for "${body.query}"`);
      return new Response(
        JSON.stringify({ results, success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mode 3: Classic address geocoding { address: "..." }
    const address = body.address;
    if (!address || typeof address !== 'string') {
      return new Response(
        JSON.stringify({ error: 'address, query, or lat/lng+reverse is required' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`Geocoding address: ${address}`);
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${mapboxToken}&limit=1&types=address,poi,place`;
    
    const response = await fetch(geocodeUrl);
    if (!response.ok) throw new Error(`Geocoding API error: ${response.statusText}`);

    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Address not found', latitude: null, longitude: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const [longitude, latitude] = data.features[0].center;
    const placeName = data.features[0].place_name;

    return new Response(
      JSON.stringify({ latitude, longitude, formattedAddress: placeName, success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Geocode error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
