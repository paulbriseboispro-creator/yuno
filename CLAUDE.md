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
- **Deux design systems séparés** :
  - `docs/DESIGN_SYSTEM_PUBLIC.md` → pages publiques (éditorial, marketplace).
  - `docs/DESIGN_SYSTEM.md` → dashboards pro.
  Ne pas mélanger les deux esthétiques.
- **Rôles / routing** : guards par rôle dans `App.tsx` —
  `OwnerRoute`, `OrgAppRoute`, `PromoterRoute`, `AffiliateRoute`, `VipHostRoute`,
  `BarmanRoute`, `BouncerRoute`, `CloakroomRoute`, `DJRoute`, `ManagerRoute`, `BrowserRoute`.
- **App organisateur** (`/organizer-app`) : autonome mais réutilise des pages Owner ;
  conventions `org-ui`, gating Stripe via `canSell`.
- **Agence de promoteurs = entité FUSIONNÉE** (2026-07-27) : `agencies` est
  l'identité maître, `affiliates.agency_id` relie le bras externe (clubs
  non-Yuno, redirection billetterie). Triggers de provisionnement bidirectionnels
  + synchro d'identité agencies→affiliates (le linktree public suit le profil
  agence). Un chef d'agence = rôles `agency` + `affiliate`. Cockpit unique
  `/agency-app` avec sidebar unifiée couvrant `/agency-app/*` (contrats, ventes
  in-app, finance) ET `/affiliate/*` (clubs externes, linktree, trafic).
  Ne JAMAIS recréer un profil affilié autonome ; ne JAMAIS toucher au code
  argent (conversions/règlements/gardes) pour des besoins du bras externe.
  Tracking visiteur externe : uniquement via les RPC SECURITY DEFINER
  (`flush_affiliate_session`, `ping_affiliate_live`) — les UPDATE anonymes
  directs sont morts en prod. Voir `docs/AFFILIATE_SYSTEM.md`.
