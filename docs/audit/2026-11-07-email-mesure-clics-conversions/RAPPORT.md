# Yuno CRM — mesure des ouvertures, des clics et des ventes d'un e-mail

Analyse de fond, cas réel **3AM · Act III** (guest list du 14/11). Lecture seule sur la prod,
aucune écriture, aucun code modifié. Rédigé le 07/11/2026.

Périmètre : compte `org:10764c3b-f312-42da-be99-4d57d7c6c0c5`, soirée miroir
`fb2009cb-2666-496f-af3e-4389cd406bad`, campagne `ec6daa79` (« Guest list Act III — anciens
invités sans place ») et sa relance `f770ce21`.

> **À retenir en trois lignes**
> 1. L'e-mail a fait vendre **6 places** (source Shotgun `yuno-m-…`), pas 4 comme l'écran
>    Résultats, pas 13 comme le rapprochement par adresse. **Le produit sous-estime d'un tiers.**
> 2. Sur les 21 personnes « qui ont cliqué », **16 sont des scanners de sécurité** (95 % des
>    clics bruts sont automatiques) et **5 sont des humains probables**. Aucun filtre n'existe
>    aujourd'hui, nulle part dans la chaîne.
> 3. Les « ouvertures » (14 %) sont à 71 % du préchargement de messagerie : à ne plus afficher
>    comme un résultat.

---

## 1. État des lieux chiffré

### 1.1 Les deux envois

| | Principale `ec6daa79` | Relance `f770ce21` |
|---|---|---|
| Lignes en file | 2 272 | 17 |
| Envoyées | 687 (682 reçues, 5 rebonds) | 17 |
| Retenues par la reprise Gmail (`gmail_cold`) | 1 585 | 0 |
| Envoi réparti | 8 vagues, 04/11 09 h → 07/11 08 h | 05/11 12 h → 07/11 09 h |
| Personnes avec ouverture | 93 (94 affichées : 1 test) | 11 |
| Personnes avec clic (hors désinscription) | 21 (23 affichées : 2 adresses de test) | 12 |
| Clics bruts | 95 (98 avec les tests) | 83 |
| **Clics humains probables** | **5** (5 clics) | **1 personne** (4 clics) |
| Désinscriptions réelles | **0** | **0** |

Chiffres du brief corrigés : « 685 reçus » compte 3 adresses de test (réel : **682**) ;
« 4 désinscriptions » sont 4 **clics de scanner sur le lien de désinscription**
(`unsubscribes_count = 0`, les 4 adresses restent `eligible` dans `crm_customer_contacts`).

### 1.2 Les ventes de l'Act III depuis l'envoi

- 168 billets valides depuis le 04/11 00 h sur l'Act III, **6 portent `utm_source = yuno-m-…`**
  (5 × `yuno-m-ec6daa79`, 1 × `yuno-m-f770ce21`).
- Le tarif caché « INVITATION 3AM » (`?ids=1861292`, celui du bouton) compte **6 billets en tout,
  les 6 avec la source e-mail** : la source Shotgun et le tarif racontent la même chose.
- Rapprochement par adresse (acheteur ou titulaire = destinataire) : 13 personnes. Le détail ci-dessous.

| Cas | Personnes | Lecture |
|---|---|---|
| Acheteur d'un billet portant la source de l'e-mail, adresse = destinataire | 5 | vraies ventes de l'e-mail |
| Acheteur d'un billet portant la source de l'e-mail, adresse ≠ destinataire (ou destinataire seulement par hasard) | 1 (corine) + 1 (9746…, voir 3.3) | vraies ventes, **invisibles par adresse** |
| Destinataire ayant acheté un **autre** tarif (source `direct` / `instagram.com`), après la réception, sans aucun clic | 5 | non attribuable (« possible ») |
| Destinataire ayant acheté un autre tarif **avant** d'avoir reçu l'e-mail | 3 | pas une conversion (voir 3.6) |

Donc : **13 = 5 vraies + 5 possibles + 3 impossibles**, et il manque la 6ᵉ vente réelle (corine),
qui n'est pas destinataire.

### 1.3 Ce que l'interface dit aujourd'hui (reconstitué)

Je n'ai pas pu lire l'écran (les RPC créent des tables temporaires, refusées en transaction
lecture seule). J'ai **rejoué la règle de `_crm_email_attrib`** sur les données :

