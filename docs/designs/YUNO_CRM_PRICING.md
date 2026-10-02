# Pricing Yuno CRM — six modèles comparés

> Analyse du 2026-10-02, à la demande de Paul. Il trouvait la première grille
> (paliers tout compris) à revoir, et pose deux idées :
>
> 1. un **abonnement par fonctionnalité** ;
> 2. des **crédits email et SMS de base** dans chaque abonnement, qu'on augmente
>    au besoin.
>
> **Statut : analyse, aucune grille validée.** Plan produit :
> `docs/designs/YUNO_CRM_PLAN.md`.

---

## Révision du 02/10 (soir) : paliers emboîtés, au prix du marché

**Cette section remplace le verdict de la section 0.**

Paul se demandait s'il ne valait pas mieux :

- des paliers où le niveau supérieur contient tout ;
- monter les prix ;
- prendre une grille du type 49 / 89 / 139 €.

Il a demandé un avis concret, appuyé sur le marché.

### Ce que vendent vraiment les concurrents

Relevé sur leurs pages de prix officielles le 02/10, hors taxes.

| | Offre d'entrée (sans automatisations) | Offre complète (automatisations, attribution, pubs) |
|---|---|---|
| **Gigz** | Essentielle **149 €** : 1 utilisateur, 20 000 emails, **ni automatisation, ni SMS, ni page de collecte, ni attribution** | Premium **649 €** : automatisations, pages, attribution, 5 utilisateurs, 150 000 emails, SMS en plus |
| **Nevent** | Marketing Basic **90 €** (75 € en promotion) : 1 000 crédits (1 SMS = 34 emails), **sans automatisation** | Marketing Pro **250 €** (208 € en promotion) : automatisations, RFM, A/B, 25 audiences Meta, IA |
| **Audience Republic** | Basic **dès ~98 $ / mois** à 10 000 contacts, en annuel | Plus **dès ~163 $ / mois** à 10 000 contacts : CRM, SMS, automatisations, attribution, audiences pub |
| **Cymbal** | Starter **20 $** pour 500 abonnés seulement, 4 automatisations, puis le prix monte avec la base | Premium **165 $** pour 500 abonnés, + 10 % des dépenses pub au-delà de 500 $ |

Aucun concurrent ne vend **par canal**. Même Nevent, le seul à vendre par
modules, met email, SMS, WhatsApp, push et audiences Meta dans le **même**
module Marketing, et découpe par objectif (Marketing, Expérience, Revenus). Les
automatisations sont l'argument qui fait payer cher : 208 à 250 € chez Nevent,
649 € chez Gigz.

### L'avis

1. **Pas de modules par besoin.**
   - Vendre l'email à 39 € met Yuno face à Brevo et à la newsletter gratuite de
     Shotgun.
   - Vendre Meta à 29 € le met face au gestionnaire de publicités de Meta, qui
     est gratuit.
   - Découpé, chaque morceau se compare à moins cher. Ensemble, c'est ce que
     personne d'autre ne fait : la base, les segments, l'envoi et les ventes
     reliés.
   - Et pour un fondateur seul, chaque module ajoute une porte, une ligne de
     facture et des questions au support.
2. **Des paliers emboîtés, oui.** Chaque niveau contient le précédent, avec une
   frontière claire :
   - Essentiel = parler à sa base ;
   - Pro = la faire grandir, tout automatiser et mesurer ;
   - Business = volume, équipe et accompagnement.
3. **Oui, 39 / 89 € était trop bas.** À 89 €, un Pro avec automatisations, pubs
   Meta et IA coûterait **moins de la moitié** de l'offre équivalente la moins
   chère du marché (Nevent Pro en promotion à 208 €, Audience Republic Plus vers
   163 $). Un prix aussi bas fait passer Yuno pour un simple outil de
   newsletter. Il ne paie pas non plus le temps d'accompagnement, qui est le vrai
   coût d'un fondateur seul.
