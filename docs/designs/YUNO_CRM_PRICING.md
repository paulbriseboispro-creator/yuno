# Pricing Yuno CRM — six modèles comparés

> Analyse du 2026-10-02, à la demande de Paul. Il trouvait la première grille
> (paliers tout compris) à revoir, et pose deux idées :
>
> 1. un **abonnement par fonctionnalité** ;
> 2. des **crédits email et SMS de base** dans chaque abonnement, qu'on augmente
>    au besoin.
>
> **Statut : décidé le 02/10 au soir, voir la première section.** Les sections
> suivantes (étude de 16 h, révision, premier verdict, six modèles) restent pour
> l'historique du raisonnement. Plan produit : `docs/designs/YUNO_CRM_PLAN.md`.

---

## Décision du 02/10 (soir) : un abonnement à 29 €, et les néons

> **Statut : décidé par Paul.** Le prix de l'abonnement est fixé. Le tarif des
> néons est une base de travail proposée, que Paul ajustera à ses coûts réels
> (fournisseur SMS, WhatsApp). Le nom « néons » est une proposition à valider.
> Cette décision remplace la grille 49 / 129 / 249 de la « Révision ».
> **Stripe est prêt** (créé en live le 02/10, voir « Stripe » plus bas). **Le
> code n'est pas encore changé** : c'est le lot 4b du plan.

### Ce que Paul a décidé

- **Abonnement + crédits**, sur le modèle de Laylo (étude de 16 h plus bas).
- **Un seul abonnement, 29 € HT par mois au lancement.** Il passera à 39 € plus
  tard, pour les nouveaux comptes.
- **Pas de compte gratuit.** Une période d'essai à la place.
- **Les crédits ont un nom, un dessin et un univers Yuno**, comme une monnaie.
  Ils ne s'appellent pas « crédits ».

### Les réponses aux questions de Paul

**1. Des crédits chaque mois, ou d'un coup à l'annuel comme Laylo ?** Les deux.

- **Chaque abonné reçoit 10 000 néons par mois, mensuel compris.** C'est 10 000
  emails, ou deux campagnes à une base de 5 000 personnes.
- Ces néons **s'éteignent** à l'échéance, sans report.
- **L'annuel ajoute un bonus versé d'un coup** : 30 000 néons, valables 12 mois.
- Pourquoi ne pas faire comme Laylo, qui ne donne rien au mois :
  - La crainte de Paul, c'est le client qui ne prend le CRM que pour la donnée.
    Le seul remède, c'est qu'il envoie. Des néons qui s'éteignent chaque mois lui
    donnent une raison d'ouvrir l'outil chaque mois.
  - Sans néon inclus, un abonné mensuel devrait acheter avant son premier
    envoi. C'est le compteur qui freine.
  - Ça coûte peu : 10 000 emails coûtent 9 € au pire, et la plupart des comptes
    n'utiliseront pas tout.
  - Laylo s'en passe parce que son email paraît gratuit et que ses clients se
    servent seuls. Nos pros doivent voir un résultat dès leur première soirée.

**2. L'annuel : une remise ou des néons ?** Des néons, sans remise.

- 12 × 29 € = 348 € HT, plus 30 000 néons offerts d'un coup, soit 60 € de valeur
  au tarif de base.
- Le client voit l'équivalent de deux mois offerts. Yuno paie au plus 27 €
  d'envoi, si tout part en emails.
- Ces néons font envoyer, ce qu'une remise ne fait pas.
- La règle de la Suite « l'annuel coûte dix mois » ne s'applique pas au CRM.

**3. 29 € au lancement, puis 39 €.** Oui, avec deux règles.

- **Le prix de lancement est garanti tant que l'abonnement reste actif.** Un
  compte qui résilie puis revient paie le prix du jour. C'est l'argument qui
  fait signer pendant le lancement. Tant que les comptes sont peu nombreux, il
  coûte peu.
- **Le passage à 39 € est annoncé à l'avance**, sur la landing et dans la
  Console. Proposé : au 50e compte payant.
- Pas de « 39 € » barré à côté de 29 € avant que 39 € ait été pratiqué : un prix
  barré doit être un prix réel.
- Le « prix fondateur » de l'ancienne grille (15 comptes) disparaît. Le prix de
  lancement le remplace.

**4. 14 jours gratuits, ou 2 mois à 1 € ?** 14 jours, sans carte.

