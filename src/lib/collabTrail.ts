/**
 * Fil d'Ariane de la page de collaboration (centre de contrôle d'une soirée).
 *
 * Un outil (billetterie, guest list, infos & affiche…) s'ouvre dans un NOUVEL
 * onglet. Son adresse porte d'où l'on vient — `from=collab&ce=<soirée>&cn=<titre>
 * &ct=<outil>` — et `CollabTrailBar` affiche en tête de cet onglet
 * « ← Retour à la collaboration · Collaborations › Soirée › Outil ».
 *
 * Tout ce qui décide est pur et testé (`__tests__/collabTrail.test.ts`).
 */

import { eventReportHref } from '@/lib/analyticsNav';

export type CollabSide = 'venue' | 'organizer';

export type CollabTool =
  | 'design' | 'live' | 'ticketing' | 'analytics' | 'promoters'
  | 'guestlist' | 'checkin' | 'bookdj' | 'coorg' | 'stripe'
  | 'tables' | 'vipservice' | 'djs' | 'staff' | 'orders' | 'promocodes';

export const COLLAB_TOOLS: readonly CollabTool[] = [
  'design', 'live', 'ticketing', 'analytics', 'promoters', 'guestlist', 'checkin', 'bookdj', 'coorg', 'stripe',
  'tables', 'vipservice', 'djs', 'staff', 'orders', 'promocodes',
];

/**
 * Chemin de chaque outil d'une soirée, par côté. Source unique : la page de la
 * co-soirée et la page Co-organisation montrent les MÊMES raccourcis.
 * `null` = cet outil n'existe pas de ce côté.
 */
export function collabToolPaths(side: CollabSide, eventId: string): Record<CollabTool, string | null> {
  const v = side === 'venue';
  const base = v ? '/owner' : '/organizer-app';
  return {
    design: `/owner/events?edit=${eventId}`,
    live: v ? '/owner/live' : `/organizer-app/events/${eventId}/live`,
    ticketing: `${base}/ticketing?event=${eventId}`,
    analytics: eventReportHref(`${base}/analytics`, eventId),
    promoters: `${base}/promoters/event/${eventId}`,
    guestlist: `${base}/guest-list?event=${eventId}`,
    checkin: v ? '/owner/live' : '/organizer-app/checkin',
    bookdj: `${base}/book-dj`,
    coorg: `${base}/coorg/${eventId}`,
    stripe: v ? '/owner/billing' : '/organizer-app/payments',
    tables: `${base}/tables?event=${eventId}`,
    vipservice: `${base}/vip-service?event=${eventId}`,
    djs: `${base}/djs`,
    staff: v ? '/owner/staff' : '/organizer-app/team?tab=staff',
    orders: `${base}/orders`,
    promocodes: `${base}/promo-codes`,
  };
}

export interface CollabTrail {
  eventId: string;
  title: string;
  tool: CollabTool;
  /** Chemin de l'outil (sans requête) : le fil ne s'affiche que tant qu'on y reste. */
  toolPath: string;
}

const P = { from: 'from', event: 'ce', name: 'cn', tool: 'ct' } as const;

/** Adresse d'un outil ouvert depuis la page de collaboration. Garde la requête de l'outil. */
export function collabToolHref(path: string, trail: { eventId: string; title: string; tool: CollabTool }): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(P.from, 'collab');
  params.set(P.event, trail.eventId);
  params.set(P.name, trail.title.slice(0, 80));
  params.set(P.tool, trail.tool);
  return `${base}?${params.toString()}`;
}

/** Lit le fil dans une adresse. `null` si elle ne vient pas de la page de collaboration. */
export function readCollabTrail(pathname: string, search: string): CollabTrail | null {
  const params = new URLSearchParams(search);
  if (params.get(P.from) !== 'collab') return null;
  const eventId = params.get(P.event);
  const tool = params.get(P.tool) as CollabTool | null;
  if (!eventId || !tool || !COLLAB_TOOLS.includes(tool)) return null;
  return { eventId, title: params.get(P.name) || '', tool, toolPath: pathname };
}

/** Le fil suit l'onglet tant qu'on reste dans l'outil (ses sous-pages comprises). */
export function trailAppliesTo(trail: CollabTrail | null, pathname: string): boolean {
  if (!trail) return false;
  return pathname === trail.toolPath || pathname.startsWith(`${trail.toolPath}/`);
}

/** Page de collaboration d'une soirée, et ses deux pages filles. */
export function collabEventHref(side: CollabSide, eventId: string, sub?: 'sales' | 'partners'): string {
  const base = side === 'venue' ? `/owner/collab/event/${eventId}` : `/organizer-app/events/${eventId}`;
  return sub ? `${base}/${sub}` : base;
}

export function collabHubHref(side: CollabSide): string {
  return side === 'venue' ? '/owner/collaborations?tab=nights' : '/organizer-app/collaborations?tab=nights';
}

/** Le côté se déduit de l'adresse : la Console Club vit sous /owner. */
export function sideOfPath(pathname: string): CollabSide {
  return pathname.startsWith('/owner') ? 'venue' : 'organizer';
}
