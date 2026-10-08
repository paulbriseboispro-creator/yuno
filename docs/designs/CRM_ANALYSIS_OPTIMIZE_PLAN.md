# Yuno CRM — optimiser l'intelligence d'analyse (plan d'exécution, 2026-10-07)

Exécution de `CRM_ANALYSIS_OPTIMIZE_PROMPT.md`. Branche `crm/analysis-optimize`
(worktree `/Users/paul/Desktop/yuno-crm-optimize.nosync`, partie d'origin/main
e89d28bf). Rien n'est poussé, appliqué en prod ni déployé sans le « go » de
Paul dans la conversation.

## Décisions de Paul (07/10)

| Sujet | Décision |
|---|---|
| Groupe témoin | Oui, **10 % partout** (« Qui cibler » et recettes), tirés au hasard, réglable par compte, désactivable. Libellé choisi par Paul : **« 10 % non contactés, pour mesurer l'effet réel »** |
| Raisons contradictoires | Une raison du score ne s'affiche **jamais** si sa famille d'hypothèse est `not_supported` sur le compte |
| Tests multiples | **Corriger** (Benjamini-Hochberg sur les z + marge anti-bascule) ; « confirmée depuis » seulement après **2 calculs complets consécutifs** |
| Projection de remplissage | Ouverte **automatiquement** à un compte quand son écart moyen à la réalité est **sous 15 % sur ses 8 dernières soirées** (journal du lot 1) |

## Constats de la lecture (07/10)

- Les 3 raisons du score sont déjà les facteurs dont la contribution pousse
  le plus la chance de la personne (`c > 0,15`, triés), mais aucune ne
  consulte `crm_family_status` : la contradiction est possible.
- `crm_first_return_sms_collect` écrit `crm_first_return_sms` dès la création
  du brouillon SMS : une campagne retombée en brouillon faute de Yunits ne
  retente jamais ses destinataires (lot 4).

## Mesures

Banc `scripts/crm-bench` (PGlite, un cœur WebAssembly ; les temps se
comparent entre eux). Comptes synthétiques à vérité cachée : `demo` (~2 500
contacts, 7 400 billets, 29 soirées), `grand` (11 900 / 30 800 / 60), `petit`
(300 / 570 / 10), `hasard` (aucun effet planté).

### Lot 0 — temps, compte « grand » (migration `20261013100000`)

| Fonction | Avant | Après | Cible |
|---|---|---|---|
| `crm_analysis_compute` (complet) | 66,7 s | 9,0 s | < 60 s |
| `crm_score_compute` (1er calcul) | 151 s | 41 s | < 60 s |
| `crm_score_compute` (à chaud) | — | 11 s | |
| `crm_automations` | 126 s | 0,32 s | < 2 s |
| `crm_night_targets` | 1,01 s | 1,03 s | < 1 s (à la limite : `_crm_people_build` 0,69 s) |
| `crm_analysis_overview`, `crm_night_analysis`, `crm_client_analysis`, `crm_artists_analysis` | ≤ 66 ms | inchangé | < 1 s |

Causes trouvées par `pg_stat_statements` (`node run.mjs bench grand`) :

1. « Venu avec un client déjà venu » (`_crm_an_load`) : UPDATE corrélé sans
   index, 56 s → réécrit en ensembles, même règle.
2. Aperçu de la recette 1re soirée (`_first_return_candidates`) : le test
   « a déjà une place » passait sur les 6 775 venus une fois × 4 soirées AVANT
   la fenêtre de dates (129 personnes) → CTE matérialisée. **Sur la prod,
   l'API coupe à 8 s : un vrai gros compte n'aurait pas pu ouvrir l'écran
   Automatisations.**
3. Score : 8 itérations de Newton à ~10 s, les sommes lisant un tableau `xv`
   → une colonne par variable (40 s au 1er calcul), puis départ à chaud
   depuis le modèle d'hier (1 itération). Le départ de l'intercept au taux
   moyen a été ESSAYÉ puis RETIRÉ : aucune itération gagnée.

