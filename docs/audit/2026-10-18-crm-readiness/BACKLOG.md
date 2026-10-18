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
| 15 | OPS-02 : restauration d'essai dans un projet isolé, chronométrée ; décider du PITR | ½ j |
| 16 | OPS-03 / OPS-04 : rejeu des migrations sur un projet de branche ; migration de référence des fonctions réécrites par bloc `DO` | 1 j / 45 min |
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
