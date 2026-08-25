// capgo-stats — the OTA "statsUrl" endpoint.
//
// The plugin posts lifecycle + health signals (set, delete, download_complete,
// update_fail, webview_javascript_error with message+stack in `metadata`...).
// It posts them either as a single object OR as a BATCH array — the batch is
// the common case (any launch with 2+ events). We store every event with its
// raw payload so a failed rollout is diagnosable (which devices, which
// version, what failed, with the actual JS stack). Always answers 200 —
// telemetry must never disturb the app.
//
// Leçon du 25/08/2026 (rejet Apple build 28) : l'ancienne version ne parsait
// que l'objet unitaire et jetait les batches — l'erreur fatale du reviewer
// ("supabaseUrl is required.") avait frappé cet endpoint et fini à la poubelle.
//
// Auth: verify_jwt = false.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { admin, json, otaCors, readInfoBatch, logStep } from "../_shared/ota.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: otaCors });

  try {
    const events = await readInfoBatch(req);
    const rows = events
      .filter((e) => e.app_id || e.device_id)
      .slice(0, 50) // borne anti-abus : l'endpoint est public
      .map((e) => ({
        device_id: (e.device_id as string) ?? null,
        app_id: (e.app_id as string) ?? null,
        action: (e.action as string) ?? null,
        version_name: (e.version_name as string) ?? null,
        old_version_name: (e.old_version_name as string) ?? null,
        platform: (e.platform as string) ?? null,
        payload: e,
      }));
    if (rows.length) {
      await admin().from("ota_stats").insert(rows);
    }
  } catch (e) {
    logStep("capgo-stats", "exception", (e as Error).message);
  }
  return json({ status: "ok" });
});
