# Yuno CRM — prouver que l'analyse client et la prédiction marchent (plan, 2026-10-08)

Suite de `CRM_ANALYSIS_OPTIMIZE_PLAN.md`. Exécution : `CRM_ANALYSIS_PROOF_PROMPT.md`.
Rien n'est poussé sur `main`, appliqué en prod ni déployé sans le « go » de
Paul dans la conversation.

## Pourquoi ce plan

Le système est en ligne et protégé (seuils de qualité, rien d'affiché sans
preuve), mais **il n'est pas prouvé** :

- Tout a été mesuré sur des données fabriquées. Le compte démo `crm@womber.fr`
  porte des effets **plantés** par `scripts/demo/seed-crm-analysis.sql` (fans
  d'une tête d'affiche, acheteurs précoces, groupes) ; le banc
  `scripts/crm-bench` aussi. On sait que le moteur retrouve ce qu'on a caché,
  pas que ces effets existent chez un vrai club.
- Le score passe ses portes de justesse sur la démo (prod, 08/10) : AUC 0,705
  pour un seuil de 0,70 ; sur les clients actifs 0,699 contre 0,674 pour le
  modèle naïf (+0,025 pour un seuil de +0,02) ; vérifié sur 4 soirées.
- **Défaut de méthode trouvé le 08/10** dans le test des hypothèses
  d'affinité (`_crm_an_engine`, dernière version dans
  `20261014110000_crm_hypothesis_fdr.sql`) : la chance « au hasard » d'une
  famille est `p = avg(val)` sur les soirées au choix, donc chaque soirée en
  vente compte autant. Une grosse soirée que tout le monde choisit pèse comme un
  mardi calme. Si les invités qui reviennent jouent justement les grosses
  soirées, le test attribue à l'artiste (ou au genre, au format, à la série) ce
  qui revient au succès de la soirée. Le banc ne le voit pas : dans `gen.mjs`,
  la popularité d'une soirée n'agit que sur les NOUVEAUX venus
  (`headlinerPull`), jamais sur la décision des habitués, et le profil `hasard`
  la coupe (`headlinerPull: 1`).
