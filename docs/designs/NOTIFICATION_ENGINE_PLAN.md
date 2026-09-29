# Moteur de notifications Yuno — Yuno envoie, les pros lisent (2026-09-29)

> Décision fondateur : les notifications push automatiques ne sont plus des
> interrupteurs que chaque club ou organisateur active (ou oublie d'activer).
> **Yuno décide, pour toutes les soirées, qui reçoit quoi et quand**, selon des
> règles réglées depuis le super admin. Les pros voient ce qui est parti pour
> leurs soirées et ce que ça a rapporté, et gardent quelques **crédits** pour
> écrire eux-mêmes à leurs clients.

## 1. Ce qui existait (état au 29/09)

| Famille | Émetteur | Défaut constaté |
|---|---|---|
| Transactionnel (achat, remboursement, commande prête, guest list) | `sendAutoPush` unitaire | OK — reste tel quel |
| Rappels J-J 4 h / 30 min | cron `event-reminder` | pas relié à une soirée côté stats, invisible pour le pro |
| « Nouvelle soirée » aux abonnés | `dispatchNewEventPushes` | une seule raison (abonné), tout part d'un coup, ce que la politique retenait était perdu |
| Automatisations club (rappel du jour, c'est maintenant, merci, bientôt complet, boissons, upsell VIP, reconquête, anniversaire) | `venue_push_automations` (opt-in club) | éteintes par défaut, **inexistantes pour un organisateur**, jamais pour une co-soirée, doublonnaient les rappels plateforme (un acheteur pouvait recevoir 4 push le même jour) |
| Line-up DJ | `send-push-notification` action `dj_lineup` | **aucune politique** (heures calmes, plafonds) : un DJ ajouté à 2 h du matin = push à 2 h du matin, en plus de l'annonce |
| Agence « nouvelle soirée » | opt-in agence | doublon possible avec l'annonce du club |
| Panier abandonné | cron | pas de dédup par soirée, pas de contrôle « a acheté depuis » |
| Push manuels pros | `send-push-campaign` | 4 campagnes / 24 h, sans limite mensuelle |

## 2. Ce que font les concurrents (recherche du 29/09)

**Shotgun** (extraits des centres d'aide officiels) :
- l'annonce de publication est **envoyée par la plateforme**, pas écrite par le pro ;
  le pro peut la **redéclencher / la caler plus tard** (sur son post Instagram) ;
- cibles : abonnés de l'organisateur + **fans des artistes du line-up dans la
  zone** ; trois moments : publication, ouverture de billetterie, ajout d'artiste ;
- plafond **1 notification / 12 h par organisateur** (la 2ᵉ soirée publiée dans
  les 12 h n'est pas annoncée du tout) ;
- statistiques par notification : destinataires, « vu », répartition **fans
  d'artiste / abonnés de la page** ; **pas de CA par notification** ;
- pas de push libre du pro ; SMS limité à 3 campagnes / 30 jours ;
- email « pratique » (tous les participants, jamais promotionnel) ≠ email
  « promotionnel » (opt-in).

**DICE** : l'outil pro est strictement opérationnel (pas de promo), ~40 % des
ventes viennent de la découverte et du push plateforme. **Eventbrite** : les
abonnés ne sont prévenus que des 2 premières soirées publiées le même jour.

**Ce que Yuno fait mieux** : rien n'est perdu (une annonce retenue par les
plafonds est **reportée**, pas jetée), la raison de chaque envoi est gardée et
restituée au pro, et le pro voit **acheteurs et CA** par notification.

## 3. Le modèle

```
 règles (super admin)          file de candidats                 arbitre (toutes les 5 min)
 ───────────────────  ──────▶  push_candidates      ──────▶  1 notification max / personne / passage
 new_event, last_tickets…      (personne, soirée, règle,          politique (heures calmes, plafonds,
 collecteurs SQL idempotents    raison, partie, score,            budget par soirée, fatigue)
                                fenêtre not_before→expires_at)    → envoi (push_campaigns source auto)
                                                                  → sinon REPORT jusqu'à expiration
```

### 3.1 Les règles (clé = `platform_notification_settings.notification_key`, catégorie `event_engine`)

| Règle | Famille | Quand | Qui | Raisons |
|---|---|---|---|---|
| `new_event` Publication | marketing | publication (ou heure choisie par le pro) → 5 j max, jamais < 2 h du début | abonnés de **toutes** les parties, anciens clients 12 mois, fans des DJ du line-up (zone), abonnés des agences sous contrat | `host_follower`, `past_customer`, `dj_follower`, `agency_follower` |
| `sales_open` Ouverture billetterie | marketing | ouverture différée des ventes | intéressés (ont touché l'annonce, soirée en favori) — la liste d'attente garde son push | `interested` |
| `last_tickets` Dernières places / le tarif monte | marketing | palier ≥ seuil (80 %) ou palier ouvert presque vide avant un plus cher, ≤ 14 j | intéressés non acheteurs, puis abonnés non acheteurs | `interested`, `host_follower` |
| `last_call` C'est ce soir | marketing | jour J 12 h → début − 1 h, s'il reste de quoi vendre | intéressés non acheteurs | `interested` |
| `checkout_abandoned` Panier abandonné | urgent | 45 min → 6 h après un checkout billet / table non payé | la personne | `abandoned` |
| `vip_upsell` Passe en VIP | soirée | J-3 → J-1, 14 h-21 h, s'il reste des tables | acheteurs de billet sans table | `ticket_holder` |
| `event_day_reminder` Rappel du jour | rappel | jour J, 5 h → 2 h avant (variante « commande au bar » si carte ouverte) | billets, tables, guest list | `ticket_holder`, `guest` |
| `doors_open` Ouverture des portes | rappel | 45 → 10 min avant | idem | idem |
| `after_thanks` Merci + prochaine date | marketing (bas) | lendemain 12 h → +36 h | personnes **entrées** (scan) | `attendee` |

Découverte (`taste_discovery`), relance d'inactivité et transactionnel restent
dans leurs fonctions : ils passent déjà par `client_push_policy()`.

### 3.2 Arbitrage — maximiser la vente sans spammer

Réglable dans `/admin/notifications` (table `push_engine_settings`) :

- **Une notification marketing par personne et par 24 h, 3 par 7 jours**, tous
  expéditeurs confondus (Yuno + campagnes des pros), **4 pour une personne
  engagée** (a touché une notification < 30 j ou acheté < 60 j), **1 pour une
  personne fatiguée** (≥ 6 notifications marketing en 45 j sans un seul tap).
- **Heures calmes 22 h → 10 h** (Paris) : on reporte, on ne perd pas.
- **Deux messages marketing maximum par personne et par soirée** (annonce +
  une relance).
- **Priorité par valeur attendue** quand plusieurs soirées veulent la même
  personne le même jour : panier abandonné > dernier appel > dernières places
  > annonce ; puis raison (intéressé > ancien client > abonné > fan DJ >
  abonné agence) ; puis urgence (soirée la plus proche). Les autres sont
  **reportées** et repassent au passage suivant, jusqu'à leur expiration.
- Les rappels d'une soirée **achetée** ne consomment aucun plafond, mais une
  personne ne reçoit jamais deux rappels de la même soirée.
- **Annulée, complète, déjà achetée, désabonnée ⇒ retirée de la file** avec sa
  raison (restituée aux pros : « protégées par les règles Yuno »).

### 3.3 Soirées à plusieurs (collab, co-organisation)

- L'audience d'une soirée est **l'union des audiences de toutes ses parties**
  (`event_parties` : club, organisateur, partenaire, co-hôtes), **une personne
  = une notification** ; son nom d'envoi est « A × B ».
- Chaque destinataire garde la **partie par laquelle il a été touché**
  (`reason_party`). Chaque partie voit la soirée entière ET « via ton audience »
  (ses abonnés touchés, leurs taps, leurs achats) — l'équivalent notification de
  « Qui fait vendre ? ». Aucune liste de personnes n'est montrée : des compteurs.
- Le CA n'apparaît qu'à qui voit l'argent (mêmes portes que `get_push_campaigns`).
- L'heure d'annonce ne se règle que par une partie principale de niveau ≥ 2.

### 3.4 Ce que voit le pro — `/owner/push`, `/organizer-app/push`

Deux onglets (`?tab=auto|campaigns`) :

1. **Automatiques** — « Ce que Yuno envoie pour toi » : chiffres 30 j
   (notifications, personnes touchées, taux d'ouverture, acheteurs, CA,
   protégées), **par soirée** (frise publication → dernières places → jour J →
   merci, avec l'état de chaque étape : envoyée, programmée, en attente), la
   liste des règles en français (quand, à qui), la part « via ton audience » en
   co-soirée, la mise en avant dans la découverte Yuno, et le bouton
   **« Programmer l'annonce »** d'une soirée à venir.
2. **Campagnes** — le compositeur existant + le solde de crédits.

### 3.5 Crédits de campagnes manuelles

- **1 crédit = 1 campagne marketing** (abonnés, clients, segment), quelle que
  soit sa taille : le coût réel d'un push n'est pas l'envoi, c'est l'attention
  qu'il consomme — la politique par personne s'applique de toute façon.
- **Offerts chaque mois** (1er du mois, heure de Paris) : club 4, organisateur
  4, agence 2 — réglable globalement et par compte depuis le super admin,
  plus des **crédits bonus** attribués à la main (ils ne périment pas).
- **Info soirée gratuite** : un message pratique aux détenteurs d'une soirée
  (portes, horaires, changement) ne coûte rien, 2 par soirée et par partie.
- Plafond anti-rafale : 1 campagne marketing / 24 h par compte.
- Crédit débité à l'envoi ou à la programmation, **rendu** si la campagne
  programmée est annulée ou part à zéro destinataire.
- « Demander plus de crédits » crée une alerte super admin
  (`admin_push_credit_request`) — pas d'achat : Yuno garde la main sur la
  pression push.

### 3.6 Super admin — `/admin/notifications`

Moteur (réglages globaux, santé de la file), règles de soirée (interrupteur,
paramètres, textes FR/EN/ES par raison, chiffres 30 j : envoyées, ouverture,
acheteurs, CA, retenues), notifications système (interrupteurs historiques),
crédits des pros (allocation, bonus, demandes).

## 4. Migration et déploiement

Migration `20260930100000_push_engine.sql`, puis déployer ENSEMBLE :
`process-scheduled-campaigns`, `send-push-campaign`, `send-push-notification`,
`event-reminder`, `cart-abandonment-check`.

Sécurité de l'ordre : la migration **éteint** les anciennes clés
(`event_reminder_4h`, `event_reminder_30m`, `cart_abandonment`, les huit
automatisations club, `agency_new_event`) et toutes les lignes
`venue_push_automations` / `agency_push_automations`. Quel que soit l'ordre de
déploiement, rien ne part deux fois ; au pire un rappel manque pendant la
fenêtre entre la migration et le déploiement.

## 5. Plan de réalisation (à lancer après validation)

| # | Lot | Contenu |
|---|---|---|
| 1 | SQL | réglages, règles, textes, file `push_candidates`, collecteurs, arbitre `push_engine_claim`, `push_engine_record`, crédits, `get_push_center`, RPC super admin, politique partagée (`client_push_policy`, `filter_manual_push_recipients` lisent les réglages) |
| 2 | Edge | `_shared/push-engine.ts` (collecte → arbitrage → rédaction FR/EN/ES par raison → envoi → suivi) appelé par `process-scheduled-campaigns` à la place des anciens dispatchers ; `send-push-notification` (line-up → file) ; `event-reminder` (clients retirés, staff gardé) ; `cart-abandonment-check` (boissons seules) ; `send-push-campaign` (crédits, info soirée gratuite, 1 marketing / 24 h) |
| 3 | Console | `/owner/push` et `/organizer-app/push` en deux onglets (Automatiques / Campagnes), frise par soirée, « Programmer l'annonce », solde de crédits, demande de crédits ; sous-entrées de barre latérale ; page agence : crédits, toggle retiré |
| 4 | Super admin | `/admin/notifications` refait avec `admin/ui.tsx` : moteur, règles + textes, système, crédits |
| 5 | Autour | i18n ×3, mode d'emploi (`ohelp.*`), `owner-assistant`, alerte `admin_push_credit_request`, CLAUDE.md, tests des helpers front, lint / build / test, commit + push |

## 6. Décisions prises (30/09, déléguées par le fondateur)

1. **Crédit = 1 campagne marketing, pas 1 notification.** Un push ne coûte rien
   à envoyer ; ce qui est rare, c'est l'attention du client, et elle est déjà
   protégée personne par personne. Le pro compte en campagnes, comme il pense.
   4 / mois pour un club, 4 pour un organisateur (association comprise), 2 pour
   une agence ; réglable globalement et par compte ; bonus attribués à la main,
   sans expiration ; le mois non consommé ne se reporte pas. **Pas d'achat** :
   vendre de la pression push dégraderait le canal qui fait vendre tout le monde.
2. **Info soirée gratuite, 2 par soirée et par partie**, aux seuls détenteurs
   d'une place de CETTE soirée (le « pratique » de Shotgun) ; hors plafonds,
   mais l'opt-out marketing reste respecté.
3. **Anciens clients inclus dans l'annonce** (12 mois, billet / table / guest
   list chez une partie de la soirée), même sans abonnement : c'est l'audience
   qui rachète le plus. Ils obéissent à la préférence « marketing » (pas à
   « clubs suivis »), et la raison est gardée : le pro voit ce qu'ils rapportent.
4. **Anniversaire et reconquête supprimés** comme automatisations séparées.
   La reconquête devient la raison « ancien client » de l'annonce suivante —
   un message avec une vraie soirée à la clé ; l'anniversaire sans offre était
   du bruit.
5. **Plafonds par défaut** : 1 marketing / 24 h, 3 / 7 j (4 pour un engagé,
   1 pour un fatigué), 2 par soirée, panier abandonné 2 / 24 h, heures calmes
   22 h → 10 h Paris. Tous réglables depuis le super admin, et lus aussi par les
   campagnes manuelles et les crons plateforme (une seule politique).
6. **Deux rappels le jour J** pour un détenteur de place (le rappel du jour,
   puis l'ouverture des portes, sautée pour qui est déjà entré), plus l'upsell
   VIP à J-3/J-1 : ce sont des messages sur une soirée ACHETÉE, hors plafonds.
7. **Seules les parties principales** (club, organisateur, partenaire du
   collab) de niveau gestion programment l'annonce ; un co-hôte voit tout, ses
   chiffres « via ton audience » compris, mais ne décide pas pour la soirée.

## 7. Plus tard

- Accusés de réception iOS (Notification Service Extension, déjà prêt côté serveur).
- Boîte de notifications in-app (Shotgun touche ainsi ceux qui refusent le push).
- Billet « abonnés » (tarif débloqué en suivant la page) comme moteur de croissance.
- Emplacements sponsorisés dans le fil, jamais de push vendu.
