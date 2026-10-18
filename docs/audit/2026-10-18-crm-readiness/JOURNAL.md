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
| `node scripts/crm-bench/prod.mjs -f impact02.sql` (lecture seule, 18/10) | DATA-02 sur WOH : habitués 399 → 72, soirées 22 471 → 12 304, personnes avec au moins une soirée 16 966 → 10 566 ; autre compte : 809 → 693 |
| `node scripts/crm-bench/audit-data.mjs` (DATA-01, 02, 03, 05, 07, SYNC-03) | 41 contrôles : failles reproduites avant, fermées après, le reste identique ; base légère identique ; retour arrière (`ROLLBACK-data.sql`) = prod ; stable sur 5 passes |
| `deno test --no-lock -A affiliate-ticket-sync/ticketing_test.ts` (après DATA-05) | 12 / 12 (nouveau cas : case éteinte, soirées `editor` / `viewer` non créées) |
| `npx vitest run` (après les correctifs « données ») | 123 fichiers, 1 602 tests, verts ; `TZ=Europe/Paris` sur les tests Shotgun : 50 verts |
| `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint` des fichiers touchés | 0 erreur |
| rollback (`ROLLBACK.sql`) au banc | revient à l'état de la prod |
| `node scripts/crm-bench/prod.mjs …` | lectures seules (connexion, passes, triggers, ACL, vues, crons, sauvegardes) |
| `supabase secrets list` | noms et empreintes seulement (aucune valeur) : `RESEND_WEBHOOK_SECRET` posé, aucun secret Octopush |

## Ce que cet audit n'a pas pu faire

- Appeler l'API publique de la prod ou jouer une RPC en tant qu'un compte réel :
  refusé par le garde-fou de la session. Remplacé par le catalogue et le banc.
- Lire l'API Shotgun : volontairement évité (quota partagé, jeton du client).
- Créer un compte neuf, envoyer un e-mail (même intercepté), restaurer une
  sauvegarde, rejouer les migrations sur une base vierge (Docker arrêté).
- Voir à l'écran le bandeau « import en cours » : il faut une connexion non
  importée, donc une écriture en prod ; la règle est testée (`syncChip.test.ts`).
