# Yuno CRM — comprendre ce qui fait venir chaque client (plan, 2026-10-07)

> Point de départ : le message de prospection de Paul aux organisateurs
> (« Yuno comprend ce qui a fait venir tes clients, segmente toute ton audience
> et prépare des relances adaptées à chacun »). Le produit ne le fait pas encore.
> Ce plan couvre la PREMIÈRE moitié : **l'analyse client**. Le branchement sur
> l'intelligence (segments, relances en plusieurs temps, audit d'une soirée)
> est esquissé en fin de document et fera l'objet d'un plan à part.
>
> Les noms d'écrans et de notions ci-dessous sont des noms de TRAVAIL, à choisir
> avec Paul avant d'être écrits dans le produit.

## 1. Le principe

Shotgun dit **comment et quand** quelqu'un est venu. Jamais **pourquoi**.
Yuno estime le pourquoi en croisant deux choses qu'il connaît précisément :

1. **Le contenu de chaque soirée** : line-up (artistes avec un identifiant
   stable), genres, type de lieu, créneau, jour, série, tarifs et leur ordre.
2. **Le comportement de chaque personne** : quand elle a acheté, quel tarif,
   dans quelle commande (seule ou à plusieurs), par quel canal, si elle est
   entrée, d'où elle vient, à quelles autres soirées elle est revenue.

Ce croisement produit des **indices**, pas des certitudes. Règles :