- Ce qui fait peur aux pros, c'est le changement (étude). Demander une carte
  avant qu'ils aient vu leur base, c'est les perdre au moment où ils hésitent.
- La valeur se voit en quelques minutes. Dès la connexion de Shotgun, la base,
  les segments et les bilans des soirées passées apparaissent. 14 jours couvrent
  deux soirées d'un organisateur hebdomadaire.
- Les 2 mois à 1 € cumulent les défauts :
  - la carte demandée à l'entrée ;
  - un prix de 1 € dans la tête du client, juste avant que le prix monte ;
  - deux mois sans savoir s'il paiera ;
  - Stripe prend 27 % d'un euro.
- **L'essai donne tout le socle et 5 000 néons**, soit une campagne à sa base.
  Pas 10 000 : un essai sans carte est la porte d'entrée des fichiers achetés.
- Pour un prospect rencontré en vrai, Paul prolonge l'essai depuis le super
  admin (l'offre accordée à la main existe déjà).
- **À la fin de l'essai sans abonnement, le compte passe en pause** :
  - la base et les bilans restent lisibles ;
  - la synchro s'arrête, rien ne part, les automatisations s'éteignent ;
  - l'export de la base entière reste possible, c'est sa donnée ;
  - un abonnement rallume tout.
- Un compte en pause n'est pas un compte gratuit. Il ne coûte rien à servir (pas
  de synchro), et sa base vieillit chaque jour : c'est sa raison de revenir.

### Le socle à 29 €

Tout ce qui fait envoyer est dans le socle. Dans un modèle à crédits, brider une
fonction qui fait envoyer, c'est brider son propre revenu (étude de 16 h).

- Synchro Shotgun toutes les 15 minutes, et fichiers des autres billetteries.
- Base unifiée, segments Yuno, RFM, bilans de soirée, rythme J-N comparé,
  attribution des ventes.
- Email Studio, modèles, toutes les automatisations, test A/B, renvoi aux
  non-ouvreurs.
- Audiences et publicités Meta, 0 % sur le budget.
- Assistant IA.
- Équipe sans limite de membres.
- **10 000 néons par mois.**

### Les néons : la monnaie de Yuno CRM

**Une seule monnaie pour tous les canaux. 1 néon = 1 email.**

| Canal | Néons | Prix au tarif de base | Coût pour Yuno | Marge |
|---|---|---|---|---|
| Email | 1 | 0,2 c€ | 0,09 c€ (Resend) | ~55 % |
| DM Instagram (à construire) | 10 | 2 c€ | 0 (Meta ne facture pas l'API) | ~100 % |
| SMS France, par segment de 160 caractères | 40 | 8 c€ | 3,5 à 4,5 c€ (routeur français) ; 7,3 c€ chez Twilio | ~50 % (~10 % chez Twilio) |
| SMS autres pays | coût du fournisseur × 2, arrondi aux 5 néons, 40 au minimum | | | ~50 % |
| WhatsApp marketing France (plus tard) | 100 | 20 c€ | ~13 c€ chez Meta (0,143 $), plus le fournisseur | ~35 % |

L'email doit sembler gratuit ; la marge se prend sur les canaux premium.

**Ce qui ne coûte jamais de néons :**

- un envoi de test ;
- un contact écarté par les règles d'envoi Yuno (pression, fatigue,
  désabonnement) ;
- un envoi refusé par le fournisseur, rendu comme le SMS aujourd'hui ;
- l'assistant IA (environ 0,3 c€ par question). Un assistant au compteur, on ne
  lui pose plus de questions ;
- la synchro, les imports, les segments, les bilans, les audiences Meta.

Un email accepté par le fournisseur puis rebondi a été envoyé : il est décompté.

**Les recharges**, au-delà des néons du mois :

| Pack | Prix HT | Néons | Prix des 1 000 |
|---|---|---|---|
| Tube | 10 € | 5 000 | 2,00 € |
| Enseigne | 25 € | 12 500 | 2,00 € |
| Façade | 50 € | 27 500 (+10 %) | 1,82 € |
| Boulevard | 100 € | 57 500 (+15 %) | 1,74 € |

- **Durées de vie** : néons du mois jusqu'à l'échéance ; bonus annuel et néons
  achetés, 12 mois ; néons d'essai, jusqu'à la fin de l'essai.
