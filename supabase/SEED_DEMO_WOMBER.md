# Démo Yuno — club "Yuno", orga "Yuno" + comptes liés

Données fictives **volumineuses et crédibles** pour des dashboards vivants pendant les appels de
vente. Le club et l'orga sont brandés **Yuno**. Tout est rattaché au compte existant `owner@womber.fr`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `seed-demo-womber.sql` | Crée les comptes + remplit tous les dashboards. **Idempotent** (rejouable). |
| `seed-demo-womber-teardown.sql` | Efface les données démo. Option B = supprime aussi les comptes liés. |

## Lancer (2 min)

Supabase Dashboard → **SQL Editor** (projet `fulawxvdlwtdlpkycixe`) → colle tout
`seed-demo-womber.sql` → **Run**. Un tableau récap (events, CA billets, commandes, conversions…)
s'affiche à la fin.

> Le script crée les 7 comptes liés. **Si la création auth échoue**, crée-les à la main
> (Auth → Add user → *Auto Confirm*, mdp `YunoDemo2026!`) puis relance : `organizer@`, `promoter@`,
> `affiliate@`, `dj@`, `bouncer@`, `barman@`, `cloakroom@` (tous `@womber.fr`).

## Identifiants

| Compte | Rôle | Mot de passe | PIN |
|---|---|---|---|
| `owner@womber.fr` | Club **Yuno** | *le tien* | — |
| `organizer@womber.fr` | Orga **Yuno** | `YunoDemo2026!` | — |
| `promoter@womber.fr` | Promoteur (club + orga) | `YunoDemo2026!` | — |
| `dj@womber.fr` | DJ MARCO V (club + orga) | `YunoDemo2026!` | `123456` |
| `affiliate@womber.fr` | Agence Yuno Network | `YunoDemo2026!` | — |
| `bouncer@` / `barman@` / `cloakroom@womber.fr` | Staff (club + orga) | `YunoDemo2026!` | `123456` |

## Rattachements (club Yuno **et** orga Yuno)

- **Staff** (videur/barman/vestiaire) : rôle + `venue_id` côté club **et** `org_staff` côté orga.
- **Promoteur** : 2 lignes `promoters` (scope club + scope orga), conversions/commissions des deux côtés.
- **DJ** : 2 lignes `djs` (club + orga) + sets + assignations sur les events des deux.

## Onglets peuplés (≥ 1 élément partout)

- **Owner** : Dashboard, Analytics, Live, Events, Ticketing, Guest List, Tables (zones + packs),
  DJs, Customers (CRM/RFM + bannis), Loyalty, Campaigns (email + SMS), Promoters
  (templates / teams / annonces / finance / assignations), Orders (drinks / tickets / VIP),
  Refunds, Staff, Menu, Upsell, Collaborations, Venue, Billing.
- **Organizer** : Dashboard, Events, Analytics, Customers, Campaigns, Promoters, Team
  (membre + staff), Partners, Guest List, Refunds, Organization / Profile, DJs.
- **Promoteur / Affilié / Staff / DJ** : dashboards remplis.

> Quelques onglets « avancés » optionnels (Story Builder, VIP Service, Hype, Scarcity) restent
> sur leur état de config par défaut — ils ne reposent pas sur des données de vente.

## À savoir

- **Écrit sur la PROD.** Club masqué (`is_hidden`), events non découvrables → invisibles au public.
- **MFA owner non touché** (ton propre authentificateur).
- Données démo tagguées (`purchase_source='demo_seed'`, emails `@demo.womber.fr`,
  `events.access_code='DEMO_SEED'`, `session_id LIKE 'demo-%'`) → teardown chirurgical.
- **Le dashboard admin agrège tous les clubs** : le CA démo Yuno gonfle les totaux plateforme.
- Aucune transaction Stripe réelle (ventes `status='paid'` directement).

## Bascule en démo (in-app)

Un bouton flottant **« Démo »** (bas-gauche) apparaît pour les comptes `@womber.fr` et permet de
sauter d'un profil à l'autre en 1 clic (composant `src/components/demo/DemoSwitcher.tsx`).

## Tout supprimer

Colle `seed-demo-womber-teardown.sql`. Option B (décommenter) supprime aussi les comptes liés.
