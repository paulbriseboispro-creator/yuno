# Yuno

SaaS nightlife multi-tenant. Toute ta soirée dans une app : **billets d'événements,
réservation de tables VIP (bottle service) et commande de boissons** pour éviter la
file au bar. Côté pro : dashboards pour clubs, organisateurs, promoteurs, affiliés et
staff (barman, bouncer, vestiaire, hôte VIP).

Production : **https://yunoapp.eu** — multilingue EN / FR / ES.

## Stack

- **Frontend** : Vite + React + TypeScript + shadcn/ui + Tailwind (SPA + PWA)
- **Backend** : Supabase (Postgres + RLS + Auth + Storage + edge functions Deno)
- **Paiements** : Stripe + Stripe Connect
- **Carte** : Mapbox — **Emails** : Resend

## Développement local

Prérequis : Node 22 (`nvm use`) + npm.

```sh
npm install
npm run dev        # http://localhost:8080
```

Crée un fichier `.env.local` (non commité) avec :

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_APP_BASE_URL=https://yunoapp.eu
VITE_MAPBOX_TOKEN=...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Autres commandes :

```sh
npm run build      # build production → dist/
npm run lint       # eslint
npm run preview    # prévisualiser le build
```

## Base de données / edge functions

Géré via le CLI Supabase :

```sh
supabase db push   # appliquer les migrations
```

## Déploiement

Frontend statique sur **Cloudflare Pages** (build `npm run build`, output `dist`,
SPA fallback via `public/_redirects`, headers via `public/_headers`). Le backend est
déjà hébergé sur Supabase.

## Documentation

- **`CLAUDE.md`** — source de vérité du projet (architecture, conventions, gotchas, état).
- `docs/PRD.md` — specs produit.
- `docs/DESIGN_SYSTEM.md` / `docs/DESIGN_SYSTEM_PUBLIC.md` — design systems (pro / public).
