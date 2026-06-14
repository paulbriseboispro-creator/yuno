import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple in-memory rate limiting per IP
const attemptTracker = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getClientIP(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
         req.headers.get("x-real-ip") ||
         "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const tracker = attemptTracker.get(ip);
  if (!tracker) return false;
  if (now - tracker.lastAttempt > LOCKOUT_DURATION_MS) {
    attemptTracker.delete(ip);
    return false;
  }
  return tracker.count >= MAX_ATTEMPTS;
}

function recordAttempt(ip: string, success: boolean): void {
  const now = Date.now();
  if (success) {
    attemptTracker.delete(ip);
    return;
  }
  const tracker = attemptTracker.get(ip);
  if (tracker) {
    tracker.count++;
    tracker.lastAttempt = now;
  } else {
    attemptTracker.set(ip, { count: 1, lastAttempt: now });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientIP = getClientIP(req);

    if (isRateLimited(clientIP)) {
      return new Response(
        JSON.stringify({ success: false, error: "Too many attempts. Please try again in 15 minutes." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 },
      );
    }

    const { password } = await req.json();

    if (!password || typeof password !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Password is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    if (password.length > 100) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid password" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Delegate verification to Postgres (bcrypt via pgcrypto, with transparent
    // upgrade of legacy unsalted SHA-256 hashes on a successful match).
    const { data: isValid, error: rpcErr } = await supabaseAdmin.rpc(
      "verify_maintenance_password",
      { plain: password },
    );

    if (rpcErr) {
      console.error("verify_maintenance_password RPC error:", rpcErr.message);
      return new Response(
        JSON.stringify({ success: false, error: "Configuration error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    recordAttempt(clientIP, isValid === true);

    if (isValid === true) {
      const bypassToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      return new Response(
        JSON.stringify({ success: true, bypassToken, expiresAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Invalid password" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
    );
  } catch (error) {
    console.error("Error verifying maintenance password:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