4. **La grille 49 / 89 / 139 € a la bonne forme, mais elle est trop serrée en
   haut.**
   - Le palier du haut n'est qu'à 50 € du milieu. Les clients y montent, et on
     leur donne volume et service presque au prix du Pro.
   - Si les crédits sont consommés à 100 %, il ne reste que **31 % de marge sur
     le Pro et 16 % sur le palier du haut**.

### La grille recommandée

| | Gratuit | Essentiel | **Pro** (le plus choisi) | Business | Réseau |
|---|---|---|---|---|---|
| **Prix public / mois HT** | 0 € | **49 €** | **129 €** | **249 €** | sur devis |
| Prix fondateur (15 premiers comptes, garanti 12 mois) | — | 35 € | **89 €** | 175 € | — |
| Billetterie et fichiers | 1 source, synchro quotidienne | 1 billetterie + fichiers, synchro toutes les heures | plusieurs billetteries, synchro toutes les 15 min | idem | idem |
| Base, segments Yuno, RFM, bilan de soirée | ✅ | ✅ | ✅ | ✅ | ✅ |
| Campagnes email (Studio, modèles) | 1 000 emails, mention Yuno | ✅ | ✅ | ✅ | ✅ |
| Automatisations | — | **3 recettes au choix** | **toutes**, + A/B + renvoi aux non-ouvreurs | toutes | toutes |
| Pages de collecte et de prévente | — | 2 | illimitées | illimitées | illimitées |
| Audiences et pubs Meta (0 % sur le budget) | — | — | ✅ | ✅ | ✅ |
| DM Instagram (à construire) | — | — | ✅ | ✅ | ✅ |
| Attribution des ventes, rythme J-N comparé, assistant IA | — | — | ✅ | ✅ | ✅ |
| Emails inclus / mois | 1 000 | 15 000 | **50 000** | 100 000 | sur devis |
| SMS inclus / mois | — | 100 | **250** | 500 | sur devis |
| Utilisateurs | 1 | 3 | 5 | illimités | illimités |
| Service | aide en ligne | aide + IA | aide + IA | **import et modèles faits avec toi**, interlocuteur dédié, envoi depuis ton propre domaine, rapports partenaires à ta marque | multi-espaces, vue consolidée |

**Les crédits** suivent ton idée :

- Une base de crédits incluse dans chaque palier.
- Trois façons de les augmenter : recharge ponctuelle (les packs actuels, email
  à prix coûtant), option mensuelle (+25 000 emails à 24 €, +500 SMS à 45 €),
  recharge automatique avec un plafond fixé par le pro.
- Email et SMS restent **comptés séparément**. On ne reprend pas le crédit unique
  de Nevent (« 1 SMS = 34 emails ») : moins clair, et faux chez nous, où un SMS
  coûte environ 80 emails.

**Les autres règles :**

- Annuel = 10 mois.
- Essai de 14 jours du Pro sans carte, puis retour au Gratuit.
- Associations : −30 %, à valider.
- Yuno Billetterie inclut le Pro.

### Les chiffres

Mêmes cinq profils et mêmes coûts que la section 1. Montants en € par mois,
crédits supplémentaires compris.

| Profil | Modules (M3) | Grille de Paul 49 / 89 / 139 | **Recommandée 49 / 129 / 249** |
|---|---|---|---|
| A Asso saisonnière | 39 | 49 | **49** (35 au prix fondateur, −30 % en association) |
| B Orga hebdo (type WOH) | 113 | 98,50 | **133,50** |
| C Club, 2 soirées/semaine | 201 | 184 | **216,50** (reste en Pro) |
| D Festival | 236 | 221,50 | **251,50** |
| E Seulement Meta | 29 | 89 | **129** |
| Marge minimale (crédits inclus consommés à 100 %) | 40 % | 31 % (Pro), **16 %** (haut) | **45 %** sur chaque palier |
| Revenu moyen par compte (30 % Essentiel, 55 % Pro, 15 % palier haut) | — | ~97 € | **~129 €** |

