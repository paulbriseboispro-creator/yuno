// capgo-channel — the OTA "channelUrl" endpoint (self-assign a device to a channel).
//
// Plugin contract:
//   PUT  = getChannel  -> { channel, status, allowSet }
//   POST = setChannel  -> { status, channel } | { status, unset:true } | { error }
//   (an empty / "public" channel on POST clears the override)
//
// A device may only self-assign to a channel whose allow_self_set = true (beta).
// production is locked (allow_self_set = false) — a device gets it by default,
// never by asking. This is how a tester opts a device into "beta" from the app:
//   CapacitorUpdater.setChannel({ channel: 'beta' })
// You can also force it server-side via ota_devices.channel (no app call needed).
//
// Auth: verify_jwt = false.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { admin, json, otaCors, readInfo, logStep } from "../_shared/ota.ts";

async function defaultChannelFor(supa: ReturnType<typeof admin>, appId: string): Promise<string> {
  if (!appId) return "production";
  const { data } = await supa
    .from("ota_channels")
    .select("name")
    .eq("app_id", appId)
    .eq("is_default", true)
    .maybeSingle();
  return data?.name ?? "production";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: otaCors });

  try {
    const info = await readInfo(req);
    const appId = info.app_id ?? "";
    const deviceId = info.device_id ?? "";
    const supa = admin();

    // ---- getChannel (PUT) --------------------------------------------------
    if (req.method === "PUT" || req.method === "GET") {
      let channel: string | null = null;
      if (deviceId && appId) {
        const { data: dev } = await supa
          .from("ota_devices").select("channel")
          .eq("device_id", deviceId).eq("app_id", appId).maybeSingle();
        channel = dev?.channel ?? null;
      }
      const eff = channel ?? (await defaultChannelFor(supa, appId));
      const { data: ch } = await supa
        .from("ota_channels").select("allow_self_set")
        .eq("app_id", appId).eq("name", eff).maybeSingle();
      return json({ channel: eff, status: "ok", allowSet: ch?.allow_self_set ?? false });
    }

    // ---- setChannel / unset (POST) ----------------------------------------
    const requested = (info.channel || info.defaultChannel || "").trim();

    // Empty or "public" => remove the override, fall back to the default channel.
    if (!requested || requested.toLowerCase() === "public") {
      if (deviceId && appId) {
        await supa.from("ota_devices").update({ channel: null })
          .eq("device_id", deviceId).eq("app_id", appId);
      }
      logStep("capgo-channel", "unset", { device: deviceId, app: appId });
      return json({ status: "ok", unset: true, message: "Channel override removed" });
    }

    // Validate the channel exists AND allows self-assignment.
    const { data: ch } = await supa
      .from("ota_channels").select("allow_self_set")
      .eq("app_id", appId).eq("name", requested).maybeSingle();

    if (!ch) {
      return json({ error: "channel_not_found", message: `Channel "${requested}" not found` });
    }
    if (!ch.allow_self_set) {
      return json({ error: "channel_not_allowed", message: `Channel "${requested}" does not allow self-assignment` });
    }

    if (deviceId && appId) {
      await supa.from("ota_devices").upsert(
        { device_id: deviceId, app_id: appId, channel: requested, last_seen: new Date().toISOString() },
        { onConflict: "device_id,app_id" },
      );
    }
    logStep("capgo-channel", "set", { device: deviceId, app: appId, channel: requested });
    return json({ status: "ok", channel: requested, message: `Device assigned to channel "${requested}"` });
  } catch (e) {
    logStep("capgo-channel", "exception", (e as Error).message);
    return json({ error: "server_error", message: (e as Error).message }, 200);
  }
});
