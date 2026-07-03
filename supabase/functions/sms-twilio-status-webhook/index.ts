// Edge function: sms-twilio-status-webhook
// Receives Twilio status callbacks and updates sms_logs.
// On terminal failure (failed/undelivered) refunds the credit.
// verify_jwt = false (Twilio signs the request via X-Twilio-Signature).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

// Constant-time string compare (avoids leaking the signature via timing).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Twilio signs each request: X-Twilio-Signature = base64(HMAC-SHA1(authToken,
// url + each sorted POST param key+value concatenated)). Without this check,
// anyone could POST a forged MessageStatus=failed for a known SID and trigger a
// fraudulent SMS-credit refund. The signed URL must match what Twilio was
// configured with — behind Supabase's proxy req.url may differ, so allow an
// explicit override via TWILIO_STATUS_CALLBACK_URL.
async function isValidTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return timingSafeEqual(expected, signature);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Twilio sends application/x-www-form-urlencoded
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of formData.entries()) params[k] = v.toString();

    // ── Verify the request really came from Twilio (fail-closed) ──────────────
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!authToken) {
      console.error("[sms-status] TWILIO_AUTH_TOKEN not set — refusing unsigned webhook");
      return new Response("Webhook not configured", { status: 403, headers: corsHeaders });
    }
    const signature = req.headers.get("X-Twilio-Signature") ?? "";
    const callbackUrl = Deno.env.get("TWILIO_STATUS_CALLBACK_URL") || req.url;
    const validSig = signature &&
      await isValidTwilioSignature(authToken, signature, callbackUrl, params);
    if (!validSig) {
      console.warn("[sms-status] Invalid Twilio signature — rejected");
      return new Response("Invalid signature", { status: 403, headers: corsHeaders });
    }

    const messageSid = params["MessageSid"];
    const messageStatus = params["MessageStatus"];
    const errorCode = params["ErrorCode"];
    const errorMessage = params["ErrorMessage"];

    if (!messageSid || !messageStatus) {
      return new Response("Missing fields", { status: 400, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find log by twilio_sid
    const { data: log } = await admin
      .from("sms_logs")
      .select("id, venue_id, organizer_id, status, refunded, credits_consumed")
      .eq("twilio_sid", messageSid)
      .maybeSingle();

    if (!log) {
      console.warn(`[sms-status] Unknown twilio_sid ${messageSid}`);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // Map Twilio status to internal enum
    let newStatus: string | null = null;
    if (messageStatus === "delivered") newStatus = "delivered";
    else if (messageStatus === "failed") newStatus = "failed";
    else if (messageStatus === "undelivered") newStatus = "undelivered";
    else if (messageStatus === "sent") newStatus = "sent";

    const update: Record<string, unknown> = {};
    if (newStatus) update.status = newStatus;
    if (newStatus === "delivered") update.delivered_at = new Date().toISOString();
    if (errorCode) update.error_code = errorCode;
    if (errorMessage) update.error_message = errorMessage;

    if (Object.keys(update).length > 0) {
      await admin.from("sms_logs").update(update).eq("id", log.id);
    }

    // Auto-refund credit on terminal failure
    if ((newStatus === "failed" || newStatus === "undelivered") && !log.refunded) {
      const { data: balanceId } = await admin.rpc("get_or_create_sms_balance", {
        p_venue_id: log.venue_id ?? null,
        p_organizer_id: log.organizer_id ?? null,
      });
      if (balanceId) {
        await admin.rpc("refund_sms_credits", {
          p_balance_id: balanceId,
          p_amount: log.credits_consumed ?? 1,
          p_sms_log_id: log.id,
          p_notes: `Auto-refund: Twilio ${newStatus} (${errorCode ?? "no code"})`,
        });
      }
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    console.error("[sms-status-webhook]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