Un organisateur hebdomadaire qui fait ~300 000 € de billetterie par an paierait
le Pro ~1 550 € par an, soit **0,5 % de son chiffre**. Le CRM se rembourse dès
qu'il fait vendre 1 % de plus. C'est une hypothèse : aucune hausse de ventes
n'est encore mesurée.

### Pourquoi 129 € et pas plus

- Il reste **sous** les offres complètes du marché : Nevent Pro 208 à 250 €,
  Audience Republic Plus ~163 $ à 10 000 contacts, Gigz Premium 649 €. Yuno
  arrive en challenger, pas en solderie.
- Il reste sous la barre des 150 €, à laquelle un organisateur qui ne paie rien
  aujourd'hui (Shotgun ne facture pas son CRM) commence à demander l'avis d'un
  associé.
- Ton 89 € devient le **prix fondateur** du Pro. Il récompense les premiers
  comptes sans abîmer le prix public. Une remise se retire facilement ; un prix
  public trop bas se remonte très mal.

### Ce qui reste à prouver

Aucun de ces prix n'a été testé par un client. Avant de publier la page :

- 5 à 10 entretiens d'organisateurs (les questions sont en section 7) ;
- montrer la page et demander « lequel tu prendrais ? ».

Si plus de la moitié des organisateurs hebdomadaires répond « Essentiel », la
frontière est mal placée : c'est l'automatisation qui doit faire monter en Pro,
pas le volume.

---

## 0. Premier verdict (remplacé par la révision ci-dessus)

**Recommandé : le modèle 3, « socle gratuit + trois modules par objectif ».**
C'est ton idée d'abonnement par fonctionnalité, regroupée en trois modules
cohérents au lieu de sept. Chaque module apporte ses crédits de base, et les
crédits s'augmentent de trois façons : recharge ponctuelle, option mensuelle,
recharge automatique.

| | Gratuit | Communiquer | Acquérir | Piloter | **Pack complet** | Réseau |
|---|---|---|---|---|---|---|
| Prix / mois HT | 0 € | **39 €** | 29 € | 29 € | **89 €** (au lieu de 97) | dès 199 € |
| Contenu | connexion Shotgun ou fichier, base complète, segments Yuno, RFM, bilan de soirée | Email Studio, campagnes, toutes les automatisations, SMS | pages de collecte et de prévente, QR, liens suivis, audiences et pubs Meta (0 % sur le budget) | synchro toutes les 15 min, rythme J-N comparé, attribution, rapports partenaires, assistant IA | les trois modules | plusieurs espaces, accompagnement |
| Crédits inclus / mois | — | 15 000 emails + 50 SMS | — | — | 30 000 emails + 200 SMS | sur mesure |

Sur la page de prix, il se **lit comme des paliers**, en quatre colonnes :
Gratuit · Communiquer 39 € · Pack complet 89 € · Réseau. Acquérir et Piloter
sont proposés en options sous Communiquer. On garde la lisibilité des paliers
et la souplesse des modules.

**Pourquoi lui.** Les modèles 1 (paliers) et 3 font jeu égal sur les clients
qui veulent tout. Ils facturent à quelques euros près un organisateur
hebdomadaire, un club ou un festival. Le modèle 3 l'emporte sur trois points :

- Il fait payer **moins aux petits** : 39 € au lieu de 49 € pour une asso.
- Il fait payer **moins à ceux qui ne veulent qu'une chose** : 29 € au lieu de
  99 € pour quelqu'un qui ne veut que ses pubs Meta.
- Son **socle gratuit** sert de porte d'entrée : on branche Shotgun et on voit
  sa base et ses bilans sans carte. C'est aussi la première marche vers la
  billetterie Yuno.