- On dépense toujours d'abord ceux qui s'éteignent le plus tôt.
- **Recharge automatique** (« Toujours allumé »), facultative, proposée au
  premier achat. Quand le solde passe sous 2 000 néons, Yuno achète le pack
  choisi, dans un plafond mensuel fixé par le pro. Jamais allumée par défaut :
  une dépense que le pro n'a pas vue venir coûte plus qu'elle ne rapporte.
- **Un envoi n'est jamais coupé à moitié sans le dire.** Si le solde s'épuise en
  route, la campagne se met « en attente de néons », le pro est prévenu, et elle
  repart à la recharge. C'est déjà la règle du quota email.
- **La preuve en euros à côté du solde** : « Tes 18 € de néons de septembre ont
  été suivis de 2 340 € de billets ». L'attribution clic → achat sous 72 h existe.

**Options mensuelles**, pour ce qui a un coût fixe :

- domaine d'envoi à ta marque : 9 € par mois ;
- numéro WhatsApp : à chiffrer quand le fournisseur sera choisi ;
- Réseau (plusieurs espaces) : sur devis. Base proposée : le socle par espace,
  avec des néons partagés.

### Les chiffres

Mêmes profils et mêmes coûts que la section 1, avec le SMS au futur fournisseur
(4 c€). Prix au tarif de base, sans bonus de pack. Montants en € HT par mois.

| Profil | Néons / mois | Prix à 29 € | Marge | Prix à 39 € | Marge | Ancienne grille (prix · marge) |
|---|---|---|---|---|---|---|
| A Asso saisonnière (4 000 emails) | 4 000 | 29 | 20 | 39 | 29 | 49 · 39 |
| B Orga hebdo (45 000 emails, 300 SMS) | 57 000 | 123 | 62 | 133 | 72 | 133,50 · 73 |
| C Club (70 000 emails, 1 000 SMS) | 110 000 | 229 | 115 | 239 | 125 | 216,50 · 104 |
| D Festival (60 000 emails, 1 500 SMS) | 120 000 | 249 | 124 | 259 | 134 | 251,50 · 127 |
| E Veut seulement la donnée | 0 | 29 | 23 | 39 | 33 | 129 · 121 |

**Comment le lire :**

- Sur ceux qui envoient (B, C, D), le socle + néons rapporte autant que
  l'ancienne grille, à quelques euros près.
- Il rapporte moins sur ceux qui n'envoient pas (A, E). C'est le prix d'une
  entrée à 29 €. Le profil E passe de 121 € à 23 € de marge : c'est exactement
  la crainte de Paul.
- **Tout le pari est que le produit fasse envoyer.** Les priorités produit après
  la facturation sont donc celles de l'étude de 16 h (« Faire du CRM un outil de
  marketing ») :
  - automatisations prêtes à la connexion de Shotgun ;
  - « Écrire à ces gens » sous chaque chiffre ;
  - une annonce prête à chaque nouvelle soirée Shotgun ;
  - la preuve en euros à côté du solde.

**Le pire cas pour Yuno :**

- Un abonné qui dépense ses 10 000 néons du mois en emails coûte 9 € d'envoi,
  5 € de fixe et 0,89 € de Stripe. Il reste 14 € (48 %) à 29 €.
- En SMS chez Twilio, il ne resterait que 5 € (17 %). D'où la règle : **le SMS
  n'ouvre qu'avec le nouveau fournisseur.** Au futur fournisseur, il reste 13 €
  (45 %).
- Un essai coûte au plus 4,50 € d'envoi et environ 2 € de fixe.

### L'univers des néons (proposition)

**Pourquoi « néons » :**

- C'est la lumière de la nuit : l'enseigne qui dit « c'est ici, c'est ce soir ».
  Un message fait la même chose, il donne envie de venir.
- Le dessin existe déjà : un tube rouge Yuno (`#E8192C`) qui brille sur le noir
  (`#0A0A0A`).
- Les verbes expliquent les règles sans les écrire. On **recharge** ; les néons
  du mois **s'éteignent** à l'échéance ; un solde bas **faiblit**.
- Le mot est le même en français, en anglais et en espagnol : néons, neons,
  neones.
- Ni « crédits » (générique), ni « tokens » (crypto, IA).

**Les mots** (à traduire dans les trois langues au lot 4b) :

