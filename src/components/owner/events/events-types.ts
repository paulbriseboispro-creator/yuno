import { Event } from '@/types';

// Types extracted verbatim from OwnerEvents.tsx.
export type EventKind = 'public_event' | 'private_event';
export type CollabMode = 'solo' | 'co_event' | 'venue_rental' | 'hosted_by_venue';

export type OwnerEventRow = Event & {
  /** Club partenaire d'une co-soirée org-led (events.partner_venue_id) — le club
   *  physique quand venueId est NULL. */
  partnerVenueId?: string | null;
  isPartnerHosted?: boolean;
  organizerUserId?: string | null;
  ticketingEnabled?: boolean;
  tablesEnabled?: boolean;
  guestListEnabled?: boolean;
  /** Au moins UNE part de guest list active sur la soirée — maison, DJ,
   *  promoteur ou agence. `guestListEnabled` ne parle, lui, que de la part
   *  maison (c'est elle que publie l'interrupteur de la fiche). */
  hasGuestList?: boolean;
  /** « Complet » posé à la main sur un pilier de cette soirée (voir lib/soldOut.ts).
   *  Ce n'est pas `…Enabled = false` : l'offre reste affichée, elle ne se vend plus. */
  ticketsSoldOut?: boolean;
  tablesSoldOut?: boolean;
  guestListSoldOut?: boolean;
  ticketSellingMode?: string;
  roundsCount?: number;
  /** Organizer private events: their only shareable URL is the direct link, surfaced on the card. */
  isPrivate?: boolean;
};

export type VenuePreset = { id: string; name: string; ticket_type: string; total_capacity: number; selling_mode: string | null; rounds: unknown };