Le modèle 2 (sept modules à la carte) gagne plus par compte sur le papier, mais
c'est celui où le client qui veut tout paie le plus (165 € contre 113 €) et où
le choix est le plus confus. Les modèles à l'usage, au billet et au résultat
font perdre de l'argent sur les petits comptes et rendent le revenu saisonnier.

---

## 1. Méthode

### 1.1 Cinq profils de clients

Les volumes sont des moyennes mensuelles estimées. Ce ne sont pas des données
client, à part l'ordre de grandeur de la base WOH (11 076 contacts).

| Profil | Soirées / an | Joignables (email) | Emails / mois | SMS / mois | Billets / an | Ce qu'il veut |
|---|---|---|---|---|---|---|
| **A** Asso ou petite orga saisonnière | 6 | 1 500 | 4 000 | 0 | 1 500 | base, email, quelques recettes |
| **B** Orga hebdo (type WOH) | 50 | 11 000 | 45 000 | 300 | 17 500 | tout |
| **C** Club, 2 soirées par semaine | 100 | 18 000 | 70 000 | 1 000 | 45 000 | tout, équipe de 5 |
| **D** Festival ou gros orga saisonnier | 4 | 40 000 | 60 000 | 1 500 | 32 000 | email, SMS, Meta, collecte |
| **E** Veut seulement ses pubs Meta | — | 5 000 | 0 | 0 | 8 000 | base + Meta |

### 1.2 Les coûts de Yuno

- **Email** : 0,09 centime par envoi, au coût marginal du palier Resend
  supérieur (0,90 $ / 1 000).
- **SMS** : 0,073 € par segment vers la France (Twilio).
- **Fixe par compte** : 5 € par mois pour un compte payant (synchro, Supabase,
  IA, support), 1 € pour un compte gratuit à synchro quotidienne.
- **Stripe Billing** : environ 2,2 % + 0,25 € par facture (carte + Billing).
- **Recharges** : vendues aux prix actuels, soit emails 10 € / 10 000 (environ
  prix coûtant) et SMS environ 0,09 € (pack de 500 à 45 €).

Le calcul est rejouable : script `pricing.py` du 02/10. Toutes les hypothèses
sont ci-dessus ; changer un prix change le tableau, pas la méthode.

### 1.3 Ce qui vaut pour tous les modèles

- **Yuno Billetterie inclut le CRM.** Un compte qui vend avec Yuno ne paie pas
  d'abonnement CRM.
- **Pas de frais de mise en route, pas d'engagement**, l'annuel coûte 10 mois
  (règle déjà en place, `ANNUAL_BILLED_MONTHS`).
- **SMS inclus seulement quand le SMS sera allumé** (numéro Twilio). D'ici là,
  aucune promesse.

---

## 2. Les six modèles

### M1 — Paliers tout compris (la première grille)

**Grille :**

- Gratuit 0 € : 1 000 joignables, 2 000 emails.
- Essentiel 49 € : 5 000 joignables, 15 000 emails, 100 SMS.
- Pro 99 € : 25 000 joignables, 40 000 emails, 250 SMS, Meta, IA.
- Réseau 199 € : 60 000 joignables, 100 000 emails, 1 000 SMS.

**Pour :** le plus simple à lire, un seul chiffre. C'est la norme du marché
(Gigz, Delight).

**Contre :**

- On paie pour ce qu'on n'utilise pas. Celui qui ne veut que les pubs Meta paie
  99 €.
- L'asso paie 49 € dès qu'elle dépasse 1 000 contacts.
- Le palier Réseau donne trop : il ne garde que 13 % de marge si le client
  consomme tous ses crédits.

### M2 — Modules à la carte (l'abonnement par fonctionnalité, à la lettre)

**Grille :**

- Socle 15 €
- Email 25 € (20 000 emails)
- Automatisations 19 €
- SMS 15 € (150 SMS)
- Pubs Meta 19 €
- Collecte 15 €
- Pilotage + IA 19 €

Total : 127 € pour tout.

**Pour :**

