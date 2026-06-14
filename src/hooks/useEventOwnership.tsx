import { useMemo } from 'react';

export interface EventOwnershipInput {
  venue_id: string | null;
  organizer_user_id: string | null;
  partner_venue_id: string | null;
  partner_organizer_id: string | null;
  tables_owner_user_id?: string | null;
}

export interface EventOwnership {
  /** This club is the lead host (owns the event metadata). */
  isLeadVenue: boolean;
  /** This club is the partner host (orga is lead). Read-only metadata. */
  isPartnerVenue: boolean;
  /** This organizer is the lead organizer. */
  isLeadOrganizer: boolean;
  /** This organizer is the partner (club is lead). */
  isPartnerOrganizer: boolean;
  /** Event has both an organizer and a venue (true co-event). */
  isCoEvent: boolean;
  /** This actor can edit event metadata (title, dates, poster, description). */
  canEditMetadata: boolean;
  /** This actor can edit ticketing (rounds, presets). */
  canEditTickets: boolean;
  /** This actor can edit table sales (zones/packs/floor plan). */
  canEditTables: boolean;
}

/**
 * Determine the role and edition rights of the current dashboard user
 * (`scopeVenueId` for clubs, `scopeOrganizerUserId` for organizers)
 * over a given event.
 *
 * Rules:
 * - Lead venue/orga = full control over its own scope (metadata + sub-systems).
 * - Partner venue (paid plan) = read-only metadata BUT can co-manage tables/tickets
 *   if the lead orga did not lock them (no event-scoped tables).
 * - Partner organizer = symmetrical for orga-side.
 *
 * RLS already gates writes server-side via can_manage_event_tables /
 * can_manage_event_split — this hook only powers the UI.
 */
export function useEventOwnership(
  event: EventOwnershipInput | null | undefined,
  scope: { venueId?: string | null; organizerUserId?: string | null },
): EventOwnership {
  return useMemo(() => {
    if (!event) {
      return {
        isLeadVenue: false,
        isPartnerVenue: false,
        isLeadOrganizer: false,
        isPartnerOrganizer: false,
        isCoEvent: false,
        canEditMetadata: false,
        canEditTickets: false,
        canEditTables: false,
      };
    }

    const isLeadVenue = !!scope.venueId && event.venue_id === scope.venueId;
    const isPartnerVenue = !!scope.venueId && event.partner_venue_id === scope.venueId && !isLeadVenue;
    const isLeadOrganizer =
      !!scope.organizerUserId && event.organizer_user_id === scope.organizerUserId;
    const isPartnerOrganizer =
      !!scope.organizerUserId && event.partner_organizer_id === scope.organizerUserId && !isLeadOrganizer;

    const isCoEvent =
      (!!event.venue_id && !!event.partner_organizer_id) ||
      (!!event.organizer_user_id && !!event.partner_venue_id);

    const isLead = isLeadVenue || isLeadOrganizer;
    const isPartner = isPartnerVenue || isPartnerOrganizer;

    return {
      isLeadVenue,
      isPartnerVenue,
      isLeadOrganizer,
      isPartnerOrganizer,
      isCoEvent,
      // Metadata only the lead can edit
      canEditMetadata: isLead,
      // Tickets / tables: lead always; partner club can co-manage venue-scoped tickets / tables
      canEditTickets: isLead || isPartnerVenue,
      canEditTables:
        isLead ||
        isPartnerVenue ||
        (!!event.tables_owner_user_id && event.tables_owner_user_id === scope.organizerUserId),
    };
  }, [event, scope.venueId, scope.organizerUserId]);
}
