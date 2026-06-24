export type TicketType = 'standard' | 'vip';

export type TicketSellingMode = 'simple' | 'rounds' | 'timed_entry';

export type PresetSellingMode = 'simple' | 'rounds' | 'timed_entry';

export type EventSalesStatus = 'coming_soon' | 'presale' | 'public_sale' | 'sold_out';

export type TicketRound = {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  price: number;
  maxTickets: number;
  ticketsSold: number;
  position: number;
  isActive: boolean;
  autoActivate: boolean;
  lastTicketsThreshold: number;
  includesDrink?: boolean;
  drinkDeadlineHours?: number;
  drinkDeadlineType?: 'hours_after_start' | 'fixed_time' | 'none';
  drinkCutoffTime?: string;
  allowedDrinkCollections?: string[];
  entryDeadline?: string;
  ticketType: TicketType;
  createdAt: string;
  updatedAt: string;
};

export type Ticket = {
  id: string;
  ticketRoundId: string;
  eventId: string;
  userId: string;
  userEmail: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  serviceFee: number;
  status: 'pending' | 'paid' | 'cancelled';
  qrCode?: string;
  used: boolean;
  usedAt?: string;
  ticketType: TicketType;
  createdAt: string;
  paidAt?: string;
};

export type TableZone = {
  id: string;
  venueId: string;
  name: string;
  color: string;
  tablesCount: number;
  position: number;
  lastTablesThreshold: number;
  createdAt: string;
  updatedAt: string;
};

export type EventTableSettings = {
  id: string;
  eventId: string;
  presetId?: string;
  customPrices: { packId: string; price: number }[];
  createdAt: string;
  updatedAt: string;
};

