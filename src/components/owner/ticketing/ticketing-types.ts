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

// Shape of the round-creation form state (verbatim from OwnerTicketing useState).
export interface RoundFormData {
  name: string;
  price: string;
  maxTickets: string;
  isActive: boolean;
  autoActivate: boolean;
  lastTicketsThreshold: string;
  includesDrink: boolean;
  drinkDeadlineType: 'hours_after_start' | 'fixed_time' | 'none';
  drinkDeadlineHours: string;
  drinkCutoffTime: string;
  ticketType: TicketType;
  entryDeadline: string;
}

// Shape of the preset-creation form state (verbatim from OwnerTicketing useState).
export interface PresetFormData {
  name: string;
  totalCapacity: string;
  lastTicketsThreshold: string;
  includesDrink: boolean;
  drinkDeadlineType: 'hours_after_start' | 'fixed_time' | 'none';
  drinkDeadlineHours: string;
  drinkCutoffTime: string;
  rounds: { name: string; price: string; maxTickets: string; entryDeadline: string; includesDrink: boolean }[];
}

// Shape of the bulk-drink form state (verbatim from OwnerTicketing useState).
export interface BulkDrinkFormData {
  includesDrink: boolean;
  drinkDeadlineType: 'hours_after_start' | 'fixed_time' | 'none';
  drinkDeadlineHours: string;
  drinkCutoffTime: string;
  applyToStandard: boolean;
  applyToVip: boolean;
}

// One row of the activation-wizard guided rounds builder (verbatim from OwnerTicketing).
export interface WizardCustomRound {
  name: string;
  price: string;
  maxTickets: string;
  ticketType: TicketType;
  includesDrink: boolean;
  entryDeadline?: string;
}

export type TicketSalesMode = 'private' | 'presale' | 'normal';
export type SalesDraft = {
  mode: TicketSalesMode;
  presaleStartAt: string;
  publicSaleStartAt: string;
  waitlistEnabled: boolean;
};
