// Public guest-list signup link builder, shared across every part (club / DJ /
// promoter / custom). The /club/{slug}/... slug segment is COSMETIC — the signup
// page (GuestListSignup) resolves the row by ?token=, so any stable slug works.
// This consolidates the two divergent builders that lived in OwnerGuestList.

/** URL-safe slug from a venue/holder name (strips accents). Display-only. */
export function glSlugify(name: string | null | undefined): string {
  const s = (name || 'event')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'event';
}

/**
 * The slug used in a part's share link. Venues use their name-slug; organizers
 * (no venue) fall back to their user id, or 'organizer' as a last resort.
 */
export function partSlug(opts: {
  isOrganizerScope: boolean;
  organizerUserId?: string | null;
  venueName?: string | null;
}): string {
  if (opts.isOrganizerScope) return opts.organizerUserId ?? 'organizer';
  return glSlugify(opts.venueName);
}

export function buildShareLink(opts: {
  slug: string;
  eventId: string;
  token: string;
  gender?: 'female' | 'male';
  origin?: string;
}): string {
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const base = `${origin}/club/${opts.slug}/event/${opts.eventId}/guestlist?token=${opts.token}`;
  return opts.gender ? `${base}&gender=${opts.gender}` : base;
}

/** Lien UNIQUE personnel (guest_list_invites) — même page, résolu par ?invite=. */
export function buildInviteLink(opts: {
  slug: string;
  eventId: string;
  token: string;
  origin?: string;
}): string {
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${origin}/club/${opts.slug}/event/${opts.eventId}/guestlist?invite=${opts.token}`;
}