- Chacun paie ce qu'il prend : 34 € pour quelqu'un qui ne veut que Meta.
- La marge par compte est la plus haute.

**Contre :**

- **Sept décisions avant de commencer.**
- Des modules qui n'ont pas de sens seuls : une automatisation sans email, une
  attribution sans campagne, une page de collecte sans message de bienvenue.
- Celui qui veut tout paie **165 € au lieu de 113 €**.
- La facture devient difficile à prévoir.
- On reproduit la « pile d'outils » que l'étude désigne comme le vrai
  concurrent, alors que la valeur de Yuno vient justement du lien entre base,
  segments, envois et ventes.

### M3 — Socle gratuit + trois modules par objectif ✅ recommandé

Grille au verdict.

Les sept fonctions de M2 sont regroupées selon les trois usages que l'étude
retient chez Nevent et Delight :

- **Communiquer** = parler à sa base.
- **Acquérir** = la faire grandir.
- **Piloter** = comprendre ce qui marche.

Les automatisations restent dans Communiquer : c'est le cœur de la valeur, les
isoler serait le piège de M2.

**Pour :**

- Un premier résultat **gratuit** (base, segments et bilans, dès la connexion de
  Shotgun).
- Une entrée à 39 €.
- Le client mono-usage paie peu.
- Le pack donne un prix clair à celui qui veut tout.
- Les crédits sont rattachés au module qui envoie.

**Contre :**

- Quatre prix au lieu d'un : c'est la présentation en paliers qui compense.
- Le socle gratuit consomme une partie du quota Shotgun partagé. D'où la synchro
  quotidienne.
- Une fuite à fermer : le socle gratuit ne doit pas permettre d'**exporter un
  segment** pour l'envoyer depuis la newsletter gratuite de Shotgun. L'export de
  la base entière reste libre, c'est la portabilité ; l'export d'un segment
  passe dans Communiquer.

### M4 — À l'usage, sans abonnement

**Grille :** tout est gratuit. On paie l'envoi : 2,50 € les 1 000 emails, 0,12 €
le SMS.

**Pour :** aucun frein à l'entrée, et chacun paie selon ce qu'il envoie (comme
Brevo).

**Contre :**

- **Taxer l'envoi décourage l'usage**, alors que c'est l'usage qui crée la valeur.
- Il contredit « emails à prix coûtant » de la Suite.
- Le revenu suit les saisons.
- Les petits comptes coûtent plus qu'ils ne rapportent (A : 0,90 € de marge,
  E : perte).

### M5 — Au billet vendu

**Grille :** 0,06 € par billet payé synchronisé, tout inclus, avec un plancher à
19 € par mois.

**Pour :**

- **L'unité que la nuit comprend.**
- Le prix suit l'activité réelle : un saisonnier paie en saison.

**Contre :**

- C'est perçu comme une taxe sur chaque billet, ce qui contredit « Yuno ne prend
  aucune commission ».
- On facture sur la donnée d'un tiers (litiges, remboursements, synchro en
  retard).
- Sans Shotgun connecté (import de fichier), il n'y a pas d'unité.
- Le gros club paie 331 €.
- Le festival reçoit 640 € de facture en saison puis 19 €.
- Shotgun pourrait voir un péage sur ses propres billets.

### M6 — Au résultat

**Grille :** 3 % du chiffre attribué aux campagnes Yuno (clic → achat sous
72 h). Rien si rien n'est attribué.

**Pour :** zéro risque pour le client, et le prix « se vend tout seul ».

**Contre :**

- **Une attribution n'est pas une cause** : l'étude insiste dessus, et chaque
  facture deviendrait une discussion.
- Pertes sur les petits comptes.
- Une commission déguisée.
- Le revenu est imprévisible, et rien n'est facturé à qui ne connecte pas ses
  ventes.

---

## 3. Ce que chaque profil paierait

### 3.1 Prix mensuel HT, crédits supplémentaires compris

