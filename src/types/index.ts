export type Venue = {
  id: string;
  name: string;
  city: string;
  address?: string;
  coverUrl?: string;
  logoUrl?: string;
  coverPosition?: { x: number; y: number };
};

export type Drink = {
  id: string;
  venueId: string;
  name: string;
  price: number;
  promoPrice?: number;
  presalePrice?: number;
  presaleActive?: boolean;
  imgUrl: string;
  description?: string;
  desc?: string; // deprecated, use description
  alcPct?: number;
  active: boolean;
  position?: number;
  collection: 'drink' | 'shot' | 'soft';
};

export type CartItem = {
  drinkId: string;
  name: string;
  unitPrice: number;
  originalPrice?: number;
  qty: number;
  imgUrl?: string;
  eventId?: string;
  eventTitle?: string;
  collection?: string;
};

export type OrderStatus = 'pending' | 'paid' | 'served' | 'refunded' | 'cancelled';

export type PrepStatus = 'queue' | 'preparing' | 'ready' | 'served';
export type NotifyStatus = 'none' | 'ready' | 'picked';

export type Order = {
  id: string;
  userEmail?: string;
  venueId: string;
  items: CartItem[];
  total: number;
  /** Yuno service fee on this order (€). Club revenue = total − serviceFee. */
  serviceFee?: number;
  status: OrderStatus;
  createdAt: string;
  paidAt?: string;
  servedAt?: string;
  token?: string;
  tokenUsed?: boolean;
  tokenExpiresAt?: string;
  prepRequested?: boolean;
  prepStatus?: PrepStatus;
  prepClaimedBy?: string;
  prepClaimedAt?: string;
  readyAt?: string;
  notifyStatus?: NotifyStatus;
  archived?: boolean;
  selectedBar?: string;
  assignedBar?: string;
  serviceFee?: number;
};

export type Event = {
  id: string;
  venueId: string;
  title: string;
  description?: string;
  posterUrl?: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Role = 'client' | 'barman' | 'owner' | 'bouncer' | 'promoter' | 'dj' | 'manager' | 'vip_host' | 'cloakroom' | 'organizer' | 'affiliate';

export type AffiliateType = 'yuno_internal' | 'city_agency' | 'independent';

export type Affiliate = {
  id: string;
  userId: string;
  name: string;
  type: AffiliateType;
  city?: string;
  commissionRate: number;
  trackingPrefix?: string;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
};

export type AffiliateVenue = {
  id: string;
  affiliateId: string;
  name: string;
  slug: string;
  city?: string;
  neighborhood?: string;
  description?: string;
  coverImageUrl?: string;
  galleryUrls: string[];
  instagram?: string;
  tiktok?: string;
  website?: string;
  externalBookingUrl?: string;
  genres: string[];
  minAge?: number;
  dresscode?: string;
  address?: string;
  lat?: number;
  lng?: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type AffiliateEventStatus = 'draft' | 'published' | 'featured';

export type AffiliateEvent = {
  id: string;
  affiliateId: string;
  affiliateVenueId?: string;
  affiliateVenue?: Pick<AffiliateVenue, 'id' | 'name' | 'slug' | 'city'>;
  name: string;
  slug: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
  flyerUrl?: string;
  galleryUrls: string[];
  description?: string;
  genres: string[];
  djNames: string[];
  externalTicketUrl?: string;
  priceFrom?: number;
  isFree: boolean;
  isSoldOut: boolean;
  status: AffiliateEventStatus;
  recurringTemplateId?: string;
  createdAt: string;
};

export type AffiliateRecurringTemplate = {
  id: string;
  affiliateId: string;
  affiliateVenueId?: string;
  affiliateVenue?: Pick<AffiliateVenue, 'id' | 'name' | 'slug'>;
  name: string;
  dayOfWeek: number;
  advanceDays: number;
  startTime?: string;
  endTime?: string;
  priceFrom?: number;
  isFree: boolean;
  genres: string[];
  isActive: boolean;
  createdAt: string;
};

export type AffiliateClick = {
  id: string;
  affiliateEventId: string;
  affiliateId: string;
  clickedAt: string;
  userId?: string;
  browserId?: string;
  referrer?: string;
};

export type VipStatus = 'waiting' | 'placed' | 'active' | 'finished' | 'no_show' | 'denied';

export type VipReservation = {
  id: string;
  zoneId: string;
  zoneName?: string;
  zoneColor?: string;
  eventId: string;
  eventTitle?: string;
  userId?: string;
  userEmail: string;
  fullName: string;
  phone?: string;
  guestCount: number;
  deposit: number;
  totalPrice: number;
  minimumSpend?: number;
  status: string;
  vipStatus: VipStatus;
  paidAt?: string;
  placedAt?: string;
  placedBy?: string;
  assignedTableId?: string;
  assignedTableName?: string;
  finishedAt?: string;
  qrCode?: string;
  createdAt: string;
  checkedInAt?: string;
  /** Indicates if the customer has physically arrived (scanned or being served) */
  hasArrived?: boolean;
};

export type VipConsumption = {
  id: string;
  tableReservationId: string;
  venueId: string;
  eventId?: string;
  itemName: string;
  itemType: 'bottle' | 'extra' | 'service';
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  servedBy?: string;
  staffId?: string;
  servedAt: string;
  notes?: string;
  createdAt: string;
};

export type FloorPlanTableShape = 'rectangle' | 'circle' | 'diamond' | 'star';

export type FloorPlanTable = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zoneId?: string;
  zoneColor?: string;
  capacity?: number;
  maxExtraPersons?: number;
  extraPersonPrice?: number;
  shape?: FloorPlanTableShape;
  color?: string;
  borderRadius?: number;
  fillOpacity?: number;
};

export type VenueFloorPlan = {
  id: string;
  venueId: string;
  backgroundImageUrl?: string | null;
  layout: {
    tables: FloorPlanTable[];
    zoneAreas?: any[];
    width?: number;
    height?: number;
    bgOffset?: { x: number; y: number };
    bgScale?: number;
  };
  createdAt: string;
  updatedAt: string;
};
