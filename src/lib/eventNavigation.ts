// Navigation directe vers la page soirée depuis toutes les surfaces de
// découverte (Explore, /events, rails, carrousels).
//
// Historique : les soirées hébergées par un club passaient par la page club
// (détour + re-tap) pour exposer la carte boissons. Détour supprimé — depuis le
// Mode Live et l'upsell post-checkout, l'éducation boissons vit sur la page
// soirée (teaser), après l'achat (/order/upsell) et le soir J (takeover /live).
// Voir docs/SYSTEME_VENTE_BOISSONS.md. Recherche, favoris et suggestions
// allaient déjà en direct — ce helper rend le comportement homogène.
import { eventPath, type EventLinkParts } from '@/lib/eventUrl';

export interface NavigableEvent extends EventLinkParts {
  // Soirées affiliées : billetterie externe, page dédiée hors funnel Yuno.
  isAffiliate?: boolean;
  affiliateEventSlug?: string;
}

/** Chemin cible d'un tap sur une carte soirée — toujours la page de la soirée. */
export function eventTargetPath(event: NavigableEvent): string {
  if (event.isAffiliate && event.affiliateEventSlug) {
    return `/affiliate-event/${event.affiliateEventSlug}`;
  }
  return eventPath(event);
}
