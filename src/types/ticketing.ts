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

// Service fee rates
export const SERVICE_FEE_RATES = {
  DRINKS: 0.03,
  TICKETS: 0.04,
  TABLES: 0.04,
  TICKETS_MIN: 0.99,
  TABLES_MIN: 0.99,
} as const;

export const calculateServiceFee = (amount: number, type: 'drinks' | 'tickets' | 'tables'): number => {
  if (type === 'drinks') {
    return Math.round(amount * SERVICE_FEE_RATES.DRINKS * 100) / 100;
  }
  // Tickets & Tables: max(0.99€, 4% of amount)
  return Math.round(Math.max(SERVICE_FEE_RATES.TICKETS_MIN, amount * SERVICE_FEE_RATES.TICKETS) * 100) / 100;
};

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
