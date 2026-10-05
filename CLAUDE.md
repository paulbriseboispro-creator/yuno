# CLAUDE.md — Yuno

Source de vérité projet, lue automatiquement à chaque session. Tenir à jour.
Dernière revue : 2026-10-05.

## Ce qu'est Yuno

SaaS nightlife multi-tenant. **Deux piliers en ligne depuis le 2026-10-01 :**
**billets d'événements (guest list comprise) + réservation de tables VIP (bottle service).**
Le troisième pilier historique, la **commande de boissons** (skip the bar queue), est
**EN PAUSE** : code et base conservés, rien de visible — voir « Pilier boissons en pause »
ci-dessous avant de toucher à quoi que ce soit qui parle de bar, carte, commandes de
boissons, upsells, crédits boissons, barman ou Click & Collect. Côté pro : dashboards pour
clubs (owner), organisateurs/associations, promoteurs, affiliés, et staff opérationnel
(bouncer, vestiaire, hôte VIP ; le barman dort avec le pilier).

Fondateur solo : Paul. Site public multilingue **EN / FR / ES** (défaut : anglais).

## Pilier boissons en pause — projet en développement, pas une fonctionnalité (2026-10-01)

Décision stratégique de Paul : « ce n'est pas encore le moment, c'est confus pour les
utilisateurs ». Tout le système boissons (`docs/SYSTEME_VENTE_BOISSONS.md`) reste dans le
code et dans la base ; il n'est simplement plus montré. Inventaire exhaustif des surfaces
gatées et marche à suivre pour relancer : `docs/DRINKS_PILLAR_PAUSED.md`. Règles :

- **Porte unique : `DRINKS_PILLAR_LIVE`** (`src/lib/drinksPillar.ts`), lue depuis
  `VITE_DRINKS_PILLAR_LIVE === '1'` — donc `false` dans tout build de production
  (Cloudflare, Xcode Cloud, OTA). En local, poser la variable dans `.env.local` pour
  travailler sur le projet. Miroirs à la main (pas de Vite) : une constante
  `DRINKS_PILLAR_LIVE = false` en tête de `yuno-assistant`, `owner-assistant`,
  `send-ticket-confirmation` et `worker/index.ts` ; `index.html` porte un commentaire.
  Relancer = allumer les cinq ensemble.
- **Ne JAMAIS supprimer** une page, un composant, une table, une RPC ou une fonction edge
  du système boissons sous prétexte qu'elle est inatteignable. Ne jamais non plus
  « nettoyer » les clés i18n `cart.*`, `drinkCat.*`, `clickCollect.*`, `vipMenu.*`,
  `upsellPage.*`, `pushTpl.flashDrinks.*`, `ohelp.pg.menu.*`… : elles servent au relancement.
- **Toute nouvelle surface** qui parlerait de bar, boissons, commandes du bar, upsells de
  consos, barman ou Click & Collect se gate dès l'écriture avec la même constante.
- **Ce qui RESTE en ligne, par décision** : la « boisson offerte » d'un billet ou d'une
  part de guest list (`includes_drink`, `quota_drink`, `drink_cutoff_time`) — attribut
  de l'offre billetterie (mode Libre du 30/09), pas le système de commande. **Elle se
  récupère à la PORTE uniquement** : `venues.free_drink_mode = 'bouncer_notify'`
  partout et par défaut (migration `20261002100000`, qui éteint aussi `menu_enabled`,
  `live_mode_enabled`, `post_checkout_upsell_enabled`, `click_collect_mode` sur tous
  les clubs) ; le mode « crédits au bar » n'est plus proposé. L'historique `orders` du
  club démo est effacé (`scripts/demo/clean-drinks-history.sql`) ; aucune vente réelle
  n'a jamais existé.
- **Les routes boissons redirigent** (`drinksRoute` dans `App.tsx`) ; le détour
  `/order/upsell` après un billet renvoie droit sur la confirmation du billet
  (`UpsellDetourRedirect`), et `VerifyTicketPayment` ne le prend plus. Les onglets
  Commandes ouvrent sur Billets (club comme orga), `?tab=drinks` retombe dessus.
- Le discours public est à DEUX piliers : landing (`landing.*2` / `appF2b`), SEO des pages
  villes / clubs / événements, `index.html`, worker crawler, Welcome, Explore faible
  densité, assistants IA.

## Yuno CRM — deuxième produit, branché sur la billetterie du pro (2026-10-02)

