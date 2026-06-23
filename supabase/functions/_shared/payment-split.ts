// Shared payment split resolver for co-events.
// Computes Yuno fee, primary destination, and optional secondary transfer.
//
// Yuno commission rates live in _shared/commission.ts (single source of truth):
//  - 'ticket' / 'table': 4% min 0.99€
//  - 'drink':            3% (no minimum)
//
// Split rules JSONB shape (revenue_split_rules / partnership default):
//  { tickets: { organizer_pct, venue_pct },
//    tables:  { organizer_pct, venue_pct },
//    drinks:  { organizer_pct, venue_pct } }

import { computeCommissionCents } from "./commission.ts";

export type ItemType = "ticket" | "table" | "drink";
export type RecipientKind = "venue" | "organizer";

export interface SplitInput {
  itemType: ItemType;
  /** Gross customer-paid amount in EUR (decimal, e.g. 25.50) */
  grossAmount: number;
  event: {
    id: string;
    venue_id: string | null;
    organizer_user_id: string | null;
    partner_venue_id: string | null;
    partner_organizer_id: string | null;
    event_mode: string | null;
    revenue_split_rules: Record<string, unknown> | null;
  };
  /** Optional partnership defaults if event.revenue_split_rules is null */
  partnershipRules?: Record<string, unknown> | null;
  /** Stripe account ids resolved by caller */
  venueStripeAccountId?: string | null;
  organizerStripeAccountId?: string | null;
  /**
   * Amount (EUR) inside `grossAmount` that belongs 100% to the VENUE and must NOT
   * be split with the organizer — e.g. a drink/conso bundled into a co-event ticket.
   * The venue owns its bar/alcohol, so its revenue never goes to the organizer.
   * Only meaningful in a co-event "separate" split; ignored otherwise.
   */
  venueDirectAmount?: number;
  /**
   * Explicit Yuno commission in CENTS, overriding the rate-based computation.
   * Used in fee-absorption mode: the fan pays a Stripe-cost transaction fee (not the
   * Yuno commission), so `grossAmount` no longer contains the commission — but Yuno's
   * application_fee must still equal the commission on the item. Pass it explicitly.
   * Omit in the default (client-pays) flow to keep the existing computation untouched.
   */
  yunoFeeCentsOverride?: number;
}

export type SplitMode = "direct" | "separate";

export interface SplitResult {
  /** Yuno commission in cents */
  yunoFeeCents: number;
  /**
   * Estimated Stripe processing fee in cents (≈1.5% + 0.25€ — slightly conservative).
   * Deducted from the recipients' share BEFORE the percentage split, so that Yuno
   * keeps exactly `yunoFeeCents` and the connected accounts absorb Stripe processing
   * fees pro-rata to their share — instead of the platform absorbing them.
   */
  stripeFeeEstimatedCents: number;
  /** Total in cents */
  grossAmountCents: number;
  /**
   * Stripe Connect mode to use:
   *  - "direct":   single recipient → charge created ON the connected account
   *                (stripeAccount), application_fee_amount = yunoFeeCents. The
   *                recipient is merchant of record, pays the Stripe fee, and sees
   *                a "Frais Stripe" + commission line. `primary.accountId` is the
   *                account the charge runs on.
   *  - "separate": two recipients (co-event split) → charge stays on the platform,
   *                transfers fired by the webhook to primary + secondary.
   */
  splitMode: SplitMode;
  /**
   * In "separate" mode: the connected account to set as `on_behalf_of` on the charge,
   * making it the MERCHANT OF RECORD (statement descriptor + settlement + legal seller).
   * Always the VENUE for a co-event — the venue holds the alcohol licence and serves the
   * bottles/conso, so the venue must be the seller of record even though the charge runs
   * on the platform and is split. Null in "direct" mode (the charge already runs on the
   * recipient's own account).
   */
  onBehalfOf: string | null;
  primary: {
    accountId: string;
    amountCents: number;
    kind: RecipientKind;
    venueId: string | null;
    organizerId: string | null;
  };
  secondary: {
    accountId: string;
    amountCents: number;
    kind: RecipientKind;
    venueId: string | null;
    organizerId: string | null;
  } | null;
  /** Computed for ledger / debugging */
  effectiveSplit: { organizer_pct: number; venue_pct: number } | null;
}

// Stripe FR card processing fee estimate. Slightly conservative so we never
// under-estimate (any positive residual stays on the recipients, never on Yuno).
// Real fee is reconciled post-charge from balance_transaction.fee.
const STRIPE_FEE_PCT = 0.015;
const STRIPE_FEE_FIXED_CENTS = 25;

function estimateStripeFeeCents(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.round(grossCents * STRIPE_FEE_PCT) + STRIPE_FEE_FIXED_CENTS;
}

/**
 * Estimated Stripe card-processing fee in EUR for an amount (≈1.5% + 0.25€). This is
 * the "frais de transaction" a fan pays at checkout when a club absorbs the Yuno
 * commission — the fan always covers the real cost of moving the money, never Yuno's cut.
 */