| Profil | M1 Paliers | M2 À la carte | **M3 Socle + modules** | M4 Usage | M5 Au billet | M6 Résultat |
|---|---|---|---|---|---|---|
| A Asso saisonnière | 49 € | 59 € | **39 €** | 10 € | 19 € | 4,50 € |
| B Orga hebdo | 108,50 € | 165,50 € | **113 €** | 148,50 € | 126,50 € | 117 € |
| C Club | 196,50 € | 253,50 € | **201 €** | 295 € | 331 € | 292,50 € |
| D Festival | 244 € | 269,50 € | **236 €** | 330 € | 295 €* | 390 €* |
| E Seulement Meta | 99 € | 34 € | **29 €** | 0 € | 40 € | 0 € |
| Revenu moyen par compte | 139 € | 156 € | **124 €** | 157 € | 162 € | 161 € |

\* Moyenne lissée sur l'année. Dans la réalité, le festival paierait plusieurs
centaines d'euros en saison et presque rien le reste de l'année.

### 3.2 Marge de Yuno par mois (prix − envois − fixe − Stripe)

| Profil | M1 | M2 | **M3** | M4 | M5 | M6 |
|---|---|---|---|---|---|---|
| A | 39 € | 49 € | **29 €** | 1 € | 10 € | **−4 €** |
| B | 39 € | 94 € | **43 €** | 78 € | 56 € | 47 € |
| C | 51 € | 107 € | **55 €** | 147 € | 183 € | 145 € |
| D | 70 € | 95 € | **62 €** | 154 € | 120 € | 213 € |
| E | 92 € | 28 € | **23 €** | **−1 €** | 34 € | **−1 €** |

**Comment le lire :**

- Les modèles qui rapportent le plus sur les gros comptes (M4, M5, M6) sont
  aussi ceux qui perdent sur les petits et qui suivent les saisons.
- M2 rapporte plus parce qu'il fait payer davantage le client qui veut tout.
  En vrai, ce client prend moins de modules ou part chez un concurrent à prix
  unique.
- M3 rapporte un peu moins en moyenne (124 € contre 139 € pour M1) **parce
  qu'il ne fait pas payer ce qui ne sert pas** : 29 € au lieu de 99 € pour le
  profil Meta, 39 € au lieu de 49 € pour l'asso. Sur les clients qui veulent
  tout (B, C, D), il rapporte autant que M1.
- Les marges en pourcentage paraissent basses sur les gros envoyeurs (26 à
  28 % pour C et D). C'est voulu : les recharges sont vendues au prix coûtant,
  et la marge vient de l'abonnement. En euros, elle reste de 55 à 62 € par mois.

### 3.3 Le pire cas : un client qui consomme 100 % de ses crédits inclus

| Offre | Prix | Coût max | Marge mini |
|---|---|---|---|
| M1 Essentiel | 49 € | 27 € | 22 € (45 %) |
| M1 Pro | 99 € | 62 € | 37 € (38 %) |
| M1 Réseau | 199 € | 173 € | **26 € (13 %)** |
| **M3 Communiquer** | 39 € | 23 € | 16 € (40 %) |
| **M3 Pack** | 89 € | 49 € | 40 € (45 %) |

Aucune offre de M3 ne descend sous 40 %. C'est ce qui a fixé les crédits
inclus : 15 000 emails et 50 SMS pour Communiquer, 30 000 et 200 pour le Pack.

---

## 4. La notation

Chaque critère est noté sur 5. Les poids viennent de l'étude (chapitre 19 : « la
lisibilité peut compter autant que le prix facial ») et de la situation de
Yuno : un lancement où l'adoption compte plus que le revenu par compte.

