// URL canonique d'une page event : /events/:host/:slug (ex. /events/womber/techno-rise).
// Le « host » colle au routing : organizer-led -> slug d'orga, sinon -> venue_id (déjà propre).
// Voir la migration 20260705150000_event_clean_slugs.sql (resolve_event_path / event_host_slug).

export interface EventLinkParts {
  id: string;
  slug?: string | null;
  isOrganizerLed?: boolean;
  organizerSlug?: string | null;
  venueSlug?: string | null;
}

/**
 * Construit le lien propre vers la page d'une soirée.
 * Fallback sur l'ancienne route UUID quand le slug/host n'est pas (encore) chargé —
 * EventDetails redirige alors vers l'URL propre au chargement, donc rien ne casse.
 */
export function eventPath(e: EventLinkParts): string {
  const host = e.isOrganizerLed ? e.organizerSlug : e.venueSlug;
  if (e.slug && host) return `/events/${host}/${e.slug}`;
  // Fallback : données incomplètes -> ancienne route (redirige vers /events/... au chargement).
  if (!e.isOrganizerLed && e.venueSlug) return `/club/${e.venueSlug}/event/${e.id}`;
  return `/event/${e.id}`;
}
