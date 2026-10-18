# Yuno CRM : audit de préparation au premier client (18/10/2026)

Branche `crm/readiness-audit` (11 commits sur `origin/main` = `f8049220`).
**Mis en ligne le 18/10 après-midi** (migrations, fonctions, front ; main
`46e385ff`) : détail et contrôles dans [JOURNAL.md](JOURNAL.md), dernière section.
Aucun e-mail ni SMS n'est parti. Matrice des contrôles : [MATRIX.md](MATRIX.md). Procédures :
[RUNBOOK.md](RUNBOOK.md). Suite : [BACKLOG.md](BACKLOG.md). Journal et commandes :
[JOURNAL.md](JOURNAL.md).

## Verdict : PRÊT SOUS CONDITIONS

Prêt pour le premier client (un organisateur parisien sur Shotgun) **une fois les
corrections de cette branche mises en ligne**, dans l'ordre de la section 9, et
avec les limites ci-dessous dites au client.

Les conditions :

1. **Mettre en ligne le lot sécurité (SEC-01, P0) avant d'ouvrir un nouveau compte.**
   Aujourd'hui, n'importe qui peut lire avec la clé publique du site l'identité
   (nom, téléphone, date de naissance, ville) et l'historique d'achat de **tous les
   clients de la Billetterie Yuno**, ceux de WOH compris. La faille ne vient pas du
   CRM, mais elle touche ce client. La correction est une révocation de droits,
   prouvée au banc.
2. Mettre en ligne les corrections P1 : désabonnement en un clic (MAIL-01), accord
   relu au moment de l'envoi (MAIL-02), organisation Shotgun qui ne change plus sur
   une connexion déjà importée (SYNC-01) et accords retirés à la suppression des
   données (SYNC-01b), bandeau « import en cours » (UI-01).
3. DATA-02 tranché par Paul le 18/10 (une entrée gratuite non scannée sur une
   porte mesurée n'est pas une soirée faite) et corrigé dans cette branche
   (`20261022100000`), moteur d'analyse compris (`20261022140000`, DATA-08 ; le
   score « Chances de venir » reste sur les achats, décision de Paul) : à mettre
   en ligne avec les autres (section 9).
4. Fusionner `crm/s11-practical-email` **avant** cette branche : la prod fait
   tourner son code et sa migration, absents de main (OPS-05).

Ce qui n'a pas été vérifié, et qui empêche un « PRÊT » sans réserve : aucune
lecture réelle de l'API Shotgun par cet audit (le diagnostic du 17/10 l'avait fait
sur le compte WOH) ; aucune RPC jouée en tant que le titulaire réel (refusé par le
garde-fou de cette session) ; aucun envoi réel, même intercepté ; aucune
restauration de sauvegarde ; aucun rejeu des migrations sur une base vierge.

## 1. Ce qui a été audité, et comment

| Partie | Méthode | Où |
|---|---|---|
| État initial | lint, typage, tests, build, `deno check` | worktree, une commande à la fois |
| Shotgun | doc officielle relue le 18/10 (Notion, navigateur) contre le connecteur ; contrat simulé de la vraie passe | `ticketing_test.ts` |
| Données | relecture du chemin Shotgun → billets → personnes → segments ; agrégats en lecture seule sur la prod | `prod.mjs` (transaction READ ONLY) |
| Séparation entre espaces | 206 fonctions CRM jouées par A puis par B, au banc, sur les définitions de la prod | `isolation.mjs` |
| Sécurité plateforme | balayage du catalogue de la prod : fonctions à droits du propriétaire ouvertes à `anon`, tables et vues sans RLS | requêtes de catalogue |
| Envois | relecture de la chaîne e-mail et SMS ; bancs avant / après | `audit-mail.mjs` |
| Écrans | relecture des états (vide, chargement, erreur, partiel) ; vérification à l'écran du compte démo CRM | navigateur intégré, `localhost` |
| Exploitation | journal des passes, crons, sauvegardes (métadonnées), secrets (noms seulement) | API de gestion |

Le diagnostic du 17/10 (`docs/designs/CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md`, non
commité dans main) et ses sessions S1 à S6 ont servi de point de départ. Cet audit
les revérifie quand c'est possible et les cite sinon, avec leur date.

## 2. Cartographie courte

- **Front** : Vite 8 + React 18 + TypeScript, SPA sur Cloudflare Workers Assets ;
  Console CRM dans `src/crm/` (routes `src/crm/routes.tsx`), servie sur
  `crm.yunoapp.eu` via le Worker de la landing.
- **Back** : 100 % Supabase (Postgres, RLS, Auth, Storage, 100 fonctions edge
  Deno), projet `fulawxvdlwtdlpkycixe`, offre Pro, machine Micro (1 Go).
- **Shotgun** : fonction `affiliate-ticket-sync` (actions `ticketing_*`), cron
  `ticketing-sync` toutes les 5 min, jeton dans le Vault, tables
  `ticketing_connections`, `external_events`, `external_tickets` (RLS sans
  policy), post-traitement `ticketing_after_sync`.
- **Chemin des données** : Shotgun → `external_tickets` (une ligne par billet,
  `(connection_id, external_id)` unique) → soirées miroirs dans `events`
  (privées) → personnes (`_crm_people_build`, une par adresse e-mail en
  minuscules, par espace) → segments (`_crm_filter_sql`) → audience d'une
  campagne (registre de consentement `newsletter_subscriptions`) → file
  `email_campaign_recipients` → Resend → webhook → statuts et indicateurs.
- **Tâches de fond** : 26 crons CRM / envoi (liste dans le RUNBOOK) ; aucune ne
  dépend d'un onglet ouvert.
- **Tests** : 123 fichiers vitest (1 582 tests), un banc PGlite
  (`scripts/crm-bench/`), un test Deno. **Aucune CI ne les lançait** (OPS-01,
  ajoutée dans cette branche).

## 3. Shotgun : ce qui est conforme

