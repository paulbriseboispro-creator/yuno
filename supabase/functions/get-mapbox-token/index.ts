import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // La carte est affichée sur des pages publiques (Accueil, Événements partagés).
    // Nous n'avons pas besoin d'exiger un token d'authentification car c'est un token public Mapbox.

    const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN") || Deno.env.get("MAPBOX");
    if (!mapboxToken) {
      throw new Error("MAPBOX_PUBLIC_TOKEN or MAPBOX not configured");
    }

    return new Response(
      JSON.stringify({ token: mapboxToken }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
