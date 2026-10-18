# Journal — audit de préparation Yuno CRM au premier client (18/10/2026)

Branche `crm/readiness-audit`, worktree `/Users/paul/Desktop/yuno-audit.nosync`,
partie d'`origin/main` = `f8049220` (= prod pour les migrations jusqu'à
`20261020200000`). Pendant l'audit (matin) : rien de déployé, aucune migration
appliquée en prod, aucun envoi réel. Mise en ligne l'après-midi : dernière section.

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
| `node scripts/crm-bench/prod.mjs -f impact02.sql` (lecture seule, 18/10) | DATA-02 sur WOH : habitués 399 → 72, soirées 22 471 → 12 304, personnes avec au moins une soirée 16 966 → 10 566 ; autre compte : 809 → 693 |
| `node scripts/crm-bench/audit-data.mjs` (DATA-01, 02, 03, 05, 07, SYNC-03) | 41 contrôles : failles reproduites avant, fermées après, le reste identique ; base légère identique ; retour arrière (`ROLLBACK-data.sql`) = prod ; stable sur 5 passes |
| `deno test --no-lock -A affiliate-ticket-sync/ticketing_test.ts` (après DATA-05) | 12 / 12 (nouveau cas : case éteinte, soirées `editor` / `viewer` non créées) |
| `npx vitest run` (après les correctifs « données ») | 123 fichiers, 1 602 tests, verts ; `TZ=Europe/Paris` sur les tests Shotgun : 50 verts |
| `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint` des fichiers touchés | 0 erreur |
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
| `node scripts/crm-bench/sec06.mjs dump` puis `sec07.mjs run` | **35 / 35** dans quatre phases : avant, le promoteur relève ses taux, se pose 100 % de remise, s'ouvre la porte, change de club, réécrit son dû et antidate son gel IBAN (avec SEC-06 seul, le lot part vers l'IBAN de la veille) ; après `20261025200000`, tout refusé, IBAN / BIC / profil acceptés et gel posé, owners, managers, organisateurs, admins d'équipe, chefs d'agence, super admin, RPC, service_role et cascades inchangés → [sec07-bench.md](sec07-bench.md) ; smoke `smoke/sec07.sql` SMOKE_OK au banc (SEC-07 seul et avec SEC-06) |
| `sec06.mjs run` après l'ajout | toujours **30 / 30** (O2 renvoie à SEC-07) |
| ROLLBACK.sql bloc 6, au banc ; migration appliquée deux fois | retire le garde et son trigger, les 5 triggers de la prod restent ; migration idempotente |
| lecture en passant | candidat SEC-09 (BACKLOG 16i) : le `promoterId` envoyé aux checkouts n'est pas borné à la soirée |

## Correctif SEC-09 (18/10, nuit)

Session « SEC-09 », branche `crm/audit-sec09` (partie de `crm/audit-sec07`).
Lectures prod une à la fois après `prod.mjs --activity` ; rien d'appliqué ni de
répété sur la prod, aucune fonction déployée. Tests au banc (PGlite, < 10 s).

