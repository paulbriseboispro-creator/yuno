# Journal — audit de préparation Yuno CRM au premier client (18/10/2026)

Branche `crm/readiness-audit`, worktree `/Users/paul/Desktop/yuno-audit.nosync`,
partie d'`origin/main` = `f8049220` (= prod pour les migrations jusqu'à
`20261020200000`). Rien n'est déployé, aucune migration n'est appliquée en prod,
aucun envoi réel.

Point de départ : le plan `docs/designs/CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md`
(diagnostic du 17/10, sessions S0-S11, non commité dans main). Cet audit le
revérifie, complète ce qu'il ne couvrait pas (reprise et concurrence de la
synchro, séparation entre espaces, chaîne d'envoi, écrans) et corrige ce qui est
prouvé.

## Environnements

| Quoi | Où | Usage dans l'audit |
|---|---|---|
| Base de prod | Supabase `fulawxvdlwtdlpkycixe` (Pro + Micro 1 Go) | lectures seules (`scripts/crm-bench/prod.mjs`, transaction READ ONLY), une à la fois, après `pg_stat_activity` |
| Banc isolé | PGlite (`scripts/crm-bench/`), définitions lues en prod (mode instantané) | tests avant / après des migrations, séparation entre espaces ; aucune donnée réelle |
| Tests unitaires | vitest, Deno test | non-régression |
| Navigateur | panneau intégré, `localhost:8121`, compte démo `crm@womber.fr` | rendu de la Console ; doc Shotgun (Notion) |
| API Shotgun | — | aucun appel (quota partagé, jeton du client) |
| Resend, Octopush | — | aucun appel |

## Progression

- 09:20 UTC — worktree créé, plan existant relu, connecteur lu.
- 09:25 — état initial : vitest 120 fichiers / 1 561 tests verts ; eslint 0 erreur
  (341 avertissements) ; build vert ; `tsc -p tsconfig.app.json` 0 erreur ;
  `deno check` vert sur `affiliate-ticket-sync`, `send-campaign`, `resend-webhook`.
- 09:30 — prod : connexion Amoris saine (15 min, 0 erreur en 7 j), triggers et
  index uniques relevés ; aucun trigger sur un changement d'organisation (SYNC-01).
- 09:35 — doc Shotgun officielle relue dans le navigateur : conforme à la copie
  du 05/10 ; dates sans fuseau ; `organizer_id` lié au jeton.
- 09:40 — dates : aucun billet « mis à jour » après sa lecture → UTC confirmé.
- 09:45 — catalogue : 3 helpers admin exécutables par `anon` sans garde (SEC-01,
  P0). Appel réel de l'API publique refusé par le garde-fou de la session ; prouvé
  par le catalogue (ACL `=X/postgres,anon=X/postgres`, corps sans garde).
- 09:50 — balayage élargi : `get_customer_timeline`, rafraîchissements de vue,
  `analytics_daily_rollup` (SEC-02, SEC-03) ; les autres suspectes sont gardées.
- 09:55 — test entre espaces joué en tant qu'un compte sur la prod : refusé par
  le garde-fou (« Credential Exploration ») ; basculé au banc (`isolation.mjs`) :
  206 fonctions, aucune fuite.
