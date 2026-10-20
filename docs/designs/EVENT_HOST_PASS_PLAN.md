# Le club qui accueille une soirée : un accès à UNE soirée, pas une Console

Plan du 20/10/2026. Cas réel : Amoris organise **House Of Masquerade** (28/10,
`f15af222-4ae1-4af3-a377-edefa86704ee`, soirée solo, billetterie libre) chez
**Tia Felisa** (C. Escuderos 5, Segovia), un club qui n'a pas de compte Yuno.
Paul veut que le club voie les ventes et l'état de la soirée, sans lui donner la
gestion, puis qu'il ait envie d'ouvrir un vrai compte.

Nom technique : `host_pass`. Le libellé visible est **à nommer par Paul**
(règle : un nom se discute avant de s'écrire). Toutes les chaînes vivent dans une
seule famille de clés (`hostPass.*`) : renommer = une seule passe.

## 1. Ce qui se passe aujourd'hui (constaté le 20/10 sur la démo)

Seul chemin pour un club sans compte : l'inviter par email **comme
« Organisation »** en rôle **Partenaire** (comme « Club », il ne peut être que
**Lieu**, qui lui passe adresse, bar et porte). En acceptant, il passe par :

1. `/accept-cohost` → « Créer mon compte » → `/auth` (mot de passe) ;
2. création d'un **espace organisateur complet** (`organizer_profiles`, rôle
   `organizer`, `profile_type = organizer`) au nom du club ;
3. la Console Organisateur entière (Événements, Billetterie, Tables, Check-in,
   Commandes, Facturation, Paiements, Clients, Email…), toutes vides ;
4. par-dessus : la fenêtre « Conditions professionnelles » et le « Guide de
   configuration » en 6 étapes (créer une soirée, Stripe…).

