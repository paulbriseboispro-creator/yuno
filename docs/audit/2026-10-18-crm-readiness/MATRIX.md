# Matrice des contrôles — audit du 18/10/2026

Statuts : **réussi** / **échoué** (défaut trouvé ; « corrigé » si la branche le
corrige, avec le test qui le prouve) / **bloqué** (accès refusé ou manquant) /
**non exécuté** / **non applicable**. « Avant » = `origin/main` `f8049220` et la
prod du 18/10 ; « après » = branche `crm/readiness-audit`.

## A. Shotgun : exigence documentée / implémentation / test / résultat

Doc officielle relue le 18/10 dans le navigateur (pages Notion « /tickets API » et
« Organizer events API », liées depuis « Find your Organizer id and API token »,
qui répond 403 à un robot). Copie du projet : `docs/designs/SHOTGUN_API_REFERENCE.md`
(05/10), identique sur tout ce qui suit.

| Exigence (doc) | Implémentation | Test | Résultat |
|---|---|---|---|
| `GET api.shotgun.live/tickets`, `organizer_id` obligatoire, jeton en `Bearer` | `ticketsUrl`, `fetchTicketsPage` | `ticketingShotgun.test.ts` | réussi |
| `organizer_id` doit correspondre au jeton | vérification à la connexion (`verifyShotgun`), une requête vide authentifiée | — | réussi (lu) ; mauvais ID = 401/403 → « jeton non reconnu » plutôt que « ID inconnu » (P3, BACKLOG) |
| 100 billets max par page ; `pagination.next` seulement si la page est pleine | arrêt sur page < 100 ou sans suivante ; lien suivi seulement sur l'hôte Shotgun en https | contrat `ticketing_test.ts` (350 billets → 4 requêtes) | réussi |
| Tri par mise à jour puis id ; `after` = date ou `date_id` | curseur `ticketCursor` = `date_id` du dernier billet de la page | contrat (3 billets par horodatage) | réussi |
| Dates sans fuseau (`2025-02-21 17:29:52.462881`) | `isoDate` | `ticketingShotgunAudit.test.ts` en UTC et en `Europe/Paris` | échoué → **corrigé** (SYNC-05) ; prod en UTC : aucun billet daté après sa lecture |
| Curseur : microsecondes | coupé à la milliseconde | — | réussi (relecture de quelques billets, jamais un saut) |
| Montants des billets en centimes, des tarifs de soirée en euros | `money(…, 100)` billets ; diviseur 1 soirées | `ticketingShotgun.test.ts` ; prix au centime sur 48 388 billets (17/10) | réussi |
| `currency` : eur, usd, brl | stockée, jamais filtrée | — | échoué (DATA-04, P3) ; 100 % EUR sur le compte réel |
| Quota 100 req / min / IP, commun à tous les clients | limiteur `consume_ticketing_rate('shotgun', 45)` avant chaque requête | lu en prod (service_role seul) | réussi |
| `include_cohosted_events` | case de la connexion | — | réussi ; rattrapage à l'allumage absent (DATA-05, P2) |
| Statuts `valid`, `resold`, `refunded`, `canceled`, `payment_plan_pending`, `pending_approval`, `rejected` | `normalizeTicketStatus` | `ticketingShotgun.test.ts` | réussi |
| `ticket_scan_code` ne doit pas fuir | jamais stocké ; `raw` sans coordonnée (S5) | `ticketingShotgun.test.ts` | réussi |
| `contact_*` = le détenteur | rangé en `buyer_*` | — | réussi sur la donnée ; vocabulaire « acheteurs » (DATA-06, P3) |
| Aucun webhook, aucun remboursement partiel, pas d'acheteur ≠ détenteur | sondage toutes les 5 min ; « Bientôt » à l'écran | — | non applicable |
| Events : `?key=` (`token` déprécié), `past_events`, `page` / `limit`, `updated_after` | `eventsUrl`, essai `key` puis `token` | lu | réussi |

## B. Synchronisation (contrat simulé + prod)

