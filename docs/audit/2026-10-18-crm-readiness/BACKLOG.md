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
| 16d | LINK-01 : **migration écrite et prouvée au banc, à appliquer** : `20261024100100_crm_link_create_image_regex.sql` (une seule expression change, définition reprise de la prod). Banc `node scripts/crm-bench/link01.mjs run` 13 / 13 et 0 écart sur 400 URL tirées au hasard ([link01-bench.md](link01-bench.md)) ; aucun autre `{n,m}` > 255 en prod (`link01.mjs scan`) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/link01.sql 20261024100100_crm_link_create_image_regex.sql` | 10 min d'application |
| 16e | DEP-01 : `@capacitor/ios` 8.4.3 dans la prochaine version App Store des deux apps | ½ j / build CI |
| 16f | DEP-02 : `react-router-dom` 6.30.6, `fflate` 0.8.3, refus de `\` dans `AuthHandoff.tsx` et `crm/lib/errors.ts` | 2 h / 15 min |
| 16g | SEC-08 (**décision de Paul, avant 16c**) : supprimer un promoteur efface en cascade ses commissions dues ; aujourd'hui le garde « drapeau » empêche par accident de supprimer un promoteur qui a un lot de règlement, après 16c ce sera possible (comportement prévu par le dépôt : la cascade tourne sous le propriétaire de la table, banc O1). Option : garde `BEFORE DELETE` sur `promoters` qui refuse une suppression directe tant qu'il reste une commission due ou un lot ouvert (message à traduire dans la Console) | ½ j / 20 min |
| 16h | SEC-07 : **migration écrite et prouvée au banc, à appliquer** : `20261025200000_promoter_self_update_guard.sql` (renumérotée : la prod porte déjà `20261025100000`), garde INVOKER `trg_a_guard_promoter_self_update` fondé sur `is_direct_client_write()` (premier des triggers BEFORE UPDATE : le gel IBAN reste posé par `trg_stamp_promoter_iban_change`). Le promoteur sans droit de gestion sur sa fiche n'écrit plus que `iban`, `bic`, `instagram_url`, `whatsapp_number`, `profile_image_url`, `promo_code` (inventaire du front : `PromoterProfileTab`, `PromoterProfilePage`), plus `first_name`, `last_name`, `phone` ; owners, managers « promoteurs », organisateurs et leurs admins, chefs d'agence, super admin, RPC, fonctions edge et cascades inchangés. Faille plus large que relevé : remise client à 100 % sur billets et acomptes de table (payée par le club), scan de la porte, réactivation, rattachement à un autre club, `iban_changed_at` antidaté (gel de 24 h annulé). Banc `node scripts/crm-bench/sec07.mjs run` 35 / 35 dans quatre phases ([sec07-bench.md](sec07-bench.md)) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/sec07.sql 20261025100000_promoter_self_update_guard.sql` (smoke validé au banc) ; indépendante de 16c et 16g **⚠ Version déjà prise en prod** : `20261025100000` y est la migration « partner_link_language » (liens partenaires, appliquée le 18/10) ; `db push` sauterait SEC-07 en silence. Renuméroter le fichier (ex. `20261025200000`), son en-tête, son bloc ROLLBACK et `sec07.mjs` avant de l'appliquer | 15 min d'application |
| 16i | SEC-09 : **prouvé au banc, migrations et code écrits, à appliquer** (branche `crm/audit-sec09`). (1) Checkouts : l'id de promoteur envoyé par le navigateur n'était pas borné à la soirée (remise de son club et commission sur la soirée d'un autre club), un code « % » trouvait le plus ancien promoteur de la soirée (sa remise, l'accès prévente), et n'importe quel `promoCode` ouvrait la prévente. `create-ticket-checkout` et `create-table-checkout` résolvent maintenant id puis code dans le périmètre de la soirée, actif, sans joker (`_shared/promoter-scope.ts`, test `promoterScope.test.ts`), avant la prévente ; la métadonnée Stripe ne porte plus que le code résolu. (2) `record_promoter_conversion` ne vérifiait aucun périmètre et laissait un promoteur se créditer une commission de billet du montant de son choix, sans vente, autant de fois qu'il voulait (`authenticated` l'exécute) : `20261026100000_promoter_conversion_scope.sql` (client = tête de guest list scannée de cette soirée seulement ; tout appelant : promoteur partie de la soirée via `event_parties`, sinon `out_of_scope` sans rien écrire). (3) Policy « Agency owner manages own promoters » : `20261026100100_agency_promoter_contract_policy.sql` (création et changement de périmètre sous contrat `active` seulement ; une fiche au périmètre inchangé reste modifiable, contrat en pause compris). Banc `node scripts/crm-bench/sec09.mjs run` 41 / 41 dans cinq phases ([sec09-bench.md](sec09-bench.md)) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/sec09.sql 20261026100000_promoter_conversion_scope.sql 20261026100100_agency_promoter_contract_policy.sql` (smoke validé au banc) ; ROLLBACK bloc 7. À appliquer **avec ou avant 16c** : sans le cycle de règlement, une commission inventée ne se paie pas. Fonctions à redéployer : `create-ticket-checkout`, `create-table-checkout`. Après mise en ligne : `sec06.mjs` R11 et `sec07.mjs` S1 appellent la RPC en promoteur pour un billet, à passer en `service_role` au prochain instantané | fait / 15 min d'application |
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