| Où | Valeur | Règle |
|---|---|---|
| Résultats · Parcours · carte noire « messages » d'Analyses › Ventes | **4 acheteurs** | clic (n'importe lequel) dans les 7 j avant l'achat, même adresse |
| Analyses › Ventes › soirées, colonne « Via Yuno » | **6 billets** | source `em` (utm `yuno-m-…`) |
| Taux de clic / « personnes engagées » | 21-23 personnes | tout clic compte, test compris |

Trois écrans, deux nombres. Le bon (6) existe déjà dans la base et dans un écran.

---

## 2. Diagnostic des défauts de mesure

### D1 — 95 % des clics sont des scanners, et rien ne les filtre
Aucune ligne du code (webhook, RPC, moteurs) ne distingue un clic humain d'un clic automatique
(recherche `scanner|bot|prefetch|click_quality` dans les migrations : rien, hors la
déduplication par personne du 10/09).

Signature observée, sans équivoque :
- **16 personnes sur 16 sont des domaines d'écoles** (ieseg, essca, skema, efrei, kedge, em-lyon,
  dauphine, assas, tbs, igensia, em-normandie, ie.edu, u-pec) : passerelles de sécurité.
- Elles cliquent **tous les liens du message dans la même seconde** (bouton Shotgun ×2, « Powered
  by Yuno », Instagram, parfois le lien de désinscription), 4 clics en 0 à 2 s, une seule IP,
  première activité **5 à 118 s après l'envoi (médiane 42 s)**, IP aux préfixes Microsoft (4.x) et
  Amazon (3.x, 16.x, 35.x, 44.x, 52.x, 54.x) : constat par préfixe, **non vérifié par ASN**.
- Les plus lourdes (tristan 17 clics / 11 IP, louann 13 / 9 IP, jade 8 / 5 IP) **recommencent à
  chaque nouveau message** : mêmes personnes, même schéma sur la relance.
- Sur la plateforme (hors démo, hors tests, 01/10 → 07/11) : **195 personnes ont « cliqué »,
  154 (79 %) n'ont que des clics de scanner ; 1 418 des 1 478 clics bruts (96 %) sont
  automatiques.** Le cas 3AM n'est pas une exception.

### D2 — Une ouverture n'est pas une lecture
Sur les 93 personnes avec ouverture de la principale :

| Catégorie | Personnes | Part |
|---|---|---|
| Ouvre **uniquement** via un proxy (UA nu `Mozilla/5.0`, YahooMailProxy, GoogleImageProxy) | 66 | 71 % |
| Ouvre et n'a que des clics de scanner | 16 | 17 % |
| Ouvre et a un clic humain | 4 | 4 % |
| Ouvre via un client identifiable, sans clic | 7 | 8 % |