export type TablePack = {
  id: string;
  zoneId: string;
  venueId: string;
  name: string;
  description?: string;
  basePrice: number;
  baseCapacity: number;
  extraPersonPrice: number;
  maxExtraPersons: number;
  deposit: number;
  depositType: 'fixed' | 'percentage';
  includedItems?: string;
  includedBottlesQuota: number;
  minimumSpend: number;
  tablesCount: number;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VipTable = {
  id: string;
  venueId: string;
  zoneId?: string;
  tableNumber: string;
  price?: number;
  capacity: number;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
};

export type TableReservation = {
  id: string;
  tableId?: string;
  zoneId?: string;
  packId?: string;
  eventId: string;
  userId: string;
  userEmail: string;
  guestCount: number;
  totalPrice: number;
  serviceFee: number;
  deposit: number;
  status: 'pending' | 'paid' | 'cancelled';
  createdAt: string;
  paidAt?: string;
};

export type EventWithTicketing = {
  id: string;
  venueId: string;
  title: string;
  description?: string;
  posterUrl?: string;
  posterPosition?: { x: number; y: number; scale: number };
  startAt: string;
  endAt: string;
  isActive: boolean;
  ticketingEnabled: boolean;
  maxTickets?: number;
  tablesEnabled: boolean;
  /** Event-level: minors allowed → alcohol-free. Derived from the creator's global
   *  setting minus a per-event opt-out; maintained denormalized in events.alcohol_free. */
  alcoholFree?: boolean;
  /** BDE event (organizer is bde_verified). Lowers the ticket/table commission floor
   *  to 0.49€. Stamped server-side onto events.is_bde — read-only signal for the buyer UI. */
  isBde?: boolean;
  ticketSellingMode?: TicketSellingMode;
  // Sales timing fields
  presaleStartAt?: string;
  publicSaleStartAt?: string;
  waitlistEnabled?: boolean;
  /** Controls how upcoming ticket rounds are shown to buyers. */
  roundsVisibility?: 'sequential' | 'preview_upcoming' | 'all_open';
  createdAt: string;
  updatedAt: string;
};

// Guest List types
export type GuestList = {
  id: string;
  eventId: string;
  venueId: string;
  quota: number;
  quotaFemale?: number;
  quotaMale?: number;
  freeBeforeTime: string;
  includesDrink: boolean;
  visibleOnClubPage: boolean;
  isActive: boolean;
  shareToken: string;
  createdAt: string;
  updatedAt: string;
};

export type GuestListEntry = {
  id: string;
  guestListId: string;
  userId?: string;
  fullName: string;
  email: string;
  phone: string;
  gender?: string;
  qrCode: string;
  status: 'reserved' | 'entered' | 'expired' | 'cancelled';
  entryScanned: boolean;
  entryScannedAt?: string;
  entryScannedBy?: string;
  promoterId?: string;
  createdAt: string;
};

// Service fee rates. BDE-verified organizers (events.is_bde) pay the same 4% rate
// but a reduced per-item floor (0.49€ vs 0.99€) on tickets/tables. Mirror of the
// backend single source of truth in supabase/functions/_shared/commission.ts.
export const SERVICE_FEE_RATES = {
  DRINKS: 0.03,
  TICKETS: 0.04,
  TABLES: 0.04,
  TICKETS_MIN: 0.99,
  TABLES_MIN: 0.99,
  TICKETS_MIN_BDE: 0.49,
  TABLES_MIN_BDE: 0.49,
} as const;

export const calculateServiceFee = (
  amount: number,
  type: 'drinks' | 'tickets' | 'tables',
  isBde = false,
): number => {
  if (type === 'drinks') {
    return Math.round(amount * SERVICE_FEE_RATES.DRINKS * 100) / 100;
  }
  // Tickets & Tables: max(floor, 4% of amount). BDE gets a reduced floor; rate is unchanged.
  const min = isBde ? SERVICE_FEE_RATES.TICKETS_MIN_BDE : SERVICE_FEE_RATES.TICKETS_MIN;
  return Math.round(Math.max(min, amount * SERVICE_FEE_RATES.TICKETS) * 100) / 100;
};

// Stripe FR card-processing fee estimate. MUST mirror the edge-function
// `estimateStripeFeeEur` in supabase/functions/_shared/payment-split.ts so the
// fan-facing total on our pages equals what Stripe actually charges.
export const STRIPE_FEE_PCT = 0.015;
export const STRIPE_FEE_FIXED = 0.25;
export const estimateStripeFee = (amount: number): number =>
  amount <= 0 ? 0 : Math.round((amount * STRIPE_FEE_PCT + STRIPE_FEE_FIXED) * 100) / 100;

/**
 * Customer-facing transaction fee shown before checkout.
 *  - feeAbsorbed = false (default): the Yuno commission (calculateServiceFee).
 *  - feeAbsorbed = true: only the Stripe transaction cost — the club/organizer has
 *    opted to absorb the Yuno commission. Mirrors the edge-function `transactionFee`
 *    so the displayed total matches the real Stripe charge.
 */
export const customerTransactionFee = (
  amount: number,
  type: 'drinks' | 'tickets' | 'tables',
  feeAbsorbed: boolean,
  isBde = false,
): number => (feeAbsorbed ? estimateStripeFee(amount) : calculateServiceFee(amount, type, isBde));

// Helper: compute event sales status from timestamps + waitlist mode
export function getEventSalesStatus(
  event: Pick<EventWithTicketing, 'presaleStartAt' | 'publicSaleStartAt' | 'waitlistEnabled'>,
  allRoundsSoldOut?: boolean,
): EventSalesStatus {
  const now = Date.now();
  const presaleStart = event.presaleStartAt ? new Date(event.presaleStartAt).getTime() : null;
  const publicStart = event.publicSaleStartAt ? new Date(event.publicSaleStartAt).getTime() : null;

  // Private mode: waitlist open, no sale dates yet
  if (!presaleStart && !publicStart) {
    if (event.waitlistEnabled) return 'coming_soon';
    return allRoundsSoldOut ? 'sold_out' : 'public_sale';
  }

  // Misconfigured dates guard: keep event in presale window, never force public sale
  if (presaleStart && publicStart && publicStart <= presaleStart) {
    if (now < presaleStart) return 'coming_soon';
    if (allRoundsSoldOut) return 'sold_out';
    return 'presale';
  }

  const firstSaleDate = presaleStart || publicStart;
  if (firstSaleDate && now < firstSaleDate) return 'coming_soon';
  if (presaleStart && publicStart && now >= presaleStart && now < publicStart) return 'presale';
  if (allRoundsSoldOut) return 'sold_out';
  return 'public_sale';
}
