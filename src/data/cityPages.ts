/**
 * Pages villes SEO — /paris, /madrid… Le playbook Xceed/Fever : une page
 * d'atterrissage par marché sur LA requête nightlife la plus volumineuse
 * (« sortir à Madrid », « discotecas Madrid », « clubs Paris ce soir »).
 *
 * Partagé entre la SPA (src/pages/CityPage.tsx — routes générées dans
 * App.tsx) et le Worker (worker/index.ts — canonical + contenu crawlable ;
 * routes déclarées dans run_worker_first de wrangler.jsonc). Données pures
 * uniquement : ce fichier est bundlé des deux côtés.
 *
 * Ajouter une ville = ajouter une entrée ici PUIS :
 *   1. wrangler.jsonc → run_worker_first (« /laville »)
 *   2. PersistentBottomNav NAV_ROUTES + InstallBar SHOW_PATTERNS
 *   3. Vérifier que `name` matche les valeurs `city` en base
 *      (venues.city / affiliate_venues.city, match ilike).
 * meta en anglais : yunoapp.eu indexe une seule langue canonique (cf. Seo.tsx).
 */
export interface CityPageDef {
  /** Segment d'URL racine : « madrid » → https://yunoapp.eu/madrid */
  slug: string;
  /** Nom propre affiché ET utilisé pour matcher les colonnes city en base. */
  name: string;
  metaTitle: string;
  metaDescription: string;
}

export const CITY_PAGES: Record<string, CityPageDef> = {
  paris: {
    slug: 'paris',
    name: 'Paris',
    metaTitle: 'Paris Nightlife — Club Nights, Tickets & VIP Tables | Yuno',
    metaDescription:
      'Going out in Paris? Find tonight\'s club nights and parties, buy tickets in seconds, book VIP bottle-service tables and order drinks without the bar queue — all on Yuno.',
  },
  madrid: {
    slug: 'madrid',
    name: 'Madrid',
    metaTitle: 'Madrid Nightlife — Discotecas, Parties & Guest Lists | Yuno',
    metaDescription:
      'Going out in Madrid? Discover the best discotecas and parties, join guest lists, get tickets and book VIP tables at the top clubs in town — all on Yuno.',
  },
};
