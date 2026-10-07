# Yuno CRM — le score de prédiction : « qui va acheter pour cette soirée ? »

Plan du 7 octobre 2026. Rien n'est codé. Suite de `CRM_CLIENT_ANALYSIS_PLAN.md`
(hypothèses testées, en ligne) et `CRM_ANALYSIS_NEXT_PLAN.md` (« Qui cibler »,
recette 1re soirée).

## 1. Ce qu'on a, ce qui manque

Aujourd'hui Yuno répond à **« qu'est-ce qui se vérifie sur ce compte ? »** :
chaque hypothèse (line-up, concept, genre, achat tôt…) est testée contre le
hasard, au niveau du compte. « Qui cibler » en tire des règles : « a vu un
artiste invité du line-up et n'a pas de place ».

Ce qui manque : **« quelle est la chance que CETTE personne achète pour CETTE
soirée ? »**. Sans ce chiffre, on ne peut pas :

- dire combien de places une audience va rapporter (« ~40 sur 497 ») ;
- classer les clients du plus probable au moins probable ;
- projeter le remplissage d'une soirée à partir de la base connue ;
- éviter d'écrire (et de payer des Yunits) à ceux qui n'achèteront presque
  sûrement pas.

## 2. Le modèle

### 2.1 La question posée

Pour une personne **p déjà venue au moins une fois** et une soirée **X** en
vente : probabilité que p prenne une place pour X avant la soirée.