export function estimateStripeFeeEur(amountEur: number): number {
  if (amountEur <= 0) return 0;
  return Math.round((amountEur * STRIPE_FEE_PCT + STRIPE_FEE_FIXED_CENTS / 100) * 100) / 100;
}

function computeYunoFeeCents(itemType: ItemType, grossAmount: number): number {
  return computeCommissionCents(itemType, grossAmount);
}

function getSplitForItem(
  rules: Record<string, unknown> | null | undefined,
  itemType: ItemType,
): { organizer_pct: number; venue_pct: number } | null {
  if (!rules) return null;
  const key = itemType === "ticket" ? "tickets" : itemType === "table" ? "tables" : "drinks";
  const block = (rules as Record<string, { organizer_pct?: number; venue_pct?: number }>)[key];
  if (!block) return null;
  const o = Number(block.organizer_pct ?? 0);
  const v = Number(block.venue_pct ?? 0);
  if (!Number.isFinite(o) || !Number.isFinite(v)) return null;
  // Normalize to 100
  const total = o + v;
  if (total <= 0) return null;
  return {
    organizer_pct: (o / total) * 100,
    venue_pct: (v / total) * 100,
  };
}

/**
 * Resolves the Stripe destination charge target and any secondary transfer.
 * Always returns a valid result or throws a descriptive error.
 */