| Critère (poids) | M1 | M2 | **M3** | M4 | M5 | M6 |
|---|---|---|---|---|---|---|
| Lisibilité : le pro devine sa facture en 10 s (25 %) | 5 | 2 | 4 | 3 | 4 | 2 |
| Porte d'entrée : essayer sans risque (15 %) | 4 | 4 | 5 | 5 | 4 | 5 |
| Juste prix : chacun paie ce qui lui sert (15 %) | 3 | 4 | 4 | 3 | 5 | 4 |
| Revenu prévisible pour Yuno (15 %) | 4 | 3 | 4 | 1 | 2 | 1 |
| Marge protégée, même au pire cas (10 %) | 4 | 4 | 4 | 3 | 3 | 1 |
| Simplicité technique (Stripe, quotas, portes) (10 %) | 4 | 2 | 3 | 3 | 2 | 1 |
| Montée en gamme et passage à la Suite (10 %) | 3 | 3 | 5 | 2 | 3 | 2 |
| **Note pondérée / 5** | 4,00 | 3,05 | **4,15** | 2,90 | 3,45 | 2,40 |

**Sensibilité.** Si la lisibilité pèse 40 % au lieu de 25 %, M1 passe devant
(4,20 contre 4,15). Les deux modèles sont proches, et le choix entre eux est
stratégique :

- Si on croit au socle gratuit comme porte d'entrée (et comme entonnoir vers la
  billetterie Yuno), et à la souplesse demandée par Paul, c'est **M3**.
- Si on veut le prix le plus simple possible, c'est **M1**.

Les autres modèles sont distancés quel que soit le poids.

---

## 5. Le modèle recommandé, dans le détail

### 5.1 La grille

Elle est au verdict (section 0). Compléments :

- **Annuel** : Communiquer 390 € par an, Pack 890 € par an (10 mois).
- **Essai** : à la connexion de la première source, le Pack est offert 14 jours,
  **sans carte**, puis le compte revient au socle gratuit. Rien n'est coupé, il
  ne peut simplement plus envoyer.
- **Lancement** : les 15 premiers comptes choisis à la main
  (`EARLY_ADOPTER_LIMIT`) ont 3 mois de Pack offerts et un prix garanti.
- **Association** (à décider) : Communiquer à 19 €.
- **Réseau** : dès 199 €, avec trois espaces qui ont chacun le Pack, et un
  accompagnement. Ses crédits se fixent sur devis : c'est là que M1 perdait sa
  marge.
- **Passerelle** : un compte qui vend avec Yuno Billetterie a le Pack inclus.

### 5.2 Les crédits email et SMS (ta deuxième idée)

**Inclus chaque mois** par le module qui envoie :

| | Emails / mois | SMS / mois |
|---|---|---|
| Communiquer | 15 000 | 50 |
| Pack complet | 30 000 | 200 |
| Réseau | sur devis | sur devis |