- **Revenu club** : « CA Club / Net », fee Stripe 1.5 %, helpers dans `utils/fees.ts`. Refund côté club.
- **Supabase client** : anon key côté front (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
  Les secrets purs (Stripe `sk_`, Resend, Gemini, service_role) vivent **uniquement** dans les
  secrets Supabase / `.env.local` — jamais commités.

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

## Accès assisté Yuno (« mode support ») — consentement du pro

Un super admin peut ouvrir une session GoTrue **dans le compte d'un pro consentant**
pour l'aider à configurer sa soirée, sans jamais connaître son mot de passe. Toute la
mécanique vit dans la migration `20260824120000_admin_support_access.sql`.

- **Le consentement est la porte** : `admin_support_grants` (demandé par l'admin,
  approuvé par le pro via `approve_support_grant`, coupé par l'un ou l'autre via
  `revoke_support_grant`). Grant 7 j, session 12 h. Page pro : `/owner/support-access`,
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

## Listes imprimables (guest list, tables VIP, billetterie)

`src/lib/rosterExport.ts` (rendu) + `src/lib/rosterBuilders.ts` (données) + le dialogue
`RosterExportDialog`. Trois formats : `door` (PDF de porte, gros noms A→Z, **jamais**
email/téléphone/montant), `detail` (PDF complet) et `csv` (BOM UTF-8 + séparateur `;`
pour Excel FR/ES).

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
  même chantier — clés `ohelp.*` dans `src/i18n/data.ts` (les 3 langues EN/FR/ES) et
  structure dans `src/data/ownerHelpContent.ts`. Une feature sans doc n'est pas finie.

## CRM club v2 (segments, attribution, automations — 2026-08-28)

- **Le scoring RFM vit dans `_venue_customer_rfm` (SQL) et NULLE PART ailleurs.**
  `get_venue_customer_segments` renvoie `rfm_segment/rfm_tier/churn_risk/is_guest`
  calculés serveur — ne JAMAIS re-répliquer les quintiles en TypeScript (la
  triplication historique a déjà fait cibler 0 personne en push). Les invités
  (guest checkout) sont des lignes synthétiques UNION lecture (`is_guest`,
  id = md5, user_id NULL) — le chemin paiement n'est pas touché.
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
  (2026-08-31) : `\n` = paragraphe, variables `{{…}}`, et depuis la passe
  d'amélioration `**gras**`, `*italique*`, `~~barré~~`, `__souligné__`,
  `[c=#hex|accent]…[/c]`, `[s=px]…[/s]`, `[url=…]…[/url]` — rendus par
  `inlineMarkup()` (appliqué APRÈS `escapeHtml`, jamais de HTML utilisateur),
  dupliqué à l'identique dans le port Deno. La barre de mise en forme de
  l'inspecteur enveloppe la sélection avec ces tokens ; l'édition reste un
  textarea, ne pas introduire de rich-text WYSIWYG/contenteditable. Les
  brouillons v1 migrés peuvent encore contenir du HTML (`looksLikeHtml`).
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
- **Bloc Réseaux = LIENS TEXTE, jamais d'icônes-images** (2026-08-31 soir).
  Les SVG de cdn.simpleicons.org étaient bloqués par Gmail et invisibles dès
  que le CDN ne répondait pas (il résout vers la plage Cloudflare
  188.114.96.x, sujette aux trous de routage FAI). `renderSocial` rend des
  liens capitales espacées (`socialLabel` : nom du réseau, domaine pour le
  site), couleur = `SocialBlock.color` sinon muted/footerText. Ne JAMAIS
  réintroduire d'images externes dans les emails sans hébergement propre en
  PNG. (`cdn.simpleicons.org` reste dans la CSP img-src, inoffensif.)
- **Règles de visibilité par bloc** (`cond`: vip_table / new_subscribers /
  buyers, onglet Dynamique) : résolues À L'ENVOI par lot via la RPC
  `get_recipient_block_conds` (fail-closed — RPC en échec ⇒ blocs
  conditionnels masqués). Les envois de TEST rendent tout (`ignoreConds`).
- **Quiet hours (23 h → 9 h Paris) et throttling par heure glissante** sont
  des portes de sortie propres de `drainSlice` (comme le quota) : le cron
  reprend, ce ne sont jamais des échecs. Fenêtre A/B par défaut : 4 h.
- `email-editor/` et `src/lib/emailCampaign.ts` ne servent PLUS qu'aux
  templates transactionnels admin (`AdminEmailTemplates`) — ne pas les
  utiliser pour les campagnes.

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
  gratuit : 100/jour, 3 000/mois, partagés avec TOUT le transactionnel). Passer
  en Pro exige un `UPDATE email_sender_state SET daily_cap_override = 25000
  WHERE scope_key = 'platform'`, sinon tout reste bridé. Dépasser le plan ne
  ralentit pas l'envoi : Resend renvoie des 429, les destinataires épuisent
  leurs tentatives et finissent en `failed` — on PERD des gens.
- **Warm-up non contournable côté client** : `email_sender_daily_cap()`
  (300 → 25 000 sur 6 jours) + plafond plateforme. Les quotas se consomment via
  `consume_email_send_quota` (service_role only) ; un plafond atteint met la
  campagne en attente du lendemain, ce n'est PAS un échec.
- **Marketing et transactionnel doivent vivre sur des domaines séparés.**
  `EMAIL_MARKETING_DOMAIN` (ex. `news.yunoapp.eu`) n'est lu que s'il est défini,
  fallback sur `EMAIL_DOMAIN` : le poser avant la vérification Resend ferait
  échouer 100 % des envois.
- **Import de liste** (`import_email_contacts`) : attestation de consentement
  obligatoire et horodatée, jamais de réactivation d'un désabonné explicite,
  bloqué en session support. Envoyer une campagne l'est aussi
  (`isSupportSessionToken` dans `send-campaign`) ; l'envoi de TEST reste ouvert.
- **Le front ne décide plus du statut d'une campagne.** `sendNow` ne force plus
  `status='failed'` en cas d'erreur réseau : l'envoi est asynchrone, il continue
  côté serveur. Le serveur est seul maître du statut.

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
- **Agence** : bouton flottant du cockpit `/agency-app` →
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