Preuve que rien ne change : `diff.mjs` sur « grand » avant / après, les 8
tables calculées identiques (11 256 profils, 23 statuts, modèle du score à
6 décimales). Limite : le score de « grand » est `weak`, aucune chance par
personne n'est écrite ; ce chemin n'a pas changé.

Note : un second chronométrage du score après migration a donné 146 s, la
machine étant chargée (moyenne de charge 9,7 : Spotlight, rekordbox) ; le
41 s a été mesuré machine calme. À rechronométrer avant la mise en ligne.

### Constats pour les lots suivants (banc, avant toute modification)

- Le score de `demo` et de `grand` est `weak` : AUC 0,88-0,90 mais gain sur
  les clients actifs +0,011 / +0,017 (porte : +0,02). La vérité cachée du banc
  fait beaucoup dépendre le retour de la récence ; à recalibrer pour le lot 2.
- `launch` « confirmée » sur la démo avec O = 3 pour E = 0,8 (gain 3,75, z 2,5) :
  le cas que vise la correction des tests multiples (lot 3).
- `slot` « pas confirmée » avec z = 6,0 sur « grand » (gain 1,06 < 1,1) : un
  effet réel mais faible, dit « pas confirmée » — le cas du libellé « pas de
  différence nette » (lot 3).

### Lot 1 — mesurer dans le temps (migrations `20261013110000`, `120000`)

**Journal prévu / réel.** Joué au banc sur `demo` (portes du score abaissées
dans la base du banc seulement, le compte synthétique étant `weak`) : 10 117
chances relevées, 4 soirées réglées en 65 ms, lignes par personne effacées
après le règlement.

| Soirée | Moment | Notés | Achats après | Attendus | AUC | Calibration | Projection (acheteurs) |
|---|---|---|---|---|---|---|---|
| Velvet #3 | J-7 | 2 345 | 103 | 196,7 | 0,881 | 4,0 pts | 553 prévus / 461 réels (20 %) |
| Goya #5 | 1re note | 2 501 | 245 | 287,4 | 0,831 | 2,9 pts | 465 / 466 (0,3 %) |
| Ouverture | 1re note | 2 548 | 215 | 229,2 | 0,861 | 1,2 pt | 348 / 378 (7,8 %) |
| Nuit Noire #4 | 1re note | 2 566 | 138 | 188,5 | 0,872 | 2,0 pts | 289 / 223 (29,5 %) |

Constat pour le lot 2 : la calibration PAR PERSONNE tient (1 à 4 points), mais
la somme des chances SURESTIME les acheteurs de 15 à 90 % sur certaines
soirées (audience « achètent tôt » : 45 attendus, 6 réels). C'est la
correction « part des achats encore à venir » (§3 du prompt) : enfin
mesurable, elle est à refaire.

**« 10 % non contactés, pour mesurer l'effet réel ».** Au banc (`holdout`) :
e-mail « Qui cibler » 820 éligibles → 78 non contactés (9,5 %), 742 en file,
742 Yunits débités ; SMS 507 → 60 ; recette « Faire revenir après la 1re
soirée » 53 dues → 5 non contactées, second passage = 0 (idempotent). Test
A/A (au banc, un envoi ne change aucun achat) : z = 0,71, 0,13 et −0,96,
jamais ≥ 2 — la mesure n'invente pas de gain. Matrice de droits
(`security.mjs`) : anon ne voit rien, un autre compte est refusé, le titulaire
règle de 0 à 30 %, 50 % refusé.

**Écrans** (banc visuel local, ordinateur et 390 px, sans débordement) :
Admin CRM › tiroir › « Prévu / réel » (porte, barres prévu / réel, une ligne
par soirée) ; Réglages › Données › la part non contactée ; « Écrire à… »
(« Recevront le message » = contactés seulement, la part non contactée à
côté, coût calculé sur les contactés) ; « Qui cibler » et Automatisations ›
« Ce que vos envois ont vraiment rapporté » ; « Qui cibler » › « Estimation :
≈ N acheteurs au total » quand la porte est ouverte. Alertes
`admin_crm_score_drift` et `admin_crm_analysis_failed` (cette dernière
émise depuis le 07/10 sans libellé ni lien) au catalogue, vers le tiroir du
compte dans l'Admin CRM.

