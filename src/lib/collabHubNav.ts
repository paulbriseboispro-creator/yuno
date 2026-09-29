/**
 * Hub Collaborations — deux onglets, une liste de soirées (plan
 * `docs/designs/COLLAB_SIMPLIFICATION_PLAN.md`).
 *
 * Le hub répondait à la même question (« où en sont mes soirées à plusieurs ? »)
 * dans deux onglets, selon que la soirée était un contrat club × organisateur
 * (collab, deux parties, Stripe) ou une co-organisation (N parties, virements).
 * Il n'y a plus qu'une liste, et une seule pastille par soirée : l'ÉTAPE.
 *
 * Tout ce qui décide ici est pur et testé (`__tests__/collabHubNav.test.ts`).
 */

export type CollabHubTab = 'nights' | 'partners';

export interface CollabHubRoute {
  tab: CollabHubTab;
  /** L'ancien onglet « Inviter » ouvre désormais le dialogue d'invitation par email. */
  openInvite: boolean;
  /** Vrai quand l'adresse lue n'était pas la forme canonique : on la réécrit en place. */
  rewrite: boolean;
}

/**
 * Les anciennes adresses restent valables (alertes déjà émises, emails,
 * favoris) : `events` et `coorg` étaient deux listes de soirées, `organizers`
 * (club) et `partners` (orga) le carnet, `invite` un formulaire.
 */
const LEGACY: Record<string, { tab: CollabHubTab; openInvite?: boolean }> = {
  events: { tab: 'nights' },
  coorg: { tab: 'nights' },
  organizers: { tab: 'partners' },
  invite: { tab: 'nights', openInvite: true },
};

export function resolveCollabHubTab(raw: string | null | undefined): CollabHubRoute {
  if (raw === 'nights' || raw === 'partners') return { tab: raw, openInvite: false, rewrite: false };
  if (!raw) return { tab: 'nights', openInvite: false, rewrite: false };
  const legacy = LEGACY[raw];
  if (legacy) return { tab: legacy.tab, openInvite: !!legacy.openInvite, rewrite: true };
  // Valeur inconnue : une page valide, jamais un écran vide.
  return { tab: 'nights', openInvite: false, rewrite: true };
}

// ── Une soirée à plusieurs ─────────────────────────────────────────────────────

export interface CollabContractFacts {
  /** Statut du contrat vivant (`event_collab_contracts`), null = co-soirée sans contrat (héritage). */
  contractStatus: string | null;
  /** La soirée a été proposée par l'appelant : c'est l'autre partie qui doit signer. */
  initiatedByMe: boolean;
  paused: boolean;
  isActive: boolean;
  /** Accord « réglé entre vous » (pas de contrat Yuno, vente ouverte). */
  external?: boolean;
}

export interface CoorgFacts {
  pendingInvites: number;
  dealStatus: 'pending' | 'active' | 'cancelled' | null;
  settlementStatus: 'open' | 'approved' | 'settled' | null;
}

export interface CollabNight {
  eventId: string;
  title: string;
  startAt: string;
  endAt: string;
  posterUrl: string | null;
  /** Les AUTRES parties de la soirée (jamais l'appelant), dans l'ordre de la soirée. */
  partners: string[];
  /** Contrat club × organisateur (deux parties, Stripe). */
  collab: CollabContractFacts | null;
  /** Co-organisation (co-hôtes, accord, décompte, virements). */
  coorg: CoorgFacts | null;
}

export type NightStepKey =
  | 'paused' | 'to_sign' | 'awaiting_partner' | 'deal_to_approve' | 'transfers'
  | 'settled' | 'cancelled' | 'ended' | 'invite_pending' | 'signed' | 'external' | 'coorganized' | 'draft';

/** Couleur = statut seulement : rouge à faire, gris en attente de l'autre, vert fait. */
export type NightStepTone = 'todo' | 'waiting' | 'done' | 'muted';

export const NIGHT_STEP_TONE: Record<NightStepKey, NightStepTone> = {
  paused: 'waiting',
  to_sign: 'todo',
  awaiting_partner: 'waiting',
  deal_to_approve: 'todo',
  transfers: 'waiting',
  settled: 'done',
  cancelled: 'muted',
  ended: 'muted',
  invite_pending: 'waiting',
  signed: 'done',
  external: 'done',
  coorganized: 'done',
  draft: 'muted',
};

/**
 * L'étape d'une soirée, en UN mot. L'ordre des tests est l'ordre d'urgence :
 * ce qui demande une action à l'appelant passe devant ce qui décrit.
 */
export function collabNightStep(n: Pick<CollabNight, 'collab' | 'coorg' | 'endAt'>, now: Date = new Date()): NightStepKey {
  const c = n.collab;
  const o = n.coorg;
  const ended = new Date(n.endAt).getTime() < now.getTime();
  if (c?.paused) return 'paused';
  if (c?.contractStatus === 'pending_signatures') return c.initiatedByMe ? 'awaiting_partner' : 'to_sign';
  if (o?.dealStatus === 'pending') return 'deal_to_approve';
  if (o?.settlementStatus === 'approved') return 'transfers';
  if (o?.settlementStatus === 'settled' || c?.contractStatus === 'closed') return 'settled';
  if (c?.contractStatus === 'cancelled' && !o && !c.external) return 'cancelled';
  if (ended) return 'ended';
  if (o && o.pendingInvites > 0) return 'invite_pending';
  const signed = c?.contractStatus === 'active' || c?.contractStatus === 'locked';
  if (signed) return 'signed';
  if (c?.external) return 'external';
  if (o) return 'coorganized';
  // Co-soirée sans contrat (héritage) : la publication tient lieu d'état.
  return c?.isActive ? 'signed' : 'draft';
}

/**
 * Une soirée peut être À LA FOIS un contrat club × orga et une co-organisation
 * (un troisième organisateur invité) : une seule carte, les deux jeux de faits,
 * les partenaires réunis sans doublon. Tri : à venir d'abord (la plus proche en
 * tête), puis passées (la plus récente en tête).
 */
export function mergeCollabNights(collab: CollabNight[], coorg: CollabNight[], now: Date = new Date()): CollabNight[] {
  const byId = new Map<string, CollabNight>();
  for (const n of collab) byId.set(n.eventId, { ...n, partners: [...n.partners] });
  for (const n of coorg) {
    const prev = byId.get(n.eventId);
    if (!prev) { byId.set(n.eventId, { ...n, partners: [...n.partners] }); continue; }
    const names = [...prev.partners];
    for (const p of n.partners) if (p && !names.includes(p)) names.push(p);
    byId.set(n.eventId, { ...prev, partners: names, coorg: n.coorg, posterUrl: prev.posterUrl ?? n.posterUrl });
  }
  const t = now.getTime();
  const all = [...byId.values()];
  const upcoming = all.filter((n) => new Date(n.endAt).getTime() >= t)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const past = all.filter((n) => new Date(n.endAt).getTime() < t)
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
  return [...upcoming, ...past];
}

/** La page qui répond pour cette soirée : le contrat s'il y en a un, sinon la co-organisation. */
export function collabNightHref(n: Pick<CollabNight, 'eventId' | 'collab'>, side: 'venue' | 'organizer'): string {
  if (n.collab) return side === 'venue' ? `/owner/collab/event/${n.eventId}` : `/organizer-app/events/${n.eventId}`;
  return side === 'venue' ? `/owner/coorg/${n.eventId}` : `/organizer-app/coorg/${n.eventId}`;
}
