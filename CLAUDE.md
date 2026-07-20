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
- **Revenu club** : « CA Club / Net », fee Stripe 1.5 %, helpers dans `utils/fees.ts`. Refund côté club.
- **Supabase client** : anon key côté front (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
  Les secrets purs (Stripe `sk_`, Resend, Gemini, service_role) vivent **uniquement** dans les
  secrets Supabase / `.env.local` — jamais commités.

## Backend Supabase — gotchas critiques

- **Migrations** : pousser via `supabase db push` (le CLI est configuré). Attention aux trous
  d'historique hérités de la migration Lovable→Supabase (réconciliation déjà faite une fois).
- **Gen types** : `supabase gen types ...` — **rediriger stderr** sinon le bruit pollue
  `src/integrations/supabase/types.ts`.
- **Cap fonctions edge atteint** : `supabase functions deploy` renvoie **402** tant que le
  spend cap Supabase n'est pas relevé. Plusieurs fonctions sont codées mais **pas encore
  déployées** pour cette raison (auth mineurs, staff PIN, `promoter-payout-notify`).
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

## Règles de travail

- Toujours `git add <fichiers précis>` — jamais `git add -A`/`git add .` (parasites + binaires).
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
- Ajouter les 3 langues i18n pour toute nouvelle string.
- Migrations : un fichier par changement, timestamp croissant, push via CLI.
- Respecter le bon design system selon surface (public vs pro).
- **Tenir l'IA à jour** (voir section ci-dessous) : tout changement de fonctionnalité
  visible par un client ou un owner DOIT mettre à jour la connaissance des assistants IA.
- **Tenir le mode d'emploi à jour** : toute nouvelle fonctionnalité pro (ou changement
  d'un flux existant) DOIT mettre à jour le mode d'emploi owner (`/owner/help`) dans le
  même chantier — clés `ohelp.*` dans `src/i18n/data.ts` (les 3 langues EN/FR/ES) et
  structure dans `src/data/ownerHelpContent.ts`. Une feature sans doc n'est pas finie.

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

Deux assistants IA embarqués (modèle `gpt-4o-mini`, constante `OPENAI_MODEL`,
secret `OPENAI_API_KEY` dans Supabase) :

- **Client** : page `/assistant` → `supabase/functions/yuno-assistant/index.ts`.
  Sa connaissance produit vit dans `CLIENT_KNOWLEDGE_BASE` (mode d'emploi condensé).
  Les données (events, clubs, DJs, prix…) sont requêtées LIVE à chaque question —
  rien à faire de ce côté.
- **Owner** : bouton flottant du dashboard → `supabase/functions/owner-assistant/index.ts`.
  Sa connaissance vit dans `HELP_ARTICLES` (~32 articles keyword→snippet) et le
  `OWNER_SYSTEM_PROMPT`. Les données opérationnelles passent par ses ~25 tools (live).

**Règle de synchronisation — à chaque changement de fonctionnalité :**
1. Feature côté client (billets, guest list, VIP, boissons, fidélité…) →
   mettre à jour la section correspondante de `CLIENT_KNOWLEDGE_BASE`.
2. Feature côté owner (nouvelle page, nouveau flux, changement de frais/tarifs…) →
   mettre à jour ou ajouter l'article `HELP_ARTICLES` correspondant (keywords FR+EN,
   `path` = vraie route `/owner/...`, snippet 3-6 phrases, JAMAIS de référence de plan
   tant que `SUBSCRIPTIONS_ENABLED=false`).
3. Nouveau tool owner pertinent ? L'ajouter à `TOOLS` + `executeTool` (write → aussi
   `WRITE_TOOLS` + confirmation) — c'est ce qui rend l'IA capable d'AGIR, pas juste parler.
4. Redéployer : `supabase functions deploy yuno-assistant owner-assistant`
   (fonctions existantes → pas de blocage 402).
5. Mettre à jour le mode d'emploi owner en même temps (règle ci-dessus, `ohelp.*`
   3 langues + `ownerHelpContent.ts`) : l'IA et le centre d'aide racontent la même
   vérité, en même temps.

L'ancienne table `chatbot_training` (FAQ injectée dans le prompt) est abandonnée —
ne pas la réintroduire : la connaissance versionnée dans le code est la seule source.
