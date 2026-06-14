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

## Déploiement — Cloudflare Pages

Frontend statique sur **Cloudflare Pages** (backend déjà sur Supabase). Choisi vs Vercel car
free tier bande passante illimitée + aucune restriction d'usage commercial.

- **Root directory** : `/` (le repo GitHub `Yuno-app` a sa racine sur ce dossier).
- **Build command** : `npm run build` — **Output** : `dist`.
- **Node** : `.nvmrc` = 22 (Vite 8 exige Node ≥20 ; fallback env var `NODE_VERSION=22`).
- **SPA fallback** : `public/_redirects` (`/*  /index.html  200`) — sinon 404 au refresh.
- **Headers + CSP prod** : `public/_headers` (le CSP de `vite.config.ts` ne sert qu'au dev).
- **Variables d'env à mettre dans le dashboard** (`.env.local` non poussé) :
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_BASE_URL` (=`https://yunoapp.eu`),
  `VITE_MAPBOX_TOKEN`, `VITE_STRIPE_PUBLISHABLE_KEY` (clé `pk_live_…`).
- **Domaine** : brancher `yunoapp.eu` dès le départ (cf. CORS-lock ci-dessus).

## État du repo (2026-06-14) — à assainir

- **GitHub** : `github.com/paulbriseboispro-creator/Yuno-app` (projet Lovable, auto-commit).
  `main` poussé (`c66cb178`, 7 juin). Branche de travail `fix/guest-claim-tickets-tables`
  jamais poussée.
- **Gros écart non commité** : ~300 fichiers modifiés, ~30 supprimés, ~120 non trackés
  (dont 66 migrations). Tout le travail de juin est dans le working tree, pas dans git.
  À committer proprement avant tout push.
- **Fichiers parasites à supprimer (ne JAMAIS `git add -A`)** :
  `src/i18n/data 2.ts`, `src/i18n/data 3.ts`, `src/components/owner/co-event/EventGuestListModule 2.tsx`,
  `src/pages/OwnerDashboard.tsx.backup`, `components/` (égaré à la racine), `supabase/.temp/`.
- **Dossier parent** `/Users/paul/Desktop/yuno-app` = repo git de workspace séparé, sans remote.
  Le vrai projet est ce dossier-ci (`yuno-bar-buddy`).

## Règles de travail

- Toujours `git add <fichiers précis>` — jamais `git add -A`/`git add .` (parasites + binaires).
- Ajouter les 3 langues i18n pour toute nouvelle string.
- Migrations : un fichier par changement, timestamp croissant, push via CLI.
- Respecter le bon design system selon surface (public vs pro).
