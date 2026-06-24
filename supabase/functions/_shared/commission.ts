// Yuno commission — SINGLE SOURCE OF TRUTH.
//
// There is ONE pricing, NOT a per-plan rate:
//   • Tickets & tables: 4% of the item, minimum 0.99€ (0.49€ for BDE events).
//   • Drinks:           3% of the order, no minimum.
//
// BDE (Bureaux Des Étudiants) events — organizers a super admin flagged as
// `bde_verified`, stamped onto each event as `events.is_bde` — pay the SAME 4%
// rate but a reduced per-item floor (0.49€). Drinks are unchanged. Pass `isBde`
// through wherever the floor is applied; the rate never depends on it.
//
// This commission is Yuno's cut (application_fee on the Connect charge). It is
// distinct from Stripe's ~1.5% card-processing fee. Historically these rates were
// duplicated across create-ticket-checkout, create-table-checkout, create-checkout
// and payment-split.ts; this module is now the only place they live.

export type CommissionItemType = "ticket" | "table" | "drink";

export const YUNO_TICKET_TABLE_RATE = 0.04;
export const YUNO_TICKET_TABLE_MIN = 0.99; // EUR — standard organizer floor
export const YUNO_TICKET_TABLE_MIN_BDE = 0.49; // EUR — reduced floor for BDE events
export const YUNO_DRINK_RATE = 0.03;

/** Commission rate for an item type (fraction, e.g. 0.04 = 4%). Never BDE-dependent. */
export function getCommissionRate(itemType: CommissionItemType): number {
  return itemType === "drink" ? YUNO_DRINK_RATE : YUNO_TICKET_TABLE_RATE;
}

/** Minimum commission in EUR for an item type (drinks have no minimum; BDE gets a reduced floor). */
export function getCommissionMin(itemType: CommissionItemType, isBde = false): number {
  if (itemType === "drink") return 0;
  return isBde ? YUNO_TICKET_TABLE_MIN_BDE : YUNO_TICKET_TABLE_MIN;
}

/** Yuno commission in EUR for a gross amount (applies rate + per-type minimum). */
export function computeCommissionEur(
  itemType: CommissionItemType,
  grossAmount: number,
  isBde = false,
): number {
  const raw = grossAmount * getCommissionRate(itemType);
  const withMin = Math.max(getCommissionMin(itemType, isBde), raw);
  // Round to the cent.
  return Math.round(withMin * 100) / 100;
}

/** Yuno commission in integer cents for a gross amount. */
export function computeCommissionCents(
  itemType: CommissionItemType,
  grossAmount: number,
  isBde = false,
): number {
  return Math.round(computeCommissionEur(itemType, grossAmount, isBde) * 100);
}
