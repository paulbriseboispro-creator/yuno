# Yuno CRM : audit de préparation au premier client (18/10/2026)

Branche `crm/readiness-audit` (11 commits sur `origin/main` = `f8049220`).
Rien n'est déployé, aucune migration n'est appliquée en prod, aucun e-mail ni SMS
n'est parti. Matrice des contrôles : [MATRIX.md](MATRIX.md). Procédures :
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
   (`20261022100000`) : à mettre en ligne avec les autres (section 9).
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
| MAIL-04 | P2 | Une campagne déprogrammée au dernier moment partait quand même (le cron ne vérifiait pas qu'il l'avait prise ; l'envoi programmé ne refusait que `sent` / `cancelled`). | `process-scheduled-campaigns`, `send-campaign` | lu | le cron saute une campagne qu'il n'a pas prise ; refus `not_scheduled_anymore` ; « failed » jamais écrit sur un brouillon | relecture (pas de test automatique) |
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
| SYNC-06 | P3 | Un mauvais ID organisateur avec un jeton valide se lisait « jeton non reconnu ». Shotgun refuse le couple sans dire lequel ne va pas : rien ne permet de distinguer les deux. | `ticketingErrorKey` | lu | le message de la connexion nomme l'ID d'abord, puis le jeton (`yc.co.err.orgOrToken`) | relecture |

## 5. Problèmes ouverts

| ID | P | Problème | Impact client | Proposition |
|---|---|---|---|---|
| DATA-08 | P2 | Le moteur d'analyse client (« Ce qui fait venir », « Qui cibler », « Fidèles du concept », chances de venir) comptait encore une vente comme une venue, entrée gratuite non scannée comprise (suite de DATA-02). | Prod, lecture seule (Amoris) : soirées-personnes de l'analyse 22 449 → 13 013, personnes 16 952 → 11 207, revenus au moins une fois 2 513 → 1 076. | **Corrigé, non appliqué** : `20261022140000` (après `20261022100000`). `_ana` = soirées faites (porte `_crm_sale_counts_as_night` / `_crm_measured_doors`) ; la CIBLE de « Chances de venir » reste l'achat (`_anbought`, comparé aux ventes par le journal prévu / réel). Banc `audit-analysis.mjs` : `petit` identique ligne pour ligne ; `gratuit` (façon WOH) 18 001 → 6 352 venues, `_anbought` = ancienne `_ana`. Familles / score de `gratuit`, `demo`, `grand`, `hasard` : à relancer. Limite : la projection de remplissage estime les nouveaux par `new_people` (nouveaux venus), elle sous-estimera sur un compte à entrées gratuites (porte `_crm_projection_gate` fermée). |
| OPS-05 | P2 | La prod fait tourner du code et une migration (`20261019150000`, e-mail pratique, branche `crm/s11-practical-email`) absents de main. | Déployer `send-campaign` depuis main retirerait l'e-mail pratique de la prod sans un mot. | Fusionner S11 avant cette branche (section 9). |
| MAIL-03 | P2 | La clé d'idempotence d'un lot dépend de sa composition : si l'écriture « envoyé » échoue après que Resend a accepté (≈ 21 s d'API en 503 après chaque migration), les lignes reviennent en file, sont regroupées autrement, et repartent. | Un même e-mail reçu deux fois par une centaine de personnes, rarement. | Garder la clé de lot sur les lignes à la réclamation et renvoyer le même lot ; réessayer l'écriture « envoyé ». |
| MAIL-08 | P2 | E-mail de test : le titulaire + 5 adresses libres, sans limite ni Yunit. | Relais d'envoi depuis le domaine marketing. | 20 tests / jour / espace ; adresses de l'équipe seulement. |
| MAIL-09 | P2 | `_crm_filter_sql` rend `true` quand aucune clé n'est reconnue : un segment fait seulement de clés inconnues vise toute la base **consentante**. | Envoi plus large que prévu (le consentement tient). | Clé inconnue = faux, comme les Scénarios. |
| UI-04 | P2 | Pas d'état d'erreur : Soirées, E-mails, Campagnes, tiroir client (squelette sans fin) ; Clients montre « aucun client » sur une erreur ; étape Audience reste sur « … ». | Le client croit sa base vide. | `CrmLoadError` partout (règle déjà écrite dans CLAUDE.md). |
| SMS-01 | P2 | Aucun secret Octopush en prod, mais la Console présente le SMS comme ouvert ; le test répond « SMS non configuré ». | Le premier client n'a aucun numéro consentant ; risque de confusion. | « Bientôt » tant qu'Octopush n'est pas branché. |
| OPS-02 | P2 | Sauvegardes physiques quotidiennes (9 gardées, dernière 18/10 01:27 UTC), **pas de PITR**, restauration jamais testée. | Jusqu'à 24 h de preuves de consentement et d'événements d'e-mail perdues. | Tester une restauration sur un projet isolé ; PITR au 2ᵉ ou 3ᵉ client payant. |
| OPS-03 | P2 | Rejeu des 1 231 migrations sur une base vierge non vérifié (Docker arrêté ; historique Lovable à trous connu). | Reconstruction de secours incertaine. | Un rejeu sur un projet de branche ; sinon un dump de schéma de référence. |
| OPS-04 | P2 | Des fonctions réécrites en place par un bloc `DO` (S5, `20261019300000`) ont en prod un texte différent du dernier fichier du dépôt. | Une reconstruction depuis le dépôt réintroduit l'ancien texte. | Migration de référence générée depuis `pg_get_functiondef`. |
| SEC-04 | P3 | Fonctions d'aide appelables par tout compte connecté : rôle d'un utilisateur dans une organisation, « a le CRM », plafonds d'envoi. Aucune donnée de client. | Information mineure. | Révoquer celles que le front n'appelle pas. |
| SEC-05 | P3 | Export CSV : pas de neutralisation des cellules commençant par `= + - @`. | Injection de formule dans Excel via un nom saisi chez Shotgun. | Préfixer d'une apostrophe. |
| MAIL-07 | P3 | `email_campaigns.product` modifiable par le client sur un compte à deux produits : la campagne passe sur le quota Billetterie, sans garde d'identité CRM. | Pas d'envoi gratuit sans limite (quota Billetterie). | Colonne écrite par le serveur seulement. |
| MAIL-10 | P3 | Webhook Resend accepté sans signature si le secret manque (il est posé en prod) ; comparaison non constante. | Aucun aujourd'hui. | Refuser sans secret ; comparaison en temps constant. |
| MAIL-11 | P3 | « Envoyé » = accepté par Resend ; « délivré » n'existe que comme événement ; « reçus » = envoyés − rebonds. | Libellé à préciser. | Montrer « acceptés » / « délivrés ». |
| UI-05 | P3 | Porte légale : échec d'enregistrement ignoré ; fenêtre sans piège de focus. Puce « Testez-le » d'Imports qui ajoute un faux contact à la vraie base. | Mineur. | Voir BACKLOG. |

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
  (décision de Paul du 18/10, DATA-02).
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
  de club appelées sans club). Aucune fuite d'une donnée de client. Limite : un
  seul couple d'espaces organisateur ; les fonctions de club n'ont pas été jouées
  avec un club.
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
   fonction `affiliate-ticket-sync`**, qui écrit sa colonne. Pour chacune : répétition dans
   une transaction annulée sur la prod, application avec sa ligne
   `schema_migrations`, puis `supabase db lint --linked`. Pas de `NOTIFY pgrst`
   nécessaire (aucune signature exposée ne change).
3. Fonctions edge, depuis main à jour : `affiliate-ticket-sync`, `send-campaign`,
   `unsubscribe-newsletter`, `process-scheduled-campaigns`, `send-missed-you`,
   `send-next-event-recommendation`, `owner-assistant` (article d'aide des
   connecteurs) (`supabase functions deploy --use-api`).
4. Front (Cloudflare Workers Builds) après les fonctions.
5. Contrôles après : RUNBOOK, « Après une mise en ligne ».

Retour arrière : les migrations sont réversibles par la définition précédente
(lue en prod le 18/10) : `ROLLBACK.sql` (20261021…) et `ROLLBACK-data.sql`
(20261022…, prouvé au banc par `audit-data.mjs`) ; les fonctions edge se
redéploient depuis le commit précédent.