- Chaque indice a une **force** (fort, moyen, faible) et une **preuve en mots**
  (« 3 de ses 4 soirées avaient Malaa à l'affiche », « sa 1re place était dans la
  commande d'un client déjà venu »). Un indice sans preuve ne s'affiche pas.
- Sous un seuil de volume, on se tait (même règle que `MIN_SAMPLE = 10`).
- Une famille d'indices ne s'affiche sur un compte que si elle **distingue
  quelqu'un** : si toutes les soirées d'un orga sont techno, le genre ne dit rien
  et l'écran le dit en une ligne.
- Une famille ne s'affiche que si elle **prédit vraiment le retour** sur CE
  compte (section 6). C'est ce qui sépare une analyse d'un horoscope.
- Tout sort d'un champ de `SHOTGUN_API_REFERENCE.md` ou d'une mesure Yuno.
  Libellé « estimé » partout où il y a inférence.

## 2. Ce que la base contient déjà, et ce qu'on en fait

Relevé du code au 07/10 (main local, `_crm_people_build` de `20261008200000`).

| Donnée Shotgun | Stockée ? | Utilisée par personne ? |
|---|---|---|
| `order_id` (plusieurs billets par commande) | oui, `external_order_id` | **non** (sert à compter les commandes par source) |
| `deal_title`, `deal_id` (tarif) | oui, `deal_name` | **non** (tableau des tarifs d'une soirée seulement) |
| `deal_sub_category`, `deal_visibilities` (dont `promoters`) | dans `raw` | **non** |
| `deal_channel` | dans `raw` | `invitation` et `duplicata` seulement |
| `ticket_seating` (Table / Booth), `payment_method` (paiement en plusieurs fois) | dans `raw` | **non** |
| `ordered_at` vs début / `launched_at` (délai d'achat) | oui | **non** |
| `utm_source`, `utm_medium` | oui | celui du 1er billet, **mais** n'importe quel billet (invitation, remboursé, duplicata) |
| `ticket_scanned_at` | oui | oui (« venu », couverture ≥ 50 %) |
| âge, genre, ville, code postal, pays | oui | oui (profil) |
| soirée : `artists[]` (id, slug, avatar) | oui, `external_events.artists`, relu à chaque synchro | **non** par personne ; copié une seule fois sur la soirée miroir |
| soirée : `genres[]` | oui (brut Shotgun) | **non** ; la miroir les convertit en 8 libellés Yuno et met « Open Format » par défaut |
| soirée : `typeOfPlace` | oui, `type_of_place` | **non** |
| soirée : `deals[]` (tarifs, prix, stock) | oui | tableau des tarifs ; la phase de vente (`subcategory.start_time`) est perdue au mapping |
| soirée : nom → série | `_crm_night_series(title)` existe | comparaison des soirées seulement, jamais par personne |

Ce qui existe par personne (`_cp`) : nombre de soirées, 1re et dernière soirée
(dates seulement, pas l'id), dépense, panier, cycle de vie
(`nou`/`occ`/`hab`/`end`/`none`), guest list (`gl_*`), profil, soirée à venir,
messages (`msg_n`, `click_nobuy`). Le segment « Venus une seule fois »
(`once` : 1 soirée, il y a plus de 30 jours) existe.

**Constat :** les matériaux sont presque tous là. Rien ne les assemble par
personne.

## 3. Inventaire des signaux

Treize familles. Pour chacune : ce qu'on mesure, d'où ça vient, ce que ça
suggère, et ses limites.

### A. Le line-up

- **Mesures.** Artistes vus par personne (`artists[].id` de chaque soirée
  venue, nombre de fois). **Rareté** d'un artiste sur le compte (part des
  soirées où il joue : un résident à 80 % ne fait venir personne en
  particulier, une tête d'affiche invitée une fois oui). **Attraction** d'un
  artiste : part de nouveaux venus à ses soirées comparée à la médiane du compte.
- **Indice fort.** A vu le même artiste rare 2 fois ou plus, à des soirées de
  séries différentes.
- **Indice moyen.** 1re venue à une soirée avec une tête d'affiche rare, ET
  achat dans les 72 h après la mise en vente, ET soirée qui a recruté plus de
  nouveaux que d'habitude. Renforcé s'il a fait la route (famille K).
- **Limite.** Shotgun ne dit pas quand un artiste a été annoncé. **Yuno peut
  le mesurer lui-même à partir de maintenant** : la synchro passe toutes les
  10 min, il suffit de noter la 1re fois qu'un artiste apparaît sur une soirée
  (table `crm_artist_seen`). Dans trois mois, « a acheté dans les 24 h qui ont
  suivi l'annonce de X » deviendra le signal le plus fort de tout le système.

### B. La musique

- **Mesures.** Genres Shotgun BRUTS des soirées venues (pas les 8 libellés Yuno,
  pas de « Open Format » par défaut). Profil de goût = part de chaque genre dans
  ses soirées.
- **Indice.** Genre dominant si 2 soirées ou plus et 60 % ou plus dans un genre.
  Une seule soirée = « goût présumé », faible.
- **Limite.** Shotgun donne le genre de la SOIRÉE, pas le goût de la personne :
  c'est une inférence. Et elle ne vaut que si le compte varie ses genres.

### C. Le format

- **Mesures.** `typeOfPlace` (club, plein air… : valeurs réelles à relever,
  lot 0), créneau dérivé de l'heure de début (journée, sunset, soirée, nuit,
  after), jour de la semaine, durée, lieu (adresse de la soirée), saison.
- **Indice.** Préférence si 2 soirées ou plus et 70 % ou plus sur un même format
  ou créneau. Exemple : « ne vient qu'aux plein air ».
- **Limite.** Même règle : utile seulement si le compte fait plusieurs formats.

### D. Le concept (la série)

- **Mesures.** Éditions d'une même série venues (`_crm_night_series`).
- **Indice fort.** 2 éditions ou plus d'une série **avec des line-ups
  différents** : il vient pour la soirée, pas pour l'artiste.
- **Ce qui départage A et D.** Même série, artistes différents → concept.
  Séries différentes, même artiste → line-up. Même série, même artiste
  (résident) → concept.

### E. Venir à plusieurs (la question « ami »)

On ne saura jamais qu'il s'agit d'un ami. Mais la commande Shotgun dit un fait :
**ces billets ont été achetés ensemble.**

- **Mesures.** Taille de la commande de chaque billet (billets partageant le
  même `order_id`). Deux cas, à mesurer sur un vrai compte (lot 0) :
  1. les billets d'une commande portent **des détenteurs différents** (billets
     nominatifs) → on sait qui est venu avec qui ;
  2. ils portent **tous le même contact** → on sait seulement qu'il achète
     pour N personnes.
- **Indices.**
  - « Vient à plusieurs » : la plupart de ses commandes comptent 2 billets ou plus.
  - « Achète pour sa bande » : commandes de 3+ billets à son nom (cas 2).
  - **« Amené par quelqu'un »** (le plus proche de « venu par un ami ») : sa
    1re place était dans une commande où un autre détenteur était déjà venu
    (cas 1). Phrase affichée : « sa 1re place était dans la commande d'un
    client déjà venu », jamais « venu par un ami ».
  - « Bande » : deux personnes ou plus qui se retrouvent dans la même commande
    sur 2 soirées ou plus.
  - **Tarif promoteurs** : `deal_visibilities` contient `promoters` → le tarif
    n'était visible que par le réseau d'un promoteur. Lui aussi « venu par
    quelqu'un ».
- **Limite.** L'API ne distingue pas l'acheteur du détenteur
  (`SHOTGUN_API_REFERENCE.md`, « ce que l'API ne rend pas »). À demander dans
  l'intégration partenaire.

### F. Le prix et le moment d'achat

- **Mesures.** Délai d'achat (jours avant la soirée, calendrier du fuseau de la
  soirée), temps depuis la mise en vente (`launched_at`), rang du tarif dans la
  soirée (ordre des `deals` par prix : 1er tarif, intermédiaire, dernier,
  porte), `deal_sub_category` brute, achat à la porte (`deal_channel` `onsite`
  ou `venue`), paiement en plusieurs fois.
- **Profils d'achat.**
  - **Anticipe** : achète au 1er tarif, tôt (sensible au prix ou très motivé).
  - **Fan de la 1re heure** : achète dans les 24 h après la mise en vente, même
    au plein tarif (motivation forte : souvent le line-up).
  - **Dernière minute** : J-1 ou le jour même.
  - **À la porte** : achète sur place.
- **Indice.** Profil dominant si 2 achats ou plus ; sinon le profil de son
  unique achat, faible.

### G. Le canal d'arrivée

- **Mesures.** Famille de source du **1er billet VENDU** (`_crm_ticket_source` :
  lien Yuno, story, bio, e-mail, SMS, réseau hors lien, appli Shotgun, direct,
  autre site, hors ligne), plateforme (`utm_medium` : app, site, widget).
- **Indice clé.** **Découverte Shotgun** (`utm_source = shotgun` + `app`) : il a
  trouvé la soirée dans l'appli Shotgun, il ne connaît peut-être pas l'orga.
  Ce n'est pas le même client que celui qui suit son Instagram.
- **Correction à faire.** `first_utm` doit ne lire que les billets vendus,
  par date d'achat.

### H. L'invitation

- Existe déjà (`gl_*`) : 1re venue en guest list, invité qui finit par payer
  (`gl_conv`), invité qui ne vient pas. À ajouter : « 1re venue = invitation »
  comme indice d'entrée (il est venu parce qu'on l'a invité).

### I. La dépense

- **Mesures.** Place à table (`ticket_seating.type` = Table ou Booth), part de
  tarifs hauts, panier par rapport au compte (existe : `basket`, `spend_top`).
- **Indice.** « Vient pour une table » : ne se relance pas comme un client à 15 €.

### J. La présence

- **Mesures.** Entrée scannée (soirées où la porte a scanné au moins la moitié
  des billets), heure d'entrée par rapport au début (arrive tôt / tard),
  taux d'absence d'un acheteur.
- **Indice.** « Achète mais ne vient pas » : un cas à part, ni fidèle ni perdu.

### K. Le profil et la distance

- **Mesures.** Âge (à un an près), genre, ville, pays (existent). **Distance**
  entre le code postal de la personne et l'adresse de la soirée
  (`geolocation`) : il faut une table code postal → coordonnées (Base officielle
  des codes postaux, données ouvertes La Poste) pour la France, et le pays
  ailleurs.
- **Deux usages.**
  1. **A fait la route** (plus de 80 km) pour une tête d'affiche rare : renforce A.
  2. **De passage** (étranger, ou très loin) : un « venu une seule fois » de
     passage ne reviendra presque jamais. **Le sortir du compte des clients à
     faire revenir** change complètement le chiffre que l'orga croit perdre.

### L. La trajectoire

- **Par personne.** 1re soirée (id), 2e soirée, délai entre les deux, rythme,
  dernière venue, place à venir.
- **Par compte.** **Taux de retour** : part des nouveaux venus d'une soirée
  revenus dans les 90 jours (et 180), sur les soirées assez anciennes pour qu'on
  puisse le dire. **Délai médian de retour** : « la moitié de ceux qui
  reviennent reviennent en moins de 38 jours » dit QUAND relancer.
  **Retour par famille d'indice, par canal d'arrivée, par soirée** : quelle
  soirée et quel canal recrutent des gens qui reviennent.
- Existe en partie : taux de retour et grille « Qui revient ? » de
  Analyses › Communauté.

### M. La réaction aux messages Yuno

Existe : envoyés, ouverts, cliqués, « a cliqué sans acheter », pages
d'inscription. À croiser avec les familles ci-dessus (par exemple : les
« découverte Shotgun » ouvrent-ils les e-mails de l'orga ?).

## 4. Au niveau de la soirée : ce que chaque soirée a attiré

Pour une personne venue UNE seule fois, ses propres indices sont minces. Ce qui
parle, c'est sa soirée. D'où un profil par soirée, calculé une fois :

- part de nouveaux venus (1re soirée sur le compte), comparée à la médiane ;
- têtes d'affiche et leur rareté ; genres ; format ; créneau ; série ;
- rythme : part vendue dans les 48 h après la mise en vente, complet ou non ;
- d'où viennent ses nouveaux : canal, distance, à plusieurs ou seuls ;
- plus tard (soirée de plus de 90 jours) : **taux de retour de ses nouveaux**.

Une soirée qui recrute deux fois plus que d'habitude, avec une tête d'affiche
qui n'était jamais venue, des achats concentrés après la mise en vente et
beaucoup de gens qui ont fait la route : ses nouveaux sont venus pour le
line-up. Cette lecture sert aussi l'orga directement (« qui fait venir du
monde neuf ? »).

## 5. Du signal à l'estimation : des règles, pas une boîte noire

- **Calcul en SQL, par règles lisibles**, comme les constats « À retenir »
  (clé + paramètres, texte traduit au front). Pas d'IA dans le calcul : il doit
  être testable, rejouable, et chaque phrase doit pouvoir être justifiée.
- Pour chaque personne : un score par famille, puis **les 1 ou 2 indices les
  plus forts**, chacun avec sa preuve. Exemples de sortie :
  - « Line-up (fort) — a vu Malaa 2 fois, à deux séries différentes. »
  - « Concept (fort) — 4 éditions de la même série, quatre line-ups différents. »
  - « À plusieurs (moyen) — 3 commandes sur 3 avec 2 billets ou plus. »
  - « Découverte Shotgun (moyen) — 1re place prise dans l'appli Shotgun. »
  - « De passage (fort) — habite en Belgique, une seule soirée. »
- Venu une seule fois : on affiche « indices de sa soirée » (ce que sa soirée a
  attiré + son propre comportement), toujours libellés faibles ou moyens.
- L'IA (Assistant Console, MCP) **lit** ces estimations pour écrire et
  conseiller. Elle ne les invente pas.

## 6. Valider avant de montrer

Chaque famille doit prouver, compte par compte, qu'elle prédit le retour :

- Parmi les personnes venues 2 fois ou plus : la 2e soirée ressemble-t-elle à
  la 1re sur la famille estimée (même artiste ou genre, même série, même format,
  revenue avec la même commande) plus souvent que chez l'ensemble des
  revenants ? Rapport des deux = **gain de prédiction**.
- Une famille ne s'affiche sur un compte que si son gain atteint 1,3 avec 30
  revenants ou plus. Sinon : « pas assez de recul » ou silence.
- Ces mêmes calculs fournissent les **phrases de l'audit** :
  « tes clients venus pour un artiste reviennent 2,4 fois plus quand un artiste
  du même genre est à l'affiche ». Elles sortent de SES billets : elles sont
  vraies.

## 7. Architecture

**Jamais dans `_crm_people_build`.** Ce constructeur tourne à chaque écran sur
la machine Nano (426 Mo) ; y ajouter ces calculs ralentirait toute la Console.
Tout se **pré-calcule** et `_cp` ne fait qu'une jointure.

- `crm_night_profile` (portée, soirée miroir) : série, têtes d'affiche et
  rareté, genres bruts, format, créneau, lieu, nouveaux, part de nouveaux,
  rythme de vente, origine des nouveaux, taux de retour des nouveaux.
- `crm_person_profile` (portée, e-mail normalisé) : faits du 1er billet vendu
  (soirée, tarif, rang, délai, source, plateforme, taille de commande,
  invitation, « commande avec un client déjà venu »), agrégats (artistes vus,
  genres, formats, créneaux, jours, éditions par série, profil d'achat, profil
  de groupe, distance, de passage), estimations `[{famille, force, preuve,
  paramètres}]`, date de calcul.
- `crm_artist_stats` (portée, artiste) : soirées, entrées, nouveaux amenés,
  taux de retour de ces nouveaux, « fans » (vus 2 fois ou plus).
- `crm_artist_seen` (soirée, artiste, 1re apparition) : la mémoire des
  annonces de line-up, alimentée par la synchro dès maintenant.
- **Rafraîchissement.** `ticketing_after_sync()` marque les e-mails et soirées
  touchés ; un cron (toutes les 30 à 60 min, jamais chaque minute) recalcule
  ceux-là seulement ; recalcul complet la nuit, un compte à la fois. Tables
  sans policy, lues par des RPC gardées par `crm_scope_allowed`, montants
  derrière `_crm_money_gate`.
- **Corrections au passage.** `first_utm` sur billets vendus seulement ; genres
  bruts depuis `external_events` (pas la miroir) ; artistes depuis
  `external_events` (relus à chaque synchro) ; phase de vente des `deals`
  conservée au mapping ; série calculée pour les miroirs.
- **Démo.** `seed-crm-demo.sql` doit semer des commandes à plusieurs billets,
  des artistes récurrents, des genres variés, des formats, des délais d'achat
  réalistes : sans ça, rien ne s'allume sur `crm@womber.fr`.

## 8. Où ça se voit (analyse seulement)

À nommer avec Paul. Proposition de placement :

- **Fiche client** : bloc « Ce qui le fait venir (estimé) », 1 ou 2 indices
  avec leur preuve, puis les faits (1re soirée, par où, combien de jours avant,
  avec combien de billets, artistes vus, genres, format).
- **Analyses › Communauté**, une vue de plus : « Pourquoi ils viennent, et qui
  revient ? » — répartition des indices chez les nouveaux venus, taux de retour
  par indice, les « venus une fois » séparés entre locaux et de passage, délai
  de retour.
- **Tiroir d'une soirée** : « Ce que cette soirée a attiré ».
- **Artistes** : qui amène du monde neuf, et des gens qui reviennent.
- **Clients et segments** : nouvelles clés de filtre (indice, artiste, genre,
  format, série, profil d'achat, à plusieurs, canal d'arrivée, distance, de
  passage) et nouveaux modèles au catalogue.
- **MCP** : un outil de lecture des indices agrégés, la fiche client enrichie,
  les filtres dans `list_customers`.

## 9. Ensuite : brancher l'intelligence (plan à part)

L'analyse donne, pour chaque personne, une **raison de revenir** :

| Indice | Ce qui le fera revenir | Déclencheur | Angle |
|---|---|---|---|
| Line-up | un artiste qu'il a vu, ou du même genre | ajout de l'artiste au line-up | l'artiste d'abord |
| Concept | la prochaine édition | publication de l'édition | « la #3 est en ligne » |
| Musique / format | une soirée du même genre ou format | publication | le genre, le lieu |
| À plusieurs | sa bande | publication, puis relance groupée | « ramène ta bande » |
| Anticipe | le prix | ouverture du 1er tarif, fin de palier | le prix qui monte |
| Dernière minute | l'urgence | J-1 et jour J (SMS) | « ce soir » |
| Invité | être invité, puis payer | prochaine liste | conversion |
| Découverte Shotgun | connaître l'orga | après sa 1re soirée | qui vous êtes |
| De passage | rien, ou sa prochaine venue | — | ne pas insister |

Ce que le système ne sait pas encore faire, relevé dans le code :

- **Une recette = un seul e-mail, à une audience que Yuno choisit.** Pas de
  séquence (étape 1, attendre, étape 2, sortir s'il achète), pas de recette
  limitée à un segment (une seule ligne par portée et par type de recette).
- **La pression d'envoi bloque le multi-touche** : délai de 48 h entre deux
  automatisations d'un même compte, 1 par 24 h et 3 par 7 jours. Une séquence
  devra avoir son propre budget, compté une fois.
- **Aucune automatisation « 1re soirée → 2e soirée »**, alors que c'est
  exactement la promesse du message.
- **Le moteur le plus proche d'une séquence existe** : les relances des pages
  d'inscription (étapes, délais, condition « n'a pas acheté », expiration,
  registre anti-doublon). Point de départ du futur moteur.
- **Variables par personne dans un e-mail** (« {{artiste}} », « ta 1re
  soirée ») : à créer.
- **MCP sur un compte CRM** : RFM, segments par cycle de vie, comportement
  d'achat, goûts et cohortes reviennent VIDES ; `get_event_report` lit
  l'ancienne RPC (compte les invitations et billets revendus comme des ventes) ;
  la période est ignorée. Aucun outil retour / 1re → 2e soirée, aucune
  invite « audit de ma prochaine soirée » (les invites MCP ne prennent pas
  d'argument). À corriger avant de compter sur le MCP pour un audit.
- **Ciblage d'une soirée à venir** : rien ne liste « venus aux éditions passées
  de cette série, pas encore de place pour celle-ci ».

## 10. L'audit promis dans le message, dès cette semaine

Avant tout code, l'audit peut se faire avec ce qui existe, honnêtement :

- **Accès.** Le pro s'inscrit (essai 14 jours) et colle lui-même son jeton
  Shotgun : c'est refusé en accès assisté, et c'est bien. Import : 2 à 10 min
  pour 5 000 à 30 000 billets. Pour lire, Paul passe par « Voir sa Console »
  (accord du pro, session de 12 h) ou se fait inviter comme admin de l'équipe
  (ce qui ouvre aussi le MCP). Jamais par des appels RPC super admin bruts : ils
  passent la porte mais ne laissent aucune trace.
- **Ce qu'on peut dire aujourd'hui** : taille de la base et part joignable par
  e-mail (consentement Shotgun), taux de retour et grille « Qui revient ? »,
  combien sont venus une fois, quelles soirées recrutent, par quels canaux,
  invités qui deviennent payants, réguliers sans place pour la prochaine.
- **Ce qu'on ne peut pas encore dire** : pourquoi chacun est venu (ce plan), et
  qui cibler précisément pour la soirée du [date].
- **Attention à la promesse « relances adaptées à chacun »** : on ne relance
  que les contacts qui ont accepté la newsletter de l'orga sur Shotgun. L'audit
  doit le chiffrer d'entrée (« 3 400 joignables sur 9 100 »), sinon l'orga
  découvre la marche au premier envoi.

## 11. Lots

| Lot | Contenu | Équipe humaine | Claude Code |
|---|---|---|---|
| 0 | Mesurer les vrais comptes connectés (requêtes en annexe, lecture seule, une à la fois) | 1 jour | 30 min |
| 1 | Tables de profil (soirée, personne, artiste), rafraîchissement, corrections, mémoire des annonces, démo | 1 à 2 semaines | 1 jour |
| 2 | Validation par compte (gain de prédiction) | 3 jours | 3 h |
| 3 | Écrans d'analyse + filtres + catalogue + MCP lecture + aide (3 langues) | 2 semaines | 1 jour |
| 4 | Intelligence : séquences, « 1re → 2e soirée », plan par soirée, MCP | plan à part | plan à part |

Le lot 0 décide de la famille E : si les commandes à plusieurs billets portent
des détenteurs différents, « amené par quelqu'un » devient le meilleur argument
du produit ; sinon, elle se réduit à « achète pour N personnes ».

## 12. À décider avec Paul

1. **Noms** des notions et des écrans (indice, « ce qui le fait venir »,
   l'audit…).
2. **Montrer l'estimation sur la fiche d'une personne**, ou seulement en
   agrégé ? (Utile pour écrire à quelqu'un, mais une estimation fausse sur une
   fiche se voit.)
3. **RGPD** : estimer des goûts depuis l'historique d'achat est du profilage
   (pas de donnée sensible, intérêt légitime de l'orga, Yuno sous-traitant). À
   écrire dans la politique de confidentialité CRM et le DPA.
4. **Les « de passage »** sortent-ils par défaut des « venus une fois à faire
   revenir » ?
5. **Fichiers importés** (Dice, Weezevent) : ils n'ont ni line-up ni commande.
   Analyse limitée au profil et à la trajectoire, ou rien ?

## 13. Hypothèses testées, et apprendre sans exposer les données (07/10)

Décision de Paul : on n'affirme rien, on teste des hypothèses. Et le système
doit s'améliorer avec les données de tous les comptes sans compromettre la
sécurité ni la vie privée. Exécution détaillée :
`docs/designs/CRM_CLIENT_ANALYSIS_PROMPT.md`.

**Le test commun à toutes les affinités.** Pour chaque client revenu, on regarde
la soirée qu'il a choisie ensuite, et on la compare à un tirage au hasard parmi
les soirées qui étaient au programme à ce moment-là. S'il choisit plus souvent
qu'au hasard une soirée qui partage un artiste, un genre, un format, une série
avec la précédente, l'hypothèse est confirmée sur ce compte. Sinon elle ne l'est
pas, et l'écran le dit. Les hypothèses sont calculées avec les seules données
d'AVANT la soirée qui sert de vérification : pas de triche avec le futur.

**Quatre statuts** : à tester (pas assez de revenants), confirmée sur ton
compte, pas confirmée, observée sur d'autres comptes Yuno (jamais confondue avec
la première).

**Apprendre sans exposer** : les données personnelles ne quittent jamais la
portée de leur compte. Ce qui en sort, ce sont des COMPTES agrégés (« 140
revenants testés, 61 choix conformes, 33 attendus au hasard »), cellules de
moins de 10 supprimées, sans e-mail, sans empreinte d'e-mail, sans titre de
soirée, rattachés à une clé de compte opaque. Une leçon commune ne se publie
qu'avec 5 comptes au moins et aucun compte qui pèse plus de la moitié (règle du
secret statistique). Les seuils (rareté, délai, distance) se règlent sur ces
agrégats ; le système propose une nouvelle version des règles, Paul la valide.
Aucune donnée personnelle n'entraîne un modèle, aucune n'est envoyée à une IA
pour apprendre. Un compte peut refuser de contribuer ; un compte supprimé retire
sa contribution. Clause à ajouter aux conditions et au DPA de Yuno CRM (texte à
valider par un juriste : l'anonymisation est elle-même un traitement que
l'organisateur doit autoriser).

## Annexe — lot 0 : ce qu'il faut mesurer sur un vrai compte

Lecture seule, sur la prod, une requête à la fois, après un coup d'œil à
`pg_stat_activity`. `<conn>` = l'id de la connexion Shotgun du compte.

```sql
-- 1. Commandes : combien à plusieurs billets, et avec des détenteurs différents ?
SELECT count(*) AS commandes,
       count(*) FILTER (WHERE n > 1) AS a_plusieurs,
       count(*) FILTER (WHERE n > 1 AND holders > 1) AS detenteurs_differents
FROM (SELECT external_order_id, count(*) n,
             count(DISTINCT lower(buyer_email)) holders
      FROM external_tickets
      WHERE connection_id = '<conn>' AND external_order_id IS NOT NULL
      GROUP BY 1) o;

-- 2. Soirées : line-up, genres, type de lieu renseignés ?
SELECT count(*) soirees,
       count(*) FILTER (WHERE jsonb_array_length(coalesce(artists,'[]')) > 0) avec_artistes,
       count(*) FILTER (WHERE cardinality(genres) > 0) avec_genres,
       array_agg(DISTINCT type_of_place) types_de_lieu
FROM external_events WHERE connection_id = '<conn>';

-- 3. Tarifs, canaux, plateformes, sous-catégories
SELECT raw->>'deal_channel' canal, raw->>'deal_sub_category' sous_cat,
       utm->>'utm_medium' plateforme,
       (raw->'deal_visibilities') ? 'promoters' tarif_promoteur,
       count(*)
FROM external_tickets WHERE connection_id = '<conn>'
GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 40;

-- 4. Couverture : scan, code postal, date de mise en vente
SELECT count(*) billets,
       count(*) FILTER (WHERE scanned_at IS NOT NULL) scannes,
       count(*) FILTER (WHERE zip_code IS NOT NULL) avec_cp
FROM external_tickets WHERE connection_id = '<conn>';
SELECT count(*) FILTER (WHERE launched_at IS NOT NULL) avec_mise_en_vente
FROM external_events WHERE connection_id = '<conn>';
```

Noms de colonnes à revérifier sur la base liée avant de lancer (le mapping est
dans `_shared/ticketing-shotgun.ts`).