- Au banc, une soirée à venir reste surestimée (+39 %, +46 % sur deux tirages de
  `grand`). La projection globale attend le journal (`_crm_projection_gate`) ;
  les « ≈ acheteurs attendus » par audience de « Qui cibler » ne l'attendent pas
  (décision ouverte du plan d'optimisation).

## Décisions (proposées par l'agent le 08/10, reprises par Paul en demandant ce plan)

| Sujet | Décision |
|---|---|
| Hasard du test d'affinité | **Pondéré par la popularité de chaque soirée** ; la variante (part des autres acheteurs, ou des nouveaux venus) se choisit au banc sur des critères fixés d'avance (lot 1) |
| Version des règles | La méthode change : **nouvelle version de `crm_analysis_rules`** (v2), l'historique des statuts garde la v1 ; les comptages d'apprentissage sont clés par version (aucun n'existe, le drapeau global est éteint) |
| « ≈ acheteurs attendus » par audience | **Masqués tant que le journal ne les a pas vérifiés** (lot 2) ; l'ordre d'envoi et l'audience « Les plus probables » restent |
| Premier vrai compte | Kevin / WOH, dès qu'il connecte Shotgun (lot 3) |
| Juge final | Le groupe témoin et le journal prévu / réel sur 4 à 8 vraies soirées (lot 4) |

À faire valider par Paul avant le lot 2 : le libellé de l'écran quand les
acheteurs attendus sont masqués (proposition plus bas).

## Lot 1 — un test d'affinité qui ne confond pas « artiste » et « grosse soirée »

**1a. Prouver le défaut au banc, avant de toucher au moteur.**
- `scripts/crm-bench/gen.mjs` : un paramètre `nightPull` (défaut 0) ajouté à la
  décision des HABITUÉS : `x += p.nightPull * n.star` (même `n.star` que pour les
  nouveaux venus : la popularité de l'invité le plus connu de l'affiche). Les
  invités populaires jouent plus souvent (`r.weighted(guests, pop)`), donc
  « artiste déjà vu » et « grosse soirée » vont ensemble : c'est la confusion à
  reproduire.
- `profiles.mjs` : un profil **`populaire`** = `hasard` + `headlinerPull: 1.8`,
  `nightPull: 1.2` (à régler pour que les grosses soirées fassent environ 2 fois
  les petites), aucun effet personnel (`artist`, `concept`, `genre`, `weekday` à 0).
- Mesure attendue AVANT correction : sur `populaire`, la famille `artist` (et
  peut-être `series`, `genre`) sort `supported` alors que rien n'est planté.
  Si ce n'est PAS le cas sur plusieurs tirages (`BENCH_PROFILE='{"seed":…}'`),
  le noter : le défaut est théorique sur ce générateur, et la correction se
  décide sur le lot 3 (vraies données).

**1b. Corriger.** Dans `_crm_an_engine`, la chance d'une famille pour un passage
devient `p = Σ w·val / Σ w` sur les soirées au choix, avec un poids de
popularité `w` par soirée. Deux variantes à comparer :
- **A — part des autres acheteurs** : `w = 1 + acheteurs (ventes) de la soirée,
  la personne exclue` ;
- **B — nouveaux venus** : `w = 1 + nouveaux venus de la soirée` (des gens sans
  historique, donc sans affinité : un indicateur de popularité qui ne contient pas
  l'effet qu'on teste).
O, E, V et z gardent leur forme (`E = Σ p`, `V = Σ p(1 − p)`) ; la p-valeur
exacte, Benjamini-Hochberg, la marge anti-bascule et les 2 jours restent.
Seules les familles d'affinité changent (genre, format, créneau, jour, lieu,
série, artiste) ; comportements et retour à 180 jours n'utilisent pas le tirage.
La méthode se lit dans `crm_analysis_config()` (`affinity_null`:
`uniform` | `popularity_buyers` | `popularity_new`), jamais en dur.

**Critères pour garder une variante** (les écrire dans ce plan avec les mesures) :
1. `populaire` : plus aucune famille d'affinité `supported`, sur 3 tirages ;
2. `hasard` : toujours rien de `supported` ;
3. `demo` et 3 tirages de `grand` : les effets plantés (artiste, concept, genre)
   restent `supported` ; une famille qui tombe en « à tester » est notée comme
   perte de puissance, pas comme échec ;
4. `petit` : reste « à tester » ;
5. temps : le calcul complet de `grand` ne grossit pas de plus de 20 %.
Si aucune variante ne passe les cinq, garder `uniform`, écrire pourquoi, et
trancher au lot 3.

**1c. Mettre en ligne (avec le « go »).** Migration
`2026101xxxxxxx_crm_affinity_weighted.sql` (horodatage vérifié contre
`git fetch origin` + toutes les branches) : réécriture de `_crm_an_engine` depuis
la définition de la PROD (`same-as-prod.mjs --before <version>`), nouvelle ligne
`crm_analysis_rules` v2 active (`affinity_null` choisi), ancienne gardée.
Répéter sur la prod dans une transaction annulée (`rehearse.mjs`) sur le compte
démo : statuts avant / après, temps ; lint `plpgsql_check` dans un DO annulé.
Textes à reprendre (3 langues, module `src/i18n/locales/crm/modules/analysis.ts`) :
tous ceux qui décrivent le hasard comme « les soirées en vente », relevés le
08/10 : `yc.why.famq.{artist,genre,format,slot,weekday,place,series}`,
`yc.why.det.affinity`, `yc.why.h.s`, `yc.why.k.affinity.s`, `yc.why.how.s`,
`yc.faq.why.a`, `yc.faq.whystatus.a` (dire : « un choix au hasard qui tient
compte du succès de chaque soirée ») ; article `crm-what-brings-them` de
`_shared/console-help-articles.ts` (redéployer `owner-assistant`) ; glossaire
`hypothesis_test` de `worker/mcp/guide.ts` (redéployer le Worker avec le
front) ; section « analyse client » de CLAUDE.md. Test des mots interdits :
`src/crm/lib/__tests__/analysis.test.ts`. Le semis
démo se rejoue après (`refresh-crm-demo.sh`, SEUL) : si une famille plantée y
tombe, régler le semis, jamais le moteur.

## Lot 2 — « ≈ acheteurs attendus » seulement quand le journal les a vérifiés

- Lire d'abord ce que le règlement écrit (`_crm_score_settle`,
  `crm_prediction_results.metrics`, `journal-report.mjs`) : existe-t-il un écart
  « attendus contre réels » des seuls clients CONNUS (somme des chances des
  personnes notées contre leurs achats réels), séparé des nouveaux venus ? S'il
  n'existe pas, l'ajouter au règlement (même migration).
- Une porte `_crm_expected_gate(scope)` sur ce modèle de `_crm_projection_gate` :
  ouverte quand l'écart moyen des clients connus est sous
  `score.expected_err_max` (proposé : 15 %) sur les `score.expected_nights`
  dernières soirées (proposé : 4), réglages dans `crm_analysis_config()`.
- `crm_night_targets` (dernière version `20261014130000`) : `expected` par
  audience et `score.expected` rendus seulement si cette porte est ouverte ;
  sinon `null` + `expected_gate: {nights, needed, err}`. L'ORDRE d'envoi
  (`order`) continue d'utiliser les chances en interne ; l'audience « Les plus
  probables » reste.
