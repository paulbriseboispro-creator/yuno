// Shared payment split resolver for co-events.
// Computes Yuno fee, primary destination, and optional secondary transfer.
//
// Item types:
//  - 'ticket' / 'table': 4% min 0.99€
//  - 'drink':            3% (no minimum)
//
// Split rules JSONB shape (revenue_split_rules / partnership default):
//  { tickets: { organizer_pct, venue_pct },
//    tables:  { organizer_pct, venue_pct },
//    drinks:  { organizer_pct, venue_pct } }

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
}

export type SplitMode = "destination" | "separate";

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
   *  - "destination": single recipient → use transfer_data.destination + application_fee_amount
   *  - "separate": two recipients → charge stays on platform, transfers fired by webhook
   */
  splitMode: SplitMode;
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

const YUNO_TICKET_TABLE_RATE = 0.04;
const YUNO_TICKET_TABLE_MIN = 0.99;
const YUNO_DRINK_RATE = 0.03;

// Stripe FR card processing fee estimate. Slightly conservative so we never
// under-estimate (any positive residual stays on the recipients, never on Yuno).
// Real fee is reconciled post-charge from balance_transaction.fee.
const STRIPE_FEE_PCT = 0.015;
const STRIPE_FEE_FIXED_CENTS = 25;

function estimateStripeFeeCents(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.round(grossCents * STRIPE_FEE_PCT) + STRIPE_FEE_FIXED_CENTS;
}