Résultat : 4 écrans avant de voir la seule chose demandée (« Où en est la
soirée »), un club rangé comme « organisation », des métriques Yuno faussées (un
« organisateur » de plus qui n'en est pas un) et une Console vide qui donne
l'image d'un produit compliqué. C'est l'inverse d'une première impression.

## 2. Ce que fait le marché

- **Ticket Fairy** sépare exactement les deux cas : l'équipe du lieu garde un
  accès permanent, chaque promoteur qui loue la salle ne voit que **la nuit
  qu'il a réservée** ; et un organisateur peut **partager un rapport de ventes en
  direct** à un partenaire, limité aux tarifs qui le concernent, sans rien lui
  donner d'autre ([venues](https://www.ticketfairy.com/solutions/venues),
  [run a venue](https://www.ticketfairy.com/guides/run-a-venue),
  [share a live sales report](https://www.ticketfairy.com/guides/share-a-live-sales-report)).
- **Croissance par le produit** (Figma et consorts) : chaque invité est un
  futur client, et le moment où le produit touche un non-client est un moment de
  conversion à soigner, pas un formulaire d'inscription à franchir
  ([work-bench](https://www.work-bench.com/post/decoding-product-led-growth-top-tactics-to-master-the-users-product-journey-from-gitlab-figma-airtable),
  [thrivestack](https://www.thrivestack.ai/blogs/saas-no-collaboration-leak)).
  Les chiffres publiés sur le sujet viennent surtout d'éditeurs : on mesurera
  les nôtres (§7).
- **Connexion** : aucune étude indépendante ne prouve qu'un lien magique
  convertit mieux qu'un mot de passe
  ([Baytech](https://baytechconsulting.com/blog/magic-links-ux-security-and-growth-impacts-for-saas-platforms-2025)).
  Ce qui est sûr : un mot de passe exigé pour **regarder** une page est une
  marche inutile. On ne l'exige qu'au moment de devenir client.
- Chez Yuno même : les **liens partenaires** (`/stats/:jeton`, 16/10) prouvent
  déjà le modèle « une page par personne pour une soirée, sans compte ».

## 3. Ce dont le club a besoin (le job, pas la Console)

Un club qui accueille une soirée qu'il n'organise pas se pose quatre questions :

| Moment | Question du club | Réponse sur la page |
|---|---|---|
| Avant | Combien de monde je dois prévoir ? | billets payants et entrées gratuites, jauge, « ▲ N aujourd'hui », rythme contre J-N (courbe), attendus à la porte |
| Avant | À quelle heure ils arrivent ? Le bar va-t-il être pris d'assaut ? | répartition par heure d'entrée (ex. « Before 1 AM » / « All Night Long »), boisson offerte et heure limite (`drink_cutoff_time`) |
| Avant | Qui joue, qui je dois contacter ? | horaires, line-up, affiche, contact de l'organisateur (WhatsApp / email) |
| Pendant | La soirée est-elle lancée ? | entrées scannées en direct, jauge de la porte |
| Après | Ça a marché chez moi ? | bilan : entrées / attendus, CA (si l'orga le montre), part de nouveaux visages |
| Toujours | Je veux aider à remplir | **son lien à lui** (ventes attribuées au club), texte prêt à partager |

Ce dont il n'a PAS besoin : Événements, Billetterie, Tables, Check-in,
Commandes, Facturation, Paiements, Clients, Email, Stripe, guide de configuration.
Jamais d'identité d'acheteur (comme les partenaires aujourd'hui).

## 4. La solution : une page de soirée, ouverte par un lien

### 4.1 Côté organisateur (Amoris)

Dans « Inviter sur cette soirée » (`InviteToEventStep` / `EventPartnersField`),
quand l'invité par email est un **Club** et que la soirée a déjà son lieu de
fait (soirée solo avec `location_name`), un troisième choix apparaît à côté de
« Lieu » : **« Club hôte (suit la soirée) »** (libellé à nommer). Champs :
email (ou WhatsApp), nom du club (pré-rempli par `location_name`), langue
(pré-remplie par le pays de la soirée : Segovia → espagnol), et un
interrupteur « Montrer le chiffre d'affaires » (allumé par défaut, décision de
Paul : « voir les ventes et tout »).

Envoyer = créer l'accès + envoyer l'email (ou ouvrir WhatsApp pré-rempli, même
modèle que les liens partenaires). Sur la page Co-organisation de la soirée,
une carte liste les accès : ouvert N fois, dernière visite, « Renvoyer »,
« Couper l'accès », bascule du CA.

### 4.2 Côté club : `/h/:jeton` (chemin à confirmer, voir §8)

- **Aucun compte, aucun mot de passe, aucune fenêtre** : le lien de l'email
  ouvre la page. Pas de Conditions professionnelles (le club ne publie, ne vend
  et n'encaisse rien), pas de guide de configuration, pas de barre latérale.
- **DA publique** (`docs/DESIGN_SYSTEM_PUBLIC.md`), mobile d'abord : le gérant
  lit ça sur son téléphone, entre deux livraisons.
- Contenu, dans cet ordre : en-tête soirée (affiche, date, lieu, « Organisée
  par Amoris ») → **la réponse en une phrase** (« 142 personnes attendues,
  38 de plus qu'il y a 3 jours ») → 4 chiffres (billets payants, entrées
  gratuites, attendus à la porte, CA si montré) → heures d'arrivée et boisson
  offerte → courbe des ventes → line-up et horaires → « Ton lien » (lien suivi au
  nom du club + Copier / WhatsApp / Instagram) → contact de l'orga → bloc
  conversion (§5). Pendant la soirée : bandeau « En direct » + entrées scannées.
  Après : le bilan remplace la courbe.
- Fermée 7 jours après la fin (comme les liens partenaires), coupable à tout
  moment par l'organisateur.
- Optionnel (lot 3) : « Garder l'accès / recevoir le bilan » = email confirmé par
  lien magique, sans mot de passe → le club reçoit l'email du bilan.

### 4.3 Données et sécurité

- Table `event_host_passes` (RLS **sans policy**, tout par RPC) : `event_id`,
  `venue_name`, `contact_email`, `contact_phone`, `language`, `token` (32 hex,
  tiré côté serveur, jamais modifiable), `show_revenue`, `tracked_link_id`,
  `created_by`, `created_by_party`, `opened_count`, `last_opened_at`,
  `revoked_at`, `expires_at` (fin + 7 j), `claimed_venue_id` (rempli à la
  conversion).
- Écriture : `create_event_host_pass`, `update_event_host_pass`
  (CA, couper), `list_event_host_passes(event)` — partie PRINCIPALE de la soirée,
  niveau ≥ 2 (`my_event_party`), jamais en accès assisté, garde démo ↔ démo.
- Lecture club : `get_event_host_pass(token)` (anon) : agrégats seulement,
  mêmes formules que `get_event_report` / `get_live_view` (CA club de `fees.ts`,
  remboursements déduits, payants / gratuits / guest list séparés, porte mesurée
  `_crm_door_measured` pour la venue). Pas de nom, pas d'email, pas de QR.
  Incrémente `opened_count` (anti-flood par visiteur haché, comme
  `track_guest_artist_click`). Toute fonction SECURITY DEFINER finit par ses
  REVOKE / GRANT ; vérifier `has_function_privilege('anon', …)` après coup.
- Le lien du club = une ligne `tracked_links` de la portée de l'organisateur,
  `partner_role = 'venue'` (infra des liens partenaires : attribution, aucune
  commission). Les ventes amenées par le club se lisent sur la page.
- Email : action nouvelle d'une fonction existante (quota de fonctions atteint),
  `invite-organizer-collab` `kind: 'host_pass'`, module pur
  `_shared/host-pass-email.ts` (FR / EN / ES, aussi lu par le front pour le texte
  WhatsApp). Jamais d'envoi vers une adresse démo.

## 5. La conversion en vrai client

Principe : on montre la valeur avec SES chiffres, on ne bloque rien, on ne
relance pas en boucle.

1. **Le bloc « Et tes propres soirées ? »** en bas de page, avec des faits de la
   soirée : « 142 personnes ont acheté leur place en ligne pour une soirée chez
   toi. Avec un compte Yuno, ce sont tes clients : tu les retrouves pour tes
   prochaines soirées, avec tes billets, tes tables et ta guest list. » Deux
   boutons : **« Ouvrir mon compte club »** et **« Parler à Paul »** (WhatsApp,
   numéro lu dans `links_page_config`).
2. **Inscription pré-remplie** : « Ouvrir mon compte club » mène au parcours
   d'inscription pro existant (landing `/start?role=club`, `pro_signups`) avec
   nom, ville, adresse, email, langue et la source `host_pass` + l'id de la
   soirée et de l'organisateur. Le club ne retape rien.
3. **Rien n'est perdu** : à l'ouverture du compte, `claim` de l'accès → le club
   devient partie `venue:` de la soirée en **Partenaire** (`event_cohosts`
   viewer), la soirée apparaît dans sa Console, la page `/h/` renvoie vers elle.
4. **Les bons moments, une fois chacun** : la page (toujours), la veille au soir
   (« ta soirée de demain : 142 attendus »), le **bilan du lendemain** (le pic
   d'intérêt : « 168 entrées chez toi samedi »), puis plus rien.
5. **Paul est prévenu** : ouverture de la page (une fois), clic « Ouvrir mon
   compte » et « Parler à Paul » → alerte super admin (`emit_admin_notification`,
   `admin_host_pass_lead`, dedup) et la fiche dans le Cockpit des inscriptions
   (source `host_pass`). Un club qui ouvre sa page 6 fois est un prospect chaud.
6. **L'organisateur y gagne aussi** : rien ne passe par lui pour la conversion,
   et la soirée reste la sienne (aucun droit ne change).

## 6. Lots

| Lot | Contenu | Fin |
|---|---|---|
| 1. Base | migration `event_host_passes` + 4 RPC + lien suivi + garde démo + tests SQL (bloc DO annulé, rôles joués par `request.jwt.claims`) | `db lint` vert, RPC anon vérifiée |
| 2. Organisateur | choix « Club hôte » dans l'invitation, carte des accès sur la page Co-organisation, email + WhatsApp | invitation créée et email rendu sur la démo |
| 3. Page club | `/h/:jeton` avant / pendant / après, mobile, 3 langues, bloc conversion | captures téléphone + ordinateur |
| 4. Conversion | inscription pré-remplie, `claim`, alertes Paul, PostHog (`host_pass_opened`, `host_pass_cta_clicked`, `host_pass_claimed`), bilan du lendemain | parcours rejoué de bout en bout sur la démo |
| 5. Doc | aide `ohelp.*` (3 langues), article assistant, section CLAUDE.md, `docs/MCP.md` si un outil lit la page | — |

## 7. Ce qu'on mesurera

Ouvertures par accès, retours sur la page, clics sur le lien du club, ventes
amenées par le club, clics « Ouvrir mon compte » / « Parler à Paul », comptes
ouverts depuis un accès. Pas d'objectif chiffré avant les 10 premiers accès.

## 8. Questions pour Paul

- Le nom visible de la fonction (côté orga) et de la page (côté club).
- Le chemin : `/h/:jeton`, `/soiree/:jeton`, ou `/stats/` partagé avec les liens
  partenaires ?
- Le CA est-il montré par défaut ? (proposé : oui, comme les partenaires)
- L'adresse email ou le WhatsApp de Tia Felisa, pour l'invitation réelle.