Les nouveaux (jamais venus) sont hors du modèle : on ne sait rien d'eux. La
projection d'une soirée les compte à part, au rythme des soirées passées
(« + ~60 nouveaux, comme d'habitude »).

### 2.2 Pourquoi une régression logistique, calculée en SQL

- **Lisible** : chaque facteur a un poids qu'on peut montrer et vérifier
  (« avoir déjà vu un invité du line-up multiplie les chances par 2,4 ») ;
  même esprit que les hypothèses, jamais une boîte noire.
- **Robuste aux petites bases** : régularisation L2 ; tient avec quelques
  centaines d'achats.
- **Calculable dans la base, par compte, chaque nuit** : ~10 facteurs, ajustés
  par la méthode de Newton (IRLS, 5 à 8 itérations, chacune = une agrégation
  SQL). Pas de fonction edge (quota atteint), pas de service externe, aucune
  donnée qui sort de la base.
- Écartés : apprentissage automatique « profond » (trop peu de données par
  compte, illisible) ; modèle commun à tous les comptes (interdit tant que la
  clause n'est pas validée, et les publics diffèrent trop).

### 2.3 Les données d'entraînement

Pour chaque soirée passée **X** des 12 derniers mois (hors les 4 plus
récentes, gardées pour la validation) :

- une ligne par personne **déjà venue avant l'ouverture de la vente de X** ;
- étiquette = a acheté une place pour X (vente au sens de
  `_crm_ticket_is_sale`, invitations comprises en option) ;
- tous les achats gardés, les non-achats échantillonnés (20 %, repondérés) :
  sur une base de 12 000 personnes × 50 soirées, ~120 000 lignes.

Les facteurs se calculent avec ce que la personne avait vu **AVANT X**
(jamais le futur), à partir des tables déjà construites par le moteur
(`_ann`, `_ana`, `_anh`, `_anhs`, `crm_artist_stats`) :

| Facteur | Calcul |
|---|---|
| Récence | log(jours depuis sa dernière soirée) |
| Fréquence | nombre de soirées sur 12 mois (log) |
| Fidélité au concept | a déjà fait une édition de la même série |
| Artiste invité | a déjà vu un artiste invité (non résident) du line-up de X |
| Genre | part de ses soirées qui partagent un genre avec X |
| Format, créneau, jour | même format / créneau / jour que sa soirée la plus fréquente |
| Habitude d'achat | achète tôt / dernière minute (classe majoritaire) |
| Distance | habite loin ou à l'étranger (de passage) |
| Canal d'arrivée | arrivé par une découverte Shotgun |
| Saison | X dans un mois de forte affluence du compte |

Un facteur dont la billetterie ne transmet pas la donnée (couverture du
lot A) sort du modèle du compte. Pas de prix ni d'âge pour l'instant
(couverture trop faible, et l'âge ouvre une discussion RGPD inutile).

### 2.4 Valider avant de montrer (la règle qui ne se discute pas)

À chaque entraînement, sur les 4 soirées tenues à l'écart :

1. **Pouvoir de tri (AUC)** ≥ 0,70 ;
2. **Meilleur qu'un modèle naïf** (récence + fréquence seules) d'au moins
   0,02 d'AUC ; sinon les hypothèses n'ajoutent rien et on ne prétend pas le
   contraire ;
3. **Calibration** : par tranches de probabilité, l'écart moyen entre prédit
   et observé ≤ 5 points (ECE ≤ 0,05) ; c'est ce qui permet d'écrire « ~40
   acheteurs » ;
4. **Volume** : au moins 200 achats dans l'entraînement et 50 dans la
   validation.

Un compte qui échoue n'a **pas de score** : l'écran le dit (« pas encore assez
d'historique pour prédire, revenez après N soirées »), comme un « À tester ».
Les métriques sont gardées (`crm_score_model.metrics`) et visibles dans l'Admin CRM.

### 2.5 Le score des soirées à venir

Chaque nuit (cron `crm-analysis-nightly`, après le calcul des profils), pour
chaque soirée à venir en vente : p(personne, soirée) pour toutes les personnes
déjà venues sans place. Stocké dans `crm_person_night_score` (compte, soirée,
personne, probabilité, 3 facteurs principaux). Rafraîchi aussi après chaque
synchro pour retirer ceux qui viennent d'acheter (pas de recalcul du modèle).

## 3. Ce que ça change à l'écran

| Où | Quoi |
|---|---|
| Soirée → « Qui cibler » | Chaque audience : « ≈ 38 acheteurs attendus » (somme des probabilités), triées par acheteurs attendus. Nouvelle audience « Les plus probables » (top 20 % des probabilités) |
| Soirée → « Ventes » | Projection : « Parmi vos clients connus, ≈ 210 places attendues (180 à 240) + ≈ 60 nouveaux au rythme habituel », avec l'avancement réel à côté |
| Fiche client | Selon ta décision (§ 6) : « Chances pour <soirée> : élevées / moyennes / faibles » et les 3 raisons (« a vu Malaa », « fidèle du concept ») |
| Clients / Segments | Filtre et segment « Probables pour <soirée> » (seuil réglable) |
| Envoi d'e-mail / SMS | Option « Écarter les très peu probables » (économie de Yunits), plus tard |
| MCP | `get_event_targets` rend les acheteurs attendus ; nouvel outil de projection ; fiche client avec ses chances |
| Admin CRM | Santé du modèle par compte (AUC, calibration, volume, dernier entraînement) |

Toujours dit comme une **estimation**, jamais une certitude.

## 4. Vie privée et droit

- C'est du **profilage avec évaluation** (critère « scoring » de la CNIL) :
  ajouter la question au dossier `docs/legal/CRM_ANALYSE_CLIENT_REVUE_JURIDIQUE.md`
  (analyse d'impact probablement nécessaire), et une phrase au modèle
  d'information des clients finaux.
- Aucune décision automatique à effet juridique : le pro choisit à qui écrire.
- Le droit d'opposition existant (« Exclure du profilage ») efface aussi les
  scores de la personne.
- Le score reste dans le compte : jamais dans un export, jamais dans
  l'apprentissage commun.

## 5. Lots

| Lot | Contenu | Équipe humaine | Claude Code |
|---|---|---|---|
| S0 | Mesurer les comptes réels : achats, soirées, couverture. **Aujourd'hui, seule la démo est branchée sur Shotgun en prod** : à faire dès que les vrais comptes (WOH…) sont connectés | 1 jour | 30 min |
| S1 | Jeu d'entraînement + modèle naïf de référence, sur le banc PGlite puis la démo | 3 jours | 3 h |
| S2 | Régression logistique L2 en SQL (IRLS), validation, portes (§ 2.4), table `crm_score_model` | 1 semaine | 1 jour |
| S3 | Score des soirées à venir, `crm_person_night_score`, cron, rafraîchissement après synchro | 3 jours | 3 h |
| S4 | Écrans : Qui cibler, projection, fiche client, filtre / segment (3 langues) | 1 semaine | 1 jour |
| S5 | MCP, assistant, aide, Admin CRM, démo, dossier juridique | 3 jours | 3 h |

Le lot S0 peut arrêter le chantier : si les vrais comptes ont trop peu de
retours, le score resterait masqué partout ; on le saura avant de construire.

## 6. Décisions à prendre (Paul)

1. **Le score par personne sur la fiche client** : une étiquette (élevées /
   moyennes / faibles) avec ses raisons, un pourcentage, ou rien (agrégats
   seulement) ?
2. **Le nom à l'écran** : « Chances de venir », « Probabilité d'achat »,
   « Score »… (règle : on en parle avant de l'écrire).
3. **La projection de remplissage** dans le tiroir de la soirée : la montrer
   au pro, ou seulement au super admin le temps de vérifier qu'elle tient ?
4. **Les invitations** comptent-elles comme un « achat » à prédire (guest
   list), ou seulement les ventes ?
