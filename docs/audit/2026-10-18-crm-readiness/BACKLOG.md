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
| 5 | DATA-02 : décider si une entrée gratuite non scannée compte comme une soirée faite sur une porte mesurée ; puis migration + banc | Paul, puis session | 1 j / 45 min |
| 6 | Rapprochement affiché ↔ Smartboard sur 2-3 soirées avec le client (RUNBOOK §1.8) | Paul + client | 30 min |

## Juste après (P2)

| # | Quoi | Effort |
|---|---|---|
| 7 | UI-04 : `CrmLoadError` sur Soirées, E-mails, Campagnes, tiroir client, liste Clients (passer `error`), étape Audience | 1 j / 30 min |
| 8 | MAIL-03 : clé d'idempotence stable par lot (gardée sur les lignes à la réclamation), réessai de l'écriture « envoyé » ; test d'injection d'échec | 2 j / 1 h |
| 9 | MAIL-09 : clé de filtre inconnue = faux dans `_crm_filter_sql` (inventaire des clés, banc sur les segments existants) | 1 j / 45 min |
| 10 | MAIL-08 : limiter les e-mails de test (20 / jour / espace, adresses de l'équipe) | ½ j / 20 min |
| 11 | SMS-01 : « Bientôt » sur le SMS tant qu'Octopush n'est pas branché | 2 h / 10 min |
| 12 | DATA-03 : dépense de `contact_scope_customers` sur `_crm_ticket_is_sale` ; FAQ `yc.faq.sales.a` | ½ j / 20 min |
| 13 | DATA-05 : allumer « co-organisées » remet le curseur à zéro ; l'éteindre retire ce qui en venait | 1 j / 30 min |
| 14 | DATA-01 : effacement pour conservation non défait par un réimport (décision : repoussoir ou marque par billet) | ½ j / 30 min |
| 15 | OPS-02 : restauration d'essai dans un projet isolé, chronométrée (procédure prête, RUNBOOK §4.1 : couper les crons de la copie d'abord) ; décider du PITR | 1 h, accord de Paul |
| 16 | OPS-03 : rejeu réel des migrations (Docker local ou projet vide temporaire) ; puis migration de rattrapage des objets créés hors dépôt (ops03-history-holes.md) | 2 h / 45 min |
| 16b | OPS-04 : décider du sort de `supabase/reference/20261018_prod_functions_reference.sql` (secours seulement, ou vraie migration marquée appliquée en prod) ; la régénérer après chaque réécriture par bloc `DO` | 15 min |
| 16c | SEC-06 : **migration écrite et prouvée au banc, à appliquer** : `20261024100000_promoter_settlement_guards.sql` remet le garde de `promoter_payouts` à la version du dépôt et crée celui de `promoter_conversions` (le garde actuel, version « drapeau », bloque aussi le cycle en trois temps : aucun lot réglable en prod). Banc `node scripts/crm-bench/sec06.mjs run` 30 / 30 ([sec06-bench.md](sec06-bench.md)) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/sec06.sql 20261024100000_promoter_settlement_guards.sql` (smoke validé au banc) ; décider 16g AVANT | 20 min d'application |
| 16d | LINK-01 : **migration écrite et prouvée au banc, à appliquer** : `20261024100100_crm_link_create_image_regex.sql` (une seule expression change, définition reprise de la prod). Banc `node scripts/crm-bench/link01.mjs run` 13 / 13 et 0 écart sur 400 URL tirées au hasard ([link01-bench.md](link01-bench.md)) ; aucun autre `{n,m}` > 255 en prod (`link01.mjs scan`) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/link01.sql 20261024100100_crm_link_create_image_regex.sql` | 10 min d'application |
| 16e | DEP-01 : `@capacitor/ios` 8.4.3 dans la prochaine version App Store des deux apps | ½ j / build CI |
| 16f | DEP-02 : `react-router-dom` 6.30.6, `fflate` 0.8.3, refus de `\` dans `AuthHandoff.tsx` et `crm/lib/errors.ts` | 2 h / 15 min |
| 16g | SEC-08 (**décision de Paul, avant 16c**) : supprimer un promoteur efface en cascade ses commissions dues ; aujourd'hui le garde « drapeau » empêche par accident de supprimer un promoteur qui a un lot de règlement, après 16c ce sera possible (comportement prévu par le dépôt : la cascade tourne sous le propriétaire de la table, banc O1). Option : garde `BEFORE DELETE` sur `promoters` qui refuse une suppression directe tant qu'il reste une commission due ou un lot ouvert (message à traduire dans la Console) | ½ j / 20 min |
| 16h | SEC-07 : **migration écrite et prouvée au banc, à appliquer** : `20261025100000_promoter_self_update_guard.sql`, garde INVOKER `trg_a_guard_promoter_self_update` fondé sur `is_direct_client_write()` (premier des triggers BEFORE UPDATE : le gel IBAN reste posé par `trg_stamp_promoter_iban_change`). Le promoteur sans droit de gestion sur sa fiche n'écrit plus que `iban`, `bic`, `instagram_url`, `whatsapp_number`, `profile_image_url`, `promo_code` (inventaire du front : `PromoterProfileTab`, `PromoterProfilePage`), plus `first_name`, `last_name`, `phone` ; owners, managers « promoteurs », organisateurs et leurs admins, chefs d'agence, super admin, RPC, fonctions edge et cascades inchangés. Faille plus large que relevé : remise client à 100 % sur billets et acomptes de table (payée par le club), scan de la porte, réactivation, rattachement à un autre club, `iban_changed_at` antidaté (gel de 24 h annulé). Banc `node scripts/crm-bench/sec07.mjs run` 35 / 35 dans quatre phases ([sec07-bench.md](sec07-bench.md)) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/sec07.sql 20261025100000_promoter_self_update_guard.sql` (smoke validé au banc) ; indépendante de 16c et 16g **⚠ Version déjà prise en prod** : `20261025100000` y est la migration « partner_link_language » (liens partenaires, appliquée le 18/10) ; `db push` sauterait SEC-07 en silence. Renuméroter le fichier (ex. `20261025200000`), son en-tête, son bloc ROLLBACK et `sec07.mjs` avant de l'appliquer | 15 min d'application |
| 16i | SEC-09 : **prouvé au banc, migrations et code écrits, à appliquer** (branche `crm/audit-sec09`). (1) Checkouts : l'id de promoteur envoyé par le navigateur n'était pas borné à la soirée (remise de son club et commission sur la soirée d'un autre club), un code « % » trouvait le plus ancien promoteur de la soirée (sa remise, l'accès prévente), et n'importe quel `promoCode` ouvrait la prévente. `create-ticket-checkout` et `create-table-checkout` résolvent maintenant id puis code dans le périmètre de la soirée, actif, sans joker (`_shared/promoter-scope.ts`, test `promoterScope.test.ts`), avant la prévente ; la métadonnée Stripe ne porte plus que le code résolu. (2) `record_promoter_conversion` ne vérifiait aucun périmètre et laissait un promoteur se créditer une commission de billet du montant de son choix, sans vente, autant de fois qu'il voulait (`authenticated` l'exécute) : `20261026100000_promoter_conversion_scope.sql` (client = tête de guest list scannée de cette soirée seulement ; tout appelant : promoteur partie de la soirée via `event_parties`, sinon `out_of_scope` sans rien écrire). (3) Policy « Agency owner manages own promoters » : `20261026100100_agency_promoter_contract_policy.sql` (création et changement de périmètre sous contrat `active` seulement ; une fiche au périmètre inchangé reste modifiable, contrat en pause compris). Banc `node scripts/crm-bench/sec09.mjs run` 41 / 41 dans cinq phases ([sec09-bench.md](sec09-bench.md)) ; répétition : `rehearse.mjs scripts/crm-bench/smoke/sec09.sql 20261026100000_promoter_conversion_scope.sql 20261026100100_agency_promoter_contract_policy.sql` (smoke validé au banc) ; ROLLBACK bloc 7. À appliquer **avec ou avant 16c** : sans le cycle de règlement, une commission inventée ne se paie pas. Fonctions à redéployer : `create-ticket-checkout`, `create-table-checkout`. Après mise en ligne : `sec06.mjs` R11 et `sec07.mjs` S1 appellent la RPC en promoteur pour un billet, à passer en `service_role` au prochain instantané | fait / 15 min d'application |
| 16j | SEC-10 (**décision de Paul**) : un chef d'agence règle les taux de commission ET les remises client de ses promoteurs (policy agence, et SEC-07 le compte parmi ceux qui gèrent la fiche) : sous contrat actif, il peut poser 100 % de remise sur les billets et les acomptes de table d'un club, payée par le club. À trancher : qui fixe la remise d'un promoteur d'agence (le club seul, ou l'agence dans une limite du contrat). Relevé pendant SEC-09 et prouvé au banc (A15 de [sec09-bench.md](sec09-bench.md)), non corrigé | ½ j / 20 min |
| 17 | MAIL-04 : test automatique de la course « déprogrammée pendant le passage du cron » (aujourd'hui relecture seulement) | ½ j / 20 min |
| 18 | Étendre `isolation.mjs` à un couple d'espaces CLUB (les fonctions de club n'ont été jouées qu'avec un espace organisateur) | ½ j / 20 min |

## Plus tard (P3)

- SYNC-03 : ignorer une version plus ancienne d'un billet (trigger) ; `ticketing_connect` respecte un verrou vivant.
- SEC-04 : révoquer les fonctions d'aide que le front n'appelle pas (`crm_org_role`, `crm_user_in_scope` direct, plafonds).
- SEC-05 : neutraliser `= + - @` en tête de cellule dans les exports CSV.
- MAIL-07 : `email_campaigns.product` écrit par le serveur seulement.
- MAIL-10 : webhook Resend refusé sans secret ; comparaison en temps constant.
- MAIL-11 : distinguer « acceptés » et « délivrés » dans les rapports.
- MAIL-12 : `isDemoMarketingScope` fermé sur erreur.
- MAIL-13 : quotas journaliers à minuit Paris.
- MAIL-14 : vérifier qu'un `eventId` de bloc d'e-mail appartient à l'espace (aperçu et envoi).
- MAIL-15 : adresse d'expédition qui ne dépend pas que du nom du compte.
- DATA-04 : devise non EUR refusée ou marquée.
- DATA-06 : « détenteurs » plutôt qu'« acheteurs » dans l'aide.
- DATA-07 : une adresse mal formée renvoyée par Shotgun ne doit pas valoir effacement.
- UI-05 : porte légale (échec d'enregistrement, focus), puce « Testez-le » d'Imports qui ajoute un faux contact, clés de cache après suppression, Yunits réservés dans le contrôle d'envoi, erreurs de facturation.
- Connexion : mauvais ID organisateur avec un jeton valide → « ID inconnu » plutôt que « jeton non reconnu ».
- `npm audit` ciblé sur les dépendances exposées au navigateur, sans mise à jour majeure aveugle.
