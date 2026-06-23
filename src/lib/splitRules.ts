import type { PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';

/**
 * Canonical co-event revenue-split shape:
 *   { tickets: { organizer_pct, venue_pct },
 *     tables:  { organizer_pct, venue_pct },
 *     drinks:  { organizer_pct, venue_pct } }
 *
 * But older paths (recurring co-event templates via RecurringEventsManager,
 * legacy partnership defaults) stored a FLAT shape — a single global split:
 *   { organizer: 30, venue: 70 }   (drinks sometimes appended nested)
 *
 * The whole app (SplitContractBanner, getEffectiveSplit, backend payment-split.ts)
 * assumes the nested shape and reads `rules.tickets.organizer_pct` directly, so a
 * flat-shaped row throws "Cannot read properties of undefined" and white-screens
 * the collab dashboard. `normalizeSplitRules` is the single converter every read
 * boundary goes through: it accepts the canonical shape, the legacy flat shape,
 * partial/hybrid mixes, and null — and always returns the canonical shape (or null).
 *
 * Drinks default to 100% venue (the club holds the alcohol licence), but a stored
 * drinks split IS honored: an organizer who has attested their alcohol-sale licence
 * (organizer_profiles.can_sell_alcohol) can negotiate a drinks share. The attestation
 * is enforced at write time (create_event_collab_contract RPC + the split editors),
 * so readers simply honor whatever drinks split is stored.
 */

type SplitBlock = { organizer_pct: number; venue_pct: number };

const DRINKS_VENUE_DEFAULT: SplitBlock = { organizer_pct: 0, venue_pct: 100 };

/** Read a per-category block ({ organizer_pct, venue_pct }) if present and valid. */
function readBlock(raw: unknown): SplitBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.organizer_pct == null && r.venue_pct == null) return null;
  const o = Number(r.organizer_pct ?? (r.venue_pct != null ? 100 - Number(r.venue_pct) : 0));
  const v = Number(r.venue_pct ?? (100 - o));
  return { organizer_pct: o, venue_pct: v };
}

/** Read the legacy flat global split ({ organizer, venue }) if present. */
function readFlat(raw: Record<string, unknown>): SplitBlock | null {
  if (raw.organizer == null && raw.venue == null) return null;
  const o = Number(raw.organizer ?? (raw.venue != null ? 100 - Number(raw.venue) : 0));
  const v = Number(raw.venue ?? (100 - o));
  return { organizer_pct: o, venue_pct: v };
}

/**
 * Convert ANY stored split-rules shape into the canonical nested shape.
 * Returns null only when there is nothing usable to read (caller treats as "no rules").
 */
export function normalizeSplitRules(raw: unknown): PartnershipSplitRules | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const flat = readFlat(r);
  // Per-category blocks take precedence; the legacy flat split fills any gap.
  // Drinks never inherit the flat global split — they default to club unless an
  // explicit drinks block is stored (organizer attested their alcohol licence).
  const tickets = readBlock(r.tickets) ?? flat;
  const tables = readBlock(r.tables) ?? flat;
  const drinks = readBlock(r.drinks) ?? DRINKS_VENUE_DEFAULT;

  if (!tickets && !tables) return null;

  return {
    tickets: tickets ?? { organizer_pct: 0, venue_pct: 100 },
    tables: tables ?? { organizer_pct: 0, venue_pct: 100 },
    drinks,
  };
}