Décision de Paul : beaucoup de pros veulent la techno Yuno sans quitter leur
billetterie. Yuno CRM se connecte à leur billetterie (Shotgun d'abord) et ne
vend rien. Plan : `docs/designs/YUNO_CRM_PLAN.md` ; prix :
`docs/designs/YUNO_CRM_PRICING.md`, première section. Règles déjà posées :

- **Prix : UN abonnement + une monnaie, révisé par Paul le 04/10.**
  24 € HT / mois au lancement (garanti tant que l'abonnement vit), 34 € ensuite
  pour les nouveaux comptes ; annuel = 288 € HT (12 mois) + 30 000 Yunits offerts,
  sans remise. Pas de compte gratuit : essai 14 jours sans carte (5 000 Yunits),
  puis compte EN PAUSE (base lisible et exportable, ni synchro ni envoi). Tout ce
  qui fait envoyer est dans le socle (automatisations, A/B, Meta, IA, équipe sans
  limite) : brider une fonction qui fait envoyer, c'est brider le revenu.
  **Les Yunits** sont la monnaie de Yuno CRM (le nom « néons » est abandonné),
  jamais appelés « crédits » à l'écran : 1 e-mail = 1, DM Instagram = 10, SMS
  France = 40 / segment, WhatsApp = 100 ; 10 000 par mois qui s'éteignent à
  l'échéance ; **recharge au CURSEUR, jamais de pack pré-créé** (décision de
  Paul, 05/10) : 5 000 à 300 000 Yunits par pas de 5 000, 500 par euro HT,
  +10 % dès 25 000 et +15 % dès 50 000 (`crm_pricing_config()`, devis serveur
  `crmRechargeQuote`, paiement en `price_data`) ; dépensés du lot qui s'éteint
  le plus tôt ; jamais débités pour un test, un contact écarté par la
  politique d'envoi ou un refus du fournisseur ; l'IA ne coûte pas de Yunits. La
  Suite garde son modèle (emails offerts, recharges au prix coûtant).
  **Les prix se lisent en base, jamais au front** : `crm_pricing` (une ligne,
  `crm_pricing_config()`), modifiable depuis l'Admin CRM › Réglages
  (`crm_admin_pricing_set`, historique `crm_pricing_history`). Changer un prix
  là change ce qu'affichent la Console et la page Tarifs, PAS un abonnement
  existant ni Stripe : le montant facturé vient des prix Stripe retrouvés par
  `lookup_key` (`yuno_crm_base_<month|year>_<launch|public>`, publics INACTIFS
  jusqu'au passage au prix public ; les anciens produits `yuno_crm_pack_*`
  sont ARCHIVÉS depuis le 05/10). Stripe live est à
  24 / 34 / 288 depuis le 04/10 (`scripts/stripe/create-crm-prices.mjs` en est le
  miroir idempotent) ; produits, surnoms de prix et métadonnées y disent
  « Yunits » depuis le 05/10 (`yunits_*`, aucun code ne les lit). **Seuil validé par Paul le 05/10 : le prix public (34 €) s'applique au 50ᵉ compte payant** (`price_switch_at = 50`, réglable dans Admin CRM › Réglages). Le lot 4b est fait : `club-subscription/crm.ts`
  (`crm_checkout`, `crm_portal`), webhook → `crm_apply_stripe_subscription`. Ne
  jamais recréer les prix Essentiel / Pro / Business.

- **Deux domaines, deux produits (2026-10-04)** : Yuno Billetterie sur
  `yunoapp.eu`, Yuno CRM sur `crm.yunoapp.eu` — connexion `/login` (page à la
  DA CRM, `src/crm/pages/login/LoginPage.tsx`), Console `/crm/*`, Admin CRM
  `/admin/crm/*`. Le domaine CRM est servi par le Worker de la LANDING
  (repo Yuno-landing, `src/i18n/hosts.ts`) : il garde ses pages (`/`, `/fr`,
  `/es`, `/start`) et relaie à yunoapp.eu les chemins de l'app
  (`appPathOnCrmHost`). Le même bundle tourne donc sur les deux origines ;
  **porte unique `productHostDecision` (`src/lib/productHost.ts`, testée)**,
  appliquée par `ProductHostGate` (App.tsx) : un chemin CRM sur yunoapp.eu part
  sur crm.yunoapp.eu, un chemin Billetterie sur crm.yunoapp.eu part sur
  yunoapp.eu, `/auth` du domaine CRM devient `/login`, les chemins communs
  (`/auth/handoff`, `/get-started`, `/accept-org-member`, 2FA…) restent sur
  place. **Un chemin CRM ajouté se déclare dans `CRM_PATH_PREFIXES` ET dans
  `APP_PATH_PREFIXES` de la landing**, sinon il tombe en 301 vers
  landing.yunoapp.eu. Deux origines = deux sessions : le passage garde la
  connexion par une session NEUVE (`goToProduct`, `src/lib/productHandoff.ts` :
  edge `mfa` action `web-handoff` → `/auth/handoff#token_hash…&uid…`), JAMAIS
  une copie du refresh token (deux onglets qui le font tourner se déconnectent
  l'un l'autre) ; le compte choisi (`yuno.crm.space`, `yuno:acting-organizer`)
  suit dans le fragment. Aperçu démo et accès assisté ne changent jamais de
  domaine (l'edge refuse de leur créer une session) ; localhost, aperçus
  Cloudflare et app native non plus. Pas de service worker sur crm.yunoapp.eu
  (il servirait index.html à la place de la landing) ; écran de démarrage,
  bandeau cookies et `/auth/handoff` y prennent la DA claire. Toute fonction
  edge appelée par la Console CRM accepte `https://crm.yunoapp.eu` (liste
  `ALLOWED_ORIGINS` de `_shared/cors.ts` — redéployer la fonction après l'ajout).
- **Connecteur = `affiliate-ticket-sync`, actions `ticketing_*`** (quota de
  fonctions atteint ; le code Whan n'est pas touché, `ticketing.ts` à part).
  Connexion par portée (`ticketing_connections`, jeton dans le Vault, jamais
  renvoyé), journal `ticketing_sync_runs`, données dans `external_events` /
  `external_tickets` (RLS sans policy). Lecture TOLÉRANTE d'un billet
  (`_shared/ticketing-shotgun.ts`, testé) : Shotgun ne documente pas le schéma.
  **Limiteur commun `consume_ticketing_rate('shotgun', 45)` avant chaque
  requête** : le quota Shotgun est de 100 / min PAR IP, partagé par tous les
  clients. Jamais d'écriture chez Shotgun. Cron `ticketing-sync` toutes les
  10 min. Carte « Billetterie (Shotgun) » dans Intégrations, réservée au super
  admin / démo / bêta tant que `CRM_CONNECTORS_LIVE` (`src/lib/crmProduct.ts`)
  est à false.
- **Une soirée Shotgun a une soirée MIROIR dans `events`**
  (`external_source`, `external_ticket_url`), créée par
  `ticketing_after_sync()` seulement. Le trigger `zw_force_external_event_private`
  la force inactive, privée, sans billetterie / tables / liste d'attente Yuno :
  invisible de toute lecture publique (RLS `is_active`, Explore, push, annonces).
  **Toute nouvelle lecture publique d'`events` filtre `is_active`** (c'est déjà la
  règle) ; une lecture CRM qui doit voir les soirées externes écrit
  `(e.is_active OR e.external_source IS NOT NULL)`. Pas de promoteurs ni de liens
  suivis `/l/` sur une soirée externe ; dans un email, son bouton part vers la
  billetterie (UTM) et ses tarifs viennent de `get_external_event_live`.
- **Billets externes dans le CRM** : `contact_scope_customers` les compte comme
  des billets (valides / transférés, valeur faciale hors frais). Automatisations :
  un acheteur Shotgun d'une soirée est « bought » (jamais de dernier appel pour
  une soirée payée), un scan Shotgun vaut une venue, un achat vaut une activité.
  Toute nouvelle requête « a acheté / est venu » ajoute la branche
  `external_tickets` (`status IN ('valid','transferred')`).
- **Consentement** : un acheteur Shotgun n'entre au registre que si Shotgun
  rapporte son accord newsletter (`source = 'connector:shotgun'`,
  `consent_source = 'ticketing'`), jamais un désabonné / une adresse purgée.
  Une source `connector:%` ne déclenche JAMAIS la recette « bienvenue ».
- **Le produit du compte choisit la Console** (`venues.product` /
  `organizer_profiles.product` = `suite` | `crm`, migration `20261002190000`).
  Écrit à l'inscription (`complete_pro_signup`) ou par le super admin
  (`set_account_product`), jamais par le client (trigger `guard_account_product`).
  Front : `useAccountProduct()` (`src/lib/crmProduct.ts`). Un compte CRM a SA
  barre latérale (`buildCrmNavGroups`, `components/crm/crmNav.tsx`), son accueil
  (`ProductHome` → `CrmHome`), ses pages `…/crm/nights`, `…/crm/nights/:id`,
  `…/crm/audience`, `…/crm/billing`, et son centre d'aide
  (`buildCrmHelpCategories`, `src/data/crmHelpContent.ts`, clés `ohelp.crm.*`).
  **Toute route ouverte au CRM entre dans `CRM_PREFIXES` (`isCrmPathAllowed`)**,
  sinon le layout la renvoie sur l'accueil : une page de vente (événements,
  billetterie, porte, tables, paiements) n'y entre jamais. Lectures de la
  Console CRM = `get_crm_overview`, `get_crm_nights`, `get_crm_night_report`
  (porte `crm_scope_allowed`). Un écran PARTAGÉ avec la Suite garde ses
  chiffres et ne change que ses mots en CRM (Audience : `variant="crm"`, pas
  d'abonnés ni de push ; Clients : « Via la billetterie », jamais « Venus par
  Yuno » ni « avec l'app »). Démo : `crm@womber.fr`
  (`scripts/demo/create-crm-account.mjs` puis `seed-crm-demo.sql`, rejouable).
- **L'offre CRM se lit en base, jamais au front** (migrations `20261002200000`,
  `201000`). `crm_subscriptions` (une ligne par portée, séparée de
  `venue_subscriptions` : noms d'offres qui se croisent, trigger collab de la
  Suite), `crm_effective_plan()` (essai = Pro, Business choisi pendant l'essai =
  Business, actif / en retard = son offre, offre accordée échue = Gratuit) et
  `crm_plan_limits()`, miroir EXACT de `CRM_PLAN_LIMITS` (`src/lib/crmPlans.ts`,
  testé). Les limites (`crm_scope_limits`) ne valent que pour un compte au
  produit `crm`. Elles pilotent le quota email (`email_sender_monthly_free`),
  la fréquence de synchro (`crm_sync_scope`, trigger à la connexion, cron
  `ticketing-sync` toutes les 5 min) et des gardes serveur qui lèvent un code
  stable : `crm_member_limit` (`org_members`, `manager_permissions`),
  `crm_automation_limit`, `crm_plan_ab_resend`. Le front les traduit par
  `useCrmLimitToast` (« Voir les offres »). **Tout garde de limite exclut la
  MÊME personne / la MÊME recette** : un UPSERT déclenche le BEFORE INSERT même
  sur une ligne existante. L'essai (14 j) naît quand un compte passe au produit
  `crm` (trigger). `crm_billing_sweep` (horaire) clôt les essais et éteint les
  automatisations au-delà de l'offre. Paiement : actions `crm_checkout` /
  `crm_portal` de `club-subscription` (client Stripe PROPRE au CRM, jamais par
  email ; prix par `lookup_key` `yuno_crm_<offre>_<month|year>[_founder]`,
  créés par `scripts/stripe/create-crm-prices.mjs` ; portail sans changement
  d'offre) ; le webhook route `metadata.yuno_product = 'crm'` vers
  `crm_apply_stripe_subscription` AVANT la logique club. Sans prix créés,
  `crm_checkout` répond `billing_not_configured`. Démo : Pro accordé un an.

## Stack

- **Frontend** : Vite 8 (rolldown) + React 18 + TypeScript + shadcn/ui + Tailwind. SPA statique.
- **PWA** : `vite-plugin-pwa` (workbox `sw.js` auto) + `sw-push.js` manuel (push notifs).
- **Backend** : 100 % **Supabase** (Postgres + RLS + Auth + Storage + 106 edge functions Deno).
  Project ref : `fulawxvdlwtdlpkycixe`. (Ancien ref Lovable mort : `kredmghiqesyrmjqvxen`.)
- **Paiements** : Stripe + **Stripe Connect double destination** (owner→venues, organizer→profiles).
- **Autres** : Mapbox (carte clubs, lazy-load), Resend (emails), i18n maison.
- **Tests** : `npx vitest run` (helpers `src/lib/__tests__`, ~400 tests) + `npm run lint`
  (eslint couvre AUSSI `supabase/functions` : 0 erreur exigée, types réels — jamais un
  `eslint-disable`, et `// deno-lint-ignore` n'est pas lu par eslint).

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
- **Tout champ téléphone = `PhoneInputWithCountry`** (2026-09-28,
  `src/components/PhoneInputWithCountry.tsx`) — public, Console, app Pro, super
  admin. À gauche le pays (drapeau + indicatif, liste cherchable), à droite le
  numéro mis en forme au format de CE pays ; un numéro international collé
  (« +44 … », « 0032 … ») fait basculer le pays. Valeur rendue : « +33 6 12 34
  56 78 », ou `''` sans chiffre (jamais « +33 » seul). Pays par défaut :
  `defaultCountry` (pays de la soirée), sinon fuseau du navigateur, sinon France.
  Helpers purs `composePhone` / `splitPhone` / `countryFromInternationalInput`
  dans `src/lib/countries.ts` (testés). Ne JAMAIS reposer un `<input type="tel">`
  nu : un client étranger y laisse un numéro sans indicatif, donc injoignable.
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
- **Bannière d'accueil de la Console ≠ couverture publique** (2026-09-25,
  migration `20260925120000`). Le héros de `/owner/dashboard` et
  `/organizer-app` lit `venues.home_banner` / `organizer_profiles.home_banner`
  (`{url, x, y, zoom, dim}`, `src/lib/homeBanner.ts`), JAMAIS `cover_url` :
  la couverture orga est cadrée en 4:3 pour le profil public, étirée dans un
  bandeau ~4,5:1 elle ne montrait qu'une tranche au hasard. Réglage depuis
  l'accueil (`HomeBannerEditor` : import ou « partir de ma couverture
  publique », glisser pour cadrer, aperçus ordinateur + téléphone). Le cadrage
  est un POINT FOCAL + zoom (`object-position` + `transform-origin` au même
  point), jamais un rectangle figé : le héros change de proportions avec la
  largeur. Même `HomeBannerBackdrop` dans le héros et l'aperçu. Sans bannière =
  dégradé Yuno. Le héros a les PROPORTIONS de l'aperçu (`homeBannerHeroSize` : ratio
  4,4:1, plancher 256 px au téléphone), jamais une hauteur fixe — étiré en ~7:1 sur
  grand écran, il ne montrait qu'une tranche du cadrage choisi. Lecture dans une requête À PART (`fetchHomeBanner`) : une
  colonne absente ne doit jamais faire tomber `useOwnerVenue`. Orga : fondateur
  seul (`can.manageOrganization`, policy UPDATE d'`organizer_profiles`).
- **Deux design systems séparés** :
  - `docs/DESIGN_SYSTEM_PUBLIC.md` → pages publiques (éditorial, marketplace).
  - `docs/DESIGN_SYSTEM.md` → dashboards pro.
  Ne pas mélanger les deux esthétiques.
- **Rôles / routing** : guards par rôle dans `App.tsx` —
  `OwnerRoute`, `OrgAppRoute`, `PromoterRoute`, `AffiliateRoute`, `VipHostRoute`,
  `BarmanRoute`, `BouncerRoute`, `CloakroomRoute`, `DJRoute`, `ManagerRoute`, `BrowserRoute`.
- **Console Organisateur** (`/organizer-app`) : autonome mais réutilise des pages Owner ;
  conventions `org-ui`, gating Stripe via `canSell`.
- **Compte Association (ex-« BDE », 2026-09-26)** = un organisateur standard +
  le drapeau super admin `organizer_profiles.bde_verified` (toggle dans
  `/admin/organizers`). Les noms techniques `bde_verified` / `events.is_bde`
  RESTENT (lus par les checkouts et les bundles publiés) ; tout libellé visible
  dit « Association ». Ce que le drapeau change, et rien d'autre : plancher de
  commission 0,49 € (`_shared/commission.ts`), **2 000 emails de campagne
  offerts / mois** au lieu de 15 000 (`email_sender_monthly_free`, clé
  `org:<uuid>`, la surcharge `monthly_cap_override` gagne), TVA des reçus à 0 %
  par défaut, Stripe Connect pré-rempli `non_profit`. **Une association choisit
  seule public ou privé** : plus de modération super admin
  (`evaluate_event_discoverability`, migration `20260927100000`), mêmes
  critères de qualité que tout organisateur. Une soirée PRIVÉE (asso ou non)
  n'apparaît ni dans la recherche ni sur le profil public `/o/…`.
  **TVA du vendeur** (migration `20260927110000`) : `organizer_profiles.vat_regime`
  (`subject` 20 % | `franchise` 293 B | `exempt_association` 261-7-1°, NULL =
  asso exonérée sinon 20 %) + `rna_number` ; porte unique `resolveVatRegime` /
  `sellerVat` (`_shared/pdf-documents.ts`, importé par le front) = miroir SQL
  `organizer_vat_rate()` (trigger `save_invoice_on_creation`). Frais Yuno et
  assurance toujours à 20 %. Un club n'est pas concerné. Le reçu d'une soirée
  SANS club hôte lit son vendeur par `get_event_seller(event, qr)` — preuve
  d'achat obligatoire (QR du billet ou de la table, invité compris), jamais
  « Yuno » : l'organisateur s'il vend seul (`sole_seller`, son régime de TVA),
  le CLUB PARTENAIRE d'une co-soirée (20 %, comme la facture stockée et
  l'email). Contrat collab : version `2026-09-26` (« tarif Association
  vérifiée ») ; les contrats signés avant gardent « BDE ».
  **La décision de Yuno tient** : « Dépublier » / « Rejeter » (`/admin/events`)
  posent `discovery_status = 'rejected'` sur une soirée d'organisateur, et le
  trigger ne laisse plus l'orga la remettre dans Explore en la retouchant, ni
  en la passant privée puis publique (avant,
  « Dépublier » était sans effet sur toute soirée d'organisateur). Une soirée
  d'un compte DÉMO n'est jamais découvrable (`is_demo_email`), même enregistrée
  publique depuis le formulaire. Démo Association : `scripts/demo/seed-association.sql`
  (« Asso Yuno », soirée « Nuit de l'Asso » dans un club hors Yuno à Amiens,
  billets + tables event-scopées), puis `seed-upcoming-sales.sql`.
  **Identité légale d'un organisateur = privée** (migration `20260927120000`) :
  `authenticated` n'a plus le SELECT de table sur `organizer_profiles`, mais un
  GRANT PAR COLONNE sans `legal_name`, `legal_address`, `siret`, `vat_number`,
  `billing_email`, `rna_number`, `vat_regime` (même modèle que anon). Lecture
  par `get_organizer_legal_identity(org)` (l'orga, son équipe admin/éditeur, un
  club lié par un contrat que l'orga a ENGAGÉ — signé, créé par lui, actif — ou
  chez qui il mène une soirée, super admin ; jamais un brouillon ouvert par le
  club seul). `rna_number` et `vat_regime` sont gardés en mode support comme
  `siret`. Deux pièges : une
  colonne AJOUTÉE à `organizer_profiles` doit être GRANT explicitement à
  authenticated (et anon si publique), sinon tout select qui la nomme tombe ;
  et jamais d'`upsert` client sur cette table (`ON CONFLICT … EXCLUDED` exige
  la lecture de chaque colonne écrite) — `OrgAppProfile` fait UPDATE puis INSERT.
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
  **Le linktree de l'AGENCE se choisit** (2026-09-25, migration
  `20260925160000`, page `/agency-app/linktree` « Mon linktree ») :
  `affiliate_linktree_events` porte SOIT `affiliate_event_id` (externe) SOIT
  `event_id` (soirée Yuno d'un club / orga sous contrat actif). Écriture par la
  seule RPC `set_agency_linktree_events` (sélection entière, ordre = rang,
  chaque soirée revérifiée ; plus aucune policy d'écriture directe), lecture
  éditeur `get_agency_linktree_editor`, lecture publique des soirées Yuno
  choisies `get_agency_linktree_curated_yuno`. Sélection vide (ou toute passée)
  = linktree AUTOMATIQUE d'avant (8 externes + `get_agency_linktree_yuno_events`) ;
  dès qu'une soirée est choisie, `/p/:slug` n'affiche QUE la sélection, rangée
  par date sauf en tri `custom`.
  **Linktrees publics (`/p/`, `/promo/`) — 2026-09-25** : le bouton d'une
  soirée dit ce qu'on obtient (`linktreeCtaLabel`,
  `src/components/linktree/linktreeShared.tsx`) : Complet › Tables (tables
  uniquement) › Guest list (gratuit) › Billets. Barre flottante
  `PoweredByYunoBar` → Instagram de Yuno de la langue du visiteur
  (`instagramFor`, réglé dans `/admin/links`). Aucune étape d'accueil
  (`OnboardingGate`) sur `isPublicLinktreePath` : langue du téléphone si Yuno
  la parle, anglais sinon, jamais la carte « Select Language ».
- **Soirées de clubs externes (`affiliate_events`) — le temps et l'historique
  (2026-09-25, après la purge qui a effacé les soirées du soir même).** Une
  soirée n'a qu'une DATE et vit la nuit : porte unique
  `src/lib/affiliateEventTime.ts`. Public = `currentNightDate()` (date de
  Paris/Madrid de maintenant − 8 h ; miroir SQL `affiliate_night_date()`),
  jamais `toISOString().split('T')[0]` — la date UTC faisait disparaître la
  soirée à 02 h en pleine nuit et la page soirée renvoyait sur l'accueil.
  Pro = `isAffiliateEventOver()` (lendemain midi) ; fin d'une soirée =
  `affiliateEventEndAt()` (fermeture du matin = lendemain). **On ne SUPPRIME
  jamais les soirées passées** : la purge est devenue un masquage, car la
  suppression emporte en cascade ventes déclarées, commissions, assignations,
  briefs, favoris ; une soirée avec ventes déclarées est refusée à la
  suppression (`guard_affiliate_event_delete`). Vues et clics portent une
  PHOTO de leur soirée (`event_slug`, `event_name`, `event_date`, trigger à
  l'insertion + avant suppression, migration `20260926090000`) : les écrans
  groupent par elle, jamais par le seul `affiliate_event_id`. Un clic = une
  SORTIE vers la billetterie (la fiche soirée le compte, pas la carte qui y
  mène) ; une visite = un onglet (source d'arrivée gardée en sessionStorage) ;
  les lectures de trafic passent par `fetchAllRows` (PostgREST plafonne à
  ~1 000 lignes). Le générateur de récurrents lit et écrit EN LOT.
  **Une occurrence récurrente se personnalise seule** (2026-09-28, migration
  `20260928190000`) : le crayon (`/affiliate/events/:id/edit`) ne modifie que
  cette date. Titre et affiche différents du modèle posent `name_overridden` /
  `flyer_overridden` (trigger, par COMPARAISON au modèle — vider l'affiche rend
  la main au modèle) ; le générateur ne resynchronise plus une affiche marquée,
  le report « appliquer aux soirées » du modèle saute un titre marqué. Même
  modèle que `ticket_url_overridden`.
  **Liens Whan posés tout seuls** (2026-09-28, migration `20260928200000`,
  edge `affiliate-ticket-sync`, `TicketSyncCard` en tête de la page Soirées) :
  `affiliate_ticket_sources` liste les comptes promoteur Whan d'un affilié par
  PRIORITÉ (Mad by Night seul : `paul-brisebois-2` puis `milo-madbynight`) ;
  l'edge lit l'API publique `app.whan.es/api/v1/public/rrpp/<slug>` (Fourvenues
  = mur anti-robot, abandonné), relie chaque occurrence d'un modèle à sa série
  (`affiliate_recurring_templates.external_series_key` = `whan:<club>:<nom>`,
  nuit = début − 8 h, tardeo 12-20 h ≠ soirée) et pose l'URL canonique +
  `?ref=<compte>` du compte prioritaire qui la vend. Autre nom Whan ce soir-là =
  édition spéciale (Thanksgiving, Halloween…) : titre et affiche posés sur CETTE
  date. Seule écriture : `affiliate_ticket_sync_apply` (service_role) — jamais
  un lien remplacé, `ticket_url_overridden = true` (sinon le générateur de 06 h
  l'effacerait), jamais une affiche / un titre marqués à la main. Cron
  `0 16,17 * * *` UTC, la fonction ne travaille qu'à 18 h Madrid ; journal
  `affiliate_ticket_sync_runs`. `mode: 'import'` (à blanc sauf `apply: true`)
  détecte les séries (≥ 3 dates) et crée / corrige les modèles (affiche copiée
  dans `affiliate-media/<aff>/whan/`, horaires, prix) ; il publie en silence
  (`yuno.silent_publish`, lu par `auto_notify_event_published`) pour ne pas
  envoyer 100 « Nouvelle soirée » à l'équipe. **Deux soirées Whan le même
  jour dans un club = Yuno garde la PLUS TARDIVE** (début le plus tard, puis
  fin la plus tard ; `latestPerNight`) : les tardeos de 18 h ne deviennent
  jamais des modèles, même un jour où ils sont seuls. Ex-aequo = le lien posé
  à la main départage (PRYZM le 01/10). Chaque date prend le nom et l'affiche
  de SA soirée Whan ; `force: true` (secret cron seul, `p_force` de la RPC)
  réaligne aussi les dates personnalisées à la main — joué le 28/09 : les 20
  modèles portent le nom Whan exact. **Soirées ponctuelles** (migration
  `20260928220000`, interrupteur `create_one_offs` par compte, réglé depuis le
  bandeau par `set_affiliate_ticket_one_offs`) : une soirée Whan de nuit hors
  série, une nuit qu'AUCUN modèle actif du club ne couvre, est créée seule
  (`affiliate_ticket_sync_create_one_offs`, lien + affiche + horaires + prix).
  `affiliate_ticket_sync_seen` retient chaque soirée Whan créée : supprimée
  par le pro, elle n'est jamais recréée. Affiche absente sur Whan = posée
  plus tard, jamais remplacée.
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
- **Un revenu affiché = net des frais Yuno ; la dépense client est une autre
  grandeur** (2026-09-29, migration `20260929230000`). Tout chiffre présenté à un
  club, un organisateur, une agence ou un promoteur comme CA, revenu, gain ou
  « ce que tu touches » est le CA club de `fees.ts` : billets `total_price −
  service_fee − insurance_fee`, tables `total_price − service_fee −
  (fee_absorbed ? management_fee : 0)`, boissons `total − service_fee`,
  remboursement déduit, statuts de la compta (billets `paid/used`, tables
  `paid/confirmed`, commandes `paid/served`). Miroirs : `clubRevenue`
  (`_shared/posthog.ts`), `calc*Revenue` (owner-assistant), les RPC d'analyse,
  `analytics_wh.*.club_revenue`. Un `sum(total_price)` ou `sum(o.total)` nu dans
  une RPC ou un écran pro est un bug. La **dépense** d'un client (CRM, RFM,
  `venue_customers.total_spent`, panier, seuil de panier) reste ce qu'il a payé,
  frais compris — légitime pour segmenter, mais son libellé dit « dépense »,
  jamais « CA » ni « revenu ». Les commissions promoteur se calculent sur la
  valeur faciale hors frais Yuno ; `agency_conversions.gross_amount` est une
  commission due (promoteur + marge), jamais un volume de ventes. Le GMV et le
  revenu Yuno du super admin sont des chiffres Yuno, libellés comme tels.
  **Le net (Stripe déduit) ne vit que sous « Net versé » / « Gain net »** : toute
  attribution (email, push, liens, SMS, pubs) et tout récap rend le CA club
  (`20260929231000`). La bande « Volume brut − Stripe − Remboursements = Net
  versé » passe par `payoutStrip` (`fees.ts`) : une vente remboursée en totalité
  n'est plus `paid`, elle revient dans le brut et dans Stripe, puis chaque
  remboursement sort UNE fois. Ventes promoteur affichées = conversions non
  `cancelled` (le remboursement change le statut sans remettre `amount` à
  zéro), libellées « Ventes attribuées », jamais « CA ».
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
- **Billetterie LIBRE = 4ᵉ mode de vente, pas un nouveau système** (2026-09-30,
  migration `20260930120000`, plan `docs/designs/FREE_TICKETING_PLAN.md`).
  `events.ticket_selling_mode = 'free'` : une liste de billets (`ticket_rounds`
  ordinaires, `auto_activate = false`, `ticket_type = 'standard'`), boisson
  offerte et heure limite d'entrée (`entry_deadline`, la même que le mode
  Créneaux, appliquée à la porte) en option, et DEUX questions par billet — quand on le voit
  (`hidden`, `visible_from`) et quand on l'achète (`is_active` = ouvert à la
  main, `sale_starts_at`, `sale_ends_at`). Règle de lecture unique `ticketPhase`
  (`src/lib/freeTicketing.ts` ⇄ `_shared/free-ticketing.ts`, octet pour octet,
  testé) : checkout, pages publiques, email, assistant client. Les colonnes
  valent dans tous les modes mais restent à leur défaut ailleurs. Toute requête
  qui calcule un prix public « à partir de » sélectionne `hidden, visible_from`
  pour `forPublicPricing`, sinon un billet caché fuit dans les cartes. Un
  modèle libre garde ses dates en RELATIF (`{daysBefore, time}`, jours
  calendaires avant le jour de la soirée) : s'applique par `applyFreePreset`
  (front) ou `freePresetToRoundRows` (séries récurrentes), jamais à la main.
  Mise en vente, prévente, mot de passe, limite par personne et « Complet »
  restent ceux de la soirée ; la jauge totale y est facultative.
- **Supabase client** : anon key côté front (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
  Les secrets purs (Stripe `sk_`, Resend, Gemini, service_role) vivent **uniquement** dans les
  secrets Supabase / `.env.local` — jamais commités.

## Yuno CRM — la Console `/crm` (design Claude Design) et l'Admin CRM (2026-10-05)

La Console CRM est reconstruite écran par écran depuis le projet Claude Design
(branche `crm/redesign`). Tout vit dans `src/crm/` (routes `src/crm/routes.tsx`
+ carte `shell/nav.ts`, données `data/*`, primitives `ui/kit` + `Hv`, `useCrmT()`,
`useCrmScope()`, `useCrmCaps()`, `rpc()`) ; textes : section de langue `crm`
(`src/i18n/locales/crm/modules/*`, triplets [EN, FR, ES], clés `yc.*`), chargée
à la demande. Règles :

- **Une RPC par écran, gardée par la portée** : lecture = `crm_scope_allowed`,
  écriture = `crm_scope_writable`, équipe = `crm_user_manages_team`, montants =
  enveloppe `_crm_money_gate` (clés revenue / spent / amount… mises à null sans
  l'accès à l'argent). Une garde ne doit JAMAIS rendre NULL pour un inconnu :
  `IF NOT NULL` laisse passer (corrigé le 04/10, migrations `…105000`, `…106000`).
  Toute lecture qui crée des tables temporaires entre dans
  `demo_preview_writable_rpc`. Toute fonction SECURITY DEFINER finit par ses
  REVOKE / GRANT explicites.
- **Les appels de la Console ont un délai de 30 s** (`rpc()`, code `timeout`,
  `{ timeoutMs }` pour un import long) et chaque page rend ses erreurs par
  `CrmLoadError` (délai / accès refusé / hors réseau / autre, « Réessayer ») :
  jamais un « ces chiffres n'ont pas pu être chargés » nu.
- **États d'erreur** (`src/crm/errors/`, design « Pages d'erreur ») : 404 =
  route `/crm/*` hors coquille ; 401 / 403 / panne des espaces = `CrmGate` ; 500 =
  `CrmErrorBoundary` (référence `YN-500-…`, envoyée à PostHog par
  `capturePosthogException`) ; 503 = `MaintenanceWrapper` rend `CrmMaintenance`
  pour `/crm*` ; hors connexion = `OfflineBar` (le bandeau global de l'app s'efface
  sur `/crm`). Le texte est HONNÊTE : rien n'est mis en file hors ligne.
  Pas de « Demander l'accès » (aucune action serveur), pas de compte à rebours de
  maintenance (`app_settings` n'a pas d'heure de fin).
- **Prix, Yunits, aide** : voir la section précédente ; l'aide d'un compte CRM =
  FAQ `yc.faq.*` (Compte › Aide), article `ohelp.crm.*` pour la Suite, et les
  articles `crm-*` de `_shared/console-help-articles.ts` pour l'assistant
  (redéployer `owner-assistant` après modification).
- **SMS = « Bientôt » (décision de Paul, 05/10 au soir, avant le premier client réel)** : `CRM_SMS_DISPLAY_LIVE` (`src/crm/lib/sms.ts`) lit `VITE_CRM_SMS_LIVE === '1'`, donc FAUX dans tout build de production. Alors toutes les adresses `/crm/sms/*` rendent `SmsSoonPage` (mise en page `ComingSoon`, liste d'attente `crm_feature_waitlist` feature `sms`, migration `20261007210000`), les éditeurs plein écran renvoient sur `/crm/sms`, le menu porte « Bientôt », Tarifs / Yunits disent bientôt et la fenêtre « Écrire » refuse le canal SMS. Les écrans SMS restent dans le code : pour y travailler, `VITE_CRM_SMS_LIVE=1` dans `.env.local`. Ouvrir = brancher le moteur (`docs/designs/CRM_SMS_PLAN.md`, fournisseur `docs/designs/SMS_PROVIDER_PLAN.md`), passer `CRM_SMS_ENGINE_READY` à true, lever la garde serveur `crm_sms_not_open`, puis remplacer la lecture du drapeau par `true`. `SMS_MARKETING_LIVE` (achat de crédits de la Suite) reste FAUX.
- **Pages d'inscription** (v2 du 05/10, plan `docs/designs/CRM_SIGNUP_PAGES_PLAN.md`,
  migrations `20261007193500` + `194500`) : reproduites À L'IDENTIQUE du design
  Claude Design (`Pages inscription`, `FanPage`, `InscriptionPhone`,
  `yuno-pages.js`). Quatre types (`prevente`, `venue`, `attente`, `communaute`,
  règles dans `KIND_META`), dix gabarits + palettes + polices (`tokens()` de
  `src/crm/signup/model.ts`, port pur testé), assistant en 4 étapes, page
  publiée avec vrai QR, fiche à quatre onglets (Résultats, Partager, Inscrits,
  Relances). La page publique **`/j/<slug>`** (`?src=`), confirmation
  `/j/<slug>/ok?t=` — jamais `/p/` (linktree des agences) ; `/j` est un chemin
  CRM (`productHost.ts`) relayé par le Worker de la landing. Le MÊME `FanPage`
  rend la page réelle, les aperçus et les vignettes : un écart entre aperçu et
  page publique est un bug. Inscription par e-mail = double confirmation (file
  `crm_signup_confirm_queue`, jeton neuf HACHÉ) puis preuve
  `marketing_consent_events` (texte exact, `signup_page:<id>`), groupe de la page
  (`imported_contacts`), registre sans jamais réveiller un désabonné ;
  inscription par téléphone seul possible (preuve SMS, pas d'envoi SMS tant que
  `CRM_SMS_ENGINE_READY` est faux). Relances = `crm_signup_relance_collect`
  (cron `crm-signup-relance`, 5 min) : une campagne enfant `child_kind =
  'signup'` par (page, étape), sa propre mère, registre `crm_signup_sends`
  (jamais deux fois le même message), politique d'envoi Yuno, Yunits débités à
  la mise en file, étapes qui expirent (rien ne part en retard), achat reconnu
  par les billets Shotgun de la soirée. Provenance client « page » quand la
  première inscription confirmée précède le premier achat (`_crm_people_build`)
  → filtre Clients et segment « Inscrits via vos pages ». Publier = titulaire
  seul, jamais en accès assisté. Démo : aucune adresse collectée.
- **Instagram** (`/crm/instagram`) : réponse automatique aux commentaires sous
  les RÉELS, CARROUSELS ET PHOTOS (`post_types`, jamais vide, décision de Paul),
  aussi en message privé et en réponse aux stories. Écran complet mais l'App
  Review Meta n'est pas accordée : `CRM_INSTAGRAM_LIVE = false`
  (`src/crm/lib/instagram.ts`) + `crm_instagram_open()` → `crm_instagram_not_open`
  (une réponse se prépare en brouillon, ne s'allume pas). Chiffres lus dans
  `crm_instagram_events` (vide, pseudo seulement) : rien d'inventé. AUCUN appel
  à l'API Meta. Ouvrir = les deux interrupteurs ensemble + moteur à brancher.
- **Inscription** : vit dans le dépôt de la landing (`yuno-landing-crm`) : parcours
  tiré du design, Google et Apple, lien de confirmation e-mail à la place d'un code.

**Admin CRM (`/admin/crm`, super admin)** : coquille propre (menu en quatre
groupes, ⌘K, bascule Suite / CRM, interrupteur « démo incluse » partagé avec
l'admin de la Suite) dans `src/crm/admin/` ; textes dans la section `admin`
(`adm.crm.*`, modules `crmAdmin*.ts`, test des clés). Tout se LIT dans les
tables réelles ; rien n'est inventé :

- `_crm_admin_rows` est la ligne de compte unique (statut, MRR Stripe seulement,
  santé /100 et ses quatre parts, onboarding en 7 étapes, synchro, solde, achats) ;
  Clients, Pilotage, Argent, Plateforme, Légal, Vente, Acquisition et Produit la
  réutilisent. La santé se définit UNE fois, dans l'en-tête de la migration
  `20261005240000`. Un compte offert (sans abonnement Stripe) n'entre jamais dans
  le MRR. Une résiliation est datée par `crm_subscriptions.updated_at`
  (approximation assumée, dite à l'écran).
- **Gestes audités** (`admin_audit_log`, `entity_type = 'crm_account'`, motif
  obligatoire) : Yunits offerts, essai prolongé (compte sans Stripe seulement),
  gel d'envoi (`crm_settings.sending_frozen_at`, refusé par le trigger
  `guard_crm_send_frozen` sur les campagnes e-mail et SMS ; une recette automatique
  est mise EN PAUSE plutôt que de lever une exception qui ferait tomber la
  collecte des autres comptes), notes. Prospects : `crm_prospects` (+ événements),
  pipeline réel (Essai et Payant se lisent dans les comptes).
- **Ce que la base ne sait pas n'est pas rendu** : tests A/B, exceptions edge,
  ouvertures / clics des e-mails du cycle de vie. Les coûts réels d'envoi sont un
  RÉGLAGE (`crm_pricing.config.costs`).
- **Fin de build (05/10, migrations `20261005243000` → `256000`)** :
  - Connexion `/admin/crm/login` (vraie auth, `is_super_admin`, 2FA EXISTANTE
    par l'edge `mfa` verify-login, preuve `mfaSession` partagée avec RequireMFA).
  - Pilotage › Activité en direct (`crm_admin_activity`, pastille =
    `crm_admin_live_signups`) ; Plateforme : durée p50 / p95 des synchros, une
    passe tuée est marquée `abandoned` sans fin inventée (cron horaire).
  - Clients : tiroir latéral `?open=<compte>` ; « Voir sa Console » = accès
    assisté CONSENTI (`admin_support_grants`), jamais de session sans accord.
  - **Prolongations d'essai** : `crm_subscriptions.trial_extensions_used` ; le
    pro prolonge seul de 7 j (`crm_request_trial_extension`, Facturation) dans
    la limite de `trial_extensions` ; un geste admin passe au-delà mais compte.
  - **Seuil des 50** : `crm_price_tier()` = public seulement si payants ≥
    `price_switch_at` ET prix publics ACTIFS chez Stripe (`crm_price_state`,
    écrit par l'action `crm_price_status` de club-subscription — LECTURE Stripe,
    super admin — et par un checkout qui retombe) ; un abonné existant
    (`founder`) garde le lancement ; `crm_checkout` essaie public puis lancement,
    jamais un paiement qui échoue. Tarifs et Facturation affichent le prix du niveau.
  - Réglages › **E-mails du cycle de vie** (`crm_lifecycle_emails`, 8 e-mails
    FR/EN/ES, TOUS éteints ; registre anti-doublon `crm_lifecycle_sends` ; démo =
    `demo_no_send` ; envoi par `process-scheduled-campaigns`, rendu
    `_shared/crm-lifecycle-html.ts` partagé avec l'aperçu admin).
  - Vente › **Comptes cibles** (`crm_admin_targets`, villes où Yuno CRM a un
    compte, sans espace CRM, démo exclue ; seul `crm_prospects` reçoit un contact).
  - Acquisition › **Page CRM** : mesure first-party de crm.yunoapp.eu
    (`crm_landing_events`, sans cookie, empreinte salée du jour, DNT/GPC
    respectés, purge 180 j ; écrite par `track_crm_landing_event` depuis
    `src/lib/crm-measure.ts` du dépôt landing, branche `crm/landing-measure`).
  - Produit : **NPS** (`crm_nps_responses`, après 30 j, une fois / 90 j, score
    dès 10 réponses) et **demandes** (`crm_feature_requests`, statut avec motif).
  - Légal : **registre d'incidents** (`crm_incidents`, échéance CNIL 72 h,
    alerte `admin_crm_incident_deadline` à H-24 / H-6, liste des pros PRÉPARÉE,
    jamais envoyée).
  - Un compte Billetterie avec CRM ajouté (`extra_products`) entre dans
    `_crm_admin_rows` et sort des comptes cibles.
  - Clés : une clé n'est définie qu'UNE fois (test dans `keys.test.ts`) — la
    connexion utilisait `adm.crm.lg.*` et écrasait le sous-titre de Légal.
- **Compte démo CRM (`crm@womber.fr`) = `bash scripts/demo/refresh-crm-demo.sh`**
  (6 min, rejouable, cf. `scripts/demo/README.md`), ancré sur `now()` : à relancer avant
  chaque call de vente et au plus tard tous les 3-4 jours, sinon les courbes comparent
  du vieux et l'accueil perd ses tâches. Ne jamais semer d'adresse avec accent ; les
  Yunits de la démo ne comptent aucun SMS (écrans SMS « Bientôt » en production).
  Écriture lourde : la lancer SEUL (règle de santé de la prod ci-dessus).
- Vérification visuelle sans session super admin : un banc de données d'exemple
  (jamais commité, `.crm-tools/`), car aucun compte `@womber.fr` n'est admin.

## Yuno CRM — ce que Shotgun rapporte, et rien d'autre ; liens de partage (2026-10-05)

Audit de chaque chiffre de la Console CRM contre l'API publique de Shotgun.
Schéma complet, champ par champ : `docs/designs/SHOTGUN_API_REFERENCE.md`
(pages officielles « Tickets API » et « Organizer events API »). Règles :

- **Un chiffre de la Console sort d'un champ de cette référence, ou d'une
  mesure Yuno (e-mails, clics `/go/`, pages `/j/`, imports). Sinon il
  s'affiche « Bientôt, avec l'intégration partenaire Shotgun »**
  (`ShotgunSoonCard`, `src/crm/components/ShotgunSoon.tsx`), jamais un
  chiffre estimé ni une phrase écrite en dur — décision de Paul : on montre
  la valeur, on négocie l'intégration. Aujourd'hui en « Bientôt » : visites de
  la page Shotgun, conversion page → achat, qui a cliqué sans acheter, paniers
  abandonnés, l'étape entre le clic et l'achat. Une projection se libelle
  « Estimation ».
- **Le connecteur lit les noms documentés** (`_shared/ticketing-shotgun.ts`,
  testé sur un billet au schéma officiel) : montants des billets en CENTIMES
  (`deal_price`, `deal_user_service_fee`, toujours ÷ 100), tarifs des soirées
  en EUROS (jamais divisés), `contact_*` (consentement, âge à l'année près,
  ville, code postal, pays en toutes lettres → ISO). Soirées à venir relues en
  entier à chaque passe (places restantes). Aucun compte réel n'était connecté
  au 05/10 : rien à rattraper ; un compte importé avec l'ancien lecteur se
  rattrape par une remise à zéro de `tickets_cursor`.
- **Une vente = `_crm_ticket_is_sale(status, raw)`** : `valid` hors invitation
  (`deal_channel = 'invitation'`). Un billet revendu (`resold` → `transferred`)
  n'est pas une vente (l'acheteur de la revente a son propre billet). Utilisée
  par `_crm_tickets`, `_crm_ana_setup`, Soirées, Liens ; le registre des
  PERSONNES (« a acheté », automatisations) garde `valid, transferred`.
- **La source d'une vente = `utm_source` seulement** (Shotgun écrase
  `utm_medium` par la plateforme, ne rend pas `utm_campaign`). Familles
  (`_crm_ticket_source` ⇄ `sourceKind`, `src/crm/lib/links.ts`) : `yl` lien de
  partage `yuno-<code>` · `em` e-mail `yuno-m-<8 hex campagne>` (et `yuno`
  d'avant) · `sm` `yuno-s-…` · `dm` `yuno-d-…` · `so` réseau vu par Shotgun ·
  `sg` app/site Shotgun · `au` autre site · `di` direct · `of` hors ligne /
  importé. « Partenaires » n'existe plus (rien dans l'API). Tout lien Yuno
  vers Shotgun porte TOUT son identifiant dans `utm_source`.
- **Liens de partage** (onglet « Liens de partage » du tiroir d'une soirée,
  `?e=<id>&v=links`, migration `20261006200000`) : `tracked_links` sur la
  soirée miroir (`utm_source` = réseau, `utm_medium` = emplacement, paires de
  `_crm_link_kind_ok` ⇄ `LINK_KINDS`), URL `yunoapp.eu/go/<code>`. Le Worker
  (`worker/goLink.ts`, route `run_worker_first` `/go/*`) appelle
  `crm_link_hit` (empreinte salée du jour, jamais l'IP ; robots d'aperçu et
  `?t=1` jamais comptés) puis 302 vers Shotgun avec `utm_source=yuno-<code>`.
  Un `/l/` posé sur une soirée Shotgun prend la même redirection. Lecture
  unique `crm_night_links` (pas de table temporaire). **Avant la première vente
  rapportée par Shotgun avec une source Yuno, l'écran dit « en attente » et
  « — », jamais « 0 »** (`confirmed`). Un lien n'est jamais désactivé : «
  Masquer » (`archived_at`) le retire seulement de la liste.
  **Emplacements = là où un lien se clique** (`20261006240000`) : Instagram =
  story (sticker lien) + lien en bio ; TikTok = lien en bio SEUL ; plus de
  post, reel, DM ni vidéo TikTok à la création (`_crm_link_creatable` ⇄
  `LINK_KINDS`). Ces anciens emplacements restent LUS (`_crm_link_kind_ok`,
  `LEGACY_KINDS`) : un lien déjà posé garde ses ventes. Les liens d'e-mail
  (`yuno-m-…`), de SMS et, plus tard, de réponse Instagram (`yuno-d-…`) se
  génèrent SEULS à l'envoi : jamais un bouton de création. La famille `so`
  (« Instagram et TikTok (hors lien Yuno) ») = utm_source `instagram`/`tiktok`… SANS code
  Yuno, donc PAS nos liens : ne jamais la présenter comme « réseaux vus par
  Shotgun » ni la confondre avec `yl`, que l'écran détaille par type de lien
  (`groupSources(rows, links)`). Une publication (story, groupe…) se NOMME à
  la création (`NewLinkModal`) avec sa capture en option (`tracked_links.image_url`,
  bucket `email-assets`, migration `20261007120000`) : c'est ce qui permet de
  dire quelle story a converti. Dans Analyses, `yl` est éclaté en `ys`
  (story Instagram), `yb` (lien en bio Instagram), `yt` (bio TikTok) et `yl`
  (autres liens) par `_crm_ticket_source`, qui lit `tracked_links` par code
  (`20261007130000`) : toute nouvelle famille s'ajoute aux listes de
  `crm_ana_traffic__core` ET à `SOURCE_KEYS`. Le lien en bio, unique, se crée d'un geste.
- **Fiche client** (`crm_client`, migration `20261006220000`) : chaque achat
  porte sa source nommée (`_crm_source_label` : lien « Story 2 », campagne
  « Line-up »…), chaque e-mail cliqué la soirée visée et `bought_after`. Un
  clic sur une story reste anonyme tant que la personne n'achète pas.
- « On t'a manqué » ne part que si au moins la moitié des détenteurs ont été
  scannés (`20261006230000`) : Shotgun laisse le scan vide quand un autre
  prestataire a scanné.
- Démo : `scripts/demo/seed-crm-links.sql` (à rejouer après
  `seed-crm-demo.sql`), sources réalistes (`utm_medium` = app / website).

## Serveur MCP — les chiffres d'un pro dans son IA (2026-10-03)

Doc complète, kit annuaires et mise en service : `docs/MCP.md`. Un club ou un
organisateur branche Claude, ChatGPT, Gemini ou Le Chat sur sa Console
(`https://yunoapp.eu/mcp`) ; l'IA lit ses chiffres en LECTURE SEULE et les
transforme en analyses et conseils. Worker `worker/mcp/*` (routé en tête de
`worker/index.ts`, chemins dans `run_worker_first`), migrations
`20261003100000` → `120000`, pages `/connect-ai` (consentement, DA publique),
`/ai` (page publique = documentation des annuaires), Réglages → Assistants IA
(`AiAssistantsSettings`, club / manager / orga / CRM). Règles intouchables :

- **Aucune session Supabase n'est jamais remise à une IA.** Notre propre
  serveur OAuth 2.1 (DCR + CIMD + PKCE S256, `resource`, `iss`) émet des jetons
  OPAQUES (`yuno_mcp_at_…` 1 h, `yuno_mcp_rt_…` 30 j en rotation) qui n'ouvrent
  que `/mcp`, stockés hachés. Ne jamais passer au serveur OAuth de Supabase :
  son jeton vaut une session complète (PostgREST, Storage, edge, GoTrue).
- **Le Worker n'a aucun droit propre** : secret `SUPABASE_MCP_KEY` (clé serveur
  dédiée, posée dans Cloudflare), appelle les seules fonctions `mcp_*`
  (`service_role` seul). Sans le secret : 503 propre.
- **`mcp_call` exécute en tant que la personne** (claims posés, les deux
  formes de GUC, `auth.role()` = `authenticated`), transaction `READ ONLY` sauf
  `count_contacts` / `list_customers` (tables temporaires), et n'appelle QUE les
  RPC d'analyse de la Console, avec leurs portes. Un outil nouveau = une RPC
  déjà gardée, jamais une lecture de table sans filtre de portée, jamais une
  écriture. `_mcp_tool` tourne sous le propriétaire : n'y appeler AUCUNE
  fonction SECURITY INVOKER qui compterait sur la RLS.
- **Deux niveaux, choisis au consentement** : `analytics` (aucune identité,
  `_mcp_redact` retire email / téléphone / nom / notes) et `customers` (fiches,
  50 par appel, 100 lectures / jour). GPS, IP, jetons jamais rendus. Espaces =
  `_mcp_user_spaces` (ceux où la personne lit déjà les chiffres ; le super admin
  n'y a que les siens). Le propriétaire / fondateur voit et coupe les IA de son
  équipe. Jamais de connexion en accès assisté.
- **Un outil composite ne tombe jamais pour une seule brique** (migration
  `20261003130000`) : chaque RPC d'un outil qui en assemble plusieurs est
  appelée dans son propre `BEGIN … EXCEPTION WHEN others`, et une brique
  refusée devient `_mcp_unavailable(SQLSTATE, SQLERRM)`. Un manager de club ou
  un admin d'équipe n'est pas propriétaire : sans ça, la moitié des outils
  échouaient pour le compte de relecture. Un admin d'équipe d'organisation lit
  emails et contacts comme sa Console les lui montre (`contact_scope_allowed`,
  `_email_scope_guard` acceptent `is_org_team_member(…, 'admin')`).
- **Dans le Worker, jamais `fetch(…, { redirect: 'error' })`** : workerd lève
  une TypeError avant toute requête. C'est ce qui a rendu toute connexion CIMD
  (Claude Code, ChatGPT) impossible jusqu'au 03/10 sans qu'aucun test ne le
  voie — le test unitaire simule désormais ce refus.
- **Le protocole parle les deux générations** (moderne 2026-07-28 sans
  `initialize`, en-têtes vérifiés, `server/discover`, `resultType` ; legacy avec
  `initialize`, sans session). Tous les outils `readOnlyHint: true`.
- **Le cerveau d'analyste = `worker/mcp/guide.ts`** (consignes, définitions de
  `metrics.ts`, playbook, actions Yuno, prompts) + `enrich.ts` (constats en
  phrases) : un changement de définition dans `metrics.ts` / `fees.ts` se
  reporte au glossaire. Base de connaissances partagée avec l'Assistant Console :
  `supabase/functions/_shared/console-help-articles.ts` (redéployer
  `owner-assistant` après une modification).
- Pilier boissons : `DRINKS_PILLAR_LIVE = false` aussi dans
  `worker/mcp/config.ts` (sixième miroir). Adoption : `/admin/ai` →
  « Connecteur IA (MCP) » (`admin_mcp_usage`). Tests : `npx vitest run worker/mcp`.
- **Annuaires (Claude, ChatGPT)** : dossier `docs/mcp-directory/SUBMISSION.md`,
  pas à pas de Paul `docs/MCP_GO_LIVE_GUIDE.md`, compte de relecture
  `review@womber.fr` (`scripts/demo/create-reviewer-account.mjs`, démo seule).
  Une description d'outil DÉCRIT ce que l'outil rend, elle ne donne jamais
  d'ordre à l'IA (« appelle d'abord… », « réponds toujours… ») : c'est un motif
  de refus des deux annuaires — les consignes vivent dans `INSTRUCTIONS`. Une
  réponse d'outil ne porte ni horodatage technique ni identifiant de requête
  (`NOISE_KEYS`, `compact.ts`). Jeton de domaine OpenAI = secret Worker
  `OPENAI_APPS_CHALLENGE`, servi sur `/.well-known/openai-apps-challenge`.
  La politique de confidentialité est `/legal/privacy` ; `/legal/confidentialite`
  est l'engagement de confidentialité des aperçus démo : ne jamais les confondre.

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

## Collab club × orga : « Répartir via Stripe ? » OUI ou NON (2026-09-29)

Migrations `20260929130000` (règlement par virement), `140000` (normalisation
partout), `150000` (vendeur des reçus). Stripe n'est JAMAIS une condition d'une
collaboration. Règles intouchables :

- **Le mode vit dans le contrat** : `split_rules.settlement = {mode: 'stripe' |
  'transfer', collector: 'venue' | 'organizer', payment_terms_days: 7|15|30}`.
  Absent = Stripe. Barème ou tables `basis = 'total_spend'` ⇒ encaisseur FORCÉ
  au club. Trois miroirs exacts : `readSettlement` (front, `splitRules.ts`),
  `collabSettlement` (edge, `payment-split.ts`), `normalize_collab_settlement` +
  `collab_settlement_collector` (SQL, triggers sur contrats, contrats-cadres ET
  avenants — `apply_collab_amendment` recopie les règles brutes sur la soirée,
  donc les lecteurs SQL normalisent aussi). `normalizeSplitRules` PRÉSERVE le
  bloc. Testé : `collabSettlement.test.ts`, `paymentSplit.test.ts`.
- **UI = `SettlementModeSwitch`** (Oui / Non + encaisseur + délai) dans le
  bandeau contrat, « Proposer une soirée » (club), l'invitation d'un club
  (orga, email compris) et l'avenant ; `SettlementRecap` partout où le deal se lit.
- **Checkout en virement = charge DIRECTE sur l'encaisseur** (billets, tables ;
  boissons toujours club) et la vente garde `collab_split` (parts du contrat au
  moment de l'achat, `venue_direct` = consos d'un billet). La porte « paiements
  prêts » vérifie les comptes RÉELLEMENT utilisés (`checkPayoutReadiness`,
  `_shared/payout-readiness.ts`, miroir SQL `event_payments_ready`) : seul
  l'encaisseur a besoin de Stripe. Le partage se verrouille à la 1re vente PAYÉE.
- **Décompte** : `_collab_transfer_compute` (net = CA − remboursement − frais
  Yuno − Stripe estimé 1,5 % + 0,25 €, tables en ligne sur l'acompte, boissons
  seulement si l'orga a une part), figé par `freeze_collab_transfer_statement`
  (une partie niveau argent, soirée finie, jamais en accès assisté) ou par le
  cron `collab-transfer-freeze` à fin + 48 h (`collab_transfer_statements`).
  Le virement est une ligne `event_coorg_transfers` `source = 'collab'` : MÊME
  cycle que la co-organisation (IBAN, « J'ai viré », « Bien reçu », relances,
  litige auto, arbitrage `/admin/alerts`), liste partagée `CoorgTransferList`.
  Carte `CollabTransferStatementCard` sur la co-soirée ; « Ma part » et le
  panneau Argent lisent le décompte (les jambes Stripe n'existent pas). Les
  notifications `source = 'collab'` ouvrent la co-soirée, pas la page coorg.
  Un barème en virement passe par le décompte de fin de soirée (tout en SEPA).
- **Reçus** : l'organisateur encaisseur est le VENDEUR (son régime de TVA) dans
  `get_event_seller`, `save_invoice_on_creation` et l'email de billet — jamais le
  club, qui n'a rien reçu. Lu sur `collab_split` de la vente.
- **Contrat v`2026-09-29`** : `getCollabTerms(v, {tiered, settlement})` résout la
  note de l'article 3 (plus de fuite de `noteTiered` sur un contrat par pilier),
  les corps `transferBody` et insère l'article « Règlement par virement » (hors
  barème). Un contrat Stripe garde le texte de `2026-09-26` mot pour mot.
- **Org × org = co-organisation** (et non le contrat collab) ; `save_coorg_deal`
  refuse un accord sur une soirée dont le collab est déjà réglé par virement
  (`collab_transfer_unsupported`). Entre DEUX organisations, l'accord peut lui
  aussi répartir par Stripe — voir « Co-organisation » ci-dessous.

## Revue collab du 29/09 — argent Stripe, CA tables, équipe (points 3 et 4)

Migrations `20260929160000` → `181000`. Règles intouchables :

- **Remboursement d'une vente à jambes = sur le DELTA** (`_shared/refund-legs.ts`,
  testé) : une jambe retenue est RÉDUITE au prorata (jamais annulée par un
  partiel), une jambe versée reverse la part du delta. Base = part vendeurs
  (brut − frais Yuno, que le club ne rembourse jamais). `revenue_distributions.
  refunded_cents` = cumul appliqué ET verrou (mise à jour conditionnelle). Un
  remboursement PARTIEL (`owner-refund`) ne passe jamais la vente en
  `refunded` : le cron annulerait ses jambes et bloquerait le reste sur la
  plateforme. `reverse_transfer` seulement sur une charge à destination.
- **Webhook** : grand livre en INSERTION SEULE (`ignoreDuplicates`) — un upsert
  rejoué remettait une jambe versée en `scheduled` ; erreur d'écriture ⇒ l'erreur
  remonte et Stripe rejoue. Rétention « décompte » lue dans la métadonnée `hold`
  posée AU CHECKOUT (repli sur les règles pour les anciennes sessions) ; vente
  payée après un décompte accepté ⇒ versée au club + `admin_collab_late_sale`.
  Jambe en échec : `*_fail_count`, alerte `admin_transfer_release_failed` au 3e.
- **CA tables = total_price − service_fee − frais de gestion SI ABSORBÉS.**
  `total_price` ne contient PAS les frais de gestion (payés en plus par le
  client). Porte front `tableRevenue` (`fees.ts`, lit `fee_absorbed` : toute
  requête qui l'alimente sélectionne la colonne), miroirs `clubRevenue.table`
  (`_shared/posthog.ts`), `calcTablesRevenue` (owner-assistant) et les 21 RPC
  réécrites par `20260929170000`. Les données démo semées sont alignées
  (`scripts/demo/fix-table-fee-demo.sql`, seed corrigé).
- **Équipe orga dans le collab** : `collab_org_can_act(org)` = fondateur OU
  admin d'équipe, porte unique des RPC de contrat, avenants, pause /
  suppression, décompte et réception des virements ; partenariats via
  `can_access_partnership` (+ policy d'insertion). Front : `useCollabOrgCanAct`
  (un éditeur voit, sans bouton) et scope `useActingOrganizer` dans tout le hub
  Collaborations orga ; `invite-club-collab` accepte `organizer_user_id` (admin
  vérifié côté serveur) et refuse une soirée hors de l'organisation.

## Collab & co-organisation — porte, lien de vente, invitation SANS compte (point 5, 29/09)

Migrations `20260929190000` (porte), `200000` (liens), `210000` (invitations). Règles :

- **Porte : un co-hôte ÉDITEUR scanne.** `is_event_door_staff` (porte unique du
  manifeste, des billets, tables, guest list, sync hors ligne, conversion
  promoteur) ouvre la soirée au co-hôte `access = 'editor'` accepté : fondateur,
  membres d'équipe (admin/éditeur/scanneur) et staff videur d'un orga co-hôte,
  owner / `can_manage_venue` d'un club co-hôte. Un co-hôte `viewer` ne scanne
  pas. `OrgAppCheckin` liste les soirées par `orgEventsOr()`.
- **Un lien de vente suivi PAR PARTIE** (`ensure_event_party_link`,
  `get_event_party_links`, carte `CoorgSalesLinksCard` « Qui fait vendre ») :
  `tracked_links` ordinaire, `utm_medium = 'party_link'`, `utm_campaign = <clé
  de partie>`, possédé par la portée de la partie (visible aussi dans ses
  « Liens »). Compteurs visibles de toutes les parties, CA club (fees.ts, même
  formule qu'`_coorg_yuno_legs` sans Stripe) seulement pour qui voit l'argent
  (`coorg_sees_event_money`), le CODE seulement à sa partie. Attribution,
  JAMAIS un partage d'argent. Trigger `cohost_party_link_off` : un co-hôte qui
  part voit son lien éteint.
- **Co-organisation par email** (`event_cohost_email_invites`, RLS sans policy,
  tout par RPC) : `create_cohost_email_invite` (mêmes gardes
  qu'`invite_event_cohost` + démo ↔ démo sur l'ADRESSE), `get_cohost_email_invite`
  (anon : lecture du lien ; connecté avec la bonne adresse : options « au nom
  de »), `accept_cohost_email_invite(token, party)` (email identique, jamais en
  accès assisté ; `org:<moi>` crée l'espace organisateur à la volée — jamais un
  changement de `profile_type` d'un compte déjà pro —, sinon club possédé ou orga
  administrée ; passe ensuite par `respond_event_cohost_invitation`),
  `decline_…` (destinataire seul), `cancel_…` (partie principale niveau ≥ 2).
  `get_event_coorg.email_invitations` pour les parties principales. Page
  publique `/accept-cohost?token=` (`AcceptCohostInvitation`, DA publique,
  rechargement complet après acceptation).
- **Quota de fonctions edge ATTEINT (402, 29/09)** : l'email de co-organisation
  part par `invite-organizer-collab` avec `kind: 'coorg'`
  (`_shared/coorg-invite.ts`). Ne pas créer de nouvelle fonction : ajouter une
  action à une fonction existante.
- **Collab club → organisateur sans compte** (`organizer_claim_invitations`,
  onglet Inviter du club, `ClubInviteDealFields`) : l'invitation PORTE le deal
  comme dans l'autre sens (soirée du club encore sans orga, conditions par
  pilier ou barème, `SettlementModeSwitch`, langue de l'email) ;
  `accept_organizer_claim_invitation` crée l'identité `organizer_profiles` (elle
  manquait : « Un organisateur » côté club, `organizer_not_found` à
  l'invitation co-hôte) et ouvre le contrat PRÉ-SIGNÉ par le club (boissons
  100 % club, settlement normalisé par le trigger du contrat). Refuser exige
  d'être le destinataire. Emails : `buildOrganizerCollabInvitation`,
  `buildCoorgInvitation`, et `buildClubCollabInvitation` dit « pas besoin de
  Stripe » quand l'autre partie encaisse (`needsStripe`,
  `_shared/collab-invite-text.ts`).
- **Garde démo des invitations** : un compte `@womber.fr` n'invite qu'une
  adresse démo (collab dans les deux sens, co-organisation), et aucun email
  n'est envoyé à une adresse démo.
- **Bac à sable de test réel → démo** (migration `20260929300000`, décision de
  Paul pour tester avec Stripe live, **à REFERMER après les tests** :
  `DELETE FROM coorg_demo_sandbox_orgs`). `coorg_demo_sandbox_orgs` (RLS sans
  policy, une ligne = Amoris) laisse une organisation RÉELLE inviter un compte
  démo en co-hôte sur une de SES soirées en lien PRIVÉ
  (`coorg_demo_sandbox_status` : `ok` | `not_private` →
  `demo_sandbox_private_only`) ; sa recherche montre aussi la démo
  (`coorg_demo_sandbox_caller`, fondateur ou équipe). Jamais l'inverse, jamais
  par email. Deux verrous valent pour TOUTE soirée réelle, exception ou non
  (`coorg_party_is_demo`) : la case email du checkout ne nomme jamais une partie
  démo et le consentement ne s'y verse jamais (`get_event_marketing_hosts`,
  `_coorg_apply_cohost_consent`) ; le push de lancement ignore ses abonnés et
  son nom (`get_event_host_followers`). Reste visible : la soirée réelle et ses
  chiffres dans la Console démo, que les prospects ouvrent par les liens
  d'aperçu — retirer le partenaire démo à la fin du test.

## Collaboration : l'accord d'argent n'est JAMAIS une condition (2026-09-29 soir)

Préparé pour la première soirée multi-organisations (WOH + partenaires qui
ouvrent leur compte le soir même). Migrations `20260929270000` (+ `271000`,
rattrapage des liens). Règles intouchables :

- **Deux voies, choisies dans le formulaire de soirée ET dans les deux
  « Proposer une soirée »** (`MoneyAgreementPicker`, bloc « Contrat & partage de
  l'argent ») : « Réglé entre vous » ou « Encadré par Yuno ». Défaut : Yuno si
  le partenariat club × orga a des `default_split_rules`, sinon entre vous ;
  toujours entre vous pour une co-organisation seule. Le choix du lead est gardé
  sur `events.money_agreement` (`yuno` | `external`, lu par la page
  Co-organisation pour rappeler la suite ou se taire) — jamais écrit par un
  co-hôte (hors liste blanche de `protect_event_columns_from_cohost`).
- **Club × orga « Réglé entre vous » = PAS de contrat, un partage 100/0 par
  pilier** posé par `set_event_collab_external_agreement(event, tickets,
  tables)` (lead seul, refusé si contrat vivant ou vente) :
  `revenue_split_rules = {agreement:'external', tickets, tables, drinks 0/100}`.
  Le résolveur de paiement en fait une CHARGE DIRECTE sur la seule partie qui
  encaisse chaque pilier (billets / tables au choix, bar toujours club) — aucun
  circuit d'argent nouveau, pas de rétention, pas de décompte. Marqueur lu par
  `collab_agreement_is_external` (SQL) = `isExternalAgreement` (front,
  `splitRules.ts`, testé, préservé par `normalizeSplitRules`). Écrans : feuille
  de route sans signature (`CollabJourney external`), `ExternalAgreementCard`
  à la place du contrat, pastille hub « Réglée entre vous »
  (`collabNightStep` → `external`), notification `collab_external_added`.
  « Passer par un contrat Yuno » n'existe que tant que rien n'est vendu
  (trigger `guard_collab_contract_after_external`) : la proposition referme la
  vente jusqu'aux deux signatures, la signature remplace les règles.
- **Co-organisation dès la création** : bloc « Organisations partenaires » du
  formulaire (`CohostDraftPicker`, Yuno ou email, invitées à l'enregistrement,
  CRM partagé). Rôles renommés partout : **« Partenaire »** (`viewer`, PAR
  DÉFAUT — suit la soirée, SES ventes, SES liens, SES emails ; billets, tables,
  guest list restent au principal) et **« Co-gestion »** (`editor`). Ne jamais
  remettre « Édition » par défaut.
- **Chaque partie a SES liens de la soirée** : `seed_event_party_tracked_links`
  sème Instagram / TikTok / Newsletter / WhatsApp au nom de la partie (l'hôte
  garde `seed_event_tracked_links`), appelé à l'acceptation d'un co-hôte
  (trigger) et par `TrackedLinksManager` (portée de l'écran). Le « Lien direct »
  = le lien de partie (`label 'coorg'`, `ensure_event_party_link`). Ne jamais
  re-semer au nom de l'hôte pour un partenaire : ses ventes partiraient à l'hôte.
  **Toute l'équipe voit et gère les liens de SA structure** (`20260929280000`) :
  porte unique `tracked_link_team_can_read` (fondateur / admin / éditeur d'orga,
  owner / manager de club — jamais un scanneur), reprise par
  `get_tracked_link_stats` et par la policy `tracked_links_team_all` ; le CA
  d'un lien ne part qu'à `tracked_link_team_sees_money` (fondateur, membre
  `view_finance`, owner, manager finance / analytique), sinon `revenue = NULL`
  et l'écran le tait. Les chiffres des AUTRES parties vivent dans « Qui fait
  vendre ? » (`get_collab_party_breakdown`, niveau ≥ 1), jamais dans les liens.
- **Un email part sur les liens de QUI l'envoie** :
  `resolve_campaign_tracked_links(ids, channel, p_venue_id, p_organizer_user_id)`
  (portée de l'expéditeur passée par `send-campaign` → `fetchStudioLiveData`).
  Partenaire / co-hôte = SON canal, jamais celui de l'hôte ; hôte et plateforme
  = comportement historique. L'audience INFORMATIVE « acheteurs de la soirée »
  n'est résolue que pour une partie PRINCIPALE
  (`campaign_scope_is_event_principal`) : un co-hôte n'écrit qu'aux clients qui
  l'ont nommé.
- **Transparence par défaut** (`20260929290000`) : `events.partner_visibility`
  (`full` défaut | `volumes`), écrit par la seule RPC `set_event_partner_visibility`
  (organisateur principal, niveau argent ; garde INVOKER `guard_event_partner_visibility`
  qui refuse l'écriture directe). `coorg_cohost_sees_money` ouvre les montants à tout
  co-hôte accepté en `full` — via `coorg_sees_event_money` (breakdown, liens de partie,
  rapport, bande de ventes) et, pour un club co-hôte, dans `get_event_report` et
  `get_events_sales_summary`. La règle d'équipe tient (montants au niveau argent de
  CHAQUE partie), un club qui ne fait qu'accueillir ne gagne rien, et aucun réglage ne
  partage l'identité des acheteurs. UI : `PartnerVisibilityRow` (page Co-organisation),
  choix dans le formulaire de création, note côté partenaire quand un montant manque.
- **Espace partenaire** (`CoorgPartnerSpace`, en tête de `/…/coorg/:id`) : rôle
  et qui mène, « Où en est la soirée » (`get_collab_party_breakdown.totals`),
  « Tes ventes » (sa ligne), « Tes liens de la soirée », « Écrire à ma base »
  (`/campaigns/new?event=<id>` : `TemplateGallery` pré-remplit la soirée),
  « Analyse de la soirée ». L'argent sans accord = carte « Réglé entre vous »
  (`MoneyStatusCard`), l'accord Yuno s'ouvre d'un clic (« Passer par un accord
  Yuno ») ou d'office si le lead l'a choisi.

## Co-organisation — N parties sur une soirée (2026-09-28)

Design + analyse : `docs/designs/COORGANIZATION_PLAN.md`. Migrations `20260928100000`
→ `100400`, front `src/lib/coorg.ts`, `src/components/coorg/*`, page
`/owner/coorg/:eventId` et `/organizer-app/coorg/:eventId`, onglet « Co-organisation »
des deux hubs Collaborations. Règles intouchables :

- **Deux étages, jamais mélangés.** Le collab contractuel reste à DEUX (1 club + 1 orga,
  partage Stripe automatique) : un paiement Stripe n'a que deux jambes chez Yuno. Les
  CO-HÔTES (`event_cohosts`, orgas OU clubs, `editor` / `viewer`, `share_crm`, 8 max) ne
  sont JAMAIS ajoutés au split ni au contrat collab. Au-delà de deux parties, l'argent
  passe par l'accord + décompte + virements — c'est la réponse à « on ne vend pas ce que
  le logiciel n'assume pas ».
- **Une partie = une clé** `venue:<id>` / `org:<uuid>` ; `event_parties(event)` rend
  principales (colonnes de l'événement) + co-hôtes acceptés, principal d'abord.
  `coorg_party_level(uid, clé)` : 3 = fondateur / admin d'équipe / owner / manager finance
  (argent), 2 = gestion, 1 = lecture. Seules les parties PRINCIPALES invitent.
- **Scope** : toute nouvelle RPC « soirées de la portée » ajoute
  `OR e.id IN (SELECT cohost_event_ids_org|venue(X))` au prédicat écrit à la main ; côté
  PostgREST, `orgEventsOr()` / `venueEventsOr()` (champs calculés `cohost_org_ids` /
  `cohost_venue_ids`, filtrables dans un `or=`). Les fonctions du CONTRAT collab (split,
  avenants, allocation guest list, fil de messages) n'en font pas partie.
- **Un co-hôte éditeur ne touche jamais la structure** : `protect_event_columns_from_cohost`
  (INVOKER, liste BLANCHE de colonnes design + vente au quotidien). Ajouter une colonne à
  `events` = décider si elle entre dans cette liste. Les portes
  `can_manage_event_design/tables/guestlist_house` s'ouvrent au co-hôte éditeur.
- **CRM = consentement NOMMÉ.** La case email du checkout (billets, tables, guest list ×2)
  nomme tous les hôtes `share_crm` (`useEventMarketingHosts`, `Intl.ListFormat`), et
  `shareCheckoutConsent` verse le contact à chacun APRÈS la création de la vente, avec la
  preuve (`marketing_consent_events`, source `…:cohost`). Jamais sur le seul accord hérité de
  la portée principale : « déjà abonné à l'hôte » ne vaut pas accord pour les co-hôtes (la case
  revient, en ne nommant que les hôtes à qui il reste à demander). **Un accord se demande UNE
  fois par destinataire** (décision de Paul, 2026-10-01, migration `20261001310000`) : une
  fois pour Yuno sur toute la plateforme, une fois par club / organisateur.
  `get_event_marketing_hosts` rend `email_opted_in` par hôte pour l'appelant connecté ;
  `useEventMarketingHosts` écarte les hôtes déjà acquis ; `MarketingOptIns` ne rend plus une
  ligne déjà accordée et disparaît entièrement quand tout l'est (le retrait vit dans Réglages
  → « Mes abonnements » et au pied des emails, plus au checkout). Ne jamais remettre un
  résumé « déjà abonné » ni un lien de retrait dans le checkout.
  Le SMS reste à la portée principale (`smsScopeName`). Le serveur n'agit que
  si une vente / inscription de < 3 h de CETTE adresse porte la case cochée.
- **Marketing** : `collect_email_automations` — recettes `new_event` et `last_call`
  seulement — couvre les soirées co-hébergées (`coorg_marketing_event_ids`) ; R5 garde une
  annonce par personne. Push de lancement : `get_event_host_followers` (abonnés de tous les
  hôtes, noms « A × B ») — remplacé le 30/09 par le moteur de notifications
  (annonce = union des audiences de `event_parties`, une notification par personne).
- **Argent** : accord (`event_coorg_deals`, parts %, simple accord ou contrat signé, termes
  `coorgAgreement.ts`), décompte `_coorg_compute` (ventes Yuno NETTES au nom de qui les a
  reçues + lignes déclarées par chaque partie POUR ELLE-MÊME), validé par toutes les parties
  dans la même `version` (toute ligne / modif de parts la remet à zéro), puis virements
  (payeur déclare, SEUL le bénéficiaire confirme, référence `YCO-…`). Actions d'argent
  refusées en accès assisté. Un décompte validé est figé et verrouille ses parties.
- **Virements suivis comme le règlement promoteur** (`20260929100000`) : l'accord porte
  `payment_terms_days` (7/15/30, signé avec les parts) ; chaque virement a `due_at` puis,
  une fois annoncé, `confirm_due_at` (+7 j). Cron quotidien `coorg-transfer-followup`
  (`coorg_transfer_followup_sweep`) : IBAN manquant (bénéficiaire, /3 j), échéance proche,
  retard tous les 3 j (6 max), TOUTES les parties à J+7, super admin à J+14
  (`admin_coorg_transfer_overdue`), silence du bénéficiaire ⇒ litige `auto:no_acknowledgement`,
  jamais « reçu ». Le bénéficiaire relance (`nudge_coorg_transfer`, 1/24 h). Litige tranché
  par le super admin dans `/admin/alerts` (`admin_resolve_coorg_transfer`, motif obligatoire,
  `received` | `cancelled`) ; `_coorg_maybe_settle` solde le décompte.
- **Revue du 29/09** (`20260929110000`, `120000`) : un co-hôte ne reçoit un client QUE par la
  case qui le nomme — `contact_scope_customers`, RFM, segments orga, audiences pub, P&L et
  vue d'ensemble ne lisent PAS les soirées co-hébergées (ne jamais les y remettre) ; lignes
  de vente lisibles d'un co-hôte ÉDITEUR seulement ; CA d'une co-soirée visible par
  `coorg_sees_event_money` : partie principale, part dans un accord actif, OU co-hôte
  quand `events.partner_visibility = 'full'` (défaut depuis `20260929290000`). `share_event_marketing_consent` exige
  une PREUVE d'achat (session `cs_…`, id ou QR < 15 min) et les clés NOMMÉES ; une session
  impayée laisse une intention (`event_cohost_consent_intents`) consommée au paiement par
  trigger. Accord FIGÉ dès le début de la soirée (`coorg_deal_frozen` : ni annulation, ni
  parts, ni départ d'une partie qui a une part) ; inviter ne remet plus les signatures à
  zéro ; `sign_coorg_deal(p_version)` et `approve_coorg_settlement(p_fingerprint)` —
  une validation donnée sur d'autres chiffres tombe. Refusé sur un collab à barème. Le
  décompte ne compte que les tables EN LIGNE, sur l'acompte. Garde démo à l'invitation et
  au marketing. `coorg_party_level` / `is_event_cohost` ne renseignent que sur soi depuis
  l'API (`session_user = 'authenticator'`).
- **Deux organisations : « Répartir via Stripe ? » Oui / Non** (29/09, migration
  `20260929220000`). `event_coorg_deals.stripe_split`, porte d'éligibilité
  `coorg_stripe_split_blocker` (miroir front `coorgStripeSplitBlocker`, testé) :
  exactement deux parts > 0, deux `org:`, l'hôte parmi elles, aucun club sur la
  soirée ni contrat collab. Les checkouts billets et tables lisent
  `coorg_stripe_split_config` (service_role : accord ACTIF + compte Stripe du
  partenaire activé) via `loadCoorgStripeSplit` (`_shared/coorg-stripe.ts`) et
  le passent au résolveur (`SplitInput.coorgStripe`) : charge plateforme au nom
  de l'hôte (`on_behalf_of`), deux jambes `organizer` versées à fin + 48 h par
  le cron existant. Toute absence / panne = charge directe chez l'hôte comme
  avant : **jamais une vente bloquée** par ce choix. Le décompte ne change pas
  (il lit déjà les jambes au nom de qui les a reçues) et ne règle plus que le
  reste. Article « Encaissement » remplacé par `coorgArticles({stripeSplit})`.
  Changer le choix = nouvelle version de l'accord. Au-delà de deux parties :
  toujours décompte + virements.
- **Tables sans policy** (`event_coorg_*`) : tout passe par les RPC ; un smoke qui lit
  `event_coorg_transfers` en direct comme un pro doit rendre 0. Smoke rejouable :
  `scripts/demo/smoke-coorganization.sql` (57 étapes, annulé). Vitrine démo : « Yuno Rooftop
  Sunset » (décompte validé, virements) et « Rooftop Session » (contrat actif).
- **Garde partenaire collab rallumé** (`20260928100300`) : `protect_event_columns_from_partner`
  et `protect_recurring_template_from_partner` étaient SECURITY DEFINER avec un test
  `current_user`, donc ÉTEINTS, et `v_is_lead` valait NULL sur une soirée menée par le club —
  l'orga partenaire réécrivait `revenue_split_rules`. Désormais INVOKER ; ne jamais les
  repasser DEFINER, et ne jamais y comparer une colonne GÉNÉRÉE ou recalculée par un autre
  trigger (`search_title`, `is_discoverable`, `discovery_status`).

## Hub Collaborations — deux onglets, une action, une liste (2026-09-29)

Plan : `docs/designs/COLLAB_SIMPLIFICATION_PLAN.md` (skill `simplification`).
Le système (contrat club × orga, co-organisation à N parties, barème,
virements) se présentait comme deux produits côte à côte, chacun avec sa liste,
sa boîte de réception, son carnet et sa façon d'inviter. Règles :

- **Un seul hub pour les deux consoles** : `CollabHub`
  (`src/components/collab-hub/`), monté par `OwnerCollaborations` et
  `OrgAppCollabHub`. Deux onglets `?tab=nights|partners` ; les anciens
  (`events`, `coorg`, `organizers`, `invite`) sont traduits par
  `resolveCollabHubTab` (`src/lib/collabHubNav.ts`, testé) et l'URL réécrite.
  Ne jamais rouvrir un troisième onglet : une nouveauté se range dans l'un des deux.
- **Une seule porte d'entrée : « Nouvelle collaboration »** (`NewCollabDialog`)
  → proposer une soirée à un partenaire / ajouter un partenaire Yuno
  (`?tab=partners&request=1`) / inviter hors Yuno (dialogue, `&invite=1`) /
  co-organiser à plusieurs (`EventPickerThenInvite`). Un chemin fermé dit
  pourquoi (plan Collaboration, pas encore de partenaire). Seuls les boutons
  « Proposer une soirée » des cartes partenaires (`&propose=<id>`) doublent le
  premier chemin, en contexte.
- **Soirées = « à traiter » puis UNE liste** : propositions, avenants,
  invitations de co-organisation (chaque boîte se tait vide), puis
  `useCollabNights` fusionne contrats (`events` + `event_collab_contracts`,
  contrat VIVANT prioritaire) et co-organisations (`get_my_coorg_events`) par
  soirée (`mergeCollabNights`). Carte = affiche, date, « Avec … », UNE pastille
  d'étape (`collabNightStep`, ordre d'urgence), lien vers la page qui répond
  (`collabNightHref` : contrat sinon co-organisation). La carte ne montre
  qu'une DEMANDE de pause / suppression en cours (`CollabActionControls
  requestsOnly`) ; les boutons vivent sur la page de la soirée, repliés sous
  « Gérer la collaboration » (`buttonsOnly`). Pas de chiffres ni de liens
  d'outils sur la carte : la page de la soirée les porte.
- **Partenaires = une personne, une ligne** : partenariats club × orga, puis
  contrats-cadres, puis `CoorgPartnersSection` qui écarte les clés déjà
  partenaires (`excludeKeys`). Historique replié.
- **Page de co-soirée** : l'outil « Co-organisateurs » mène à
  `/…/coorg/:id` (un 3ᵉ organisateur sur une collab) ; plus de tuile « Page
  publique » (l'en-tête a « Voir ») ; club = une tuile « Porte & live » ; la
  carte Billetterie orga ne s'affiche sur une co-soirée que si elle informe
  (le club tient la billetterie, ou Stripe manque) ; montants par
  `useNumberFormat`.
- **La page d'une co-soirée est un CENTRE DE CONTRÔLE** (29/09, phase 2 du
  plan) : pleine largeur (`max-w-[1680px]`, jamais `max-w-5xl`), feuille de
  route + chiffres + argent, puis deux PAGES FILLES dans le même onglet —
  `…/sales` « Ventes de la soirée » (`CollabEventSales`, une liste par onglet
  `?tab=`, seul l'onglet ouvert charge) et `…/partners` « Qui fait vendre ? »
  (`CollabEventPartners`, RPC `get_collab_party_breakdown`) — sous la coquille
  `CollabEventSubPage` (fil d'Ariane `CollabBreadcrumb`). Plus AUCUN long
  déplié d'analyse ou de listes sur la page : l'analyse générale vit dans le
  rapport de soirée d'Analytics (lien), pas recopiée. Les anciens `?tab=
  tickets|tables|guestlist|invoices` de la page redirigent vers `…/sales`.
- **Un outil s'ouvre dans un NOUVEL ONGLET, avec son fil d'Ariane.**
  `collabToolHref(path, {eventId, title, tool})` (`src/lib/collabTrail.ts`,
  testé) ajoute `from=collab&ce&cn&ct` ; `CollabTrailBar` (monté dans
  `OwnerLayout` et `OrgAppLayout`) le lit une fois, le garde pour CET onglet
  (sessionStorage) et ne s'affiche que tant qu'on reste dans l'outil. Tout
  outil pointe sur LA soirée : billetterie `?event=` (ouvre et défile),
  guest list `?event=`, promoteurs `/promoters/event/:id`, infos `?edit=`.
  Une soirée solo (hors collab) navigue comme avant, sans fil.
- **« Qui fait vendre ? » = attribution, jamais partage d'argent** : une vente
  revient à la partie dont le lien suivi (ou un de SES promoteurs) l'a amenée,
  sinon la conversion d'un de ses promoteurs, sinon (inscription) la part de
  guest list qui l'a reçue ; le reste = « sans partenaire identifié ». Portes
  et formules de `get_event_party_links` (CA pour une partie de niveau argent),
  statuts du rapport de soirée (guest list = toute ligne non annulée). Fonction
  STABLE en UNE requête (pas de table temporaire : l'aperçu démo est en lecture
  seule).
- **Deux instances de `CollabActionControls` sur une même soirée = deux canaux
  temps réel distincts** (`useId`) : un nom partagé rendait le canal déjà
  abonné et `.on()` après `subscribe()` levait — « Gérer la collaboration »
  ouvrait la page d'erreur. Tout composant monté deux fois par page nomme son
  canal par instance.
- **Joué en vrai le 29/09 à trois parties** (« Triple Collab Night », club ×
  Organisateur Démo × Asso Yuno co-hôte, semis `scripts/demo/seed-triple-collab.sql`).
  Règles qui en sortent : (1) **un co-hôte ÉDITEUR tient ses propres parts de
  guest list** (policy `Cohost organizers manage own guest lists`, migration
  `20260929250000`) — avant, « Ajouter une part » échouait en silence ; (2) **la
  liste maison porte le nom de celui qui la TIENT** (son `organizer_user_id`,
  sinon l'hôte de la soirée), jamais celui du compte qui regarde — chaque partie
  croyait que c'était SA liste ; (3) **toute lecture de parts d'une soirée
  ignore les réponses périmées** (`useGuestListParts`, `requestRef`) : ouvrir
  sur `?event=` affichait les parts d'une autre soirée ; (4) les co-hôtes sont
  nommés dans l'en-tête de la co-soirée ET de la page publique ; (5) la carte
  « Qui fait vendre » de la Co-organisation lit les chiffres de
  `get_collab_party_breakdown`, comme la page du même nom ; (6)
  `get_new_events_to_announce()` exclut la démo (`20260929251000`) : publier une
  soirée démo ne notifie jamais d'abonnés. Reste ouvert (décision produit) : un
  accord de co-organisation posé sur une soirée qui a DÉJÀ un contrat Stripe
  redistribue des ventes que Stripe a déjà réparties.
- **« Qui fait quoi » se DÉDUIT du mode, il ne se choisit plus** (29/09) : co-soirée
  et location de salle = `both/both`, « soirée de l'organisateur » = `venue/venue`
  (`defaultResponsibilities(mode)`, miroir `default_collab_responsibilities`). Le
  sélecteur a quitté le formulaire de soirée, les deux « Proposer une soirée », les
  séries récurrentes et les partenariats ; il ne vit plus que dans l'AVENANT
  (`CollabAmendmentDialog`). L'application serveur (trigger de garde, `can_manage_*`,
  demande de quota guest list) ne change pas. Toute lecture d'une valeur absente
  passe par `normalizeResponsibilities(valeur, event_mode)`, jamais `?? 'both'`
  (qui ignorait le préréglage de la soirée de l'organisateur). À la place du
  sélecteur, le formulaire montre les CONDITIONS D'ARGENT qui partiront dans le
  contrat (`ProposedTermsRecap`).

## Collaboration ouverte — un seul verbe, « inviter sur une soirée » (2026-09-30)

Plan : `docs/designs/COLLAB_OPEN_INVITE_PLAN.md`. Migration `20260930210000`.
Plus AUCUN partenariat préalable (demande + pourcentages) : on invite qui on
veut sur une soirée, l'acceptation vaut accord. Règles intouchables :

- **Une seule porte : `event_cohosts`, avec un RÔLE.** `role = 'principal'` =
  le LIEU (club invité par une orga qui mène) ou l'ORGANISATEUR (orga invitée
  par un club qui mène) ; un seul par soirée publique
  (`_collab_principal_blocker`). À l'acceptation,
  `respond_event_cohost_invitation` → `_collab_promote_principal` rattache la
  partie (`partner_venue_id` / `partner_organizer_id`, `event_mode`,
  responsabilités du mode), applique `principal_terms` (« réglé entre vous » =
  partage 100/0 ; « Yuno » = contrat pré-signé par le lead, réglé par VIREMENT)
  et passe la ligne en `promoted`. `role = 'cohost'` = Partenaire / Co-gestion.
- **Le formulaire de soirée n'écrit JAMAIS le partenaire.** Bloc unique
  « Avec qui fais-tu cette soirée ? » (`EventPartnersField`, règles pures
  `src/lib/collabInvite.ts`, testées), envoi à l'enregistrement
  (`sendPartnerInvites`). Une soirée reste solo tant que le lieu n'a pas
  accepté ; choisir un club comme lieu remplit l'adresse avec la sienne. Ne
  jamais remettre un sélecteur « club partenaire » ni un « mode de collab »
  hors de la ligne du lieu.
- **Par email** : une organisation → `create_cohost_email_invite` (rôle
  compris, elle crée son espace en acceptant) ; un CLUB hors Yuno n'arrive que
  comme lieu → `invite-club-collab` (son club se crée ; `default_split_rules`
  porte `agreement: 'external'` et `event_mode`, respectés par
  `accept-club-collab-invitation`).
- **Hub** : « Nouvelle collaboration » = « quelle soirée ? » (nouvelle /
  existante), qui ouvre `…/events?new=1` ou `?edit=<id>&focus=partners`,
  `&with=<venue:id|org:uuid>` pré-invite. Onglet `partners` = l'**Annuaire**
  (`get_collab_directory` : soirée en cours ensemble, en attente, invités par
  email, déjà travaillé ensemble ; anciens partenariats actifs inclus).
  Les dialogues « Proposer une soirée », les pages / onglets de partenariats et
  `CohostDraftPicker` sont supprimés : ne pas les ressusciter.
- Reste hors périmètre : `RecurringEventsManager` choisit encore l'organisateur
  d'une série parmi les anciens partenariats.

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

`/owner/analytics?tab=community&view=purchase` (et côté orga ; l'ancien `?tab=purchase`
est réécrit) (`PurchaseBehaviorView`, hook `usePurchaseBehavior`, helpers
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
(lots A-G livrés le 24/09, repris et joués sur la démo contre la vraie base le
25/09 — voir le dernier point). Règles posées :

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
  (backfill des « Publication » d'orga, le moteur de notifications la pose) ;
  `send-push-campaign` accepte `organizer_user_id` (fondateur ou admin
  d'équipe, audiences `followers` / `event_tickets` / `checked_in` /
  `all_customers` ; crédits et 1 campagne marketing / 24 h depuis le 30/09).
  L'historique = `get_push_campaigns(p_venue_id, p_organizer_user_id, p_filter,
  p_event_id, p_limit, p_offset)` : toutes les campagnes paginées, ciblés /
  envoyés / ouverts (1er tap par personne) / acheteurs / CA (tap → achat < 72 h,
  CA club de `fees.ts`, remboursement déduit, CA seulement pour qui voit
  l'argent), résumé 30 j et abonnés (`followers.total/reachable/new30d`,
  bandeau `FollowersNudge`). L'annonce automatique d'une soirée s'appelle
  « Publication – soirée » (`campaignLabel`). `PushHistoryCard` ne compte rien.
  **Push MANUELS = politique client, deux familles** (migration
  `20260924190000`, `filter_manual_push_recipients(ids, kind, at)`,
  ensembliste, `service_role` seul) : `marketing` (abonnés, tous les clients,
  segments, RFM, abonnés d'agence) = opt-out `marketing` + heures calmes
  22 h → 10 h Paris jugées à l'heure d'ENVOI (planifiée ou non ; le cron juge à
  `scheduled_at`) + 1 / 24 h et 3 / 7 j tous expéditeurs (`notification_log`) ;
  `event` (`event_tickets`, `checked_in`) = opt-out seul, journalisé
  `event_campaign` (hors plafonds) : on parle d'une nuit achetée. Le dry_run
  rend `targeted` APRÈS politique + `audience`, `held_back`, `quiet_hours`,
  `policy` ; l'envoi refuse `quiet_hours` (409) et `no_eligible_recipients`
  plutôt que de créer une campagne à zéro. Le super admin garde sa main.
- **Analytics = quatre familles, une question par page** (lot E, migration
  `20260924200000`). Adresse `?tab=sales|traffic|community|live&view=…`
  (`src/lib/analyticsNav.ts`, testé ; `useAnalyticsRoute`) : Ventes (Vue
  d'ensemble · Par soirée = Rapport de soirée · Partenaires = promoteurs),
  Trafic (Ma page · Par soirée — Sources fondue dans Ma page le 25/09),
  Communauté (Vue d'ensemble · Abonnés · Achats · Public, Goûts rangés dans
  Public), En direct. Les vues retirées passent par `LEGACY_VIEWS`. Les anciens onglets (`global`, `event`,
  `purchase`) sont traduits ET l'URL réécrite en place ; un lien de soirée se
  construit par `eventReportHref(base, id)`, jamais à la main. Navigation
  commune `AnalyticsFamilyNav` (club + orga) ; les zones de l'ancien Global
  sont rangées (promoteurs → Partenaires, fidélité → Communauté, âge/sexe →
  Public, trafic web → Sources). `/owner/audience`, `/organizer-app/audience`,
  `/owner/hype`, `/manager/hype` REDIRIGENT : les Abonnés sont une vue de
  Communauté, le Hype Score vit dans le Rapport de soirée (slot `forecast`,
  club seul, `HypeEventForecast`) et le Night Report IA sous le verdict
  (`EventPostAnalysisView`, club seul : l'IA exige le rôle owner).
  `get_community_overview` lit la base vivante `contact_rows` (contacts,
  joignables, abonnés, participation 0-4+, dernier achat par tranches de mois,
  croissance 24 mois, nouveaux contacts = PREMIÈRE soirée dans la portée,
  comme le Rapport) ; `get_page_traffic` lit `visitor_sessions` (page publique
  `venue_page` / `organizer_profile`, soirées de la portée). Même porte que
  `get_events_sales_summary`, aucun montant. Lexique : « Mix revenu »,
  « Settlement », « Funnel », « ROI » sont devenus des mots de pro
  (`owner.an.*`). Période et export ne s'affichent que là où ils changent
  quelque chose.
- **Codes promo par soirée = une porte serveur, jamais de cumul** (lot F,
  migration `20260924210000`, page `PromoCodes` sur `/owner/promo-codes` et
  `/organizer-app/promo-codes`, sous Billetterie ; orga : `requires="marketing"`,
  `PATH_CAPABILITY`). `promo_codes` = portée club OU organisateur, soirée
  précise ou toutes (le code d'une soirée gagne sur le code « toutes »), %
  ou € (par billet ; par réservation pour une table), piliers `tickets` /
  `tables`, paliers, quota, dates. Le client n'envoie qu'un TEXTE
  (`discountCode`) ; `check_promo_code` (anon) n'est qu'un aperçu,
  `claim_promo_code` (service_role, `FOR UPDATE`) redécide et RETIENT un
  usage 30 min dans `promo_code_redemptions` ; la vente y est reliée
  (`attach_promo_redemption`), le passage à `paid` confirme l'usage par
  trigger, un échec ou une expiration le rend. Toute panne du contrôle =
  pas de remise (`unavailable`). **Jamais cumulé avec la remise promoteur :
  la plus forte gagne** ; le promoteur garde son attribution, et
  `p_discount` / `promoDiscount` ne portent que SA remise. Table : remise
  sur l'acompte, jamais sur une formule `on_site`. Un code utilisé se
  désactive, ne se supprime pas. `?promo=CODE` sur la page soirée pré-remplit
  (sessionStorage). L'aperçu anon `check_promo_code` est freiné à 15 codes
  INCONNUS / heure / visiteur (`promo_code_failed_checks`, migration
  `20260925100000`, raison `rate_limited`) : sans ça les codes privés se
  devinaient par force brute. **Bug corrigé au passage** : la ligne Stripe des billets
  portait le prix PLEIN quand une remise promoteur existait (le client
  payait plein pendant que commission et reversements partaient du prix
  remisé) — elle porte désormais le sous-total remisé ; et le checkout client
  affiche la remise fixe promoteur × quantité et la remise table sur
  l'acompte, comme le serveur.
- **Goûts du réseau = agrégé, ≥ 10 par ligne, opt-out respecté** (lot G,
  migration `20260924220000`, `get_community_tastes`, vue Communauté → Goûts
  `CommunityTastesView`). Communauté = comptes Yuno liés à la portée (achat,
  guest list, abonnement) ; genres = quiz (`user_taste_profiles.genres`) ∪
  genres des soirées fréquentées sur TOUT Yuno depuis 18 mois. Un genre ne
  sort qu'à partir de 10 personnes, ses sous-comptes aussi (sinon `null`),
  `profiles.personalization_opt_out` exclut la personne du calcul, et la
  politique de confidentialité le dit (§ Destinataires, 24/09). Sous le seuil
  la vue est prête mais éteinte (`tastesReady`). Ne jamais exposer un genre
  sous le seuil ni une ligne par personne, y compris dans l'assistant.
- **Accusés de réception push : serveur prêt, extension iOS À FAIRE** (lot G).
  `send-push-notification` pose `mutable-content: 1` et `yr: {c, s}` (id de
  campagne, id d'abonnement) sur toute notification de CAMPAGNE (`?pc=`) ;
  `ack_push_delivery(c, s)` (anon, idempotent, campagnes < 3 j) écrit
  `push_campaign_events.event_type = 'delivered'` ; l'historique lit
  `get_push_delivery_counts` et n'affiche la colonne « Reçus » qu'au premier
  accusé (`hasDeliveryReceipts`). Reste une Notification Service Extension
  dans le binaire client (cible Xcode, `didReceive` : lire `yr`, POST
  `/rest/v1/rpc/ack_push_delivery` avec la clé anon, puis afficher le contenu
  tel quel) — elle ne part pas en OTA, donc prochaine version App Store.
- **L'Assistant Console lit les écrans d'analyse** (lot G) : outils
  `get_event_report`, `get_community_overview` (+ goûts) et `get_push_history`
  appellent les MÊMES RPC que les écrans, avec le client au JWT de l'appelant
  (`executeTool(…, userClient)`) — jamais le service role, sinon la porte de
  portée et d'argent (`auth.uid()`) tombe.
- Vérif visuelle sans compte : banc Vite (`harness.html` à la racine + entrée
  qui remplace `supabase.rpc` par des données d'exemple, env `VITE_SUPABASE_*`
  factices) + Chromium headless. Chromium headless ne descend pas sous 500 px de
  large : pour le mobile, contraindre le CONTENEUR, pas la fenêtre. Ne jamais
  committer le banc.
- **Reprise du 25/09 : rien n'avait été joué contre la vraie base, et ça se
  voyait.** Quatre migrations (190000→220000) n'étaient pas appliquées (404 sur
  Trafic, Communauté, Goûts, Codes promo), les edge functions de la branche
  n'étaient pas déployées, l'Analytics orga restait sur un spinner et les
  soirées démo à venir n'avaient aucune vente. Règles qui en sortent :
  - **Une vue ne charge que ses chiffres.** `useAnalyticsData`,
    `useNightAnalytics`, `usePromoterAnalytics`, `useCustomerAnalytics`
    prennent `enabled` ; les pages ne les allument que sur la vue qui les lit
    (Ventes › Vue d'ensemble, Partenaires, Communauté › Vue d'ensemble, le
    détail replié). Toute vue se rend tout de suite ; seul Ventes montre
    `AnalyticsLoading` sous la navigation. Ne JAMAIS reposer un verrou de page
    entière sur ces hooks : ~70 requêtes en série, 6 à 25 s pour ouvrir Trafic.
  - `useAnalyticsData` attend la liste des soirées (`eventsReady`) avant de
    calculer (sinon tout partait deux fois) et lance ses lectures en
    parallèle.
  - Ventes › Vue d'ensemble : remplacée le 25/09 par `SalesOverviewView`
    (voir « Lire une analyse en dix secondes » ci-dessous). Montants au format
    de la langue, jamais `€${n}`.
  - Rapport de soirée : `EventPostAnalysisView layout="report"` (dans le
    « Bilan complet » replié sous la phrase-réponse) et `HypeScoreSection compact` (sans
    métriques / tendance / comparaison, qui répétaient la section ventes avec
    d'AUTRES chiffres). Soirée passée : lignes « Fermé », pas de « rien
    aujourd'hui » ; un total nul n'affiche jamais « rien aujourd'hui » ni
    « 0 % » ; un pilier éteint n'étale pas ses formules.
  - Une vue rangée sous une question de famille n'a pas de second titre
    (`AudienceDashboard embedded`, `PurchaseBehaviorView` sans en-tête).
  - Communauté : la zone Fidélité héritée est réduite au top clients (ses
    tuiles contredisaient la page) ; « Nouveaux contacts » = les 10 dernières
    soirées QUI ONT EU DU PUBLIC (`20260925090000`).
  - **Démo pendant la vente** : `scripts/demo/seed-upcoming-sales.sql`
    (rejouable, borné à `demo_event_ids()`, efface ses lignes `seed.…`) sème
    billets, tables sur de vraies formules, guest list et visites (avec une
    ville, pour le Live View) sur les soirées à venir, et recale
    `ticket_rounds.tickets_sold` (le checkout l'incrémente, un INSERT direct
    non). Le relancer quand les dates passent. Codes promo de démo : `DEMO20`
    (club, Reggaeton Party) et `NEWSLETTER15` (orga, toutes soirées).
  - **Les automatisations email de la démo sont ALLUMÉES mais n'envoient
    jamais** (migration `20260925110000`) : `collect_email_automations()`
    saute toute recette d'une portée démo (`is_demo_marketing_scope(venue,
    orga)` : `demo_venue_ids()` ou orga `is_demo_email`). Toute réécriture
    de ce moteur garde ce filtre (et, depuis le 27/09, les workers d'envoi
    refusent de toute façon le périmètre démo : `demo_no_send`).
  - **Soirée orga SANS club de la démo = « Rooftop Session »**
    (`c0ffee00-25a9-4d3e-9c1a-0000000000a1`, 17/10, `solo_organizer`) :
    tables basic event-scopées (deux zones, trois formules dont une
    `on_site`), créées avec le jeton de l'organisateur. Disco Sundae est une
    collab menée par l'orga CHEZ le club (`partner_venue_id = womber`) : ses
    tables suivent le plan du club, n'y pose jamais de zone sans club. Une
    soirée démo créée à la main garde un `published_at` de plus de 72 h,
    sinon `get_new_events_to_announce()` (qui ne filtre pas la démo)
    l'annoncerait en push aux abonnés.
  - `audit.mjs` compte les collabs menées par le club
    (`partner_organizer_id`) ; la page Tables VIP orga les étiquette
    « Formules du club » (ce n'était pas « Non activées »).
  - Pages club Codes promo et Push = `OwnerHeader` comme les autres pages
    club ; côté orga, le titre reste dans la page (le layout a sa barre).
  - Codes promo joués en vrai (achat démo simulé `DEMO20`) ;
    `create-ticket-checkout` arrondit sous-total remisé et total au centime.
  - Tester en cloud : `scripts/demo/drive.mjs` lit l'environnement
    (`. scripts/ci-web-env.sh`, `SUPABASE_SERVICE_ROLE_KEY`), prend Chromium
    `/opt/pw-browsers` et le proxy `HTTPS_PROXY` ; importer la CA du proxy
    dans `~/.pki/nssdb` (`certutil`), sinon ERR_CERT_AUTHORITY_INVALID. Le club
    démo est caché : une page publique de soirée se teste avec un compte
    `@womber.fr`, jamais en anonyme (« Événement introuvable »).

## Analytics v3 — construite puis SUPPRIMÉE (2026-10-01)

Une refonte « un écran, sept onglets, un comparatif sur chaque chiffre » (plan
`docs/designs/ANALYTICS_REBUILD_PLAN.md`) a été construite dans la nuit du 30/09 au
01/10, puis **retirée le 01/10 au matin à la demande de Paul** après l'avoir vue en
vrai : « Je n'aime pas du tout le résultat … ramène toute l'analyse de donnée qu'on
avait avant, celle qui était complète et rouge. » L'écran Analytics est donc celui des
deux sections suivantes : quatre familles (Ventes, Trafic, Communauté, En direct),
grammaire « lire une analyse en dix secondes », rouge Yuno, et la mise en page du 30/09
(analyse globale sur une période, ou UNE soirée choisie dans la colonne « Soirées » à
droite). Tout le front v3 est supprimé (`src/components/analytics/v3/`, `useAn3`,
`src/lib/analytics/`, clés `an3.*`, `?v=` dans l'URL), et les lentilles par soirée du
30/09 avec lui (section suivante) : **ne pas le ressusciter, ni
proposer de nouveau un écran à onglets qui remplacerait les familles.** Une
amélioration d'Analytics se fait DANS l'écran existant (`kit.tsx`, familles,
`EventRail`, `AnalyticsSplit`). Restent en base, inoffensifs et sans lecteur front :
les RPC `get_analytics_*`, `_an3_nights`, `_an3_people`, `_an3_comparables`,
`night_date()` (migrations `20261001100000` → `150000`), l'attribution figée sur la
vente (`20261001200000`) et les digests par email, qui sont des emails, pas un écran.

## Analytics = la version du 24/09 au soir (plan Shotgun, lots A-G) + la colonne « Soirées » (2026-10-01)

Décision de Paul le 01/10, capture à l'appui (il a choisi entre le 24/09 midi, le
24/09 soir et le 30/09) : l'écran Analytics est celui du commit `1932dec1` (24/09
20:32, fin du plan Shotgun — section « Grammaire de l'analyse » ci-dessus) : quatre
familles Ventes · Trafic · Communauté · En direct ; **Ventes › Vue d'ensemble = le
grand tableau rouge complet** (cartes piliers Vue d'ensemble / Billetterie / Boissons
/ Tables VIP / Remboursements, ancres, revenu brut et horaire, bilan par soirée,
funnel, d'où vient le CA, la soirée, guest list, fidélité, trafic web, « ce que tu
touches »), Ventes › Par soirée = le Rapport de soirée, Trafic (Ma page · Par soirée
· Sources), Communauté (Vue d'ensemble · Abonnés · Achats · Public · Goûts). La
« simplification des chiffres » du 25/09 (section suivante : SalesOverviewView,
phrase-réponse, quatre KPI, périodes en soirées) NE S'APPLIQUE PLUS à cette page :
`SalesOverviewView`, `SalesPillarDetail`, `salesOverview.ts`, `useSalesOverview` ne
servent plus qu'aux accueils (`RecentNightsKpis`). Composants restaurés du 24/09 :
`DrinkAnalyticsSection`, `TicketAnalytics{Overview,Launch,Types,Phases}`,
`AnalyticsLockedOverlay`. Les composants partagés gardent leurs corrections
postérieures (chiffres justes du 25/09, CA club net du 29/09) : la page du 24/09 les
consomme sans changement. Le Rapport de soirée reste celui d'aujourd'hui (phrase,
objectif, « À retenir », repères). **Une seule grammaire, deux périmètres (01/10, demande de Paul)** : plus de
vue « Par soirée » ni de colonne. En haut à droite de Ventes › Vue d'ensemble, le
sélecteur rond `EventScopePicker` (pastille + liste défilante de toutes les soirées,
à venir puis passées, recherche, RPC `get_analytics_event_rail` via `useEventRail`)
dit ce qu'on regarde : « Toutes les soirées » (la période) ou UNE soirée (`?event=`,
`eventReportHref` → `view=overview&event=`, l'ancienne `view=event` est traduite).
Une soirée choisie = `mode: 'event'` sur LES MÊMES zones (piliers, ancres, revenu,
funnel, guest list, fidélité…), restreintes à elle, avec en tête ce qui n'a de sens
que pour une soirée (`EventReportView embedded` : phrase, jauges comparées, courbe
J-N, ce qui a fait vendre, qui achète, verdict après coup). Le pro n'apprend qu'une
lecture. Ne jamais remettre un onglet « Par soirée », un sélecteur en cartes ni une
colonne. **Les trois lectures du rapport existent aussi pour la période** (migration
`20261001300000`) : `get_sales_period_curve` (courbe J-N MOYENNE par soirée des
soirées commencées dans la fenêtre, contre la même durée juste avant),
`get_sales_period_drivers` (canaux, liens suivis, emails et push, attribution
clic → achat < 72 h), `get_sales_period_audience` (nouveaux visages = première
soirée dans la portée pendant la période, habitués sinon). Mêmes formules que
`get_event_report` via `_sales_period_tx` / `_sales_period_nights` (helpers sans
GRANT), porte `analytics_scope_gate` (un club ne voit pas le CA d'une soirée
seulement accueillie). Front : `usePeriodInsights` → `PeriodInsights` (`PeriodTrend`
+ `ReportDrivers` + `ReportAudience`, qui acceptent désormais des données de
période), posé dans la Vue d'ensemble en mode « toutes les soirées » juste avant
la bande « Ce que tu touches », avec les ancres `an-trend` / `an-drivers` /
`an-who`. Les fenêtres sont celles de la page (`dateRangeToWindow`, en heures) :
une soirée compte si elle a COMMENCÉ dans la fenêtre. **La guest list est un
pilier de la barre** (carte « Guest list », valeur = inscrits de la période) et
plus une zone de la vue générale (demande de Paul, 01/10 : « ça prend trop de
place »). Smoke rejouable : les trois RPC sous `set_config('request.jwt.claims', …)`
du compte démo dans une transaction annulée. Supprimés et à ne pas ressusciter : les lentilles du
30/09 (`event-lens/*`, `useLens`, `eventTraffic` / `eventCommunity` / `lensSeries`,
période dans l'URL) et la v3. Limite connue, héritée du 24/09 : la page attend le
gros jeu de chiffres (`useAnalyticsData`) avant de se rendre, même sur Trafic ou
Communauté — le gating par vue (`enabled`) existe dans les hooks, pas dans cette
page. Vérification visuelle : `node scripts/demo/drive.mjs --as owner --go
"http://localhost:8080/owner/analytics?tab=sales&view=overview" --shot …` (URL
absolue obligatoire : `APP_ORIGIN` vient de `.env.local` et pointe la prod).

## Lire une analyse en dix secondes — la simplification des chiffres (2026-09-25)

Plan et état des lots : `docs/designs/ANALYTICS_SIMPLIFICATION_PLAN.md` (lots
1-6 livrés, lot 7 « nouveautés » à faire). Né d'un constat : treize endroits
où le même mot portait deux chiffres différents (guest list comptée avec les
annulés ici, sans là ; deux « CA » sur le même accueil ; l'IA disait « 0
billet » quand le tableau en montrait 84). Règles :

- **Un nom = une formule, partout** : `src/lib/metrics.ts` (testé) est le
  dictionnaire — CA, Ce que tu touches, Billets, Tables, Guest list, Entrées,
  Présence, Remplissage, Dépense par tête, Panier, Clients, Nouveaux, Habitués,
  Visites, Conversion. Libellés `m.*`, définitions ⓘ `gl.*` (×3). Un chiffre
  nouveau prend un nom du dictionnaire ou y entre ; jamais un synonyme.
  `MIN_SAMPLE = 10` : en dessous, pas de pourcentage ni de répartition (âge,
  sexe, conversion) ; `readableDelta` passe à l'écart absolu au-delà de ±300 %.
  Les totaux d'une liste de commandes ne comptent que le PAYÉ.
- **Grammaire d'un écran d'analyse** : une phrase-réponse (`AnswerLine`) →
  quatre chiffres avec leur écart (`KpiRow`/`KpiTile` + `DeltaBadge`) → un
  graphique par soirée → une liste classée (`RankedList`) → le tableau des
  soirées → le reste dans `MoreDetail` replié. Blocs dans
  `src/components/analytics/kit.tsx` (`BulletBar` = jauge avec le trait de la
  référence, `StackBar`, `EmptyAnswer`, `ChoicePills`), formats dans
  `kitFormat.ts` (`useKpiFormat`). Un écran qui affiche plus de quatre
  chiffres en tête a oublié de choisir.
- **Les périodes se comptent en SOIRÉES, pas en jours** :
  `get_sales_overview(p_venue_id, p_organizer_user_id, p_period)` (migration
  `20260925130000`, `last` | `last4` | `month` | `year` | `all`) ne prend que
  les soirées PASSÉES et les compare au même nombre de soirées juste avant.
  Formules de `get_events_sales_summary` ; Entrées = billets scannés
  (quantité) + convives de table arrivés + guest list scannée. Elle sert
  Ventes › Vue d'ensemble (`SalesOverviewView`, un pilier à la fois, détail
  historique par pilier dans `SalesPillarDetail`) ET le bloc « Tes 4
  dernières soirées » des accueils club et orga (`RecentNightsKpis`) : l'accueil
  ne calcule plus son propre CA. Les graphes et « Top soirées » des accueils
  sont supprimés ; il reste ce bloc, « Vos prochaines soirées » et deux
  actions conseillées.
- **Rapport de soirée = une phrase d'abord** (`ReportAnswer`,
  `reportHeadline`, testé) : avant, « 92 billets vendus à J-3 sur 650, 21 de
  plus que <référence> au même moment » ; après, entrées / attendus, CA et
  dépense par tête. `get_event_report` rend `totals.door {entered, expected}`
  (migration `20260925140000`). Les jauges portent le trait de la soirée de
  référence au même J-N ; la prévision Hype tient en UNE ligne
  (`HypeProjectionLine`), score et calibration repliés ; le verdict passe
  dans « Bilan complet » replié. Une soirée sans vente ni entrée n'est pas
  notée (`reportHasActivity`).
- **Trafic = deux vues, Communauté = quatre** (`analyticsNav.ts`,
  `LEGACY_VIEWS` : `sources` → `page`, `tastes` → `demographics`).
  `get_page_traffic` rend les achats (`ordered`) de la page et de chaque
  source (migration `20260925150000`) : la conversion s'affiche dès 10 visites.
- **Lot 7, les nouveautés (25/09)** :
  - **Objectif de soirée** = `events.entry_target` (migration `20260925170000`),
    posé depuis le Rapport (`ReportTarget`, écriture directe sous la RLS
    d'`events`). Mesuré sur les ATTENDUS avant la soirée (`series[].people`,
    même définition que `door.expected`), sur les entrées après. Le rythme
    (`paceProjection`, testé) prend la soirée comparée si elle est terminée,
    sinon `report.pace` : la dernière soirée TERMINÉE de la portée (≥ 20
    attendus), choisie serveur. Sans objectif, cette ligne de rythme remplace
    la projection Hype — jamais deux projections côte à côte.
  - **« À retenir »** = constats calculés SERVEUR, 0 à 3, chacun avec un seuil
    de volume : `get_event_report.takeaways` (clé, ton, section qui prouve,
    paramètres ; texte `er.tk.*`) et `get_sales_takeaways` (Ventes, qui rend la
    vue d'ensemble COMPLÉTÉE : l'écran ne l'appelle qu'elle ; texte `so.tk.*`).
    Bloc `Takeaways` du kit. Un nouveau constat se pose en SQL avec son seuil,
    jamais calculé au front.
  - **Repères** de la courbe J-N = `get_event_report.markers` (publication,
    1re vente d'un palier qui n'est pas le premier, emails et push de la
    soirée), clés `er.mk.*`.
  - **Bilan du lendemain** (migration `20260925180000`,
    `_shared/night-recap.ts`, drainé par `process-scheduled-campaigns`) :
    11 h → 20 h Paris, soirées finies depuis 3 à 30 h, dédup
    `night_recap_log` réclamé AVANT l'envoi. Cloche de la Console toujours
    (`night_recap`, club via `emit_staff_notification`, orga via
    `emit_organizer_notification`) ; push Yuno Pro par la clé AUTO_PUSH
    `night_recap`, SEMÉE ÉTEINTE dans `/admin/notifications`, jamais pour la
    démo. Allumé le 25/09.
- **Démo, soirées PASSÉES** : `scripts/demo/seed-past-nights.sql` (rejouable,
  45 derniers jours, borné à `demo_event_ids()`) sème ventes et entrées des
  soirées passées — sans lui Ventes et « Tes 4 dernières soirées » sont vides.
  Le relancer quand les dates passent, comme `seed-upcoming-sales.sql`.
- **Migration sans CLI** : `POST https://api.supabase.com/v1/projects/<ref>/database/query`
  avec `SUPABASE_ACCESS_TOKEN`, puis la ligne dans
  `supabase_migrations.schema_migrations` et `notify pgrst, 'reload schema'`
  (sinon PostgREST rend 404 sur la fonction neuve). Toute réécriture part de
  `pg_get_functiondef` sur la base liée. **Avant de nommer une migration,
  `git fetch origin main` et vérifier que le timestamp n'y existe pas** : le
  25/09, `20260925160000` existait des deux côtés (deux migrations, une seule
  ligne dans `schema_migrations`, la seconde jamais rejouée par `db push`).
- **Revue du 25/09 — ce qu'elle a trouvé, à ne pas rejouer** :
  - Ventes compte en SOIRÉES TERMINÉES (`end_at`, sinon `start_at + 8 h`), et
    chaque ratio a son dénominateur servi par `get_sales_overview`
    (`money_nights`, `spend_revenue/spend_entries`, `presence_entries/expected`,
    `gl_presence_*`, `tables_presence_*`) : un CA sur 4 soirées divisé par les
    entrées de 3 donnait une « dépense par tête » fausse. Un palier de prix
    illimité rend la capacité inconnue (`null`), jamais la somme des autres.
    La comparaison n'est rendue que sur le MÊME nombre de soirées.
  - Rythme (`paceProjection`) et « même J-N » : jours PLEINS (`d > J`), et une
    soirée de référence doit être TERMINÉE pour servir après coup.
  - Un pourcentage de conversion s'affiche avec une décimale (`pctFmt(p, l, 1)`) :
    arrondi à l'entier, 0,4 % devenait « 0 % ».
  - Les liens de l'Analytics vers Compta / Push / Contacts n'existent qu'en
    Console Club (`consolePrefix === '/owner'`) : le manager tombait en 404.
  - Le bilan du lendemain ne montre JAMAIS le CA dans la cloche ; sans scan à
    la porte, variante `unscanned` (« aucune entrée n'a été scannée »), jamais
    « 0 entrée ». Son push (`night_recap`) est ALLUMÉ depuis le 25/09.
- **Arbitrages du 25/09 (ne pas rouvrir sans fait nouveau)** :
  - `staff_notifications` : une ligne `target_role = 'owner'` ne se lit que
    par le propriétaire (`venues.owner_id`), un compte au rôle `owner` rattaché
    au club ou un manager (`can_read_staff_notification`, `20260925188000`).
    Avant, un videur lisait ventes et virements par PostgREST.
  - Le registre des push auto (`isAutoPushEnabled`) se FERME sur une erreur de
    lecture, sauf pour une clé `transactional` : un interrupteur coupé ne se
    rouvre jamais sur une panne. supabase-js RENVOIE l'erreur, il ne la lève
    pas — un `catch` seul ne l'attrape pas.
  - Objectif de soirée = `set_event_entry_target` / `can_set_event_entry_target`
    (`20260925190000`) : l'écran ne montre le bouton que si la porte répond oui.
    Le posent le club qui porte la soirée, l'organisateur et son équipe
    (éditeur+), et le partenaire d'une co-soirée (chiffre du travail commun).
  - Produits du bar = part du CA CLUB de leur commande au prorata du prix
    carte (`20260925191000`) : la liste retombe sur le CA bar au centime.
  - Entrées = billets VALIDES scannés : un billet remboursé après le scan ne
    compte pas (9 sur toute la base au 25/09). Une seule formule dans cinq
    fonctions vaut mieux qu'un cas rare juste dans une seule.
  - Un organisateur partenaire voit le CA de toute la co-soirée : en barème,
    sa rémunération EST un pourcentage de ce total.
  - RPC d'analyse pro : jamais `anon` (`20260925189000`).
  - **Postgres accorde EXECUTE à PUBLIC par défaut** : 45 fonctions SECURITY
    DEFINER qui écrivent sans lire `auth.uid()` étaient appelables par un
    visiteur anonyme — créditer des SMS, distribuer des points, appliquer un
    avenant collab, marquer « servies » des boissons payées, effacer des
    factures. `20260925193000` les range : service_role seul quand seuls une
    edge au service role, un cron, un trigger ou une fonction DEFINER les
    appellent ; `authenticated` pour la Console ; `anon` gardé pour ce qui
    sert un visiteur (suivi, bio, liste d'attente, désinscription par jeton,
    aperçu de code promo, landing, accusé push iOS). **Toute nouvelle fonction
    SECURITY DEFINER finit par son REVOKE / GRANT explicite.** Inventaire à
    rejouer : `prosecdef` + `has_function_privilege('anon', …)` + corps qui
    écrit sans `auth.uid()`.
  - Archiver n'est pas servir : `archive_expired_event_orders` ne pose plus
    que `archived` (cron SQL `archive-stale-orders`). Les trois crons qui
    appelaient des edge disparues (404 horaires) sont retirés ; l'ancien
    travail supprimait des commandes payées et des factures, il ne revient pas.

## Stripe Connect — comptes connectés en Accounts v2 (2026-09-29)

Le premier organisateur réel (Amoris) n'a pas pu relier Stripe : la plateforme
refuse désormais tout compte créé avec le champ hérité `type: "express"`
(« Use Accounts v2, remove `type`, and set `losses_collector` to `stripe` »).
Porte unique : `supabase/functions/_shared/stripe-connect-accounts.ts` (sans SDK,
testé par `src/lib/__tests__/stripeConnectAccounts.test.ts`). Règles :

- **Création = `POST /v2/core/accounts`** avec `losses_collector: stripe`,
  `fees_collector: stripe` (le VENDEUR paie ses frais Stripe : c'est le modèle
  de `payment-split.ts` et de `fees.ts` en vente directe — avec `application`,
  Yuno les paierait sur sa commission) et `dashboard: full`. Club et organisateur
  = `merchant` + `recipient` (vente directe + jambes de co-soirée), DJ =
  `recipient`. Ne JAMAIS réintroduire `type` ni `stripe.accounts.create` direct.
- **Pays du compte = choisi par le pro AVANT la création, et définitif** (Stripe
  ne change jamais le pays d'un compte ; tout naissait en France, un club de
  Madrid se voyait demander un IBAN français). `NewConnectedAccount.country`
  (ISO alpha-2) part en minuscules en v2 (`identity.country`), en majuscules en
  v1 ; `defaults.currency` suit le pays (GBP, CHF, DKK… — jamais « eur » imposé
  à un compte hors zone euro) et `defaults.locales` la langue de la Console.
  Liste = `STRIPE_CONNECT_COUNTRY_CURRENCIES` (UE + Norvège, Liechtenstein,
  Royaume-Uni, Gibraltar, Suisse), miroir front `src/lib/stripeConnectCountry.ts`
  (testé). Hors liste (Maroc, Algérie, États-Unis…) : `stripe_country_unsupported`,
  RIEN n'est créé chez Stripe. `onboard` sans `country` (ancien bundle) = FR.
  Front : `StripeCountryField` + `useConnectCountry` AVANT le bouton, sur les cinq
  écrans qui créent un compte (Paiements club et orga, les deux guides de
  configuration, Bookings DJ) ; préremplissage profil DJ → ville → fin d'adresse
  Mapbox → fuseau du lieu → fuseau de l'appareil → FR. `Europe/Paris` sur un club
  est un signal FAIBLE : c'est le fuseau posé par défaut quand la ville n'était
  pas reconnue. `status` / `refresh` rendent `country` (« Pays du compte
  Stripe »). Un compte ouvert dans le mauvais pays ne se corrige pas : le fermer
  chez Stripe et vider la colonne, aucun outil Yuno ne le fait.
- **Filets** : une forme REFUSÉE (400/403/404, rien créé) passe à la suivante —
  v2 sans pré-remplissage, v2 vendeur seul, puis v1 par `controller` (mêmes
  responsabilités). Réseau, 429 ou 5xx n'enchaînent jamais (doublon possible).
  Tout échec final = code `stripe_account_create_failed` (traduit côté front par
  `stripeConnectErrorMessage`) + alerte super admin `admin_stripe_connect_failed`.
- **Onboarding** = lien v2 (`/v2/core/account_links`, configurations lues sur le
  compte), repli v1. **État** = lecture v1 d'abord (mêmes drapeaux que le webhook
  `account.updated`), repli v2. Colonnes écrites par `venueConnectColumns` /
  `organizerConnectColumns` — webhook, Console et checkouts écrivent pareil.
- **Tableau de bord = Express Dashboard** (2026-09-30, décision de Paul) : les
  comptes naissent en `dashboard: express` (v2) / `stripe_dashboard.type: express`
  (v1 de secours). Compatible avec charges directes + pertes et frais portés par
  Stripe (docs.stripe.com/connect/integration-recommendations). Le bouton
  « Tableau de bord Stripe » génère un lien à usage unique (`login_links`,
  `dashboardUrlFor`) à chaque clic ; il n'est jamais envoyé hors de l'app. Le
  pro s'y authentifie par code SMS / e-mail, sans second compte. Le tableau de
  bord `full` (dashboard.stripe.com) n'est plus que le DERNIER filet de création
  (`v2-full-dashboard`) et le repli si Stripe refuse un lien. Fonctions,
  marque et messages de l'Express Dashboard se règlent dans le Dashboard Stripe
  de Yuno (Connect → Express Dashboard : Branding, Features), pas par l'API.
  Les comptes déjà créés en `full` le restent (la propriété ne se change pas).
- **Le drapeau `charges_enabled` en base n'est qu'un miroir.** Les checkouts
  (billets, tables, boissons) revérifient chez Stripe un compte « inactif »
  (`checkPayoutReadinessHealing`, `healChargesEnabled`) avant de refuser un
  acheteur : Stripe active souvent l'encaissement quelques minutes après le
  formulaire, pendant que personne n'a la Console ouverte.
- **Link refusé sur un compte neuf = session recréée carte seule**
  (`createSessionWithPaymentMethodFallback`, Apple Pay / Google Pay compris) :
  en vente directe la session naît sur le compte du pro.
- **Front** : tout appel à `stripe-connect` passe par `invokeEdgeFunction` (vrai
  message serveur), le formulaire s'ouvre dans la page (un `window.open` après
  un `await` est bloqué par Safari), le tableau de bord par `openPendingTab`.
- **Endpoint webhook « Comptes connectés » OBLIGATOIRE avant toute vente
  directe** (pas à pas : `docs/STRIPE_CONNECT_WEBHOOK.md`) : une charge directe
  naît sur le compte du pro, ses événements (`checkout.session.completed`,
  `payment_intent.succeeded`, `charge.refunded`, `account.updated`…) n'arrivent
  QUE par cet endpoint, dont le secret va dans `STRIPE_WEBHOOK_SECRET_CONNECT`.
  Sans lui, un acheteur qui ferme l'onglet avant le retour paie sans billet.

## Stripe : CHARGES DIRECTES seulement (2026-09-29, avant la 1re collab réelle — WOH)

Vérifié sur le compte live « Yuno 360 » avec le MCP Stripe : les comptes connectés
naissent en « Managed Risk » (`losses_collector = stripe`), la seule forme que
Stripe accepte d'une plateforme qui n'a pas signé l'engagement de pertes. Contrepartie
écrite par Stripe : **charges directes uniquement**. Règles intouchables :

- **`splitMode: "separate"` est éteint** (`_shared/charge-policy.ts`,
  `STRIPE_INDIRECT_CHARGES_ENABLED` absent) : collab réparti par Stripe, barème
  retenu par la plateforme, co-organisation répartie par Stripe. Les trois
  checkouts refusent une telle vente AVANT toute réservation (message acheteur
  `checkout.collabStripeSplitUnavailable`, alerte `admin_indirect_charge_refused`),
  et `loadCoorgStripeSplit` n'est plus appelé (l'hôte encaisse, le décompte règle).
  Front : `STRIPE_AUTO_SPLIT_ENABLED = false` (`splitRules.ts`) grise « Oui » dans
  `SettlementModeSwitch` (qui bascule tout contrat en édition en virement) et masque
  le choix de la co-organisation. Les deux interrupteurs se rallument ENSEMBLE, et
  seulement après l'engagement de pertes signé chez Stripe ET des comptes créés en
  `losses_collector = application` (qui imposerait aussi `fees_collector =
  application` : tout le modèle de frais serait à refaire).
- **Une collab club × orga se règle donc par virement** (une partie encaisse en
  charge directe, `collab_split` suivi, décompte figé à J+2) ou « réglée entre
  vous ». Un billet de collab avec une conso du club fait toucher les deux
  parties : c'est pourquoi le mode Stripe 100/0 n'est pas non plus proposé.
- **La commission prélevée = les frais de service AFFICHÉS**, pour les trois
  piliers (`yunoFeeCentsOverride` toujours passé). Recalculée par
  `resolvePaymentSplit` sur le total, elle dépassait l'affiché dès 24,75 € de
  billet et sur chaque commande de boissons.
- **Webhook `checkout.session.completed`** : un échec passager de verify-* fait
  rejouer Stripe (le webhook ne rend plus 200 en silence) ; un échec définitif
  (ligne introuvable, montant incohérent) alerte `admin_paid_sale_unfulfilled`.
  Un litige alerte `admin_payment_disputed`. `stripe_fee_real_cents` ne compte
  que les lignes `stripe_fee` (sur une charge directe, `bt.fee` inclut la
  commission Yuno).
- **Achats en attente supprimés à 45 min** (session Stripe = 31 min après la
  ligne), et un billet payé compte toujours ses places même si sa réservation de
  10 min a expiré (`confirm_ticket_reservation`, migration `20260929290000`).
- **Refus de remboursement Stripe à la porte** (`staff-cancel`) : jamais écrit
  « remboursé » pour une commande liée, alerte `admin_refund_failed`.
- Virements de la plateforme en MANUEL : la balance Yuno ne contient que ses
  commissions (charges directes). État live au 29/09 : 0 compte connecté,
  endpoints « Yuno live » (`@self`) et « Connected accounts » (`@accounts`,
  5 événements, snapshot, clover) actifs.

## Remboursement d'une vente — une règle, un verrou, des effets uniques (2026-09-30)

Tout chemin qui rend de l'argent (Console `owner-refund`, annulation assurée
`cancel-ticket`, porte `staff-cancel`, webhook `charge.refunded` pour un
remboursement fait depuis le tableau de bord Stripe du pro) suit la même règle :

- **Plafond, reste et droits = `_shared/sale-refund.ts`** (pur, testé, importé
  tel quel par le front via `src/lib/saleRefund.ts`) : ce que le client a payé
  hors frais Yuno et assurance (l'acompte pour une table), moins
  `refund_amount`, cumul en CENTIMES. **Seul l'ENCAISSEUR rembourse**
  (décision de Paul, 30/09) : `saleCollector` désigne la partie dont le compte
  Stripe (`venues.stripe_account_id` / `profiles.stripe_connect_account_id`)
  est celui de la vente (`stripe_connected_account_id`), sinon la partie
  PRINCIPALE (club qui mène, sinon organisateur qui mène) ; une commande de
  boissons revient au club du bar. Chez l'encaisseur : owner ou manager
  `can_manage_refunds`, fondateur ou membre `org_member_has_permission(…,
  'refund')`. Un partenaire de collab ou un co-hôte ne rembourse JAMAIS une
  vente encaissée par un autre. Le front lit `useCanRefund()` (droit de rôle)
  puis l'action `rights` d'owner-refund (vente par vente) : ne jamais montrer un
  bouton que `refundAllowed` refuse.
- **Le montant se RÉSERVE avant Stripe** (mise à jour conditionnelle de
  `refund_amount` sur l'ancienne valeur), l'appel Stripe porte une clé
  d'idempotence, et un refus rend la réservation (`refundSaleOnStripe`
  tranche une réponse perdue en relisant la charge). Le webhook n'écrit que le
  cumul `amount_refunded` qu'il ne connaît pas encore : un remboursement fait
  depuis Yuno n'est jamais rejoué.
- **Effets = au gagnant de chaque mise à jour** (`_shared/sale-refund-effects.ts`) :
  le montant → stats de dépense, email, push, notification club ; le passage à
  `refunded` (`markSaleFullyRefunded`, conditionnel) → compteur client,
  fidélité. Un partiel ne passe JAMAIS la vente en `refunded`.
- **Places et crédits d'un billet = le trigger `trg_release_refunded_ticket`**
  (passage `paid` → `refunded` : `tickets_sold` baisse de `capacity_held`, sinon
  `quantity` ; billet scanné = place gardée ; crédits boissons supprimés). Ne
  JAMAIS décrémenter `tickets_sold` à la main dans un chemin de remboursement.
  `ticket_upsell_selections` n'a pas de statut : ses options valent tant que le
  billet est `paid`.

## Backend Supabase — gotchas critiques

- **La prod tourne sur la plus PETITE machine Supabase (offre gratuite, 426 Mo
  de RAM) et elle est déjà tombée** (05/10, ≈ 21:40 → 22:55 UTC : base, API,
  connexion et stockage UNHEALTHY). À vide elle swappe déjà ~390 Mo ; l'API
  REST met 21 s à recharger son cache de schéma après chaque migration (503
  `PGRST002` pendant ce temps). Récit, diagnostic et réparation :
  `docs/SUPABASE_PROD_HEALTH.md`. Règles pour TOUTE session : pas de cron
  chaque minute (5 min au plus fréquent) ; UN seul test SQL lourd à la fois sur
  la prod, après un coup d'œil à `pg_stat_activity`, jamais pendant la
  migration d'une autre session ; grouper les migrations et ne `NOTIFY pgrst`
  que si le schéma visible par l'API change. La base (525 Mo) dépasse aussi le
  quota de 500 Mo de l'offre gratuite : risque de passage en LECTURE SEULE. Vraie
  correction = offre Pro + machine Small, décision (et paiement) de Paul.
- **Migrations** : pousser via `supabase db push` (le CLI est configuré). Attention aux trous
  d'historique hérités de la migration Lovable→Supabase (réconciliation déjà faite une fois).
- **Gen types** : `supabase gen types ...` — **rediriger stderr** sinon le bruit pollue
  `src/integrations/supabase/types.ts`.
- **Cap fonctions edge** : historiquement, `supabase functions deploy` renvoyait **402**
  pour toute NOUVELLE fonction tant que le spend cap Supabase n'était pas relevé.
  **2026-08-06 : `agency-assistant` (fonction neuve) s'est déployée sans 402** — le cap
  ne bloque plus ; les fonctions codées-mais-jamais-déployées (auth mineurs, staff PIN,
  `promoter-payout-notify`) sont probablement déployables, à retenter.
  `promoter-payout-notify` EST déployée (constaté le 25/09) : elle embarque
  `_shared/auto-push.ts`, la redéployer avec les autres quand il change.
- **`events` a DEUX clés vers `venues`** (`venue_id`, `partner_venue_id`) : un
  `venues(…)` embarqué depuis `events` (ou sous `events!inner(…)`) est refusé
  par PostgREST (PGRST201) et la requête ENTIÈRE rend une erreur — liste vide,
  email qui ne part pas, sans bruit. Toujours `venues!events_venue_id_fkey(…)`.
  Même piège pour `events → profiles`, `tracked_links → venues`, etc. :
  `python3 scripts/check-selects.py` rejoue toutes les sélections statiques du
  code contre la base (`limit=0`) — le lancer après une migration qui ajoute
  une clé étrangère ou retire une colonne. Le 25/09 il en a trouvé 20
  (Commandes › Billets et Tables vides, page « Pour toi » des push découverte,
  six emails automatiques, timeline CRM, alerte de remplissage des tables…).
- **CORS-lock `yunoapp.eu`** : les edge functions n'autorisent que l'origine `https://yunoapp.eu`.
  → checkout impossible en local (échec silencieux, pas de toast) ET la prod DOIT servir depuis
  ce domaine exact.
- **`deno check` des edge functions en session cloud** (2026-09-30) : le proxy bloque
  esm.sh et deno.land. `python3 scripts/deno-check-edge.py [fn…]` génère une carte
  d'import (esm.sh → `npm:`, deno.land/std → raw.githubusercontent, types Stripe réunis
  en UN module — sans ça `new Stripe()` tombe en `any` et aucune ligne Stripe n'est
  vérifiée) puis vérifie une fonction à la fois. Deno et le CLI Supabase s'installent
  par npm (`deno`, `supabase` : binaire `@supabase/cli-linux-x64`, les releases GitHub
  sont bloquées) ; `functions download|deploy --use-api` marchent sans Docker.
  **Un client Supabase ne se type jamais par une interface structurelle écrite à la
  main** (overloads de `from`, chaînes `select().eq()`) : face au vrai client, TypeScript
  rend « excessively deep » ou « not assignable », c'est ce qui gardait au rouge
  send-ticket-confirmation, send-vip-confirmation, send-missed-you et
  send-next-event-recommendation.
  `SupabaseClient` 2.57.2 + `.returns<Row[]>()`, ou `RpcClient`
  (`_shared/rpc-client.ts`) pour un module qui n'appelle qu'une RPC.

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
  Les 12 328 contacts de `organizer@womber.fr` sont une copie MASQUÉE À LA
  SOURCE de la vraie base (27/09, `scripts/demo/restore-masked-contacts.sql` :
  « Ma••• », « ju•••a3f9c1@g•••.com », numéros de fiction ARCEP 06 39 98 /
  09 77 42 ; villes, âges, dépenses, fréquence et dates intacts) — jamais une
  vraie identité sur un compte démo, le jeton d'un prospect lit l'API. Le club
  démo porte 1 200 contacts fictifs (`seed-demo-contacts.mjs`, @example.*),
  et `seed-demo-engagement.sql` leur donne un historique d'envois (actifs /
  passifs / silencieux). **Envoi impossible sur tout le périmètre démo**,
  quelle que soit la session (Paul, agent, cron, prospect) : `send-campaign`,
  `send-sms-campaign`, `send-push-campaign` rendent `demo_no_send` (409) via
  `isDemoMarketingScope` et remettent en brouillon une campagne passée en
  file ; l'Email Studio le dit avant d'essayer (`studio.demoNoSend`). En
  aperçu, la COMPOSITION reste ouverte (migration `20260927162000` :
  INSERT/UPDATE sur `email_campaigns` / `email_campaign_templates`, RPC de
  segments ; jamais de passage en `sending` / `scheduled`) et toute donnée
  personnelle affichée est masquée par `previewGuard.ts` (`maskDeep`,
  appliqué à toute réponse PostgREST sauf les brouillons). Ne pas exécuter
  `scripts/rotate-demo-password.mjs` : les bundles publiés portent le mot de
  passe en dur.
- **Tout cron d'email ou de push passe par `_shared/demo-scope.ts`**
  (`loadDemoEventIds` + `isDemoEmail`) et S'ARRÊTE si la liste démo ne se
  charge pas. Le 25/09, quatre crons réactivés (`send-pre-night-checklist`,
  `send-next-event-recommendation`, `send-missed-you`, `send-low-ticket-alert`)
  allaient écrire aux invités semés de la démo. Piège : les invités de
  `seed-*.sql` sont en `@demo.womber.fr`, que le SQL `is_demo_email()`
  (`@womber.fr` exact) ne reconnaît PAS — `isDemoEmail` accepte les
  sous-domaines ; une porte démo SQL filtre donc par `demo_event_ids()`, pas
  par l'email.
- **Lien démo = lecture seule IMPOSÉE PAR LE SERVEUR** (2026-09-27, migrations
  `20260927160000` + `161000`, `_shared/demo-guard.ts`). Avant, la lecture seule
  ne vivait que dans l'onglet du prospect (`previewGuard.ts`, drapeau
  sessionStorage) : un 2ᵉ onglet, la console ou un appel HTTP avec son jeton
  faisaient tout — un prospect a relié un compte Facebook au club démo. Et
  `demo-login` était PUBLIQUE : un POST `{email}` sans jeton rendait une
  session en écriture sur `owner@womber.fr`. Désormais :
  - Toute session émise par un lien (`/preview/:token`) est enregistrée dans
    `demo_preview_sessions` (claim JWT `session_id`, même modèle que l'accès
    assisté) par l'edge de redeem, **fail-closed** (non enregistrée = révoquée).
    Une bascule de rôle depuis un aperçu passe par `demo-login`, qui MARQUE la
    nouvelle session (`origin = 'role_switch'`).
  - **PostgREST** : hook `pgrst.db_pre_request = public.pgrst_demo_preview_guard`
    posé sur `authenticator` → la transaction d'une session d'aperçu passe en
    READ ONLY (tables ET RPC, SECURITY DEFINER compris). Refus par défaut :
    seules les RPC de `demo_preview_writable_rpc()` (mesure, caches d'écrans)
    écrivent encore ; `export_*` est refusé en plus (le compte orga démo porte
    des adresses réelles). Une lecture qui écrit en douce lève en aperçu :
    on l'ajoute à la liste APRÈS l'avoir lue. Le hook tourne sur CHAQUE requête
    de la prod : il ne doit jamais lever hors de ce cas (sortie de secours :
    `ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';`).
  - **Storage** : policies RESTRICTIVE `demo_preview_no_*` sur `storage.objects`.
  - **Edge** : `demoPreviewGuard` en tête de toute fonction à effet de bord
    appelable par un pro (envois, invitations, remboursements, checkouts,
    PIN…) ; les assistants IA restent ouverts en aperçu mais SANS leurs outils
    d'écriture (`READ_ONLY_TOOLS`). `demoAccountGuard` refuse à TOUT compte
    @womber.fr — Paul et l'agent compris — ce qui relie un actif réel ou coûte
    de l'argent réel : `meta-connect` (tout), `stripe-connect` (sauf `status`),
    `club-subscription` (sauf `check`), `email-credits`, `sms-purchase-checkout`,
    enrôlement / coupure 2FA de `mfa`. Nouvelle fonction appelable par un pro =
    poser l'un des deux gardes.
  - **`demo-login` exige une session @womber.fr valide** (DemoSwitcher et
    bascule d'aperçu en ont une). Ne jamais la rouvrir sans jeton.
  - **Identifiants @womber.fr gelés** (`freeze_demo_account_credentials` sur
    `auth.users` : email, mot de passe, téléphone RÉTABLIS en silence ;
    `block_demo_account_mfa_factor` sur `auth.mfa_factors`) : GoTrue laisse une
    session de moins de 24 h changer le mot de passe sans réauthentification,
    ce qui cassait toutes les démos et rendait une session non marquée.
    Rotation volontaire = SQL avec `SET LOCAL yuno.demo_credentials_unlock = 'on'`
    (`rotate-demo-password.mjs` refuse désormais).
  - Front : `PreviewSessionSentinel` réarme la bannière dans un onglet sans
    drapeau (RPC `is_demo_preview_session`) ; `previewGuard.ts` laisse passer
    `demo-login` et bloque `auth.mfa.*`. Le front n'est que le confort : la
    vérité est serveur.
  - Limite connue : une session ouverte avec le MOT DE PASSE démo (livré en
    clair dans d'anciens bundles) n'est pas un aperçu — seuls les
    `demoAccountGuard` s'y appliquent.
- **Démo → vrai compte** (2026-09-26, migration `20260926120000`). Sur un lien
  d'aperçu démo classique (`/admin/demo-access`, icône « Compte à créer »), le
  super admin PRÉPARE le compte du prospect : club, organisateur OU association
  (trois offres distinctes), prénom, nom de la structure, email, ville, piliers,
  accès assisté proposé. Une association reste un compte organisateur
  (`pro_signups.kind = 'organizer'`) : le type vit sur le lien
  (`signup_association`, migration `20260927140000`) et les RPC le rendent en
  `kind = 'association'` à la démo ; `complete_demo_preview_signup` pose le
  statut Association (`bde_verified`, cf. « Compte Association ») dans la même
  transaction que l'ouverture (migration `20260927150000`). C'est une ligne
  `pro_signups` (`source = 'demo_preview'`) reliée par
  `demo_preview_links.signup_id` — le compte n'existe PAS avant le clic du
  prospect, qui choisit son email et son mot de passe. La démo porte alors la
  barre `DemoSignupBar` (en tête, DANS le flux : elle publie sa hauteur visible
  dans `--app-top-offset`, lu par la barre latérale fixe de `ui/sidebar.tsx`)
  et le bouton « Créer mon compte » de la pastille d'aperçu. La clé du brouillon
  et l'email ne sortent que de l'edge de redeem, APRÈS le mot de passe du lien
  (`demo_preview_link_signup`, service_role seul). La création
  (`src/lib/demoSignup.ts`) se fait dans un client Supabase JETABLE : l'onglet
  reste sur le compte démo tant que `complete_demo_preview_signup` n'a pas
  ouvert le club / l'espace orga — enveloppe de `complete_pro_signup` qui
  refuse tout compte `@womber.fr` et n'ouvre l'accès assisté que si Paul l'a
  proposé ET que le prospect a coché. Puis la session neuve remplace celle de
  la démo et la page recharge sur `/get-started`, comme un inscrit de la
  landing (le funnel se lit aussi dans `/admin/signups`). Jamais un
  `signOut()` global depuis une session démo : il couperait les sessions de
  Paul sur le même compte — `scope: 'local'`.
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

## PostHog — analytics produit, web + apps natives (2026-09-25)

`src/lib/posthog.ts` (porte unique) + `src/components/PosthogTracker.tsx`
(monté dans `App.tsx`, à côté de `PlatformTrafficTracker`). Règles :

- **Projet EUROPÉEN `284316` sur eu.posthog.com (2026-09-25).** Le premier
  projet avait été créé par erreur sur le cloud AMÉRICAIN : l'hôte EU refusait
  sa clé, aucun événement n'est jamais arrivé — et la politique de
  confidentialité promet un hébergement UE. La clé projet `phc_` (publique) du
  projet EU vit dans le CODE (`EU_PROJECT_KEY`, app et landing) : un build de
  production ne dépend d'aucune variable Cloudflare, et l'ancienne clé US est
  ignorée si une variable la porte encore (`DEAD_KEYS`). En dev, rien sans
  `VITE_POSTHOG_KEY` explicite. Même clé dans `scripts/ci-web-env.sh` et dans
  le secret Supabase `POSTHOG_PROJECT_KEY`. Vérifier une clé avant de la
  poser : `POST https://eu.posthog.com/flags/?v=2 {token}` doit répondre des
  flags, pas `authentication_failed`.
- **Consentement = `hasAnalyticsConsent()`**, la même case que la mesure
  maison : sur le web rien ne se charge avant l'acceptation ; un retrait
  coupe la capture, efface l'identité et purge `ph_*` (cookie compris, domaine
  parent). En natif le consentement analytics est acquis (cf. `consent.ts`).
- `posthog-js` est un import DYNAMIQUE : jamais dans le chunk d'entrée.
- **Identité = `user.id` seulement**, jamais email ni téléphone.
- **Replay jamais sur une surface pro** (app Pro, `isProPath`) : les
  `$snapshot` y sont jetés dans `before_send`. Champs de saisie masqués
  partout. Session d'accès assisté ⇒ aucun événement (il serait attribué au pro).
- CSP : `https://*.posthog.com` dans `script-src` et `connect-src`
  (`public/_headers` + `vite.config.ts`). PostHog est déclaré dans la
  politique de confidentialité, la page cookies et le DPA (`legalContent.ts`).
- **Plan de marquage = le type `YunoEvent`** (`src/lib/posthog.ts`), jamais
  une chaîne libre : `event_viewed`, `checkout_started`, `purchase_completed`
  (`pillar` tickets / tables / drinks, `payment` stripe / free / on_site,
  `value` en euros — tiré seulement quand CET appel a validé le paiement,
  `!alreadyProcessed`), `guest_list_joined`, `user_signed_up`,
  `user_signed_in`, `pro_event_created`, `email_campaign_sent`,
  `push_campaign_sent`. `capturePosthog` met en file tant que le SDK charge ;
  `usePosthogEvent` tire une fois par clé. Personne = `roles`, `is_pro`,
  `is_demo` : **filtrer `is_demo = false` dans tout insight** (la démo n'est
  pas un chiffre).
- **La landing (`yuno-landing`) écrit dans le MÊME projet PostHog**, sans
  cookie (`persistence: 'memory'`, pas de bandeau), événements `pro_signup_*`
  et `contact_form_submitted`, et identifie le compte créé par son id Supabase
  : le funnel landing → inscription → Console est un seul funnel.
- PostHog ignore les navigateurs automatisés (`navigator.webdriver`) : un test
  headless ne voit partir aucun événement sans
  `--disable-blink-features=AutomationControlled`.

**Tracking complet + dashboard « Yuno — Pilotage » (2026-09-25).** Règles :

- **`surface` sur CHAQUE événement**, recalculée à l'envoi (`before_send`) par
  `src/lib/posthogSurface.ts` : `web_app`, `pwa` (standalone), `ios_app`,
  `ios_pro`, `console` (tout `isProPath`), `admin` (exclu partout),
  `landing` (posée par la landing). Plus `is_demo` (toujours présent, `false`
  par défaut), et sur les apps iPhone `app_version` (« 1.2 (34) ») +
  `ota_bundle`. Ne jamais poser `surface` à la main dans une page.
- **Géo = `marketProps()`** (`src/lib/geo.ts`) sur tout événement lié à une
  soirée / un club / un organisateur : `market_country` (fuseau, ville en
  repli — il n'existe AUCUNE colonne pays), `market_city`, `event_id`,
  `venue_id`, `organizer_user_id`. Le pays du visiteur reste
  `$geoip_country_code`. Miroirs : `_shared/geo.ts` (edge) et
  `analytics_wh.market_country()` (SQL) — une règle ajoutée se reporte aux trois.
- **L'argent = `order_paid_server`** (`_shared/posthog.ts`), capturé sous la
  transition atomique pending→paid des trois `verify-*`, à l'inscription
  guest list (`create-guest-list-entry`, valeur 0) et à la table `on_site`
  (`create-table-checkout`). Propriétés : `pillar`, `payment`, `value` (brut,
  table = prix total), `club_revenue` (fees.ts), `paid_online`,
  `has_promoter`, `has_promo_code`, `surface` = surface d'ACHAT, `source:
  'server'`, géo, `event_title`, `is_demo`. Le contexte `analytics`
  (`getAnalyticsCheckoutContext` : consentement, surface, distinct_id) part
  dans le corps des `create-*` (`invokeEdgeFunction` pour les trois
  checkouts, explicite pour la guest list) puis dans les métadonnées Stripe
  `ph_*`. Sans consentement : distinct_id propre à la commande et
  `$process_person_profile: false`. Fire-and-forget, ne lève jamais. Secret
  `POSTHOG_PROJECT_KEY` (clé `phc_` publique). Redéployer les sept fonctions
  ensemble (`verify-*`, `create-*`, `create-guest-list-entry`).
  `purchase_completed` (navigateur) n'est PAS l'argent.
- **Nouveaux événements** : tous listés dans `YunoEvent` avec leurs
  propriétés en commentaire (découverte, étapes du paiement, codes promo,
  tables, boissons, Wallet, `app_opened` / `push_opened` / `pwa_installed`,
  bandeaux d'installation, `checkout_failed`, et côté pro publication,
  piliers, Stripe Connect, mise en ligne, codes promo, imports,
  automatisations, SMS, équipe, Live View, rapport de soirée, assistants IA).
  `app_opened.source` vient de NativeBridge (`noteAppOpenSource`). Jamais un
  événement par scan de porte : les entrées se lisent dans l'entrepôt.
  `capture_exceptions: true` (`$exception`, section Santé).
- **Entrepôt** (migration `20260925235000`) : schéma `analytics_wh`, VUES
  seulement, sans aucune colonne personnelle (acheteur = `buyer_key`, md5
  salé par `analytics_wh_private.salt`, sel illisible), démo exclue
  (CTE MATERIALIZED). Rôle `posthog_reader` : lecture seule, aucun droit sur
  `public`, mot de passe posé HORS migration au branchement de la source
  PostHog (pooler `aws-0-eu-west-1.pooler.supabase.com:5432`, utilisateur
  `posthog_reader.<ref>`). Ajouter une vue = pas de colonne email / nom /
  téléphone / IP / QR / remarque, jamais. Source PostHog branchée le 25/09
  (préfixe de tables `yunopostgres_`, copie complète toutes les 6 h). **Une vue
  SANS aucune ligne ne crée pas de table côté PostHog** : le script lit la
  liste réelle (`warehouse_tables`) et remplace par une tuile texte toute
  tuile SQL dont les tables manquent — le rejouer quand les premières ventes
  réelles arrivent (billets, tables, commandes, clubs sont vides hors démo).
- **Le dashboard est du code** : `scripts/posthog/pilotage.mjs`
  (`POSTHOG_PERSONAL_API_KEY=phx_… node scripts/posthog/pilotage.mjs
  --warehouse yunopostgres_`, dashboard 975173 du projet 284316), idempotent, qui pose aussi les
  filtres « comptes de test » du projet (`is_demo = true`, `surface =
  admin`) et l'épingle en accueil. Neuf sections dans CET ordre : 0 lecture,
  1 coup d'œil (12 chiffres comparés), 2 ventes, 3 tunnel, 4 surfaces,
  5 communauté, 6 offre (entrepôt), 7 acquisition, 8 santé. Une tuile
  ajoutée se range dans sa section, jamais dans une section à part ; on
  modifie le script puis on le rejoue, jamais le dashboard à la main.

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

## Cachets DJ — artistes hors Yuno, IBAN, virement, dépense (2026-09-30)

Migration `20260930100000`, front `src/lib/djPayout.ts` (testé),
`src/components/dj/DJSetPayout.tsx` (champs IBAN + fiche de paiement),
`DJFeesOverview.tsx`, `DJBankDetailsCard.tsx`. Smoke rejouable :
`scripts/demo/smoke-dj-external-fees.sql`. Règles :

- **Un set = un DJ Yuno (`dj_id`) OU un artiste externe (`artist_name`)**, CHECK
  `dj_sets_performer_chk`. Un externe vient du line-up (`guest_artist_id` →
  `event_guest_artists`) ou est saisi à la main ; il ne devient JAMAIS une ligne
  `djs`. Toute requête qui joint `dj_sets` à `djs` doit supporter `dj_id NULL`
  (nom : `performerName`, jamais `set.dj.stage_name` nu).
- **Le virement est porté par le set** (`payee_name`, `payee_iban`, photo prise au
  booking) : pré-rempli pour un DJ Yuno par `get_dj_payout_prefill(dj)` depuis
  `dj_payout_details` (une ligne par PERSONNE, saisie par le DJ dans « Mes
  paiements »), lisible seulement par une portée qui travaille avec lui (roster,
  line-up, set) ; saisi à la main pour un externe. Référence `YDJ-XXXXXXXX`
  (`djSetReference`). Yuno ne vire jamais : « Marquer comme payé » + moyen
  (`payment_method` transfer | cash | other).
- **`guard_dj_set_write` (INVOKER)** normalise (IBAN compact, `fee_paid_at` posé /
  effacé avec `fee_paid`), refuse IBAN et « payé » en session d'accès assisté, et
  ne laisse au DJ d'un set que `show_on_profile` (la policy
  `dj_sets_self_update_visibility` lui ouvrait toutes les colonnes). L'équipe orga
  (admin / éditeur) gère les sets (`Org team manages dj_sets`).
- **Le cachet est la dépense de la soirée** : le bilan par soirée
  (`EventsPnlLedger`, dans le détail replié du pilier « Tout » de Ventes ›
  Vue d'ensemble — `SalesPillarDetail`) lit les `dj_sets` de la portée et affiche « cachets DJ » et
  le reste ; aucune autre table de dépenses n'existe.

## Moteur de notifications push — Yuno envoie, les pros lisent (2026-09-30)

Design : `docs/designs/NOTIFICATION_ENGINE_PLAN.md` (Shotgun / DICE / Eventbrite,
décisions du 30/09). Migration `20260930230000_push_engine.sql`, edge
`_shared/push-engine.ts` (+ `push-engine-text.ts`, rendu pur testé), front
`src/lib/pushEngine.ts`, `usePushCenter`, `src/components/push/*`, admin
`/admin/notifications` (`AdminNotificationAutomations`). Règles intouchables :

- **Aucun club, organisateur ni agence n'active une notification automatique.**
  Les anciens interrupteurs (`venue_push_automations`, `agency_push_automations`)
  sont éteints par la migration et ne sont plus lus ; `push-automations.ts` et
  `customer-automations.ts` sont SUPPRIMÉS ; les clés `reminder_day_of`,
  `event_live`, `thank_you`, `almost_sold_out`, `drinks_preorder`, `win_back`,
  `birthday`, `agency_new_event`, `event_reminder_4h/30m`, `cart_abandonment`
  sont en catégorie `legacy`, éteintes. Ne jamais les rallumer ni recréer un
  toggle pro : une automatisation « à activer » est une automatisation que
  personne n'active, et un club qui l'active en double celle de la plateforme.
- **Neuf règles du cycle de vie d'une soirée**, une ligne
  `platform_notification_settings` catégorie `event_engine` (+ `params` jsonb
  réglés par le super admin) : `new_event` (annonce), `sales_open`,
  `last_tickets` (variantes places / tarif qui monte / tables), `last_call`,
  `checkout_abandoned`, `vip_upsell`, `event_day_reminder` (variante boissons),
  `doors_open` (jamais à un scanné), `after_thanks` (scannés seulement, variante
  prochaine date). Textes FR/EN/ES par règle, variante et RAISON dans
  `push_rule_templates` (éditables en admin, repli fr → `any` → `default`).
  Politique globale dans `push_engine_settings` (`admin_set_push_engine_settings`).
- **Une file, un arbitre.** Des collecteurs SQL idempotents
  (`push_engine_collect`, une passe par règle et par soirée via
  `push_rule_runs`, le panier en continu) écrivent `push_candidates` (personne,
  soirée, règle, famille, raison, `reason_party`, score, fenêtre, `dedup_key`).
  `push_engine_claim` décide : UNE notification marketing par personne et par
  passage (la plus utile), heures calmes 22 h → 10 h Paris, 1 / 24 h, 3 / 7 j
  (4 pour les engagés, 1 pour les fatigués), 2 par soirée et par personne,
  famille `urgent` (panier, tarif) 2 / 24 h, rappels (`reminder`) hors plafonds,
  `event` (info d'une nuit achetée) journalisé hors plafonds. Ce qui n'a pas sa
  place est REPORTÉ (`hold_reason`), jamais perdu avant `expires_at` ; une étape
  plus avancée envoyée périme l'annonce en attente (`superseded`), et rien de
  marketing ne part avant l'annonce programmée (`awaiting_announcement`).
  `runPushEngine` (appelé par `process-scheduled-campaigns`, budget 40 s)
  rend chaque texte, crée une campagne `source = 'auto'` par (règle, soirée),
  envoie par `send-push-notification` puis `push_engine_record`. Toute nouvelle
  notification liée à une soirée = une règle de ce moteur, jamais un envoi direct.
- **Soirées à plusieurs (collab, co-organisation)** : les candidats sont
  l'UNION des audiences de `event_parties(event)` + fans des DJ + abonnés
  d'agences, dédoublonnée PAR PERSONNE avec la meilleure raison ; le texte nomme
  la partie qui l'a touchée (`reason_party`), et chaque partie lit « ce que ton
  audience a donné ». Seules les parties PRINCIPALES programment l'annonce
  (`set_event_announce_at`, `push_event_settings.announce_at`, au plus tard 3 h
  avant). Les anciens clients (12 mois, préférence `marketing`) sont dans
  l'annonce : la reconquête et l'anniversaire n'existent plus.
- **Ce que voit le pro = `get_push_center(p_venue_id, p_organizer_user_id,
  p_days)`**, onglet « Automatiques » de `/owner/push` et `/organizer-app/push` :
  envoyées, ouvertes, acheteurs (tap → achat de CETTE soirée < 72 h, dernier
  tap gagne, jamais deux fois), influencés (achat < 72 h après réception sans
  tap), CA club (`fees.ts`, remboursement déduit, seulement pour qui voit
  l'argent), protégées, frise soirée par soirée. Aucun agrégat côté front.
- **Crédits de campagnes manuelles** (onglet « Mes campagnes ») : 1 crédit = 1
  campagne marketing (abonnés, tous les clients, segment, RFM, abonnés
  d'agence) ; offerts par mois (club 4, orga 4 — associations comprises —,
  agence 2, surcharge par compte), bonus sans expiration accordés en admin, pas
  d'achat. L'info soirée (`event_tickets`, `checked_in`) est GRATUITE, 2 par
  soirée et par partie. 1 campagne marketing / 24 h. Débit APRÈS l'insertion
  de la campagne (`consume_push_credit`, mois puis bonus), remboursé si la
  campagne n'atteint personne ou si une programmée est annulée
  (`cancel_scheduled_push_campaign`). Grand livre `push_credit_ledger`, tables
  sans policy d'écriture ; lecture `get_push_credits`, demande
  `request_push_credits` (alerte `admin_push_credit_request`, 1 / jour).
- **Déploiement** : la migration D'ABORD (elle éteint l'ancien monde, donc
  rien ne part deux fois quel que soit l'ordre), puis ENSEMBLE
  `process-scheduled-campaigns`, `send-push-campaign`, `send-push-notification`,
  `event-reminder` (ne garde que les alertes owner T-30 et staff 6 h) et
  `cart-abandonment-check` (panier de BOISSONS seul, `cart_abandonment_drinks`).
  Housekeeping : cron `push-engine-housekeeping` (04:37 UTC).

## Staff de nuit en équipe — plusieurs personnes au même poste (2026-09-29)

Revue complète des quatre postes avant les premières vraies soirées
(migrations `20260929233000` VIP, `234000` porte, `235000` vestiaire, `236000`
bar, `237000` compteur de porte). Règle unique : **chaque personne a SON compte, la base tranche qui a fait
quoi, le téléphone ne décide jamais.** Toute écriture d'équipe est soit un
`UPDATE … WHERE <état attendu>` dont on LIT le nombre de lignes, soit une RPC
qui verrouille. Un 0-ligne = « un collègue est passé avant » (message, relecture),
jamais un succès silencieux ni un écrasement. Une réponse perdue sur le wifi du
club se reconnaît (scan / service à MOI il y a < 60 s = succès, jamais « déjà fait »).

- **Hôte VIP** (`useVipNight`) : transitions de résa conditionnelles à l'état vu
  (`AlreadyHandledError`) ; une table = un groupe installé (index unique
  `uq_table_reservations_live_table` + verrou consultatif partagé avec
  `create_manual_table_reservation`) ; seule une résa qui TIENT la table la
  bloque (installée, pré-placée en attente, demande ouverte) — une table
  terminée se refait tourner. Avant la soirée, « placer » = PRÉ-PLACEMENT
  (table promise, client toujours `waiting`, jamais compté arrivé) ; une table
  promise s'affiche au prénom (`heldTables`) et se donne à un autre sur
  confirmation. Commandes et grand livre = RPC atomiques et idempotentes
  (`vip_create_table_order`, `vip_serve_table_order` qui relit les articles EN
  BASE, `vip_serve_items`, prix lus dans la carte, `p_request_id` par contenu de
  panier). `vip_table_orders` accepte enfin `preorder` (les pré-commandes du
  checkout étaient refusées en silence). Un client ne réécrit plus sa commande.
- **Porte** : la base signe le scan (`stamp_door_entry_scan` : auth.uid(),
  now(), jamais de dé-scan) ; le QR du billet ENTIER consomme ses QR nominatifs
  et un nominatif marque le billet (`door_*` triggers) ; statut / prix d'un
  billet intouchables côté client (`protect_ticket_immutable_fields`) ;
  « Arrivée VIP » et commission promoteur guest list = TRIGGERS (un émetteur,
  hors ligne compris) — ne jamais les réécrire côté client. Le videur refuse un
  QR d'une autre soirée en ligne (`isOtherNight`, soirées de `resolveDoorEventIds`,
  qui LÈVE sur erreur réseau). File hors ligne : refus définitifs retirés,
  réessai toutes les 2 min, déconnexion = rejeu avant purge. `staff-cancel`
  vérifie la portée AVANT tout remboursement et verrouille billet / commande.
- **Vestiaire** : `cloakroom_deposit` / `cloakroom_retrieve` (id choisi par le
  téléphone = idempotence, prix calculé par la base, prépayé utilisable une
  fois sur billet payé) ; numéro et QR uniques tant que le vêtement est là ;
  la soirée vient de `get_staff_night_pulse` (jamais « la dernière active ») ;
  le staff ne supprime plus un dépôt.
- **Bar** : servir = `bar_redeem_units` (commandes verrouillées, unités servies
  une à une, QR refusé EN ENTIER si une commande n'est pas payée, jeton / PIN =
  seulement ce qui reste et, en C&C, ce qui a été préparé, journal
  `order_unit_redemptions`). Click & Collect : le client n'a AUCUN droit
  d'écriture sur `orders` — la demande passe par `request_order_prep`
  (`src/lib/clickCollect.ts`), les transitions barman par `claim_order_prep`
  (claim / takeover après 10 min / release / ready). Le mode C&C du club =
  `set_click_collect_mode` : la policy qui ouvrait TOUTES les colonnes du club
  au « responsable C&C » (drapeau que chacun pouvait se donner) est supprimée,
  et le drapeau ne s'écrit plus soi-même. Un client ne passe jamais une
  commande « payée » (`protect_order_immutable_fields`).
- **Porte, suite** : un billet HORS CRÉNEAU n'est PAS consommé au scan
  (`pendingLateRef`) — « Accepter » valide l'entrée, « Refuser + remboursement »
  passe par `staff-cancel` (qui refuse un billet déjà scanné). Les entrées se
  comptent en PERSONNES par une seule fonction, `_door_headcount` (migration
  `20260929237000`), lue par le videur (`get_door_counters`) ET par
  `get_staff_night_pulse` : ne jamais recompter côté front.
- **Vestiaire d'organisateur** : la portée du vestiaire est la SOIRÉE
  (`cloakroom_transactions.venue_id` facultatif, `can_run_event_cloakroom`),
  la recherche de QR passe par `cloakroom_lookup` (le préposé n'a pas le droit
  de lire les billets), le prix vient de `cloakroom_event_price` (club, sinon
  `organizer_profiles.cloakroom_price` réglé dans Équipe, sinon 4 €).
- **PIN** : la session PIN (`staffSession`) porte le `userId` ; elle ne
  déverrouille plus un autre compte sur un téléphone partagé.
- **Déploiement** : ces migrations passent AVANT le front (les écrans appellent
  les nouvelles RPC), puis `staff-cancel`, `create-checkout`, `owner-assistant`.

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
  `auto_push_events` + clic `?an=`). Notification liée à une SOIRÉE → une règle du
  moteur de notifications (`_shared/push-engine.ts`, source='auto', clic `?pc=`,
  voir la section dédiée). Ne JAMAIS appeler
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
  Une fonction qui touche un secret ou un contournement (mot de passe de
  maintenance…) : `REVOKE … FROM PUBLIC, anon` explicite — le 25/09,
  `update_maintenance_password` était exécutable par un visiteur anonyme
  (`20260925186000`).
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
- **Automations push client** : RETIRÉES le 30/09 (`win_back`, `birthday`,
  `vip_upsell` venue-scopés, `customer-automations.ts` supprimé). Les anciens
  clients sont dans l'annonce de chaque soirée et le « passe en VIP » est une
  règle du moteur de notifications (section dédiée). Ne pas les ressusciter.
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
- **Styles de texte : `TextBlock.variant`** (`body` | `headline` | `kicker`,
  2026-10-02). Apparence définie UNE fois par `textLook()` (render.ts), lue par
  le rendu, le miroir `TextView` et l'inspecteur (réglage « Style ») ; copie
  dans le port Deno. Titre = gras serré 20-40 px ; sur-titre = mono capitales,
  accent passé par `readableOn` sur le fond du bloc. Un renderer qui ignore le
  champ retombe sur un paragraphe. Variable `{{soirée}}` = titre de la
  première soirée des données live (`liveEventTitle`), repli « la soirée » —
  jamais dans un OBJET (l'objet n'est pas interpolé avec le live).
- **Un aperçu se RELIE à la soirée comme l'envoi** : `bindBlocksToEvent(blocks,
  eventId)` (templates.ts), miroir du repli de `fetchStudioLiveData`. Le rendu
  ne lit le live que par `b.eventId` : sans ce lien, onglet Aperçu, Récap,
  aperçu de recette et vignettes « Mes modèles » montraient la carte
  d'exemple. Les vignettes de modèles se relient à la prochaine soirée du compte.
- `email-editor/` et `src/lib/emailCampaign.ts` ne servent PLUS qu'aux
  templates transactionnels admin (`AdminEmailTemplates`) — ne pas les
  utiliser pour les campagnes.

## Automatisations email — dix recettes, audiences automatiques, suggestions (2026-09-15, + 2026-10-02)

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
- **« L'habitué décroche » (`regular_lapse`, 2026-10-02, migration
  `20261002140000`)** : porte unique `_regular_lapse_candidates(portée, gap)`
  (moteur, aperçu, suggestion). Habitué = ≥ 4 NUITS distinctes (date locale −
  8 h) dans les 60 j avant sa dernière venue ; venue = billet payé/utilisé,
  table payée/confirmée, guest list SCANNÉE. Décroche = dernière venue entre
  gap et gap + 30 j (28/42/56 j, 42 par défaut) ; au-delà, la reconquête, qui
  saute toute personne relancée ici sous 60 j. Exclu s'il a déjà une place à
  venir dans la portée. La soirée se CHOISIT par personne (`pick_event_id`,
  soirées publiques 24 h → 35 j qui vendent) : +4 même série récurrente,
  +2 par genre commun (soirées fréquentées ∪ quiz `user_taste_profiles`, 2 max),
  +1 même jour, puis la plus proche ; repli prochaine soirée ; aucune soirée =
  personne. `trigger_key = 'rl-<date dernière venue>'`, 1 / 120 j, jamais en
  portée plateforme. Une campagne enfant par soirée choisie.
- **Modèles Yuno des recettes = trois familles** (refonte 2026-10-02,
  `starters.ts`, `recipeKit`) : URGENCE (bandeau noir `#0A0A0A` qui prolonge
  l'en-tête + compte à rebours : panier, palier, dernier appel), VIP (noir et
  or : passe en table), RELATION (éditorial clair, affiche en grand). Grammaire
  testée (`automations.test.ts`) : un sur-titre et UN titre avant toute offre,
  UNE offre en carte pleine (les autres en bandeau/compactes), un P.S. en
  dernier. Le texte de pied « pourquoi tu reçois cet email » a disparu (le
  pied de page légal le dit). Un modèle déjà créé chez un pro ne change pas :
  « Créer le modèle Yuno » sur la recette en fabrique un neuf.
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
  **Un email PAYÉ n'attend jamais la cagnotte** (2026-10-05, migration
  `20261007100000`) : dépassement payant Resend activé, la cagnotte de
  40 000 ne compte que l'OFFERT ; crédits Suite et Yunits CRM passent au-delà,
  sous un plafond absolu `email_platform_monthly_ceiling()` (230 000, sous les
  5 × 50 000 où Resend coupe TOUT, billets compris — à relever avec l'offre).
  `email_send_quota_month.paid_sent` = part payée ; offert = `sent − paid_sent`.
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
