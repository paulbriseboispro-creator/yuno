# Yuno Tickets ⇄ Yuno CRM : deux produits séparés (état du 21/10/2026)

Branche `claude/crm-tickets-isolation-63f85a`. **Rien n'est poussé, aucune migration appliquée sur la prod, aucune fonction
déployée, aucune donnée touchée** (seules des lectures de catalogue ont été faites).

## Décision

Paul, 20/10 : « sépare vraiment les deux outils, pas de rapport de l'un à l'autre, sauf si une personne a les deux : un
bouton pour passer d'une solution à l'autre. » Aucune donnée, aucun écran, aucun chiffre, aucun ciblage d'un outil ne
dépend de l'autre. Restent communs : le login, le bouton de bascule (`goToProduct`), l'infrastructure d'envoi (Resend,
quotas globaux), et deux protections légales (liste de suppression / STOP, désinscription).

## Le modèle

`product` : NULL = Yuno Tickets, `'crm'` = Yuno CRM. Posé sur `newsletter_subscriptions`, `email_opt_outs`,
`contact_list_imports`, `email_list_imports`, `sms_list_imports`, `imported_contacts`, `venue_sms_contacts`,
`email_campaign_templates`, `contact_engagement` ; déjà présent sur `email_campaigns`, `email_automations`, et ajouté
sur `sms_campaigns`. Une adresse a UNE ligne par produit chez un même pro. Index uniques `NULLS NOT DISTINCT` par produit.
`_separation_default_product()` : compte CRM pur ⇒ `'crm'`, compte sans CRM ⇒ NULL, deux produits ⇒ choix de l'écrivain.

## Surfaces

