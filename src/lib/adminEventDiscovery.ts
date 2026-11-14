// Pourquoi une soirée n'est pas dans Explore — lu par le super admin
// (/admin/events). Miroir des critères du trigger SQL
// `evaluate_event_discoverability` (une soirée d'organisateur entre seule dans
// Explore quand elle les remplit, et seule une décision de Yuno l'en retire).
// Sans ce miroir, l'écran disait « Dépubliée » pour une soirée que personne
// n'avait dépubliée, et le bouton « Republier » était annulé par le trigger.

export const MIN_DESCRIPTION = 30;
export const MIN_TITLE = 5;

export type DiscoveryBlocker =
  | 'rejected' // décision de Yuno : seul le super admin la lève
  | 'draft' // pas encore publiée par l'organisateur (is_active = false)
  | 'private' // soirée privée ou visibilité non publique
  | 'demo' // compte de démo : jamais dans Explore
  | 'no_poster'
  | 'short_title'
  | 'short_description' // soirée sans club : description < 30 caractères
  | 'no_date';

export interface DiscoveryEventInput {
  organizer_user_id: string | null;
  partner_venue_id: string | null;
  event_kind: string | null;
  visibility: string | null;
  is_active: boolean;
  is_discoverable: boolean;
  discovery_status: string | null;
  status: string;
  poster_url: string | null;
  title: string | null;
  description: string | null;
  start_at: string | null;
}

/**
 * Ce qui tient la soirée hors d'Explore, dans l'ordre où le pro doit le régler.
 * Vide quand elle est en ligne, annulée, ou quand c'est une soirée de club
 * (pas de critère automatique : seul le réglage du super admin compte).
 */
export function discoveryBlockers(e: DiscoveryEventInput, isDemo = false): DiscoveryBlocker[] {
  if (e.status === 'cancelled' || e.is_discoverable) return [];
  const out: DiscoveryBlocker[] = [];
  if (e.discovery_status === 'rejected') out.push('rejected');
  if (!e.is_active) out.push('draft');
  if (e.event_kind === 'private_event' || (e.visibility ?? 'public') !== 'public') out.push('private');
  // Les critères de qualité ne valent que pour une soirée d'organisateur.
  if (!e.organizer_user_id) return out;
  if (isDemo) out.push('demo');
  if (!e.poster_url) out.push('no_poster');
  if ((e.title ?? '').length < MIN_TITLE) out.push('short_title');
  if (!e.partner_venue_id && (e.description ?? '').length < MIN_DESCRIPTION) out.push('short_description');
  if (!e.start_at) out.push('no_date');
  return out;
}

/**
 * « Republier » ne sert que là où le super admin a la main : une décision de
 * Yuno à lever, ou une soirée de club. Pour une soirée d'organisateur qui ne
 * remplit pas les critères, le trigger annulerait le clic sans rien dire.
 */
export function canAdminRepublish(e: DiscoveryEventInput): boolean {
  if (e.status === 'cancelled' || e.is_discoverable) return false;
  if (!e.organizer_user_id) return true;
  return e.discovery_status === 'rejected';
}
