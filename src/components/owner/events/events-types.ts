import { Event } from '@/types';

// Types extracted verbatim from OwnerEvents.tsx.
export type EventKind = 'public_event' | 'private_event';
export type CollabMode = 'solo' | 'co_event' | 'venue_rental' | 'hosted_by_venue';

export type OwnerEventRow = Event & {
  isPartnerHosted?: boolean;
  organizerUserId?: string | null;
  ticketingEnabled?: boolean;
  tablesEnabled?: boolean;
  ticketSellingMode?: string;
  roundsCount?: number;
  /** Organizer private events: their only shareable URL is the direct link, surfaced on the card. */
  isPrivate?: boolean;
};

export type VenuePreset = { id: string; name: string; ticket_type: string; total_capacity: number; selling_mode: string | null; rounds: unknown };