function computeYunoFeeCents(itemType: ItemType, grossAmount: number): number {
  if (itemType === "drink") {
    return Math.round(grossAmount * YUNO_DRINK_RATE * 100);
  }
  const pct = grossAmount * YUNO_TICKET_TABLE_RATE;
  const fee = Math.max(YUNO_TICKET_TABLE_MIN, pct);
  return Math.round(fee * 100);
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
  } = input;

  const grossCents = Math.round(grossAmount * 100);
  const yunoFeeCents = computeYunoFeeCents(itemType, grossAmount);
  const stripeFeeEstimatedCents = estimateStripeFeeCents(grossCents);
  const netCents = grossCents - yunoFeeCents;
  // DESTINATION mode (single recipient): the charge lands on Yuno's PLATFORM account
  // (no `on_behalf_of`). Yuno is the merchant of record — it pays the Stripe fee and
  // transfers the recipient ONLY its own share via `transfer_data[amount]`. So the
  // recipient never sees the gross customer payment transit its books, and Yuno keeps
  // exactly `yunoFeeCents`. We therefore pre-deduct the estimated Stripe fee here:
  //   gross − yunoFee − stripeFee  =  what the recipient actually receives.
  const netAfterStripeCents = Math.max(0, netCents - stripeFeeEstimatedCents);

  // Determine if this is a co-event
  const isCoEvent =
    event.event_mode === "co_event" ||
    event.event_mode === "venue_rental" ||
    event.event_mode === "org_hosted" ||
    (!!event.venue_id && !!event.partner_organizer_id) ||
    (!!event.organizer_user_id && !!event.partner_venue_id);

  // Solo cases — no split (single destination charge)
  if (!isCoEvent) {
    if (event.venue_id) {
      if (!venueStripeAccountId) throw new Error("Venue has no Stripe account");
      return {
        grossAmountCents: grossCents,
        yunoFeeCents,
        stripeFeeEstimatedCents,
        splitMode: "destination",
        primary: {
          accountId: venueStripeAccountId,
          amountCents: netAfterStripeCents,
          kind: "venue",
          venueId: event.venue_id,
          organizerId: null,
        },
        secondary: null,
        effectiveSplit: null,
      };
    }
    if (event.organizer_user_id) {
      if (!organizerStripeAccountId) throw new Error("Organizer has no Stripe account");
      return {
        grossAmountCents: grossCents,
        yunoFeeCents,
        stripeFeeEstimatedCents,
        splitMode: "destination",
        primary: {
          accountId: organizerStripeAccountId,
          amountCents: netAfterStripeCents,
          kind: "organizer",
          venueId: null,
          organizerId: event.organizer_user_id,
        },
        secondary: null,
        effectiveSplit: null,
      };
    }
    throw new Error("Event has no recipient (venue or organizer)");
  }

  // Co-event: drinks REQUIRE a venue (the menu lives at the venue) but the revenue split
  // is now configurable via the partnership / event split rules. If no rules exist for drinks,
  // default to 100% venue (legacy behaviour).
  const venueId = event.venue_id ?? event.partner_venue_id;
  const organizerId = event.organizer_user_id ?? event.partner_organizer_id;

  if (itemType === "drink" && (!venueId || !venueStripeAccountId)) {
    throw new Error("Drinks in a co-event require a venue with Stripe enabled");
  }

  const rules = event.revenue_split_rules ?? partnershipRules ?? null;
  const split = getSplitForItem(rules, itemType) ?? defaultSplitForItem(itemType, event.event_mode);

  const primaryIsVenue = itemType === "drink" ? true : !!event.venue_id;
  const primaryAccountId = primaryIsVenue ? venueStripeAccountId : organizerStripeAccountId;
  const secondaryAccountId = primaryIsVenue ? organizerStripeAccountId : venueStripeAccountId;

  if (!primaryAccountId) {
    throw new Error("Primary party has no Stripe account");
  }

  // SEPARATE-CHARGES-AND-TRANSFERS mode (used when both parties owe money):
  //   - The PaymentIntent is created on the platform account WITHOUT transfer_data.
  //   - Stripe debits its processing fee from the platform balance.
  //   - The webhook fires two manual transfers to the connected accounts.
  //   - => We MUST pre-deduct the estimated Stripe fee here so that Yuno recovers it
  //        from the recipients' share. Otherwise Yuno absorbs the Stripe fee.
  //
  // DESTINATION fallback (when one side gets 0%): single recipient, Stripe handles
  // its fee on the connected account via on_behalf_of (configured by the caller).
  const venueShareCentsBeforeFee = Math.round((netCents * split.venue_pct) / 100);
  const organizerShareCentsBeforeFee = netCents - venueShareCentsBeforeFee;

  const primaryAmountBeforeFee = primaryIsVenue ? venueShareCentsBeforeFee : organizerShareCentsBeforeFee;
  const secondaryAmountBeforeFee = primaryIsVenue ? organizerShareCentsBeforeFee : venueShareCentsBeforeFee;

  if (secondaryAmountBeforeFee > 0 && !secondaryAccountId) {
    throw new Error("Partner party has no Stripe account — cannot create co-event payment");
  }

  const needsSecondaryTransfer = secondaryAmountBeforeFee > 0 && primaryAmountBeforeFee > 0 && !!secondaryAccountId;

  // Pre-deduct estimated Stripe fee from each party pro-rata to their share.
  // In separate mode it is split across both parties; in the destination fallback
  // (one side gets 0%) the single recipient absorbs it via `netAfterStripeCents`.
  let primaryAmountCents = needsSecondaryTransfer ? primaryAmountBeforeFee : netAfterStripeCents;
  let secondaryAmountCents = secondaryAmountBeforeFee;

  if (needsSecondaryTransfer) {
    const totalShareForFee = primaryAmountBeforeFee + secondaryAmountBeforeFee;
    const primaryFeeShare = totalShareForFee > 0
      ? Math.round((stripeFeeEstimatedCents * primaryAmountBeforeFee) / totalShareForFee)
      : 0;
    const secondaryFeeShare = stripeFeeEstimatedCents - primaryFeeShare;
    primaryAmountCents = Math.max(0, primaryAmountBeforeFee - primaryFeeShare);
    secondaryAmountCents = Math.max(0, secondaryAmountBeforeFee - secondaryFeeShare);
  }

  return {
    grossAmountCents: grossCents,
    yunoFeeCents,
    stripeFeeEstimatedCents,
    splitMode: needsSecondaryTransfer ? "separate" : "destination",
    primary: {
      accountId: primaryAccountId,
      amountCents: primaryAmountCents,
      kind: primaryIsVenue ? "venue" : "organizer",
      venueId: primaryIsVenue ? venueId : null,
      organizerId: primaryIsVenue ? null : organizerId,
    },
    secondary: needsSecondaryTransfer
      ? {
          accountId: secondaryAccountId!,
          amountCents: secondaryAmountCents,
          kind: primaryIsVenue ? "organizer" : "venue",
          venueId: primaryIsVenue ? null : venueId,
          organizerId: primaryIsVenue ? organizerId : null,
        }
      : null,
    effectiveSplit: split,
  };
}

function defaultSplitForItem(itemType: ItemType, mode: string | null) {
  // Sensible defaults per mode:
  // co_event:     50/50 tickets, 0/100 tables (club gets table revenue)
  // venue_rental: 100/0 tickets to organizer, 0/100 tables to venue
  // org_hosted:   100/0 tickets to organizer, 100/0 tables to organizer
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
