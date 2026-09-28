# Collab & co-organisation — revue complète et plan « jour J »

Date : 2026-09-29. Périmètre : collab contractuel club × organisateur (partage Stripe,
barème + décompte de fin de soirée) et co-organisation à N parties (co-hôtes, accord,
décompte, virements suivis). Trois revues adverses indépendantes ont été menées
(chemin de l'argent, cycle de vie et écrans, code co-organisation). Ce document dit ce
qui est corrigé, ce qui reste à faire avant une vraie soirée, et comment vérifier le
jour J.

## 1. Ce qui a été corrigé et vérifié (29/09)

| # | Problème | Correctif | Preuve |
|---|---|---|---|
| 1 | Un co-hôte recevait toute la base acheteurs (export, segments), même en lecture et sans case cochée | Les soirées co-hébergées sortent des RPC CRM/argent ; lignes de vente lisibles des seuls éditeurs | smoke coorg 16, 60 |
| 2 | Consentement co-hôte falsifiable (anon, libellé inventé) et jamais versé sur un billet Stripe en production | Preuve d'achat obligatoire ; intention consommée au paiement | smoke coorg 44a-45d |
| 3 | Un co-hôte éditeur pouvait couper toutes les ventes (`event_mode`) ou faire rejeter la soirée | Garde co-hôte étendu | smoke coorg 61-62 |
| 4 | Une partie pouvait annuler un accord signé après la soirée pour ne pas payer | Accord figé dès le début de la soirée | smoke coorg 31d-31e |
| 5 | Le dernier validant figeait des chiffres que les autres n'avaient pas vus | Empreinte des chiffres ; validations périmées retombent | smoke coorg 31c, 34b-34c |
| 6 | Décompte gonflé par les tables payées sur place / saisies à la main | Tables en ligne seulement, sur l'acompte | revue SQL |
| 7 | Frais de gestion tables déduits deux fois du CA du barème (total_price ne les contient pas) | Déduits seulement s'ils sont absorbés par le club | revue SQL + code checkout |
| 8 | Club partenaire d'une soirée menée par l'orga : aucun droit d'écriture, ses domaines gelés pour tous | Policy + garde | smoke collab-guards 1-7 |
| 9 | Orga partenaire d'une soirée menée par le club : « Infos & affiche » impossible à enregistrer | Le formulaire n'envoie que ses domaines | front réel (toast « mis à jour ») |
| 10 | Contrat refusé puis reproposé : plus jamais signable | Lecture du contrat vivant | code |
| 11 | Invitation de club : rattachement possible à la soirée de n'importe qui | Soirée du club invitant exigée | code SQL |
| 12 | Suppression « d'un commun accord » d'une soirée qui a vendu (sans remboursement), ou bloquée à vie | Refus après la 1re vente, échec clos | smoke collab-guards 8 |
| 13 | Le club pouvait effacer la dette SEPA d'un décompte accepté | Super admin seul | smoke collab-guards 10 |
| 14 | Accepter un décompte que le club venait de redéclarer | Révision lue exigée | code SQL + front |
| 15 | Avenant de partage après la 1re vente : échec opaque | Refus clair | code |
| 16 | `accept-club-collab-invitation` pouvait retirer une soirée sous contrat à un autre club | Soirée libre seulement (déployée) | OPTIONS 200 |
| 17 | Commandes billets / VIP : la page ne chargeait rien (jointure ambiguë, PGRST201) | Relation nommée | REST 200 |
| 18 | Membre d'équipe orga : « Soirée introuvable » sur la fiche co-soirée | Scope de l'organisation | code |
| 19 | Virements co-organisation sans suivi | Échéance, relances, escalade, litige auto, arbitrage admin | smoke payment-followup (27 étapes) |

## 1 bis. Corrigé et DÉPLOYÉ le 29/09 (soir)

- Contrat : « Répartir via Stripe ? » Oui / Non ; en Non, une partie encaisse, décompte
  figé à J+2 et virement suivi (IBAN, J'ai viré, Bien reçu, relances, litige).
- Point 3 ci-dessous : 1 à 8 corrigés et déployés (`stripe-webhook`, `owner-refund`,
  `create-ticket-checkout`, `create-table-checkout`) ; le 8 est levé autrement :
  `reverse_transfer` n'est plus envoyé sur une charge plateforme.
- CA tables corrigé partout (frais de gestion retirés seulement s'ils sont absorbés).
- Équipe orga : un admin d'équipe agit sur le collab ; un éditeur le voit sans bouton.

## 1 ter. Point 5 — créé et DÉPLOYÉ le 29/09 (nuit)

- **Porte co-hôte** (`20260929190000`) : un co-hôte « Édition » scanne (manifeste,
  scan, sync hors ligne, conversion promoteur). Testé : éditeur 0 → 4 lignes
  scannables, lecteur et inconnu refusés, hôte inchangé.
- **Lien de vente par partie** (`20260929200000`) : « Qui fait vendre » sur la page
  de co-organisation. Testé : lien unique et idempotent, ventes attribuées
  (CA 285 € = 10 + 25 après remboursement de 5 + table 250), code caché aux autres
  parties, inconnu refusé, lien éteint au départ du co-hôte, `/l/<code>` résout la
  soirée (fonctions en ligne).
- **Invitation sans compte** (`20260929210000`) : co-organisation par email
  (`/accept-cohost`) et collab club → organisateur avec le deal (contrat pré-signé
  par le club). Testé en transaction annulée (acceptation, identité orga créée,
  contrat `pending_signatures` signé club, règlement par virement conservé,
  boissons forcées 100 % club, mauvais compte refusé) et en ligne (29/29 :
  création, doublon, garde démo, droits, lecture du lien, annulation, refus).
- **Quota des fonctions edge atteint** : l'email de co-organisation passe par
  `invite-organizer-collab` (`kind: 'coorg'`).

## 2. Historique : les bloquants tels que relevés (corrigés, voir 1 bis)

Aucun de ces correctifs n'a été déployé : ils touchent les fonctions Stripe
(`stripe-webhook`, `create-ticket-checkout`, `owner-refund`), qui ne se testent pas
sans le mode test Stripe. Les versions en ligne sont identiques au repo (vérifié le
29/09), donc chaque correctif part d'une base propre.

1. **Remboursement partiel d'une vente retenue** (`stripe-webhook` `charge.refunded` →
   `handleLeg`, `owner-refund`). Aujourd'hui un remboursement partiel annule TOUTE la
   jambe retenue : sur un collab à barème, rembourser 1 billet sur 4 fait disparaître
   les 3 autres de la base et laisse l'argent sur le solde plateforme. Et un second
   remboursement n'est jamais reversé. Corriger : réduire la jambe au prorata du
   delta, stocker `refunded_cents`, ne passer `refunded` qu'au remboursement total.
2. **Checkout billets d'un collab mené par l'orga** (`create-ticket-checkout` l. 394) :
   `payoutSource` ne regarde que `venue_id`. Si l'orga n'a pas Stripe (cas prévu en
   barème), TOUS les billets sont refusés alors que les tables passent. Corriger :
   résoudre le split d'abord, puis vérifier `charges_enabled` sur les comptes
   réellement utilisés (primaire, secondaire, `on_behalf_of`).
3. **Rejeu du webhook** (`stripe-webhook` l. 706-736, `upsert` sur `payment_intent_id`) :
   un « Resend » après libération remet la jambe en `scheduled` ; au-delà de 24 h la clé
   d'idempotence Stripe est oubliée → second virement possible. Corriger : insert seul
   (`ignoreDuplicates`).
4. **Vente tardive après le décompte accepté** : ligne retenue sans date, jamais libérée ;
   une erreur d'écriture du grand livre renvoie 200 (Stripe ne rejoue pas). Corriger :
   libérer au club + signaler, renvoyer 500 sur erreur, `expires_at` des sessions borné
   à la fin de soirée.
5. **Jambe en échec** (compte Connect restreint) : réessayée à vie sans alerte. Corriger :
   alerte admin après N échecs, affichage sur la carte décompte, bascule SEPA proposée.
6. **Marqueur de rétention** : la décision « retenir » relit les règles au moment du
   paiement ; un avenant entre checkout et paiement l'inverse. Poser `hold=night_closing`
   dans les métadonnées au checkout.
7. **Upsells billets sur un collab mené par l'orga** (`create-ticket-checkout` l. 659,
   `venue_id` NULL) : tout checkout avec upsell échoue. Utiliser le club effectif.
8. **`reverse_transfer: true` sur une vente retenue** (`owner-refund`) : vérifier en mode
   test que Stripe l'accepte quand aucun transfert n'existe encore.

## 3. Décisions (tranchées le 29/09 : les deux premières sont appliquées)

- **Frais de gestion des tables dans le CA affiché** : `fees.ts` `tableRevenue` et ~20
  RPC d'analyse retirent `management_fee` de `total_price`, qui ne le contient pas
  (le client le paie en plus). Le CA tables affiché est sous-estimé d'environ 4 % de
  l'acompte. Corrigé dans l'argent (barème, décompte) le 29/09, PAS dans l'affichage :
  à corriger partout d'un coup (front + RPC + données démo, dont les tables semées
  contiennent les frais). À valider avant, c'est une définition de chiffre.