- 10:00-10:20 — trois relectures en parallèle (envois, données, écrans), chacune
  revérifiée en prod avant d'entrer au rapport. Une affirmation était fausse
  (désabonnement d'un espace organisateur cassé : la prod a déjà un LEFT JOIN).
- 10:20-11:00 — corrections et bancs : sécurité, file d'envoi, désabonnement en un
  clic, planification, connecteur + contrat simulé (prouvé contre le code
  d'avant), écrans, purge + reprise, CI.
- 12:10 — régression complète verte ; rollback rejoué au banc.

## Commandes exécutées et résultats

| Commande | Résultat |
|---|---|
| `npx vitest run` (avant) | 120 fichiers, 1 561 tests, verts |
| `npx vitest run` (après) | 123 fichiers, 1 582 tests, verts |
| `TZ=Europe/Paris npx vitest run …ticketingShotgun*.test.ts` | 41 verts (et en UTC) |
| `npx eslint .` | 0 erreur (avant et après) |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 erreur (avant et après) |
| `npm run build` | vert |
| `deno check` × 6 fonctions | vert |
| `deno test --no-lock --allow-env affiliate-ticket-sync/ticketing_test.ts` | 11 / 11 ; contre le code d'avant : 10 / 11 (seul SYNC-02 échoue) |
| `node scripts/crm-bench/isolation.mjs run` | 157 refusés, 9 silencieux, 10 identiques sans donnée client, 30 non concluants justifiés |
| `node scripts/crm-bench/audit-security.mjs` | failles reproduites avant, fermées après |
| `node scripts/crm-bench/audit-mail.mjs` | idem |
| `node scripts/crm-bench/audit-sync.mjs` | idem |
| rollback (`ROLLBACK.sql`) au banc | revient à l'état de la prod |
| `node scripts/crm-bench/prod.mjs …` | lectures seules (connexion, passes, triggers, ACL, vues, crons, sauvegardes) |
| `supabase secrets list` | noms et empreintes seulement (aucune valeur) : `RESEND_WEBHOOK_SECRET` posé, aucun secret Octopush |

## Preuves d'exploitation (18/10, 14 h 15 → 14 h 45 heure de Paris)

Session « preuves d'exploitation », worktree `blissful-faraday-d14300`, partie de
`crm/readiness-audit`. Lectures prod une à la fois, chacune après
`prod.mjs --activity` (rien d'autre que la réplication Realtime). Aucune écriture,
aucune dépense, Docker non démarré. Charge du Mac : 7 à 13 (autres sessions) ; tous
les tests de cette session sont légers (PGlite, `node`, < 3 s chacun).

| Commande | Résultat |
|---|---|
| `node prod-functions-reference.mjs scan` | 1 229 versions appliquées, 1 659 fonctions (schémas `public`, `private`, `analytics_wh*`, hors extensions) |
| `node prod-functions-reference.mjs report …` | **1 609 identiques**, 50 divergentes : 35 réécrites, 13 absentes du dépôt, 2 plus anciennes que le dépôt → [ops04-functions.md](ops04-functions.md) |
| contrôle de la référence au banc (PGlite, instantané de la prod) | 49 / 50 blocs `CREATE OR REPLACE` + droits passent ; le 50ᵉ (`private.get_cron_secret`) échoue seulement faute du schéma `private` au banc |
| `node isolation.mjs run --club …` | couple de CLUBS : 156 refusés, 9 silencieux, 8 « même réponse » (clés et booléens sans donnée client), 33 non concluants → [isolation-results-club.md](isolation-results-club.md) |
| `node isolation.mjs run …` (fixture enrichie : e-mail pratique, import, segment club) | couple d'ORGANISATEURS : 158 refusés, 9 silencieux, 9 « même réponse », 30 non concluants (avant : 157 / 9 / 10 / 30 ; `crm_practical_email_check` est passé de « même réponse » à « refusé » une fois testé sur une vraie campagne pratique) |
| `node history-holes.mjs scan` puis `report` | objets de la prod qu'aucun fichier du dépôt ne crée : 4 tables, 12 triggers, 6 policies, 11 crons (création dynamique) → [ops03-history-holes.md](ops03-history-holes.md) |
| `npm audit --omit=dev --json` | 22 paquets signalés ; 4 partent chez l'utilisateur (1 critique natif, 3 modérés web) → [npm-audit.md](npm-audit.md) |
| prod, lecture : `SELECT 'https://…' ~ '^https://[^[:space:]]{1,480}$'` | **erreur 2201B** : l'expression de `crm_link_create` est refusée par Postgres (répétition > 255) → LINK-01 |
| prod, lecture : triggers de `promoter_conversions` | `trg_guard_promoter_conversion_settlement` **absent** (migration `20260721090000` pourtant marquée appliquée) → SEC-06 |
| prod, lecture : crons | 64 actifs, 16 appellent une fonction edge par son URL ; aucun ne vise l'ancien projet Lovable |

## Correctifs SEC-06 et LINK-01 (18/10, fin d'après-midi)

Session « correctifs SEC-06 / LINK-01 », branche `crm/audit-sec06-link01` (partie de
`claude/blissful-faraday-d14300`). Lectures prod une à la fois après
`prod.mjs --activity` ; rien d'appliqué ni de répété sur la prod. Tests au banc
(PGlite, < 3 s chacun).

| Commande | Résultat |
|---|---|
| prod, lecture : définitions du cycle (`pg_get_functiondef`), triggers, policies, droits | `guard_promoter_payout_write` = brouillon « drapeau » (DEFINER, `yuno.payout_rpc`), posé seulement par `dispute` et `auto_dispute` ; `prepare` / `declare` / `cancel` / `resolve` = `20261005212000`, `confirm` = `20260803140000` (sans drapeau) ; `is_direct_client_write()` présente (PUBLIC) ; aucun chemin client n'écrit `promoter_conversions` (front, edge : lectures) |
| prod, lecture : lots et commissions | 9 lots, tous payés, le dernier le 28/07 ; 15 commissions en attente, toutes au club démo (promoteurs d'agence), 0 chez un vrai client |
| `node scripts/crm-bench/sec06.mjs dump` puis `run` | **30 / 30** : avant, PATCH direct d'une commission accepté (owner, manager, organisateur, super admin) et cycle refusé à chaque étape ; après `20261024100000`, l'inverse, porte / remboursement / service_role / cron inchangés → [sec06-bench.md](sec06-bench.md) ; smoke `smoke/sec06.sql` SMOKE_OK au banc |
| `node scripts/crm-bench/link01.mjs scan` | 5 fonctions avec un quantificateur à 3 chiffres, 1 seule au-delà de 255 (`crm_link_create`) ; aucune contrainte, policy ni domaine |
| `node scripts/crm-bench/link01.mjs dump` puis `run` | **13 / 13** cas, 0 écart sur 400 URL au hasard → [link01-bench.md](link01-bench.md) ; smoke `smoke/link01.sql` SMOKE_OK au banc |
| ROLLBACK.sql blocs 4 et 5, au banc | remettent l'état de la prod (garde DEFINER à drapeau, pas de garde des commissions, `{1,480}`) |
| les deux migrations sur le schéma du banc d'analyse (`schema/base.sql`) | s'appliquent : `scenarios.mjs`, qui rejoue toutes les migrations ≥ 20261016100000, ne casse pas |
| prod, lecture : `promoters` | la policy « Promoters can update their own IBAN » ouvre toute la ligne au promoteur (droit UPDATE sur chaque colonne) → SEC-07 |

Ce qui reste bloqué, et pourquoi :
- **OPS-02** (restauration testée) : « Restore to a new project » crée un projet
  facturé (≈ 0,0134 $ / h) et n'existe qu'au tableau de bord ; procédure prête
  (RUNBOOK §4.1, crons à couper dans la copie). Attend l'accord de Paul.
- **OPS-03** (rejeu des 1 231 migrations) : Docker arrêté ; la partie gratuite
  (trous de l'historique) est faite. Attend : Docker démarré par Paul, ou un projet
  vide temporaire (même coût horaire).

## Correctif SEC-07 (18/10, soir)

Session « SEC-07 », branche `crm/audit-sec07` (partie de `crm/audit-sec06-link01`).
Lectures prod une à la fois après `prod.mjs --activity` ; rien d'appliqué ni de
répété sur la prod. Tests au banc (PGlite, < 4 s).

| Commande | Résultat |
|---|---|
| lecture du front et des fonctions edge : écritures sur `promoters` | le promoteur écrit `iban`, `bic` (dialogue IBAN), `instagram_url`, `whatsapp_number`, `promo_code` (régénéré du nom), `profile_image_url` (`PromoterProfileTab`, `PromoterProfilePage`) ; prénom et nom vont dans `profiles` ; les autres écritures sont celles d'owners, d'agences, du super admin (Console) ou en service_role (invitations) |
| prod, lecture : policies, triggers, droits et écrivains de `promoters` | deux policies UPDATE ouvertes au promoteur (« Promoters can update their own IBAN », « Promoter can update own organizer profile »), `authenticated` a UPDATE sur les 50 colonnes ; 5 triggers BEFORE (code promo, gel IBAN, accès assisté, groupe d'agence, `updated_at`) ; les 8 fonctions qui écrivent la table sont SECURITY DEFINER de `postgres` ; 4 fiches en prod |
| lecture des checkouts | `create-ticket-checkout` / `create-table-checkout` lisent `ticket_` / `table_discount_*` du promoteur : la remise qu'il se pose est payée par le club ; `prepare_promoter_payout` lit `iban_changed_at` pour le gel de 24 h |
| `same-as-prod.mjs is_direct_client_write guard_promoter_self_update` | `is_direct_client_write` identique à la prod ; le garde est nouveau |
| `node scripts/crm-bench/sec06.mjs dump` puis `sec07.mjs run` | **35 / 35** dans quatre phases : avant, le promoteur relève ses taux, se pose 100 % de remise, s'ouvre la porte, change de club, réécrit son dû et antidate son gel IBAN (avec SEC-06 seul, le lot part vers l'IBAN de la veille) ; après `20261025100000`, tout refusé, IBAN / BIC / profil acceptés et gel posé, owners, managers, organisateurs, admins d'équipe, chefs d'agence, super admin, RPC, service_role et cascades inchangés → [sec07-bench.md](sec07-bench.md) ; smoke `smoke/sec07.sql` SMOKE_OK au banc (SEC-07 seul et avec SEC-06) |
| `sec06.mjs run` après l'ajout | toujours **30 / 30** (O2 renvoie à SEC-07) |
| ROLLBACK.sql bloc 6, au banc ; migration appliquée deux fois | retire le garde et son trigger, les 5 triggers de la prod restent ; migration idempotente |
| lecture en passant | candidat SEC-09 (BACKLOG 16i) : le `promoterId` envoyé aux checkouts n'est pas borné à la soirée |

## Ce que cet audit n'a pas pu faire

- Appeler l'API publique de la prod ou jouer une RPC en tant qu'un compte réel :
  refusé par le garde-fou de la session. Remplacé par le catalogue et le banc.
- Lire l'API Shotgun : volontairement évité (quota partagé, jeton du client).
- Créer un compte neuf, envoyer un e-mail (même intercepté), restaurer une
  sauvegarde, rejouer les migrations sur une base vierge (Docker arrêté).
- Voir à l'écran le bandeau « import en cours » : il faut une connexion non
  importée, donc une écriture en prod ; la règle est testée (`syncChip.test.ts`).
