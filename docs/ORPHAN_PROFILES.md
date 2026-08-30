# Profils orphelins — état des lieux et plan

Relevé du 2026-08-30. **Aucune écriture n'a été faite sur ces données.** Le lot 1
(code et détection) est livré ; les lots 2 et 3 touchent aux données et attendent
une décision. Règle de conduite retenue : mieux vaut un compte inactif qu'une
chose cassée.

## Le fait

`public.profiles` contient **40 lignes** pour **33 comptes** dans `auth.users`.
Sept lignes n'ont plus aucun compte en face : personne ne peut se connecter en
tant qu'elles, et pourtant elles possèdent des clubs, des soirées, des billets et
des commandes.

Cinq de ces sept adresses ont **aussi** un compte vivant. Pour ces cinq-là,
`profiles` contient deux lignes portant le même email.

## Comment on en arrive là (reproduit)

Supabase propose deux suppressions. Le comportement diffère du tout au tout :

| Geste | `auth.users` | `public.profiles` | Conséquence |
|---|---|---|---|
| Suppression franche (`deleteUser(id)`) | ligne supprimée | supprimée **en cascade** | propre |
| Suppression douce (`should_soft_delete: true`) | ligne conservée, `deleted_at` posé | **survit** | orphelin |

La cascade n'est pas cassée : la FK `profiles_id_fkey (id → auth.users.id) ON
DELETE CASCADE` est bien active en prod, vérifiée deux fois — un `INSERT` de
profil sans compte est refusé (`23503`), et une suppression franche emporte bien
le profil.

Le piège est ailleurs. En suppression douce, la ligne `auth.users` reste, donc
rien ne cascade ; mais l'utilisateur devient invisible (absent de la liste admin)
et **une nouvelle inscription sur le même email réussit**, avec un nouvel `id` et
donc un **second** profil. C'est exactement la forme des cinq doublons.

`supabase/functions/delete-account/index.ts` appelle `admin.deleteUser(user.id)`
sans le drapeau : **le chemin de suppression de l'app est sain**. Les sept
orphelins viennent d'ailleurs — suppressions faites à la main et reprise
Lovable → Supabase (cinq d'entre eux datent du 19/11/2025, jour du dump initial).

## Qui possède quoi

| Email | Profil orphelin | Compte vivant | Possède |
|---|---|---|---|
| paul.brisebois@free.fr | `a8e96ff5` (19/11/25) | `fceae0a5` | **club Casanova**, 5 billets, 4 commandes, rôle `owner`, 2 clients CRM, 1 inscription |
| paul.brisebois.pro@gmail.com | `f026d68d` (19/11/25) | `c29dc8a5` | 8 billets, 11 commandes, 2 tables, rôles `vip_host` + `cloakroom`, 1 client CRM |
| owner@womber.fr | `d83b6736` (11/12/25) | `a810aed8` | rôle `client` seulement |
| paulsneakers8@gmail.com | `e7f15d5a` (07/01/26) | `fd68cd74` | **soirées RED NIGHT V4 + Secret Ritual**, 8 billets, 2 commandes, rôles `client`/`dj`/`promoter` |
| pbrisebois.ieu2025@student.ie.edu | `892571fe` (26/01/26) | `467789f2` | 28 billets, 39 commandes, 10 tables, rôles `client` + `owner`, 3 inscriptions |
| boulayg65@gmail.com | `f1711de4` (11/02/26) | **aucun** | 1 table, rôle `client`, 1 client CRM |
| margotbessoule@gmail.com | `1d160066` (19/04/26) | **aucun** | **club Le Bonsaï**, soirée « Test Private », 1 billet, rôles `client` + `owner` |

Les deux clubs concernés sont sans enjeu immédiat : ni l'un ni l'autre n'a de
compte Stripe (`stripe_account_id` NULL), aucune soirée à venir, deux soirées au
total. Le Bonsaï (Toulouse) et Casanova (Ségovie) ressemblent à des clubs de test.

## Ce que ça casse aujourd'hui

**1. Toute recherche de profil par email tombe en panne sur les cinq doublons.**
Vérifié en prod : `profiles?email=eq.paul.brisebois@free.fr` demandé en objet
unique renvoie `PGRST116 — The result contains 2 rows`. Deux appels utilisent ce
patron :

- [OwnerStaff.tsx:221](../src/pages/OwnerStaff.tsx#L221) — désignation du
  responsable Click & Collect. L'invitation staff est déjà partie quand l'erreur
  tombe : le club voit « impossible d'ajouter l'employé » alors que l'invitation
  est en route, et le drapeau n'est jamais posé.
- `admin-account-recovery` (lignes 280 et 355) — reprise d'un compte vitrine
  quand l'email est déjà pris. La récupération échoue au lieu de rattacher.

**2. Deux clubs sans administrateur.** `venues.owner_id` de Le Bonsaï et Casanova
pointe vers un profil sans compte : personne ne peut ouvrir leur dashboard.

**3. Historique d'achat invisible.** 50 billets, 56 commandes et 13 tables sont
rattachés à des profils morts. Leurs propriétaires légitimes (quand ils ont un
compte vivant) ne les voient pas dans « Mes Commandes ».

## Ce que ça ne casse pas

À ne pas surestimer — ces trois points ont été vérifiés, pas supposés :

- **L'inscription n'est jamais bloquée.** `profiles.email` n'a aucun index
  unique. Un orphelin ne empêche personne de créer un compte sur son email.
- **`email_has_account` dit vrai.** Elle lit `auth.users` en excluant
  `deleted_at`, donc elle donne exactement la même réponse que `auth.signUp`, y
  compris sur un compte supprimé en douceur (testé : RPC `false`, signUp
  réussit).
- **Aucun nouvel orphelin ne peut naître d'une suppression franche.** La cascade
  fonctionne.

## À ne surtout pas faire

**Ne pas supprimer les lignes orphelines.** Une bonne quinzaine de tables
référencent `profiles(id)` en `ON DELETE CASCADE`. Un `DELETE` sur ces sept
lignes emporterait 2 clubs, 3 soirées, 50 billets, 56 commandes et 13
réservations de table. C'est le geste qui a l'air le plus propre et c'est le
plus destructeur.

## Plan

### Lot 1 — Empêcher la récidive et réparer le code — ✅ livré le 30/08

1. **Ne plus jamais supprimer en douceur.** Le drapeau `should_soft_delete` est
   proscrit, dashboard Supabase compris. Inscrit dans `CLAUDE.md`.
2. **Les recherches par email ne tombent plus.** `OwnerStaff` cherche le
   responsable Click & Collect DANS le club au lieu de coercer un email en objet
   unique ; `admin-account-recovery` lit toutes les lignes et garde celle qui est
   réellement le fantôme de la vitrine.
3. **Le problème est visible.** `sweep_orphan_profiles()`, cron quotidien à
   7 h 20 UTC, compte les profils sans compte et les clubs sans propriétaire, et
   émet `admin_orphan_profiles` dans `/admin/alerts`. La clé de dédoublonnage
   porte les deux compteurs : silence au repos, alerte dès qu'un chiffre bouge.
   Fonction et cron séparés de `run_admin_alert_sweep()` pour ne pas avoir à
   redéclarer ses 200 lignes d'alertes.

Aucune ligne de données déplacée.

### Lot 2 — Re-rattacher (données, un dossier à la fois) — en attente de décision

Pour chaque orphelin qui a un compte vivant, déplacer ce qu'il possède vers le
compte vivant, colonne par colonne. Ordre conseillé, du plus sûr au plus délicat :

1. `venue_customers`, `guest_list_entries` — sans conséquence comptable.
2. `tickets`, `orders`, `table_reservations` — l'historique réapparaît dans
   « Mes Commandes ». À faire soirée éteinte, jamais pendant une nuit ouverte.
3. `user_roles` — attention aux doublons de rôle : la fusion doit dédupliquer
   (`ON CONFLICT DO NOTHING`), sinon la contrainte saute.
4. `events.organizer_user_id` puis `venues.owner_id` — en dernier, ce sont eux
   qui commandent les dashboards et Stripe Connect.

Chaque déplacement est un `UPDATE … SET user_id = <vivant> WHERE user_id =
<orphelin>`, vérifiable avant/après par un simple compte de lignes. Réversible
tant qu'on garde la correspondance orphelin → vivant écrite dans la migration.

**Deux cas sans compte vivant** — décision à prendre, pas de bonne réponse par
défaut :

- `margotbessoule@gmail.com` possède **Le Bonsaï**. Soit le club revient à un
  compte à toi, soit il part avec son profil.
- `boulayg65@gmail.com` ne possède qu'une réservation de table et un rôle
  `client`. Même question, enjeu quasi nul.

### Lot 3 — Purger (seulement une fois le lot 2 fini) — en attente du lot 2

Quand un profil orphelin ne possède plus rien, la ligne peut disparaître sans
cascade dangereuse. Vérifier d'abord que chaque table le donne à zéro, puis
supprimer. Le doublon d'email disparaît, et les recherches par email du lot 1
redeviennent triviales.

## Comment vérifier l'état à tout moment

Le comptage se fait sans SQL, avec la clé `service_role` :

- liste des comptes : `GET /auth/v1/admin/users?page=1&per_page=100`
- liste des profils : `GET /rest/v1/profiles?select=id,email&limit=1000`
- les orphelins sont les `profiles.id` absents de la première liste.
