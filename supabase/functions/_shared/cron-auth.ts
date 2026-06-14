// Shared helper to protect scheduled (cron-invoked) edge functions.
//
// These functions run with service_role and have `verify_jwt = false` so the
// platform cron scheduler can call them — but that means anyone on the public
// internet could too. We require a shared secret in the `x-cron-secret` header
// to prove the caller is our scheduler.
//
// To call from pg_cron, include the secret in the headers JSON:
//   net.http_post(url := '...', headers := jsonb_build_object(
//     'Content-Type', 'application/json',
//     'x-cron-secret', '<CRON_SECRET value>'
//   ), ...)
//
// In dev, super-admins authenticated with a valid Supabase JWT are also
// allowed (so manual triggers from the admin UI keep working).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export type CronAuthResult =
  | { ok: true; via: "cron_secret" | "admin_jwt" }
  | { ok: false; status: number; message: string };

export async function authorizeCronRequest(req: Request): Promise<CronAuthResult> {
  const expected = Deno.env.get("CRON_SECRET");

  // Path 1: shared cron secret
  const provided = req.headers.get("x-cron-secret");
  if (expected && provided && timingSafeEqual(expected, provided)) {
    return { ok: true, via: "cron_secret" };
  }

  // Path 2: super-admin JWT (for manual admin triggers)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: isSA } = await supabase.rpc("is_super_admin");
        if (isSA === true) {
          return { ok: true, via: "admin_jwt" };
        }
      }
    } catch {
      // fall through
    }
  }

  if (!expected) {
    return {
      ok: false,
      status: 503,
      message: "CRON_SECRET not configured on the server",
    };
  }

  return { ok: false, status: 401, message: "Unauthorized" };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