| Moment | Texte |
|---|---|
| Solde | « 12 400 néons » |
| Néons du mois | « Tes 10 000 néons du mois s'éteignent le 14 nov. » |
| Solde bas | « Tes néons faiblissent : 1 800 restants » |
| Coût d'une campagne | « Cette campagne utilise 8 240 néons » |
| Recharge | « Recharger » ; packs Tube, Enseigne, Façade, Boulevard |
| Recharge automatique | « Toujours allumé » |
| Annuel | « 30 000 néons offerts d'un coup » |
| Essai | « 5 000 néons pour ta première campagne » |
| Envoi en pause | « En attente de néons » |
| Preuve | « 18 € de néons → 2 340 € de billets » |

La métaphore reste légère : un écran qui parle d'argent dit d'abord les chiffres.

**Le dessin :**

- L'icône est une capsule, un tube à bouts arrondis, en trait rouge avec un
  halo.
- Jamais de lettre ni de symbole monétaire : un Y barré se lirait comme le yen.
- Le solde s'écrit en chiffres tabulaires, la capsule à sa gauche.
- Animation : à la recharge, le tube s'allume (deux clignotements, puis fixe) ;
  un solde bas clignote lentement. Rien quand « réduire les animations » est
  activé.
- Dans le thème clair de la Console, le rouge reste le même et le halo se réduit.

**Les pistes écartées :**

- **Watts**, la puissance du son : bel univers, mais moins de verbes utiles.
- **Jetons** : clair, mais c'est le mot de tous les festivals cashless, sans
  marque.
- **Yunos** : marque forte, comme les Robux. Mais « 40 Yunos » mélange la
  monnaie et le nom de l'app.

### Ce qui change dans le code (lot 4b, rien n'est fait)

