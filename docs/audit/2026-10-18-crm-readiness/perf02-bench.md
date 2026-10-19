# PERF-02 — un compte trop lent ne prive plus les autres de leur calcul de nuit

Migration `20261028100000_crm_score_nightly_overrun.sql` (non appliquée),
retour arrière `ROLLBACK-score-overrun.sql`. Banc
`scripts/crm-bench/score-nightly.mjs` sur un instantané des définitions de la
prod relu le 19/10 (`crm_score_compute` identique à la prod au caractère près,
DATA-08 compris), compte `amoris` (18 372 personnes, 280 soirées).

## Ce que la prod faisait le 18/10

`cron.job_run_details` du job 178 (`27,57 5-6 * * *`) :

| Passe (UTC) | Durée | Résultat |
|---|---|---|
| 05:27 | 120,1 s | délai dépassé (Amoris) |
| 05:57 | 120,0 s | délai dépassé (Amoris) |
| 06:27 | 120,3 s | délai dépassé (Amoris, pendant l'INSERT de `crm_prediction_people`) |
| 06:57 | 118,3 s | Amoris noté |

Le compte démo, deuxième de la file, n'a pas été noté. Le 19/10 (deux
portées), tout a tenu : démo 7 s, Amoris 56 s.

## Règle (décisions de Paul du 19/10)

- Un calcul qui ne tient pas dans le temps **garde les chances d'hier**.
- La portée passe derrière les autres (retentée seulement si une passe reste
  libre ; les nuits suivantes, elle ne prend plus la première passe).
- Une alerte super admin par compte et par nuit (`admin_crm_analysis_failed`).

Le délai de 120 s reste la règle : un budget plus court couperait un calcul qui
aurait tenu (la passe de 118,3 s). `score.budget_s` existe mais est absent en
prod. Point connu : le budget n'est relu qu'entre six étapes ; au banc, avec un
budget de 3 s, la passe s'arrête après le chargement, à 7,3-7,5 s.

## Preuves

`node score-nightly.mjs overrun amoris-warm 20261027100000_….sql 20261028100000_….sql`
(passes de nuit, chacune dans sa transaction ; compte en tête de file, petite
portée vide derrière) — **17 vérifications conformes** :

| Passe | Durée | Ce qui se passe |
|---|---|---|
| 1, budget 3 s | 7,5 s | le compte s'arrête (étape `load`) ; ses six tables du score intactes (empreinte de chaque ligne) ; trace écrite ; une alerte |
| 2 | 0,01 s | la petite portée est notée (`insufficient`) |
| 3 | 7,4 s | le compte est retenté sur la passe libre ; toujours une seule alerte |
| nuit suivante, 1 | 0,01 s | la petite portée passe la première |
| nuit suivante, 2 | 7,3 s | puis le compte |
| délai simulé pendant le journal | 29,9 s | attrapé, étape `_crm_score_journal` nommée ; chances d'hier intactes |
| annulation à la main | 29,4 s | elle remonte (57014), rien ne change |
| le temps rendu | 30,6 s | le compte est noté (`ok`, 18 189 chances du jour) |
| | 0 s | file vide |

PGlite n'a pas de minuteur : le délai est simulé par un journal qui lève
`query_canceled`, l'erreur exacte du minuteur de la prod (`statement_timeout`
posé à 2 s, que PGlite n'applique pas, pour que le gestionnaire reconnaisse un
délai qui a vraiment sonné ; posé à 10 min, la même erreur est une annulation
à la main).

Sans dépassement, rien ne change (`run --nightly`, les deux calculs par la
passe du cron dans une transaction, définitions de la prod avant, + PERF-02
après) :

| Départ | Avant | Après | Tables du score |
|---|---|---|---|
| à chaud (modèle d'hier) | 66,4 s | 53,7 s | six identiques ligne à ligne (`real` à 9e-8 près) |
| à froid | 244,7 s | 249,8 s | six identiques ligne à ligne |

Les écarts de durée sont ceux de PGlite entre deux passages (cache), pas de la
migration : sans budget, un point de contrôle ne fait que lire sa
configuration.

Sur un banc sans données : la migration rejouée deux fois ne pose pas les
points de contrôle en double ; le smoke `smoke/perf02.sql` rend `SMOKE_OK`
(les six points dans l'ordre) ; le retour arrière rend les définitions de la
prod au caractère près.

## Mise en ligne

Après PERF-01. Répétition annulée (structure seulement, aucun calcul) :

```bash
node scripts/crm-bench/prod.mjs --activity
node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/perf02.sql 20261028100000_crm_score_nightly_overrun.sql
```

puis application et `supabase db lint --linked`. La répétition rejoue le bloc
`DO` sur la vraie définition de `crm_score_compute` : un repère introuvable la
fait échouer sans rien changer.
