// capgo-stats — the OTA "statsUrl" endpoint.
//
// The plugin posts lifecycle + health signals (set, delete, download_complete,
// update_fail, app crashes, JS errors...). We store the raw rows best-effort so
// a failed rollout is diagnosable (which devices, which version, what failed).
// Always answers 200 — telemetry must never disturb the app.
//
// Auth: verify_jwt = false.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { admin, json, otaCors, readInfo, logStep } from "../_shared/ota.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: otaCors });

  try {
    const info = await readInfo(req);
    if (info.app_id || info.device_id) {
      await admin().from("ota_stats").insert({
        device_id: info.device_id ?? null,
        app_id: info.app_id ?? null,
        action: info.action ?? null,
        version_name: info.version_name ?? null,
        old_version_name: info.old_version_name ?? null,
        platform: info.platform ?? null,
      });
    }
  } catch (e) {
    logStep("capgo-stats", "exception", (e as Error).message);
  }
  return json({ status: "ok" });
});