La doc officielle relue le 18/10 dit la même chose que la copie du projet
(`docs/designs/SHOTGUN_API_REFERENCE.md`, 05/10) : mêmes champs, centimes pour
les billets, 100 billets par page, `pagination.next` seulement si la page est
pleine, tri par date de mise à jour puis id, curseur `after` en `date_id`, quota
de 100 requêtes / minute / IP. Deux précisions utiles : l'`organizer_id` doit
correspondre au jeton (un jeton ne lit pas une autre organisation) ; les dates
n'ont pas de fuseau (`2025-02-21 17:29:52.462881`). Pas de webhook documenté :
la synchro est un sondage, c'est le bon choix.

Le contrat simulé (11 cas, vraie fonction `syncConnection`, faux Shotgun et
fausse base) prouve : toutes les pages lues, rejeu sans doublon, passe coupée
reprise au curseur sans perte, curseur jamais au-delà de ce qui est enregistré,
billet ancien modifié (remboursé) rattrapé, 401 / 429 / 5xx / JSON invalide /
délai dépassé traités sans boucle ni faux succès, 5 pannes de suite = connexion en
erreur. **Contre le code d'avant cette branche, 10 cas sur 11 passaient déjà.**

En prod (lecture seule, 18/10 à 9 h 30 UTC) : une connexion active (Amoris → WOH),
cadence 15 min, aucune erreur de passe en 7 jours, passes du cron à 2,5 s en
moyenne (10,9 s au pire), 48 388 billets, `(connection_id, external_id)` unique.
Aucun billet « mis à jour » après l'instant où Yuno l'a lu : les dates sans
fuseau de Shotgun sont bien de l'UTC.

## 4. Problèmes corrigés dans cette branche

Priorités : P0 exposition de données ou envoi incontrôlé ; P1 parcours bloqué ou
chiffre important faux ; P2 défaut avec contournement ; P3 mineur.

