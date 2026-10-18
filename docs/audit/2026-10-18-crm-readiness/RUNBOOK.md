# Yuno CRM — arrivée du premier client et incidents (18/10/2026)

Court, à suivre dans l'ordre. Chaque requête SQL se joue sur la prod avec
`scripts/crm-bench/prod.mjs` (lecture seule) sauf mention « écriture » : celles-là
se font seulement par Paul ou sur son « go », après
`node scripts/crm-bench/prod.mjs --activity` (rien de lourd ne tourne).

## 1. Checklist d'arrivée du client

### Avant le rendez-vous
1. Corrections de l'audit en ligne (REPORT, section 9), `crm/s11-practical-email`
   fusionnée d'abord.
2. Espace du client : produit CRM (essai ou « Offrir Yuno CRM » dans
   `/admin/organizers`), l'offre se lit dans Admin CRM › Clients.
3. Prévenir le client de ce que la Console ne montrera pas : visites de la page
   Shotgun, paniers abandonnés, remboursements partiels, acheteur distinct du
   détenteur (rien de cela n'est dans l'API Shotgun) ; SMS pas encore ouvert ;
   « venu » seulement si la porte a été scannée avec Shotgun.
4. DATA-02 tranché, ou dit au client : les entrées gratuites non scannées comptent
   aujourd'hui comme des soirées faites.

### Pendant le rendez-vous (le titulaire du compte, sur son écran)
5. **Conditions + DPA** acceptés par le titulaire (fenêtre à l'ouverture de la
   Console). Vérifier : `SELECT doc_type, doc_version, accepted_at FROM legal_acceptances WHERE user_id = '<titulaire>' AND doc_type IN ('terms_crm','dpa');`
6. **Connexion Shotgun** : Smartboard › Paramètres › Intégrations › Shotgun APIs
   → ID organisateur + jeton. Console › Connecteurs › Connecter. Choisir
   « inclure les soirées co-organisées » **avant** de connecter (changer plus tard
   ne rattrape pas le passé, DATA-05).
7. **Suivre l'import** : bandeau « Import de votre historique Shotgun » en haut
   de chaque page tant qu'il n'est pas fini (≈ 10 min pour 50 000 billets).
   ```sql
   SELECT status, initial_import_done_at, last_ok_at, fail_count, left(coalesce(last_error,''),80) err
     FROM ticketing_connections WHERE organizer_user_id = '<titulaire>';
   SELECT trigger, status, count(*), max(tickets_upserted), max(finished_at)
     FROM ticketing_sync_runs WHERE connection_id = '<connexion>' GROUP BY 1,2;
   ```
8. **Rapprochement affiché ↔ Shotgun** (ce que l'audit n'a pas pu rejouer) : sur
   2 ou 3 soirées passées, comparer avec le Smartboard le nombre de billets
   payants, d'entrées gratuites et le chiffre d'affaires de la page Soirées ; sur
   une soirée, la liste Clients filtrée sur elle. Noter tout écart dans le
   journal de l'audit avant d'aller plus loin.
9. **Base joignable** : Accueil / Clients montrent combien de personnes ont donné
   leur accord newsletter chez Shotgun. Sur le compte testé le 17/10 : 299 sur
   18 058. C'est normal : Shotgun ne pose pas toujours la question.
10. **Réglages › Envoi** : nom d'expéditeur, raison sociale, adresse postale (sans
    eux, rien ne part : `crm_sender_identity`). Ne jamais les saisir à la place
    du client.

### Premier envoi
11. « Recevoir un test » : vérifier l'expéditeur, le pied de page (raison sociale,
    lien de désinscription), les blocs de soirée.
12. Premier envoi réel sur un petit segment. Dans Gmail, le bouton
    « Se désabonner » à côté de l'expéditeur doit désabonner (MAIL-01) :
    ```sql
    SELECT opted_in, opted_out_at FROM newsletter_subscriptions
     WHERE organizer_user_id = '<titulaire>' AND lower(email) = '<adresse de test>';
    ```
13. Rapport de campagne à H+1 : rebonds < 5 %, plaintes < 0,2 % (au-delà, le
    disjoncteur met la campagne en pause, c'est voulu).

## 2. Incident de synchronisation

Symptômes : barre du haut « Synchro Shotgun interrompue », chiffres figés,
notification « Connexion Shotgun coupée » ou alerte super admin
`admin_ticketing_sync_failing` / `admin_ticketing_token_invalid`.

1. Lire l'état (requêtes de l'étape 7).
2. Selon `status` :
   - `token_invalid` : le client génère un nouveau jeton dans le Smartboard et le
     colle dans Connecteurs › Remplacer le jeton (même organisation). Rien d'autre.
   - `error` (5 pannes de suite) : Shotgun ou le réseau est en panne. La connexion
     est retentée seule toutes les 2 h au plus (après la correction SYNC-04) ;
     « Synchroniser » relance tout de suite. Si `last_error` dit
     `unexpected_response`, Shotgun a changé le format de sa réponse : lire
     `schema_sample` (clés seulement) et ouvrir un correctif du connecteur.
   - `active` mais rien ne bouge : regarder `locked_until` (une passe tient la
     connexion au plus 150 s) et la dernière ligne de `ticketing_sync_runs`.
