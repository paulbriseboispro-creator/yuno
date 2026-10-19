# Backlog après l'audit du 18/10/2026

Effort : équipe humaine / Claude Code (table de CLAUDE.md). Les identifiants
renvoient au [rapport](REPORT.md).

## Avant le premier client (bloquant)

| # | Quoi | Qui | Effort |
|---|---|---|---|
| 1 | Fusionner `crm/s11-practical-email`, puis rebaser et fusionner `crm/readiness-audit` (OPS-05) | Paul (« go ») | — |
| 2 | Appliquer les 3 migrations (répétition annulée, application, `db lint`) : SEC-01 en premier | Paul (« go ») | 1 h / 15 min |
| 3 | Déployer les 6 fonctions edge depuis main à jour, puis le front | Paul (« go ») | 30 min / 10 min |
| 4 | Contrôles après mise en ligne (RUNBOOK §5) | session suivante | 30 min / 10 min |
| 5 | ~~DATA-02~~ : **fait** (décision de Paul du 18/10 ; `20261022100000`, banc `audit-data.mjs`) — à mettre en ligne avec le reste (REPORT §9) | session de mise en ligne | 15 min |
| 6 | Rapprochement affiché ↔ Smartboard sur 2-3 soirées avec le client (RUNBOOK §1.8) | Paul + client | 30 min |

## Juste après (P2)

