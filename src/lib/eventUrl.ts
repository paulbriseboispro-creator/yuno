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
 * Chemin canonique quand le host est DÉJÀ résolu (RPC `event_host_slug`, la
 * source de vérité serveur : slug d'orga pour une soirée organizer-led, sinon
 * slug du club). C'est la seule porte pour construire un lien event hors React.
 *
 * ⚠️ `/event/:eventId` attend un **UUID**, jamais un slug : y jeter un slug rend
 * « Événement introuvable ». Sans host, on retombe donc sur l'ID, pas sur le slug.
 */
export function eventPathFromHost(id: string, slug?: string | null, host?: string | null): string {
  return slug && host ? `/events/${host}/${slug}` : `/event/${id}`;
}

/**
 * Construit le lien propre vers la page d'une soirée.
 * Fallback sur l'ancienne route UUID quand le slug/host n'est pas (encore) chargé —
 * EventDetails sait rendre la page par UUID, donc rien ne casse.
 */
export function eventPath(e: EventLinkParts): string {
  const host = e.isOrganizerLed ? e.organizerSlug : e.venueSlug;
  if (e.slug && host) return eventPathFromHost(e.id, e.slug, host);
  // Fallback : données incomplètes -> ancienne route par UUID.
  if (!e.isOrganizerLed && e.venueSlug) return `/club/${e.venueSlug}/event/${e.id}`;
  return `/event/${e.id}`;
}
