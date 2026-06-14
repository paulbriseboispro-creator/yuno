/**
 * Builds a PostgREST OR filter string for visitor_sessions / live_visitor_pings
 * scoped to an organizer. Includes:
 *  - organizer_user_id matches
 *  - event_id within the organizer's events
 *  - venue_id within the venues that host the organizer's events (covers
 *    the common case where anonymous traffic is only tagged with venue_id)
 */
export function buildOrganizerScopeOr(
  organizerId: string,
  eventIds: string[],
  venueIds: string[],
): string {
  const parts: string[] = [`organizer_user_id.eq.${organizerId}`];
  if (eventIds.length) parts.push(`event_id.in.(${eventIds.join(',')})`);
  // venue_id is text — wrap each value in double quotes for safety
  if (venueIds.length) parts.push(`venue_id.in.(${venueIds.map(v => `"${v}"`).join(',')})`);
  return parts.join(',');
}
