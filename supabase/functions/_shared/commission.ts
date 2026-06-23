// Yuno commission — SINGLE SOURCE OF TRUTH.
//
// There is ONE pricing, NOT a per-plan rate:
//   • Tickets & tables: 4% of the item, minimum 0.99€.
//   • Drinks:           3% of the order, no minimum.
//
// This commission is Yuno's cut (application_fee on the Connect charge). It is
// distinct from Stripe's ~1.5% card-processing fee. Historically these rates were
// duplicated across create-ticket-checkout, create-table-checkout, create-checkout
// and payment-split.ts; this module is now the only place they live.

export type CommissionItemType = "ticket" | "table" | "drink";

export const YUNO_TICKET_TABLE_RATE = 0.04;
export const YUNO_TICKET_TABLE_MIN = 0.99; // EUR
export const YUNO_DRINK_RATE = 0.03;

/** Commission rate for an item type (fraction, e.g. 0.04 = 4%). */
export function getCommissionRate(itemType: CommissionItemType): number {
  return itemType === "drink" ? YUNO_DRINK_RATE : YUNO_TICKET_TABLE_RATE;
}

/** Minimum commission in EUR for an item type (drinks have no minimum). */
export function getCommissionMin(itemType: CommissionItemType): number {
  return itemType === "drink" ? 0 : YUNO_TICKET_TABLE_MIN;
}

/** Yuno commission in EUR for a gross amount (applies rate + per-type minimum). */
export function computeCommissionEur(itemType: CommissionItemType, grossAmount: number): number {
  const raw = grossAmount * getCommissionRate(itemType);
  const withMin = Math.max(getCommissionMin(itemType), raw);
  // Round to the cent.
  return Math.round(withMin * 100) / 100;
}

/** Yuno commission in integer cents for a gross amount. */
export function computeCommissionCents(itemType: CommissionItemType, grossAmount: number): number {
  return Math.round(computeCommissionEur(itemType, grossAmount) * 100);
}
