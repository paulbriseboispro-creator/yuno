// Shared helpers for the self-hosted Capgo OTA endpoints
// (capgo-updates / capgo-stats / capgo-channel).
//
// The @capgo/capacitor-updater plugin talks to these endpoints from NATIVE code
// (Alamofire), so there is no browser CORS enforcement — but we still answer
// OPTIONS and send permissive headers so the endpoints stay debuggable from a
// browser / curl. No credentials or cookies are involved, so "*" is safe.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export const otaCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...otaCors, "Content-Type": "application/json" },
  });
}

/** Service-role client — bypasses RLS. OTA tables have no anon policy on purpose. */
export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

/**
 * The payload the plugin POSTs to every endpoint (Capgo "InfoObject").
 * All fields are optional/defensive — we never trust the shape blindly.
 */
export interface InfoObject {
  platform?: string;
  device_id?: string;
  app_id?: string;
  custom_id?: string;
  version_build?: string;   // native app version (CFBundleShortVersionString, e.g. "1.0")
  version_code?: string;    // native build number
  version_os?: string;
  version_name?: string;    // web bundle currently installed ("builtin" on a fresh install)
  old_version_name?: string;
  plugin_version?: string;
  is_emulator?: boolean;
  is_prod?: boolean;
  action?: string;          // stats action / channel action
  channel?: string;
  defaultChannel?: string;
}

export async function readInfo(req: Request): Promise<InfoObject> {
  try {
    return (await req.json()) as InfoObject;
  } catch {
    return {};
  }
}

/** Effective channel for a device: server override wins, then the app's
 *  requested/default channel, then the app's default channel, then "production". */
export async function resolveChannel(
  supa: SupabaseClient,
  info: InfoObject,
): Promise<string> {
  const appId = info.app_id ?? "";
  const deviceId = info.device_id ?? "";

  if (deviceId && appId) {
    const { data: dev } = await supa
      .from("ota_devices")
      .select("channel")
      .eq("device_id", deviceId)
      .eq("app_id", appId)
      .maybeSingle();
    if (dev?.channel) return dev.channel; // server-side override
  }

  const requested = (info.defaultChannel || info.channel || "").trim();
  if (requested) return requested;

  if (appId) {
    const { data: def } = await supa
      .from("ota_channels")
      .select("name")
      .eq("app_id", appId)
      .eq("is_default", true)
      .maybeSingle();
    if (def?.name) return def.name;
  }
  return "production";
}

export function logStep(fn: string, step: string, details?: unknown) {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[${fn}] ${step}${d}`);
}
