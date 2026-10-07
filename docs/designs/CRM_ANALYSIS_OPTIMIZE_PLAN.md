# Yuno CRM — optimiser l'intelligence d'analyse (plan d'exécution, 2026-10-07)

Exécution de `CRM_ANALYSIS_OPTIMIZE_PROMPT.md`. Branche `crm/analysis-optimize`
(worktree `/Users/paul/Desktop/yuno-crm-optimize.nosync`, partie d'origin/main
e89d28bf). Rien n'est poussé, appliqué en prod ni déployé sans le « go » de
Paul dans la conversation.

## Décisions de Paul (07/10)

| Sujet | Décision |
|---|---|
| Groupe témoin | Oui, **10 % partout** (« Qui cibler » et recettes), tirés au hasard, réglable par compte, désactivable, dit à l'écran. Libellé exact à choisir avec Paul avant de l'écrire |
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