**Corrigé au passage** : « ≈ N places attendues » (`yc.sc.expAll`) disait
places pour une somme de chances PAR PERSONNE ; c'est « acheteurs attendus ».

### Répétition sur la prod (07/10, transaction annulée, rien n'est resté)

Prod = dépôt vérifié pour les 13 fonctions réécrites
(`same-as-prod.mjs --before 20261013100000`), registre à `20261012110000`,
aucune autre requête en cours. `rehearse.mjs` : les trois migrations puis
`smoke/lot01.sql` dans une seule transaction, annulée par `SMOKE_OK`.

| Compte démo (prod) | Avant (07/10) | Répétition |
|---|---|---|
| Analyse complète | 10,9 s | 5,1 s |
| Score | 15,8 s | 4,3 s (3,4 s à chaud) |
| AUC / actifs / calibration | 0,705 / 0,699 / 1,7 pt | 0,7053 / 0,6991 / 1,65 pt (identiques) |
| Journal | — | 10 441 chances relevées, 4 soirées réglées, 5 résultats, lignes effacées |
| Témoin « Qui cibler » (audience « achètent tôt ») | — | 303 éligibles, 24 non contactés, 279 Yunits |

Lectures d'écran seules (`smoke/reads.sql`, trois appels de suite), avant /
avec les migrations : « Qui cibler » 4 296 → 464 → 412 ms / 2 108 → 422 →
407 ms ; Automatisations 3 424 → 2 021 → 575 ms / 1 142 → 558 → 581 ms. Le
premier appel est lent dans les deux cas : cache froid de la machine Nano,
pas les migrations. À chaud, la cible (< 1 s, < 2 s) est tenue.


- ~~Fusionner la branche (front) et redéployer `owner-assistant`~~ : fait le
  07/10 au soir (main 7ad9b597, Workers Builds ; `owner-assistant` v256).
- Lot 2 : voir ci-dessous.

### Lot 2 — un meilleur score, prouvé (migration `20261014100000`, PAS appliquée)

**La surestimation des acheteurs (constat du lot 1), décomposée au banc.**
La calibration par personne tenait sur les soirées tenues à l'écart ; la somme
des chances d'une soirée À VENIR, non. Trois causes, mesurées une à une :

1. *Décalage apprentissage / note.* Le modèle apprend avec ce qu'on savait
   d'une personne à l'ouverture de la vente (dernière venue d'au moins 25
   jours) ; une soirée à venir était notée avec l'historique jusqu'à
   aujourd'hui. Facteurs repris à l'ouverture de la vente : Velvet (J-3)
   179 → 91 attendus pour 81 réels, Goya 285 → 225 pour 225. Ceux venus pour la
   première fois depuis l'ouverture reçoivent le taux observé pour ce cas
   sur les soirées passées du compte (14 % sur `demo`, 5 % sur `grand`).
