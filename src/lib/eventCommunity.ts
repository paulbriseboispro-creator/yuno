/**
 * Communauté d'UNE soirée — Analytics › Communauté › Par soirée. Tous les
 * chiffres viennent de la RPC `get_event_community` (migration 20260930245000) :
 * ce module type la réponse et met en forme les parts (joignables, fidélité,
 * cadence d'abonnés). Il ne compte jamais une personne.
 */
import { MIN_SAMPLE } from './metrics';
import type { LensTakeaway } from './eventTraffic';

export type CommunityPhase = 'before' | 'live' | 'after';

export interface CommunityParty {
  party: string;
  name: string;
  kind: 'venue' | 'org';
  role: 'lead' | 'partner' | 'cohost';
  shareCrm: boolean;
  avatar: string | null;
  mine: boolean;
  brought: number;
  broughtNew: number;
  emailTotal: number;
  emailGained: number;
  smsTotal: number;
  smsGained: number;
  followersGained: number;
  followersLost: number;
  followersEventPage: number;
  followersAttendees: number;
  followersTotal: number | null;
}

export interface EventCommunity {
  ok: true;
  now: string;
  tz: string;
  money: boolean;
  scope: 'venue' | 'organizer';
  me: string;
  event: { id: string; title: string; startAt: string; endAt: string; poster: string | null; cancelled: boolean; phase: CommunityPhase };
  window: { from: string; to: string };
  people: { total: number; buyers: number; guestsOnly: number; headsPaid: number; noEmail: number; spend: number | null };
  crm: { new: number; known: number; emailOk: number; smsOk: number; app: number; account: number; anyReach: number; newEmailOk: number };
  loyalty: { first: number; second: number; regulars: number };
  retention: { laterEvents: number; returned: number } | null;
  parties: CommunityParty[];
  followers: { gained: number; lost: number; eventPage: number; attendees: number; total: number | null; baselinePerDay: number } | null;
  timeline: { d: number; people: number; fresh: number; followers: number; optins: number }[];
  takeaways?: LensTakeaway[];
}

/** Part (0-100, un chiffre après la virgule) ; `null` sous `MIN_SAMPLE` personnes : un % sur 6 n'informe personne. */
export function sharePct(part: number, total: number): number | null {
  if (total < MIN_SAMPLE) return null;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Les abonnés gagnés pendant la vente, face au rythme habituel du compte
 * (moyenne quotidienne des 60 jours d'avant). `lift` = combien de fois ce
 * rythme ; `null` quand la base est trop mince pour comparer.
 */
export function followerLift(f: NonNullable<EventCommunity['followers']>, windowDays: number): { expected: number; lift: number | null } {
  const expected = Math.round(f.baselinePerDay * Math.max(1, windowDays) * 10) / 10;
  const lift = expected >= 1 ? Math.round((f.gained / expected) * 10) / 10 : null;
  return { expected, lift };
}

/** Nombre de jours de la fenêtre de la soirée (au moins 1). */
export function windowDays(w: EventCommunity['window']): number {
  const ms = new Date(w.to).getTime() - new Date(w.from).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** La partie de l'appelant, sinon la première (un super admin n'est partie de rien). */
export function myParty(c: EventCommunity): CommunityParty | null {
  return c.parties.find((p) => p.mine) ?? c.parties[0] ?? null;
}

/** Soirée à plusieurs : au moins deux parties se partagent le public. */
export function isCollabNight(c: Pick<EventCommunity, 'parties'>): boolean {
  return c.parties.length > 1;
}

/** Part des personnes qu'une partie a amenées, parmi celles qu'on sait attribuer (0-100). */
export function broughtShare(p: CommunityParty, parties: CommunityParty[]): number | null {
  const known = parties.reduce((s, x) => s + x.brought, 0);
  return known <= 0 ? null : Math.round((p.brought / known) * 100);
}