| Contrôle | Test | Statut |
|---|---|---|
| Toutes les pages importées | contrat, cas 1 | réussi |
| Rejouer l'import : aucun doublon | contrat, cas 2 ; prod : `(connection_id, external_id)` unique, 0 doublon | réussi |
| Deux synchros concurrentes ne corrompent pas | relecture : verrou `locked_until` + `FOR UPDATE SKIP LOCKED`, bail 150 s, passe la plus longue 45,6 s | réussi ; écrasement par une version plus ancienne possible si le bail expire (SYNC-03, P3) |
| Interruption reprise sans perte ni doublon | contrat, cas 3 (5xx en page 3) | réussi |
| Curseur jamais au-delà de ce qui est enregistré | contrat, cas 4 (écriture en échec en page 3) | réussi |
| Modification d'un ancien billet rattrapée | contrat, cas 5 ; prod : un scan avance le curseur (17/10) | réussi |
| 401 / 403 | contrat, cas 6 : `token_invalid`, une seule requête, alerte | réussi |
| 429 | contrat, cas 7 : arrêt, reprise dans 2 min, pas compté comme panne | réussi |
| 5xx répétés | contrat, cas 11 : 5 pannes → `error`, alerte, pas de boucle | réussi |
| Reprise automatique après 5 pannes | `audit-sync.mjs` | échoué → **corrigé** (SYNC-04) |
| Délai dépassé | contrat, cas 10 : panne comptée, repli de 5 min | réussi |
| JSON invalide | contrat, cas 8 | réussi |
| Réponse 200 de forme inconnue | contrat, cas 9 (échoue contre le code d'avant) | échoué → **corrigé** (SYNC-02) |
| Import partiel affiché comme partiel | relecture + `syncChip.test.ts` ; rendu normal vu à l'écran | échoué → **corrigé** (UI-01) ; bandeau non vu à l'écran (pas de connexion non importée à montrer sans écrire en prod) |
| Dernière synchro réussie, erreur compréhensible, moyen de reprise | Connecteurs (lu), barre du haut | réussi après UI-02 / UI-03 |
| Déconnexion et changement d'organisateur ne mélangent pas | `ticketingShotgunAudit.test.ts`, `audit-sync.mjs` | échoué → **corrigé** (SYNC-01, SYNC-01b) |
| Intégration réelle (lecture de l'API) | — | **non exécuté par cet audit** (quota partagé et jeton du client) ; fait le 17/10 : import complet, agrégats comparés |

## C. Données CRM

| Contrôle | Statut |
|---|---|
| Unicité par client et par source | réussi (index uniques ; personnes par espace) |
| Plusieurs billets par commande, achats répétés, homonymes, e-mail absent ou modifié | réussi à la relecture (adresse = identité ; billet sans e-mail = vente sans personne ; changement d'adresse suivi par `ticketing_email_moves`) |
| Gratuits, annulation, remboursement, transfert, scan | réussi à la relecture (miroirs TS testés) ; DATA-02 (gratuit non scanné = soirée faite) ouvert |
| Fuseaux, devises, arrondis | réussi (UTC vérifié en prod) ; devise non gérée (DATA-04) |
| Rapprochement source / stocké / affiché | stocké : réussi (18/10) ; source : réussi le 17/10 ; affiché : **bloqué** (RPC en tant que le titulaire refusée par le garde-fou de la session) |
| Exclusions et désinscriptions survivent à une resynchro | réussi (`ON CONFLICT DO NOTHING`, suppression globale, repoussoir) ; effacement pour conservation non (DATA-01) |
| Inférences présentées comme telles | réussi (`analysis.test.ts`) |

## D. Sécurité et séparation

| Contrôle | Statut |
|---|---|
| A ne lit pas B par les fonctions CRM (206 fonctions) | réussi — `isolation.mjs` ; couple d'organisateurs 158 refusés / 9 silencieux / 9 même réponse sans donnée client / 30 non concluants ; **couple de clubs** (18/10 après-midi) 156 / 9 / 8 / 33 ([isolation-results-club.md](isolation-results-club.md)) |
| Fonctions à droits du propriétaire ouvertes à `anon` sans garde | échoué → **corrigé** (SEC-01 P0, SEC-02) |
| Tables / vues lisibles sans RLS | échoué → **corrigé** (SEC-03) ; le reste en `security_invoker` |
| Gel d'envoi | échoué → **corrigé** (MAIL-05) |
| Appel réel de l'API publique pour prouver SEC-01 | **bloqué** (refusé par le garde-fou de la session) ; prouvé par le catalogue et au banc |
| Jeton Shotgun : stockage, accès, remplacement, révocation | réussi |
| Secrets côté navigateur | réussi (clé anon seulement) |
| Sessions, invitations, récupération, routes admin | non exécuté ici (audits antérieurs, CLAUDE.md) |
| Dépendances exposées | **échoué, ouvert** ([npm-audit.md](npm-audit.md)) : `@capacitor/ios` 8.4.1 critique dans les apps natives (DEP-01, corrigé en 8.4.3, version App Store) ; web : `react-router-dom` 6.30.3, `fflate` 0.8.2 modérés (DEP-02) ; 16 paquets signalés ne sont que des outils de build |
| Injection CSV | échoué, ouvert (SEC-05, P3) |

## E. Envois

| Contrôle | Statut |
|---|---|
| Destinataires et expéditeur rattachés au bon espace | réussi (relecture ; identité d'expéditeur obligatoire depuis S3) |
| Dédoublonnage double clic, retry, redémarrage, workers concurrents | réussi pour les cas normaux ; doublon possible après une écriture « envoyé » perdue (MAIL-03, P2, ouvert) |
| Demandé / accepté / délivré | partiel (MAIL-11, P3) |
| Webhook : signature, doublons, désordre | réussi (secret posé, `svix_id` unique, un « délivré » n'écrase pas un rebond) ; durcissement MAIL-10 |
| Désinscription, plainte, rebond appliqués au moment de l'envoi | échoué → **corrigé** (MAIL-02) |
| Désabonnement en un clic (Gmail / Yahoo) | échoué → **corrigé** (MAIL-01) ; POST réel non rejoué |
| Pas de réactivation par un import Shotgun | réussi |
| Provenance de l'accord | réussi (source, `consent_source`, traces) |
| Annulation, programmation | échoué → **corrigé** (MAIL-04) |
| Quotas, Yunits | réussi ; abandon non remboursé → **corrigé** (MAIL-06) |
| Envoi intercepté de bout en bout | **non exécuté** (aucun bac à sable Resend dans cet environnement) |
| Domaine d'envoi authentifié | non exécuté ici (DNS vérifiés le 05/10, mémoire du projet) |
| SMS | **bloqué** : aucun secret Octopush en prod (SMS-01) |

## F. Parcours du premier client

| Étape | Statut |
|---|---|
| Compte neuf, arrivée dans un espace | **non exécuté** (créer un compte en prod n'est pas permis à cet audit) |
| Connexion Shotgun | réussi à la relecture ; messages d'erreur complétés |
| Progression du premier import | corrigé (UI-01) |
| Contacts, recherche, filtres, segments, indicateurs, exports | relecture : états d'erreur manquants (UI-04, P2) |
| Préparation d'une campagne | relecture : réussi ; étape Audience sans état d'erreur (UI-04) |
| Rendu à l'écran (compte démo, 1440 px) | réussi : Accueil et Connecteurs, aucune erreur console |
| Formats d'écran, clavier | partiel (P3, BACKLOG) |

## G. Exploitation

| Contrôle | Statut |
|---|---|
| Tâches sans onglet ouvert | réussi (crons, chaîne de relance de la fonction) |
| Journal, alertes | réussi |
| Sauvegardes | réussi (quotidiennes, 9 gardées) ; pas de PITR (OPS-02) |
| Restauration testée | **bloqué** : « Restore to a new project » = projet facturé (≈ 0,0134 $ / h), bouton du tableau de bord ; procédure prête (RUNBOOK §4.1), dont la coupure des 64 crons dans la copie (16 appellent la prod) ; attend l'accord de Paul |
| Migrations sur base vierge | rejeu **bloqué** (Docker arrêté ; projet vide = dépense à faire approuver) ; relevé statique **réussi** : 4 tables, 12 triggers, 6 policies (5 du Storage), 11 crons de la prod sans création dans le dépôt ([ops03-history-holes.md](ops03-history-holes.md)) |
| Prod = dépôt (fonctions) | échoué, **mesuré** : 1 609 / 1 659 identiques, 50 divergentes (35 réécrites en place, 13 absentes du dépôt, 2 plus anciennes) ; migration de référence générée depuis `pg_get_functiondef`, 49 / 50 blocs validés au banc ([ops04-functions.md](ops04-functions.md), `supabase/reference/20261018_prod_functions_reference.sql`) |
| Prod = dépôt (autres objets) | échoué : trigger `trg_guard_promoter_conversion_settlement` absent de la prod (SEC-06) ; S11 hors main (OPS-05) |
| CI | échoué → **corrigé** (OPS-01, active une fois fusionnée) |
| Performance | réussi selon S4 (17-18/10) ; non remesuré |
