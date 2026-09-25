// Codes promo autonomes (plan Shotgun, lot F) — la porte serveur partagée par
// create-ticket-checkout et create-table-checkout.
//
// Le client n'envoie qu'un TEXTE. `claim_promo_code` (migration
// 20260924210000) relit le code, sa portée, ses dates, son pilier, son palier
// et son quota SOUS VERROU, puis retient un usage 30 minutes. La vente créée y
// est ensuite reliée (`attach_promo_redemption`) ; le paiement confirme
// l'usage par trigger, un échec le rend (`release_promo_redemption`).
// Jamais de cumul avec la remise promoteur : l'appelant garde la plus forte.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export const PROMO_INVALID_CODE = "PROMO_INVALID";

/** Refus d'un code : le front affiche la raison sous le champ. */
export class PromoCodeError extends Error {
  code = PROMO_INVALID_CODE;
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "PromoCodeError";
    this.reason = reason;
  }
}

/** Même forme que la base : capitales, sans espaces ; `null` si trop court. */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9_-]{3,32}$/.test(code) ? code : null;
}

export type PromoClaim =
  | { ok: true; redemptionId: string; promoCodeId: string; code: string; discount: number }
  | { ok: false; reason: string };

export async function claimPromoCode(
  supabase: SupabaseClient,
  args: {
    code: string;
    eventId: string;
    pillar: "tickets" | "tables";
    ticketRoundId?: string | null;
    quantity: number;
    baseAmount: number;
    email?: string | null;
    userId?: string | null;
  },
): Promise<PromoClaim> {
  const { data, error } = await supabase.rpc("claim_promo_code", {
    p_code: args.code,
    p_event_id: args.eventId,
    p_pillar: args.pillar,
    p_ticket_round_id: args.ticketRoundId ?? null,
    p_quantity: args.quantity,
    p_base_amount: args.baseAmount,
    p_email: args.email ?? null,
    p_user_id: args.userId ?? null,
  });
  if (error) {
    // Une panne du contrôle ne donne JAMAIS de remise : le code est refusé.
    console.error("[PROMO] claim failed", error.message);
    return { ok: false, reason: "unavailable" };
  }
  const res = data as { ok: boolean; reason?: string; redemptionId?: string; promoCodeId?: string; code?: string; discount?: number } | null;
  if (!res?.ok || !res.redemptionId || !res.promoCodeId) return { ok: false, reason: res?.reason ?? "not_found" };
  return {
    ok: true,
    redemptionId: res.redemptionId,
    promoCodeId: res.promoCodeId,
    code: res.code ?? args.code,
    discount: Math.max(0, Math.round(Number(res.discount ?? 0) * 100) / 100),
  };
}

export async function attachPromoRedemption(
  supabase: SupabaseClient,
  redemptionId: string,
  target: { ticketId?: string | null; tableReservationId?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc("attach_promo_redemption", {
    p_redemption_id: redemptionId,
    p_ticket_id: target.ticketId ?? null,
    p_table_reservation_id: target.tableReservationId ?? null,
  });
  if (error) console.error("[PROMO] attach failed", error.message);
}

export async function releasePromoRedemption(supabase: SupabaseClient, redemptionId: string | null): Promise<void> {
  if (!redemptionId) return;
  const { error } = await supabase.rpc("release_promo_redemption", { p_redemption_id: redemptionId });
  if (error) console.error("[PROMO] release failed", error.message);
}
