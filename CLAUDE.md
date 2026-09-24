# CLAUDE.md — Yuno

Source de vérité projet, lue automatiquement à chaque session. Tenir à jour.
Dernière revue : 2026-06-14.

## Ce qu'est Yuno

SaaS nightlife multi-tenant. **Trois piliers — jamais réduire Yuno aux boissons :**
**billets d'événements + réservation de tables VIP (bottle service) + commande de boissons**
(skip the bar queue). Côté pro : dashboards pour clubs (owner), organisateurs/BDE,
promoteurs, affiliés, et staff opérationnel (barman, bouncer, vestiaire, hôte VIP).

Fondateur solo : Paul. Site public multilingue **EN / FR / ES** (défaut : anglais).

## Stack

- **Frontend** : Vite 8 (rolldown) + React 18 + TypeScript + shadcn/ui + Tailwind. SPA statique.
- **PWA** : `vite-plugin-pwa` (workbox `sw.js` auto) + `sw-push.js` manuel (push notifs).
- **Backend** : 100 % **Supabase** (Postgres + RLS + Auth + Storage + 106 edge functions Deno).
  Project ref : `fulawxvdlwtdlpkycixe`. (Ancien ref Lovable mort : `kredmghiqesyrmjqvxen`.)
- **Paiements** : Stripe + **Stripe Connect double destination** (owner→venues, organizer→profiles).
- **Autres** : Mapbox (carte clubs, lazy-load), Resend (emails), i18n maison.
- **Pas de tests** (aucun framework configuré). `eslint` seulement.

## Commandes

```bash
npm run dev        # dev server (port 8080)
npm run build      # build prod → dist/
npm run lint       # eslint
npm run preview    # preview du build
supabase db push   # pousser les migrations (CLI configuré — voir gotchas)
```

Package manager : **npm** (un seul lockfile, `package-lock.json`). Node : voir `.nvmrc` (22).

## Structure

```
src/
  pages/            # 106 pages (Owner*, Org*, Promoter*, Affiliate*, public, staff...)
  components/       # composants + ui/ (shadcn) + dossiers par domaine (owner/, vip-host/, explore/...)
  i18n/data.ts      # ~1,5 Mo — TOUTES les traductions EN/FR/ES + helper t(). Fichier énorme, normal.
  integrations/supabase/  # client.ts (anon) + types.ts (généré)
  utils/fees.ts     # calcul frais/commissions Stripe (revenu club)
  lib/              # helpers (compressImage, countries, hypeForecast...)
supabase/
  functions/        # 106 edge functions Deno (checkout, webhooks, invitations, MFA...)
  migrations/       # 388 migrations SQL (ordre chronologique par timestamp)
  config.toml       # déclare chaque fonction (verify_jwt, etc.)
docs/               # PRD.md, DESIGN_SYSTEM.md, DESIGN_SYSTEM_PUBLIC.md
```

## Conventions

- **i18n** : tout texte affiché passe par le helper `t()` de `src/i18n/data.ts`. Ajouter les
  3 langues (en/fr/es) pour chaque nouvelle clé. Défaut = anglais.
- **Mot-symbole = UN seul dessin, jamais du texte.** Le wordmark officiel vit
  dans `public/yuno-wordmark.png` et ses déclinaisons (blanc / `#0A0A0A` /
  `#E8192C`), toutes produites par `scripts/gen-brand-wordmark.py` — ne jamais
  en ajouter une à la main. Le front passe par `<Wordmark height={…} />`
  (`src/components/brand/Wordmark.tsx`), qui ne pilote que la HAUTEUR : le ratio
  vient du fichier, une lettre étirée n'est plus le logo. Les emails et les
  passes Wallet ne peuvent pas importer un composant React et tirent le même PNG
  (URL absolue pour les emails, base64 régénéré par `gen-wallet-assets.py` pour
  les passes). Ne JAMAIS re-composer la marque en Space Grotesk / Poppins /
  Helvetica : le nom reste du TEXTE seulement quand c'est une phrase (« Frais de
  service Yuno », un en-tête de colonne), jamais quand il porte la marque.
  **La chaîne de lancement est un cas à part.** Le Launch Screen natif
  (`ios/App/App/Assets.xcassets/Splash.imageset/`) est compilé dans le binaire et
  ne part PAS en OTA, alors que le loader de `index.html` et `SplashScreen.tsx`,
  si. Les trois doivent montrer le MÊME dessin, sinon le logo saute au démarrage.
  Depuis le 2026-09-07 la décision se prend AU RUNTIME (`hasOfficialLaunchScreen()`
  dans `src/lib/brandSplash.ts`, même expression injectée dans `index.html` par le
  plugin Vite `yuno-splash-flag`) : le binaire client dont l'imageset porte le
  wordmark officiel ajoute `YunoLaunch/2` à l'user-agent de sa WebView
  (`capacitor.config.ts` → `ios.appendUserAgent`, compilé, jamais livré par OTA).
  Un seul bundle web sert donc tous les binaires (ancien Launch Screen → ancien
  lettrage, nouveau → officiel, web → officiel), et la famille OTA `NATIVE_FAMILY`
  reste unique. Règle : `appendUserAgent` et l'imageset régénéré
  (`python3 scripts/gen-splash-wordmark.py`) vivent dans le MÊME commit ; ne jamais
  poser le marqueur sur un binaire à l'ancien imageset. Le raccord se vérifie, il ne
  s'estime pas : le storyboard contraint l'imageView à 805 pt pour un PNG de 2732 px,
  soit 3,3938 px/pt sur tous les iPhone. Le splash de l'app Pro n'est pas concerné :
  c'est l'icône rendue en volume, pas un wordmark à plat.
- **Les dashboards pro s'appellent la Yuno Console** (2026-09-23). Un seul nom
  parapluie pour les quatre surfaces de gestion web, décliné par rôle :
  **Console Club** (`/owner`), **Console Manager** (`/manager`), **Console
  Organisateur** (`/organizer-app`), **Console Agence** (`/agency-app`) — en
  anglais l'ordre s'inverse (`Club Console`), en espagnol c'est `Consola Club`.
  En usage courant : « la Console ». **Ne JAMAIS écrire « app organisateur »,
  « dashboard organisateur », « panel » ni « cockpit »** pour ces surfaces : ce
  ne sont pas des apps (aucun binaire, aucun bundle, web seulement), et « app »
  envoyait le pro chercher sur l'App Store un outil qui n'y est pas.
  Trois choses gardent leur nom, et ce n'est pas un oubli : **Yuno Pro** reste
  l'app NATIVE du staff (`eu.yunoapp.pro` — porte, scan offline, DJ, promoteur ;
  elle existe vraiment sur l'App Store), **Espace Promoteur / Espace DJ**
  restent des espaces parce qu'ils vivent d'abord dans cette app, et le
  **Cockpit** du super admin (`/admin`, RPC `admin_cockpit`) est un outil
  interne à Yuno, pas un dashboard client. L'assistant IA des dashboards
  s'appelle donc « Assistant Console » (`ownerAI.title`), plus « Yuno Pro
  Assistant » — il ne tourne que sur le web.
- **Barres latérales pro = groupe → entrée → sous-entrées** (2026-09-15, modèle
  Shopify). Owner et organisateur portent les MÊMES cinq groupes, dans le même
  ordre : Vue d'ensemble, Événements/Soirées, Ventes & finances, Marketing & CRM,
  Paramètres/Réglages. Une entrée à sous-entrées reste une **vraie destination**
  (le nom est un lien, le chevron ne fait qu'ouvrir la liste) et sa section
  s'ouvre toute seule quand la route entre dedans. Une page nouvelle se range
  sous l'entrée dont elle est le prolongement (Service VIP sous Tables VIP,
  Automatisations sous Email, Remboursements sous Commandes) — jamais une
  sixième entrée à plat. **Une sous-entrée est un JOB, pas une vue** : les
  onglets de préparation en sont (Tables VIP → Zones / Packs / Templates,
  Staff → Briefing / Activité), les onglets qui filtrent une même liste n'en
  sont pas (les quatre piliers de Commandes restent des onglets, la barre ne
  double pas la barre d'onglets d'une page). Un onglet visé depuis la barre
  doit être adressable : passer par `useTabParam` (`src/hooks/useTabParam.ts`,
  `?tab=`), jamais un `useState` nu — sinon le lien ouvre la page sur son
  onglet par défaut. Une section liste TOUTES les vues de sa page, dans
  l'ordre de la page, y compris celle qui s'affiche par défaut — et cette
  dernière porte `isDefault: true`, sinon c'est le parent qui s'allume quand
  l'URL n'a pas encore d'onglet. Le défaut ne se devine pas : Commandes ouvre
  sur Boissons au club et sur Billetterie chez l'organisateur, qui ne tient
  pas de bar. Quand un parent et son premier enfant sont deux jumeaux
  (Email → Campagnes + Automatisations, Bar → Carte + Upsells, Facturation →
  Factures + Compta), le parent NOMME la catégorie et pointe sur la première
  page : c'est ce qui évite une section qui s'ouvre sur une ligne unique. Tout vit dans `buildNavGroups` (`app-shared.tsx`,
  club) et `buildOrgNavGroups` (`org-sidebar.tsx`, orga) ; le rendu commun est
  `nav-group.tsx`, partagé avec les barres DJ / promoteur / affilié / agence.
  L'entrée active se déduit du PRÉFIXE de route (`/owner/campaigns/new` allume
  Campagnes email) : toute entrée dont le chemin préfixe son app entière
  (`/organizer-app`, `/agency-app`, `/dj`, `/affiliate`, `/promoter`) doit
  porter `exact: true`, sinon elle reste allumée partout. Entre deux
  sous-entrées qui matchent (`/owner/campaigns/automations` tombe DANS
  « Campagnes » autant que dans « Automatisations »), c'est la plus SPÉCIFIQUE
  qui s'allume, jamais la première de la liste — sinon la barre nomme une autre
  page que celle qu'on regarde. Une entrée ajoutée
  sans sous-entrée visible est une page injoignable : il n'y a plus de barre à
  35 lignes où tout se voit d'un coup. Réorganiser un groupe oblige à corriger
  les fils d'Ariane du mode d'emploi (`ohelp.*`, 3 langues) ET les snippets de
  `owner-assistant` — ils nomment les groupes en toutes lettres.
- **Le line-up d'une soirée a DEUX moitiés, et une seule bande à l'écran**
  (2026-09-17, migrations `20260917100000`→`100200`). Les DJ à compte Yuno vivent
  dans `event_djs` → `djs` et passent par le handshake booking
  (`src/lib/djLineup.ts`) ; les artistes SANS compte vivent dans
  `event_guest_artists` (nom, photo, Instagram, `position`) et n'ont rien à
  valider. Un artiste invité n'est JAMAIS une ligne `djs` : pas de page
  publique, pas de booking, pas de cachet, pas d'audience — c'est ce qui permet
  de mettre n'importe quel nom à l'affiche sans polluer l'annuaire des DJ. Les
  deux moitiés se composent dans le MÊME composant (`DJLineupSelector`, qui
  embarque `GuestArtistsEditor`), donc les deux formulaires de soirée — club et
  organisateur — en héritent sans le savoir, et s'affichent dans la même bande
  sur `EventDetails`, invités en second. Elles se propagent ensemble au dos du
  pass Wallet (`_shared/wallet/passes.ts`, `resolveLineup`) et au texte du
  moteur de goût (`_shared/event-embeddings.ts`) : redéployer
  `send-ticket-confirmation` + `send-vip-confirmation` ENSEMBLE, et
  `process-scheduled-campaigns` pour les embeddings.
  **La photo se met à la main, et c'est la bonne réponse.** Mesuré le 17/09 :
  Instagram n'a plus d'API publique de profil, le HTML de instagram.com est un
  mur JS sans `og:image`, et le dernier endpoint interne qui répondait encore
  (`users/web_profile_info`) est bloqué depuis les IP de datacenter — 0 réussite
  sur 6 depuis une edge function Supabase, alors que le même appel passe depuis
  une connexion résidentielle. Une edge `artist-avatar` a été écrite, déployée,
  mesurée, puis SUPPRIMÉE (slot rendu) : ne pas la ressusciter sans nouvelle
  mesure. Ce qui coûte cher au pro n'est pas la première saisie mais sa
  répétition hebdomadaire — d'où `get_guest_artist_book()`, qui repropose en un
  clic tout artiste déjà programmé par l'appelant, avec sa photo et son
  Instagram.
  **Le clic sortant se mesure sans cookie** : `track_guest_artist_click`
  (SECURITY DEFINER, visiteur reconstruit par `links_visitor_context()`, dédup
  30 min par visiteur et par artiste, anti-flood 60/h) incrémente
  `event_guest_artists.instagram_clicks` ; lecture pro par
  `get_event_guest_artist_clicks(event)`, gardée par `can_manage_event_design`
  — la fonction qui REPRODUIT la policy « design » d'`event_djs` et sert de
  porte unique à la table, à la RPC de lecture et au carnet. Piège déjà payé :
  le trigger de normalisation porte une LISTE DE COLONNES
  (`UPDATE OF name, photo_url, instagram_url, instagram_handle, position`) —
  sans elle, l'incrément du compteur déclenche le trigger, qui rétablit
  `OLD.instagram_clicks` et fige le compteur à zéro. Et la persistance du
  line-up invité se fait par DIFF, jamais par delete+insert comme `event_djs` :
  chaque ligne porte son compteur.
