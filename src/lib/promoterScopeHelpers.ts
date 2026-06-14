import type { PromoterScope } from '@/hooks/usePromoterScope';

/**
 * Returns the active scope id (venue_id or organizer_user_id) and the column
 * name used to filter promoter-related tables.
 */
export function getScopeFilter(scope: PromoterScope) {
  if (scope.kind === 'organizer') {
    return {
      column: 'organizer_user_id' as const,
      value: scope.organizerId,
      payload: { organizer_user_id: scope.organizerId, venue_id: null as string | null },
    };
  }
  return {
    column: 'venue_id' as const,
    value: scope.venueId,
    payload: { venue_id: scope.venueId, organizer_user_id: null as string | null },
  };
}

/**
 * Returns true if the scope has a resolved id ready for queries.
 */
export function scopeReady(scope: PromoterScope): boolean {
  if (scope.loading) return false;
  return scope.kind === 'organizer' ? !!scope.organizerId : !!scope.venueId;
}

/**
 * Returns the scope id (string|null) of the active context.
 */
export function scopeId(scope: PromoterScope): string | null {
  return scope.kind === 'organizer' ? scope.organizerId : scope.venueId;
}

/**
 * For querying events: returns the OR clause needed to fetch events linked to
 * this scope (lead, partner venue, partner organizer, etc).
 */
export function scopeEventsOr(scope: PromoterScope): string | null {
  if (scope.kind === 'organizer' && scope.organizerId) {
    return `organizer_user_id.eq.${scope.organizerId},partner_organizer_id.eq.${scope.organizerId}`;
  }
  if (scope.kind === 'venue' && scope.venueId) {
    return `venue_id.eq.${scope.venueId},partner_venue_id.eq.${scope.venueId}`;
  }
  return null;
}
