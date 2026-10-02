# Pilier boissons en pause — inventaire et relancement

> Décision de Paul, 2026-10-01 : « On met de côté tout le système boissons. Ce n'est pas
> encore le moment, et c'est confus pour les utilisateurs. NE RIEN SUPPRIMER : projet en
> développement, pas live. On y reviendra. »

Yuno se présente donc sur **deux piliers** : billets d'événements (guest list comprise) et
tables VIP (bottle service). Le système boissons décrit dans
[`SYSTEME_VENTE_BOISSONS.md`](SYSTEME_VENTE_BOISSONS.md) reste entier dans le code et la
base ; il n'est plus montré à personne : ni au client (web, PWA, app iOS), ni dans la
Console (club, manager, organisateur), ni dans l'app Pro, ni dans la démo, ni aux
assistants IA, ni aux moteurs de recherche.

## La porte

| Où | Quoi | Valeur en prod |
|---|---|---|
| `src/lib/drinksPillar.ts` | `DRINKS_PILLAR_LIVE = import.meta.env.VITE_DRINKS_PILLAR_LIVE === '1'` | `false` (aucun build ne pose la variable) |
| `supabase/functions/yuno-assistant/index.ts` | `const DRINKS_PILLAR_LIVE = false` | miroir manuel |
| `supabase/functions/owner-assistant/index.ts` | idem | miroir manuel |
| `supabase/functions/send-ticket-confirmation/index.ts` | idem (CTA upsell de l'email billet) | miroir manuel |
| `worker/index.ts` | idem (SEO crawler, sitemap) | miroir manuel |
| `index.html` | texte statique à deux piliers + commentaire | à remettre à la main |

**Travailler sur le projet en local** : `VITE_DRINKS_PILLAR_LIVE=1` dans `.env.local`,
relancer `npm run dev`. Tout réapparaît (routes, navigation, onglets, sections, copy).

## Ce qui reste en ligne, par décision

- La **boisson offerte** d'un billet ou d'une part de guest list (`includes_drink`,
  `quota_drink`, `drink_deadline_*`, `drink_cutoff_time`) et le `free_drink_mode` du
  videur : c'est un attribut de l'offre billetterie (mode Libre du 30/09), pas le
  système de commande. Le barman n'étant plus accessible, un club en mode `credits`
  gère la boisson offerte à la porte (`bouncer_notify`) — aucun club réel n'était en
  `credits` au 01/10.
- Les lignes `orders` historiques dans la compta, les factures, les remboursements et
  les RPC d'analyse (aucune vente boissons réelle au 01/10 ; tout est démo).
- Les crons et edge functions boissons (`cart-abandonment-check`, `use-drink-credit`,
  `verify-payment`, `create-checkout` boissons…) : ils ne travaillent que sur des
  données que plus personne ne peut créer. Ne pas les supprimer.
- Les tables, migrations, policies et RPC (`drinks`, `orders`, `drink_catalog`,
  `upsell_*`, `order_pack_credits`, `set_click_collect_mode`, `bar_redeem_units`…).
- Toutes les clés i18n (`cart.*`, `drinkCat.*`, `clickCollect.*`, `vipMenu.*`,
  `upsellPage.*`, `drinksTeaser.*`, `pushTpl.flashDrinks.*`, `ohelp.pg.menu.*`,
  `help.client.drinks.*`, `landing.p3.*`…).
- Les pages et composants (`Cart`, `CategoryDrinks`, `Barman`, `ClickCollect`,
  `OwnerMenu`, `OwnerUpsell`, `VipMenu`, `LiveMode`, `livemode/*`, `upsell/*`,
  `barman/*`, `DrinkAnalyticsSection`…) : importés, jamais rendus.

## Inventaire des surfaces gatées (état au 2026-10-01)

### Routes (`src/App.tsx`, helper `drinksRoute`)

| Route | Repli quand le pilier dort |
|---|---|
| `/order-drinks`, `/club/:slug/drinks/:category`, `/cart`, `/guest-checkout`, `/vip-menu/:venueId` | `/explore` |
| `/verify-payment`, `/order/:orderId/qr`, `/live` (Mode Live) | `/my-orders` |
| `/order/upsell` (détour après un billet) | `UpsellDetourRedirect` → `/order-confirmation?type=ticket&id=…` |
| `/barman`, `/click-collect` | `/pro` |
| `/owner/menu`, `/owner/upsell`, `/owner/preview/:slug/drinks/:category` | `/owner/dashboard` |
| `/manager/menu`, `/manager/upsell` | `/manager/dashboard` |
| `/admin/drinks` | `/admin` |

Les routes PARTAGÉES restent (`/my-orders`, `/order-confirmation`, `/claim`,
`/owner/orders`, `/organizer-app/orders`, `/manager/orders`, `/admin/orders`,
`/loyalty`, `/owner/loyalty`) : seules leurs parties boissons sont gatées.

### Client (web + app)

- `Landing.tsx` : pilier p3 retiré, SEO title/description, kicker / lead / appBody /
  appF2 à deux piliers (`landing.kicker2`, `lead2`, `appBody2`, `appF2b`, ×3 langues).
- `Welcome.tsx` : meta description et bandeau défilant sans « ORDER AT THE BAR ».
- `CityPage.tsx`, `data/cityPages.ts`, `AllClubsPage.tsx`, `AllEventsPage.tsx`,
  `EventTicketsLanding.tsx`, `components/pillar/PillarLanding.tsx` : copy SEO et liens
  croisés sans boissons.
- `components/explore/ExploreLowDensity.tsx` : rangée des piliers à deux entrées.
- `VenuePage.tsx` : `isDrinksEnabled` forcé à faux (carte, promos, panier).
- `EventDetails.tsx` : `EventDrinksTeaser` masqué. (La mention « boisson incluse » d'une
  guest list reste : attribut de l'offre.)
- `OrganizerPublicProfile.tsx` : carte des clubs partenaires non chargée.
- `TicketCheckout.tsx` : `TicketUpsellSelector` masqué ; le billet gratuit ne passe plus
  par `/order/upsell`. `VerifyTicketPayment.tsx` : droit à la confirmation (web et retour
  natif).
- `OrderConfirmation.tsx` : `DrinkCreditsCard` et `DrinksUpsellCard` masquées.
- `MyOrders.tsx` : les commandes du bar ne se chargent pas, carte crédits masquée.
- `ClaimOrder.tsx` : onglet Boissons retiré.
- `Favorites` : filtre « Boissons » retiré (`FavoritesHeader.tsx`).
- `Profile` : tuile « boissons commandées » (`ProfileQuickStats`), « boisson préférée »
  (`NightlifeSection`), libellé `FunStats`, question boissons du quiz de goûts
  (`TasteQuiz.tsx`).
- Fidélité : récompenses `free_drink` filtrées côté client (`useLoyalty.tsx`) ; côté
  club, type « Boisson gratuite » et portée « boissons » retirés (`OwnerLoyalty.tsx`).
- `hooks/useAnalyticsData.ts` : les commandes du bar ne sont plus lues (totaux, courbes,
  funnel et export d'Analytics sans boissons) ; `useSalesOverview` / `usePurchaseBehavior`
  forcent `has_bar` / `hasDrinks` à faux.
- `_shared/push-engine.ts` : la variante « boissons » du rappel du jour J (choisie en SQL)
  se rend comme la variante par défaut.
- `contexts/LiveModeContext.tsx` : `isLive` forcé à faux (plus de redirection vers
  `/live`, plus de bandeau, l'onglet Club de la barre du bas ne mène plus au Mode Live).
- `data/helpContent.ts` : article client « Commander des boissons » masqué.
- `lib/warmup.ts` : `OrderDrinksLanding` n'est plus préchargée.

### Console, app Pro, staff

- Barre latérale club (`components/app-shared.tsx`) : entrée « Bar » (Carte / Upsells /
  Promos) retirée ; Commandes ouvre sur Billets.
- Barre latérale organisateur (`components/org-sidebar.tsx`) et `OrgAppCheckin.tsx` :
  onglet « Boissons » du check-in retiré.
- `OwnerOrders.tsx` (club, manager, orga) : onglet Boissons retiré, défaut Billets.
- `ManagerDashboard.tsx` : cartes Carte et Upsells retirées.
- Les surfaces ci-dessous ont été gatées par les lots parallèles du 01/10 (détail
  dans le journal de commit) : Analytics (pilier Boissons, funnel, top produits, CSV,
  `DrinkOpsInsights`, pilier `bar` de Ventes › Vue d'ensemble, rythme du bar dans
  Achats, bilan par soirée), Live View (compteur boissons), Live Night (`BarStation`,
  alerte « push flash boissons »), module live des co-soirées (`LiveOrderPipeline`),
  Push (modèle « Flash boissons »), Clients (catégorie boissons), ventes d'une
  co-soirée (onglet Boissons) et carte du bar montrée à l'organisateur, Réglages du
  club (section « Bar & menu »), Staff (rôle barman à l'invitation, responsable Click &
  Collect), Équipe orga (rôle barman), app Pro et profil (carte Barman), DemoSwitcher
  (rôle barman), guide de configuration et assistant d'onboarding (pilier boissons,
  étape carte du bar, inviter un barman), `/get-started` (étape carte du bar), centre
  d'aide pro (articles carte / upsells / Click & Collect), permissions manager (carte,
  upsells), attestation alcool de l'organisateur, admin (entrée Boissons, onglet par
  défaut des commandes, pilier dans les liens démo).

### Assistants IA, emails, SEO

- `yuno-assistant` : sections boissons de `CLIENT_KNOWLEDGE_BASE` et données live du
  bar retirées ; une ligne dit que la commande de boissons n'est pas disponible.
- `owner-assistant` : articles et outils boissons (`list_drinks`, `toggle_drink`,
  `update_drink_price`, `toggle_post_checkout_upsell`, `get_top_drinks`…) retirés de la
  liste envoyée au modèle ; consigne ajoutée au prompt.
- `send-ticket-confirmation` : CTA « précommande tes boissons » retiré de l'email billet.
- `worker/index.ts` : page `/order-drinks` hors sitemap, copy crawler à deux piliers.
- `index.html` : title / description / og / JSON-LD à deux piliers.

À redéployer après merge : `supabase functions deploy yuno-assistant owner-assistant
send-ticket-confirmation` (+ `send-vip-confirmation`, qui partage `_shared/wallet`), et
le worker Cloudflare (`wrangler deploy` depuis le dashboard Workers Builds).

## Hors de ce dépôt

- **Landing pro (`landing.yunoapp.eu`, repo `Yuno-landing`)** : le choix des piliers à
  l'inscription propose encore « boissons » (`pro_signups.pillars`). À retirer là-bas ;
  côté app, `/get-started` et le guide de configuration ignorent déjà ce choix.
- **Plaquettes PDF** (organisateurs, clubs) : à régénérer sans le pilier boissons si on
  les renvoie (mémoire `plaquette-yuno-2026-09`).
- **App Store** : les captures et le texte de fiche parlent de « drinks » ; à refaire à
  la prochaine soumission.

## Relancer le pilier

1. Poser `VITE_DRINKS_PILLAR_LIVE=1` dans les builds (Cloudflare, `scripts/ci-web-env.sh`
   pour Xcode Cloud) OU remplacer la lecture par `true` dans `src/lib/drinksPillar.ts`.
2. Passer à `true` les quatre miroirs manuels (deux assistants, email billet, worker) et
   remettre la mention boissons dans `index.html`.
3. Relire cet inventaire : chaque gate est une recherche `DRINKS_PILLAR_LIVE` dans `src/`.
4. Redéployer les edge functions et le worker ; OTA pour les apps.
5. Rejouer `scripts/demo/seed-upcoming-sales.sql` pour remettre des commandes de
   démonstration, puis refaire le discours à trois piliers (CLAUDE.md « Ce qu'est Yuno »).