| Commande | Résultat |
|---|---|
| prod, lecture : `record_promoter_conversion` | SECURITY DEFINER, EXECUTE à `authenticated` et `service_role` ; aucune vérification promoteur ↔ soirée ; en service_role (checkouts, verify-*) la garde est sautée ; en client, le promoteur passe pour toute soirée, tout type, tout montant ; seuls index uniques : billet, table, commande, entrée de guest list (un appel sans référence ne heurte rien) |
| `same-as-prod.mjs --before 20261026100000 record_promoter_conversion` | prod = `20260830180000_promoter_conversion_door_staff.sql` : la migration part de cette définition |
| prod, lecture : appelants | front : `PromoterScanTab`, `OrgAppCheckin` (guest list, doublons du trigger) ; SQL : `record_guest_entry_promoter_conversion` (trigger AFTER UPDATE OF entry_scanned) ; edge : checkouts et `verify-*-payment` en service_role |
| prod, lecture : policies de `promoters`, `agency_venue_contracts`, `invite-promoter` | « Agency owner manages own promoters » ALL sans `venue_id` ; 1 contrat d'agence (actif, club démo) ; `invite-promoter` refuse déjà `no_active_contract` ; les fiches d'agence naissent en service_role (`accept-promoter-invitation`) |
| prod, lecture : données | 4 promoteurs (2 d'agence, sous contrat actif) ; 0 des 138 commissions hors périmètre (`event_parties`) ; 60 des 97 inscriptions de guest list rattachées à un promoteur hors périmètre : semis démo de juin-juillet (« Yuno Boat Party Seine », « Yuno Summer Closing »), jamais scannés ; tous les codes promoteur alphanumériques |
| prod, lecture : `schema_migrations` | **`20261025200000` déjà prise** par « partner_link_language » (liens partenaires) : SEC-07 est à renuméroter (BACKLOG 16h), session de mise en ligne prévenue ; SEC-09 prend `20261026100000` / `100100` (libres en prod et sur toutes les branches) |
| `npx vitest run src/lib/__tests__/promoterScope.test.ts` | 25 / 25 (périmètre, id, code sans joker) |
| `node scripts/crm-bench/sec09.mjs dump` puis `run` | **41 / 41** dans cinq phases (prod, SEC-09, SEC-07 + SEC-09, SEC-09 puis ROLLBACK bloc 7, SEC-09 deux fois) → [sec09-bench.md](sec09-bench.md). Avant : l'id du promoteur du club A donne 50 % de remise sur la soirée du club B, « % » trouve un promoteur, la commission du club A s'écrit sur un billet du club B, un promoteur se crédite 10 € ×3 sans vente puis 500 € de table, l'owner du club B crédite un promoteur du club A, une agence crée ou déplace un promoteur hors contrat. Après : tout refusé ou `out_of_scope` ; porte (trigger), doublon du front, co-soirée, co-hôte accepté, organisateur sans club, agence sous contrat (y compris contrat en pause, périmètre inchangé), owner, super admin et service_role inchangés ; smoke `smoke/sec09.sql` SMOKE_OK au banc (SEC-09, SEC-07 + SEC-09, deux fois) |
| `python3 scripts/deno-check-edge.py create-ticket-checkout create-table-checkout` | 2 / 2 OK |
| `npx eslint` des fichiers touchés | 0 erreur |
| lecture en passant | SEC-10 (BACKLOG 16j, décision) : un chef d'agence pose la remise client de ses promoteurs (100 % prouvé au banc, A15) ; les promoteurs d'un co-hôte ne sont pas reconnus par le code au checkout (périmètre des checkouts = 4 parties, la base accepte aussi les co-hôtes) |

## Ce que cet audit n'a pas pu faire

- Appeler l'API publique de la prod ou jouer une RPC en tant qu'un compte réel :
  refusé par le garde-fou de la session. Remplacé par le catalogue et le banc.
- Lire l'API Shotgun : volontairement évité (quota partagé, jeton du client).
- Créer un compte neuf, envoyer un e-mail (même intercepté), restaurer une
  sauvegarde, rejouer les migrations sur une base vierge (Docker arrêté).
- Voir à l'écran le bandeau « import en cours » : il faut une connexion non
  importée, donc une écriture en prod ; la règle est testée (`syncChip.test.ts`).

## Mise en ligne (18/10, après-midi, heures UTC)

Faite par une session dédiée, chaque écriture sur le « go » explicite de Paul, dans
l'ordre de REPORT §9. Avant chaque requête : `prod.mjs --activity` (rien ne tournait
à part la réplication temps réel).