| Pièce | Aujourd'hui | Après |
|---|---|---|
| `crmPlans.ts` ⇄ `crm_plan_limits()` | 4 offres (`free`, `essential`, `pro`, `business`), quotas d'emails, d'automatisations, de membres | une offre unique (29 € au lancement, 39 € ensuite) et l'état « en pause » ; plus de limite d'automatisations, d'A/B ni de membres |
| `crm_effective_plan()` | essai = Pro ; abonnement = son offre ; sinon Gratuit | essai ou abonnement actif / en retard = le socle ; sinon **en pause** (pas de synchro, pas d'envoi ; lecture et export de la base) |
| Solde | email : `email_sender_state` (inclus + acheté) ; SMS : `sms_credit_balances` à part | un portefeuille de néons par portée, avec un grand livre par lot daté (du mois, bonus annuel, achetés, essai), dépensé du lot qui s'éteint le plus tôt au plus tard ; tarif par canal et par pays dans une table |
| Débit | quota email à l'envoi (`consume_email_send_quota`), SMS débité avant Twilio | aux mêmes endroits, en néons, pour les comptes CRM seulement |
| Stripe | `crm_checkout` cherche `yuno_crm_<offre>_<month\|year>[_founder]`, qui n'existent pas (il répond `billing_not_configured`) | ✅ prix créés le 02/10 (section suivante) ; `crm_checkout` à réécrire sur `yuno_crm_base_*_launch` ; packs par `yuno_crm_pack_*` ; recharge automatique hors session |
| Page Abonnement | 4 cartes d'offre | le socle, le solde de néons, l'historique, la preuve en euros, les recharges |
| Aide (`ohelp.crm.billing.*`), assistant (`owner-assistant`), landing `/crm` | grille 49 / 129 / 249 | socle à 29 € + néons |
| `scripts/stripe/create-crm-prices.mjs` | ✅ réécrit sur la nouvelle grille (mêmes clés, idempotent), pour recréer ailleurs | — |

### Stripe : ce qui existe en live (créé le 02/10 par le MCP Stripe)

Compte « Yuno 360 » (`acct_1SfNAdJxVnBQh5Ch`). Tous les prix sont HT
(`tax_behavior: exclusive`, code fiscal `txcd_10000000`) et portent
`metadata.yuno_product = crm`.

| Objet | Lookup key | Montant | État | ID |
|---|---|---|---|---|
| Produit « Yuno CRM » | — | — | actif, prix par défaut = mensuel lancement | `prod_VMukEsbyOEk3lk` |
| Mensuel, lancement | `yuno_crm_base_month_launch` | 29 € / mois | **actif** | `price_1UMAvYJxVnBQh5ChrCl3rbad` |
| Annuel, lancement (+30 000 néons) | `yuno_crm_base_year_launch` | 348 € / an | **actif** | `price_1UMAvZJxVnBQh5ChuLn2ZnKE` |
| Mensuel, public | `yuno_crm_base_month_public` | 39 € / mois | inactif | `price_1UMAvbJxVnBQh5ChbnaVSnqw` |
| Annuel, public (+30 000 néons) | `yuno_crm_base_year_public` | 468 € / an | inactif | `price_1UMAvcJxVnBQh5ChcETx0d7E` |
| Pack Tube, 5 000 néons | `yuno_crm_pack_5000` | 10 € | actif | `price_1UMAwHJxVnBQh5ChwZDHR7Wp` (`prod_VMulX84Kdeu6Ii`) |
| Pack Enseigne, 12 500 néons | `yuno_crm_pack_12500` | 25 € | actif | `price_1UMAwKJxVnBQh5ChbuNwZxpp` (`prod_VMulZujMxx9dlP`) |
| Pack Façade, 27 500 néons | `yuno_crm_pack_27500` | 50 € | actif | `price_1UMAwMJxVnBQh5Cht6jtuo5D` (`prod_VMuluGeVMdrOyx`) |
| Pack Boulevard, 57 500 néons | `yuno_crm_pack_57500` | 100 € | actif | `price_1UMAwNJxVnBQh5ChOkpvoJwJ` (`prod_VMulG9EJSsM9Co`) |

- Les néons se lisent dans les métadonnées : `neons_monthly` et
  `neons_annual_bonus` sur l'abonnement, `neons` et `bonus_pct` sur les packs.
  Le webhook créditera le portefeuille à partir d'elles (lot 4b).
- **Le jour du passage à 39 €** : activer les deux prix `…_public`, désactiver
  les `…_launch`. Les abonnés au prix de lancement le gardent : Stripe ne change
  jamais le prix d'un abonnement existant.
- Rien n'est vendable tant que le code n'appelle pas ces clés : un prix actif
  sans checkout qui le vise ne fait rien.
- Le nom « néons » apparaît dans les noms de produits et les descriptions (vus
  sur le reçu). Si Paul choisit un autre nom, on renomme les produits ; les
  lookup keys, neutres, ne changent pas.
- L'essai de 14 jours ne passe pas par Stripe : il vit dans `crm_subscriptions`,
  sans carte.

**La Suite ne change pas.** Yuno Billetterie garde ses 15 000 emails offerts par
mois et ses recharges au prix coûtant : Yuno ne marge pas sur un client qui vend
avec lui. Faire des néons la monnaie des deux produits est une question pour
plus tard.

### Reste à trancher

1. Le nom de la monnaie (« néons » proposé).
2. Le moment du passage à 39 € (proposé : au 50e compte payant).
3. Le tarif SMS une fois le fournisseur choisi (40 néons en France supposent
   environ 4 c€ d'achat).
4. Combien de temps une base en pause reste gardée. À aligner sur le DPA ;
   proposé : 90 jours, avec l'export proposé et deux emails de préavis.
5. Le prix de l'offre Réseau par espace.

---

## Étude du 02/10 (16 h) : socle bas + crédits à l'usage, le modèle Laylo

> Paul a montré la page de prix de Laylo : un abonnement fixe bas, puis des
> crédits de messagerie payés à l'usage. Son idée : un coût fixe bas pour le
> client, et la marge sur ce qu'il utilise vraiment. Sa réserve : si un client
> ne prend le CRM que pour la donnée, on ne marge presque rien. Il faut donc
> qu'il s'en serve pour son marketing.
>
> **Statut : étude.** Le prix des crédits se fixe plus tard, avec Paul :
> - un nouveau fournisseur SMS moins cher est à trouver ;
> - WhatsApp et Instagram ne sont pas encore branchés.
>
> Les montants de cette section servent à raisonner, pas à publier. Rien n'est
> changé dans le produit.

### Ce que fait Laylo

Relevé sur laylo.com/pricing le 02/10. La page affiche en livres. Le curseur
des crédits est en dollars : 10 $ = 7,57 £.

- **Un seul plan Pro** à 18,93 £ par mois, soit 25 $. Il coûte le même prix au
  mois et à l'année.
  - L'annuel ne fait pas de remise. Il **offre 25 000 crédits** (37,85 £, soit
    50 $) « pour démarrer ».
- **Une messagerie prépayée, de 10 $ à 1 000 $.**
  - Le prix est strictement linéaire : 2 $ les 1 000 crédits, sans remise de
    volume.
  - Vérifié au curseur : 5 000 crédits = 7,57 £, 75 000 = 113,53 £, 500 000 =
    756,86 £.
- **Une grille en crédits par canal :**

  | Canal | Crédits | Prix unitaire |
  |---|---|---|
  | Email | 1 | 0,2 c$ |
  | DM Instagram | 10 | 2 c$ |
  | SMS États-Unis | 10 par segment | 2 c$ |
  | MMS | 20 | 4 c$ |
  | SMS international et WhatsApp | 25 par segment | 5 c$ |

- **Ce qui a un coût fixe se vend en option mensuelle :**
  - commentaires Instagram : 11,36 £ (15 $) par mois ;
  - numéro WhatsApp : 340,59 £ (450 $) par mois ;
  - messagerie vocale : 529,81 £ (700 $), une fois.
- **Entreprise** : 25 $ par compte, 3 comptes minimum, plus les crédits.

### Pourquoi c'est fort

1. **Il n'y a pas de frein à l'entrée.** À 25 $, un organisateur décide seul,
   sans en parler à un associé.
2. **Le revenu grandit avec la base du client, sans rien renégocier.** Chaque
   soirée Shotgun ajoute des acheteurs, donc des envois. C'est le revenu
   d'expansion des outils à l'usage (Twilio, Klaviyo) : un client paie plus
   l'an 2 que l'an 1 sans changer d'offre.
3. **La facture suit la valeur reçue.** Un gros club paie plus qu'une
   association parce qu'il touche plus de monde, pas parce qu'on l'a rangé dans
   un palier.
4. **Une seule monnaie pour tous les canaux.** Brancher WhatsApp ou Instagram
   ajoute une ligne au tableau. Ça ne crée pas un nouveau forfait.
5. **L'annuel offre des crédits au lieu d'une remise.** Une remise de deux mois
   coûte deux mois de prix. Des crédits offerts ne coûtent que leur coût
   d'envoi : Laylo offre 50 $ de valeur qui lui coûtent bien moins. En plus, ils
   font envoyer, donc ils créent l'habitude.

### Ce qui ne se transpose pas tel quel

1. **Le tarif international de Laylo perdrait de l'argent en France.**
   - 25 crédits valent 5 c$ par segment.
   - Un SMS vers la France coûte entre 3,5 et 4,5 c€ HT chez les routeurs
     français à volume : SMSFactor, Octopush, smsmode.
   - Il coûte 7,3 c€ chez Twilio, notre fournisseur actuel.
   - Un WhatsApp marketing vers la France coûte environ 0,14 $ à Meta.
   - Laylo est américain : son tarif international est une moyenne. Chez Yuno,
     il faut **un tarif par canal et par pays**, en crédits, calé sur le coût
     réel.
2. **Un compteur qui tourne freine l'envoi.** C'est pour ça que le modèle « à
   l'usage, sans abonnement » (M4) a été écarté plus bas. Laylo s'en sort parce
   que l'email y paraît gratuit (0,2 c$) et parce que l'annuel donne des crédits
   d'avance. Règle à garder : **l'email doit sembler gratuit, la marge se prend
   sur les canaux premium** (SMS, WhatsApp, DM Instagram).
3. **Un client qui ne veut que la donnée ne rapporte que le socle.** La crainte
   de Paul est fondée. Avec un socle à 39 €, un compte qui ne fait que lire ses
   bilans rapporte 33 € de marge par mois. En Pro à 129 €, il en rapportait 121 €
   (profil E ci-dessous).

### Les chiffres (hypothèses de travail)

**Les hypothèses du socle :**

- 39 € HT par mois, avec 10 000 crédits inclus ;
- 1 crédit = 1 email ;
- 2 € HT les 1 000 crédits (Laylo : 2 $) ;
- 1 SMS France = 50 crédits, soit 0,10 €.

**Les coûts :**

- email : 0,90 € les 1 000 (Resend, palier actuel) ;
- SMS : 0,04 € avec le futur fournisseur, pour les deux colonnes ;
- 5 € de fixe par compte ;
- Stripe : 2,2 % + 0,25 €.

Les profils A à E sont ceux de la section 1.1.

| Profil | Grille 49 / 129 / 249 : prix | sa marge | Socle 39 € + crédits : prix | sa marge |
|---|---|---|---|---|
| A Asso saisonnière (4 000 emails) | 49 € | 39 € | 39 € | 29 € |
| B Orga hebdo (45 000 emails, 300 SMS) | 133,50 € | 73 € | 139 € | 78 € |
| C Club (70 000 emails, 1 000 SMS) | 216,50 € | 104 € | 259 € | **145 €** |
| D Festival (60 000 emails, 1 500 SMS) | 251,50 € | 127 € | 289 € | **163 €** |
| E Veut seulement la donnée et Meta | 129 € | **121 €** | 39 € | 33 € |

**Comment le lire :**

- Le socle + crédits gagne sur ceux qui envoient beaucoup : +36 à +41 € de
  marge par mois sur C et D, +5 € sur B.
- Il perd sur ceux qui n'envoient pas : E perd 88 €, A perd 10 €.
- **Le modèle est meilleur si, et seulement si, le produit fait envoyer.**
  C'est exactement l'intuition de Paul.

Deux choses jouent en faveur des crédits avec le temps :

- **Le coût de l'email baisse avec le volume.** Resend Scale descend à 0,46 $
  les 1 000 à 2,5 M d'emails par mois. Amazon SES coûte 0,10 $ les 1 000. Vendu
  2 € les 1 000, l'email passe de ~55 % à plus de 90 % de marge. Avec les
  paliers, les emails au-delà de l'inclus sont vendus à prix coûtant : cette
  baisse ne rapporte rien de plus.
- **Le DM Instagram ne coûte rien à l'envoi.** Meta ne facture pas l'API de
  messagerie. C'est un canal à presque 100 % de marge, et c'est le plus naturel
  pour la nuit.

### L'avis

**Oui au modèle socle + crédits, mais pas le socle à 25 $ de Laylo.**

1. **Un socle qui paie la donnée**, entre 29 et 49 € HT. Rien n'est réservé à
   l'abonnement le plus cher :
   - la synchro Shotgun toutes les 15 minutes, la base unifiée, le RFM, les
     bilans de soirée et l'attribution ont de la valeur à eux seuls ;
   - servir un compte coûte environ 5 € par mois, plus le temps de support ;
   - sous 29 €, un compte « donnée seule » rapporte à peine plus que ce qu'il
     coûte.
2. **Tout ce qui fait envoyer est dans le socle :** automatisations, A/B,
   renvoi aux non-ouvreurs, segments, équipe. C'est l'inverse des paliers.
   **Dans un modèle à crédits, brider une fonction qui fait envoyer, c'est
   brider son propre revenu.** Les paliers Essentiel / Pro / Business
   disparaissent. Il reste :
   - **Gratuit** : la donnée, synchro quotidienne, quelques crédits ;
   - **Pro** : le socle ;
   - **Réseau** : un prix par compte, comme l'offre Entreprise de Laylo.
3. **Des crédits inclus chaque mois, qui expirent à l'échéance.**
   - Assez pour deux campagnes à sa base : c'est ce qui transforme un client
     « donnée » en client « marketing ».
   - Les crédits achetés restent valables 12 mois.
   - Recharge automatique proposée, avec un plafond fixé par le pro.
4. **Une monnaie unique, avec un tableau par canal et par pays** comme celui de
   Laylo.
   - Ça revient sur la position plus bas (« email et SMS comptés séparément »).
     À deux canaux, deux compteurs se lisaient bien. À quatre ou cinq canaux,
     quatre ou cinq soldes ne se lisent plus. Le tableau de conversion règle la
     question de la clarté.
5. **Ce qui a un coût fixe se vend en option mensuelle**, comme chez Laylo :
   numéro WhatsApp, expéditeur SMS dédié, domaine d'envoi à ta marque.
6. **L'annuel offre des crédits**, pas deux mois gratuits (voir plus haut).
7. **Les règles d'envoi ne bougent pas.** La politique d'envoi Yuno plafonne la
   pression par personne (3 emails / 24 h, 8 / 7 jours en campagne). Elle
   protège la délivrabilité de tous, et elle borne aussi le revenu par contact.
   Ces deux effets sont voulus.

### Faire du CRM un outil de marketing, pas un tableau de bord

Les leviers, du plus fort au plus faible.

1. **Les automatisations sont prêtes à la connexion de Shotgun.**
   - Aujourd'hui, les six recettes adaptées à une billetterie connectée
     existent. Elles sont éteintes par défaut, et seulement suggérées.
   - À faire : un écran de démarrage qui dit « Yuno a préparé 4 envois pour ta
     prochaine soirée », avec deux boutons, Garder et Ajuster. La validation du
     pro reste explicite.
   - C'est le levier qui pèse le plus : on consomme sans effort.
   - Ordre de grandeur pour un organisateur hebdomadaire à 11 000 contacts :
     - l'annonce, puis le dernier appel aux non-acheteurs ;
     - le merci et le « on t'a manqué » ;
     - les habitués qui décrochent.
     - Total : 60 000 à 90 000 crédits par mois. La politique d'envoi plafonne
       à 3 automatisations par personne et par semaine.
2. **Chaque chiffre finit par un bouton « Écrire à ces gens ».** Cela vaut pour
   le bilan de soirée, les segments RFM, les habitués qui décrochent et les
   acheteurs de l'an dernier pas encore revenus. Un insight sans action ne
   consomme rien.
3. **La preuve en euros, là où on achète les crédits.**
   - L'attribution clic → achat Shotgun sous 72 h existe déjà (lot 2b).
   - À faire : l'afficher sur l'écran du solde et de la recharge, par exemple
     « Tes 18 € de crédits de septembre ont été suivis de 2 340 € de billets ».
   - Le crédit cesse d'être un coût pour devenir un investissement, comme une
     pub Meta.
4. **Une annonce prête à chaque nouvelle soirée Shotgun.**
   - La synchro voit passer la soirée.
   - Le brouillon est monté depuis le modèle, avec les tarifs en direct.
   - Le pro reçoit « Ton annonce est prête » : un clic pour l'envoyer.
5. **Le DM Instagram, le canal de la nuit.**
   - Le pro publie « Commente LISTE et reçois le lien », et le DM part tout seul.
   - Règles Meta :
     - l'automatisation part d'une action du fan ;
     - un seul message privé par commentaire, sous 7 jours ;
     - ensuite, une fenêtre de 24 h s'ouvre si le fan répond.
   - Coût d'envoi nul, donc marge maximale.
   - Il faut la permission de messagerie Instagram à l'App Review Meta. Or
     l'accès API de l'app Yuno est bloqué depuis le 22/09 : c'est le préalable.
6. **Le SMS pour l'urgence** : dernier appel, dernières places, ouverture des
   portes. L'outil existe (verrouillé « bientôt »). Il attend le nouveau
   fournisseur.
7. **WhatsApp plus tard**, en canal premium.
   - Environ 0,14 $ par message marketing vers la France.
   - Il faut un fournisseur agréé par Meta, avec son coût fixe.
   - Option mensuelle + crédits.

### Ce que le passage aux crédits changerait (plus tard, rien n'est touché)

| Pièce | Aujourd'hui | Avec les crédits |
|---|---|---|
| `crmPlans.ts` ⇄ `crm_plan_limits` | 4 paliers, quotas d'emails, d'automatisations, de membres | socle + crédits inclus ; limites d'automatisations et d'A/B supprimées |
| Solde | email : `email_sender_state` (inclus + acheté) ; SMS : `sms_credit_balances` à part | un portefeuille de crédits unique avec un journal, et un tarif par canal et par pays |
| Stripe | 4 abonnements × mois/an (script prêt, aucun prix créé) | un abonnement socle, des packs ponctuels, la recharge automatique (moyen de paiement enregistré, paiement hors session) |
| Landing `/crm` | grille 49 / 129 / 249, « recharges à prix coûtant » | socle + tableau des crédits ; la phrase « prix coûtant » disparaît côté CRM (la Suite garde la sienne) |
| Page Abonnement de la Console | 4 cartes | le socle, le solde, l'historique, la preuve en euros, la recharge |

Les créer maintenant serait du travail perdu : il faut d'abord fixer les prix.

### À trancher ensemble

1. Le prix du socle : 29, 39 ou 49 € HT.
2. Les crédits inclus par mois, et ceux offerts à l'annuel.
3. Le prix du crédit, et le tarif par canal et par pays (après le choix du
   fournisseur SMS).
4. Le Gratuit : quelques crédits par mois, ou aucun ?
5. La validité des crédits achetés (12 mois ?), et la recharge automatique
   proposée par défaut ou non.
6. Les 15 comptes fondateurs : un socle garanti, ou des crédits offerts ?

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
