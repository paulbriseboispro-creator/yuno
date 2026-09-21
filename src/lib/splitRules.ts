import type { CollabRemuneration, CollabTier, PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';

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

type SplitBlock = { organizer_pct: number; venue_pct: number; enabled?: boolean; basis?: 'deposit' | 'total_spend' };

const DRINKS_VENUE_DEFAULT: SplitBlock = { organizer_pct: 0, venue_pct: 100 };

/**
 * Read a per-category block ({ organizer_pct, venue_pct }) if present and valid.
 * Les clés de PÉRIMÈTRE sont préservées : `enabled: false` (pilier sorti du deal,
 * vente refusée au checkout) et `basis` (tables : partage sur acompte ou sur le
 * total dépensé de la soirée). Les perdre ici les ferait disparaître de chaque
 * affichage ET de chaque proposition re-soumise depuis un état normalisé.
 */
function readBlock(raw: unknown): SplitBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.organizer_pct == null && r.venue_pct == null) return null;
  const o = Number(r.organizer_pct ?? (r.venue_pct != null ? 100 - Number(r.venue_pct) : 0));
  const v = Number(r.venue_pct ?? (100 - o));
  const block: SplitBlock = { organizer_pct: o, venue_pct: v };
  if (r.enabled === false || r.enabled === 'false' || r.enabled === 0) block.enabled = false;
  if (r.basis === 'total_spend' || r.basis === 'deposit') block.basis = r.basis;
  return block;
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
  // Le barème vit À CÔTÉ des blocs pilier : le perdre ici le ferait disparaître
  // du contrat re-soumis depuis un état normalisé, et une proposition à barème
  // repartirait en partage par pilier sans que personne ne le voie.
  const remuneration = readRemuneration(r);

  if (!tickets && !tables && !remuneration) return null;

  return {
    tickets: tickets ?? { organizer_pct: 0, venue_pct: 100 },
    tables: tables ?? { organizer_pct: 0, venue_pct: 100 },
    drinks,
    ...(remuneration ? { remuneration } : {}),
  };
}

// ─── Barème sur le CA de la soirée ───────────────────────────────────────────

/**
 * Lit `rules.remuneration` si c'est un barème valide (mode tiered_total, au moins
 * un palier). Paliers triés par seuil croissant, seuils et taux bornés ≥ 0 ;
 * un palier sans seuil lisible vaut « à partir de 0 ».
 */
export function readRemuneration(raw: unknown): CollabRemuneration | null {
  if (!raw || typeof raw !== 'object') return null;
  const rem = (raw as { remuneration?: unknown }).remuneration;
  if (!rem || typeof rem !== 'object') return null;
  const r = rem as { mode?: unknown; tiers?: unknown; tiers_mode?: unknown };
  if (r.mode !== 'tiered_total' || !Array.isArray(r.tiers) || r.tiers.length === 0) return null;
  const tiers: CollabTier[] = r.tiers
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      from: Math.max(0, Number(t.from ?? 0) || 0),
      pct: Math.max(0, Number(t.pct ?? 0) || 0),
    }))
    .sort((a, b) => a.from - b.from);
  if (tiers.length === 0) return null;
  return {
    mode: 'tiered_total',
    tiers,
    tiers_mode: r.tiers_mode === 'marginal' ? 'marginal' : 'flat',
  };
}

/** Le contrat rémunère-t-il par barème sur le CA total (au lieu d'un % par pilier) ? */
export function isTieredRules(raw: unknown): boolean {
  return readRemuneration(raw) !== null;
}

/**
 * Taux et montant dus à l'organisateur pour un CA total donné. Miroir EXACT de
 * public.collab_tier_pct(jsonb, numeric) : toute évolution se fait des deux côtés.
 *  - flat     : le taux du palier atteint (seuil ≤ total, le plus haut) s'applique à
 *               TOUT le total. C'est la lecture littérale d'un barème « 3,5k–5,5k = 7 % ».
 *  - marginal : chaque tranche à son taux ; `pct` rendu = taux effectif (2 déc.).
 */
export function tierFor(rem: CollabRemuneration | null, total: number): { pct: number; amount: number } {
  if (!rem || rem.tiers.length === 0) return { pct: 0, amount: 0 };
  const t = Math.max(0, Number(total) || 0);
  const tiers = [...rem.tiers].sort((a, b) => a.from - b.from);
  if (rem.tiers_mode === 'marginal') {
    let amount = 0;
    for (let i = 0; i < tiers.length; i++) {
      const from = tiers[i].from;
      if (t <= from) continue;
      const next = i + 1 < tiers.length ? tiers[i + 1].from : t;
      amount += (Math.min(t, next) - from) * tiers[i].pct / 100;
    }
    const rounded = Math.round(amount * 100) / 100;
    return { pct: t > 0 ? Math.round((amount / t) * 10000) / 100 : 0, amount: rounded };
  }
  let pct = 0;
  for (const tier of tiers) if (tier.from <= t) pct = tier.pct;
  return { pct, amount: Math.round(t * pct) / 100 };
}

/**
 * Les blocs pilier d'un contrat à barème : tout au club pendant la vente, la
 * part de l'organisateur se calcule après. Le bloc boissons garde le périmètre
 * qu'il avait (un pilier sorti du deal reste sorti).
 */
export function tieredPillarBlocks(prev?: PartnershipSplitRules | null): Pick<PartnershipSplitRules, 'tickets' | 'tables' | 'drinks'> {
  const keep = (b?: { enabled?: boolean }) => (b?.enabled === false ? { enabled: false as const } : {});
  return {
    tickets: { organizer_pct: 0, venue_pct: 100, ...keep(prev?.tickets) },
    tables: { organizer_pct: 0, venue_pct: 100, ...keep(prev?.tables) },
    drinks: { organizer_pct: 0, venue_pct: 100, ...keep(prev?.drinks) },
  };
}

/**
 * Un barème saisi est-il cohérent ? Au moins un palier, seuils strictement
 * croissants, taux entre 0 et 100, premier seuil à 0 (en dessous du premier
 * seuil, le taux vaut 0 : on l'écrit explicitement plutôt que de le deviner).
 */
export function validateTiers(tiers: CollabTier[]): string | null {
  if (!tiers.length) return 'empty';
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  if (sorted[0].from !== 0) return 'first_from_not_zero';
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (!Number.isFinite(t.from) || t.from < 0) return 'bad_from';
    if (!Number.isFinite(t.pct) || t.pct < 0 || t.pct > 100) return 'bad_pct';
    if (i > 0 && t.from <= sorted[i - 1].from) return 'from_not_increasing';
  }
  if (!sorted.some((t) => t.pct > 0)) return 'all_zero';
  return null;
}
