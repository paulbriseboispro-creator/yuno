// Yuno commission — SINGLE SOURCE OF TRUTH.
//
// There is ONE pricing, NOT a per-plan rate:
//   • Tickets: 4% of the item, minimum 0.99€ (0.49€ for BDE events).
//   • Tables:  4% of the amount charged, minimum 0.99€, CAPPED at 25€.
//   • Drinks:  3% of the order, no minimum.
//
// The table cap exists because tables live in a price band tickets never reach
// (300€–2500€+). The fee is charged on the amount actually debited — usually a
// deposit, not the full table — so on a normal deposit config the cap never
// binds. It only fires when the club takes FULL payment up front (see
// create-table-checkout: `serverDeposit = serverTotalPrice` when no deposit is
// configured), where an uncapped 4% would bill a fan 80€ on a 2000€ table.
// Serving that reservation costs Yuno the same as a 300€ one, so the fee stops
// scaling at 25€.
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
export const YUNO_TABLE_MAX = 25; // EUR — table-only ceiling; binds above a 625€ charge
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

/**
 * Maximum commission in EUR for an item type. Tables are capped; tickets and
 * drinks are uncapped (their price band never gets near a ceiling). The cap is
 * applied AFTER the floor, so a table always lands in [0.99€, 25€].
 */
export function getCommissionMax(itemType: CommissionItemType): number {
  return itemType === "table" ? YUNO_TABLE_MAX : Infinity;
}

/** Yuno commission in EUR for a gross amount (applies rate, then per-type min and max). */
export function computeCommissionEur(
  itemType: CommissionItemType,
  grossAmount: number,
  isBde = false,
): number {
  const raw = grossAmount * getCommissionRate(itemType);
  const withMin = Math.max(getCommissionMin(itemType, isBde), raw);
  const withMax = Math.min(getCommissionMax(itemType), withMin);
  // Round to the cent.
  return Math.round(withMax * 100) / 100;
}

/** Yuno commission in integer cents for a gross amount. */
export function computeCommissionCents(
  itemType: CommissionItemType,
  grossAmount: number,
  isBde = false,
): number {
  return Math.round(computeCommissionEur(itemType, grossAmount, isBde) * 100);
}