- Écran « Qui cibler » : à la place du chiffre, une ligne (proposition, à
  valider par Paul) : « Acheteurs attendus : affichés après 4 soirées vérifiées
  (1 sur 4) ». MCP `get_event_targets` et assistant : même règle, même phrase.
- Banc : `node run.mjs journal demo` et `grand` ; vérifier que la porte reste
  fermée tant que l'écart dépasse le seuil, et qu'elle s'ouvre sur un compte où
  le score tient.

## Lot 3 — le premier vrai compte (Kevin / WOH)

Préalable : Kevin connecte Shotgun dans la Console CRM et accepte les
Conditions (fenêtre `CrmLegalGate`, PR paulbriseboispro-creator/yuno#14). Ensuite, en LECTURE SEULE et une
requête à la fois (`node prod.mjs --activity` avant chaque calcul lourd) :

1. **Couverture** : requêtes de l'annexe de `CRM_CLIENT_ANALYSIS_PLAN.md`
   (commandes à plusieurs, line-up, genres, canaux, scans, codes postaux,
   dates de mise en vente), `crm_analysis_state.coverage`.
2. **Le tirage sur de vraies données** : dans une transaction annulée, calculer
   les statuts des familles avec `uniform` ET avec la variante du lot 1 ; noter
   pour chaque famille O, E, gain, z dans les deux cas. L'écart entre les deux
   EST la mesure de la confusion popularité / affinité chez un vrai club.
3. **Le score** : statut (`ok` / `weak` / `insufficient`), AUC contre naïf sur
   les clients actifs, calibration, rejeu à J-7, temps sur la machine Nano.
4. **La surestimation** des soirées à venir (lot 2 de l'optimisation) : le
   journal la mesurera ; noter le relevé de la première soirée.
5. Écrire un compte rendu dans ce plan (chiffres, pas d'impression) et les
   décisions qui en sortent pour Paul. Aucune donnée personnelle dans le
   compte rendu : des comptes et des taux.

Le calcul de nuit tourne de toute façon pour Kevin dès la connexion ; les
portes décident de ce qu'il voit. Ce lot ne change rien chez lui.

## Lot 4 — le juge : groupe témoin et prévu / réel sur 4 à 8 vraies soirées

- Un relevé en lecture seule, `scripts/crm-bench/readout.mjs <scope>` (même
  connexion que `prod.mjs`), qui imprime par soirée réglée : AUC et calibration
  du score contre le modèle naïf (`crm_prediction_results`), écart de la
  projection, et le gain mesuré par le groupe témoin par audience « Qui cibler »
  et par automatisation (achats des contactés contre témoins, intervalle).
- Règles de verdict, à écrire avant de lire les chiffres :
  - **score utile** si le modèle bat le naïf sur au moins 5 des 8 soirées ;
    sinon le montrer seulement comme ordre d'envoi, sans étiquette ;
  - **message utile** si le gain des contactés sur les témoins est positif et
    net (z ≥ 2) en cumulé sur les soirées ; sinon revoir le moment et l'angle
    avant le nombre d'envois.
- Point d'étape avec Paul après 4 soirées, verdict après 8.

## Hors périmètre (à enchaîner)

- Mineurs exclus de l'analyse, du score et de « Qui cibler » ; soirées
  « sensibles » ; désinscrit de tout = hors score ; conservation (dossier
  `docs/legal/CRM_ANALYSE_CLIENT_REVUE_JURIDIQUE.md`, partie 6). Les mineurs
  touchent les mêmes fonctions que le lot 1 : bon candidat pour la suite
  immédiate.
- Traceurs d'e-mails soumis à accord (recommandation CNIL 2026-042) : chantier
  du moteur e-mail entier, plan à part.
- La projection des NOUVEAUX qui ignore la tête d'affiche (Goya : 82 estimés pour
  116).

## Effort

| Lot | Équipe humaine | CC + gstack |
|---|---|---|
| 1 — tirage pondéré (banc, variantes, migration, textes) | 1 à 2 semaines | 3 à 4 h |
| 2 — porte des acheteurs attendus | 3 jours | 1 h 30 |
| 3 — premier vrai compte (mesures, compte rendu) | 2 jours | 1 h, après la connexion de Kevin |
| 4 — relevé et verdict | 1 jour + l'attente des soirées | 1 h, puis 4 à 8 semaines de soirées |

## Mesures (à remplir pendant l'exécution)

_Lot 1 : statuts par profil et par variante, temps. Lot 2 : porte au banc.
Lot 3 : compte rendu WOH. Lot 4 : relevés._