| Étape | Résultat |
|---|---|
| Migration `20261021100000` (sécurité), vers 12:20 | Répétée d'abord en transaction annulée (SMOKE_OK : 6 fonctions fermées à `anon` / `authenticated`, `service_role` gardé, appel `anon` à `_admin_customer_identity` refusé en 42501, appelants admin toujours definer `postgres`). Appliquée avec sa ligne `schema_migrations`. **SEC-01 fermé en prod.** |
| Fusion `crm/s11-practical-email` → main `1d686a54`, 12:18 | Sans conflit. eslint 0 erreur, tsc 0, vitest 121 fichiers / 1 571 tests, build vert. Poussée. |
| Fusion `crm/readiness-audit` → main `46e385ff`, 12:28 | Un conflit dans `send-campaign` (contrôle de l'e-mail pratique de S11 gardé, en-tête de désabonnement en un clic de l'audit gardé). eslint 0, tsc 0, vitest 124 fichiers / 1 592 tests, build vert, `deno test` du contrat Shotgun 11 / 11, `deno check` des 7 fonctions vert. Bancs : `audit-mail` et `audit-sync` tout vert ; `audit-security` tout vert après, un seul « avant » en échec, attendu : le gel d'envoi (MAIL-05) était déjà corrigé en prod au moment de l'instantané, le banc ne peut plus le reproduire ; `isolation` 205 fonctions, 157 refus, 9 silencieuses, 10 identiques sans donnée client, 29 non concluantes (même répartition qu'à l'audit, aucune fuite). |
| Définitions prod avant 110000 / 120000 | `claim_campaign_recipients`, `requeue_stale_campaign_claims`, `claim_ticketing_connections` identiques à ROLLBACK.sql (espaces normalisés). |
| Migration `20261021110000` (file d'envoi), vers 12:36 | Répétée sur un espace démo (`bde@womber.fr`) : seul l'accord valable part ; désabonné, plainte, repoussoir écartés avec leur raison, compteur à 3 ; un e-mail de service part aux 4 ; un abandon après 3 tentatives compte. Contre-épreuve sans la migration : les 4 partent (faille reproduite sur la prod). Appliquée. |
| Migration `20261021120000` (connecteur), vers 12:37 | Répétée sur une connexion fictive du même espace démo (aucune autre connexion lue : `p_connection_id`) : connexion en erreur reprise, jeton refusé jamais retenté, suppression = accord Shotgun retiré et tracé, refus et accord de page gardés. Contre-épreuve sans la migration : la connexion en erreur n'est pas reprise. Appliquée. La connexion d'Amoris n'a été ni lue en écriture ni réclamée. |
| `supabase db lint --linked` | 86 erreurs avant comme après, toutes connues (tables temporaires lues comme absentes, et `staff_pin_rate_limits` protégée par `to_regclass`) ; aucune remarque sur les fonctions réécrites. |
| Fonctions edge, vers 12:38-12:41 | Avant : les 7 fonctions en prod étaient identiques octet pour octet à main `1d686a54` (rien d'une autre branche à perdre). Déployées depuis `46e385ff` (`--use-api`) : affiliate-ticket-sync, send-campaign, unsubscribe-newsletter, process-scheduled-campaigns, send-missed-you, send-next-event-recommendation, owner-assistant. Après : retéléchargées, identiques octet pour octet à `46e385ff`. `unsubscribe-newsletter` répond sans jeton (GET d'un jeton bidon → 302 vers la page, aucun désabonnement). |
| Front | Cloudflare a reconstruit depuis main : le bundle servi sur crm.yunoapp.eu contient le nouveau bandeau d'import (`yc.top.importSub`). |

### Contrôles du RUNBOOK §5 (12:44-12:46)

- SEC-01 : `_admin_customer_activity / _identity / _rfm` → `anon = false`, `authenticated = false`.
- MAIL-02 : `claim_campaign_recipients` contient `opted_out_after_queue` → vrai.
- SYNC-04 : `claim_ticketing_connections` contient `status IN` → vrai.
- SYNC-01b : `trg_ticketing_connections_withdraw_consents` → 1.
- Synchro : passe du cron de 12:45:03 `ok` (1,2 s) avec le nouveau connecteur ; les appels des crons vers les fonctions depuis le déploiement répondent tous 200 (`net._http_response`).
- Console de prod ouverte avec le compte démo `crm@womber.fr` (session posée sans mot de passe) : Accueil, Connecteurs, Clients s'affichent, aucune erreur console.
- Reste à faire par Paul : l'e-mail de test réel, et le bouton « Se désabonner » de Gmail sur un vrai envoi (RUNBOOK étape 12).

## Suite du 18/10 (après-midi) : points d'envoi et finitions

Branche `claude/affectionate-lamport-a1b8b9`, avance rapide sur
`crm/readiness-audit`. Lectures de la prod une à la fois après
`prod.mjs --activity` (toujours une seule connexion active, la réplication) :
définitions de 11 fonctions, ACL, politiques et dépendances des fonctions
d'aide, clés des 6 segments, événements Resend des 60 derniers jours, soirées
miroirs, espaces qui ont déjà envoyé, recettes / scénarios / campagnes SMS.
Aucune écriture, aucun envoi, aucun déploiement.

| Commande | Résultat |
|---|---|
| `npx vitest run` (env public de la CI) | 133 fichiers, 1 636 tests, verts (aussi en `TZ=Europe/Paris`) ; sans env, 6 fichiers tombent faute d'URL Supabase (worktree sans `.env.local`) |
| `npx eslint .` | 0 erreur, 341 avertissements (comme avant) |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 erreur |
| `deno check` × 8 fonctions | vert |
| `deno test` (`scheduled_test`, `demo-guard_test`, `ticketing_test`) | 23 / 23 |
| `node scripts/crm-bench/audit-{send,filter,test-send,quota,helpers,event-scope,sender}.mjs` | avant : failles reproduites ; après : vert |
| `node scripts/crm-bench/audit-suite-rollback.mjs` | 8 migrations à la suite puis retour arrière : définitions et droits de départ retrouvés |
| `node scripts/crm-bench/audit-{mail,security,sync}.mjs` | toujours verts |

Piège rencontré : le hook de réécriture de sortie (`rtk`) résume `vitest` en
« PASS (0) FAIL (0) » même quand un fichier échoue au chargement. Toujours
lancer `rtk proxy npx vitest run …` pour lire le vrai résultat.

## Mise en ligne de la suite (18/10 au soir, heures UTC)

Go de Paul pour les lots données, envois, écrans d'erreur, puis SEC-07 (renuméroté)
et SEC-09, dans cet ordre, avec son go avant chaque écriture. SEC-06 et LINK-01
attendent sa décision.

### Lot « données » (DATA-01 à 08, SYNC-03, SYNC-06)

| Étape | Résultat |
|---|---|
| Fusion `claude/nervous-fermat-c79e39` → `13cabe43` | Sans conflit. eslint 0, tsc 0, vitest 124 fichiers / 1 615 tests, build vert, contrat Shotgun 12 / 12, `deno check` affiliate-ticket-sync et owner-assistant. Bancs sur instantané frais : `audit-data` 41 / 41 ; `audit-analysis gratuit` : score « Chances de venir » identique (chances, étiquettes, raisons), familles recalculées sur les soirées faites. |
| Définitions prod | Les 12 fonctions réécrites identiques à `ROLLBACK-data.sql` ; les 7 nouvelles absentes de la prod. Les deux connexions réelles ont « co-organisées » allumé : rien n'est retiré. |
| Répétition (21:55) | Les 5 migrations + smoke dans une transaction annulée : SMOKE_OK en 1,6 s (SYNC-03, DATA-07 avec son témoin, DATA-01, règles DATA-02 et DATA-05, 7 fonctions nouvelles fermées aux clients, ordre des triggers). Contre-épreuve sans les migrations : « SYNC-03 : une version plus ancienne a écrasé le billet ». Démo CRM : personnes avec au moins une soirée 1 900 → 1 795, soirées 6 714 → 6 320. |
| Migrations (21:58-21:59) | `20261022100000` → `140000` appliquées une par une avec leur ligne `schema_migrations`. Catalogue : aucune des 19 fonctions touchées n'est exécutable par `anon` ; seule `crm_ticketing_set_cohosted` (RPC de la Console) l'est par `authenticated`. `db lint` : deux faux positifs nouveaux du même type que les 86 connus (tables temporaires `_cpa`, `_ant`). |
| Fonctions (21:59) | affiliate-ticket-sync (après 130000) et owner-assistant, depuis `13cabe43`. Avant : prod = `46e385ff` ; owner-assistant embarque en plus l'article « langue de la page partenaire » de main. Après : retéléchargées, identiques au commit. |
| Front | main poussé à `13cabe43`. |
| Contrôle | Passe du cron de 22:00:07 `ok` (4,4 s) avec le nouveau connecteur ; appels des crons depuis le déploiement : 200. Recalcul de l'analyse : laissé au calcul de nuit (`crm-analysis-nightly`), choix de Paul. |

### Lot « envois » (MAIL-03, 07 à 15, SEC-04, SEC-05, SMS-01, UI-05)

| Étape | Résultat |
|---|---|
| Fusion `claude/affectionate-lamport-a1b8b9` → `aea7da78` | Trois conflits de code avec l'e-mail pratique (S11), les deux côtés gardés : `send-campaign` filtre les blocs d'un e-mail pratique et retire ceux d'une soirée hors de l'espace (MAIL-14) ; `readTestSend` rend le code et les motifs d'un e-mail pratique refusé, que le Studio CRM continue de dire ; le contrôle d'envoi lit les Yunits disponibles avec les contrôles de l'e-mail pratique. eslint 0, tsc 0, vitest 134 fichiers / 1 669 tests, build vert, `deno check` × 6, tests Deno 24 / 24. Bancs sur instantané frais (après le lot « données ») : send 19, filter 16, test-send 14, quota 12, event-scope 6, sender 13, suite-rollback 13, helpers 24, tous verts. |
| Définitions prod | Les 9 fonctions réécrites identiques à `ROLLBACK-suite.sql` (dont `claim_campaign_recipients` = version de `20261021110000`) ; les 8 nouvelles absentes. Retraits de SEC-04 : aucun appelant client apparu depuis (front, politiques RLS, fonctions INVOKER ; `count_transactional_email` et `crm_user_manages_team` ne sont appelées qu'avec la clé serveur). File d'envoi vide. |
| Répétition (22:09) | Les 8 migrations + smoke, transaction annulée : SMOKE_OK en 1,4 s (MAIL-09, MAIL-13, MAIL-03 : le lot repris est le même avec la même clé malgré deux adresses devenues dues ; MAIL-08 : équipe seulement, 21ᵉ test refusé ; MAIL-14 ; MAIL-15 : yuno@ gardé, un autre « Yuno » reçoit `yuno-xxxxxx` ; SEC-04 ; MAIL-07 joué comme un client démo). Contre-épreuve sans les migrations : « MAIL-09 : une clé inconnue garde toute la base (true) ». |
| Migrations (22:10-22:11) | `20261023100000` → `170000` appliquées une par une. Registre des adresses : 5 espaces (Yuno + les 4 qui ont déjà envoyé, adresse inchangée). Catalogue : aucune fonction exécutable par `anon` ; `authenticated` garde les RPC de la Console (`crm_email_settings_get`, `get_email_quota_status`, `get_campaign_send_progress`), `paris_today` et `contact_base_scope_key` ; `service_role` exécute bien la file recréée. `db lint` : 87 avant comme après. |
| Fonctions (22:11) | send-campaign (après 120000), process-scheduled-campaigns, send-sms-campaign, send-push-campaign, resend-webhook, owner-assistant depuis `aea7da78`. Avant : prod = main `13cabe43`. Après : identiques au commit. |
| Front | main poussé à `aea7da78` (SMS en « Bientôt » tant qu'Octopush n'est pas branché, Acceptés / Délivrés, exports CSV protégés, finitions UI-05). |
| Contrôle | Appels des crons depuis le déploiement : 200. |

### Lot « écrans d'erreur » (UI-04 et sa suite, front seulement)

| Étape | Résultat |
|---|---|
| Fusion `claude/infallible-northcutt-7c1d1c` → `c4cce746` | Un conflit dans l'envoi d'un e-mail (colonne de droite : Yunits disponibles d'UI-05 et nombre de destinataires « — » tant qu'il n'est pas lu d'UI-04). Corrigé en fusionnant : « Suivant » attend le compte qui fait foi (détenteurs pour un e-mail pratique, aperçu d'audience sinon) ; avant, un e-mail pratique serait resté bloqué à l'étape Audience. |
| `fa1a8120` | Écart relevé par la suite d'UI-04 : sans compte lu, la colonne de droite annonçait « il vous en restera <solde complet> » ; le reste s'affiche « — » et les alertes attendent le compte, comme pour le SMS. |
| Fusion `claude/cool-leakey-40bdf2` → `bfecbc09` | Sans conflit. |
| Contrôles | eslint 0, tsc 0, vitest 134 fichiers / 1 669 tests, build vert. |
| Front | main poussé. Aucune migration, aucune fonction. |

### SEC-07 (renumérotée) et SEC-09, sans SEC-06 ni LINK-01

| Étape | Résultat |
|---|---|
| Branche de mise en ligne `crm/audit-sec-release` (= `crm/audit-sec09` + 3 commits) | SEC-07 renumérotée `20261025200000` (`20261025100000` = « partner_link_language », déjà en prod ; numéro libre sur main, sur toutes les branches, dans les worktrees et en prod). R11 (`sec06.mjs`) et S1 (`sec07.mjs`) en `service_role`. Smokes SEC-07 et SEC-09 limités aux comptes démo (`@womber.fr`, `@bench.test` au banc) : ils jouaient le premier promoteur ou chef d'agence venu. Smoke SEC-09 : une portée NULL du promoteur n'exclut plus toutes les soirées (sur la prod, le cas « hors périmètre » n'était pas joué). Bancs sur instantanés frais : sec06 30 / 30, sec07 35 / 35, sec09 41 / 41, smokes verts. |
| Définitions prod | `record_promoter_conversion` identique au bloc 7 de `ROLLBACK.sql` ; `is_direct_client_write` identique à la migration ; policy « Agency owner manages own promoters » présente (remplacée). |
| Répétition (22:35-22:45) | SEC-07 seule : SMOKE_OK (IBAN modifié et gel posé, profil modifié, gel antidaté refusé, commission par le promoteur refusée, par le gestionnaire modifiée). SEC-07 + SEC-09 : SMOKE_OK, six cas (agence plafond modifié, hors périmètre → `out_of_scope` rien d'écrit, promoteur seul refusé, dans le périmètre écrite, création et déplacement hors contrat refusés). Sans les migrations : les pièces manquent (les failles « avant » sont reproduites aux bancs). |
| Fusion → `9a121c18` | Sans les fichiers `20261024100000` (SEC-06) et `20261024100100` (LINK-01) : ni dans main, ni en prod. Conflits sur REPORT et BACKLOG, résolus en gardant les deux côtés. eslint 0, tsc 0, vitest 135 fichiers / 1 694 tests, build vert, `deno check` des deux checkouts. |
| Migrations (23:01) | `20261025200000`, `20261026100000`, `20261026100100`. Catalogue : rien d'exécutable par `anon` sauf `is_direct_client_write` (aide pure, INVOKER, lue par les policies) ; `trg_a_guard_promoter_self_update` premier trigger de `promoters`. `db lint` : 87 avant comme après. |
| Fonctions (23:02) | create-ticket-checkout et create-table-checkout depuis `9a121c18`. Avant : prod = main d'avant le lot « envois » (seul `_shared/demo-guard.ts` différait, remplacé sur main par MAIL-12). Après : identiques au commit. |
| Reste | SEC-06 (décision sur SEC-08) et LINK-01 (décision) : branche `crm/audit-sec06-link01`, blocs 4 et 5 de `ROLLBACK.sql` marqués « non appliquée ». |