L'UA nu est la signature **Apple Mail Privacy Protection** (les 15 adresses iCloud qui ouvrent
sont toutes en UA nu, ainsi que 3 des 5 humains qui ont cliqué : ils lisent dans Apple Mail,
quel que soit leur fournisseur). Ces ouvertures arrivent à des heures sans rapport avec la
lecture (médiane **9 h** après l'envoi, aucune avant 60 s) : c'est la synchro de l'appareil.
Taux « d'ouverture non automatique » : 11 / 682 = **1,6 %**, contre 13,6 % affichés.

Point resté ouvert : seulement **15 / 179 adresses iCloud** et 1 / 27 Gmail ouvrent. Avec MPP actif
on attendrait presque 100 % sur iCloud. À investiguer côté délivrabilité (dossier indésirables ?),
hors périmètre ici.

### D3 — L'adresse n'est pas la personne
- **Lien partagé** : Charlotte clique (iPhone), les aperçus Meta (`facebookexternalhit`) frappent
  le lien depuis 12:36 le 06/11, et **corine.brunet8@gmail.com** achète à 12:54:03 avec la source
  de la relance, 2 minutes après le dernier clic de Charlotte. Corine n'est pas destinataire.
- **Autre identité** : `9746mhz7wf@privaterelay.appleid.com` (Hide My Email) achète à
  04/11 11:02:16, soit **11 s après le clic de Charlotte** (11:02:05), et avec la source de
  l'e-mail, **24 h avant d'avoir reçu son propre exemplaire** (envoyé le 05/11). Les deux avaient
  acheté la même guest list le 20/09 à 2 min d'écart. Compatible avec « même foyer / même
  personne, autre adresse » ; je ne l'affirme pas.
- Deux ventes sur six, soit **33 %**, sont invisibles dès qu'on rapproche par adresse :
  la règle actuelle en manque une par construction (le clic doit être de la **même adresse** que
  le billet).

### D4 — La règle d'attribution est trop large ET trop étroite
`_crm_email_attrib` (définition vivante lue en prod) :
- **Trop large** : n'importe quel clic compte (« Powered by », Instagram, scan), **sur n'importe
  quelle soirée** de la portée (le billet n'a pas à être celui de la campagne), test compris
  dans les clics lus. Un scanner qui « clique » puis un achat quelconque dans les 7 jours =
  vente attribuée. Sur 3AM aucune fausse attribution n'est née (aucun scanner n'a acheté), mais
  la porte est ouverte.
- **Trop étroite** : exige la même adresse, **ignore la source `yuno-m-<campagne>`** que Shotgun
  rapporte pourtant sur chaque billet (`withTicketingSource` la pose). La relance est exclue de
  la liste des campagnes de Résultats (`parent_campaign_id IS NULL`) : ses ventes n'y apparaissent
  pas.
- **« Dernier clic gagne »** entre la principale et la relance : une même vente change de campagne
  selon l'ordre.

### D5 — Les moteurs lisent les mêmes clics
- **Engagement** (`contact_engagement`) : les **21 cliqueurs sont `active`** (dont les 16
  scanners) et les 73 ouvreurs `passive` (dont 66 par proxy). Cela alimente les segments
  « engagés », la politique d'envoi (fatigue : « 8 envois sans ouverture ni clic »), la reprise
  Gmail (`gmail_engaged_days`) et le recentrage d'une campagne faute d'ouvertures
  (`_email_smart_delivery`, `email_campaign_guard_tick`). Un scanner garde une adresse « chaude »
  qui ne l'est pas, un Apple MPP aussi.
- **Relance après clic** : sur 17 destinataires, **16 sont des scanners** qui n'ont jamais vu
  le premier mail. La relance a écrit à des passerelles de sécurité ; ses 83 clics sont encore
  des scans. Même défaut dans la recette « A cliqué sans acheter » (`click_no_buy`) et dans les
  scénarios qui lisent un clic.
- **Tests dans les compteurs** : `_crm_email_stats` compte 94 ouvreurs / 23 cliqueurs là où
  `opens_count` / `clicks_count` de la campagne disent 93 / 95. Deux nombres pour une même chose.

### D6 — Exclure ceux qui ont déjà une place n'est vérifié qu'à la mise en file
`excludeEventBuyers: true` est jugé à la constitution de la file ; `claim_campaign_recipients`
ne le revérifie que pour les campagnes d'un plan de soirée (`policy:plan_holder_after_queue`,
`night_plan_id IS NOT NULL`). L'envoi s'étalant sur 4 jours (vagues), **3 destinataires ont reçu
« ta place sur la guest list » après avoir déjà pris leur place** (46,7 h, 36 h et 14,7 h avant
leur envoi). La garde ne lit en plus que `buyer_email`, pas `holder_email`.

---

## 3. Modèle proposé

Les noms visibles sont des **propositions à discuter avec Paul avant toute écriture** dans
l'interface (règle de la maison).

### 3.1 Trois classes pour un clic, calculées sur les faits

| Classe | Règle | Sur 3AM |
|---|---|---|
| **Automatique** | UA de robot connu (`facebookexternalhit`, `bot`, `Proofpoint`, `Mimecast`…) **ou** ≥ 3 clics à ≤ 5 s l'un de l'autre sur la même adresse, avec ≥ 2 liens ou ≥ 2 IP différents **ou** ≥ 4 IP distinctes en 30 min sans UA mobile | 90 clics sur 95 |
| **Probable humain** | tout autre clic | 5 clics, 5 personnes |
| **Douteux** | un seul clic, sur le **seul** lien non marchand, ou isolé < 10 s après l'envoi sans autre signal | 0 aujourd'hui |

Choix de seuils et pourquoi :
- **Pas de règle sur le délai seul** : theo clique **16 s** après l'envoi et achète 11 s plus tard. Un
  seuil « < 60 s = robot » le classerait faux. Le délai ne fait que **renforcer** une rafale.
- **Rafale** : tous les scanners observés sont à 4 clics en 0-2 s ; aucun humain ne l'est.
- Les clics d'un humain qui **partage** (Charlotte, 13 clics dont 9 aperçus de messagerie) sont
  classés clic par clic : 4 humains, 9 automatiques. Une classification **par personne** l'aurait
  rangée en robot.