- **Équipe d'un organisateur dans le collab** : les RPC de contrat, avenants, demandes
  pause/suppression et acceptation du décompte n'acceptent que le fondateur. Soit on
  ouvre aux admins d'équipe (`is_org_team_member(…, 'admin')`), soit on masque ces
  boutons pour l'équipe. Aujourd'hui l'équipe voit la fiche mais ses clics sont refusés.
- **Push de lancement aux abonnés de tous les hôtes** : code prêt dans
  `_shared/push-automations.ts`, non déployé (la version en ligne de
  `process-scheduled-campaigns` diffère du repo sur ~12 fichiers `_shared`).

## 4. Déroulé de vérification

### A. Avant chaque mise en ligne (SQL, 2 min, tout annulé)

```
q.sh -f scripts/demo/smoke-coorganization.sql         # 74 étapes, toutes ok
q.sh -f scripts/demo/smoke-coorg-payment-followup.sql # 27 étapes (lire les valeurs)
q.sh -f scripts/demo/smoke-collab-guards.sql          # 12 étapes (lire les valeurs)
supabase db lint --linked
```
`smoke-night-closing.sql` est périmé (le décompte démo est déjà accepté) : le
rejouer sur une soirée démo neuve avant tout changement du barème.

### B. Parcours réels (comptes démo, `scripts/demo/drive.mjs`)

