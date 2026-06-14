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
  déployées** pour cette raison (auth mineurs, staff PIN, etc.).
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
- Ajouter les 3 langues i18n pour toute nouvelle string.
- Migrations : un fichier par changement, timestamp croissant, push via CLI.
- Respecter le bon design system selon surface (public vs pro).
