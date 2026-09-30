/**
 * Analytics en quatre familles (plan Shotgun, lot E).
 *
 * Une page = une question, et chaque question vit à une adresse :
 * `?tab=<famille>&view=<vue>` (+ `&event=<id>` quand une soirée est choisie).
 *
 *   Ventes      « Combien ai-je vendu ? »        vue d'ensemble · partenaires
 *   Trafic      « Est-ce qu'on me voit ? »        vue d'ensemble · ma page
 *   Communauté  « Qui sont mes clients ? »        vue d'ensemble · abonnés · achats · public
 *
 * Les « vues d'ensemble » ont UNE mise en page pour toutes les soirées (sur une
 * période : 24 h → tout) et pour UNE soirée choisie dans la colonne de droite
 * (`&event=`) : mêmes blocs, seul le périmètre change. Il n'y a plus de vue
 * « Par soirée » — elle est devenue la colonne des soirées.
 *   En direct   (inchangé)
 *
 * Plan de simplification (25/09) : « Sources » a rejoint « Ma page » (la même
 * question, un second sélecteur de période) et « Goûts » a rejoint « Public ».
 *
 * Les anciennes adresses (`?tab=global|event|purchase`, `/owner/audience`,
 * `/owner/hype`) restent valables : liens déjà partagés, alertes déjà émises,
 * favoris du navigateur. Elles sont traduites ici, en un seul endroit.
 */

export type AnalyticsFamily = 'sales' | 'traffic' | 'community' | 'live';

export const ANALYTICS_FAMILIES: readonly AnalyticsFamily[] = ['sales', 'traffic', 'community', 'live'];

export const FAMILY_VIEWS = {
  sales: ['overview', 'partners'],
  traffic: ['overview', 'page'],
  community: ['overview', 'subscribers', 'purchase', 'demographics'],
  live: ['now'],
} as const satisfies Record<AnalyticsFamily, readonly string[]>;

export type AnalyticsView<F extends AnalyticsFamily = AnalyticsFamily> = (typeof FAMILY_VIEWS)[F][number];

export interface AnalyticsRoute {
  family: AnalyticsFamily;
  view: string;
}

/** Les anciens onglets, avant le rangement en familles. */
const LEGACY_TABS: Record<string, AnalyticsRoute> = {
  global: { family: 'sales', view: 'overview' },
  event: { family: 'sales', view: 'overview' },
  purchase: { family: 'community', view: 'purchase' },
};

/** Les vues fondues dans une autre (liens déjà partagés, favoris). */
const LEGACY_VIEWS: Partial<Record<AnalyticsFamily, Record<string, string>>> = {
  sales: { event: 'overview' },
  traffic: { sources: 'page', events: 'overview' },
  community: { tastes: 'demographics', event: 'overview' },
};

export function defaultView(family: AnalyticsFamily): string {
  return FAMILY_VIEWS[family][0];
}

export function isValidView(family: AnalyticsFamily, view: string | null | undefined): boolean {
  return !!view && (FAMILY_VIEWS[family] as readonly string[]).includes(view);
}

/**
 * Lit `?tab=` et `?view=` (et la présence d'une soirée) et rend la page à
 * afficher. Jamais d'écran vide : une valeur inconnue retombe sur Ventes, une
 * vue inconnue sur la première vue de sa famille. Une soirée dans l'URL
 * (`&event=`) s'ouvre dans la vue d'ensemble de la famille demandée — Ventes
 * quand l'adresse ne dit rien (c'est ce qu'un lien « Voir les stats » attend).
 */
export function resolveAnalyticsRoute(
  tab: string | null,
  view: string | null,
): AnalyticsRoute {
  const legacy = tab ? LEGACY_TABS[tab] : undefined;
  if (legacy) return { ...legacy };
  const family: AnalyticsFamily = tab && (ANALYTICS_FAMILIES as readonly string[]).includes(tab)
    ? (tab as AnalyticsFamily)
    : 'sales';
  if (isValidView(family, view)) return { family, view: view as string };
  const moved = view ? LEGACY_VIEWS[family]?.[view] : undefined;
  if (moved) return { family, view: moved };
  return { family, view: defaultView(family) };
}

/** Vrai quand l'URL porte encore un ancien onglet ou une vue invalide — à réécrire. */
export function needsCanonicalUrl(tab: string | null, view: string | null, route: AnalyticsRoute): boolean {
  return tab !== route.family || (route.family !== 'live' && view !== route.view);
}

/**
 * Adresse d'une page d'Analytics. `base` = `/owner/analytics`,
 * `/organizer-app/analytics` ou `/manager/analytics`.
 */
export function analyticsHref(base: string, family: AnalyticsFamily, view?: string, eventId?: string | null): string {
  const params = new URLSearchParams({ tab: family });
  if (family !== 'live') params.set('view', view && isValidView(family, view) ? view : defaultView(family));
  if (eventId) params.set('event', eventId);
  return `${base}?${params.toString()}`;
}

/** Le lien « Voir les stats » d'une soirée : ses ventes, dans la vue d'ensemble de Ventes. */
export function eventReportHref(base: string, eventId: string): string {
  return analyticsHref(base, 'sales', 'overview', eventId);
}

/** Les deux autres regards sur la même soirée : son trafic (où l'on lâche) et sa communauté (ce qu'elle a apporté). */
export function eventTrafficHref(base: string, eventId: string): string {
  return analyticsHref(base, 'traffic', 'overview', eventId);
}
export function eventCommunityHref(base: string, eventId: string): string {
  return analyticsHref(base, 'community', 'overview', eventId);
}