3. Relire tout l'historique (sans risque de doublon : l'écriture est idempotente)
   — **écriture** :
   ```sql
   UPDATE ticketing_connections SET tickets_cursor = NULL, next_sync_at = now()
    WHERE id = '<connexion>';
   ```
   Le cron reprend dans les 5 min ; un compte de 50 000 billets prend ≈ 10 min.
4. Ne jamais : supprimer la connexion (efface billets, soirées miroirs, analyses
   et accords versés par Shotgun) ; brancher la connexion sur une autre
   organisation Shotgun (refusé depuis SYNC-01) ; toucher à la connexion
   d'Amoris (consigne de Paul du 17/10).

## 3. Arrêter des envois

Du plus ciblé au plus large.

1. **Une campagne programmée** : la remettre en brouillon avant son heure (action
   « annuler la programmation » de la page d'envoi, `unscheduleCampaign`) ; le cron
   ne l'enverra plus (MAIL-04).
2. **Une campagne déjà en cours** : la Console CRM n'a pas de bouton de pause
   vérifié par cet audit. Geler le compte (point 3), ou — **écriture**, Paul —
   `SELECT set_email_campaign_send_state('<campagne>', 'pause');` en tant que le
   titulaire, ou directement
   `UPDATE email_campaigns SET status = 'paused', paused_reason = 'incident' WHERE id = '<campagne>' AND status = 'sending';`
3. **Un compte** : Admin CRM › Clients › le compte › « Geler l'envoi »
   (`crm_admin_freeze('<org:…>', true, '<motif>')`, audité, motif obligatoire).
   Campagnes manuelles refusées, recettes automatiques mises en pause. Tient aussi
   contre une écriture du client depuis la correction MAIL-05.
4. **Toute la plateforme** (incident de délivrabilité, fuite) — **écriture**,
   Paul seulement :
   ```sql
   -- arrêter les départs programmés, automatisations, scénarios et relances
   SELECT cron.alter_job(jobid, active := false) FROM cron.job
    WHERE jobname IN ('process-scheduled-campaigns', 'crm-scenario-tick', 'crm-signup-relance', 'crm-first-return-sms');
   -- arrêter les campagnes en cours (send-campaign relance ses tranches seul)
   UPDATE email_campaigns SET status = 'paused', paused_reason = 'incident' WHERE status = 'sending';
   ```
   Reprise : `active := true`, puis remettre chaque campagne en `sending` (ou la relancer depuis la Console Billetterie, qui a « Reprendre »).
5. Une adresse précise : la mettre en suppression globale (elle ne recevra plus
   aucun marketing, la file en cours comprise depuis MAIL-02).

## 4. Restaurer

État au 18/10 : sauvegarde physique quotidienne (≈ 01:30 UTC), 9 jours gardés,
**pas de restauration à la minute (PITR)**, **aucune restauration jamais testée**.

1. Ne jamais restaurer par-dessus la prod sans décision de Paul : la restauration
   Supabase remplace TOUTE la base (billetterie, paiements, comptes).
2. Préférer : restaurer la sauvegarde voulue dans un **nouveau projet**, puis
   recopier seulement les tables touchées (ex. `newsletter_subscriptions`,
   `marketing_consent_events`, `email_suppressions` d'un espace).
3. Ce qui se reconstruit sans sauvegarde : billets et soirées Shotgun (relire
   l'historique, section 2.3), analyses (cron de nuit), caches de contacts
   (15 min). Ce qui ne se reconstruit pas : preuves de consentement,
   désinscriptions, événements d'e-mail, Yunits.
4. À faire une fois avant le 2ᵉ client : une restauration d'essai dans un projet
   isolé, chronométrée, notée ici.

## 5. Après une mise en ligne des corrections de l'audit

```sql
-- SEC-01 : plus personne hors service_role
SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') anon, has_function_privilege('authenticated', oid, 'EXECUTE') auth
  FROM pg_proc WHERE proname IN ('_admin_customer_activity','_admin_customer_identity','_admin_customer_rfm');
-- MAIL-02 : la réclamation relit l'accord
SELECT prosrc ~ 'opted_out_after_queue' FROM pg_proc WHERE proname = 'claim_campaign_recipients';
-- SYNC-04 et SYNC-01b
SELECT prosrc ~ 'status IN' FROM pg_proc WHERE proname = 'claim_ticketing_connections';
SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_ticketing_connections_withdraw_consents';
```
Puis : une passe de synchro réussie dans `ticketing_sync_runs`, un e-mail de test
reçu, et la Console ouverte sans erreur sur Accueil, Connecteurs, Clients.
Retour arrière : `ROLLBACK.sql` (rejoué au banc le 18/10).