| # | Quoi | Effort |
|---|---|---|
| 7 | UI-04 : `CrmLoadError` sur Soirées, E-mails, Campagnes, tiroir client, liste Clients (passer `error`), étape Audience | 1 j / 30 min |
| 8 | ~~MAIL-03~~ : fait (§4 bis, `20261023100000`) | — |
| 9 | ~~MAIL-09~~ : fait (§4 bis, `20261023110000`) | — |
| 10 | ~~MAIL-08~~ : fait (§4 bis, `20261023120000`) | — |
| 11 | ~~SMS-01~~ : fait (front) ; remettre `CRM_SMS_DISPLAY_LIVE` à true avec les secrets Octopush | — |
| 12 | ~~DATA-03~~ : **fait** (`20261022110000`, FAQ corrigée) | — |
| 13 | ~~DATA-05~~ : **fait** (`20261022120000`, connecteur, confirmation dans la Console) | — |
| 14 | ~~DATA-01~~ : **fait** (décision de Paul : marque par billet ; `20261022130000`) | — |
| 14b | ~~DATA-08~~ : **fait** (décision de Paul : hypothèses, profils et audiences sur les soirées faites, score « Chances de venir » sur les achats ; `20261022140000`, après `20261022100000`, banc `audit-analysis.mjs`) | — |
| 14c | DATA-08b : colonne « nouveaux acheteurs » pour la projection de remplissage (`_crm_an_write_nights`, `crm_night_targets`, `_crm_score_journal`, `crm_admin_analysis`) | ½ j / 30 min |
| 15 | OPS-02 : restauration d'essai dans un projet isolé, chronométrée (procédure prête, RUNBOOK §4.1 : couper les crons de la copie d'abord) ; décider du PITR | 1 h, accord de Paul |
| 16 | OPS-03 : rejeu réel des migrations (Docker local ou projet vide temporaire) ; puis migration de rattrapage des objets créés hors dépôt (ops03-history-holes.md) | 2 h / 45 min |
| 16b | OPS-04 : décider du sort de `supabase/reference/20261018_prod_functions_reference.sql` (secours seulement, ou vraie migration marquée appliquée en prod) ; la régénérer après chaque réécriture par bloc `DO` | 15 min |
| 16c | SEC-06 : **migration écrite et prouvée au banc, à appliquer** : `20261024100000_promoter_settlement_guards.sql` remet le garde de `promoter_payouts` à la version du dépôt et crée celui de `promoter_conversions` (le garde actuel, version « drapeau », bloque aussi le cycle en trois temps : aucun lot réglable en prod). Banc `node scripts/crm-bench/sec06.mjs run` 30 / 30 ([sec06-bench.md](sec06-bench.md)) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/sec06.sql 20261024100000_promoter_settlement_guards.sql` (smoke validé au banc) ; décider 16g AVANT | 20 min d'application |
| 16d | ~~LINK-01~~ : **en ligne** le 18/10 à 23:03 UTC (`20261024100100`, répétée sur la prod avec le compte démo CRM ; JOURNAL) | — |
| 16e | DEP-01 : `@capacitor/ios` 8.4.3 dans la prochaine version App Store des deux apps | ½ j / build CI |
| 16f | DEP-02 : `react-router-dom` 6.30.6, `fflate` 0.8.3, refus de `\` dans `AuthHandoff.tsx` et `crm/lib/errors.ts` | 2 h / 15 min |
| 16g | SEC-08 (**décision de Paul, avant 16c**) : supprimer un promoteur efface en cascade ses commissions dues ; aujourd'hui le garde « drapeau » empêche par accident de supprimer un promoteur qui a un lot de règlement, après 16c ce sera possible (comportement prévu par le dépôt : la cascade tourne sous le propriétaire de la table, banc O1). Option : garde `BEFORE DELETE` sur `promoters` qui refuse une suppression directe tant qu'il reste une commission due ou un lot ouvert (message à traduire dans la Console) | ½ j / 20 min |
| 16h | ~~SEC-07~~ : **en ligne** le 18/10 à 23:01 UTC (`20261025200000`, renumérotée ; JOURNAL) | — |
| 16i | ~~SEC-09~~ : **en ligne** le 18/10 à 23:01-23:02 UTC (`20261026100000`, `20261026100100`, create-ticket-checkout et create-table-checkout ; JOURNAL). Reste ouvert : les promoteurs d'un co-hôte ne sont pas reconnus au checkout (écart fonctionnel), appels front de `record_promoter_conversion` en double du trigger de porte | — |
| 16j | SEC-10 (**décision de Paul**) : un chef d'agence règle les taux de commission ET les remises client de ses promoteurs (policy agence, et SEC-07 le compte parmi ceux qui gèrent la fiche) : sous contrat actif, il peut poser 100 % de remise sur les billets et les acomptes de table d'un club, payée par le club. À trancher : qui fixe la remise d'un promoteur d'agence (le club seul, ou l'agence dans une limite du contrat). Relevé pendant SEC-09 et prouvé au banc (A15 de [sec09-bench.md](sec09-bench.md)), non corrigé | ½ j / 20 min |
| 17 | ~~MAIL-04~~ : test fait (`scheduled_test.ts`, en CI) | — |
| 18 | Étendre `isolation.mjs` à un couple d'espaces CLUB (les fonctions de club n'ont été jouées qu'avec un espace organisateur) | ½ j / 20 min |

## Plus tard (P3)

Faits dans la suite du 18/10 (§4 bis du rapport, migrations `20261023130000` →
`170000` et front) : SEC-04, SEC-05 (Console CRM), MAIL-07, MAIL-10, MAIL-11,
MAIL-12, MAIL-13, MAIL-14 (envoi), MAIL-15, UI-05.

| # | Quoi | Effort |
|---|---|---|
| 19 | Mettre en ligne la suite : 8 migrations `20261023100000` → `170000`, puis `send-campaign`, `process-scheduled-campaigns`, `send-sms-campaign`, `send-push-campaign`, `resend-webhook`, `owner-assistant`, puis le front (rapport §9, étape 6) | 1 h / 15 min |
| 20 | MAIL-14, aperçu : le Studio lit sous RLS et peut montrer le bloc d'une soirée publique d'un autre compte, que l'envoi retire ; un avertissement dans les contrôles avant envoi | ½ j / 20 min |
| 21 | SEC-05, Billetterie : une dizaine d'exports CSV ont leur propre échappement (OwnerCustomers, OwnerAccounting, OwnerPromoterFinance, rosterExport, admin…) : les passer par `csvCell` | ½ j / 20 min |
| 22 | MAIL-15, Billetterie : le Récap du Studio affiche `slug@yunoapp.eu` (mauvais domaine, sans le registre) ; lire l'adresse du registre | 2 h / 10 min |
| 23 | MCP `list_customers` : une hypothèse illisible est retirée par `jsonb_strip_nulls` et la liste vise toute la base (lecture seulement, 50 fiches) ; la refuser | 2 h / 10 min |

- ~~SYNC-03~~ : **fait** (trigger `trg_external_tickets_0_skip_stale`, `leaseAlive` à la reconnexion).
- ~~DATA-04~~ : **fait** (billet non EUR gardé, prix inconnu).
- ~~DATA-06~~ : **fait** (FAQ et articles de l'assistant).
- ~~DATA-07~~ : **fait** (`buyer_email_unreadable`, adresse précédente gardée).
- `crm_search` : le nombre de soirées d'un résultat compte encore les invitations non scannées (règle à aligner sur `_crm_sale_counts_as_night`).
- ~~Connexion : mauvais ID organisateur avec un jeton valide~~ : **fait** (SYNC-06 : Shotgun ne dit pas lequel est faux ; le message nomme l'ID d'abord). Carte de la Suite (`TicketingConnectionCard`, éteinte) inchangée.
- `npm audit` ciblé sur les dépendances exposées au navigateur, sans mise à jour majeure aveugle.

## Trouvé après l'audit (19/10) : le calcul de nuit du score

| # | Quoi | Qui | Effort |
|---|---|---|---|
| 19 | ~~PERF-01~~ : **en ligne** le 19/10 vers 09:25 UTC (`20261027100000`, répétée sur la prod avec le compte démo CRM : modèle, ajustement à froid et à chaud, journal identiques au bit près, calcul démo 5,0 s → 3,0 s ; JOURNAL). À vérifier : la passe `crm-score-nightly` de 05:27 UTC le 20/10 (durée, statut d'Amoris). Une réécriture complète de `_crm_score_journal` après cette migration doit reprendre la jointure par la clé. Retour arrière : `ROLLBACK-score.sql` | — | — |
| 20 | ~~PERF-02~~ : **en ligne** le 19/10 vers 09:25 UTC (`20261028100000`, après PERF-01 ; répétée sur la prod avec un VRAI délai de 2 s sur le compte démo : 57014 attrapé, modèle d'hier gardé, `score_overrun_at` posé, une alerte ; sans la migration la passe tombe ; JOURNAL). `score.budget_s` reste absent. Retour arrière : `ROLLBACK-score-overrun.sql` | — | — |
| 21 | Banc d'analyse (P3) : `node run.mjs build` échoue sur `20261015100000_legal_crm_terms.sql` (`legal_acceptances` absente de `schema/base.sql`, relu le 08/10). Relire la base ne suffit pas : `_crm_ticket_is_sale(text, jsonb)` n'existe plus en prod, les migrations rejouées de l'analyse l'appellent encore. `score-nightly.mjs` contourne en partant d'un instantané de la prod | session | ½ j / 30 min |