2. *Part restante par personne* (`p·f / (1 − p·(1 − f))`, f = son historique
   + 2 achats « au rythme du compte »). Rejeu sur les soirées passées de
   `demo` : perte log 0,1672 → 0,1566 (soirées d'apprentissage), 0,1563 →
   0,1451 (tenues à l'écart) ; ceux qui achètent tôt : 825 → 480 attendus pour
   158 réels (la part globale gardait le même f pour tous).
3. *Recalage du niveau* sur les 4 soirées tenues à l'écart : ESSAYÉ puis
   RETIRÉ. Perte log totale sur 4 comptes : 0,35043 sans, 0,35032 niveau seul,
   0,35012 Platt ; le décalage estimé change de signe d'un tirage à l'autre
   (+0,06 / −0,27 / −0,64) : il suit le hasard des 4 soirées.

Journal (`run.mjs journal`, même génération, avant / après la migration) :

| Compte | Attendus / réels avant | Après | Perte log avant | Après |
|---|---|---|---|---|
| `demo` | 1 052 / 798 (+32 %) | 808 / 798 (+1,2 %) | 0,1799 | 0,1757 |
| `grand` | 1 853 / 859 (+116 %) | 1 261 / 859 (+47 %) | 0,0666 | 0,0576 |

Audience « achètent tôt » de Velvet : 35 attendus → 8 (5 réels). Écart de la
projection à J-7 (Velvet) : 18 % → 1,2 %.

**Format des facteurs** (ablation `ablate.mjs`, validation sur les 4 soirées
tenues à l'écart de 4 comptes : `demo` + `grand` tirages 23, 24, 25).
Gardés : « a vu un invité de l'affiche dans les 180 jours » (`artist_recent`)
et « a déjà fait ce concept » oui / non (`series_done`). Ensemble : perte log
meilleure sur les 4 comptes (demo 0,2449 → 0,2420), calibration meilleure sur
les 4 (demo 1,6 → 1,2 pt), AUC des actifs +0,002 sur 3 comptes (−0,0003 sur le
4ᵉ). Refusés : artiste vu oui / non (pire sur `demo`), dernière édition du
concept faite, achat à plusieurs, venu avec un client déjà venu, jour +
créneau, saison (rien ou pire), prix de la soirée contre prix habituel (son
gain sur `demo` vient d'un artefact du générateur : les soirées uniques y sont
5 € plus chères). Pénalité L2 0,3 / 1 / 3 / 10 : aucun écart au 4ᵉ chiffre
(trop de lignes pour qu'elle pèse) ; on garde 1.

Journal des soirées à venir, mêmes comptes, sans / avec les deux facteurs :
perte log 0,1871 → 0,1844 (`demo`), 0,0575 → 0,0567, 0,0525 → 0,0522,
0,0825 → 0,0820 (`grand`) ; excès des acheteurs attendus sur `grand` 46 → 39 %,
49 → 46 %, 10,5 → 9 %.

**A priori de la part restante** (k achats « au rythme du compte ») : 1 gagne
0,1 à 0,3 % de perte log sur 2 bancs, 4 perd autant. On garde 2 : le banc fige
l'habitude d'achat de chacun (tôt / milieu / dernière minute), un vrai public
est moins régulier. À revoir avec le journal du premier vrai compte.

**Raisons** (décision 2) : une raison n'a que les libellés existants
(`_crm_score_reason_key`, deux facteurs du même libellé comptés une fois) et
jamais une famille « pas confirmée » sur le compte. Vérifié sur `demo` : le
créneau est « pas confirmé », 0 raison « créneau » sur 8 891 chances notées.
Les 3 raisons restent celles qui poussent le plus la chance de la personne
(contribution au modèle, par construction).

**Temps** (compte `grand`, banc, machine calme) : 1er calcul du score 41 s →
57,6 s avec les deux facteurs (15 variables : 120 sommes de hessienne par
itération), ramené à 45,6 s en ne recalculant la hessienne qu'aux deux
premières itérations et quand le pas reste grand (mêmes chiffres au 4ᵉ
chiffre). À chaud 14,2 s ; 35,8 s quand il note les soirées à venir (notes +
journal). Départ à chaud par NOM de facteur : la nuit de la mise en ligne
(12 → 14 facteurs) ne repart pas à froid.

**Ce qui reste, et pourquoi.** Sur deux tirages de `grand`, les soirées à
venir restent surestimées (+39 %, +46 %). Les 4 mêmes soirées placées dans le
passé le sont aussi (+21 %, Nuit Blanche ×2) : le modèle rate des effets
propres à une soirée (surtout les soirées uniques). L'écart de plus quand
elles sont à venir (21 → 39 %) n'est pas encore expliqué. Protection en place :
la projection ne s'ouvre au pro qu'avec moins de 15 % d'écart sur 8 soirées
réglées ; les « ≈ acheteurs attendus » par audience de « Qui cibler » ne
passent pas par cette porte (décision à prendre, voir la fin). Et la
projection des NOUVEAUX (moyenne des 8 dernières soirées × part restante des
premiers achats) ignore la tête d'affiche : Goya 82 estimés pour 116 réels —
chantier à part, non commencé.

**Leçon de méthode.** Les 4 soirées tenues à l'écart varient de ±35 % chacune
au banc : un réglage ne se juge que sur plusieurs comptes (`demo` + 3 tirages
de `grand`, `BENCH_PROFILE='{"seed":N}'`).