- **Validation** : les 6 clics des acheteurs certains (4 sur 3AM, 2 sur d'autres campagnes) sont
  tous classés « probable humain » (6/6). Faux positifs sur les robots : **taux d'erreur non
  mesurable honnêtement aujourd'hui**, il n'y a de vérité terrain que les acheteurs. À construire
  (voir lot 1) ; en attendant, la classe s'appelle « probable », jamais « certain ».

Signal complémentaire, sans tracer plus : une liste publique de plages d'adresses de data centers
(AWS, Azure, GCP) en renfort de la règle « rafale », jamais seule.

### 3.2 Les ouvertures

Ne plus afficher « taux d'ouverture » comme un résultat. Classe par ouverture :
**proxy** (UA nu, YahooMailProxy, GoogleImageProxy), **scanner** (même personne classée automatique),
**client identifiable**. Seule cette dernière est une « lecture probable ». Les ouvertures par proxy
servent encore à la délivrabilité (le message est arrivé), pas à l'engagement.

### 3.3 La conversion attribuée, trois niveaux

| Niveau | Définition | Sur 3AM | Affichage |
|---|---|---|---|
| **Certaine** | billet dont `utm_source = yuno-m-<campagne>` (la relance se compte avec sa mère) | **6** | « Ventes de cet e-mail » |
| **Probable** | billet **sans** source Yuno, même soirée, par une adresse dont un clic *probable humain* précède l'achat de ≤ 7 j | 0 | « Ventes probables », libellé distinct |
| **Possible** | adresse destinataire, même soirée, achat après la réception, sans clic et sans source Yuno | 5 | **pas** une vente : un fait « ont acheté après réception, sans lien avec l'e-mail connu », en administration ou dans un menu replié, libellé « Estimation » si un nombre est montré |

Sous-ligne de la certaine : **« dont N par un lien partagé »** quand l'adresse du billet n'est pas
destinataire (corine). C'est du fait vérifié (adresse absente de la liste d'envoi), pas une
supposition sur la personne. Les autres cas (appareil différent, billet pris sans passer par le
lien) restent **« Bientôt, avec l'intégration partenaire Shotgun »** : on ne le mesure pas.

Contraintes de la maison respectées : rien d'estimé affiché comme un fait, aucun « il vient pour ».

### 3.4 Ce que l'écran client doit dire (maquette en mots)

```
Guest list Act III  —  reçu par 682 personnes
 6 places prises grâce à cet e-mail            ← source Shotgun, certain
   dont 1 par un lien partagé
 5 personnes ont cliqué (clics humains probables)
 Clics automatiques écartés : 90  ⓘ analyseurs de sécurité des messageries
 Livré · Rebonds 5 · Désinscrits 0
 [replié] Ouvertures : 93 enregistrées, dont 66 par préchargement Apple/Yahoo. Non utilisable.
```

### 3.5 Relance et moteurs

La relance après clic, la recette « A cliqué sans acheter », les scénarios « a cliqué » et
l'engagement (`contact_engagement`) lisent la **classe**, pas le clic brut. Sur 3AM la relance
aurait écrit à 1 personne au lieu de 17.

### 3.6 Exclure ceux qui ont déjà une place

Revérifier `excludeEventBuyers` à l'envoi (`claim_campaign_recipients`) pour toute campagne, sur
`buyer_email` **et** `holder_email`, avec la même raison `policy:holder_after_queue` et le même
remboursement des Yunits.

---

## 4. Plan par lots

| Lot | Contenu | Risque | Dépend de |
|---|---|---|---|
| **0 · Cohérence** | tests exclus de `_crm_email_stats` (réception, ouvreurs, cliqueurs) ; attribution limitée à la soirée de la campagne ; relance rattachée à sa mère dans Résultats ; garde « a déjà une place » à l'envoi pour toute campagne (D6) | faible, SQL seul, banc `crm-bench` | — |
| **1 · Classer** | colonne `click_class` / `open_class` sur `email_campaign_events` ; fonction `email_event_classify(campagne, adresse)` jouée par le webhook (+ balayage différé de 2 min pour voir les voisins) et rattrapage de l'historique ; **ne garder que le dérivé**, purger IP et user-agent bruts après 30 jours (minimisation, CNIL 2026-042) ; **jeu d'évaluation** : adresses de test chez des écoles (Microsoft 365), Apple MPP, Gmail ; éventuel lien-piège **non retenu par défaut** (un lien invisible peut nuire à la délivrabilité) | moyen : touche une table chaude, migration `lock_timeout` | lot 0 |
| **2 · Attribuer** | `_crm_email_attrib` v2 : certaine (utm), probable (clic humain, soirée de la campagne), partage ; **une seule fonction** pour Résultats, Parcours, carte noire d'Analyses › Ventes, colonne « Via Yuno » ; fixtures partagées SQL ⇄ TS comme les autres miroirs | moyen : 4 écrans + MCP `get_campaign_report` | lot 1 |
| **3 · Afficher** | KPIs Résultats refaits (3.4), ouvertures repliées, détail « clics écartés », FAQ `yc.faq.*` ×3, article assistant, consigne MCP | faible **après décision de noms** | lot 2 + décisions |
| **4 · Moteurs** | relance après clic, `click_no_buy`, scénarios, `contact_engagement`, politique d'envoi (fatigue, `gmail_cold`, recentrage) lisent la classe | moyen : change qui reçoit quoi ; à rejouer sur le banc avant la prod | lot 1 |

