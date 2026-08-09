// capgo-updates — the OTA "updateUrl" endpoint.
//
// The @capgo/capacitor-updater plugin POSTs an InfoObject describing the device
// and the web bundle it currently runs. We answer with the newest ACTIVE bundle
// for the device's channel — but ONLY if that bundle was built for the device's
// native shell (native_version == version_build). That native-version match is
// the anti-downgrade guard: an old "1.0.x" web bundle can never be served to a
// future "2.0" native app (which only accepts "2.0.x" bundles).
//
// Update available   -> 200 { version, url, checksum }   (checksum = SHA-256 of the zip)
// Already up to date  -> 200 { version, message, error: "no_new_version_available" }
//
// Auth: verify_jwt = false (the plugin sends no Supabase JWT). Reachable publicly.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { admin, json, otaCors, readInfo, resolveChannel, logStep } from "../_shared/ota.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: otaCors });

  try {
    const info = await readInfo(req);
    const appId = info.app_id ?? "";
    const deviceId = info.device_id ?? "";
    const nativeVersion = info.version_build ?? "";
    const currentVersion = info.version_name ?? "";
    const supa = admin();

    logStep("capgo-updates", "check", {
      app: appId, device: deviceId, native: nativeVersion, current: currentVersion,
    });

    // Update the device registry (telemetry only — never touch the channel
    // override column here, so a beta opt-in survives).
    if (deviceId && appId) {
      await supa.from("ota_devices").upsert(
        {
          device_id: deviceId,
          app_id: appId,
          version_name: currentVersion || null,
          native_version: nativeVersion || null,
          platform: info.platform ?? null,
          plugin_version: info.plugin_version ?? null,
          custom_id: info.custom_id ?? null,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "device_id,app_id" },
      );
    }

    const channel = await resolveChannel(supa, info);

    const noUpdate = () =>
      json({
        version: currentVersion,
        message: "No new version available",
        error: "no_new_version_available",
      });

    // Without a native version we cannot guarantee compatibility → serve nothing.
    if (!appId || !nativeVersion) return noUpdate();

    const { data: bundle, error } = await supa
      .from("ota_bundles")
      .select("version, url, checksum")
      .eq("app_id", appId)
      .eq("channel", channel)
      .eq("native_version", nativeVersion)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logStep("capgo-updates", "db_error", error.message);
      return noUpdate();
    }

    if (bundle && bundle.version !== currentVersion) {
      logStep("capgo-updates", "serve", { channel, version: bundle.version });
      // Best-effort telemetry (don't block the response on it).
      supa.from("ota_stats").insert({
        device_id: deviceId || null,
        app_id: appId,
        action: "update_offered",
        version_name: bundle.version,
        old_version_name: currentVersion || null,
        platform: info.platform ?? null,
      }).then(() => {}, () => {});

      return json({
        version: bundle.version,
        url: bundle.url,
        checksum: bundle.checksum,
      });
    }

    return noUpdate();
  } catch (e) {
    // Never fail hard — a malformed check must not crash the app's update loop.
    logStep("capgo-updates", "exception", (e as Error).message);
    return json({ message: "No new version available", error: "no_new_version_available" });
  }
});