| ID | P | Problème, impact pour le client | Où | Preuve avant | Correction | Test |
|---|---|---|---|---|---|---|
| SEC-01 | **P0** | Trois fonctions admin (`_admin_customer_activity`, `_identity`, `_rfm`) s'exécutent avec les droits du propriétaire, **sans garde**, et Postgres les avait ouvertes à `PUBLIC`. Avec la clé publique du site : nom, téléphone, date de naissance, ville de toute adresse, et l'historique d'achat de tous les clients de la Billetterie (WOH compris). | catalogue prod ; définies par `20260908190000` → `192000` | ACL `=X/postgres,anon=X/postgres` ; corps sans `auth.*` ni `is_super_admin` ; reproduit au banc. **Appel réel par l'API non fait** (refusé par le garde-fou de la session). | `20261021100000_audit_security_revokes.sql` : révocation, `service_role` seul. Leurs appelants sont des RPC admin gardées, propriétaire `postgres` : rien ne casse. | `scripts/crm-bench/audit-security.mjs` |
| MAIL-01 | P1 | Le bouton « Se désabonner » de Gmail / Yahoo (RFC 8058, exigé pour l'envoi de masse) envoie un POST à `yunoapp.eu/unsubscribe`, une page statique : rien ne se passe, la personne reste abonnée, puis signale l'e-mail comme indésirable (taux de plainte, disjoncteur, domaine partagé). | `send-campaign`, `_shared/email-compliance.ts` | lu : route absente de `run_worker_first`, aucun Worker ne la traite | l'en-tête pointe sur `unsubscribe-newsletter` (POST = désabonner, GET = renvoi vers la page). Module pur `_shared/one-click-unsubscribe.ts`. | `oneClickUnsubscribe.test.ts` |
| MAIL-02 | P1 | Désabonnement, plainte, purge : appliqués à la **mise en file** seulement. Une campagne déjà en file (vagues de 500 / h, rodage du domaine sur 6 jours, heures calmes, étape de scénario) continue d'écrire à la personne pendant des heures ou des jours. | `claim_campaign_recipients` | reproduit au banc : désabonné, adresse en plainte, adresse purgée partent | la réclamation relit suppression globale, accord de l'espace et repoussoir, pour le marketing seulement ; ligne `skipped` avec sa raison, Yunit rendu | `audit-mail.mjs` |
| SYNC-01 | P1 | Reconnecter une connexion déjà importée à une **autre** organisation Shotgun (y compris après « Déconnecter ») mêle les deux historiques, et garde les accords de la première. L'écran laissait modifier l'ID. | `ticketing.ts` (`ticketing_connect`) | lu en prod : aucun trigger sur `external_org_id` | refus `org_change_requires_purge` (409) avant tout appel à Shotgun ; message clair dans la Console | `ticketingShotgunAudit.test.ts` |
| SYNC-01b | P1 | « Supprimer les données importées » laisse **actifs** les accords que la billetterie avait versés : ces personnes restent joignables, y compris pour une nouvelle organisation. | `ticketing_connections` (DELETE) | reproduit au banc | trigger qui retire ces accords et les trace (`connector_purged`) ; refus et accords donnés ailleurs restent ; texte de confirmation mis à jour | `audit-sync.mjs` |
| UI-01 | P1 | Pendant le premier import (10 min pour 48 000 billets), la barre disait « Shotgun synchronisé » en vert et toutes les pages montraient des chiffres partiels comme définitifs ; une connexion coupée ou un compte en pause se lisaient aussi « synchronisé ». | `src/crm/shell/TopBar.tsx` | lu | bandeau « Import de votre historique Shotgun : chiffres encore partiels » sur chaque page, états coupé / en pause ; règle pure `syncChip` | `syncChip.test.ts` ; rendu normal vérifié à l'écran (compte démo) |
| SEC-02 | P2 | `get_customer_timeline` (historique d'un client, vide aujourd'hui) et deux rafraîchissements de vue matérialisée exécutables par `anon` sans garde (relance en boucle possible sur une machine de 1 Go). | catalogue prod | catalogue | révocation | `audit-security.mjs` |
| SEC-03 | P2 | `analytics_daily_rollup` (vue matérialisée, donc sans RLS) lisible par `anon` : visites, paniers, ventes et montants par club et organisateur, jour par jour. Aucun lecteur. | catalogue prod | catalogue | révocation de la lecture | `audit-security.mjs` |
| MAIL-05 | P2 | Gel d'envoi (Admin CRM) contournable : le trigger tournait avec les droits du client, qui lit `crm_settings` vide (RLS sans policy) et passe. | `guard_crm_send_frozen` | reproduit au banc avec les droits de la prod | la garde passe en `SECURITY DEFINER` (elle teste des données, pas `current_user`) | `audit-security.mjs` |
| MAIL-04 | P2 | Une campagne déprogrammée au dernier moment partait quand même (le cron ne vérifiait pas qu'il l'avait prise ; l'envoi programmé ne refusait que `sent` / `cancelled`). | `process-scheduled-campaigns`, `send-campaign` | lu | le cron saute une campagne qu'il n'a pas prise ; refus `not_scheduled_anymore` ; « failed » jamais écrit sur un brouillon | `scheduled_test.ts` (suite, §4 bis) |
| MAIL-06 | P2 | Un envoi abandonné après 3 tentatives ne comptait pas dans `failed_count` et son Yunit ne revenait pas. | `requeue_stale_campaign_claims` | reproduit au banc | compté et rendu par campagne | `audit-mail.mjs` |
| SYNC-02 | P2 | Une réponse 200 sans liste reconnue était lue comme « plus aucun billet » : import déclaré à jour sans rien avoir lu. | `ticketing.ts`, `ticketing-shotgun.ts` | le contrat échoue contre le code d'avant | `unexpected_response`, compté comme une panne | `ticketing_test.ts` |
| SYNC-04 | P2 | Après 5 pannes (≈ 2 h 30 de panne Shotgun), la connexion restait arrêtée jusqu'à un clic du pro. | `claim_ticketing_connections` | reproduit au banc | retentée à l'échéance du repli (2 h au plus) ; jamais un jeton refusé | `audit-sync.mjs` |
| UI-02 | P2 | Un échec de chargement de la page Connecteurs affichait « Non connecté » et proposait de reconnecter Shotgun. | `ConnectorsPage.tsx` | lu | `CrmLoadError` avec « Réessayer » | relecture |
| UI-03 | P2 | Les boutons « Synchroniser » disaient « réessayez dans un instant » sur un jeton refusé, une connexion coupée ou un non-titulaire. | `imports.ts`, Soirées, Imports | lu | vrai motif affiché ; 3 messages ajoutés (FR / EN / ES) | `syncChip.test.ts` (clés) |
| OPS-01 | P2 | Aucune CI ne lançait lint, typage ni tests. | `.github/workflows/` | — | `ci.yml` (lint, tsc, vitest, vitest en heure de Paris, build, contrat Deno) | — |
| SYNC-05 | P3 | Dates Shotgun sans fuseau lues dans le fuseau du serveur (juste en prod, faux sur un poste en France ; l'ancien test comparait à la même lecture). | `isoDate` | — | lues en UTC | tests en `TZ=Europe/Paris` et UTC |
| DATA-02 | **P1** | Une entrée gratuite **non scannée** comptait comme une soirée faite, y compris sur une porte mesurée où l'on sait que la personne n'est pas venue : « habitué », « fidèles » et nombre de soirées surévalués. **Décision de Paul (18/10)** : sur une porte mesurée, une entrée gratuite ne compte que scannée. | `_crm_people_build` (`att`), fiche client, aperçu des règles, Accueil, volet d'une soirée | mesuré en prod (lecture seule) : WOH habitués **399 → 72**, soirées 22 471 → 12 304, personnes avec au moins une soirée 16 966 → 10 566 ; autre compte 809 → 693 ; reproduit au banc | `20261022100000` : portes `_crm_sale_counts_as_night` et `_crm_measured_doors` (miroir `saleCountsAsNight`) ; la provenance garde « avait une place » ; un inscrit gratuit jamais venu sans place à venir = « aucune soirée » | `audit-data.mjs` ; `guestlist.test.ts` (cas partagés `sale-counts-as-night.json`, rejoués en SQL) |
| DATA-03 | P2 | La base de contacts (exports, fiches) additionnait la dépense des billets revendus, invitations et duplicatas ; la FAQ disait « valides ou transférés ». | `contact_scope_customers`, `yc.faq.sales.a` | banc : 115 € au lieu de 20 € | `20261022110000` : dépense = ventes (`_crm_ticket_is_sale`) ; appartenance inchangée ; FAQ corrigée (3 langues) | `audit-data.mjs` |
| DATA-05 | P2 | « Inclure les soirées co-organisées » : allumé, ne rattrapait rien ; éteint, ne retirait rien. Le connecteur cherchait un rôle `cohost` que Shotgun ne rend jamais (valeurs réelles : `editor`, `viewer`). | `crm_ticketing_set_cohosted`, connecteur | banc : éteindre laisse 22 billets et la soirée miroir ; prod : WOH 53 soirées `editor` et 25 `viewer` (33 281 billets) | `20261022120000` : allumer relit tout ; éteindre retire billets, miroirs et accords venus d'elles (tracé `connector_cohosted_off`) après confirmation dans la Console ; refusé pendant une lecture ; le connecteur ne crée plus ces soirées case éteinte (`isCohostedRole`) | `audit-data.mjs` ; contrat `ticketing_test.ts` (12ᵉ cas) ; `ticketingShotgunAudit.test.ts` |
| DATA-01 | P2 | L'effacement pour durée de conservation était défait si Shotgun renvoyait le billet (identité et accord revenaient jusqu'au balayage suivant). **Décision de Paul (18/10)** : marque par billet, pas de repoussoir. | `_crm_erase_contacts` | reproduit au banc | `20261022130000` : `external_tickets.erased_at` + trigger `trg_external_tickets_zz_keep_erased` ; un nouvel achat entre normalement | `audit-data.mjs` |
| DATA-07 | P3 | Une adresse que Shotgun rend mal formée devenait NULL, ce qui valait effacement (identité effacée, accord retiré, repoussoir « erased »). | connecteur, `external_tickets_note_provider_erasure` | reproduit au banc | le connecteur pose `buyer_email_unreadable` ; le trigger garde l'adresse précédente ; un champ vide reste un effacement | `audit-data.mjs` ; `ticketingShotgunAudit.test.ts` |
| SYNC-03 | P3 | Une version plus ancienne d'un billet pouvait écraser la plus récente (deux passes à la fois ; la reconnexion libérait le verrou d'une passe vivante). | `external_tickets`, `ticketing_connect` | reproduit au banc | trigger `trg_external_tickets_0_skip_stale` ; la reconnexion garde un bail vivant (`leaseAlive`) | `audit-data.mjs` ; `ticketingShotgunAudit.test.ts` |
| DATA-04 | P3 | Un billet en dollars ou en reais s'additionnait aux euros. | `mapShotgunTicket` | lu (100 % EUR en prod) | billet gardé, prix inconnu (`price` NULL) : ni payant ni gratuit, jamais dans une somme | `ticketingShotgunAudit.test.ts` |
| DATA-06 | P3 | `contact_*` = le **détenteur** du billet ; l'aide disait « acheteurs ». | FAQ, articles de l'assistant | lu | « détenteurs » dans `yc.faq.shotgun.a`, `yc.faq.customers.a`, `crm-overview`, `crm-ticketing-connect` | relecture |
| DATA-08 | P2 | Le moteur d'analyse client comptait encore toute vente comme une venue, entrée gratuite non scannée sur porte mesurée comprise (suite de DATA-02) : « Ce qui fait venir », artistes « vus », séries « fidèles », « venus une fois », « Qui cibler » et « Fidèles du concept » portaient sur des soirées où la personne n'est pas venue. **Décision de Paul (18/10)** : la règle vaut pour les hypothèses, les profils et les audiences ; le score « Chances de venir » reste entièrement sur les achats, facteurs ET cible. | `_crm_an_load` (table `_ana`), donc `_crm_an_engine`, `_crm_an_fill_hyps`, `crm_person_profile`, `crm_night_profile`, `crm_artist_stats`, `_crm_night_target_set` ; score : `crm_score_compute`, `_crm_score_build` | prod, lecture seule (Amoris) : soirées-personnes de l'analyse 22 449 → 13 013, personnes analysées 16 952 → 11 207, revenues au moins une fois 2 513 → 1 076 ; banc `gratuit` : 18 518 → 6 531 | `20261022140000` : `_ana` = soirées faites (`_crm_sale_counts_as_night`, `_crm_measured_doors`) ; le score lit `_anbought` (`_crm_an_load_bought`, l'ancienne `_ana` ligne pour ligne) et `_anp.passing_bought`. Essayé d'abord avec des facteurs sur les venues : l'AUC du banc `gratuit` tombait de 0,87 à 0,69, d'où la décision. Seules les RAISONS d'une chance suivent le statut des familles, comme avant | `audit-analysis.mjs` (instantané de la prod) : `petit`, `demo`, `grand`, `hasard` identiques sur les huit tables (`diff.mjs`) ; `gratuit` : `_anbought` et « de passage » du score = l'ancien (0 écart), portes du score ouvertes (`BENCH_SCORE_OPEN=1`) : 40 367 chances, étiquettes et raisons identiques à la même horloge, modèle identique (AUC 0,880 / 0,880) ; familles discovery et slot « pas de différence nette » → « à tester », brought « non testée » → « à tester » ; retour arrière `ROLLBACK-data.sql` prouvé |
| SYNC-06 | P3 | Un mauvais ID organisateur avec un jeton valide se lisait « jeton non reconnu ». Shotgun refuse le couple sans dire lequel ne va pas : rien ne permet de distinguer les deux. | `ticketingErrorKey` | lu | le message de la connexion nomme l'ID d'abord, puis le jeton (`yc.co.err.orgOrToken`) | relecture |