export function resolvePaymentSplit(input: SplitInput): SplitResult {
  const {
    itemType,
    grossAmount,
    event,
    partnershipRules,
    venueStripeAccountId,
    organizerStripeAccountId,
    venueDirectAmount = 0,
  } = input;

  const grossCents = Math.round(grossAmount * 100);
  const yunoFeeCents = input.yunoFeeCentsOverride ?? computeYunoFeeCents(itemType, grossAmount);
  const stripeFeeEstimatedCents = estimateStripeFeeCents(grossCents);
  const netCents = grossCents - yunoFeeCents;
  // Informational only: what a single recipient nets after Yuno commission + the
  // Stripe fee. In "direct" mode Stripe debits its fee straight from the connected
  // account, so this is what actually lands. (Not used to size any transfer.)
  const netAfterStripeCents = Math.max(0, netCents - stripeFeeEstimatedCents);

  // Build a single-recipient DIRECT-charge result. The Stripe charge is created ON
  // the recipient's connected account (caller passes { stripeAccount }); the recipient
  // is merchant of record, pays the Stripe fee, and Yuno collects `yunoFeeCents` as the
  // application fee. The recipient's dashboard shows a real "Frais Stripe" line + the
  // Yuno commission line — and Yuno is never the seller of record.
  const directResult = (
    accountId: string,
    kind: RecipientKind,
    vId: string | null,
    oId: string | null,
    effective: { organizer_pct: number; venue_pct: number } | null,
  ): SplitResult => ({
    grossAmountCents: grossCents,
    yunoFeeCents,
    stripeFeeEstimatedCents,
    splitMode: "direct",
    onBehalfOf: null,
    primary: { accountId, amountCents: netAfterStripeCents, kind, venueId: vId, organizerId: oId },
    secondary: null,
    effectiveSplit: effective,
  });

  // Determine if this is a co-event
  const isCoEvent =
    event.event_mode === "co_event" ||
    event.event_mode === "venue_rental" ||
    event.event_mode === "org_hosted" ||
    (!!event.venue_id && !!event.partner_organizer_id) ||
    (!!event.organizer_user_id && !!event.partner_venue_id);

  // Solo cases — single recipient → DIRECT charge on that account.
  if (!isCoEvent) {
    if (event.venue_id) {
      if (!venueStripeAccountId) throw new Error("Venue has no Stripe account");
      return directResult(venueStripeAccountId, "venue", event.venue_id, null, null);
    }
    if (event.organizer_user_id) {
      if (!organizerStripeAccountId) throw new Error("Organizer has no Stripe account");
      return directResult(organizerStripeAccountId, "organizer", null, event.organizer_user_id, null);
    }
    throw new Error("Event has no recipient (venue or organizer)");
  }

  // ── Co-event ────────────────────────────────────────────────────────────────
  // Drinks REQUIRE a venue (the menu lives at the venue). The ticket/table split is
  // configurable via the partnership / event rules; drinks default to 100% venue.
  const venueId = event.venue_id ?? event.partner_venue_id;
  const organizerId = event.organizer_user_id ?? event.partner_organizer_id;

  if (itemType === "drink" && (!venueId || !venueStripeAccountId)) {
    throw new Error("Drinks in a co-event require a venue with Stripe enabled");
  }

  const rules = event.revenue_split_rules ?? partnershipRules ?? null;
  // Drinks default to 100% venue (alcohol licence), but a stored drinks split IS
  // honored when present. A drinks→organizer split can only reach event.revenue_split_rules
  // via a signed contract created through create_event_collab_contract, which forces
  // 100% club unless the organizer attested their alcohol-sale licence
  // (organizer_profiles.can_sell_alcohol). The venue still stays merchant of record
  // (on_behalf_of below) — this is a revenue share, not a transfer of the seller role.
  const split = getSplitForItem(rules, itemType) ?? defaultSplitForItem(itemType, event.event_mode);

  // The venue owns its bar/alcohol: any drink/conso amount bundled into THIS charge
  // (venueDirectAmount, e.g. a conso inside a co-event ticket) goes 100% to the venue
  // and is NOT split with the organizer. Only the rest is split per the rules.
  const venueDirectCents = Math.min(Math.max(0, Math.round((venueDirectAmount ?? 0) * 100)), netCents);
  const splitBaseCents = netCents - venueDirectCents;
  const venueBaseCents = Math.round((splitBaseCents * split.venue_pct) / 100);
  const organizerShareBeforeFee = splitBaseCents - venueBaseCents;
  const venueShareBeforeFee = venueBaseCents + venueDirectCents;

  const venueGetsMoney = venueShareBeforeFee > 0;
  const organizerGetsMoney = organizerShareBeforeFee > 0;

  // Only ONE effective recipient (100/0 split, or drinks → 100% venue) → DIRECT charge
  // on that account. Cleanest legal + transparency, same as a solo event.
  if (venueGetsMoney && !organizerGetsMoney) {
    if (!venueStripeAccountId) throw new Error("Venue has no Stripe account");
    return directResult(venueStripeAccountId, "venue", venueId, null, split);
  }
  if (organizerGetsMoney && !venueGetsMoney) {
    if (!organizerStripeAccountId) throw new Error("Organizer has no Stripe account");
    return directResult(organizerStripeAccountId, "organizer", null, organizerId, split);
  }

  // BOTH parties owe money → SEPARATE charges and transfers: the charge stays on the
  // platform (Stripe can't direct-charge two accounts at once) and the webhook fires
  // a transfer to each connected account. The Stripe fee is pre-deducted pro-rata so
  // Yuno keeps exactly `yunoFeeCents` and the recipients absorb the Stripe fee.
  if (!venueStripeAccountId || !organizerStripeAccountId) {
    throw new Error("Both parties need a Stripe account for a co-event split");
  }

  const totalShareForFee = venueShareBeforeFee + organizerShareBeforeFee; // === netCents
  const venueFeeShare = totalShareForFee > 0
    ? Math.round((stripeFeeEstimatedCents * venueShareBeforeFee) / totalShareForFee)
    : 0;
  const organizerFeeShare = stripeFeeEstimatedCents - venueFeeShare;
  const venueAmountCents = Math.max(0, venueShareBeforeFee - venueFeeShare);
  const organizerAmountCents = Math.max(0, organizerShareBeforeFee - organizerFeeShare);

  const venueLeg = {
    accountId: venueStripeAccountId,
    amountCents: venueAmountCents,
    kind: "venue" as RecipientKind,
    venueId,
    organizerId: null,
  };
  const organizerLeg = {
    accountId: organizerStripeAccountId,
    amountCents: organizerAmountCents,
    kind: "organizer" as RecipientKind,
    venueId: null,
    organizerId,
  };

  // Primary = the event host's side (venue if it created the event, else organizer).
  const primaryIsVenue = !!event.venue_id;
  return {
    grossAmountCents: grossCents,
    yunoFeeCents,
    stripeFeeEstimatedCents,
    splitMode: "separate",
    // The venue is the merchant of record (alcohol licence holder) even though the
    // platform holds the charge and splits it. Customer statement = venue.
    onBehalfOf: venueStripeAccountId,
    primary: primaryIsVenue ? venueLeg : organizerLeg,
    secondary: primaryIsVenue ? organizerLeg : venueLeg,
    effectiveSplit: split,
  };
}

function defaultSplitForItem(itemType: ItemType, mode: string | null) {
  // Sensible defaults per mode:
  // co_event:     50/50 tickets, 0/100 tables (club gets table revenue)
  // venue_rental: 100/0 tickets to organizer, 0/100 tables to venue
  // org_hosted:   100/0 tickets to organizer, 100/0 tables to organizer
  // Drinks are ALWAYS 100% venue regardless of mode (alcohol licence). Defense in depth.
  if (itemType === "drink") {
    return { organizer_pct: 0, venue_pct: 100 };
  }
  if (mode === "venue_rental") {
    return itemType === "ticket"
      ? { organizer_pct: 100, venue_pct: 0 }
      : { organizer_pct: 0, venue_pct: 100 };
  }
  if (mode === "org_hosted") {
    return { organizer_pct: 100, venue_pct: 0 };
  }
  // co_event default
  return itemType === "ticket"
    ? { organizer_pct: 50, venue_pct: 50 }
    : { organizer_pct: 0, venue_pct: 100 };
}
