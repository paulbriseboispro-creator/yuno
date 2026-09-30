import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";

// Jamais déployée, et plus appelée par aucun cron (2026-09-25) : l'archivage
// des commandes non servies tourne en SQL (cron `archive-stale-orders` →
// `archive_expired_event_orders()`). Cette fonction ne garde QUE cet
// archivage. Ses anciennes branches supprimaient des commandes PAYÉES
// (`delete` sur `orders`) et des factures, qui se conservent : ne pas les
// ressusciter.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronAuth = await authorizeCronRequest(req);
  if (!cronAuth.ok) {
    return new Response(JSON.stringify({ error: cronAuth.message }), {
      status: cronAuth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error } = await supabase.rpc("archive_expired_event_orders");
    if (error) throw error;
    return new Response(
      JSON.stringify({ success: true, type: "archive-orders" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
    console.error("[DB-CLEANUP] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
