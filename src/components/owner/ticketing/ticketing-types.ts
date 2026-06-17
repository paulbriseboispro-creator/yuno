import { TicketType, PresetSellingMode } from '@/types/ticketing';

// Extracted verbatim from OwnerTicketing.tsx — shared by the ticketing page + dialogs.
export interface PresetRound {
  name: string;
  price: number;
  maxTickets: number;
  lastTicketsThreshold: number;
  includesDrink?: boolean;
  drinkDeadlineType?: 'hours_after_start' | 'fixed_time' | 'none';
  drinkDeadlineHours?: number;
  drinkCutoffTime?: string;
  entryDeadline?: string;
}

export interface TicketPreset {
  id: string;
  venueId: string;
  name: string;
  totalCapacity: number;
  rounds: PresetRound[];
  ticketType: TicketType;
  sellingMode: PresetSellingMode;
  includesDrink?: boolean;
  drinkDeadlineType?: 'hours_after_start' | 'fixed_time' | 'none';
  drinkDeadlineHours?: number;
  drinkCutoffTime?: string;
  createdAt: string;
  updatedAt: string;
}

export type TicketSalesMode = 'private' | 'presale' | 'normal';
export type SalesDraft = {
  mode: TicketSalesMode;
  presaleStartAt: string;
  publicSaleStartAt: string;
  waitlistEnabled: boolean;
};
