# PROMPT — Yuno CRM, optimisation de l'analyse : lots 2 à 5 (suite du 07/10)

> À coller dans une session NEUVE de Claude Code, dans `/Users/paul/Desktop/yuno-app.nosync`.

Lis en entier `docs/designs/CRM_ANALYSIS_OPTIMIZE_PROMPT.md` (le prompt d'origine,
ses règles d'honnêteté, de sécurité et de prod), puis
`docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md` (décisions de Paul, mesures des
lots 0 et 1, répétition et mise en ligne), `scripts/crm-bench/README.md`, et la
mémoire `crm-client-analysis-2026-10-07.md`. Les décisions de la section 1 sont
PRISES : ne les repose pas.

**État.** Branche `crm/analysis-optimize` (worktree
`/Users/paul/Desktop/yuno-crm-optimize.nosync`, le reprendre ou en refaire un
depuis origin/main si elle est fusionnée). Lots 0 et 1 faits. Migrations
`20261013100000` → `120000` APPLIQUÉES en prod le 07/10 (`db lint` propre).
Vérifie d'abord dans le plan si le front a été fusionné et si `owner-assistant`
a été redéployée ; sinon, c'est la première chose à proposer à Paul.

**À faire, dans l'ordre, chaque changement prouvé au banc avant la prod :**

1. **Lot 2, en commençant par le constat du lot 1** : la somme des chances
   surestime les acheteurs de 15 à 90 % sur certaines soirées (calibration par
   personne bonne). Refaire la correction « part des achats encore à venir »
   (`crm_score_night.remaining_share`, `p·f / (1 − p·(1 − f))`) et la mesurer
   avec `node run.mjs journal demo|grand` ; puis le format des facteurs, la
   pénalité L2, la recalibration, les raisons (décision 2 : jamais une raison
   dont la famille est `not_supported`). Le score doit rester < 60 s sur
   « grand » (41 s au 1er calcul, 11 s à chaud aujourd'hui).
2. **Lot 3** : Benjamini-Hochberg + marge anti-bascule, « confirmée depuis »
   après 2 calculs complets (décision 3) ; `launch` confirmée sur O = 3 et
   `slot` « pas confirmée » à z = 6 sont les cas du banc ; libellé « pas de
   différence nette » à proposer à Paul AVANT de l'écrire ; stabilité à 10 %
   de données retirées.
3. **Lot 4** : SMS de la recette 1re soirée manqué faute de Yunits (le
   registre `crm_first_return_sms` est écrit dès le brouillon) ; recouvrement
   des audiences de « Qui cibler » et ordre d'envoi ; délai de la recette.
4. **Lot 5** quand Paul branche un vrai compte.

Rappels : un contrôle lourd à la fois ; prod = machine Nano (le 1er appel d'un
écran prend 4-5 s à froid, avant comme après nos migrations) ; `same-as-prod.mjs
--before <version>` avant toute réécriture, `rehearse.mjs` (transaction
annulée) avant tout « go » ; jamais de push, d'application ni de déploiement
sans le « go » de Paul dans la conversation.