1. Orga → invite l'asso (édition) et le club (lecture) ; chacun accepte.
2. Accord signé à trois, délai 15 j ; tenter « Modifier les parts » après le début → refusé.
3. Achat billet par un client démo avec la case cochée → le contact apparaît chez
   les hôtes nommés, pas chez un hôte non nommé.
4. Club lecteur : page Commandes vide pour la soirée, rapport visible sans CA.
5. Soirée passée : chacun déclare ses lignes, valide ; ajouter une ligne entre deux
   validations → la validation précédente tombe.
6. Virements : IBAN, « J'ai viré », « Relancer », « Bien reçu » ; laisser un virement
   annoncé 7 jours (en SQL : `confirm_due_at` dans le passé + balayage) → litige, alerte
   `/admin/alerts`, arbitrage « Réglé ».
7. Collab : orga partenaire édite l'affiche d'une soirée du club ; club partenaire change
   la billetterie d'une soirée de l'orga quand il tient les opérations.

### C. Mode test Stripe (obligatoire avant la 1re vraie co-soirée payée)

Sur un projet de test ou avec des clés `sk_test_` : billet + table sur un collab par
pilier, billet + table sur un collab à barème, remboursement partiel puis total,
« Resend » d'un `payment_intent.succeeded`, compte Connect orga restreint au moment de
la libération, décompte accepté puis vente tardive. Chaque cas : lignes
`revenue_distributions`, transferts Stripe, chiffres de la carte décompte.

### D. Le jour J

- **J-2** : `node scripts/demo/audit.mjs` ; vérifier que les contrats sont `active`,
  les comptes Stripe `charges_enabled` des deux côtés, les co-hôtes acceptés AVANT
  l'ouverture de la vente (le consentement n'est jamais rétroactif).
- **Pendant la vente** : Live View des deux côtés ; `/admin/alerts` ; les ventes de
  collab doivent créer une ligne `revenue_distributions` chacune.
- **Nuit** : porte scannée par l'équipe de l'hôte ET par tout co-hôte « Édition » (fondateur, équipe, staff videur — `is_event_door_staff`, depuis le 29/09) ; un co-hôte « Lecture » ne scanne pas.
- **Lendemain** : décompte (barème) déclaré par le club, accepté par l'orga ; décompte
  co-organisation validé par toutes les parties.
- **J+1 → J+30** : cron `coorg-transfer-followup` (09:47 UTC) et
  `release-held-co-event-transfers` ; rien ne doit rester `failed` plus de 24 h.

### E. Surveillance

- `cron.job_run_details` pour `coorg-transfer-followup` (lecture ponctuelle, jamais
  depuis le cockpit).
- Alertes `admin_coorg_transfer_overdue` / `admin_coorg_transfer_disputed`.
- Requête de contrôle : `select status, count(*) from event_coorg_transfers group by 1;`

### F. Retour arrière

- Couper les relances : `select cron.unschedule('coorg-transfer-followup');`
- Couper la co-organisation côté pros : masquer l'onglet `coorg` (hubs Collaborations)
  et le bouton « Co-organiser » ; les données restent, rien n'est encaissé par ce module.
- Le partage Stripe du collab n'a pas été modifié par ces chantiers : aucun retour
  arrière de paiement n'est nécessaire.
