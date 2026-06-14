/**
 * Fee + club-revenue helpers — single source of truth for analytics & payouts.
 *
 * Canonical definitions mirror the backend (supabase/functions/owner-assistant
 * `calcOrdersRevenue` / `calcTicketsRevenue` / `calcTablesRevenue`). Keep these
 * in sync so the dashboard, the AI assistant and the payout logic all agree.
 *
 * Money model (see ohelp.feeStructure in i18n):
 *   - Customer pays = item price + Yuno service fee (and insurance/management where applicable).
 *   - Yuno service/insurance/management fees are 100% retained by Yuno (NOT club revenue).
 *   - Stripe charges 1.5% + €0.25 on the FULL amount charged (item price + Yuno fees).
 *   - Club gross revenue ("CA Club") = amount paid by client − Yuno fees.
 *   - Club net revenue ("CA Net")    = CA Club − Stripe fee − refunds.
 */

export const STRIPE_PERCENT = 0.015;
export const STRIPE_FIXED = 0.25;

/** Human-readable Stripe fee label, derived from the constants (no hardcoded "1.4%"). */
export const STRIPE_FEE_LABEL = `${(STRIPE_PERCENT * 100).toFixed(1)}% + €${STRIPE_FIXED.toFixed(2)} / txn`;

/**
 * Calculate Stripe processing fee for a given total in euros.
 * Formula: 1.5% + €0.25, rounded to 2 decimal places.
 */
export function calcStripeFee(totalEuros: number): number {
  if (totalEuros <= 0) return 0;
  return Math.round((totalEuros * STRIPE_PERCENT + STRIPE_FIXED) * 100) / 100;
}

const n = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Revenue components for one transaction row.
 *  - gross:    club revenue BEFORE refunds (Yuno fees already excluded).
 *  - refunded: club-side refunded portion (capped at gross). `refund_amount`
 *              is already club-side (see owner-refund: maxRefundable = total − fees).
 *  - stripe:   Stripe fee, charged on the full client-paid amount.
 *  net payout for the row = gross − refunded − stripe.
 */
export interface RevenueRow { gross: number; refunded: number; stripe: number; charged: number; }

function row(gross: number, charged: number, refundAmount: unknown): RevenueRow {
  const refunded = Math.min(Math.max(n(refundAmount), 0), Math.max(gross, 0));
  return { gross, refunded, stripe: calcStripeFee(charged), charged };
}

/** Drink order: club gross = total − service_fee; charged amount = total. */
export function orderRevenue(o: { total?: number | null; service_fee?: number | null; refund_amount?: number | null }): RevenueRow {
  const charged = n(o.total);
  return row(charged - n(o.service_fee), charged, o.refund_amount);
}

/** Ticket: club gross = total_price − service_fee − insurance_fee; charged = total_price. */
export function ticketRevenue(t: { total_price?: number | null; service_fee?: number | null; insurance_fee?: number | null; refund_amount?: number | null }): RevenueRow {
  const charged = n(t.total_price);
  return row(charged - n(t.service_fee) - n(t.insurance_fee), charged, t.refund_amount);
}

/** Table reservation: club gross = total_price − service_fee − management_fee; charged = total_price. */
export function tableRevenue(t: { total_price?: number | null; service_fee?: number | null; management_fee?: number | null; refund_amount?: number | null }): RevenueRow {
  const charged = n(t.total_price);
  return row(charged - n(t.service_fee) - n(t.management_fee), charged, t.refund_amount);
}
