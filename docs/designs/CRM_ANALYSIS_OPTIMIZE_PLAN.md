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

À remplir lot par lot (avant / après, comptes « démo », « grand », « petit »).