- **Dashboards pro = thème sombre ET clair** (2026-09-24, `docs/DESIGN_SYSTEM.md`
  §17). Réglage « Apparence » (Clair / Sombre — pas de « Système », retiré le
  24/09 : le sombre est le défaut) au pied de chaque barre latérale pro + icône
  lune/soleil dans les en-têtes ; préférence par appareil (`localStorage`
  `yuno:pro-theme`, toute valeur ≠ `light` = sombre). La bascule s'ouvre en
  CERCLE depuis le bouton cliqué (`setProThemePref(pref, originOf(el))`, View
  Transitions + keyframes `clip-path` sur `--vt-x/y/r`, classe `pro-theme-vt` le
  temps de la transition, qui coupe TOUTES les transitions/animations de la page
  — sinon le cercle accroche en plein milieu) ;
  sans View Transitions ou avec « réduire les animations », bascule nette. `html[data-pro-theme="light"]`
  n'est posé QUE sur une route pro (`isThemedProPath`, `src/lib/proTheme.ts`,
  miroir du script anti-flash d'`index.html`) : public, app client, emails et
  staff de nuit restent sombres. Le clair change l'ENCRE, pas le dessin : les
  tokens sont `rgb(var(--ink)/a)`, les surfaces `var(--sf-<hex>)`, les accents
  `var(--acc-<hex>)`, les gris `var(--tx-<hex>)` (`src/styles/pro-theme.css`, valeur
  sombre EXACTE à `:root`), et la palette Tailwind (`white`, gris, couleurs vives)
  est en variables (`tailwind.theme.ts`). **Dans du code pro, ne JAMAIS écrire
  `rgba(255,255,255,…)`, `#fff` pour du texte, `#000`/`#0a0a0c` pour un fond** ;
  blanc sur fond coloré = `text-snow` / `'#fff'` ; alpha d'un accent = `tint(X,
  '1A')`, jamais `` `${X}1A` ``. Photo sous voile, carte du globe Live View (le
  globe seul, les panneaux suivent le thème), maquette de téléphone, aperçu
  client = `data-theme-island="dark"`. Toute nouvelle variable
  se déclare dans les trois blocs de `pro-theme.css` (test `proTheme.test.ts`).
  Jamais ces variables dans un canvas, Mapbox, un PDF ou un email.
- **Deux design systems séparés** :
  - `docs/DESIGN_SYSTEM_PUBLIC.md` → pages publiques (éditorial, marketplace).
  - `docs/DESIGN_SYSTEM.md` → dashboards pro.
  Ne pas mélanger les deux esthétiques.
- **Rôles / routing** : guards par rôle dans `App.tsx` —
  `OwnerRoute`, `OrgAppRoute`, `PromoterRoute`, `AffiliateRoute`, `VipHostRoute`,
  `BarmanRoute`, `BouncerRoute`, `CloakroomRoute`, `DJRoute`, `ManagerRoute`, `BrowserRoute`.
- **Console Organisateur** (`/organizer-app`) : autonome mais réutilise des pages Owner ;
  conventions `org-ui`, gating Stripe via `canSell`.
- **Agence de promoteurs = entité FUSIONNÉE** (2026-07-27) : `agencies` est
  l'identité maître, `affiliates.agency_id` relie le bras externe (clubs
  non-Yuno, redirection billetterie). Triggers de provisionnement bidirectionnels
  + synchro d'identité agencies→affiliates (le linktree public suit le profil
  agence). Un chef d'agence = rôles `agency` + `affiliate`. Console unique
  `/agency-app` avec sidebar unifiée couvrant `/agency-app/*` (contrats, ventes
  in-app, finance) ET `/affiliate/*` (clubs externes, linktree, trafic).
  Ne JAMAIS recréer un profil affilié autonome ; ne JAMAIS toucher au code
  argent (conversions/règlements/gardes) pour des besoins du bras externe.
  Tracking visiteur externe : uniquement via les RPC SECURITY DEFINER
  (`flush_affiliate_session`, `ping_affiliate_live`) — les UPDATE anonymes
  directs sont morts en prod. Voir `docs/AFFILIATE_SYSTEM.md`.
- **Tables VIP d'un organisateur SEUL (soirée sans club, 2026-09-04)** : même
  système que le club, event-scopé. `table_zones` / `table_packs` /
  `venue_floor_plans` acceptent `venue_id NULL` (CHECK : venue OU event),
  `enable_collab_tables` ne verrouille rien sans club, `upsert_event_floor_plan`
  écrit le plan interactif de la soirée (le `FloorPlanEditor` prend `eventId`),
  `set_event_tables_mode` bascule basic ⇄ élite (élite exige ≥ 1 table posée).
  Sans club, TOUT est event-scopé — basic comme élite — côté checkout
  (`eventScopedTables` dans `create-table-checkout`) et côté pages publiques.
  Le bénéficiaire suit `create-ticket-checkout` : club s'il y en a un, sinon
  compte Connect de l'organisateur (charge directe). Ne JAMAIS réintroduire un
  `.single()` sur `venues` ni une porte « club partenaire requis » dans le
  pilier tables. La bannière de contrat collab n'apparaît que sur `isCollab`.
  **Deux pages orga, comme le club** : `/organizer-app/tables` = atelier
  (soirées + interrupteur, zones/packs/plan de la soirée choisie, onglet
  « Salles VIP » = historique `organizer_vip_rooms` rejouable via
  `apply_vip_room_to_event` — zones/packs clonés avec de NOUVEAUX ids et
  layout remappé — refusé si la soirée a des résas) et
  `/organizer-app/vip-service` = service du soir (réservations, placement,
  arrivées ; réutilise les composants `owner/vip/*` via `useOrganizerVipData`).
  La page événement n'affiche qu'un résumé (`OrgEventTablesPanel
  variant="summary"`) : jamais de chiffres d'argent dans l'atelier.
  **Règlement sur place** (`table_packs.payment_mode = 'on_site'`, migration
  `20260904180000`) : le client réserve SANS payer via Yuno — pas d'acompte,
  pas de compte Stripe, pas de commission ; `create-table-checkout` confirme
  la résa (`status='paid'`, acompte 0, `table_reservations.payment_mode =
  'on_site'`) sans session Stripe. Ces packs ne sont JAMAIS gatés par la porte
  « paiements prêts » (page soirée, billetterie, checkout) : c'est ce qui
  permet à un lieu de tester Yuno sans encaisser en ligne. Export des tables
  (PDF porte / détail / Excel) depuis le Service VIP orga, avec paiement,
  email, remarques, référence.
- **Revenu club** : « CA Club / Net », fee Stripe 1.5 %, helpers dans `utils/fees.ts`. Refund côté club.
- **« Complet » posé à la main = porte unique `src/lib/soldOut.ts`** (2026-09-11,
  migration `20260911210000`). Fermer la vente d'un pilier SANS dépublier la
  soirée : `events.tickets_sold_out` / `tables_sold_out` / `guest_list_sold_out`
  (toute la soirée), `events.sold_out_pack_ids` (certaines formules) et
  `guest_lists.manually_sold_out` (une part). **Tout est EVENT-scopé, y compris
  les formules** : les packs d'un club sont venue-scopés et servent toutes ses
  dates — marquer `table_packs` fermerait la formule partout. Une seule mécanique
  pour le club et pour l'organisateur. Ces drapeaux ne ferment QUE le
  libre-service (page publique, checkout, inscription) : l'ajout manuel d'un
  invité, la résa walk-in et le placement restent ouverts. Les gardes serveur
  vivent dans `create-ticket-checkout`, `create-table-checkout` et
  `create-guest-list-entry` (ce dernier ferme les TROIS canaux d'une part, lien
  d'invitation nominatif compris — d'où `manually_sold_out` dans
  `get_guest_list_invite`). Ne pas confondre avec `…_enabled = false` (l'offre
  disparaît) ni avec `ticket_rounds.manually_sold_out` (qui referme le palier et
  ouvre le suivant via trigger, donc n'est PAS réversible d'un clic). Réglage
  centralisé : rangée « Marquer complet » sous les trois interrupteurs de la
  fiche soirée (`OwnerEvents`, club ET orga) ; réglage fin dans `OwnerTables`
  (onglet Soirées), `OrgEventTablesPanel` et `PartCard`.
- **Supabase client** : anon key côté front (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
  Les secrets purs (Stripe `sk_`, Resend, Gemini, service_role) vivent **uniquement** dans les
  secrets Supabase / `.env.local` — jamais commités.

## Collab à BARÈME sur le CA de la soirée + décompte de fin de soirée (2026-09-21)

Design : `docs/designs/COLLAB_NIGHT_CLOSING_PLAN.md`. Migrations `20260921120000`
(+ `130000`, qui RESTAURE `is_direct_client_write()` — disparue de la base, elle
cassait toute mise à jour du cycle `collab_table_settlements`). Règles intouchables :

- **Un deuxième MODE dans le même contrat** : `revenue_split_rules.remuneration =
  { mode: 'tiered_total', tiers: [{from, pct}], tiers_mode: 'flat'|'marginal' }`,
  les trois blocs pilier restant à `0/100` club. Porte unique de lecture :
  `is_tiered_collab()` (SQL) = `isTieredCollab()` (edge) = `isTieredRules()`
  (front). Barème : `collab_tier_pct()` (SQL) et `tierFor()` (front) sont des
  MIROIRS EXACTS, testés sur les mêmes cas (`src/lib/__tests__/collabTiers.test.ts`).
  `flat` = le taux du palier atteint sur TOUT le total (lecture littérale des
  termes d'un club) ; `marginal` = par tranche. `normalizeSplitRules` PRÉSERVE
  `remuneration` : la perdre ferait repartir un contrat à barème en partage par
  pilier sans que personne ne le voie.
- **Pendant la vente, billets et tables sont RETENUS sans date** :
  `payment-split.ts` force `splitMode 'separate'` (charge plateforme,
  `on_behalf_of` club, 100 % club), et `stripe-webhook` pose
  `transfers_release_at = NULL` quand les règles de l'événement sont à barème. Le
  cron `release-held-co-event-transfers` ne prend que les lignes datées : rien ne
  part avant le décompte. Boissons via Yuno : charge directe club, comme partout.
- **Le décompte est une double vérification** : le club DÉCLARE
  (`declare_collab_night_closing` : bar en caisse, billets porte, extras tables,
  autre, ticket Z), l'organisateur seul ACCEPTE ou CONTESTE. Rien n'est réparti
  sans acceptation ; aucune libération automatique. `accept_collab_night_closing`
  refige les chiffres Yuno (`collab_night_yuno_figures`, formules de `fees.ts`,
  remboursements déduits), applique le barème, alloue le dû D'ABORD sur les
  jambes retenues (prorata par ligne, jambe secondaire → organisateur, restes de
  centimes aux plus grosses lignes, `transfers_release_at = now()`, cron kické
  par `net.http_post`), et crée pour le RESTE un lot `collab_table_settlements`
  `kind = 'night_closing'` (cycle SEPA existant). Sans compte Stripe organisateur
  → tout en SEPA, retenu libéré au club. Une vente remboursée n'est ni comptée ni
  répartie (`collab_night_held_rows`).
- **Contrat** : version `2026-09-21`, article « Décompte de soirée et barème »
  rendu SEULEMENT si `getCollabTerms(v, { tiered: true })` ; un contrat par
  pilier garde son texte et sa numérotation. PDF et dialogue lisent
  `data.remuneration` (`collabContractData.ts`).
- UI : `CollabNightClosingCard` (les deux côtés, toutes phases, se tait hors
  barème), `TieredRemunerationEditor` (bannière + avenant), panneau Argent en
  mode barème. Aide : `ohelp.ev.collab.s14*`, `ohelp.org.collab.s7*` ;
  assistant : article `collab-night-closing`.
- **Tester une RPC d'argent = un bloc DO annulé par `RAISE EXCEPTION 'SMOKE_OK'`**
  sur un événement démo, avec `set_config('request.jwt.claims', …, true)` pour
  jouer chaque rôle. C'est ce test qui a révélé la fonction manquante : plpgsql
  ne résout les appels qu'à l'exécution, `db push` et `db lint` ne les voient pas.
- **Joué de bout en bout sur la démo le 2026-09-21** (club `womber` × `organizer@womber.fr`,
  soirée « Goya Thursday », termes Goya en `flat`) : proposition club → avenant
  barème → double signature → billets, table (acompte) et guest list achetés
  par des clients démo → porte du videur (liste, doublon) → décompte déclaré,
  accepté, SEPA déclaré puis confirmé. Le smoke SQL rejouable vit dans
  `scripts/demo/smoke-night-closing.sql` (DO annulé : 96,68 € retenus → tout à
  l'orga, reste 549,68 € en SEPA, IBAN exigé). Ce que la démo NE prouve PAS :
  les checkouts `@womber.fr` sont SIMULÉS (aucune ligne `revenue_distributions`),
  donc « Sécurisé par Yuno » reste à 0 € et la libération Stripe réelle
  (`release_held_transfers`) n'a jamais tourné en vrai sur un contrat à barème.
  Pièges trouvés et corrigés : un club `is_hidden` (démo, ou club pas encore
  « en ligne ») rendait « Event not found » à TOUT client et « Un club » à
  l'organisateur (policy `venues` élargie aux comptes démo, `20260921160000`) ;
  le dialogue « Proposer une soirée » ne savait pas proposer un barème (il
  porte désormais les conditions financières) ; `useEventNetGain` lisait les
  jambes Stripe, qui valent 0 pour l'orga en barème — le gain se lit dans
  `compute_collab_night_closing` (`displayGain` dans `CollabEventDetail`).
  Une soirée « Tables VIP » d'un collab mené par le club montre les formules du
  club, pas « 0 zones · 0 packs ».
- **La page de la co-soirée est une page « travail partagé »** (2026-09-21,
  `docs/DESIGN_SYSTEM.md` §13) : `CollabJourney` en tête (étape courante + UNE
  action, ou « X doit … » quand c'est à l'autre partie), trois chiffres, deux
  colonnes sur desktop (le travail de la phase / le contrat replié + le fil
  partenaire), analyses et bilan repliés, pas de panneau argent avant la
  signature. Ajouter une carte = la ranger dans une phase et une colonne, jamais
  l'empiler en bas ; ajouter une action = la faire porter par la feuille de
  route, jamais un troisième bouton « signer ».
- **Un club invité par un organisateur arrive SANS session pro** : après
  `accept-club-collab-invitation`, recharger la page (`window.location.assign`)
  vers `/owner/collaborations`, jamais `navigate('/owner')` — la session en
  mémoire n'a ni le rôle owner ni le club, `OwnerRoute` le renvoyait sur
  l'accueil public. Tout ce que le club lit sur l'autre partie passe par
  `organizer_profiles` (public), jamais `profiles` (RLS) ; le dialogue de
  contrat reçoit `language`, l'email d'invitation la langue choisie par l'orga.
  L'invitation PORTE le deal : soirée + conditions (par pilier ou barème)
  choisies par l'orga, contrat ouvert pré-signé à l'acceptation, email dédié
  (`buildClubCollabInvitation`). Un club au plan Collaboration sans Stripe peut
  REPORTER la 2FA 7 jours, une fois (`20260922080000`) — jamais sur les pages
  d'argent ; le guide de configuration ne s'ouvre pas tout seul chez lui.

## Équipe d'un organisateur — le scope est l'ORGANISATION, jamais le compte (2026-09-21)

Migrations `20260921140000` (appartenances + acceptation) et `20260921141000`
(`sync_event_slug` en SECURITY DEFINER). Trois rôles : `admin`, `editor`,
`scanner` (`org_members`). Règles intouchables :

- **`useActingOrganizer()` est la porte unique du scope.** Toute page de
  `/organizer-app` lit `organizerId` là, JAMAIS `useAuth().user.id` : le
  fondateur travaille chez lui, un membre d'équipe travaille chez quelqu'un
  d'autre, et les deux ouvrent le même écran. Ce qui reste attaché à la
  PERSONNE garde `user.id` : son profil, `entry_scanned_by`, le préfixe de ses
  fichiers dans le Storage. `useVenueContext` en mode `organizer` rend ce même
  `organizerId` — c'est par lui que toutes les pages partagées avec le club
  (soirées, billetterie, commandes, DJ, guest list) suivent le bon scope.
- **Les droits affichés MIROITENT ce que la base accorde**, jamais plus :
  `capabilitiesFor()` est calé sur `is_org_team_member` et
  `org_member_has_permission`, vérifiés sous RLS rôle par rôle. Un bouton qui
  mène à un refus serveur est pire que pas de bouton. D'où : l'identité de
  l'organisation (profil public, réglages, équipe, paiements, Stripe, IBAN,
  guide de configuration) reste au fondateur — `org_members` n'accepte
  d'écriture que de `organizer_user_id = auth.uid()`, un admin d'équipe n'y
  peut rien. Le staff OPÉRATIONNEL, lui, accepte un admin d'équipe
  (`invite-staff` vérifie `is_org_team_member(…, 'admin')`).
- **La barre latérale filtre par CHEMIN** (`PATH_CAPABILITY` dans
  `org-sidebar.tsx`), et les routes portent la même exigence
  (`<OrgAppRoute requires="…">`). Ajouter une page à la Console Organisateur oblige
  à la classer dans les deux — sans quoi elle est visible pour un scanner.
- **Le lien d'invitation pointe sur `/accept-org-member`** (page
  `AcceptOrgMember.tsx`, DA PUBLIQUE : la personne sort de sa boîte mail, elle
  n'est pas encore dans un dashboard). La règle d'acceptation vit dans la RPC
  `accept_org_member_invitation` (email qui correspond, invitation en attente,
  non expirée, jamais en session d'accès assisté) ; l'edge `accept-org-member`
  ne garde que le cas « pas encore de compte Yuno », où elle crée le compte sur
  l'email INVITÉ et envoie le lien « choisis ton mot de passe ». Un compte créé
  sur un autre email ne pourrait jamais accepter.
- **Après acceptation, invalider le cache** (`invalidateOrgMemberships()`) :
  les appartenances sont tenues en mémoire pour toute la session, sinon la
  personne arrive dans l'app et se fait renvoyer par une garde qui la croit
  encore sans organisation.
- **L'accès d'un membre d'équipe se voit sur SON profil client et sur l'accueil
  de l'app Pro** (2026-09-22) : `RoleAccessCards` et `ProHome` lisent
  `useActingOrganizer().memberships` et dessinent une carte PAR organisation
  servie (« Équipe · Amoris », rôle en sous-titre). Le scanner est mené droit
  sur `/organizer-app/checkin`, les autres sur le tableau de bord ; la carte
  appelle `switchTo` avant d'entrer, et la page d'acceptation pose
  `rememberActingOrganizer` — sans quoi quelqu'un qui sert deux organisations
  ouvre la première de la liste. Le lien d'invitation ne donne JAMAIS l'accès
  par lui-même (vérifié le 22/09 dans un Chrome vierge : `/organizer-app`
  renvoie sur `/auth`, l'appartenance est lue par `member_user_id`) ; une
  invitation déjà acceptée demande donc de se connecter, jamais « Ouvrir le
  dashboard » à un inconnu.
- **`event_slug_aliases` n'a aucune policy, et c'est voulu.** Son trigger
  d'alimentation DOIT rester SECURITY DEFINER : resté INVITER, il se faisait
  refuser par sa propre table et tout renommage de soirée levait 42501 — pour
  l'équipe comme pour le fondateur. Ses quatre frères (`sync_venue_slug`,
  `sync_organizer_slug`, `sync_affiliate_linktree_slug`,
  `sync_member_linktree_slug`) sont DEFINER depuis toujours.

## Vue en direct (« Live View ») — Analytics → En direct (2026-09-21)

Le Live View de Shopify pour Yuno : `/owner/analytics?tab=live` et
`/organizer-app/analytics?tab=live` (`src/components/live-view/*`, hook
`useLiveView`, helpers `src/lib/liveView.ts`). Un globe Mapbox (projection
`globe`, style JSON maison sans étiquette : fond `#0A0A0A`, continents
`#1B1B1E` depuis `mapbox.country-boundaries-v1`) avec un point rouge par
visiteur en ce moment, un anneau blanc sur le club, une onde à chaque fait
nouveau et un arc vers le club pour une vente localisée ; à droite les chiffres
de l'instant, le comportement des 10 dernières minutes, les villes, les pages
regardées et le flux ; en bas du globe la carte de release (billets sur 10 / 60
min, billets par minute, paliers). Surface PRO (`docs/DESIGN_SYSTEM.md`, depuis
le 2026-09-24 — elle était d'abord éditoriale, ce qui détonnait à côté des
autres onglets Analytics) : carte 18 px, cartes imbriquées 14 px, tiles KPI
12 px, hiérarchie T1/T2/T3, badge live vert. Tokens et primitives dans
`live-view/liveViewUi.tsx` (`LV`, `Section`, `Tile`, `Label`, `LiveBadge`) —
jamais Space Grotesk, mono ni filet rouge ici. Règles :

- **Une seule RPC, `get_live_view(p_venue_id, p_organizer_user_id)`**
  (migration `20260921150000`), rappelée toutes les 4 s tant que l'onglet est
  visible ; les changements Realtime sur `tickets` / `table_reservations` /
  `guest_list_entries` / `orders` ne font que déclencher un rappel immédiat.
  Aucun chiffre n'est agrégé côté front ; les montants suivent `fees.ts`
  (total − frais de service − assurance / gestion), les statuts ceux de la compta.
- **« Visiteur en ce moment » = un battement `live_visitor_pings` < 75 s** ;
  la localisation vient de `visitor_sessions` (même `session_id`), enrichie
  par l'edge `geocode-address` qui écrit désormais `country_code` / `latitude`
  / `longitude`. Une session sans coordonnées est géocodée par le front depuis
  son nom de ville (cache localStorage `yuno_geo_<ville>`, partagé avec
  `CityGlobe`). Le tracking étant gaté par le consentement analytics du CMP,
  seules les visites consenties apparaissent ; les ventes apparaissent toujours.
- **Le conteneur Mapbox porte `position:absolute` EN INLINE** : la feuille
  `mapbox-gl.css` pose `position: relative` sur `.mapboxgl-map` et écrase une
  classe Tailwind `absolute` — le globe sortait avec 0 px de hauteur, canvas
  noir, aucune erreur console. Et l'option `padding` de `fitBounds` REMPLACE
  celui de la carte : on lui passe explicitement le padding des superpositions
  (grand chiffre en haut à gauche, carte release en bas à gauche sur desktop),
  sinon le recadrage pose les points sous la carte.
- `owner.an.live` existait déjà (statut « live » en minuscules) : le libellé de
  l'onglet est `owner.an.liveTab`. Les clés de l'écran sont `lv.*` (×3).
- Vérification visuelle : pas de Playwright ici — `scratchpad/shoot.mjs`
  (CDP natif Node 22, session démo injectée dans `sb-<ref>-auth-token`,
  Chrome `--headless=new --use-angle=swiftshader`) a servi à voir le globe en
  vrai ; `--dump-dom` ne dit rien d'un canvas WebGL.

## Comportement d'achat — Analytics → Achats (2026-09-24)

`/owner/analytics?tab=purchase` et `/organizer-app/analytics?tab=purchase`
(`PurchaseBehaviorView`, hook `usePurchaseBehavior`, helpers
`src/lib/purchaseBehavior.ts`, testés). Le reste de la page dit « combien ai-je
vendu ? », cet onglet dit « comment mes clients achètent-ils ? » : délai avant
la soirée, jour × heure, rythme du bar dans la nuit, taille de groupe / panier /
palier, options prises, nouveaux vs habitués et concentration, achats croisés
le même soir, canaux, passage visite → achat, présence à la porte. Règles :

- **Une seule RPC, `get_purchase_behavior(p_venue_id, p_organizer_user_id,
  p_from, p_to)`** (migration `20260924150000`), même porte, mêmes statuts et
  mêmes formules que `get_live_view` (CA club de `fees.ts`, remboursement
  déduit, instant d'achat = `coalesce(paid_at, created_at)`). Le front ne fait
  que mettre en forme ; les phrases « À retenir » se taisent sur une base mince.
- **Les boissons n'existent qu'en portée club** (`hasDrinks`) : l'organisateur
  ne tient pas de bar, les commandes du bar d'un club ne lui appartiennent pas.
- **Présence = soirées TERMINÉES dont la porte a scanné au moins une entrée** :
  sans scanner, « pas scanné » ne veut pas dire « pas venu ».
- L'onglet partage le sélecteur de période de la page ; l'export CSV y est
  masqué (il exporte les ventes, pas ce tableau). Clés i18n `pb.*` (×3),
  onglet `owner.an.purchaseTab`, aide `ohelp.pg.analytics.s11*` et
  `ohelp.org.analytics.s6*`, assistant : article `purchase-behavior`.

## Grammaire de l'analyse + ventes par soirée (2026-09-24, plan Shotgun)

Plan complet et état des lots : `docs/designs/SHOTGUN_COMPETITIVE_PLAN.md`
(lots A-C livrés, D-G à faire). Règles déjà posées :

- **Tout écran d'analyse passe par le kit** `src/components/analytics/kit.tsx`
  (+ `kitFormat.ts` pour `KIT` et `useNumberFormat`) : `TodayDelta` (« ▲ 6
  aujourd'hui », gris « rien aujourd'hui » à zéro), `UpdatedAt` (« Mis à jour à
  HH:MM »), `MetricHint` (ⓘ = UNE phrase de définition, clés `gl.*`),
  `CoverageNote` (« connu pour N sur M »), `FillBar`. Un total sans son « du
  jour », un chiffre sans définition, une donnée partielle sans couverture : ce
  sont les défauts que Shotgun n'a pas.
- **La soirée choisie vit dans l'URL** (`?event=`, `useEventParam`) : Analytics
  club et orga ; un lien `…/analytics?tab=event&event=<id>` ouvre son analyse.
- **`get_events_sales_summary(p_venue_id, p_organizer_user_id)`** (migration
  `20260924160000`) sert la bande de ventes de chaque carte soirée
  (`EventSalesStrip`, page Événements) et « Vos prochaines soirées »
  (`UpcomingEventsBoard`, remplace le héros à soirée unique des deux
  dashboards). Mêmes statuts et formules que `get_live_view` (CA club de
  `fees.ts`, remboursement déduit) ; « aujourd'hui » = minuit dans le fuseau de
  la soirée. Le CA ne part qu'à qui voit l'argent (owner, manager
  analytics/finance, fondateur, membre `view_finance`) ; un éditeur d'équipe
  voit les jauges, jamais le CA ; un club ne voit pas le CA d'une soirée qu'il
  ne fait qu'ACCUEILLIR (`partner_venue_id`). Aucune agrégation côté front.
- **J-N = jours CALENDAIRES de Paris** (`countdownFor`, testé), pas des
  tranches de 24 h. Une soirée gratuite n'affiche pas « 0 € » (`showsRevenue`).
- **Les chiffres d'une liste de soirées se lisent en COLONNES FIXES**
  (`EventMetricsGrid` : CA · Billets · Tables · Guest list · Visites) : un
  pilier fermé laisse sa case vide sur grand écran pour garder l'alignement.
- **Rapport de soirée = `get_event_report(p_event_id)`** (migration
  `20260924170000`, `src/components/event-report/*`, `EventReportView` dans
  l'onglet Événement des deux Analytics). Cinq questions dans CET ordre —
  ventes, évolution, trafic, qui achète, ce qui a fait vendre — et le verdict
  (`EventPostAnalysisView`) en tête une fois la soirée passée. La portée se
  DÉDUIT de l'appelant (club qui gère le lieu, sinon organisateur / équipe) ;
  mêmes gardes d'argent que `get_events_sales_summary`. La série est clée par
  `d` = jours CALENDAIRES avant la soirée (fuseau de la soirée) : deux soirées
  se comparent au même J-N, jamais à la même date (`buildCurve`, testé). La
  comparaison par défaut est la soirée PRÉCÉDENTE de la portée. Messages de la
  soirée = emails (`event_id` ou `automation_trigger_event_id`) et push
  (`event_id`) de la portée ; une vente leur est rattachée sur 1er clic → achat
  de CETTE soirée < 72 h (même fenêtre que l'attribution email), en CA club.
  Côté orga, les push sans `venue_id` ni `agency_id` d'une soirée de l'orga
  (la « Publication » automatique) sont les siens — le lot D ira plus loin.
  « Nouveau contact » = email jamais vu (billet, table, guest list) à une
  soirée de la portée qui a COMMENCÉ avant celle-ci.
- **Push = une page pour le club ET l'organisateur** (lot D, migration
  `20260924180000`). `OwnerPush` sert `/owner/push` et `/organizer-app/push`
  (`OrgAppRoute requires="marketing"`, `PATH_CAPABILITY`) ; côté orga, tout ce
  qui est venue-scopé disparaît (automatisations, RFM, segments sauvegardés,
  assistant IA — `owner-assistant` exige le rôle owner), le modèle « Flash
  boissons » aussi. `push_campaigns.organizer_user_id` porte la portée orga
  (backfill des « Publication » d'orga, `push-automations.ts` la pose) ;
  `send-push-campaign` accepte `organizer_user_id` (fondateur ou admin
  d'équipe, audiences `followers` / `event_tickets` / `checked_in` /
  `all_customers`, même plafond 4 / 24 h que le club).
  L'historique = `get_push_campaigns(p_venue_id, p_organizer_user_id, p_filter,
  p_event_id, p_limit, p_offset)` : toutes les campagnes paginées, ciblés /
  envoyés / ouverts (1er tap par personne) / acheteurs / CA (tap → achat < 72 h,
  CA club de `fees.ts`, remboursement déduit, CA seulement pour qui voit
  l'argent), résumé 30 j et abonnés (`followers.total/reachable/new30d`,
  bandeau `FollowersNudge`). L'annonce automatique d'une soirée s'appelle
  « Publication – soirée » (`campaignLabel`). `PushHistoryCard` ne compte rien.
  Les push MANUELS du club comme de l'orga ne passent pas par
  `client_push_policy()` (seul le plafond 4 / 24 h les borne) — à trancher.
- Vérif visuelle sans compte : banc Vite (`harness.html` à la racine + entrée
  qui remplace `supabase.rpc` par des données d'exemple, env `VITE_SUPABASE_*`
  factices) + Chromium headless. Chromium headless ne descend pas sous 500 px de
  large : pour le mobile, contraindre le CONTENEUR, pas la fenêtre. Ne jamais
  committer le banc.

## Backend Supabase — gotchas critiques

- **Migrations** : pousser via `supabase db push` (le CLI est configuré). Attention aux trous
  d'historique hérités de la migration Lovable→Supabase (réconciliation déjà faite une fois).
- **Gen types** : `supabase gen types ...` — **rediriger stderr** sinon le bruit pollue
  `src/integrations/supabase/types.ts`.
- **Cap fonctions edge** : historiquement, `supabase functions deploy` renvoyait **402**
  pour toute NOUVELLE fonction tant que le spend cap Supabase n'était pas relevé.
  **2026-08-06 : `agency-assistant` (fonction neuve) s'est déployée sans 402** — le cap
  ne bloque plus ; les fonctions codées-mais-jamais-déployées (auth mineurs, staff PIN,
  `promoter-payout-notify`) sont probablement déployables, à retenter.
  Pour `promoter-payout-notify` : le cycle de règlement fonctionne sans elle (les
  demandes d'accusé de réception s'affichent dans l'app et la bascule en litige est
  un cron SQL), mais le promoteur n'est pas poussé sur son téléphone tant qu'elle
  n'est pas déployée.
- **CORS-lock `yunoapp.eu`** : les edge functions n'autorisent que l'origine `https://yunoapp.eu`.
  → checkout impossible en local (échec silencieux, pas de toast) ET la prod DOIT servir depuis
  ce domaine exact.

## Déploiement — Cloudflare Workers (Static Assets)

Frontend statique sur **Cloudflare Workers** (Workers Builds connecté au repo `yuno` ;
backend déjà sur Supabase). Choisi vs Vercel car free tier illimité + aucune restriction
d'usage commercial. NB : c'est un Worker « assets-only », pas un projet Pages — les assets
statiques sont servis gratuitement et ne comptent pas dans le quota de requêtes Worker.

- **Config** : `wrangler.jsonc` à la racine (`name: yuno`, `assets.directory: ./dist`,
  `assets.not_found_handling: single-page-application`). C'est la source de vérité du déploiement.
- **Build command** (dashboard) : `npm run build` — **Deploy** : `npx wrangler deploy`.
- **Node** : `.nvmrc` = 22 (Vite 8 exige Node ≥20 ; fallback env var `NODE_VERSION=22`).
- **SPA fallback** : via `not_found_handling: single-page-application` dans `wrangler.jsonc`.
  ⚠️ NE PAS utiliser un `_redirects` avec `/*  /index.html  200` : Workers Assets le rejette
  ("infinite loop detected"). C'est valable sur Pages, pas sur Workers.
- **Headers + CSP prod** : `public/_headers` (supporté par Workers Assets ; le CSP de
  `vite.config.ts` ne sert qu'au dev).
- **Variables d'env à mettre dans le dashboard** (`.env.local` non poussé) :
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_BASE_URL` (=`https://yunoapp.eu`),
  `VITE_MAPBOX_TOKEN`, `VITE_STRIPE_PUBLISHABLE_KEY` (clé `pk_live_…`).
- **Domaine** : brancher `yunoapp.eu` dès le départ (cf. CORS-lock ci-dessus).

## OTA — mises à jour natives sans review App Store (Capgo self-hosted)

Les apps natives (**Yuno** `eu.yunoapp.app` + **Yuno Pro** `eu.yunoapp.pro`)
reçoivent des MàJ du bundle web **Over-The-Air** via `@capgo/capacitor-updater`,
**auto-hébergé sur Supabase** (pas le cloud Capgo payant). Doc complète +
dépannage : `docs/OTA_CAPGO.md`. Apple l'autorise (2.5.2/3.3.2) : seul du code
interprété (JS/HTML/CSS) est livré, jamais du natif.

- **3 edge functions** (`verify_jwt=false`, le plugin n'envoie pas de JWT) :
  `capgo-updates` (updateUrl), `capgo-stats` (statsUrl), `capgo-channel`
  (channelUrl). Le contrat exact vient du code natif du plugin (`InfoObject`
  requête / `AppVersionDec` réponse) — ne pas deviner.
- **4 tables** `ota_*` (migration `20260809190000`) : RLS totale, **aucune policy
  anon** (infra invisible côté client) ; seules les fonctions + le script
  (service_role) y touchent. Zips dans le bucket public `ota-bundles`
  (content-addressed `bundles/<sha256>.zip`).
- **Garde-fou anti-downgrade** : un bundle est tagué `native_version` (=
  MARKETING_VERSION) ; `capgo-updates` ne le sert que si `native_version ==
  version_build` de l'appareil. Un bundle `1.0.x` ne peut jamais tomber sur une
  future app native `2.0`. Le rollback auto (`notifyAppReady()` dans
  `NativeBridge.tsx`, déjà câblé) protège d'un bundle qui démarre mal.
- **Pousser une MàJ** : `npm run ota:beta` → tester → `npm run ota:promote`
  (beta→prod), ou `npm run ota:publish` direct. `ota:list` / `ota:devices` /
  `ota:rollback`. Tout passe par `scripts/ota-publish.mjs` (secrets lus depuis
  `.env.local`). **Jamais** écrire dans les tables `ota_*` autrement que via ce
  script ou les fonctions.
- **⚠️ Avant toute soumission App Store** : `npm run cap:sync` + `cap:sync:pro`
  pour compiler les `updateUrl` dans le JSON natif — sinon l'OTA est muet.
- **Binaire App Store = macOS RELEASE obligatoire, jamais ce Mac s'il est en
  bêta** (2026-09-07). Xcode tamponne `BuildMachineOSBuild` avec le build de
  l'OS hôte ; App Store Connect refuse à la SOUMISSION (pas à l'upload, pas sur
  TestFlight, pas dans `altool --validate-app`) tout binaire produit sur un macOS
  non publié : état « Invalid Binary » dans la minute, code ITMS-90111, mail
  seulement si « App Status Reports » est coché dans Users and Access. Ne pas
  maquiller la clé. Voie gratuite : `.github/workflows/ios-release.yml`
  (`workflow_dispatch`, matrice client/pro, runner `macos-26`, signature cloud
  par la clé d'équipe via les secrets `ASC_KEY_P8` / `ASC_KEY_ID` /
  `ASC_ISSUER_ID`, export `destination: upload`, ~7 min par app) — lancer avec
  `gh workflow run ios-release.yml -f app=both -f client_build=<n> -f pro_build=<n>`
  (numéros > dernier build ASC), puis version + soumission par l'API
  (`scripts/asc.mjs`). Xcode Cloud fait pareil mais son quota gratuit est de 25 h
  par mois : épuisé, chaque run est annulé à la création sans message.
- **Le 1er lancement après installation applique l'OTA AVANT le premier écran**
  (`autoUpdate: 'atInstall'` + `autoSplashscreen` + `SplashScreen.launchAutoHide:
  false`, les trois indissociables, dans les DEUX `capacitor.config.ts`). Sans
  ça il fallait fermer et rouvrir l'app pour voir la version à jour. Ces
  réglages vivent dans le binaire (`capacitor.config.json` est à côté de
  `public/`, pas dedans) : les changer n'a d'effet qu'à la prochaine version
  publiée, jamais sur les apps déjà installées.
- **Les `VITE_*` des builds Xcode Cloud viennent de `scripts/ci-web-env.sh`
  (committé), jamais de l'UI Xcode Cloud.** Le 25/08, Apple a rejeté le
  build 28 : les env vars du workflow avaient disparu (édition du 14/08) et le
  bundle embarqué, compilé sans `VITE_SUPABASE_URL`, mourait au boot
  (`supabaseUrl is required.`) sur toute **installation neuve** — les appareils
  existants étant sauvés par l'OTA, seul le reviewer le voyait. Les deux
  `ci_post_clone.sh` sourcent ce fichier puis vérifient que l'URL Supabase est
  bakée dans `dist/assets` (sinon le build échoue). Pour tester le vrai flux
  reviewer : extraire `public/` de l'IPA (artefact Xcode Cloud), le swap dans
  une App.app simulateur, install NEUVE (`simctl uninstall` d'abord).

## Comptes démo — l'agent a la main (2026-09-21)

Les comptes de démonstration (club `womber`, organisateurs `organizer@` et
`bde@`, et les neuf rôles staff) sont pilotés par l'agent. Outillage et charte :
`scripts/demo/README.md`. Règles intouchables :

- **Le périmètre démo est la seule chose que cet outillage écrit** : club
  `womber` + comptes `@womber.fr` + les soirées de l'un ou de l'autre. La prod
  héberge des clubs réels dans la MÊME base. `scripts/demo/lib.mjs` applique la
  garde : `rest.post/patch/del` refusent toute requête qui n'est pas épinglée au
  périmètre par un prédicat explicite. La lecture est libre ; en cas de doute la
  garde refuse.
- **`mintSession(email)` ouvre une session sans mot de passe** (lien magique
  signé en service_role, consommé aussitôt). Elle ne dépend donc ni du secret
  `DEMO_LOGIN_PASSWORD` ni de l'edge publique `demo-login`. Le `verify` veut
  `token_hash`, PAS `token` — avec `token`, GoTrue attend l'OTP à 6 chiffres et
  répond `otp_expired` sur un jeton haché.
- **`scripts/demo/drive.mjs` pilote le VRAI front connecté** (Chrome par CDP,
  `WebSocket` natif de Node 22 : ni Playwright ni Puppeteer ici). Il sème la
  session et les bypass via `Page.addScriptToEvaluateOnNewDocument`, donc le
  semis survit aux rechargements de la SPA. `ROLES` y est le miroir de
  `DEMO_ACCOUNTS` (`src/lib/demoSession.ts`) : les faire diverger fait atterrir
  le pilote sur un écran de garde.
- **`OnboardingGate` teste la chaîne exacte `'true'`** : poser `'1'` laisse le
  quiz de goûts recouvrir n'importe quel dashboard pro. Et `#root` reçoit un
  enfant dès la première frame — une capture prise là est noire. `waitForBoot`
  attend du texte PUIS la disparition des `.animate-pulse`.
- **Aucun rôle `admin` sur un compte `@womber.fr`**, aucune donnée réelle
  importée dessus, **aucun envoi réel** (email, SMS, push) depuis un compte démo.
  Les 12 315 contacts de `organizer@womber.fr` servent au RENDU des écrans, à
  rien d'autre (décision du 2026-09-21). Ne pas exécuter
  `scripts/rotate-demo-password.mjs` : les bundles publiés portent le mot de
  passe en dur.
- **`node scripts/demo/audit.mjs` avant de montrer la démo.** Une démo se
  dégrade seule : les soirées passent, les nouveautés ne sont mises en scène
  nulle part. Le rapport rend un verdict, pas des compteurs.

## Git / GitHub (départ propre 2026-06-14)

- **Lovable est définitivement coupé.** Plus aucune référence, aucun rapport à Lovable.
- **Repo** : `github.com/paulbriseboispro-creator/yuno` — historique vierge, démarré sur un
  unique « Initial commit » depuis l'état propre. L'ancien repo Lovable `Yuno-app` (6509
  commits du bot) est abandonné ; son `.git` local est sauvegardé dans `/tmp/yuno-dotgit-backup-*`.
- **Branche** : `main`. Yuno est 100 % local — ce working tree est la seule source de vérité.
- **Dossier parent** `/Users/paul/Desktop/yuno-app` = repo git de workspace séparé, sans remote.
  Le vrai projet est ce dossier-ci (`yuno-bar-buddy`).
- **Migrations historiques** : certaines (`20260122…`) contiennent encore des URLs
  `yuno-bar-buddy.lovable.app` dans du SQL **déjà appliqué** — ne pas réécrire (casse le
  checksum Supabase). Vérifier plutôt la table live `email_templates` pour des liens résiduels.

## Inscription pro en libre-service — la landing crée le compte (2026-09-24)

Un club ou un organisateur ouvre son compte SEUL depuis la landing
(`landing.yunoapp.eu`, repo `Yuno-landing` : modale de chaque CTA + page directe
`/start`, `/fr/start`, `/es/start`, `?role=club|organizer`). Migration
`20260924120000_pro_self_signup.sql`, front `src/lib/proSignup.ts`,
`src/pages/GetStarted.tsx`, `src/pages/admin/AdminProSignups.tsx`. Règles :

- **Un parcours = une ligne `pro_signups`**, clé aléatoire tenue par le
  navigateur (`client_key`). La landing l'écrit étape par étape via
  `track_pro_signup` (anon, SECURITY DEFINER, anti-flood par visiteur haché
  `links_visitor_context`, ne lève jamais). RLS totale sans policy. Une ligne
  qui a produit un compte ne s'écrit plus anonymement.
- **La landing crée le compte sur CE projet** (`auth.signUp`, clé publique),
  puis appelle `complete_pro_signup(key)` EN TANT QUE le nouvel utilisateur :
  club (`venues` avec `is_hidden = true` jusqu'au « Go live », `owner_id`, rôle
  `owner`, `venue_onboarding` étape 1 cochée avec les piliers choisis) ou
  organisateur (`profile_type = 'organizer'`, `organizer_profiles`, rôle
  `organizer`). Idempotente, un club par owner, refusée en session support,
  refusée si le parcours appartient à un autre compte. **Ne JAMAIS toucher
  `profiles.venue_id`** : `guard_profile_venue_self_move` discrimine sur
  `auth.uid()`, qui est l'utilisateur lui-même même en SECURITY DEFINER — la
  propriété vit dans `venues.owner_id`.
- **2FA** : un owner inscrit ainsi reçoit le report existant
  (`mfa_deferred_until = now() + 7 j`, une fois) — `RequireMFA` le refuse
  toujours sur les pages d'argent. Sans ça il tombait sur `/mfa-setup` avant
  d'avoir vu son dashboard.
- **Passage de session** : la landing (autre origine) envoie sur
  `/auth/handoff#yuno_at=…&yuno_rt=…&redirect=/get-started&lang=…` →
  `setSession`. Noms ≠ `access_token` exprès : `detectSessionInUrl` avalerait le
  fragment. Le handoff pose aussi la langue et coupe les étapes d'accueil CLIENT
  (`OnboardingGate` : quiz de goûts, push web) — un pro ne les voit jamais.
- **`/get-started`** lit `open_my_pro_signup()` (horodate l'ouverture de la
  Console) et trace un plan ≤ 7 étapes depuis les réponses (piliers,
  billetterie actuelle → import de contacts, date de la prochaine soirée →
  urgence + WhatsApp du fondateur, numéro lu dans `links_page_config`). Deux
  replis y finissent le travail avec `?key=` : email à confirmer
  (`emailRedirectTo`) et compte existant (connexion `/auth?redirect=`).
  **`https://yunoapp.eu/get-started` doit figurer dans les Redirect URLs de
  Supabase Auth** pour le cas « email à confirmer ».
- **Super admin** : `/admin/signups` (Pilotage) lit `admin_pro_signups(days,
  include_demo)` — funnel (ouvert → profil → description → email → compte →
  Console → 1re soirée → Stripe → en ligne, progression LUE dans `events` /
  `venues` / `profiles`, jamais déclarée), sources, liste avec WhatsApp
  pré-rempli, « contacté », notes (`admin_update_pro_signup`). Alertes
  `admin_pro_signup` (compte créé) et `admin_pro_signup_lead` (promoteur /
  autre : pas de compte en libre-service) ; elles REMPLACENT `admin_new_venue`
  / `admin_new_organizer` pour ces inscriptions (suppression de la ligne non lue
  dans la même transaction). Purge des parcours anonymes sans email à 180 j
  (cron `pro-signups-purge`).
- **Tout lien « créer un compte pro » de l'app passe par `proSignupUrl()`**
  (page de connexion, Explore faible densité). `/auth` crée un compte CLIENT.

## Web = acquisition, app = rétention (stratégie 2026-08)

La racine `/` du web montre une **landing vitrine** (`src/pages/Landing.tsx`) au seul
visiteur web déconnecté jamais engagé ; app native, PWA, sessions et habitués tombent
sur le feed (`/explore` = `Explore`, porte dans `HomeGate`/`src/lib/webHome.ts`).
La conversion vers l'app iOS vit dans `src/lib/appStore.ts` (constante unique
`APP_STORE_READY` — **false tant qu'Apple n'a pas approuvé l'app client**, à flipper
à l'approbation) + `src/components/install/*` (barre dismissible, carte post-achat,
badge) + meta `apple-itunes-app` dans `index.html`.

**Surfaces à ne JAMAIS gater derrière l'app** (aucun mur, aucun interstitiel) :
commande de boissons au QR du bar, checkouts billets/tables/guest list, page QR de
commande, liens promoteurs & affiliés (`/l/*`, `/promoteur/*`, `/p/*`, `/promo/*`,
`/rp/*` — trafic Instagram : les Universal Links n'y fonctionnent pas), surfaces
staff/pro. Le web mobile doit rester un chemin d'achat complet — DICE gate, Yuno non :
on vend du sans-friction dans une file d'attente.

## Yuno Links — la page de la bio Instagram / TikTok (2026-09-05)

`/links` (`src/pages/YunoLinks.tsx`, design claude.design « Yuno Links », DA
publique ; raccourcis de bio `/fr`, `/en`, `/es` → `/links?lang=…` tagués utm) : compteurs vivants, soirées à l'affiche, liste d'attente client,
formulaire pro relié à WhatsApp, liens Instagram FR/EU + App Store. Réglages,
audience et leads dans **`/admin/links`** (`AdminLinks.tsx`, super admin). Tout
le partagé vit dans `src/lib/yunoLinks.ts`. Migrations `20260905150000`…`150200`.

- **Les réglages sont en base, pas dans le code** : `links_page_config` (une
  ligne `default`, jsonb normalisé par `normalizeLinksConfig`). Instagram FR
  (`yunoapp.fr`) pour un visiteur en français, Instagram EU pour les autres ;
  TikTok et WhatsApp masqués tant que vides. Le numéro WhatsApp du fondateur
  se saisit dans l'onglet Réglages — **il n'est pas dans le repo**.
- **Vrai inventaire seulement** : `get_links_public_stats` et
  `get_links_featured_events` excluent les clubs `is_hidden` / décommissionnés
  (donc le club démo « Yuno » et ses soirées, que la landing affiche encore) et
  ajoutent les soirées partenaires `affiliate_events` (Madrid) avec leur page
  `/affiliate-event/<slug>`, et les soirées vendues DANS Yuno passent devant
  les partenaires à l'affiche. Le compteur du bandeau = 7 prochains jours
  glissants (`week_events`), pas le week-end calendaire.
- **Mesure sans cookie**, même modèle que le trafic plateforme : `links_events`
  (RLS totale), écrit UNIQUEMENT par `track_links_event` / `join_links_waitlist`
  / `submit_links_pro_lead` (SECURITY DEFINER, hash salé-jour via
  `platform_daily_salts`, super admin jamais compté), lu par
  `get_links_analytics` (super admin). Un clic qui quitte la page passe par le
  fetch keepalive (`trackLinksClickKeepalive`), jamais par le SDK.
- **Liste d'attente = `launch_waitlist`** (table existante, `/admin/waitlist`),
  avec `source = 'links'` ; l'email est UNIQUE, un doublon renvoie `already`
  et n'est pas une erreur pour la personne. Leads pro dans `links_pro_leads`
  (INSERT seulement via RPC, alerte `admin_links_pro_lead` dans `/admin/alerts`).
  Le lead est enregistré AVANT l'ouverture de WhatsApp, et la fenêtre WhatsApp
  s'ouvre dans le geste utilisateur (`window.open` puis `location`), sinon
  Safari la bloque après l'`await`.
- **Web app géolocalisée** : le bouton demande la position (3,5 s max),
  reverse-geocode (Mapbox, sinon l'edge `geocode-address`) et ouvre
  `/explore?city=<ville>` — la porte `cityFromUrl` d'Explore fait le reste.
  Sur Android la web app devient le geste principal (pas d'app native).

## Accès assisté Yuno (« mode support ») — consentement du pro

Un super admin peut ouvrir une session GoTrue **dans le compte d'un pro consentant**
pour l'aider à configurer sa soirée, sans jamais connaître son mot de passe. Toute la
mécanique vit dans la migration `20260824120000_admin_support_access.sql`.

- **Le consentement est la porte** : `admin_support_grants` (demandé par l'admin,
  approuvé par le pro via `approve_support_grant`, coupé par l'un ou l'autre via
  `revoke_support_grant`). Grant **jusqu'à révocation** (`expires_at` NULL, migration `20260907120000`), session 12 h. Page pro : `/owner/support-access`,
  `/manager/support-access`, `/organizer-app/support-access`.
- **La clé de tous les verrous est le claim JWT `session_id`**, enregistré dans
  `admin_support_sessions.auth_session_id` par l'edge `admin-account-recovery`
  (action `open-support-session` : magiclink admin → `verifyOtp` serveur → tokens).
  `is_support_session()` le lit ; les triggers de garde s'appuient dessus.
- **Ces gardes discriminent sur `auth.jwt()`, PAS sur `current_user`** — ils PEUVENT
  donc être `SECURITY DEFINER` sans se désactiver eux-mêmes, contrairement aux gardes
  du cycle promoteur.
- **Ne JAMAIS ajouter un trigger de blocage sur `admin_support_audit` ni
  `admin_support_sessions`** : la ligne d'audit est écrite PENDANT la session support,
  le trigger se bloquerait lui-même et casserait toute écriture métier. Ces tables sont
  protégées par la RLS (aucune policy d'écriture) — c'est suffisant et sans retour de flamme.
- **Toute nouvelle surface qui touche à l'argent ou à l'identité doit se verrouiller** :
  trigger `block_support_session_write` côté base, et `isSupportSessionToken()`
  (`_shared/support-session.ts`) côté edge function. Déjà couverts : Stripe Connect
  (profiles + venues + DJ + abonnement club), IBAN organisateur et promoteur, cycle
  `promoter_payouts`, email de connexion, PIN, suspension, MFA, suppression de compte.
  `promoter_conversions` bloque UPDATE/DELETE mais **autorise l'INSERT** (une entrée
  pointée à la porte est un fait opérationnel ; la bloquer ferait perdre la commission
  du promoteur en silence, les appels étant en fire-and-forget).
- Le drapeau `localStorage` de `src/lib/supportSession.ts` ne sert QU'À la bannière et
  au contournement de `RequireMFA` (le support n'a pas le téléphone du pro). Ce n'est
  jamais la sécurité : tout refus est serveur.

## Passes Apple Wallet (design 2026-09-04)

Un seul système pour les trois piliers — billet, guest list, table VIP.
`supabase/functions/_shared/wallet/` : `passes.ts` (pass.json), `artwork.ts`
(affiche de la soirée), `assets.ts` (images fixes en base64, régénérées par
`scripts/gen-wallet-assets.py`), `signer.ts`, `router.ts`. Les deux fonctions
qui l'embarquent — `send-ticket-confirmation` (elle porte aussi le routeur
`/wallet`) et `send-vip-confirmation` — doivent être redéployées ENSEMBLE :
`_shared` est bundlé par fonction.

- **Fond noir plein `#0A0A0A`, jamais de dégradé.** `backgroundColor` est une
  couleur unie ; l'ancienne rampe noir → rouge était une image `background.png`
  étirée qui noyait le QR et faisait tomber le contraste des labels sous AA
  dans le bas du pass. Il n'y a plus de `background.png` du tout.
- **Le rouge `#E8192C` est le `labelColor` du billet et de la guest list ; la
  table VIP passe en or `#F2B23C`.** C'est la seule variation chromatique du
  système, et elle se lit d'un coup d'œil. `labelColor` est global au pass :
  on ne peut pas colorer un label plus qu'un autre.
- **Grille commune** (design validé 2026-09) : **l'en-tête ne porte AUCUN
  champ** — le wordmark y est seul. Il n'y a place que pour deux libellés
  minuscules à côté du logo, et « GRATUIT AVANT » s'y faisait tronquer en
  « GRAT… ». Puis : champ principal = **le club en label, le titre en valeur**
  (l'anatomie de l'event card du design system public §6.1 — club en kicker,
  titre en héros) ; ligne 1 = `TYPE` + le chiffre qui décide de la soirée
  (`PORTES` billet, `GRATUIT AVANT` guest list, `TABLE` VIP) ; ligne 2 =
  `DATE | PORTEUR`. Le dos porte la référence, l'invitant / les places / le
  pack et les convives selon le pilier, puis club, adresse, line-up, genre.
- **Le `logo.png` est DÉTOURÉ, sans marge transparente.** Le cadre Apple va
  jusqu'à 160 pt mais Wallet réserve la largeur de l'IMAGE, pas celle de
  l'encre : un wordmark de 72 pt dans un cadre de 160 pt faisait payer 55 % de
  l'en-tête pour du vide et écrasait les champs contre le bord droit.
- **`groupingIdentifier` = la soirée** : les passes d'un même événement
  s'empilent dans Wallet au lieu de s'éparpiller.
- **Jamais de texte ni de QR composité dans une image.** HIG Apple : « Reserve
  pass images for visual content. Embedded text isn't accessible ». Le titre
  reste un champ natif — traduit FR/EN/ES et lu par VoiceOver.
- **PassKit n'accepte que du PNG.** Les affiches sont en JPEG/WebP :
  `artwork.ts` recadre côté Supabase (transform `render/image`, gratuit et mis
  en cache) puis ré-encode en PNG avec `imagescript` (WASM pur — `sharp` et
  `canvas` sont des binaires natifs, exclus de l'edge). **L'import
  d'imagescript est DYNAMIQUE** : un import statique pénaliserait chaque envoi
  d'email de `send-ticket-confirmation`, qui est d'abord une fonction d'emails.
  Toute panne d'affiche est silencieuse : un pass sans image reste valide, un
  pass non émis est un client à la porte sans QR.
- **Le layout poster iOS 18 est écrit mais ÉTEINT** (`WALLET_POSTER_LAYOUT=1`
  pour l'allumer, aucun redéploiement nécessaire). Apple écrit « Poster event
  tickets aren't compatible with tickets that require a QR code or barcode for
  entry » et contredit cette phrase ailleurs dans le même article ; toute la
  porte Yuno étant un scan de QR, on ne bascule pas avant d'avoir vu sur un
  vrai iPhone iOS 18 où atterrit le code-barres. Contrairement à ce qu'affirme
  la session WWDC24, **l'entitlement NFC ne conditionne PAS le layout** — il ne
  conditionne que l'entrée sans contact. Quand on l'allumera : `artwork.png`
  fait **358×448 pt (4:5)**, pas 3:4, et les cinq balises `semantics`
  `eventName` / `venueName` / `venueRoom` / `venueRegionName` /
  `performerNames` sont TOUTES exigées — il en manque une, Wallet retombe sur
  le classique sans un mot. Un pass classique pèse ~250 Ko, un pass poster
  ~3,5 Mo (le PNG ne compresse pas le bruit d'un flyer).
- **Les champs classiques restent obligatoires même en poster** : sans eux le
  pass s'affiche vide sur iOS 17. Un seul `.pkpass` porte les deux layouts.
- **Un QR gris et illisible = pass PÉRIMÉ, pas un bug de couleur.** Wallet
  estompe tout pass dont l'`expirationDate` (fin de soirée + 6 h) est passée,
  code-barres compris — et la couleur du QR n'est réglable par AUCUNE clé de
  `pass.json`. Tester avec un billet d'une soirée à venir avant de chercher
  ailleurs : sur un pass vivant le QR sort en noir franc.
- **Le titre part en CAPITALES** (choix produit du 2026-09-04, assumé) : Wallet
  tronque donc au-delà de ~15 caractères, là où la casse normale en passait ~20.
  SF n'est pas Space Grotesk, et le champ principal ne revient jamais à la ligne.
- Émission idempotente via `ensureWalletPass` ; le `authenticationToken` du
  premier appel est embarqué dans les passes déjà ajoutés, ne jamais le faire
  tourner.

## Listes imprimables (guest list, tables VIP, billetterie)

`src/lib/rosterExport.ts` (rendu) + `src/lib/rosterBuilders.ts` (données) + le dialogue
`RosterExportDialog`. Formats : `door` (PDF de porte, gros noms A→Z, **jamais**
email/téléphone/montant), `detail` (PDF complet), `xlsx` (vrai classeur Excel écrit
par `src/lib/xlsx.ts` — zip OOXML minimal via `fflate`, en-tête figé + filtres,
proposé par défaut) et `csv` (BOM UTF-8 + `;`, sur demande de l'appelant).

- Livraison via `deliverDocument` : `<a download>` est un no-op dans la WebView iOS,
  le natif passe par la feuille de partage (qui contient « Imprimer »).
- Un nouveau pilier à imprimer = un constructeur dans `rosterBuilders.ts`, pas un
  nouveau rendu. Ne jamais mettre une colonne sensible dans `doorMetaKeys`.
- **Recherche par nom à la porte** (`useDoorRoster` + `DoorSearchPanel`, onglet « Liste »
  du videur et de `/organizer-app/checkin`) : taper sur un nom **rejoue le pipeline de
  scan existant** avec le QR trouvé. Ne JAMAIS y réimplémenter la validation — les règles
  (heure limite, doublon, mauvais club, conversion promoteur, file offline) doivent rester
  au seul endroit qui les porte.
- Source de la liste : RPC `get_event_scan_manifest`, ouverte à l'organisateur de la
  soirée et à son équipe depuis `20260824120002`. Le repli hors ligne (IndexedDB) n'existe
  que dans l'app Yuno Pro (`isProApp()`).

## Règles de travail

- Toujours `git add <fichiers précis>` — jamais `git add -A`/`git add .` (parasites + binaires).
- **Ne JAMAIS supprimer un compte « en douceur » (`should_soft_delete`)** — ni dans
  le dashboard Supabase, ni en script. La suppression douce garde la ligne
  `auth.users` (avec `deleted_at`), donc la FK `profiles_id_fkey` ne cascade PAS :
  le profil survit sans compte, et une réinscription sur le même email crée un
  SECOND profil. C'est l'origine des 7 profils orphelins recensés dans
  `docs/ORPHAN_PROFILES.md` (dont deux qui possèdent un club). La suppression
  franche (`admin.deleteUser(id)`, ce que fait déjà l'edge `delete-account`)
  cascade correctement. Corollaire : ne jamais chercher un utilisateur par
  `profiles.email` avec `.maybeSingle()` — sur un doublon, PostgREST renvoie
  `PGRST116` et l'appel tombe.
- **`onboarding_links` ne s'écrit QUE côté serveur** (2026-09-24, migration
  `20260924130000`). Une policy `FOR ALL … WITH CHECK (created_by = auth.uid())`
  laissait n'importe quel compte s'émettre un lien `owner` de n'importe quel club
  par PostgREST puis le consommer : prise de contrôle du club. Désormais : lecture
  seule côté client, droits d'écriture retirés, trigger `guard_onboarding_link_write`
  (SECURITY INVOKER sur `current_user`), et l'edge `accept-staff-invitation`
  REVÉRIFIE l'émetteur au moment de l'utilisation (`linkIssuerAllowed`, miroir de
  `onboarding_link_issuer_allowed()`). Règle générale : **une table dont une ligne
  ACCORDE un rôle ne porte jamais de policy d'écriture « créateur = moi »** — la
  personne choisirait elle-même ce qu'on lui accorde.
- **`profiles.profile_type` ne s'écrit que côté serveur** (migration
  `20260924140000`) : le trigger `guard_profile_type_write` refuse tout
  changement venant d'un client, car `trg_sync_organizer_role_from_profile`
  en déduit le rôle `organizer`. Devenir organisateur = `complete_pro_signup`,
  une invitation ou un lien d'onboarding. Et une ligne `organizer_profiles`
  ne se crée côté client que si l'on EST organisateur
  (`guard_organizer_profile_insert`).
- **Push CLIENT non transactionnel = porte unique `client_push_policy()`** (2026-09-06,
  migration `20260906140000`). Toute notif marketing/engagement destinée à l'app Yuno
  (découverte, nouveautés des clubs suivis, relance d'inactivité, panier…) appelle
  `client_push_policy(user, key)` (unitaire) ou `filter_client_push_recipients(ids, key)`
  (fan-out) AVANT d'envoyer : opt-out (`profiles.discovery_opt_out` +
  `profiles.notification_prefs` jsonb : `discovery` / `follow_new_event` / `marketing`),
  heures calmes 22 h → 10 h Paris, 1 non-transactionnelle / 24 h, 3 / 7 j, cooldown par
  clé. Les rappels de soirées ACHETÉES (`reminder`) et le transactionnel n'y passent pas.
  Un fan-out vérifie les heures calmes AVANT d'insérer sa campagne (le verrou
  `uq_push_campaigns_auto_event`), sinon les destinataires filtrés sont perdus.
  **La découverte ne pousse que de l'INVENTAIRE RÉEL dans la ZONE du client** :
  `get_taste_events_for_user()` v2 exclut les clubs `is_hidden` / décommissionnés (club
  démo inclus), filtre sur `user_home_cities()` (profil — posé par l'Explore —, achats,
  lieux et organisateurs suivis), inclut les soirées partenaires par genre, et ne
  renvoie RIEN sans signal (ni goût, ni genre, ni suivi) ou sans ville connue. Le push
  écrit `discovery_selections` et atterrit sur `/for-you/<id>` (la sélection EXACTE
  annoncée, jamais le feed) ; le titre cite le vrai compte et un genre seulement s'il
  couvre la majorité de la sélection. `new_event` part sur `events.published_at`
  (trigger) sous 72 h, jamais pour une re-génération de modèle récurrent
  (`get_new_events_to_announce()`), et cible `/event/<uuid>` (toujours résolu ; la forme
  `/events/<venue_id>/<slug>` échoue pour une soirée d'organisateur).
  **Côté app** : la session Supabase est miroirée dans un fichier natif
  (`src/lib/sessionVault.ts`, `@capacitor/filesystem`, aucun nouveau plugin) et le token
  APNs suit le compte connecté (`PushTokenKeeper` + `src/lib/pushToken.ts` : montage,
  connexion, retour au premier plan, rotation). Un tap de push est mémorisé et rejoué
  après le rechargement OTA `atInstall` (NativeBridge). Ne jamais réintroduire un
  enregistrement de token limité à un écran, ni un push découverte sans filtre de ville.
- **Notifications push automatiques** : toute nouvelle notif auto passe par le registre
  super admin (`platform_notification_settings`, page `/admin/notifications`). Push
  unitaire → `_shared/auto-push.ts` (`sendAutoPush` : gate + langue FR/EN/ES + tracking
  `auto_push_events` + clic `?an=`). Fan-out → mécanique campagnes de
  `_shared/push-automations.ts` (source='auto', clic `?pc=`). Ne JAMAIS appeler
  `send-push-notification` en direct pour une notif automatique ; ajouter la clé au
  seed + au `CATALOG` de `AdminNotificationAutomations.tsx` + i18n `adminAutoPush.k.*`.
  Toute clé destinée à l'app Pro doit porter `audience: "pro"` (sinon le push part
  vers l'app client et n'arrive jamais).
- **Notifs promoteur : passer par la file, jamais par un push direct.** Les
  événements promoteur sont mis en file par des triggers dans
  `promoter_push_queue` (`enqueue_promoter_push()`), et `dispatchPromoterPushes()`
  la vidange depuis le cron `process-scheduled-campaigns`. Deux garde-fous, et
  **les deux sont nécessaires** : `dedup_key` fusionne les événements tant que la
  ligne n'est pas partie (les compteurs s'additionnent), et `p_min_interval` impose
  un délai entre deux envois de la même clé — sans lui, la vidange toutes les
  5 min renverrait une notification tous les quarts d'heure. Un soir à 50 ventes
  doit produire 2 push, pas 50 : le bilan du lendemain raconte la nuit.
  Ne jamais notifier chaque vente ni chaque entrée d'invité.
- **Règlement promoteur — jamais de solde unilatéral.** Le cycle est en trois temps
  (`prepare_promoter_payout` → `declare_promoter_payout_sent` → `confirm_promoter_payout_received`),
  et seul le promoteur peut déclencher la dernière étape. Yuno ne touche jamais les
  fonds : virement SEPA de banque à banque, Yuno sécurise et horodate l'accord.
  Deux triggers `SECURITY INVOKER` (`guard_promoter_payout_write`,
  `guard_promoter_conversion_settlement`) refusent toute écriture de cycle venant
  d'un rôle client — ils discriminent sur `current_user`, donc **un trigger de garde
  ne doit JAMAIS être `SECURITY DEFINER`** (il s'exécuterait sous son propriétaire
  et se désactiverait lui-même). Toute nouvelle écriture sur `promoter_payouts.status`
  ou `promoter_conversions.status` doit passer par une fonction `SECURITY DEFINER`.
  `settle_promoter_payout` (l'ancien règlement en un clic) lève désormais
  `use_two_step_flow` : ne pas le ressusciter.
- **Alertes super admin : passer par `emit_admin_notification`, jamais par un
  INSERT direct.** Le flux plateforme (`admin_notifications`, page
  `/admin/alerts`, cloche du layout admin) est le troisième du même modèle que
  `staff_notifications` (club) et `organizer_notifications` (organisateur) —
  même forme de table, mêmes composants front (`NotificationsBell` +
  `src/lib/notifications.ts`). Toute nouvelle alerte : (1) émettre via
  `emit_admin_notification(...)` depuis un trigger `SECURITY DEFINER` ou depuis
  `run_admin_alert_sweep()` (cron quotidien 7 h UTC) ; (2) passer un
  `dedup_key` dès que l'émetteur est périodique, sinon le balayage réinsère la
  même ligne tous les matins ; (3) ajouter le type au `NOTIF_CATALOGUE` et sa
  route à `adminNotifLink()` dans `src/lib/notifications.ts` ; (4) ajouter
  `notif.type.<clé>` dans les 3 langues. Les corps de trigger sont enveloppés
  d'un `EXCEPTION WHEN OTHERS THEN RETURN NEW` : une alerte d'observabilité ne
  doit jamais faire échouer l'écriture métier qu'elle observe.
  Ce flux est IN-APP : il n'entre PAS dans `platform_notification_settings`, qui
  pilote les push envoyés aux utilisateurs.
  Les échéances (`admin_credential_deadlines`) sont le cœur du système : tout ce
  qui expire seul — secret OAuth Apple à 6 mois en tête — y a une ligne datée qui
  déclenche des rappels à J-30/14/7/2/1 puis relance en retard. Une échéance sans
  date ne surveille rien : le balayage émet un rappel hebdomadaire tant qu'il en
  reste. `/admin/alerts` ≠ `/admin/notifications` (registre des push auto).
- Ajouter les 3 langues i18n pour toute nouvelle string.
- Migrations : un fichier par changement, timestamp croissant, push via CLI.
- Respecter le bon design system selon surface (public vs pro).
- **Tenir l'IA à jour** (voir section ci-dessous) : tout changement de fonctionnalité
  visible par un client ou un owner DOIT mettre à jour la connaissance des assistants IA.
- **Tenir le mode d'emploi à jour** : toute nouvelle fonctionnalité pro (ou changement
  d'un flux existant) DOIT mettre à jour le mode d'emploi owner (`/owner/help`) dans le
  même chantier — clés `ohelp.*` dans **`src/i18n/locales/help/{en,fr,es}.ts`**
  (section chargée à la demande par `useLocaleSection('help')`, JAMAIS dans le
  dictionnaire principal : elle pesait 40 % du chunk de langue que chaque client
  téléchargeait avant son premier écran) et structure dans
  `src/data/ownerHelpContent.ts`. Une feature sans doc n'est pas finie.
- **Toute capture d'écran d'aide entre en WebP, largeur ≤ 1280 px** :
  `cwebp -q 85 -m 6 -resize 1280 0 in.png -o out.webp`, et on ne commite JAMAIS
  une capture pleine page d'une longue liste (garder l'en-tête + une dizaine de
  lignes). `public/help/` est embarqué dans le bundle OTA que CHAQUE app
  télécharge à sa première ouverture : 50 captures PNG y pesaient 12 Mo sur les
  17,5 Mo du zip (une seule faisait 1440 × 67 221 px). Après conversion :
  1,9 Mo, zip à 8,3 Mo. Le SW web, lui, ignore déjà `help/**` (`globIgnores`).

## Centre d'aide pro — un moteur, quatre dashboards (2026-09-22)

`/owner/help`, `/organizer-app/help`, `/agency-app/help`, `/manager/help` rendent
tous `src/pages/OwnerHelpCenter.tsx` (coquille + URL) et `src/components/help/*`
(`HelpHome`, `HelpCategoryView`, `HelpArticleView`, `HelpAskAi`,
`HelpSupportCards`, `helpUi` = tokens DA + primitives). Design :
`docs/DESIGN_SYSTEM.md` §15. Règles :

- **Trois écrans, adressés par l'URL** : `?category=<id>`, `?article=<id>` et
  `&s=<n>` (section visée). Un écran qui envoie vers le mode d'emploi pointe sur
  SON article, jamais sur l'index.
- **Le texte des articles n'est pas du markdown, mais il est DESSINÉ** par
  `src/lib/helpText.ts` : lignes « 1. » = étapes numérotées, « • » = puces
  (✅ / ❌ = coche / croix), « A → B → C » = chemin en pastilles, `"libellé"` =
  bouton ou menu mis en avant, `**gras**`. Écrire les clés `ohelp.*` avec ces
  conventions ; testé dans `src/lib/__tests__/helpText.test.ts`.
- **L'IA du centre d'aide est UNIVERSELLE** (2026-09-23) : `HelpAiChat`
  (conversation dans la page, accueil + bas d'article) parle à l'action
  `help_chat` de l'edge `owner-assistant`, ouverte à tout pro authentifié
  (rôle ≠ client, OU `profiles.profile_type = 'organizer'`, OU membre
  `org_members` — un organisateur n'a PAS de rôle `user_roles`). Elle ne lit
  aucune donnée du compte : le front fait la recherche (`helpSearch`, 4
  articles + l'article courant, dans la langue) et envoie les extraits ;
  l'edge répond en flux (≤ 180 mots, étapes, libellés entre guillemets) et
  termine par « Pour aller plus loin : [article](chemin) ». Consommation
  tracée sous `assistant = 'help'`. Le registre `src/lib/helpAssistant.ts`
  (`registerHelpAssistant` dans OwnerAssistant / AgencyAssistant) ne sert plus
  qu'au lien « Chiffres en direct : ouvrir l'assistant Yuno Pro ».
- **En-tête = celui de l'app hôte, jamais deux barres** : club et manager
  rendent `OwnerHeader` (collant, comme leurs autres pages) ; organisateur et
  agence, dont le layout a déjà une barre, ne posent qu'un `OrgPageHeader`.
- **Une couleur par thème** (`CATEGORY_COLORS`, `helpUi.tsx`) sur la tuile du
  thème, l'icône de l'article, la pastille de recherche ; l'IA reste rouge, le
  formulaire de support bleu, l'email violet.
- **Réécriture des articles = pipeline, jamais à la main dans les locales** :
  `scripts/help/dump-articles.py <dir>` exporte chaque article en JSON (3
  langues), un rédacteur réécrit selon le contrat (structure « À quoi ça
  sert / Avant de commencer / Pas à pas / Comprendre l'écran / Conseil /
  Attention / Problèmes fréquents », ≤ 700 mots par langue, libellés exacts
  lus dans le composant), `scripts/help/merge-rewrites.py <dir>` remplace
  sections + clés (les 93 articles ont été refaits ainsi le 23/09), puis
  `scripts/help/capture-articles.mjs pending-captures.json` prend les captures
  manquantes avec le compte démo (WebP ≤ 1280 px). Un article partagé entre
  deux dashboards (Meta) garde un seul ns ; deux articles distincts ne
  partagent JAMAIS un ns (org-ads = `ohelp.orgads`), sinon le dernier fusionné
  écrase l'autre.
- **Recherche en mémoire** (`src/lib/helpSearch.ts`) : accents pliés, score
  titre > mots-clés > description > sections, résultat = article + section +
  extrait. Pas de backend, pas de tracking.
- **`/organizer-app/support` existe depuis le 22/09** (même `OwnerSupportRequest`,
  `venue_id` NULL) ; avant, le bouton « Contacter le support » de l'organisateur
  tombait sur une 404.

## Dashboard super admin — refonte complète (2026-09-11)

`/admin` a été reconstruit de zéro. Quatre groupes dans la sidebar, 34 pages
ramenées à une arborescence lisible. Les règles qui suivent ne sont pas des
préférences : chacune répare un défaut constaté.

- **Quatre groupes, pas une liste** : **Pilotage** (`/admin` cockpit,
  `/admin/growth`, `/admin/revenue`, `/admin/product`, `/admin/customers`,
  `/admin/ai`), **Acteurs** (`/admin/people`, `/admin/venues`,
  `/admin/organizers`, `/admin/agencies`, `/admin/events`, `/admin/orders`),
  **Communication** (`/admin/marketing`, `/admin/notifications`,
  `/admin/links`, `/admin/feedback`, `/admin/alerts`), **Système**
  (`/admin/system`, `/admin/audit`, `/admin/support-access`, `/admin/demo`).
  Les anciennes adresses (`/admin/analytics`, `accounting`, `traffic`,
  `segmentation`, `waitlist`, `directory`, `affiliates`, `emails`) sont des
  `<Navigate>` — des liens vivent encore dans des alertes déjà émises.
- **Un chiffre affiché vient d'une RPC, jamais d'un `select` agrégé côté
  front.** Sept RPC portent le dashboard : `admin_cockpit`,
  `admin_activity_feed`, `admin_product_insights`, `admin_release_health`,
  `admin_directory_counts`, `admin_venue_overview` (migration
  `20260910130000`) et `admin_ai_usage` (`20260910120000`). Toutes prennent
  `p_include_demo` et **matérialisent la porte démo une seule fois** (CTE
  `WITH d AS MATERIALIZED`) — cf. la section suivante.
- **`AdminScope` est la porte démo côté front** (`src/components/admin/AdminScope.tsx`) :
  un seul interrupteur, persisté en localStorage, passé en `p_include_demo` à
  CHAQUE appel. Ne jamais filtrer la démo dans un composant.
- **Tous les tokens et primitives vivent dans `src/components/admin/ui.tsx`**
  (~30 composants : `AdminPage`, `Card`, `Stat`, `SectionHeading`, `Seg`,
  `PeriodFilter`, `TabBar`, `RankRow`, `DistRow`, `Notice`, `EmptyState`…).
  Aucune page admin ne redéclare une couleur, un fond de carte ou un rayon.
  Tout le formatage (nombres, €, $, tokens, durées, dates, pluriels) passe par
  `src/lib/adminFormat.ts`. Un `toFixed(2)` ou un `fr-FR` codé en dur dans une
  page admin est un bug.
- **Pluriels : `fmtPlural`, jamais `.replace('{n}', …)` sur un libellé au
  pluriel.** Yuno a de très petits nombres ; « 1 invitations en attente » se
  voit tout de suite. Chaque clé comptée a sa jumelle `…One`.
- **Les séries recharts du super admin ont `isAnimationActive={false}`.** Sur un
  dashboard dense l'animation retarde la lecture, et elle rend toute capture
  headless vide.
- **Deux ordres de grandeur ⇒ deux axes.** Les sessions écrasent les
  inscriptions ; la série de contexte part sur un `<YAxis hide>` à droite
  (cockpit et croissance). Une courbe collée à zéro n'informe personne.
- **`cron.job_run_details` ne se lit qu'une fois, et jamais depuis le
  cockpit.** La table fait des dizaines de Mo sans index, et `postgres` n'en
  est pas propriétaire (donc `CREATE INDEX` échoue) : `admin_cockpit` la
  scannait jusqu'à 74 fois (4,1 s). Elle est lue par `admin_release_health`
  seule, en UN scan matérialisé de 7 jours, et le cron `cron-history-purge`
  la taille à 30 jours.
- **i18n : le super admin est une SECTION à part** (`useLocaleSection('admin')`),
  jamais dans le dictionnaire principal — un client ne télécharge pas les
  libellés d'un dashboard qu'il ne verra jamais. Les clés vivent dans
  `src/i18n/locales/admin/modules/*.ts` sous forme de triplets
  **`[EN, FR, ES]` côte à côte** : une traduction manquante devient
  structurellement impossible. `src/i18n/locales/admin/{en,fr,es}.ts` ne font
  que projeter (`pickLanguage(0|1|2)`). Gardé par
  `src/i18n/__tests__/admin.test.ts`.

## Consommation IA — l'observabilité des assistants (2026-09-11)

Yuno paie OpenAI à chaque conversation et ne savait pas combien. La chaîne
complète : module partagé → table → RPC → page `/admin/ai`.

- **`supabase/functions/_shared/ai-usage.ts` est la porte unique.**
  `logAiUsage()` **ne lève jamais et ne bloque jamais la réponse** (fire and
  forget) : une panne d'observabilité ne doit pas coûter une conversation
  client. `trackOpenAiStream()` tee le flux SSE pour récupérer l'`usage`
  final ; `estimateCostUsd()` porte la table de prix publics OpenAI.
- **Pour une réponse NON streamée**, lire le champ `usage` de la réponse.
  **Pour une réponse streamée**, il faut `stream_options: { include_usage:
  true }` — sans lui OpenAI n'envoie aucun décompte et le coût reste à zéro.
- **`ai_usage_events` : RLS activée, AUCUNE policy.** Seul `service_role`
  écrit, seule la RPC `admin_ai_usage` (SECURITY DEFINER) lit. Purge à 13 mois
  par le cron `ai-usage-purge`.
- **On enregistre la QUESTION (tronquée à 240 caractères), jamais la réponse.**
  C'est ce qui permet de lire ce que les gens demandent vraiment sans stocker
  de conversation.
- **Toute nouvelle fonction edge qui appelle OpenAI doit appeler `logAiUsage`**,
  sinon elle dépense en silence. Déjà branchées : `yuno-assistant`,
  `owner-assistant`, `agency-assistant`, `translate-text`,
  `_shared/event-embeddings.ts`, `_shared/taste-embeddings.ts`.

## Tracking super admin — la démo n'est pas un chiffre (2026-09-08)

Le dashboard `/admin` agrégeait TOUT : au 08/09 il affichait 261 811 € dont
**pas un centime réel** (aucune session `cs_live_` dans la base). Les clubs de
test ont été purgés, mais le club démo `womber` et les orgas démo — qu'on garde,
le reviewer Apple et les captures produit en dépendent — portent à eux seuls
~258 000 € de faux revenus. La démo se retire donc du CALCUL, jamais de la base.

- **Porte unique** : `is_demo_email()` (`@womber.fr`, `vitrine+…@yunoapp.eu`,
  `deleted-…@deleted.local`), `demo_venue_ids()`, `demo_event_ids()`
  (migration `20260908170000`). Toute surface de tracking super admin la
  traverse — SQL comme front. Ne jamais réécrire le test « est-ce de la démo ? »
  ailleurs : c'est ce qui a produit 262 k€ de faux chiffres.
- **Un client est quelqu'un qui est VENU, pas quelqu'un qui a payé.**
  `_admin_customer_activity()` (nouveau) = ventes payées ∪ guest list
  (`amount 0`, `is_paid false`, catégorie `guestlist`) ; `_admin_paid_activity()`
  n'en est plus qu'une vue filtrée. Sur une soirée sans billetterie, la guest
  list est la SEULE trace d'une venue : la plateforme comptait 0 client là où
  elle en a 9. Récence, fréquence et nuits comptent toute l'activité ; les
  montants (LTV, panier moyen, tier) ne comptent que le payé — une entrée
  gratuite ne doit jamais diluer un panier.
- **Les inscriptions sont une métrique suivie** : `admin_signup_stats()`
  (total, clients vs pros, 7 j / 30 j / 30 j précédents, par jour, par mois).
  Elle exclut la démo ET les profils orphelins — une ligne `profiles` sans
  `auth.users` n'est plus un compte (voir `docs/ORPHAN_PROFILES.md`).
  Ne pas revenir à un `count(*)` brut sur `profiles`.
- **La porte s'évalue UNE fois par requête, jamais par ligne.** Posées dans un
  `WHERE … = ANY(fonction())`, ces fonctions STABLE sont rappelées à chaque
  ligne : `_admin_customer_activity()` mettait **32 s** avant `20260908180000`,
  **193 ms** après. Toute nouvelle surface qui filtre la démo doit passer par un
  CTE `WITH d AS MATERIALIZED (SELECT demo_venue_ids() AS dv, demo_event_ids()
  AS de)` joint en CROSS JOIN — jamais l'appel nu dans le prédicat.
- **L'onglet Commandes passe par `admin_orders_list`** (`20260908200000`) :
  liste, compteurs et pagination côté serveur pour les trois piliers, démo
  exclue par défaut, bouton « Démo » pour la rouvrir. Filtrer côté client était
  exclu — exclure 105 soirées démo par `not.in.(…)` dans une URL PostgREST casse
  dès que le club démo grossit.
- **CRM client (`20260908190000`→`192000`).** `_admin_customer_identity(email)`
  est la porte unique de l'identité : elle rend UNE ligne par email — le profil
  VIVANT gagne sur le profil orphelin, puis le plus récent. La jointure directe
  `profiles ON lower(email)` dupliquait chaque personne en doublon (11 lignes
  affichées pour 9 personnes). Ne jamais rejoindre `profiles` par email dans une
  surface admin : passer par cette fonction en `LEFT JOIN LATERAL`.
  Elle rend aussi ce qui décide de l'action : `has_account`, `has_app`,
  `email_opt_in`, `sms_opt_in`, `email_suppressed`. **`has_app` se déduit de
  `push_subscriptions`** — c'est le seul rattachement appareil→personne dont on
  dispose (`ota_devices.custom_id` est vide), donc il SOUS-ESTIME : quelqu'un
  qui a l'app et a refusé les notifications compte comme sans app.
  L'annotation vit dans `crm_customers` (étiquettes) et `crm_customer_notes`,
  **clés par EMAIL et non par user_id** : 7 clients sur 9 n'ont pas de compte,
  et ce sont justement ceux qu'on a besoin d'annoter. Ces deux tables n'ont
  AUCUNE policy RLS — tout passe par les RPC `admin_crm_*`.
- **`= ANY(sous-requête)` n'est pas `= ANY(tableau)`.** `v.id = ANY ((SELECT dv
  FROM d))` est lu comme la forme ensembliste et compare `text` à `text[]` :
  `admin_platform_analytics` est parti cassé en prod, silencieusement (plpgsql
  ne prépare qu'au premier appel). Utiliser `EXISTS (SELECT 1 FROM d WHERE x =
  ANY(d.dv))`, et **lancer `supabase db lint --linked` après toute migration de
  fonction** — c'est ce qui l'a attrapé.
- **`_purge_venue` est orphan-safe depuis `20260908160000`** : l'`UPDATE
  profiles SET mfa_enabled=false` revalidait `profiles_id_fkey` et levait
  `23503` quand le propriétaire était un profil orphelin — un club orphelin
  était alors impurgeable, y compris par le cron J+60.

## CRM club v2 (segments, attribution, automations — 2026-08-28)

- **Le scoring RFM vit dans `_venue_customer_rfm` (SQL) et NULLE PART ailleurs.**
  `get_venue_customer_segments` renvoie `rfm_segment/rfm_tier/churn_risk/is_guest`
  calculés serveur — ne JAMAIS re-répliquer les quintiles en TypeScript (la
  triplication historique a déjà fait cibler 0 personne en push). Les invités
  (guest checkout) sont des lignes synthétiques UNION lecture (`is_guest`,
  id = md5, user_id NULL) — le chemin paiement n'est pas touché.
  **Côté organisateur, même règle au mot près** : `get_organizer_customer_segments`
  sert elle aussi `rfm_*` depuis 2026-09-04 (le front recalculait ses propres
  quintiles). Toute évolution de la règle se fait dans les DEUX fonctions.
- **La RÉCENCE n'est pas relative** (2026-09-04) : bandes calendaires 14 / 30 /
  60 / 90 jours, exactement celles promises dans `ohelp.pg.customers.s3b`.
  Un quintile pur faisait tomber en « Perdu » la moins récente de deux
  personnes inscrites l'avant-veille. La fréquence garde une part relative mais
  bornée à ±1 autour de sa bande absolue en nuits ; seul le montant reste
  purement relatif au lieu. Et « À risque » se teste AVANT « Fidèle » : un
  habitué muet depuis trois mois est le client à rappeler, pas une ligne
  rassurante dans le camembert.
- **Segments sauvegardés** : `venue_segments` (definition jsonb v1, AND plat) +
  résolveur unique `resolve_venue_segment` (membership dynamique, résolu à
  l'envoi). Consommé par le scope push `segment:<uuid>` et l'audience email
  `custom_segment` — cette dernière JOINt TOUJOURS `newsletter_subscriptions`
  opt-in : ne jamais contourner ce join, c'est la porte de consentement.
  Condition inconnue ⇒ FAUX (l'audience rétrécit, jamais l'inverse).
- **Attribution €** : query-time uniquement (jamais de campaign_id sur les
  tables de vente). Push = `get_audience_push_attribution` (user_id), email =
  `get_email_campaign_attribution` (lower(email), couvre les invités) — même
  fenêtre clic→achat 72 h, même formule net (fees.ts).
- **Automations client** (`win_back`/`birthday`) : dispatcher
  `_shared/customer-automations.ts` drainé par process-scheduled-campaigns.
  Anti-spam en 3 couches : ledger `venue_automation_sends` + claim atomique
  `try_claim_customer_automation`, cap 3 push non transactionnels/24 h,
  kill-switch `platform_notification_settings`. `vip_upsell` est event-scopée
  et passe par `get_due_push_automations` (verrou (event_id, template_key)).
  Toute nouvelle clé : CHECK de `venue_push_automations` + templates
  `_shared/` + `pushTemplates.ts` + CATALOG admin + seed + i18n ×3.
- **Export audience pub** (`export_venue_ad_audience`) : contacts CONSENTANTS
  uniquement (opt-in newsletter ∪ SMS), gate owner — jamais la base brute.

## Import unifié + segmentation intelligente (club + organisateur — 2026-09-08)

Doc complète : `docs/CONTACT_INTELLIGENCE.md`. Règles intouchables :

- **Un seul dialogue d'import** (`ContactImportDialog`, pages Campagnes email
  ET SMS) : un fichier alimente les deux canaux via `import_contact_list`, qui
  APPELLE `import_email_contacts` et `import_sms_contacts`. Ne jamais écrire
  dans `newsletter_subscriptions` / `venue_sms_contacts` depuis l'import unifié,
  ne jamais recréer un dialogue par canal.
- **`imported_contacts` = matière, jamais consentement.** Les résolveurs
  (`count_contact_segment_def`, kind email `contact_segment`, type SMS
  `contact_segment`) n'atteignent que l'opt-in newsletter non supprimé et le
  numéro consenti < 36 mois sans STOP.
- **`contact_segments` vaut aux DEUX portées** (contrairement à
  `venue_segments`). Définition jsonb v1 compilée à l'envoi par
  `contact_definition_predicate` ; condition inconnue ⇒ FAUX (et jamais une
  exception : un littéral nu `parts || 'false'` faisait PLANTER la résolution,
  corrigé en `20260916120000` — `array_append`, toujours). Vocabulaire étendu
  le 16/09 aux faits Yuno de la base vivante : `tables` / `tickets` / `orders`
  `{op,value}` et `last_seen_days {op,value}` (achat, venue OU clic).
- **Les quatre segments de la plaquette sont des PRÉRÉGLAGES front**
  (`YUNO_SEGMENT_PRESETS`, `src/lib/contactSegments.ts`) : « Prend des
  tables », « Panier moyen élevé », « Vus il y a moins de 60 jours »,
  « Habitués qui décrochent ». Proposés aux DEUX portées dans l'écran Audience
  (section « Segments Yuno », un clic crée le segment via
  `save_contact_segments` ET le cible) et dans le dialogue Segments, avec leur
  effectif live (`count_contact_segment_def`). L'analyseur, lui, se tait sous
  10 personnes / 30 % de couverture : sur une base qui démarre, ces quatre-là
  n'apparaissaient jamais. Même `suggestion_key` que l'analyseur quand la
  règle est la même (`spend_tables`) : jamais de doublon. **Le seuil du panier
  est DYNAMIQUE** : `suggest_basket_threshold(portée)` (migration
  `20260916140000`) rend la valeur Yuno de la portée — 3e quartile de la
  dépense par soirée dès 20 clients payeurs, sinon prix par convive de la
  formule de table la moins chère, sinon 1,5 × le billet le plus cher, sinon
  60 € — avec sa base (`history` / `offer_tables` / `offer_tickets` /
  `default`), et le pro la remplace dans `BasketThresholdField` (écran
  Audience et dialogue Segments). Clé `spend_tables:<n>` hors 60 € : deux
  seuils = deux segments ; le panier de l'analyseur (60 € fixe) s'efface
  derrière le préréglage dans le dialogue.
- **Audiences intégrées d'un ORGANISATEUR (VIP, gros dépensiers, réguliers,
  nouveaux, dormants) = billets + tables + guest list** via
  `contact_scope_customers` (`20260916120000`), plus les seuls billets ; les
  effectifs viennent de `count_organizer_audience_kinds` en un appel
  (`count_campaign_recipients` est venue-scopée, l'écran d'un orga n'affichait
  aucun chiffre).
- **L'analyse (`analyze_contact_lists`) est déterministe, sans IA, scope-wide** :
  ≥ 10 personnes par proposition, couverture ≥ 30 % de la donnée. Le libellé et
  la raison sont traduits côté front (`describeSuggestion`, clés `cseg.sug.*`)
  et le nom traduit est ce qui est stocké ; `suggestion_key` reste stable.
- Une personne présente dans plusieurs fichiers = sa ligne la plus récente
  (`contact_rows`), à date égale la plus renseignée.

## Import de contacts : un fichier = une liste, jamais deux (2026-09-17)

Migration `20260917140000_contact_import_dedup.sql`. Constaté sur le compte
organisateur WOH : 10 759 + 317 adresses importées séparément le 1er septembre,
puis le MÊME public réimporté d'un seul fichier de 12 315 le 8. Personne n'a été
dupliqué (`newsletter_subscriptions` est unique par portée et par adresse), mais
l'ATTRIBUTION s'est fragmentée — le `ON CONFLICT … DO UPDATE … WHERE opted_in =
false` d'`import_email_contacts` ne retouche jamais un abonné déjà actif, donc
les 11 076 déjà présents sont restés sur les deux anciens fichiers et la liste
complète n'en possédait que 1 239. Choisie comme audience, elle touchait 1 239
personnes en en annonçant 12 315 : **un manque de 90 %, silencieux**.

- **L'empreinte décrit le FICHIER, pas ce que la liste possède aujourd'hui.**
  `contact_fingerprint(text[])` rend « n:md5 » sur l'ensemble trié des
  identités ; elle est posée sur `contact_list_imports`, `email_list_imports` et
  `sms_list_imports` au DERNIER lot (`p_final`), lue depuis `imported_contacts`.
  La calculer depuis les abonnés d'une liste donnerait 1 239 au lieu de 12 315.
- **Une liste absorbée est RETIRÉE, jamais supprimée** (`superseded_by` /
  `superseded_at`) : la ligne d'import est une pièce du dossier de consentement.
  Les trois panneaux qui listent des imports la masquent
  (`get_email_lists_health`, `get_sms_contacts_overview`,
  `get_contact_intelligence_overview`).
- **`check_contact_import(portée, emails[], phones[])`** est l'avis AVANT
  écriture : doublon exact, et recouvrement liste par liste. Le dialogue
  n'interrompt le pro que s'il y a une vraie décision (`needsDecision` :
  doublon exact, ou une liste existante reprise à ≥ 50 % par ≥ 10 contacts) —
  quelques adresses déjà clientes ne méritent pas une question.
- **`import_contact_list` prend `p_mode` ('append' | 'merge') et `p_final`.**
  Au dernier lot, le serveur calcule l'empreinte sur ce qu'il a REÇU et absorbe
  d'office si le fichier est un doublon exact : la garantie ne dépend pas du
  client, un import refait à l'identique ne crée jamais une seconde liste.
  `append` reste légitime (les VIP importés après la base générale).
- **`contact_import_absorb(list_import_id)`** est la seule porte de fusion :
  la liste prend la propriété de toutes ses identités, les listes laissées
  vides sont retirées, et **les campagnes en brouillon qui les visaient sont
  recâblées** — sans ça un brouillon partirait à zéro destinataire sans le dire.
  Elle ne déplace JAMAIS un opt-in, une attestation ni un désabonnement.
- Ajouter un paramètre à `import_contact_list` = **DROP + CREATE**, comme pour
  `import_email_contacts` : une surcharge rendrait ambigus les appels à
  arguments nommés des bundles en cache (erreur 300).

## La base de contacts vivante (import ∪ clients Yuno, engagement — 2026-09-15)

Doc : `docs/CONTACT_INTELLIGENCE.md` § « La base vivante ». Migrations
`20260915180000` → `182000`. Page `/owner/campaigns/contacts` et
`/organizer-app/campaigns/contacts` (`ContactBasePanel`), carte
`CampaignImpactCard` (rapport de campagne + dialogue de segmentation), export
`src/lib/contactBaseExport.ts`. Règles intouchables :

- **`contact_rows` = fichier importé ∪ clients venus par Yuno, une ligne par
  email.** Identité Yuno d'abord (prénom, téléphone, compte), montants et
  soirées ADDITIONNÉS, origine `import|yuno|both`. Tout ce qui segmente,
  compte, liste ou exporte lit cette base ; ne jamais re-lire
  `imported_contacts` seule pour une audience.
- **`imported_contacts` n'est jamais modifiée par l'engagement** (pièce du
  dossier de consentement). L'engagement vit dans `contact_engagement`,
  écrite UNIQUEMENT par `refresh_contact_engagement` : fin d'envoi
  (`send-campaign`), cron `contact-engagement-sweep` toutes les 10 min,
  bouton Actualiser. Jamais en ligne dans une RPC lue par le front (4,9 s sur
  12 300 contacts, plafond 8 s).
- **Six statuts, une seule définition** (dans `refresh_contact_engagement`) :
  `unreachable` avant `unsubscribed` (un bounce dur n'est pas un choix ;
  `suppress_email` coupe aussi `opted_in`), puis `active` / `passive` /
  `silent` / `new`. Un statut DÉCRIT ; seul le consentement (`email_ok`,
  `phone_ok`) AUTORISE.
- **Gardes internes = `session_user`, jamais `current_user`**
  (`contact_scope_allowed_or_internal`) : en SECURITY DEFINER `current_user`
  est toujours le propriétaire et ouvrirait tout.
- **Bilan de campagne** : `record_campaign_list_baseline` prend la photo
  « avant » UNE fois à la fin de l'envoi ; `refresh_campaign_list_impacts`
  recalcule la photo « maintenant » ≤ 30 j ; `get_campaign_list_impact` ne
  rafraîchit que les photos. Écart par segment = current − baseline.
- **Export** = `export_contact_base` (une passe, `{columns, rows[][]}`),
  refusé en session support ; la page Clients (club et orga) exporte cette
  base unifiée, pas la vue filtrée.
- Variables plpgsql préfixées `v_` : une variable `c` masque l'alias de table
  `c` (« record c is not assigned yet »).

## Marketing plateforme — Yuno écrit à sa propre base (2026-09-08)

Doc complète : `docs/PLATFORM_MARKETING.md`. Écran `/admin/marketing`
(+ `/admin/marketing/sms`). Ce n'est PAS un second système : c'est la
**troisième portée** du moteur qui sert déjà les clubs et les organisateurs
(Email Studio, file d'envoi, gouverneur de quota, liste de suppression, file
SMS, imports attestés, segments). Règles intouchables :

- **La portée plateforme = les DEUX colonnes de portée à NULL**
  (`venue_id IS NULL AND organizer_user_id IS NULL`). Ce créneau n'est
  atteignable que par `is_super_admin()` ou `service_role` : deux NULL ne
  satisfont ni la branche club ni la branche organisateur d'aucune policy. Ne
  JAMAIS écrire une policy qui accorderait cette portée sur un autre critère.
- **Une seule porte de comparaison de portée : `marketing_scope_match()`.** Le
  prédicat écrit à la main `(p_venue_id IS NOT NULL AND …) OR (p_organizer_user_id
  IS NOT NULL AND …)` est FAUX quand les deux sont NULL — donc muet sur toute la
  portée plateforme, sans jamais lever d'erreur. Toute nouvelle fonction de
  portée passe par cette fonction, et les gardes deviennent « au plus une
  portée », jamais « exactement une ».
- **Rien n'entre dans une campagne sans passer par le registre de
  consentement** (`newsletter_subscriptions` / `venue_sms_contacts` en portée
  plateforme). Les sources internes (comptes, `launch_waitlist`,
  `links_pro_leads`) y sont VERSÉES par `sync_platform_marketing_contacts`, pas
  lues à l'envoi : le jeton de désinscription n'existe que sur une ligne du
  registre, et un email marketing sans porte de sortie ne part pas. La synchro
  ne réveille jamais un désabonné explicite, n'écrit jamais une adresse
  supprimée, et écarte démo, profils orphelins et comptes suspendus.
- **Clé de quota `yuno`, JAMAIS `platform`.** `platform` est déjà l'étage 1 de
  `consume_email_send_quota` (le pool global) : réutiliser cette clé pour
  l'expéditeur ferait consommer deux fois le même compteur dans le même appel.
- **Audience vide ⇒ personne.** Le miroir v1 (`audience_type`) n'a aucun chemin
  plateforme. Les segments sont des POPULATIONS (`clients`, `pros`, `waitlist`,
  `leads`, `app_users`, `no_account`, `buyers`, `import`, `contact_segment`),
  pas des paliers de dépense : Yuno n'encaisse pas pour lui-même.
- **Le SMS plateforme n'a pas de crédits** — il part sur le compte Twilio de
  Yuno. `balanceIdFor` rend `null` et le débit/remboursement devient un no-op ;
  le coût reste lisible dans `sms_campaign_recipients.credits`. Ne pas
  réintroduire un solde plateforme.
- **Piège vécu, à ne pas rejouer** : `210100` a ouvert la portée sur les
  fonctions de contact, `220000` (contact_intelligence_fast) les a réécrites
  juste après avec la garde stricte, et la portée est retombée. `230000` reprend
  les corps RAPIDES et n'y change que la portée. Toute réécriture de ces
  fonctions repart de l'ÉTAT LIVE (`pg_get_functiondef` sur la base liée),
  jamais d'un ancien fichier de migration.

## SMS marketing (club + organisateur — 2026-09-07)

Doc complète + runbook de mise en service : `docs/SMS_MARKETING.md`. Règles
intouchables :

- **Une seule implémentation, deux portées.** `SmsCampaignsPanel` (+ éditeur,
  rapport, achat de crédits) sert `/owner/sms-campaigns` ET `/organizer-app/sms`.
  `venue_sms_contacts` porte `venue_id` OU `organizer_user_id` (XOR) ;
  `_shared/sms-consent.ts` résout l'organisateur depuis la soirée quand il n'y
  a pas de club. Ne JAMAIS réintroduire un chemin club-only.
- **Interrupteur « bientôt » = `SMS_MARKETING_LIVE`** (`src/lib/smsMarketing.ts`).
  À `false` : bannière, envoi/test/planification/achat verrouillés, brouillons
  autorisés. À flipper seulement une fois le numéro Twilio en place.
- **`_shared/sms-text.ts` ⇄ `src/lib/smsMarketing.ts` sont des miroirs** :
  composition (nom d'expéditeur + STOP + `{lien}`) et comptage de segments.
  Modifier l'un sans l'autre = coût annoncé ≠ coût débité.
- **File, pas boucle** : `send-sms-campaign` draine par tranches
  (`claim_sms_campaign_recipients` SKIP LOCKED, marquage en lot), le cron
  `process-scheduled-campaigns` relance et lance les campagnes planifiées.
  Crédit débité AVANT Twilio, remboursé sur REFUS seulement (API Twilio ou
  statut `failed` : jamais parti, non facturé). Un `undelivered` est facturé à
  Yuno et reste décompté au pro — ne pas le rembourser, c'est toute la marge
  du pack Scale (`apply_sms_delivery_status`, seule porte du webhook de statut).
- **Solde vérifié pour toute la campagne avant envoi ; épuisement en route ⇒
  `paused`/`credits`**, jamais une campagne à moitié partie sans le dire.
- **Résolution d'audience = service_role seul** (`resolve_sms_campaign_recipients`) ;
  le comptage et le rapport passent par `sms_scope_allowed`. Les anciennes RPC
  ouvertes à `authenticated` sans garde ont été supprimées, ne pas les recréer.
- Heures calmes 20 h → 8 h Paris + dimanche par défaut (opt-out par campagne).
  Mention STOP et annonceur ajoutés serveur, jamais retirables.
- **Import de liste SMS = même contrat que l'email** (`import_sms_contacts`,
  `sms_list_imports`, `venue_sms_contacts.import_id`) : attestation d'origine
  obligatoire, un numéro `unsubscribed` où que ce soit n'est JAMAIS réabonné
  (liste repoussoir), chaque fichier est un segment `import`. Le front complète
  les numéros nationaux avec le pays choisi (`src/lib/smsImport.ts`), le serveur
  ne garde que de l'E.164.

## Email Studio (design + composition + flow — 2026-08-31)

La couche design/composition des campagnes est l'**Email Studio**
(`src/components/email-studio/`, modèle + rendu dans `src/lib/email/`).
Plan : `docs/designs/EMAIL_STUDIO_PLAN.md`. **Source de vérité visuelle :**
le prototype claude.design `Email Studio Yuno.dc.html` (copie locale :
`~/Downloads/Outil design email Yuno/`) — la passe de fidélité a été faite
écran par écran le 31/08. Points structurants :

- **Modèle v2 versionné** : `email_campaigns.blocks_version` (1 = ancien
  modèle, 2 = Studio). Les brouillons v1 migrent à l'ouverture
  (`src/lib/email/migrate.ts`) ; l'edge route vers le bon renderer.
- **Le renderer existe en DEUX exemplaires synchronisés** :
  `src/lib/email/render.ts` (canonique, testé par `npm test`) et son port
  Deno `supabase/functions/_shared/email-studio-html.ts`. Toute modification
  de l'un DOIT être répercutée dans l'autre.
- **Blocs Yuno (event, tickets, table, countdown) = données live** : lues en
  base AU RENDU (une requête par tranche d'envoi, `fetchStudioLiveData`),
  jamais figées à la composition. Source des tarifs : `ticket_rounds`.
  **L'email lit les drapeaux « Complet » de `src/lib/soldOut.ts`** (2026-09-16,
  helpers `liveSoldOut` / `applyTicketsSoldOut` / `openTablePacks` /
  `tablesLeftFor` / `isGuestListClosed` dans `live.ts`, dupliqués dans le port
  Deno) : billetterie fermée à la main ⇒ chaque tranche « épuisé » et pas de
  prix d'appel ; `sold_out_pack_ids` ⇒ formule retirée des lignes ET du stock
  (miroir de `_event_tables_left`) ; `tables_sold_out` ⇒ 0 table, la carte dit
  « Complet » sans bouton ; `guest_list_sold_out` / `manually_sold_out` ⇒ liste
  « complet » sans bouton ; `ticketing_enabled` / `tables_enabled = false` ⇒
  le bloc s'efface (`tablesOpen: false`). Sans ça l'email vendait une formule
  que la page refusait au clic.
  **Live = la base fait foi** (2026-08-31) : un événement SANS billetterie
  (guest list seule) EFFACE le bloc billets et le prix de la carte événement —
  ne jamais retomber sur les lignes placeholder quand l'événement est résolu.
  Contrat : `live.tickets` est un tableau (vide = pas de billetterie) ;
  `undefined` = événement non résolu, seul cas où les props figées servent.
  Le canvas hérite de l'événement de la campagne comme l'edge (`liveFor`).
- **Audience v2** : `audiences_json` (multi-segments, union) +
  `exclusions_json` dans `resolve_campaign_audience` ; le net réel vient de
  `count_campaign_audience(p_campaign_id)` qui lit la campagne SAUVEGARDÉE
  (le Studio recompte après chaque autosave). La porte opt-in newsletter
  reste non négociable ; condition inconnue ⇒ FAUX.
- **A/B d'objet** : variantes assignées à l'enqueue
  (`assign_campaign_ab_variants`, déterministe), phase de test gatée dans
  `claim_campaign_recipients`, gagnant déclaré à l'ouverture par le cron
  (`resolve_campaign_ab_winner`) puis le drain repart avec l'objet gagnant.
- **Le corps des blocs texte est du TEXTE BRUT + mini-markup inline**
  (2026-08-31) : `\n` = paragraphe, variables `{{…}}`, `[b]gras[/b]`,
  `[i]italique[/i]`, `[u]souligné[/u]`, `[k]barré[/k]`, `[c=#hex|accent]…[/c]`,
  `[s=px]…[/s]`, `[url=…]…[/url]` — rendus par `inlineMarkup()` (appliqué APRÈS
  `escapeHtml`, jamais de HTML utilisateur), dupliqué à l'identique dans le port
  Deno. Les signes markdown (`**gras**`, `*italique*`, `~~barré~~`,
  `__souligné__`) restent LUS — brouillons déjà écrits, texte collé — mais ne
  sont plus ÉCRITS : ils ne s'imbriquent pas (`**a *b***` n'est lisible par
  personne), la forme à crochets si. Toute règle ajoutée à `inlineMarkup` se
  répercute dans le port Deno ET dans `RULES` de `src/lib/email/markup.ts`.
  Les brouillons v1 migrés peuvent encore contenir du HTML (`looksLikeHtml`).
- **L'éditeur de texte cache les signes et montre leur effet** (2026-09-16) :
  `RichTextField.tsx` (contenteditable) + `src/lib/email/markup.ts` (markup ⇄
  document « texte + un attribut par caractère »). Un texte collé avec ses
  signes arrive déjà mis en forme, signes cachés. **Le modèle ne change pas** :
  le bloc stocke toujours du markup, jamais du HTML saisi par le pro — c'est
  `serializeMarkup` qui remonte au bloc à chaque frappe, et le champ est
  redessiné depuis le markup SÉRIALISÉ (l'écran ne peut donc pas montrer une
  mise en forme que l'email ne rendrait pas). L'analyseur doit rester le miroir
  des PASSES successives d'`inlineMarkup`, pas une descente récursive : c'est ce
  qui fait que `***x***` est gras + italique des deux côtés. Pendant la frappe on
  ne redessine jamais (le curseur sauterait) ; la barre d'outils renormalise.
  **Le collage garde la mise en forme** (2026-09-17) : le `text/html` du
  presse-papier est relu par le MÊME `scan()` que le champ (`DOMParser`, hors
  document vivant, `script`/`style`/`head` jetés, blancs du source repliés,
  titres → gras + taille, `pt` → `px`, et le `<b style="font-weight:normal">`
  dont Google Docs enveloppe tout son presse-papier ÉTEINT le gras au lieu de
  le poser), puis re-sérialisé en markup — le bloc ne stocke toujours que du
  markup, jamais du HTML venu d'ailleurs. Sans `text/html` (⇧⌘V), c'est
  l'analyseur de markup qui reprend, et un bouton « Coller en texte brut »
  apparaît sous le champ juste après un collage riche.
  **Une couleur importée qui ne se lit pas sur le fond du bloc est JETÉE**
  (contraste < 2:1, `dropUnreadableInk`) : copier depuis une page sombre posait
  sinon du texte blanc sur le blanc de l'email — présent dans le modèle,
  invisible chez le client. Et quand le bloc en porte déjà une (collage
  antérieur, couleur choisie à la main), une ligne « Rendre lisible » sous le
  champ la retire.
  **Le champ de saisie porte les couleurs de l'EMAIL, pas celles du panneau**
  (fond du bloc + encre par défaut) : c'est la seule façon de voir qu'un texte
  noir se lit sur le blanc de la campagne — et qu'un texte invisible dans
  l'email l'est aussi à l'écran.
  ⚠️ Une évolution de la syntaxe oblige à REDÉPLOYER `send-campaign` avant que
  le pro l'utilise, sinon les nouveaux signes partent en clair dans l'email.
- **Le Studio se mesure, il ne suppose pas `100vh`** (2026-09-17) : l'app
  organisateur pose son en-tête au-dessus de lui, donc un `height: 100vh` nu
  poussait son bas (barre « Nouvelle campagne » : nom, soirée, bouton) sous le
  pli. `useShellHeight` (`email-studio/ui.tsx`) additionne les `offsetTop` —
  stables au défilement, contrairement à `getBoundingClientRect()` — et rend
  `calc(100dvh - <offset>px)`. Tout écran plein du Studio passe par là.
- **L'encre par défaut d'un bloc suit SON fond** (2026-09-17, `defaultInkOn` /
  `solidBlockBg` dans `render.ts`, dupliqués dans le port Deno et miroités par
  `TextView`) : la couleur du thème tant qu'elle se lit sur le fond du bloc
  (contraste ≥ 3), sinon noir sur clair et blanc sur sombre. Un fond posé à la
  main renverse donc la règle du thème — un bloc blanc dans un thème sombre
  servait du texte blanc sur blanc. La couleur choisie par le pro gagne
  toujours.
- **⌘Z appartient au Studio, même en pleine frappe** (2026-09-17) : le champ de
  texte est un contenteditable qu'on redessine, la pile d'annulation du
  navigateur n'y survit pas — le raccourci n'est donc plus ignoré quand le
  focus est dans un champ (`StudioShell`). Et l'historique FUSIONNE les
  modifications successives d'un même champ dans une fenêtre de 700 ms
  (`MERGE_MS`, `store.ts`) : sans ça une frappe = un état, ⌘Z rendait une
  lettre à la fois et les 40 places de l'historique partaient en une phrase.
- **Marges par bloc = `TYPE_PAD_DEFAULTS`** (types.ts, miroir edge) : défauts
  PAR TYPE (header 30/24, image 0/0, divider 10/24, cta 24/24, html 0/24…),
  `py: 0` est un choix légitime (blocs collés). Ne jamais recoder un padding
  en dur dans un renderer ou une vue canvas — tout passe par `blockPad`.
- **Personnalisation par bloc** : `CtaBlock.color` (hex) surclasse l'accent du
  thème, texte auto-contrasté via `ctaColors()`/`contrastText()` (dupliqués
  edge) ; `ImageBlock.radius` (coins, borné 40) ; `CountdownBlock.targetAt`
  (ISO UTC, saisi en datetime-local et converti — l'événement live prime) ;
  `TextBlock.color`, `SocialBlock.color` (icônes — URL simpleicons assainie
  par `iconHex`, jamais de non-hex dans l'URL), `DividerBlock.color`,
  `accent` sur les 4 blocs Yuno, et `BlockBase.bgc` (fond hex custom, prime
  sur `bg` ; le social autonome respecte bg/bgc au lieu de forcer la carte).
  Inspecteur : composant `ThemedColor` (persiste seulement si ≠ thème).
- **Rapport de campagne** (`CampaignReport.tsx`) : l'onglet Design route sur
  `blocks_version` (v2 = `renderEmailHtml` + `useStudioLiveData`, JAMAIS le
  renderer v1) ; carte A/B via la RPC `get_campaign_ab_stats` (garde
  d'ownership identique à `get_campaign_send_progress`) ; top des liens
  cliqués agrégé depuis `email_campaign_events.metadata.click.link` (payload
  Resend), référence `yc=` retirée à l'affichage.
- **Bloc Réseaux = pastilles avec logos PNG AUTO-HÉBERGÉS** (2026-08-31
  soir). Les SVG de cdn.simpleicons.org étaient bloqués par Gmail et
  invisibles dès que le CDN ne répondait pas (il résout vers la plage
  Cloudflare 188.114.96.x, sujette aux trous de routage FAI). Les vrais
  logos vivent en PNG transparents 64px dans `public/email-social/`
  (`{instagram,tiktok,facebook,x,website}-{w,d}.png`, générés depuis
  simple-icons via AppKit/Swift — recette dans le commit 2731708).
  `renderSocial` rend une pastille ronde couleur `SocialBlock.color`
  (sinon muted) avec le glyphe auto-contrasté (`socialChip`) ; alt =
  `socialLabel` (domaine pour le site). Emails : URL absolue
  `${baseUrl}/email-social/…` ; canvas : chemin relatif. Ne JAMAIS
  réintroduire d'images tierces dans les emails.
- **Réseaux au pied de page = OPTIONNELS et VISIBLES au canvas** (2026-09-01).
  Le pied de page portait les pastilles dès qu'un lien était renseigné, sans
  jamais les montrer dans l'aperçu Canvas : un bloc « Réseaux » posé dans le
  corps les affichait donc DEUX fois, invisible jusqu'à la réception. Le
  drapeau vit dans le thème (`EmailTheme.footerSocial`, absent = affichés) —
  il suit donc le thème club sauvegardé et survit à un changement de preset
  (`applyThemePreset` le préserve). Le Canvas rend la rangée exactement comme
  `renderSocial(standalone=false)`, et la checklist pré-envoi lève
  `social_duplicate` quand bloc + pied de page coexistent. Quand la rangée de
  réseaux est là, c'est ELLE qui porte le trait de séparation du footer
  (`footerBorder`), plus le texte légal.
- **Le pied de page est SÉLECTIONNABLE mais n'est pas un bloc** (2026-09-01).
  `FOOTER_SELECTION_ID` (`meta.ts`) est un id sentinelle : le Canvas et
  l'onglet Structure le sélectionnent, l'Inspecteur route vers `FooterFields`
  (réseaux + couleurs de bande) AVANT la recherche dans `campaign.blocks`. Il
  n'a ni duplication, ni suppression, ni déplacement, et n'entre jamais dans
  `campaign.blocks` — ne pas le transformer en vrai bloc. **Les mentions
  légales (identité de l'expéditeur, raison de réception, copyright, lien de
  désinscription) sont AFFICHÉES en lecture seule et ne doivent jamais devenir
  éditables** : elles sont écrites par `renderFooter` et par personne d'autre
  (RGPD / CAN-SPAM). Toute nouvelle option de footer se branche sur le thème
  et se règle dans `FooterFields`, pas dans l'onglet Thème (qui ne garde que
  les couleurs).
- **Footer : pas de border-top sur footer sombre** — le trait
  `theme.divider` clair ne se dessine que si `contrastText(footerBg)`
  est foncé (footer clair). Sinon il traçait une ligne blanche entre un
  contenu sombre et le footer noir (email + aperçu Canvas).
- **Règles de visibilité par bloc** (`cond`: vip_table / no_vip_table / buyers /
  no_buyers / new_subscribers, carte « Qui voit ce bloc » de l'inspecteur) :
  résolues À L'ENVOI par lot via la RPC `get_recipient_block_conds`
  (fail-closed — RPC en échec ⇒ blocs conditionnels masqués). Les formes
  `no_*` sont le COMPLÉMENT exact sur le lot demandé (2026-09-16) : « le bloc
  Table VIP pour ceux qui en ont pris une, le bloc Liste invités pour les
  autres » = deux blocs, `vip_table` + `no_vip_table`. Les envois de TEST
  rendent tout (`ignoreConds`).
- **L'heure de Paris se lit par `formatToParts`, jamais par `Number(format())`**
  (2026-09-10) : en `fr-FR`, `format()` rend « 23 h » → NaN → aucune heure
  calme détectée, la campagne envoyait à 1 h du matin. Copier `parisHour()`
  de `send-campaign` (`en-GB`, `formatToParts`, 24 → 0), comme
  `isQuietHoursParis` des push.
- **Quiet hours (23 h → 9 h Paris) et throttling par heure glissante** sont
  des portes de sortie propres de `drainSlice` (comme le quota) : le cron
  reprend, ce ne sont jamais des échecs. Fenêtre A/B par défaut : 4 h.
- **Modèles d'email** (2026-09-01) — `email_campaign_templates` (portée club OU
  organisateur, même RLS qu'`email_campaigns`) + `src/lib/email/templates.ts`.
  Un modèle enregistre le DESIGN (blocs, thème, objet, pré-en-tête, réseaux) et
  **JAMAIS une soirée** : `stripEventBindings` efface l'`eventId` des blocs
  Yuno, l'`coverUrl`/`ctaUrl` figés d'une carte événement et le `targetAt` d'un
  compte à rebours. La soirée est choisie à la CRÉATION de la campagne
  (`email_campaigns.event_id`) et l'edge relie les blocs sans eventId propre à
  cet événement (`fetchStudioLiveData`) — c'est ce qui rend un modèle rejouable
  sur toutes les soirées avec les vrais tarifs. Ne jamais figer une soirée dans
  un modèle, ni y stocker l'audience ou la planification (reprises à chaque
  envoi). Les ids de blocs sont regénérés à la réutilisation
  (`templateToCampaignContent`) : deux campagnes issues du même modèle ne
  partagent aucun id. Les départs rapides Yuno sont des CONSTRUCTIONS i18n
  (`src/lib/email/starters.ts`), pas des lignes en base : rien à semer.
  L'écran « Nouvelle campagne » (`TemplateGallery`) est désormais la porte des
  DEUX portées — `/owner/campaigns/new` et `/organizer-app/campaigns/new` ne
  créent plus de brouillon en douce, c'est la galerie qui insère la ligne.
  Garde-fou : la checklist pré-envoi lève `event_link` quand des blocs Yuno
  restent sans soirée (un bloc Billetterie retomberait sur ses lignes d'exemple
  et enverrait des tarifs inventés).
- **Supprimer une campagne = brouillon uniquement** (2026-09-01). Le trigger
  `guard_email_campaign_delete` (`BEFORE DELETE`, **SECURITY INVOKER** — un
  trigger de garde SECURITY DEFINER se désactiverait lui-même) refuse toute
  suppression de campagne non-`draft` venant d'un client `authenticated`. Il
  discrimine sur `current_user`, donc les cascades serveur passent : la
  décommission d'un club (`DELETE FROM venues`, cron postgres) et la
  suppression de compte (edge `delete-account`, service_role) doivent pouvoir
  purger cette table. Une campagne partie garde ses destinataires, ses
  statistiques et son revenu attribué — `email_campaign_recipients` et
  `email_campaign_events` sont en CASCADE, la suppression serait irréversible.
  `email_suppressions.campaign_id` est en SET NULL : supprimer une campagne ne
  ressuscite jamais un désabonné.
- **Les boutons des blocs Yuno partent sur les LIENS SUIVIS** (2026-09-05).
  `resolve_campaign_tracked_links(event_ids, channel)` (SECURITY DEFINER,
  `service_role` seul) rend par soirée le `/l/<code>` du canal — « newsletter »
  par défaut — pour l'événement ET pour la part de guest list publique, en
  semant les canaux au passage. `fetchStudioLiveData` remplit alors
  `live.trackedUrl` / `live.entryTrackedUrl` ; les blocs event / table / tickets
  s'en servent, la liste invités SEULE prenant le lien de la PART (le formulaire
  s'ouvre avec son token et son `tl=`, seule façon d'alimenter la ligne du canal
  — `yc=` ne pose JAMAIS de `tl=`). Trois invariants : (1) l'ordre de la part
  publique doit rester identique entre `pickPublicGuestList` et la RPC, sinon le
  bouton ouvre une autre liste que celle annoncée ; (2) le canvas et les envois
  de TEST passent `trackedChannel = null` — un aperçu cliqué gonflerait les
  compteurs du pro ; (3) l'échec de résolution retombe sur l'URL nue, il ne fait
  jamais rater un envoi.
- `email-editor/` et `src/lib/emailCampaign.ts` ne servent PLUS qu'aux
  templates transactionnels admin (`AdminEmailTemplates`) — ne pas les
  utiliser pour les campagnes.

## Automatisations email — neuf recettes, audiences automatiques, suggestions (2026-09-15)

Doc complète : `docs/designs/EMAIL_AUTOMATION_PLAN.md` (analyse marché + doctrine)
et `docs/designs/EMAIL_AUTOMATION_V2_BRIEF.md` (v2). Migrations `20260915120000`
(v1), `20260915160000` → `163000` (v2), module `_shared/email-automations.ts`, page
`/owner/campaigns/automations` et `/organizer-app/campaigns/automations`
(`EmailAutomationsPanel`, partagé). Règles intouchables :

- **Une recette = une ligne `email_automations` (portée, kind)** : `new_event`,
  `abandoned_checkout`, `tier_closing`, `last_call`, `table_upsell`,
  `post_event_thanks`, `post_event_missed`, `welcome`, `win_back`. Interrupteur,
  `delay_hours` (sens selon la recette : après la publication / l'inscription /
  le checkout, AVANT le début, après la fin, sans venue), `threshold_pct`
  (75/85/95, `tier_closing` seulement : un seuil, pas un délai, `meta.noDelay`),
  `template_id` (Email Studio), `subject`.
- **`events.status` vaut `active | cancelled | postponed`, JAMAIS
  `published`/`featured`** (c'est le vocabulaire d'`affiliate_events`). Le moteur
  v1 filtrait sur le mauvais et ne trouvait aucune soirée ; toute requête sur les
  soirées d'une recette filtre `status = 'active' AND is_active AND cancelled_at
  IS NULL`.
- **Le pro ne choisit JAMAIS l'audience d'une recette.** Source = registre de
  consentement de la portée (achats, guest list, formulaire, suivi, fichiers
  importés — `new_event`, `last_call`, `win_back` prennent les imports ; `welcome`
  les exclut ; les autres partent d'un fait). Exclusions au moment dû (CASE
  `judged0`), puis **priorité par engagement** avant `LIMIT`
  (`_email_engagement_rank` : 0 a ouvert/cliqué 90 j, 1 venu 180 j, 2 inscrit
  30 j, 3 le reste) dans les branches « à toute la base ». La ligne « Yuno
  cible : … » (`em.auto.kind.<kind>.target`) et le compteur d'éligibles
  (`preview_email_automation`, compter jamais lister) l'expliquent.
- **Cooldown INTRA-passage** (`judged`, `row_number` par contact) : plusieurs
  soirées dues en même temps pour un même contact ne font qu'UN email, la plus
  proche (`_auto_cand.ord`), les autres tracées `cooldown`. Les recettes sont
  parcourues par PRIORITÉ (`abandoned_checkout`, `tier_closing`, merci, on t'a
  manqué, `table_upsell`, `last_call`, `new_event`, `welcome`, `win_back`), le
  pro avant Yuno. Les deux recettes URGENTES (panier, tarif) sont exemptées du
  cooldown et ont le palier de pression 2/24 h · 5/7 j.
- **`new_event`** part de `events.published_at` (jamais `created_at`, jamais une
  re-génération de modèle récurrent, soirée publique sans code d'accès à plus de
  48 h qui vend quelque chose). Rafale : dates publiées à moins de 24 h les unes
  des autres → une seule annonce (la plus proche), les autres `already_event`,
  définitivement. **`table_upsell`** exige `_event_tables_left(e) > 0` (même
  calcul que le bloc Table VIP : formules actives moins réservations, formules
  marquées complètes exclues) et écarte `has_table` (réservée ou en cours).
  **`tier_closing`** = palier ouvert ≥ `threshold_pct`, ≥ 1 billet restant, un
  palier suivant plus cher ; cible = clic sur la soirée dans un email de la
  portée ou `event_waitlist`. Aucune des trois n'existe en portée plateforme.
- **Suggestions** : `get_email_automation_suggestions` (faits 30 j, démo exclue,
  recettes éteintes seulement) → bandeau Automatisations, carte Campagnes
  (`AutomationSuggestions`, `turnOnAutomation` partagé), notification
  `automation_suggested` une fois par recette et par mois
  (`email_automation_suggestions_sweep`, cron 08:15 UTC, `dedup_key` — ajouté
  à `organizer_notifications` avec `emit_organizer_notification`). Jamais de push.
- **Traçabilité** : `get_email_automation_stats(portée, p_days)` (fenêtre 7 j =
  « cette semaine », `in_flight`), `get_customer_automation_emails` (fiche client
  CRM), `email_automation_weekly_digest` (ligne « automatisations : X emails,
  Y ventes » du push `audience_weekly_recap`, variante `with_automations`). **Sans modèle, rien ne part** ; le
  front crée le modèle Yuno (`buildStarter('auto_<kind>')`) en allumant.
  `enabled_at` borne les déclencheurs : une bienvenue ne part jamais à toute
  la base existante le jour où on allume.
- **Le registre `email_automation_sends` est la garantie** : unique
  (automation, `trigger_key`, email) — `trigger_key` = id de soirée, `once`
  (bienvenue) ou `wb-YYYY-MM` (reconquête) — raison d'exclusion écrite,
  évaluée AU MOMENT où l'envoi est dû. Toute nouvelle exclusion se pose dans
  le CASE de `collect_email_automations()`, jamais dans le Deno. Ne jamais
  vider le registre.
- **Au plus UNE automatisation par contact et par 48 h par portée**
  (`cooldown`), le panier abandonné et le tarif qui monte exceptés. Rien n'écrit hors du registre
  de consentement : le panier abandonné VERSE d'abord dans
  `newsletter_subscriptions` l'accord coché au checkout (`source =
  'checkout_started'`, même arbitre partiel que le trigger d'achat), puis lit
  le registre comme tout le monde.
- **Campagnes enfants** : `email_campaigns.automation_id` + `child_kind =
  'automation'`, une par (recette, soirée reliée, déclencheur), `quiet_hours
  = true`, `status = 'sending'` remplie contact par contact, drainée par
  `sweepSendingCampaigns`. **Les listes Campagnes les excluent**
  (`.is('automation_id', null)`) ; `notifyOwnerIfFinished` les ignore. Un
  enfant sans soirée reliée perd ses blocs Yuno
  (`_email_blocks_without_live`) : jamais de tarifs d'exemple à un client.
  Les recettes d'après-soirée, de bienvenue et de reconquête se relient à la
  PROCHAINE soirée publiée (`_email_automation_next_event`).
- **« Merci » et « On t'a manqué » exigent un scan** (`entry_scanned`, `used`,
  `checked_in_at`) : une soirée sans aucun scan ne déclenche rien. Quand la
  recette `post_event_missed` est allumée, `send-missed-you` (version Yuno
  historique) saute la portée.
- **Renvoi aux non-ouvreurs** = option de campagne (`resend_enabled`,
  `resend_delay_hours` 12-168, `resend_subject`, `resend_campaign_id`,
  `resend_done_at`), `collect_campaign_resends()` : enfant `child_kind =
  'resend'` copié de la mère, destinataires `sent` sans événement
  opened/clicked, ni supprimés, ni désabonnés, ni acheteurs/inscrits de la
  soirée ; évalué une seule fois (`resend_done_at`). `collect_campaign_followups`
  lit les clics de la mère ET du renvoi. Un enfant ne se renvoie jamais.
- **Test d'une recette** : `send-campaign` accepte `send_test + automation_id
  (+ event_id)` sans `campaign_id` — même builder, même expéditeur.
- Rapports : `get_email_automation_stats` (page), `get_campaign_resend_stats`
  (rapport de la mère), `get_email_send_time_insights` (écran Planification,
  ouvertures 120 j par heure/jour Paris, muet sous 30 ouvertures). Le revenu
  attribué des enfants vient de `get_email_campaign_attribution` (ids dans
  `campaign_ids`), jamais recalculé.
- Assistant owner : `list_email_automations` (lecture : recettes, qui Yuno
  cible, suggestions) et `set_email_automation` (écriture, confirmation :
  interrupteur, délai, seuil) ; il ne crée pas de modèle.

## Politique d'envoi Yuno — les règles qu'aucun expéditeur ne désactive (2026-09-15)

Migration `20260915140000_email_send_policy.sql`, miroir Deno
`_shared/email-policy.ts`. Une adresse vit dans la base de plusieurs clubs, d'un
organisateur et de Yuno ; la réputation d'envoi est partagée. D'où UNE politique
SQL, constante, appliquée à tout le marketing, jamais au transactionnel :

- **`email_send_policy(email, kind)` est la porte unique** : NULL = permis,
  sinon `suppressed` / `pressure_24h` / `pressure_7d` / `fatigue` / `averse`.
  Paliers : automatisation 1/24 h · 3/7 j ; urgent (`abandoned_checkout`,
  `upsell`) 2/24 h · 5/7 j ; campagne (`campaign`, `resend`) 3/24 h · 8/7 j.
  Fatigue = 8 envois marketing en 90 j sans `opened`/`clicked` ; aversion =
  2 `opted_out_at` en 30 j (automatisations seulement). Elle lit
  `email_campaign_recipients` (status `sent`, campagnes `promotional`) ET
  `marketing_email_log`, le journal des emails marketing hors campagne.
- **Où elle s'applique** : `enqueue_campaign_recipients` (campagnes
  manuelles : écartés en `status = 'skipped'`, `error_message = 'policy:…'`,
  comptés dans `policy_skipped_count`, affichés « protégés par les règles
  Yuno » dans le rapport), `collect_email_automations` (CASE `judged`),
  `collect_campaign_resends`, et les emails Yuno historiques via
  `emailSendPolicy()` + `logMarketingEmail()`. Un email de service
  (`type = 'informational'`) n'est jamais filtré par la pression.
- **R5 « une soirée, un message »** : index unique
  `(kind, trigger_event_id, lower(email))` sur les lignes `queued` de
  `email_automation_sends`, tous expéditeurs ; le moteur traite les pros
  avant Yuno (`ORDER BY is_platform`). `email_automation_covers_event(event,
  kind)` dit si une recette (club, orga ou Yuno) couvre une soirée : les
  emails historiques de Yuno s'effacent alors.
- **Portée plateforme des recettes** : `email_automations` accepte les deux
  colonnes à NULL (super admin, `/admin/marketing/automations`,
  `PLATFORM_AUTOMATION_KINDS` — pas de `last_call` pour Yuno). Candidats lus
  dans le registre plateforme seul, démo exclue, sans « prochaine soirée » ni
  blocs live. Modèles Yuno édités dans `/admin/marketing/email/templates/:id`.
- **Emails automatiques Yuno → clients, état 2026-09-15** : conservés
  `send-missed-you` (mercredi) et `send-next-event-recommendation` (quotidien,
  1/semaine/personne), gatés dans `/admin/notifications` (`email_missed_you`,
  `email_next_event_rec`), policés et journalisés. **Retirés** :
  `send-event-recap` (« ta soirée en chiffres ») et `send-upsell-email`
  (redondant avec la section boissons de la confirmation) — fonctions,
  crons et builders supprimés ; ne pas les ressusciter, le « merci d'être
  venu » est une recette. Tout email client passe par `email-kit.ts`
  (DESIGN_SYSTEM_PUBLIC) ; `wrapEmailWithBranding` ne sert plus à aucun
  email client (statuts VIP, récap walk-in, liste d'attente et alerte 2FA
  ont leur builder). `send-test-email` action `preview` envoie chaque
  builder avec des données mock au fondateur.

## Envoi de masse email (2026-08-29)

Doc complète + runbook DNS : `docs/EMAIL_DELIVERABILITY.md`. Les règles
intouchables :

- **`send-campaign` est un worker de file, pas une boucle.** Il constitue la
  file (`enqueue_campaign_recipients`), draine ~45 s, puis s'auto-chaîne ; le
  cron `process-scheduled-campaigns` rattrape via `sweepSendingCampaigns()`.
  Ne JAMAIS revenir à un envoi en une passe : à 3 000 adresses la fonction
  dépassait le wall-clock et laissait la campagne à moitié partie.
- **Deux garde-fous anti-doublon, les deux nécessaires** : `FOR UPDATE SKIP
  LOCKED` dans `claim_campaign_recipients` (deux workers concurrents) ET la clé
  d'idempotence Resend (worker tué entre l'appel HTTP et le marquage). Retirer
  l'un des deux réintroduit un doublon.
- **Marquage EN LOT obligatoire.** Un UPDATE par destinataire, c'est ce qui
  faisait exploser le temps d'exécution. Passer par
  `mark_campaign_recipients_sent/failed`.
- **Le disjoncteur est la sécurité de la plateforme**, pas un confort :
  > 0,2 % de plaintes ou > 5 % de bounces (échantillon ≥ 200) met la campagne en
  pause. Il est appelé DANS la boucle et DANS `resend-webhook` — les signaux
  arrivent en différé, c'est le webhook qui compte vraiment.
- **La liste de suppression (`email_suppressions`) est globale et ne filtre QUE
  le marketing.** Un hard bounce ou une plainte y entre même sans
  `campaign_id` (donc depuis un transactionnel), et coupe `opted_in`. Un billet
  de confirmation part toujours, même vers une adresse supprimée.
- **Le plafond plateforme doit refléter le PLAN RESEND.** Semé à 90/jour (plan
  gratuit), passé à **25 000/jour le 2026-09-01** avec la souscription du plan
  Pro (migration `20260901160000`). Ce chiffre est un garde-fou
  anti-emballement, PAS un objectif d'envoi. Dépasser le plan ne ralentit pas
  l'envoi : Resend renvoie des 429, les destinataires épuisent leurs tentatives
  et finissent en `failed` — on PERD des gens.
- **Quota MENSUEL (2026-09-01, migrations `20260901190000`+`191000`)** : pool
  marketing plateforme 40 000/mois (le plan Pro fait 50 000, la réserve
  transactionnelle de 10 000 existe PAR CONSTRUCTION — le marketing est plafonné
  en dessous du plan, les 33 fonctions transactionnelles ne sont pas comptées),
  15 000 offerts par compte, crédits au-delà via `email_packs` (10 €/10 000,
  24 €/25 000 — PRIX COÛTANT : overage Resend 0,90 $/1 000 + frais Stripe,
  aucune marge, décision produit). `email_sender_state.credit_balance` est le
  solde ; formule d'autorisation `GREATEST(0, gratuit − envoyés) + crédits`
  (JAMAIS `gratuit + crédits − envoyés` : les crédits consommés seraient
  comptés deux fois, bug corrigé en `191000`). Le front ne recalcule jamais un
  reste — `remaining` vient du serveur. Achat via l'edge `email-credits`
  (checkout+verify en UNE fonction, idempotence portée par l'index unique sur
  la session Stripe). Quota atteint = la campagne ATTEND (comme le plafond
  journalier), rien n'échoue. `resend-webhook` compte le transactionnel réel
  dans `email_send_quota_month` scope `transactional` (observabilité).
- **Warm-up non contournable côté client** : `email_sender_daily_cap()`
  (300 → 25 000 sur 6 jours) + plafond plateforme. Les quotas se consomment via
  `consume_email_send_quota` (service_role only) ; un plafond atteint met la
  campagne en attente du lendemain, ce n'est PAS un échec.
- **Marketing et transactionnel doivent vivre sur des domaines séparés.**
  `EMAIL_MARKETING_DOMAIN` (ex. `news.yunoapp.eu`) n'est lu que s'il est défini,
  fallback sur `EMAIL_DOMAIN` : le poser avant la vérification Resend ferait
  échouer 100 % des envois.
- **Import de liste** (`import_email_contacts`) : attestation de consentement
  obligatoire et horodatée, jamais de réactivation d'un désabonné explicite.
  **Autorisé en session support depuis le 2026-09-15 — décision de lancement,
  à REFERMER ensuite** (migration `20260915170000`) : les premiers testeurs
  sont méfiants et pressés, le support remplit le fichier pour eux dans la
  session qu'ils ont approuvée. Aucune règle de consentement ne bouge ;
  seulement la porte de saisie. Comme `auth.uid()` est alors le PRO, la ligne
  d'import dirait qu'il a attesté lui-même : d'où `attested_via_support` sur
  les trois tables d'import (`email_list_imports`, `sms_list_imports`,
  `contact_list_imports`) et le trigger `log_support_session_write`, qui nomme
  l'admin réel dans `admin_support_audit`.
- **Envoyer une campagne en session support : AUTORISÉ depuis le 2026-09-17**
  (migration `20260917120000`, même décision de lancement, **à REFERMER
  ensuite**). Les premiers clients ne veulent pas encore toucher à l'outil, et
  une campagne que personne n'envoie ne prouve rien. Le support appuie sur
  « envoyer » à leur place, dans la session qu'ils ont approuvée. Aucune règle
  d'envoi ne bouge : consentement, `email_send_policy`, disjoncteur
  plaintes/bounces, warm-up et quotas s'appliquent à l'identique. Traces :
  `email_campaigns.sent_via_support` (posé par `send-campaign` au moment où la
  file est constituée) et une ligne `admin_support_audit` d'action
  `campaign_send` qui nomme l'admin réel — sans elle le rapport dirait que le
  pro a envoyé lui-même, la session étant la sienne. **Pas de trigger d'audit
  sur `email_campaigns`** : l'Email Studio enregistre à chaque frappe, un
  AFTER UPDATE noierait le journal sous les autosaves — c'est l'edge qui écrit
  la ligne, une fois. `supportSessionFor()` (`_shared/support-session.ts`) rend
  la session entière ; `isSupportSessionToken()` n'en est plus qu'un raccourci
  booléen, pour les fonctions qui refusent toujours.
- **Une campagne refusée reste en `sending` avec une file vide, et le cron ne
  la rattrape PAS.** C'est ce qu'a produit le refus support du 17/09 : l'éditeur
  passe la campagne en `sending` AVANT d'appeler l'edge, seul le mode `send`
  appelle `enqueue_campaign_recipients`, et le balayage ne connaît que le mode
  `drain`. Résultat : « Envoi en cours, 0/0 » pendant une heure, puis `failed`
  avec un `sent_at` posé sur une campagne qui n'a jamais eu un destinataire.
  Toute nouvelle porte de sortie ajoutée au mode `send` doit donc soit rendre
  la campagne à `draft`, soit être posée AVANT que le front change le statut.
- **Purge d'une liste importée = repoussoir d'abord, destruction ensuite**
  (`purge_email_list`, migration `20260909130000`). La ligne désabonnée de
  `newsletter_subscriptions` EST la mémoire du refus (le DO UPDATE de l'import
  ne la réactive jamais) : la détruire sans trace réabonnerait la personne au
  prochain import du même fichier. La purge verse donc chaque adresse dans
  `email_opt_outs` (par portée, aucune policy RLS) avant de supprimer, et
  `import_email_contacts` consulte ce repoussoir. **Ne JAMAIS vider
  `email_opt_outs`**, ne jamais y poser de policy d'écriture. L'export d'une
  liste (`export_email_list`) ne rend que les actifs. Purge et export refusent
  la session support.
- **Relance après clic = registre d'abord, jamais d'envoi direct** (migration
  `20260910100000`). `collect_campaign_followups()` (cron 5 min) écrit
  `email_campaign_followups` — une ligne par (campagne mère, email), raison
  d'exclusion évaluée au moment où la relance est DUE, index unique (soirée,
  email) sur les lignes en file — puis remplit la file d'une campagne ENFANT
  (`parent_campaign_id`) montée depuis le modèle du pro. Toute nouvelle
  exclusion se pose dans le CASE de cette RPC, pas dans le worker ; ne jamais
  vider le registre (c'est lui qui interdit la double relance) ; ne jamais
  résoudre une audience pour un enfant (sa file est remplie contact par
  contact). Le worker ne notifie pas l'owner pour un enfant.
- **Chaque fichier importé reste un segment d'audience.** La séparation vit
  dans `newsletter_subscriptions.import_id` (→ `email_list_imports`), exposée
  par le kind d'audience v2 `{"kind":"import","importId":"<uuid>"}` dans
  `resolve_campaign_audience` — **les deux portées, club ET organisateur**
  (c'est le seul ciblage fin d'un organisateur, `venue_segments` étant
  venue-only). Comparaison en TEXTE, jamais un cast uuid : un importId
  malformé ne matche rien au lieu de casser toute la résolution. Le miroir
  hérité `audience_type = 'imported_list'` n'a AUCUN chemin v1 : audiences_json
  vide ⇒ la campagne ne part à personne, jamais à toute la base.
  Le pro **nomme sa liste au moment de l'import** (`list_name`, lu au 1er lot) ;
  `filename` n'est jamais réécrit, c'est une pièce du dossier de consentement.
  Ajouter un paramètre à `import_email_contacts` = **DROP + CREATE**, jamais
  `CREATE OR REPLACE` : une surcharge rendrait ambigu l'appel à 8 arguments
  nommés des bundles en cache (erreur 300). Renommage après coup via
  `rename_email_list_import` (la table n'a AUCUNE policy d'écriture) ; un nom
  vide remet à NULL et réaffiche le nom de fichier.
- **Le front ne décide plus du statut d'une campagne.** `sendNow` ne force plus
  `status='failed'` en cas d'erreur réseau : l'envoi est asynchrone, il continue
  côté serveur. Le serveur est seul maître du statut.

## Meta — Pixel + Conversions API (phase 1 livrée 2026-09-14)

Doc complète : `docs/designs/META_ADS_INTEGRATION_PLAN.md`. Règles intouchables :

- **Une connexion par portée** (`meta_connections`, migration `20260914120000`) :
  club (`venue_id`), organisateur (`organizer_user_id`) ou plateforme (les deux
  NULL = le pixel de Yuno, réglé dans `/admin/system`). Même patron « au plus une
  portée » que le marketing plateforme. Le jeton Conversions API vit dans le
  Vault (`store_meta_capi_token` / `get_meta_capi_token`, service_role seul) et
  **ne ressort jamais** : le front n'a que `token_hint`. Owner ou orga lui-même,
  jamais un manager ; trigger `block_support_session_write` sur la table.
- **Pixel ET envoi serveur gatés sur la catégorie `marketing` du CMP**
  (`src/lib/consent.ts`, version 2). Le consentement voyage dans le corps des
  `create-*` (`meta`, injecté par `invokeEdgeFunction` pour les trois checkouts,
  explicite pour la guest list) puis dans les métadonnées Stripe `meta_*`, et
  il est relu dans les `verify-*`. **Natif = jamais de consentement pub** tant
  qu'un consentement in-app n'existe pas (phase 2). Ne jamais gater l'attribution
  promoteur/affilié là-dessus.
- **La preuve avant l'envoi** : `enqueueMetaEvent` (`_shared/meta-capi.ts`)
  écrit `meta_consent_log` pour CHAQUE commande (accepté ou refusé) puis ne met
  en file que si consentement. Responsabilité conjointe art. 26 RGPD : c'est ce
  journal que le pro montre à la CNIL.
- **Purchase = une seule fois, sous la transition atomique** `pending→paid` des
  trois `verify-*` (jamais dans `stripe-webhook`, jamais dans `create-*`).
  `event_id` déterministe (`ticket:<id>`, `table:<id>`, `order:<id>`, `gl:<id>`),
  identique au `eventID` du pixel navigateur des pages `Verify*Payment` : Meta
  dédoublonne sous 48 h. Guest list et table `on_site` = `Lead`, jamais
  `Purchase`. Valeur d'une table = `total_price` (l'engagement), pas l'acompte.
- **Une requête CAPI par événement**, `event_time` en secondes, refusé au-delà
  de 6 jours, données personnelles normalisées puis SHA-256, jamais
  `client_ip_address` / `client_user_agent` / `fbp` / `fbc` hachés. Le drainer
  (`drainMetaOutbox`) tourne en fire-and-forget après la vente
  (`EdgeRuntime.waitUntil`) ET dans `process-scheduled-campaigns` ; réclamation
  par `claim_meta_capi_outbox` (SKIP LOCKED). Code 190 = jeton invalide →
  `status = 'token_invalid'`, alerte `admin_meta_token_invalid` (dedup) + notif
  owner/orga `meta_token_invalid`. Le module ne lève jamais vers une vente.
- **Front** : `src/lib/metaPixel.ts` (chargeur unique, `trackSingle` par pixel,
  révocation + purge `_fbp`/`_fbc`, `fbclid` gardé en mémoire jusqu'au
  consentement), `useMetaPixel` (RPC publique `get_public_meta_pixels`, ids
  seulement), `useMetaCheckoutPixel`, `useMetaPurchasePixel`. Jamais en natif,
  jamais en app Pro, jamais sur une surface pro (`isProPath`). CSP :
  `connect.facebook.net` (script), `www.facebook.com` (img/connect).
- **Mode test** : `test_event_code` sur la connexion, 7 jours max, purgé par
  `meta_capi_housekeeping`. `checkMetaToken` ne refuse qu'un 190 (un jeton
  Events Manager n'a pas toujours le droit de LIRE le dataset mais écrit).
- **Connexion en un clic (phase 2, Facebook Login for Business)** :
  `meta-connect` porte `oauth_start` (state HMAC signé par `META_APP_SECRET`,
  15 min), `GET /oauth/callback` (échange du code, `discoverAssets` : jeton
  BISU non expirant si `client_business_id`, sinon jeton utilisateur échangé
  en longue durée 60 j avec `token_expires_at`), `select_assets` (statut
  `pending_assets` quand plusieurs pixels), `health` (`debug_token` +
  `dataset_quality`), `POST /data-deletion` et `/deauthorize` (`signed_request`
  vérifié, connexions effacées par `meta_user_id`, journal
  `meta_data_requests`). `verify_jwt = false` : chaque action POST vérifie le
  JWT elle-même. Secrets : `META_APP_ID`, `META_APP_SECRET`,
  `META_LOGIN_CONFIG_ID` (sans eux → `oauth_not_configured`, mode avancé
  seul). Tout appel Graph porte `appsecret_proof` (`_shared/meta-oauth.ts`).
  Mise en service pas à pas : `docs/META_GO_LIVE_GUIDE.md`.
- **Un pro sans profil Facebook ne peut PAS faire la connexion en un clic, et
  l'écran doit le dire.** Meta laisse ouvrir un compte professionnel depuis
  Instagram seul ; Facebook Login for Business authentifie un PROFIL
  Facebook, donc `facebook.com/dialog/oauth` sert à ces pros sa page de
  connexion Facebook (e-mail + mot de passe, « Créer un compte »), sans
  option Instagram. Vérifié en vrai le 2026-09-19 : ouvrir une session Meta
  Business Suite avec Instagram ne débloque rien, ce n'est pas un profil
  Facebook. Les deux seuls chemins, qui vivent dans le MODE D'EMPLOI
  (`ohelp.meta.s2b`, 3 langues) et dans `docs/META_GO_LIVE_GUIDE.md`, plus
  sur l'écran de connexion : (1) ajouter un compte Facebook PERSONNEL comme
  administrateur de l'entreprise depuis `business.facebook.com` → Paramètres
  → Personnes, où la connexion Instagram fonctionne — tout s'ouvre ensuite,
  publicités comprises. **Un compte Facebook est une PERSONNE (e-mail + mot
  de passe) ; une PAGE Facebook n'en est pas un** : elle n'a pas
  d'identifiants et ne peut rien autoriser. Business Suite propose de créer
  une Page dans le même écran de réglages, et c'est exactement le piège où
  le compte Amoris s'est arrêté le 19/09 ; (2) mode avancé, pixel + jeton
  collés. **Le jeton décide de ce qui s'ouvre,
  plus le mode de connexion** : `save` appelle `discoverAssets` et remplit
  `ad_account_id` / `page_id` / `ig_user_id` comme le ferait le retour OAuth,
  donc un jeton d'UTILISATEUR SYSTÈME (Business Manager → Paramètres →
  Utilisateurs → Utilisateurs système, actifs attribués, généré POUR L'APP
  YUNO) ouvre les publicités sans aucun Facebook Login. `ads_ready` ne teste
  plus `mode = 'oauth'` mais la présence du compte pub et de la Page
  (migration `20260919140000`). Le proof `appsecret_proof` est calculé avec le
  secret de Yuno : un jeton émis pour une AUTRE app est reconnu (découverte
  retentée sans proof) mais ne débloque pas les pubs — les crons signeraient
  leurs appels avec un proof faux — et le pro est invité à le régénérer en
  choisissant l'app Yuno (`integ.meta.tokenOtherApp`). **L'écran de
  connexion ne porte QUE l'autorisation elle-même** (2026-09-22, avant le
  dépôt d'App Review) : titre, ce que la fenêtre Meta va faire
  (`integ.meta.oauthHint`), le bouton bleu, la ligne qui dit ce que Yuno
  demande et ce qu'il ne demandera jamais — publication, messagerie —
  (`integ.meta.oauthAsks`), puis le mode avancé replié. Un raccourci vers
  Meta Business Suite y a vécu trois jours, en carte jumelle du bouton
  bleu : il ne connecte RIEN (il ouvre Meta ailleurs) et occupait la moitié
  d'un écran que l'App Review juge bouton par bouton. Ne pas le remettre ;
  le pro sans profil Facebook se renseigne par le mode d'emploi ou le
  support. Ne JAMAIS proposer
  « Business Login for Instagram » (`instagram.com/oauth/authorize`) comme
  troisième voie : ses scopes `instagram_business_*` couvrent messages et
  contenus, jamais `ads_management` ni le pixel.
- **Le dialogue Meta s'ouvre dans un AUTRE onglet**, ouvert vide dans le geste
  du clic puis envoyé sur l'URL signée (un `window.open` posé après l'`await`
  est bloqué par Safari). Le retour `?meta=…` atterrit donc dans cet
  onglet-là : il repasse le résultat par `localStorage` (`yuno:meta:oauth` —
  l'événement `storage` ne se déclenche que dans les AUTRES onglets) puis se
  ferme si son `opener` a survécu. Sans opener il reste ouvert et affiche le
  résultat lui-même ; l'onglet d'origine recharge au retour du focus.
- **`META_INTEGRATION_LIVE` (`src/lib/metaIntegration.ts`) = interrupteur
  pros.** À `false`, la carte Meta des clubs/orgas affiche « En construction »
  et le badge « Bientôt » ; la carte plateforme (`/admin/system`) reste active
  pour tester le bout en bout. Ne le passer à `true` qu'à la fin de la
  checklist du guide (App Review accordée, app en Live, parcours validé).
- **Publicité pilotée depuis Yuno (phases 3-4, migration `20260915100000`,
  `_shared/meta-ads.ts`, page `AdsPage`)** : `meta-campaigns` /
  `meta_audiences` / `meta_insights_daily` / `meta_leads`, RLS sans policy,
  lecture par `get_my_meta_ads`, écriture par les actions `campaign_*`,
  `audience_*`, `ads_*`, `leads_subscribe` de `meta-connect` (même fonction :
  le cap des fonctions interdit d'en créer une). Règles : tout est créé en
  PAUSED chez Meta, **`campaign_create` n'active JAMAIS** (le paramètre
  `launch` a été retiré le 19/09 : c'est la promesse faite à l'App Review), et
  l'activation est un clic du pro **confirmé** par une boîte de dialogue
  (`AdsPage`) ; `special_ad_categories`
  toujours envoyé, `dsa_beneficiary`/`dsa_payor` obligatoires (UE),
  `promoted_object.pixel_id` + `custom_event_type`, `advantage_audience`
  explicite ; **les ventes attribuées viennent du lien suivi `meta_ads`**
  (`meta_ads_ensure_tracked_link`, un par campagne, `utm_campaign` = id),
  jamais des chiffres Meta, qui sont copiés à part dans `meta_insights_daily`
  (cron, ≤ 1 lecture/h/campagne). **Une audience = contacts CONSENTANTS
  seulement** (`_resolve_meta_audience_rows` : opt-in newsletter non supprimé
  ∪ SMS < 36 mois, filtrés par activité), hachés côté edge, `usersreplace`
  par sessions de 10 000, resync nocturne ; jumeaux refusés sous 100
  personnes ; CGU audiences (`custom_audience_tos`) acceptées par un humain.
  Leads : webhook `POST /meta-connect/webhook` (signature sur les octets
  bruts, dedup `leadgen_id`, 200 immédiat) → `claim_meta_leads` (SKIP LOCKED)
  → `meta_lead_to_contact` (registre de consentement, jamais un désabonné,
  `consent_source = 'social'`). `bulk-notify-waitlist` a été supprimée le
  14/09 pour libérer le slot de `meta-connect` : ne pas la redéployer.
  **Créations multiples et modes d'audience (22/09, migration
  `20260922150000`)** : une campagne Yuno reste UN ensemble de pubs, mais
  porte de une à six créations (`meta_campaigns.creatives`, format `image`
  / `carousel` 2-10 images / `video` + couverture obligatoire) = autant de
  pubs dans le même ensemble (`meta_ads`) ; Meta répartit le budget entre
  elles, et la synchro horaire copie les résultats PAR PUB (`ad_insights`,
  insights `level=ad`). Médias dans le bucket public `ad-creatives`
  (`<auth.uid()>/…`, 50 Mo, H.264 vérifié côté client comme la vidéo de page
  soirée ; Meta va chercher image et vidéo par URL : `adimages` bytes,
  `advideos` `file_url` puis attente de `status.video_status = ready`).
  Sondé en vrai sur le compte Amoris : (1) depuis la v24, créer une
  campagne avec le budget sur l'ensemble EXIGE
  `is_adset_budget_sharing_enabled` (erreur 4834011 sinon) — c'est l'erreur
  qui bloquait « Create paused » ; (2) `advantage_audience: 1` REFUSE un âge
  max < 65 (1870189) et un âge min > 25 (1870188), et
  `individual_setting.age` est refusé pareil ; `advantage_audience: 0` +
  `individual_setting {custom_audience, lookalike, detailed_targeting,
  gender}` garde la tranche d'âge stricte en relâchant le reste. D'où les
  trois `audience_mode` (`relaxed` par défaut, `full`, `strict`) de
  `buildTargeting`, à ne pas réduire à un booléen. Ciblage étendu :
  `interests` (`search?type=adinterest`, `flexible_spec`), `locales`
  (`adlocale`), estimation `act/reachestimate` (-1 = Meta ne sait pas, pas
  une audience vide). L'assistant vit dans `src/components/ads/wizard/`.
  **Mode expert (22/09 soir, migration `20260922160000`)** = tout Ads
  Manager depuis Yuno, chaque forme sondée en vrai sur Amoris avant d'être
  écrite : `meta_campaigns.delivery` (événement de conversion PURCHASE /
  INITIATED_CHECKOUT / CONTENT_VIEW — LEAD exige OUTCOME_LEADS ; enchère
  COST_CAP / BID_CAP avec `bid_amount`, MIN_ROAS = `optimization_goal VALUE`
  + `bid_constraints` refusé aux entreprises non vérifiées 2446146 ; plages
  horaires = budget total + `pacing_type day_parting` + minutes à l'heure
  ronde ; Notoriété = REACH/IMPRESSIONS + `frequency_control_specs` ;
  `url_tags` sur la créa), ciblage (`location_types`, `excluded_geo_locations`,
  `zips` clé « FR:31000 », `custom_locations` — un point DANS une ville déjà
  choisie = 1487756 « conflicting location », pays + région du pays aussi ;
  `flexible_spec` par groupes avec la clé = `type` rendu par la recherche
  (`adTargetingCategory` class behaviors/demographics) ; les EXCLUSIONS de
  critères n'existent plus, 3858492 ; placements manuels sans `explore`,
  2490589), créa `instagram_post` (`object_id` Page + `source_instagram_media_id`),
  audiences à RÈGLE (`meta_audiences.kind` pixel_visitors / pixel_checkout /
  ig_engagers / ig_visitors / page_engagers, créées SANS `subtype` — la v26
  le refuse 1870053 —, pixel = CGU audiences #2663, Meta les remplit seul,
  `size_uploaded` = `approximate_count_upper_bound`), `campaign_update`
  (POST sur l'ensemble : budget, dates, ciblage, diffusion ; soirée, objectif
  et créations figés), `ad_set_status` (une pub), `insight_breakdowns`
  (age,gender / publisher_platform,platform_position). Interrupteur front
  `localStorage yuno:ads:expert` ; la recherche « Techno » en `fr_FR` rend
  d'abord « Technologie » : l'intérêt musical s'appelle « Techno (musique) ».
  **Créations v3 (22/09 nuit, migration `20260922170000` = faits de la soirée
  dans `get_my_meta_ads.events[]` : `venue_name`, `price_from`, `lineup`)** :
  une création porte un visuel feed ET, en option, une version verticale
  (`vertical_media`, même nature) — la créa part alors en `asset_feed_spec`
  avec `optimization_type PLACEMENT` et deux `asset_customization_rules`
  (stories + reels → vertical, le reste → feed), calculées sur les placements
  RÉELS de l'ensemble (une règle sur un placement absent est refusée) ;
  `enhancements` = `degrees_of_freedom_spec.creative_features_spec`
  (image_brightness_and_contrast, enhance_cta, text_improvements,
  image_templates, video_auto_crop) ; aperçus réels par `act/generatepreviews`
  (`ads_preview`, formats INSTAGRAM_STANDARD / INSTAGRAM_STORY /
  INSTAGRAM_REELS, iframe `www.facebook.com` — ajouté au `frame-src` de
  `public/_headers` ET de `vite.config.ts`). Le compositeur
  (`src/lib/adComposer.ts`, `StoryComposer.tsx`) dessine 1080×1920 ou
  1080×1350 sur canvas depuis l'affiche (CORS Storage OK) avec la typo de la
  DA publique, et garde son `design` sur la création pour le rejouer.
  **Un placement ne se choisit pas par création** : Meta n'a pas de
  placements par pub, c'est l'ensemble ; l'étape Créations le rappelle.
  ⚠️ `asset_feed_spec`, `degrees_of_freedom_spec` et `generatepreviews` sont
  écrits d'après la doc et NON sondés : le compte Amoris a reçu « API access
  blocked » (OAuthException 200, jusqu'à `me` et `debug_token`, jeton d'app
  compris) après la rafale de sondes du 22/09 — blocage Meta au niveau app /
  Business Manager, pas un bug Yuno. Les recherches remontent désormais
  l'erreur Meta sous le champ (`GraphSearchError`) au lieu d'une liste vide.
  À sonder dès le déblocage : `scratchpad` `creative-probe.ts` du 22/09.
  **Destination par création (22/09 nuit)** : `CampaignCreative.destination`
  = `all` | `feed` | `story` | `reel`. `all` seul → un ensemble qui porte
  le budget (comme avant). Dès qu'une création vise un placement, la campagne
  passe en BUDGET DE CAMPAGNE (`daily_budget` / `lifetime_budget` +
  `bid_strategy` sur la campagne, sondé OK le 22/09 après-midi) et
  `createFullCampaign` crée UN ensemble par destination
  (`placementsForDestination` : story = ig `story` + fb `story`, reel = ig
  `reels` + fb `facebook_reels`, feed = le reste, coupés aux positions
  manuelles ; `null` = destination indisponible, refusée avant l'envoi), les
  pubs rejoignent l'ensemble de leur destination, `delivery.budget_level` +
  `delivery.adsets[]` sont stockés et `campaign_update` / `campaign_set_status`
  s'appliquent à TOUS les ensembles (budget sur la campagne en CBO). Miroir
  front `destinationAvailable()` (`metaAds.ts`). Meta ne connaît pas de
  placement par pub : ne jamais « filtrer » une créa par placement autrement
  que par un ensemble dédié.
  **RÈGLE ABSOLUE (Paul, 22/09 soir) : plus AUCUNE sonde d'écriture sur
  l'API Meta avec un compte réel** — la rafale de sondes a fait bloquer
  l'accès API et imposer une vérification d'identité. Vérifier par banc DOM
  (`scratchpad/step-harness.tsx` : esbuild + Chrome headless servi en HTTP,
  `--define:import.meta.env=…`), `deno check`, tests unitaires. Une
  vérification en vrai = une seule campagne, à la demande de Paul, cliquée
  par lui.
  **Identité de la pub (19/09)** : `discoverAssets` relève l'Instagram
  professionnel relié à chaque Page (`assets.instagram[{page_id,id,username}]`,
  exige `instagram_basic`, best-effort) ; `ig_user_id` suit TOUJOURS la Page
  retenue (callback et `select_assets`), jamais une valeur figée. Le choix
  des actifs s'affiche dès qu'une liste (pixels, comptes pub, Pages) a plus
  d'une entrée, une reconnexion conserve un choix encore valide, et
  `select_assets` reste ouvert sur une connexion active (« Changer les
  actifs ») : ne jamais réintroduire un état sans issue où la Page ou le
  compte pub se changent seulement par Disconnect. L'aperçu du wizard et
  la ligne « Identity » du récapitulatif montrent la Page (photo publique
  `graph.facebook.com/{page}/picture`, autorisée dans la CSP `img-src`) et
  `@instagram` : c'est la preuve filmée de `pages_read_engagement` et
  `instagram_basic`. La pastille « Bientôt » des barres latérales suit
  `useMetaIntegrationLive()`, pas la constante.

## Claude Design — design system public synchronisé

Le design system **public** (et lui seul) est synchronisé vers claude.ai/design, projet
`58f89cdc-d4fc-4516-ac38-d444cc842ec0` (« Yuno Design System ») : 72 composants — les
19 primitives `ui/` réellement utilisées par une surface publique, les 12 composants
éditoriaux d'`explore/`, et `BottomNav`. Le design system **pro n'y est pas** et ne doit
pas y être ajouté : `docs/DESIGN_SYSTEM.md` reste hors périmètre.

Tout vit dans `.design-sync/` (committé) : `config.json`, `conventions.md` (l'en-tête
injecté dans le prompt de l'agent de design — c'est lui qui interdit de bâtir un écran
opérateur avec ces composants), `docs/` (une doc par composant → groupe + `.prompt.md`),
`previews/` (72 aperçus), et 3 scripts de build. **`NOTES.md` est à lire avant tout
re-sync** — il contient les pièges déjà résolus et les risques de dérive.

Re-sync : invoquer la skill `design-sync`, qui relit `config.json` et enchaîne
`buildCmd` (build app → CSS compilée → package de déclarations) puis le convertisseur.
Les notes de validation des 72 composants sont capitalisées dans l'ancre distante, donc
un re-sync ne revérifie que ce qui a changé.

**Un composant public qui entre ou sort du périmètre** doit être ajouté/retiré de la
liste dans `.design-sync/build-ds-package.sh` **et** recevoir sa doc via
`.design-sync/gen-docs.mjs` — sinon il manque en silence, ou atterrit sans groupe.

## Assistants IA — connaissance à tenir à jour

Trois assistants IA embarqués (modèle `gpt-4o-mini`, constante `OPENAI_MODEL`,
secret `OPENAI_API_KEY` dans Supabase) :

- **Client** : page `/assistant` → `supabase/functions/yuno-assistant/index.ts`.
  Sa connaissance produit vit dans `CLIENT_KNOWLEDGE_BASE` (mode d'emploi condensé).
  Les données (events, clubs, DJs, prix…) sont requêtées LIVE à chaque question —
  rien à faire de ce côté.
- **Owner** : bouton flottant du dashboard → `supabase/functions/owner-assistant/index.ts`.
  Sa connaissance vit dans `HELP_ARTICLES` (~32 articles keyword→snippet) et le
  `OWNER_SYSTEM_PROMPT`. Les données opérationnelles passent par ses ~25 tools (live).
- **Agence** : bouton flottant de la Console `/agency-app` →
  `supabase/functions/agency-assistant/index.ts` (même architecture qu'owner :
  double client, boucle 3 tours, SSE). Connaissance dans `HELP_ARTICLES` (~17
  articles) + `AGENCY_SYSTEM_PROMPT` ; 12 tools read + 3 tools write
  (annonce équipe, bio, tri linktree) journalisés dans `agency_ai_audit_log`.
  Interdit d'y ajouter un tool qui touche au cycle de règlement.
  Front : `src/components/agency/AgencyAssistant.tsx` + `useAgencyAssistantChat.ts`
  (i18n via `translate()` inline, pas de clés locales).

**Règle de synchronisation — à chaque changement de fonctionnalité :**
1. Feature côté client (billets, guest list, VIP, boissons, fidélité…) →
   mettre à jour la section correspondante de `CLIENT_KNOWLEDGE_BASE`.
2. Feature côté owner (nouvelle page, nouveau flux, changement de frais/tarifs…) →
   mettre à jour ou ajouter l'article `HELP_ARTICLES` correspondant (keywords FR+EN,
   `path` = vraie route `/owner/...`, snippet 3-6 phrases, JAMAIS de référence de plan
   tant que `SUBSCRIPTIONS_ENABLED=false`).
3. Nouveau tool owner/agence pertinent ? L'ajouter à `TOOLS` + `executeTool` (write → aussi
   `WRITE_TOOLS` + confirmation) — c'est ce qui rend l'IA capable d'AGIR, pas juste parler.
4. Redéployer : `supabase functions deploy yuno-assistant owner-assistant agency-assistant`.
5. Mettre à jour le mode d'emploi en même temps : owner → `ohelp.*` 3 langues +
   `ownerHelpContent.ts` ; **agence → `ohelp.agc.*` 3 langues (locales) +
   `src/data/agencyHelpContent.ts`** (moteur partagé `OwnerHelpCenter`, visuels SVG
   dans `public/help/agency-*.svg`) : l'IA et le centre d'aide racontent la même
   vérité, en même temps.

L'ancienne table `chatbot_training` (FAQ injectée dans le prompt) est abandonnée —
ne pas la réintroduire : la connaissance versionnée dans le code est la seule source.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