Les crédits inclus repartent à zéro à chaque échéance, sans report. Les crédits
**achetés** n'expirent jamais. On consomme d'abord l'inclus, puis l'acheté. C'est
la formule déjà en production pour l'email : `GREATEST(0, inclus − envoyés) +
crédits`.

**Trois façons de les augmenter :**

1. **La recharge ponctuelle** reprend les packs existants : emails 10 € les
   10 000 ou 24 € les 25 000, à prix coûtant ; SMS de 9,90 € les 100 à 390 € les
   5 000.
2. **L'option mensuelle**, récurrente, s'ajoute à l'abonnement : +25 000 emails
   par mois pour 24 €, +500 SMS par mois pour 45 €. Elle sert à celui dont le
   volume est stable.
3. **La recharge automatique** est facultative. Quand le solde passe sous 10 %,
   Yuno achète le pack choisi par le pro, dans la limite d'un plafond mensuel
   qu'il fixe lui-même. **Une campagne n'est jamais coupée en plein envoi**,
   alors qu'aujourd'hui elle attend le mois suivant.

Ce qui est montré au pro :

- la jauge à l'étape « Planification », qui existe déjà pour l'email ;
- « prix coûtant, aucune marge » écrit à côté des recharges email, comme
  aujourd'hui ;
- un email quand les crédits arrivent à 80 % puis à 100 %.

### 5.3 Les garde-fous

- **Fraîcheur de synchro par offre.** Socle gratuit : une fois par jour.
  Communiquer : toutes les heures. Piloter et Pack : toutes les 15 minutes. Le
  quota Shotgun (100 requêtes par minute et par IP) est partagé par tous les
  clients.
- **Export.** La base entière s'exporte toujours (portabilité). L'export d'un
  segment exige Communiquer.
- **Membres d'équipe.** Un sur le socle gratuit, illimités dès qu'un module est
  pris. On ne fait pas payer au siège : c'est ce qui rend M2 pénible.
- **Recharges.** On garde une seule grille pour la Suite et le CRM, pour ne pas
  avoir deux listes de prix à tenir.

---

## 6. La mise en œuvre (ce qui existe, ce qu'on ajoute)

| Pièce | Existe | À faire |
|---|---|---|
| Inclus mensuel + solde email | ✅ `email_sender_state`, surcharge par portée | fixer l'inclus par le module actif plutôt que les 15 000 uniques |
| Solde SMS | ✅ `sms_credit_balances`, `sms_packs` | ajouter une **allocation mensuelle**, sur le modèle de `push_credit_accounts` |
| Packs ponctuels | ✅ edges `email-credits`, `sms-purchase-checkout` | — |
| Abonnement Stripe Billing | ✅ `club-subscription` + webhook, mais clubs seulement | une clé de portée (`venue:` / `org:`) ; un abonnement à **plusieurs lignes** (un module = une ligne, le pack = un prix qui remplace les trois) ; options mensuelles = lignes à quantité |
| Portes de fonctions | ✅ `PlanGuard` (club), `PATH_CAPABILITY` (orga) | une porte par module, dans les deux consoles |
| Recharge automatique | ❌ | moyen de paiement enregistré, paiement hors session, plafond mensuel, journal |
| Revenu récurrent dans le super admin | 🟡 `/admin/revenue` | lignes CRM par module |

Stripe sait gérer un abonnement à plusieurs lignes : on ne construit pas de
logique de facturation à la main.

---

## 7. Ce qu'on teste avant de figer

1. **Cinq à dix entretiens d'organisateurs Shotgun**, avec quatre questions :
   - « À quel prix mensuel ce serait trop cher pour que tu l'essaies ? »
   - « À quel prix tu douterais que ça marche ? »
   - « Combien tu paies aujourd'hui pour ton email et tes fichiers ? »
   - « Laquelle de ces trois briques prendrais-tu en premier ? »
2. **Montrer deux pages de prix**, M3 présenté en paliers et M1, et demander
   laquelle on comprend en dix secondes.
3. **Les 15 premiers comptes** : mesurer le passage du socle gratuit à
   Communiquer, puis au Pack. Mesurer la part des contacts Shotgun qui sont
   vraiment joignables, ce qui pèse sur l'intérêt de l'email.
4. **Revoir les prix au bout de 90 jours.** Les premiers comptes gardent leur
   prix ; seuls les nouveaux voient la nouvelle grille.

---

## 8. Ce qu'on garde des modèles écartés

- **M5 (au billet)** : le volume de billets est un bon repère pour **chiffrer
  une offre Réseau** sur devis, mais pas pour facturer.
- **M6 (au résultat)** : une **garantie** comme argument de lancement. « Si,
  après 90 jours et au moins quatre campagnes envoyées, aucune vente n'est
  attribuée à Yuno, on rembourse Communiquer. » Coût faible, confiance forte.
- **M4 (à l'usage)** : il survit dans les recharges. Au-delà de l'inclus, on
  paie ce qu'on envoie.
- **M2 (à la carte)** : si les entretiens montrent qu'une brique est souvent
  prise seule (Meta, par exemple), on la sort en module à part. On garde la
  porte ouverte sans imposer sept choix à tout le monde.