| Surface | Avant | Après |
|---|---|---|
| Soirées (front, edge, SQL, admin) | la Billetterie listait / comptait les 311 miroirs Shotgun | filtre `external_source IS NULL` partout (1re passe) ; le CRM ne choisit / ne valide que des miroirs |
| Base de contacts (Clients, Audience, segments, audiences e-mail / SMS / push) | un seul registre : Amoris = 17 410 acheteurs Shotgun sur 17 413 contacts « Billetterie » | deux vues (`contact_scope_customers(…, p_product)`), cache sous deux clés |
| Registre de consentement e-mail | accords `connector:shotgun` ciblables par la Billetterie | une ligne par (adresse, portée, produit), 12 écrivains et ~40 lecteurs patchés |
| Imports de fichiers | une liste vue des deux outils | listes, contacts importés et contacts SMS par produit ; même fichier dans les deux outils = deux listes |
| Campagnes e-mail | le CRM affichait envois, clics, ventes attribuées de la Billetterie (32 lecteurs) | chaque lecteur filtre `crm_campaign_is_crm` ; Billetterie masque `product = 'crm'` |
| SMS | `sms_campaigns` sans produit | produit dérivé, listes / rapports / identité par produit |
| Recettes, modèles, scénarios | un slot par (portée, recette) ; un scénario éteignait la recette Billetterie du même nom | un slot par (portée, recette, produit) ; modèles par produit |
| Engagement, pression, « reçu récemment » | mélange des deux outils | par produit (la pression anti-spam 24 h / 7 j reste commune : elle protège l'adresse) |
| Réglages | gel d'envoi, Yunits, identité SMS écrivaient la fiche légale de la Billetterie | gel limité aux campagnes CRM ; identité SMS du CRM dans `crm_sms_settings` |
| Notifications, cloche, Admin | connecteur et envois CRM dans la cloche de la Billetterie | retirés ; l'Admin CRM garde les envois de la Billetterie, étiquetés |

## Migrations (ordre d'application)

1. `20261107100000_crm_billetterie_isolation_surfaces.sql`, `…110000_…_admin_counters.sql` (soirées miroir, 1re passe)
2. `20261107115000_crm_billetterie_separation_columns.sql` : colonnes, CHECK, triggers, index NEUFS (rien n'est retiré)
3. `20261107120000_…_isolation_contacts.sql` : base de contacts à deux vues
4. `20261107130000_…_isolation_sms.sql` : `sms_campaigns.product`, SMS par produit
5. `20261107140000_crm_billetterie_separation_cutover.sql` : la bascule en UNE transaction — retrait des anciens index,
   remplacement des fonctions (127 gardes md5), copie des fichiers importés d'un compte à deux produits, contrôles bloquants

Après : `NOTIFY pgrst` (déjà dans la bascule), régénérer `src/integrations/supabase/types.ts`, puis les edge functions
`send-campaign send-sms-campaign affiliate-ticket-sync owner-assistant process-scheduled-campaigns send-missed-you
send-next-event-recommendation create-ticket-checkout create-table-checkout create-guest-list-entry
verify-ticket-payment verify-table-payment`, puis le front (Cloudflare). Les ON CONFLICT des écrivains sont patchés dans
la même transaction que le retrait des anciens index : aucune fenêtre où un achat échouerait.

## Données des comptes réels

- Compte CRM pur (Nuits Démo, 3 AM) : tout passe en `'crm'` sur place.
- Compte à deux produits (WOH, Amoris) : accords `connector:%` et `signup_page%` changent de produit sur place ; les
  fichiers importés (WOH : 14 477 accords, ~14 479 contacts) sont COPIÉS dans le CRM ; les accords nés d'une surface Yuno
  (Amoris : 6 `ticket_purchase`, 2 `waitlist`) restent côté Billetterie, jamais copiés. **Le CRM de WOH perd ses ~3 706
  contacts « nés de ventes Yuno »** (décision du brief : plus aucune donnée Yuno Tickets dans le CRM).

## Preuves

`node scripts/crm-bench/audit-separation.mjs` : 6 migrations rejouées sur les définitions de la prod (PGlite), trois
comptes synthétiques ; vue CRM d'un compte CRM pur et vue Billetterie d'un compte Billetterie pur identiques à avant ;
compte à deux produits sans aucune fuite dans les deux sens ; triggers de produit, désinscription transverse, produit des
SMS. `npx vitest run` : 157 fichiers, 1 938 tests ; ESLint ; `deno check` des fonctions edge modifiées ; md5 des 186
fonctions gardées relus sur la prod (0 écart).

## Décisions et risques (à trancher par Paul)

1. Adresses d'un fichier CRM déjà abonnées côté Billetterie : elles entrent au CRM SANS accord tant que le pro ne
   ré-atteste pas le fichier.
2. Un « stop » posé dans un outil bloque les écrivains AUTOMATIQUES de l'autre (connecteur, lead Meta, page d'inscription) ;
   un accord explicite (case cochée) recrée la ligne de l'outil où il est donné.
3. Plafond de Yunits, témoin de 10 % et pause du forfait valent pour toute recette CRM, d'un compte à deux produits
   aussi : si le forfait CRM de WOH est en pause (essai fini le 28/10), rien ne part côté CRM.
4. Nom, ville et logo du compte restent partagés (`save_crm_identity`) ; les anciennes pages CRM de la Console
   `/owner` et `/organizer-app` (compte CRM pur) ; MCP d'un compte à deux produits (un seul produit par espace).
5. Cutover : à jouer hors vente (House Of Masquerade, 28/10) ; sauvegarde `pg_dump` des 10 tables avant ; première lecture
   après bascule = reconstruction du cache de contacts (WOH ~14 k, Amoris ~17 k lignes).
6. Non exécutés au banc : les écrans du CRM (`crm_search`, vue d'ensemble, scénarios…) compilent mais n'ont pas tourné sur
   des données ; relire les écrans du compte démo CRM et de WOH / Amoris (accès consenti) juste après la bascule. Les
   anciens bancs (`isolation.mjs`, `audit-*.mjs`) reposent sur `schema/base.sql` (anciens index) : à régénérer avant usage.