Ordre conseillé : **0 → 1 → 2 → (3 ‖ 4)**. Rien n'est à pousser sur la prod avant le feu vert de Paul.

Mesures de réussite à reprendre après le lot 2 : Résultats = 6 sur 3AM ; 0 écart entre les trois
écrans ; relance Act III (rejouée à blanc) = 1 destinataire ; 3 « places déjà prises » écartées.

---

## 5. Erreurs croisées en route (à corriger, même préexistantes)

1. Brief : 685 reçus / 94 ouvreurs / 23 cliqueurs / 98 clics incluent des adresses de test
   (réel 682 / 93 / 21 / 95). `_crm_email_stats` aussi.
2. « 4 désinscriptions » et « 3 clics de désinscription sur 17 » : 0 désinscription réelle ;
   ce sont des scanners sur le lien de pied de page (la page `/unsubscribe` ne désinscrit pas
   sans confirmation, bon point).
3. Trois écrans, deux nombres pour les ventes de l'e-mail (4 et 6).
4. Relance exclue de la liste de Résultats et de ses ventes.
5. « A déjà une place » non revérifié hors plans de soirée ; `holder_email` ignoré.
6. Clics sur « Powered by » et Instagram comptés comme « clic » dans le taux.
7. La carte noire de Ventes lit le clic pour les e-mails mais la **source** pour les SMS
   (`yuno-s-…`) : deux règles dans une même carte.

## 6. Ce que l'on ne sait pas encore

- Le taux d'erreur de la classe « automatique » (pas de vérité terrain hors acheteurs).
- Si les 5 personnes « possibles » ont été touchées par l'e-mail : la source Shotgun dit
  `direct`, c'est tout.
- Combien de ventes passent par **un autre appareil sans le lien** (Instagram mobile…) :
  invisible sans l'intégration partenaire, reste « Bientôt ».
- Pourquoi 15 adresses iCloud seulement sur 179 ouvrent (délivrabilité).
- Si Microsoft 365 / les passerelles scannent aussi les liens de pied de page à chaque envoi
  de toutes les campagnes (très probable : 154 scan-only sur la plateforme).

## 7. Décisions à prendre (Paul)

1. **Noms visibles** : « clic probable humain » / « clic automatique » / « ventes de cet e-mail » /
   « par un lien partagé » : à valider ou à renommer avant le lot 3.
2. **Affichage des ouvertures** : les replier (proposé), les retirer, ou les garder avec un avertissement.
3. **Périmètre du lot 4** : couper la relance et l'engagement sur la classe tout de suite (change
   qui reçoit une relance), ou seulement après le lot 3.

## 8. Méthode et reproductibilité

Toutes les lectures par `node scripts/crm-bench/prod.mjs` (transaction lecture seule, `--activity`
avant chaque série, une requête à la fois). Tables lues : `email_campaign_events` (metadata Resend :
`click.link`, `ipAddress`, `userAgent`, `timestamp`), `email_campaign_recipients`,
`external_tickets` (`utm`, `purchased_at`, `buyer_email`, `holder_email`, `deal_id`),
`contact_engagement`, `crm_customer_contacts`, `newsletter_subscriptions`. Fonctions lues en
définition vivante : `_crm_email_attrib`, `_crm_email_stats`, `crm_email_result__core`,
`claim_campaign_recipients`, `crm_ana_traffic__core`, `_crm_is_ticketing_link`, webhook
`resend-webhook`. Les exports et scripts d'analyse sont dans le dossier temporaire de la session
(non versionnés : ils contiennent des adresses).