## 4 bis. Suite de l'audit : points d'envoi et finitions (18/10, après-midi)

Branche `claude/affectionate-lamport-a1b8b9`, par-dessus `crm/readiness-audit` (avance rapide, 22 commits).
Huit migrations `20261023100000` → `170000`, **aucune appliquée** ; fonctions
edge modifiées, **aucune déployée** ; aucun envoi. Chaque définition SQL
réécrite part de `pg_get_functiondef` de la prod (lu le 18/10, en lecture
seule, une requête à la fois). Retour arrière : [ROLLBACK-suite.sql](ROLLBACK-suite.sql),
rejoué au banc avec la séquence entière (`audit-suite-rollback.mjs`).

| ID | P | Problème, impact | Correction | Preuve |
|---|---|---|---|---|
| MAIL-03 | P2 | La clé d'idempotence d'un lot venait de sa composition : écriture « envoyé » en échec après l'acceptation de Resend ⇒ lignes rendues à la file, regroupées autrement, envoyées une 2ᵉ fois. | `20261023100000` : la réclamation pose `batch_key` sur les lignes et reprend un lot ouvert EN ENTIER, sous la même clé, avant toute ligne neuve. `send-campaign` (module `_shared/campaign-batch.ts`) : ordre fixe du lot, sous-clés fixes des moitiés d'un 422, 409 « clé déjà servie » = déjà parti (rien ne repart), écriture « envoyé » réessayée ~26 s, clé levée quand Resend a refusé. | `audit-send.mjs` (faille reproduite avant : 2 personnes servies deux fois ; après : aucune), `campaignBatch.test.ts` (faux Resend aux règles de la doc, panne injectée) |
| MAIL-09 | P2 | `_crm_filter_sql` rendait `true` quand aucune clé n'était reconnue : un segment de clés inconnues visait toute la base consentante. | `20261023110000` : clé inconnue ou valeur d'un type illisible = filtre entier faux (règle des Scénarios) ; vide, `seg: 'all'`, valeurs vides restent neutres. Texte repris de la prod (porte aussi le correctif posé en place par S5, OPS-04). Miroir `CLIENT_FILTER_KEYS`. | `audit-filter.mjs` (31 filtres valides identiques au caractère près, 12 illisibles faux), `filterKeys.test.ts` ; prod (lecture) : 6 segments, clés toutes connues, aucun ne change |
| MAIL-08 | P2 | E-mail de test : titulaire + 5 adresses libres, sans limite. | `20261023120000` : `email_test_send_allow` : la personne qui clique + les adresses de l'ÉQUIPE de l'espace, 20 tests par jour de Paris et par espace ; les autres adresses sont écartées et nommées à l'écran (Billetterie, Console CRM, scénarios). | `audit-test-send.mjs`, `testSend.test.ts` |
| MAIL-04 | P2 | (corrigé par l'audit, sans test) | Test automatique de la course ; il a trouvé un trou : une coupure réseau écrivait « failed » par-dessus un brouillon repris (corrigé). « Déprogrammer » trop tard le dit dans la Console CRM. | `process-scheduled-campaigns/scheduled_test.ts` (7 cas, en CI ; le cas réseau échoue contre le code d'avant) |
| SMS-01 | P2 | Aucun secret Octopush, Console qui présentait le SMS comme ouvert. | `CRM_SMS_DISPLAY_LIVE = false` : « Bientôt » sur /crm/sms/*, « Écrire à… », étape SMS de « 1re soirée », ajout et publication d'une étape SMS dans un scénario ; FAQ et assistant. Prod (lecture) : 0 recette avec SMS, 1 scénario démo avec SMS, 0 SMS en file. | typage, relecture |
| MAIL-07 | P3 | `email_campaigns.product` modifiable par le client. | `20261023130000` : trigger INVOKER, un client ne pose que `crm` ou NULL à la création et ne change jamais la valeur. | `audit-send.mjs` (avant / après) |
| MAIL-10 | P3 | Webhook Resend accepté sans secret ; comparaison non constante. | `_shared/svix-verify.ts` : sans secret = 503, comparaison octet par octet en temps constant. | `svixVerify.test.ts` |
| MAIL-11 | P3 | « Envoyés » / « Reçus » (« arrivés en boîte de réception »). | Libellés « Acceptés » / « Délivrés (boîte de réception ou indésirables) », 3 langues ; chiffres inchangés. Prod : Resend renvoie bien `delivered` (46 016 en 60 j). | tests de clés |
| MAIL-12 | P3 | Porte démo ouverte sur panne. | `demoMarketingScopeState` (démo / réel / inconnu, retentée une fois) ; sur « inconnu », rien ne part dans les trois workers et la campagne attend le passage suivant (jamais « échouée » ni rendue en brouillon par erreur). | `demo-guard_test.ts`, cas ajouté à `scheduled_test.ts` |
| MAIL-13 | P3 | Quotas journaliers à minuit UTC. | `20261023140000` : `paris_today()` dans les 6 fonctions des quotas et les valeurs par défaut. | `audit-quota.mjs` (session à une autre date que Paris : avant / après) |
| MAIL-14 | P3 | Un bloc pouvait tirer (clé de service) les données d'une soirée privée d'un autre compte. | `20261023160000` : `email_scope_event_ids` (parties de la soirée, co-hôtes acceptés ; Yuno : toutes) ; `send-campaign` retire les blocs d'une soirée hors de l'espace avant le rendu. Prod : les 310 soirées miroirs sont dans l'espace de leur connexion. | `audit-event-scope.mjs`, `emailBlockScope.test.ts` |
| MAIL-15 | P3 | Adresse d'expédition = slug du nom (homonymes, « support@ »). | `20261023170000` : registre `email_sender_locals` (unique, attribuée une fois ; suffixe tiré de l'espace pour un nom réservé ou pris) ; reprise : woh@, nuits-demo@, organisateur-demo@ gardés, Yuno garde yuno@, le club démo « Yuno » reçoit un suffixe. | `audit-sender.mjs` (slug SQL = slug de l'envoi sur 12 noms) |
| SEC-04 | P3 | Fonctions d'aide exécutables par tout compte (une par `anon`, qui écrit un compteur). | `20261023150000` : 6 révoquées ; gardées et dites : `crm_user_in_scope` (politiques RLS), `crm_scope_key` / `crm_scope_has_crm` (fonctions MCP INVOKER), `crm_practical_email_check` (front). | `audit-helpers.mjs` |
| SEC-05 | P3 | Injection de formule dans les CSV. | `csvCell` : apostrophe devant un texte qui commence par = + - @. | `csv.test.ts` |
| UI-05 | P3 | Porte légale, puce « Testez-le », cache, Yunits réservés, « déjà abonné ». | Accord non enregistré dit (« Réessayer » / « Plus tard ») ; focus piégé dans les fenêtres ; adresse d'exemple jamais ajoutée ; vraies clés de cache relues ; disponible = solde − réservé ; `already_subscribed` dit et relu. | `focusTrap`, `exampleAddress`, `ticketingCacheKeys`, `availableYunits` (tests) |

Restent de ces points : l'aperçu du Studio (MAIL-14) peut montrer un bloc
d'une soirée publique d'un autre compte qui ne partira pas ; les exports CSV
de la Billetterie gardent leurs échappements (SEC-05) ; le Récap de la
Billetterie affiche encore l'ancienne adresse (`slug@yunoapp.eu`, MAIL-15).

## 5. Problèmes ouverts

| ID | P | Problème | Impact client | Proposition |
|---|---|---|---|---|
| OPS-05 | P2 | La prod fait tourner du code et une migration (`20261019150000`, e-mail pratique, branche `crm/s11-practical-email`) absents de main. | Déployer `send-campaign` depuis main retirerait l'e-mail pratique de la prod sans un mot. | Fusionner S11 avant cette branche (section 9). |
| UI-04 | P2 | Pas d'état d'erreur : Soirées, E-mails, Campagnes, tiroir client (squelette sans fin) ; Clients montre « aucun client » sur une erreur ; étape Audience reste sur « … ». | Le client croit sa base vide. | `CrmLoadError` partout (règle déjà écrite dans CLAUDE.md). |
| OPS-02 | P2 | Sauvegardes physiques quotidiennes (9 gardées, dernière 18/10 01:27 UTC), **pas de PITR**, restauration jamais testée. Procédure d'essai prête (RUNBOOK §4.1) ; piège relevé : une copie restaurée relance aussitôt `pg_cron` / `pg_net` avec le secret des crons, et 16 crons appellent les fonctions edge de la **prod**. | Jusqu'à 24 h de preuves de consentement et d'événements d'e-mail perdues ; une restauration faite sans couper les crons ferait tourner les crons de la prod en double. | Restauration d'essai dans un projet isolé (quelques centimes, accord de Paul), crons coupés dans la copie ; PITR au 2ᵉ ou 3ᵉ client payant. |
| OPS-03 | P2 | Rejeu des 1 231 migrations sur une base vierge non fait (Docker arrêté). Relevé statique fait : la prod a 4 tables (`email_templates`, `private.secrets`, `contact_base_cache`, `contact_base_cache_state`), 12 triggers, 6 policies (dont 5 sur `storage.objects` : fichiers des clubs, des organisateurs, photos de profil, e-mails, lecture publique) qu'aucun fichier du dépôt ne crée ; 3 viennent de branches jamais fusionnées ([ops03-history-holes.md](ops03-history-holes.md)). | Une base reconstruite depuis le dépôt n'aurait pas ces objets : uploads refusés, cache de la base de contacts absent. | Rejeu réel (Docker local, gratuit, ou projet vide temporaire) ; puis une migration de rattrapage pour ces objets, lue depuis la prod. |
| OPS-04 | P2 | Mesuré : 50 des 1 659 fonctions de la prod diffèrent du dépôt — 35 réécrites en place (21 par un bloc `DO` identifiable, 14 sans auteur : bloc `DO` générique comme S5, ou SQL joué à la main), 13 absentes du dépôt (9 de S11, 4 de branches jamais fusionnées : `claude/dashboard-perf-fullscreen-szl3ft`, `claude/nifty-cori-dcjxgd`), 2 restées à une version antérieure ([ops04-functions.md](ops04-functions.md)). | Une reconstruction depuis le dépôt réintroduirait l'ancien texte de ces 50 fonctions. | Référence générée, non appliquée : `supabase/reference/20261018_prod_functions_reference.sql` (hors `supabase/migrations`, validée au banc). Décision : la garder en secours, ou en faire une vraie migration marquée appliquée en prod. |
| SEC-06 | P2 | Deux gardes du règlement promoteur ne sont pas ceux du dépôt, alors que `20260721090000` est marquée appliquée : la prod a reçu un brouillon de ce fichier. (1) `trg_guard_promoter_conversion_settlement` **n'existe pas** : owner, manager « promoteurs », organisateur et super admin modifient ou soldent une commission par un simple PATCH. (2) `guard_promoter_payout_write` est la version « drapeau » (`yuno.payout_rpc`, SECURITY DEFINER), que seules `dispute` et `auto_dispute` posent : `prepare`, `declare`, `confirm`, `cancel`, `resolve`, réécrites ensuite sans drapeau, sont refusées dès qu'un client les appelle. Prouvé au banc sur les définitions de la prod. Aucun lot réglé depuis le 28/07 ; les 15 commissions en attente au 18/10 sont au club démo (promoteurs d'agence), aucune chez un vrai client. | Billetterie, pas CRM : un club peut effacer une commission sans l'accord du promoteur, et le premier club ou organisateur qui voudra régler un promoteur ne le pourra pas. | **Correctif écrit, non appliqué** : `20261024100000_promoter_settlement_guards.sql` (gardes du dépôt, INVOKER, `is_direct_client_write()` ; toute écriture directe d'une commission refusée). Banc `sec06.mjs` 30 / 30 ([sec06-bench.md](sec06-bench.md)), smoke de répétition validé. Conséquence à trancher avant : SEC-08. |
| LINK-01 | P2 | `crm_link_create` : l'expression `'^https://[^[:space:]]{1,480}$'` est refusée par Postgres (répétition > 255, erreur 2201B, vérifié en prod en lecture). Créer un lien de partage **avec sa capture** échoue toujours ; sans capture, ça passe. 0 lien avec capture en prod (aucun des 774 liens suivis, dont 15 liens de partage CRM). Aucun autre quantificateur > 255 dans les fonctions, contraintes, policies et domaines de la prod (`link01.mjs scan`). | Le pro ne peut pas joindre la photo de sa story. | **Correctif écrit, non appliqué** : `20261024100100_crm_link_create_image_regex.sql`, `~ '^https://[^[:space:]]+$' AND length(p_image_url) <= 488`. Banc `link01.mjs` 13 / 13, 0 écart sur 400 URL au hasard ([link01-bench.md](link01-bench.md)). |
| SEC-07 | P2 | La policy « Promoters can update their own IBAN » (`auth.uid() = user_id`, toutes colonnes) laisse un promoteur modifier toute sa ligne `promoters` : taux de commission que lit `record_promoter_conversion`, dû, payé, rattachements. Prouvé au banc (O2). | Billetterie : un promoteur peut relever sa propre commission sur ses ventes suivantes, offrir 100 % de remise sur les billets et les acomptes de table du club, se rouvrir le scan de la porte, se rattacher à un autre club, et antidater `iban_changed_at` pour annuler le gel de 24 h. | **Correctif écrit, non appliqué** : `20261025200000_promoter_self_update_guard.sql` (garde INVOKER, `is_direct_client_write()`, premier trigger BEFORE UPDATE : le promoteur sans droit de gestion n'écrit plus que IBAN, BIC et profil). Banc `sec07.mjs` 35 / 35 dans quatre phases ([sec07-bench.md](sec07-bench.md)), smoke de répétition validé, indépendant de SEC-06. |
| SEC-08 | P2 (décision) | Supprimer un promoteur (policy owner / manager) efface en cascade ses commissions dues. Le garde « drapeau » empêche aujourd'hui, par accident, la suppression d'un promoteur qui a un lot de règlement ; avec le correctif de SEC-06 (version du dépôt), elle passe et emporte les lots (banc O1). | Une dette envers un promoteur peut disparaître avec sa fiche. | Décision de Paul avant SEC-06 : accepter, ou refuser la suppression directe d'un promoteur tant qu'une commission est due ou qu'un lot est ouvert. |
| SEC-09 | P2 | Le promoteur d'une vente n'est pas borné à la soirée. (1) `create-ticket-checkout` et `create-table-checkout` appliquent la remise et la commission du `promoterId` envoyé par le navigateur sans vérifier le club ni l'organisateur (seule la recherche par code l'était) ; le code est lu en `ilike` brut (« % » trouve le plus ancien promoteur de la soirée) et tout `promoCode` non vide ouvrait la prévente. (2) `record_promoter_conversion` (exécutable par `authenticated`) ne vérifie aucun périmètre : en service_role la garde est sautée, en client le promoteur lui-même passe pour n'importe quelle soirée, n'importe quel type, n'importe quel montant, sans vente. (3) La policy « Agency owner manages own promoters » ne regarde que l'agence : un chef d'agence crée ou déplace un promoteur dans n'importe quel club, alors que `invite-promoter` exige un contrat actif. Prouvé au banc sur les définitions de la prod. En prod au 18/10 : 0 des 138 commissions hors périmètre, 2 promoteurs d'agence, tous deux sous contrat actif. | Billetterie : un promoteur du club A fait payer sa remise au club B et y touche une commission ; un promoteur se crédite 10 000 € de commission par un appel RPC, que le club réglera au prochain lot une fois SEC-06 appliqué ; une agence installe chez un club un promoteur à 100 % de remise. | **Correctif écrit, non appliqué** (branche `crm/audit-sec09`) : checkouts bornés par `_shared/promoter-scope.ts` (id puis code, périmètre de la soirée, actif, sans joker, avant la prévente) ; `20261026100000_promoter_conversion_scope.sql` (client = tête de guest list scannée seulement ; tout appelant = promoteur partie de la soirée, sinon `out_of_scope`) ; `20261026100100_agency_promoter_contract_policy.sql` (création et changement de périmètre sous contrat actif). Banc `sec09.mjs` 41 / 41 dans cinq phases ([sec09-bench.md](sec09-bench.md)), smoke de répétition validé, `deno check` OK. À appliquer avec ou avant SEC-06. |
| SEC-10 | P2 (décision) | Un chef d'agence règle les taux et les remises client de ses promoteurs (policy agence ; SEC-07 le compte parmi ceux qui gèrent la fiche). Prouvé au banc (A15). | Sous contrat actif, une agence peut poser 100 % de remise sur les billets et acomptes de table d'un club, payée par le club. | Décision de Paul : la remise d'un promoteur d'agence est fixée par le club seul, ou par l'agence dans une limite inscrite au contrat. |
| DEP-01 | P2 | `@capacitor/ios` 8.4.1 : avis critique GHSA-rvm3-566m-v7fv (une page distante chargée à l'origine de l'app via `/_capacitor_http_interceptor_`). | Apps natives seulement ; exploitable par un lien touché dans la WebView. | 8.4.3 dans la prochaine version App Store des deux apps ([npm-audit.md](npm-audit.md)). |
| DEP-02 | P3 | Web : `react-router-dom` 6.30.3 (redirection ouverte, corrigé en 6.30.6 ; la variante « \ » seulement en 7.18), `fflate` 0.8.2 (boucle sur un ZIP malformé importé par le pro) ; `AuthHandoff.tsx` et `src/crm/lib/errors.ts` n'écartent pas `/\` dans `redirect`. | Faible. | 6.30.6, 0.8.3, refus de `\` dans les deux filtres. |
| DATA-08b | P3 | La projection de remplissage (« ≈ N acheteurs au total », `crm_night_targets`, `_crm_score_journal`, `crm_admin_analysis`) estime les nouveaux par `crm_night_profile.new_people`, qui compte depuis DATA-08 des nouveaux VENUS, alors qu'elle se règle sur les nouveaux ACHETEURS. | Sur un compte à entrées gratuites, la projection sous-estime ; la porte `_crm_projection_gate` (écart < 15 % sur 8 soirées) la garde fermée tant que c'est le cas : rien de faux n'est montré. | Une colonne « nouveaux acheteurs » (`new_buyers`) écrite par `_crm_an_write_nights` depuis `_anbought`, lue par les trois projections ; `new_people` reste le chiffre affiché « nouveaux venus ». |

## 6. Données : définitions et rapprochement

Définitions appliquées par le code (CLAUDE.md, sections Shotgun et guest list) :

- **Contact** : une adresse e-mail (minuscules) dans l'espace, venue d'un billet,
  d'un fichier importé ou d'une page d'inscription.
- **Client** : un contact avec au moins un billet `valid` ou `transferred`.
- **Participant (« venu »)** : billet scanné, sur une soirée dont la porte est
  mesurée (au moins 10 scans et 10 % des billets valides) ; sinon « porte non
  mesurée », jamais 0 %.
- **Achat (vente)** : billet `valid`, hors invitation et duplicata ; affiché en
  deux : billets payants (prix > 0) et entrées gratuites.
- **Soirée faite** (habitué, fidèles, nombre de soirées) : une vente ou une
  invitation scannée, sauf une entrée gratuite non scannée sur une porte mesurée
  (décision de Paul du 18/10, DATA-02), analyse client comprise (DATA-08). Le
  score « Chances de venir » compte, lui, les ACHATS : il prédit une place prise
  et se juge sur les ventes.
- **Dépense d'un contact** : la somme des ventes, hors invitations, duplicatas et
  billets revendus (DATA-03).
- **Chiffre d'affaires (Console CRM)** : somme des prix faciaux (`deal_price` ÷ 100)
  des ventes payantes, frais client exclus, frais organisateur Shotgun **non**
  déduits, remboursements partiels **inconnus** (Shotgun ne les rapporte pas).
- **Joignable** : accord newsletter actif dans le registre de l'espace, adresse
  hors suppression et hors repoussoir.

Rapprochement source / stocké / affiché : fait le 17/10 sur le compte réel (prix
au centime sur 48 388 billets, 0 doublon, 0 orphelin, 299 joignables sur 18 058 ;
plan du 17/10, §2 et §12). Revérifié le 18/10 sur le stocké seulement (unicité,
compteurs, fuseau). **L'affiché n'a pas été rejoué par cet audit** (jouer une RPC
en tant que le titulaire est refusé par le garde-fou de la session) : c'est le
premier contrôle à faire avec le client (RUNBOOK, étape 6).

Ce que l'analyse déduit (hypothèses, score) reste présenté comme des inférences :
formulations interdites testées (`analysis.test.ts`), aucun « vient pour ».

## 7. Sécurité et séparation entre espaces

- **Séparation** : 206 fonctions CRM qui prennent un espace en paramètre,
  définitions de la prod, jouées par A puis par B avec les arguments de A
  ([isolation-results.md](isolation-results.md)) : 157 refusent B par une erreur
  de droit, 9 lui rendent une réponse vide ou fausse, 10 rendent la même chose
  à A et à B mais ne sont que des clés ou des indicateurs sans donnée client
  (SEC-04), 30 refusent A comme B (fonctions super admin ou serveur, fonctions
  de club appelées sans club). Aucune fuite d'une donnée de client. Rejoué le 18/10 après-midi avec un couple
  d'espaces **club** (`venue:` A contre B, chacun propriétaire du sien) :
  156 refusés, 9 silencieux, 8 « même réponse » (clés, booléens et plafonds, sans
  donnée client), 33 non concluants (fonctions d'organisateur appelées sans
  organisateur, super admin, serveur, et `crm_link_create`, cassée pour tous :
  LINK-01) ([isolation-results-club.md](isolation-results-club.md)). Limite du
  banc : pas de RLS sur les tables, donc les fonctions à droits de l'appelant ne
  sont jugées que sur leur propre garde.
- **Accès direct aux tables** : toutes les tables lisibles par `anon` ou
  `authenticated` ont la RLS, sauf des vues : celles qui portent des données
  sensibles sont en `security_invoker` (la RLS s'applique) ; `djs_public` est
  publique par conception ; `analytics_daily_rollup` était ouverte (SEC-03).
- **Jeton Shotgun** : Vault, fonctions `service_role` seulement, remplacement et
  révocation effacent l'ancien secret, jamais renvoyé.
- **Session, invitations, accès assisté, 2FA** : couverts par les audits
  précédents (CLAUDE.md) ; non rejoués ici.
- **Points juridiques à faire valider** (pas une conformité déclarée par le code) :
  accords pris sur une soirée co-organisée (réglé par les faits le 17/10, libellé
  exact de la case non documenté par Shotgun) ; durée de conservation ; mineurs ;
  traceurs d'e-mails (recommandation CNIL 2026-042) ; e-mail pratique sans accord
  marketing (S11, lecture juridique faite par Paul le 18/10).

## 8. Exploitation et performance

- **Mesuré** : passes du cron 2,5 s en moyenne, 10,9 s au pire, 4 requêtes
  Shotgun au plus par passe courante ; import initial de 48 388 billets en
  10 min 48 s (17/10). Écrans : Ventes 90 j 0,9 s à chaud / 3,0 s à froid après
  S4 (mesure S4 du 18/10, non refaite ici).
- **Surveillance** : journal `ticketing_sync_runs`, alerte super admin à 5 pannes
  de suite, alerte jeton refusé, disjoncteur e-mail (plaintes > 0,2 %, rebonds
  > 5 %), cron de clôture des passes abandonnées.
- **Limites de l'hébergement** : machine Micro (1 Go) ; tomber est déjà arrivé
  sur la machine précédente sous des tests concurrents ; règle « un test lourd à
  la fois » respectée par cet audit.

## 9. Mise en ligne des corrections (à faire par Paul ou sur son « go »)

1. Fusionner `crm/s11-practical-email` dans main (OPS-05), puis rebaser cette branche.
2. Migrations, dans l'ordre : `20261021100000` (sécurité), `20261021110000`
   (file d'envoi), `20261021120000` (connecteur), puis les migrations
   « données » `20261022100000` (soirée faite), `20261022110000` (dépense),
   `20261022120000` (soirées co-organisées), `20261022130000` (billets :
   effacement, adresse illisible, version ancienne) — **cette dernière avant la
   fonction `affiliate-ticket-sync`**, qui écrit sa colonne — et
   `20261022140000` (moteur d'analyse, DATA-08 ; après `20261022100000`, dont
   elle lit les portes). Ses effets se lisent au calcul complet de la nuit
   (`crm-analysis-nightly`), ou tout de suite par `crm_analysis_compute(…, true)`
   compte par compte, une écriture lourde à la fois.
   Puis `20261024100000` (SEC-06, après la décision SEC-08), `20261024100100`
   (LINK-01), `20261025200000` (SEC-07, renumérotée : la prod porte déjà
   `20261025100000`, « partner_link_language ») et `20261026100000` +
   `20261026100100` (SEC-09, avec ou avant SEC-06). Pour chacune : répétition
   dans une transaction annulée sur la prod (SEC-06, LINK-01, SEC-07 et SEC-09
   ont leur smoke : `scripts/crm-bench/smoke/sec06.sql`, `link01.sql`,
   `sec07.sql`, `sec09.sql`), application avec sa ligne `schema_migrations`, puis
   `supabase db lint --linked`. Pas de `NOTIFY pgrst` nécessaire (aucune
   signature exposée ne change).
3. Fonctions edge, depuis main à jour : `affiliate-ticket-sync`, `send-campaign`,
   `unsubscribe-newsletter`, `process-scheduled-campaigns`, `send-missed-you`,
   `send-next-event-recommendation`, `owner-assistant` (article d'aide des
   connecteurs), puis `create-ticket-checkout` et `create-table-checkout`
   (SEC-09) (`supabase functions deploy --use-api`).
4. Front (Cloudflare Workers Builds) après les fonctions.
5. Contrôles après : RUNBOOK, « Après une mise en ligne ».
6. Suite (§4 bis), après les étapes 2-5 : migrations `20261023100000` → `170000`
   dans l'ordre (même procédure ; `20261023170000` réécrit
   `crm_email_settings_get`, `20261023110000` `_crm_filter_sql` : rebaser d'abord,
   et refaire la répétition si main les a touchées depuis le 18/10), PUIS
   `send-campaign`, `process-scheduled-campaigns`, `send-sms-campaign`,
   `send-push-campaign`, `resend-webhook`, `owner-assistant`, PUIS le front.
   `send-campaign` déployé avant `20261023120000` refuserait tous les tests
   (`email_test_send_allow` absente). Le SMS reste « Bientôt » jusqu'au
   branchement d'Octopush : remettre `CRM_SMS_DISPLAY_LIVE` à true dans le même
   déploiement que les secrets.

Retour arrière : les migrations sont réversibles par la définition précédente
(lue en prod le 18/10) : `ROLLBACK.sql` (20261021…, SEC-06, LINK-01, SEC-07,
SEC-09), `ROLLBACK-data.sql` (20261022…, prouvé au banc par `audit-data.mjs`) et
`ROLLBACK-suite.sql` (20261023…) ; les fonctions edge se redéploient depuis le
commit précédent.
