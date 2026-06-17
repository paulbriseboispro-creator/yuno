// Global payments kill-switch + demo-account detection.
//
// Two concerns, one module, shared by every checkout-creating edge function
// (subscriptions, tickets, VIP tables, drinks, SMS):
//
//   1. arePaymentsDisabled() — reads the Super Admin kill-switch from
//      app_settings.payments_disabled. When true, NO real charge may happen.
//   2. isDemoEmail() — @womber.fr accounts are the sales-demo cohort. In live
//      mode they must NEVER hit Stripe; they run a no-charge simulation instead,
//      regardless of the kill-switch.
//
// Enforcement rule each checkout function applies BEFORE touching Stripe:
//   - demo account            → simulate (no Stripe, no charge)
//   - real account + disabled  → refuse with PAYMENTS_DISABLED
//   - real account + enabled   → normal Stripe flow

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

/** Sentinel thrown/returned so the frontend can show the kill-switch banner. */
export const PAYMENTS_DISABLED_CODE = "PAYMENTS_DISABLED";

const DEMO_EMAIL_SUFFIX = "@womber.fr";

/** True for sales-demo accounts that must never trigger a real Stripe charge. */
export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);
}

/**
 * Reads the global kill-switch. Fails CLOSED: if the flag can't be read we
 * assume payments are disabled, because the cost of a wrong "enabled" in live
 * mode is a real charge, while a wrong "disabled" is only a blocked checkout.
 */
export async function arePaymentsDisabled(supabaseAdmin: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("payments_disabled")
    .eq("id", "global")
    .single();

  if (error) {
    console.warn("[payment-guard] could not read payments_disabled, failing closed", error.message);
    return true;
  }
  return data?.payments_disabled === true;
}

/**
 * One-call gate for the start of a checkout function.
 * Returns how the caller should proceed:
 *   - { mode: "simulate" } → demo account, build records as paid, no Stripe
 *   - { mode: "blocked" }  → real account while the kill-switch is ON
 *   - { mode: "live" }     → normal Stripe flow
 */
export async function resolvePaymentMode(
  supabaseAdmin: SupabaseClient,
  email: string | null | undefined,
): Promise<{ mode: "simulate" | "blocked" | "live" }> {
  if (isDemoEmail(email)) return { mode: "simulate" };
  if (await arePaymentsDisabled(supabaseAdmin)) return { mode: "blocked" };
  return { mode: "live" };
}
