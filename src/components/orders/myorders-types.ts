import { Tables } from '@/integrations/supabase/types';

// Types extracted verbatim from MyOrders.tsx (page-local domain shapes).
export interface LoyaltyTransaction {
  id: string;
  reference_type: string | null;
  reference_id: string | null;
  points: number;
}

export interface PendingReward {
  id: string;
  rewardName: string;
  rewardType: 'free_drink' | 'free_ticket' | 'discount';
  pointsSpent: number;
  qrCode: string | null;
  expiresAt: string | null;
  createdAt: string;
  venueName: string;
  venueId: string;
  metadata?: {
    drinkId?: string;
    drinkName?: string;
    eventId?: string;
    eventTitle?: string;
    roundId?: string;
    roundName?: string;
  };
  eventDetails?: {
    title: string;
    startAt: string;
    endAt: string;
    posterUrl: string | null;
  };
}

export type Order = Tables<'orders'> & {
  events?: {
    title: string;
    start_at: string;
    end_at: string;
    poster_url?: string;
    venue_id?: string;
  } | null;
  venueName?: string;
};

export interface OrderItem {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  imgUrl?: string;
}

export interface TicketWithDetails {
  id: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventPosterUrl?: string;
  venueName: string;
  roundName: string;
  quantity: number;
  totalPrice: number;
  serviceFee: number;
  status: string;
  qrCode: string;
  used: boolean;
  paidAt?: string;
  includesDrink?: boolean;
  drinkRedeemed?: boolean;
  hasInsurance?: boolean;
  insuranceFee?: number;
  drinkDeadlineType?: string;
  drinkDeadlineHours?: number;
  drinkCutoffTime?: string;
  entryScanned?: boolean;
  entryScannedAt?: string;
  refundAmount?: number;
  refundReason?: string;
  hasCloakroom?: boolean;
}

export interface VipReservationWithDetails {
  id: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventPosterUrl?: string;
  venueName: string;
  zoneName: string;
  packName: string;
  guestCount: number;
  totalPrice: number;
  deposit: number;
  managementFee: number;
  serviceFee: number;
  status: string;
  qrCode: string;
  paidAt?: string;
  fullName: string;
  entryScanned?: boolean;
  entryScannedAt?: string;
  refundAmount?: number;
  refundReason?: string;
  placementStatus?: string;
  requestedTableName?: string;
  assignedTableName?: string;
  placementNote?: string;
}

export interface GuestListEntryWithDetails {
  id: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventPosterUrl?: string;
  venueName: string;
  freeBeforeTime: string;
  includesDrink: boolean;
  qrCode: string;
  status: string;
  fullName: string;
  entryScanned: boolean;
  entryScannedAt?: string;
  drinkRedeemed?: boolean;
  createdAt: string;
  entryType?: string;
}
