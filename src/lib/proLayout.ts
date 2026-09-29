/**
 * Mise en page des pages de la Yuno Console (club, manager, organisateur, agence).
 *
 * Une page de la Console occupe TOUTE la largeur à droite de la barre latérale,
 * avec les gouttières du tableau de bord. Avant le 29/09 chaque page choisissait
 * sa propre largeur (672 px, 896 px, 1100 px, 1340 px, 1280 px…) centrée au
 * milieu : sur un écran de bureau, deux bandes noires de 200 à 500 px de chaque
 * côté, et une largeur différente d'un onglet à l'autre.
 *
 * Règle : le conteneur racine d'une page est `PRO_PAGE`, jamais un `max-w-*`
 * centré. Un contenu qui ne doit pas s'étirer (formulaire, texte long) se range
 * en GRILLE (deux colonnes dès `xl`, aperçu ou aide à côté), il ne rétrécit pas
 * la page. Un `max-w-*` reste légitime À L'INTÉRIEUR d'une carte (un paragraphe,
 * un champ seul), jamais sur le conteneur de la page.
 */
export const PRO_PAGE = 'w-full px-4 sm:px-6';

/** Forme d'une page de la Console, pour choisir sa silhouette de chargement. */
export type ProSkeletonVariant = 'list' | 'table' | 'cards' | 'analytics' | 'form' | 'detail';

/** Surfaces à barre latérale de la Yuno Console (club, manager, organisateur, agence). */
export function isConsolePath(path: string): boolean {
  return /^\/(owner|manager|organizer-app|agency-app)(\/|$)/.test(path);
}

/** Forme de page probable d'après l'URL (fallback de chunk, garde de route). */
export function proSkeletonVariantForPath(path: string): ProSkeletonVariant | 'dashboard' {
  const p = path.replace(/\/+$/, '');
  if (/^\/(owner|manager)(\/dashboard)?$/.test(p) || p === '/organizer-app' || /^\/agency-app(\/dashboard)?$/.test(p)) return 'dashboard';
  if (/\/(analytics|stats|live)(\/|$)/.test(p)) return 'analytics';
  if (/\/(orders|invoices|accounting|refunds|customers|waitlist|finance|pay)(\/|$)/.test(p)) return 'table';
  if (/\/(events|djs|book-dj|clubs|collaborations|campaigns|ads|promoters|agencies|tables|menu)(\/|$)/.test(p)) return 'cards';
  if (/\/(venue|profile|organization|payments|settings|billing|integrations|support|support-access|scarcity|team|staff|managers|loyalty|upsell|rules|vitrine|linktree)(\/|$)/.test(p)) return 'form';
  return 'list';
}

/** Idem, pour un squelette de page DANS le layout (pas de variante « dashboard »). */
export function proPageVariantForPath(path: string): ProSkeletonVariant {
  const v = proSkeletonVariantForPath(path);
  return v === 'dashboard' ? 'analytics' : v;
}

