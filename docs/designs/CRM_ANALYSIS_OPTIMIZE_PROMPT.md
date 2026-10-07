# PROMPT — Optimiser la première construction de l'intelligence d'analyse de Yuno CRM

> À coller tel quel dans une session NEUVE de Claude Code, dans
> `/Users/paul/Desktop/yuno-app.nosync`. Écrit le 2026-10-07, après la mise en
> ligne de l'analyse client, de « Qui cibler », de la recette « Faire revenir
> après la 1re soirée » et du score « Chances de venir ».

Tu reprends une intelligence d'analyse qui MARCHE mais qui a été construite et
validée sur un seul compte (la démo). Ton travail : la rendre **plus juste,
plus rapide, mesurable dans le temps, et prête pour les vrais comptes**, sans
jamais la rendre moins honnête. Tu n'ajoutes pas de nouvelle fonctionnalité
visible sans décision de Paul ; tu améliores ce qui existe et tu prouves chaque
amélioration par un chiffre.

Personne n'envoie rien, rien n'est poussé, aucune migration n'est appliquée en
production et aucune fonction n'est déployée **sans un « go » explicite de
Paul dans la conversation**.

---

## 0. Avant d'écrire une ligne

### Lire

1. `CLAUDE.md` en entier. Surtout : « Yuno CRM — analyse client : « Ce qui fait
   venir » » et sa sous-partie « La suite » ; « Backend Supabase — gotchas
   critiques » ; « Comptes démo » ; « Règles de travail ».
2. Les plans, dans l'ordre :
   - `docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md` (le moteur d'hypothèses) ;
   - `docs/designs/CRM_ANALYSIS_NEXT_PLAN.md` (Qui cibler, recette 1re soirée,
     variables, MCP) ;
   - `docs/designs/CRM_PREDICTION_SCORE_PLAN.md` (le score, ses portes, ses
     constats de construction) ;
   - `docs/legal/CRM_ANALYSE_CLIENT_REVUE_JURIDIQUE.md` (ce qui attend un juriste).
3. Les migrations qui portent tout, et rien d'autre avant d'avoir compris :
   `20261010100000` → `150000` (analyse), `20261011100000` → `130000` (suite),
   `20261012100000` + `110000` (score).
4. La mémoire du projet :
   `/Users/paul/.claude/projects/-Users-paul-Desktop-yuno-app-nosync/memory/MEMORY.md`,
   puis au minimum :
   - `crm-client-analysis-2026-10-07.md` (l'état exact et les leçons) ;
   - `discuss-naming-before-writing.md`, `crm-unmeasurable-shows-soon.md` ;
   - `no-parallel-heavy-checks.md`, `supabase-free-plan-nano-outage.md`,
     `prod-db-saturation-concurrent-smokes.md` ;
   - `never-git-stash-shared-worktree.md`, `concurrent-sessions-share-worktree.md`,
     `rtk-hook-fabricates-file-content.md`, `tsc-noemit-checks-nothing.md` ;
   - `plpgsql-auth-guard-null-in-trap.md`, `sql-smoke-test-rolled-back-do-block.md`,
     `rehearse-migration-rolled-back-on-prod.md`.

### Préparer la branche

- D'autres sessions travaillent dans le dossier principal : **ne touche pas à
  son arbre de travail, jamais de `git stash`**. Worktree neuf :
  ```bash
  git fetch origin
  git worktree add /Users/paul/Desktop/yuno-crm-optimize.nosync -b crm/analysis-optimize origin/main
  ```
- Premier commit : ce document.
- `git add <fichiers précis>`, jamais `-A`. Un commit = un changement logique.

### Hygiène de la machine et de la prod

- **Un seul contrôle lourd à la fois** (tsc, eslint, vitest, build, deno check,
  requête SQL).
- Sortie de shell suspecte (« N matches in 0 files ») : relancer avec `rtk proxy`.
- **Prod Supabase** (machine Nano, 426 Mo, vrais clients) :
  - une requête lourde à la fois, après `pg_stat_activity` (la ligne
    `START_REPLICATION … supabase_realtime` est la réplication, sans risque) ;
  - jamais pendant la migration d'une autre session ;
  - aucun cron plus fréquent que toutes les 30 minutes ;
  - toute réécriture de fonction repart de `pg_get_functiondef` sur la base
    liée, et tu vérifies AVANT d'appliquer que la prod est identique au dépôt
    (le script de comparaison de la session du 07/10 est décrit dans la mémoire).
- Jeton : `SUPABASE_ACCESS_TOKEN` dans `.env.local` (jamais affiché). Requêtes
  par l'API de gestion ; appliquer une migration = une transaction qui contient
  le fichier ET sa ligne `supabase_migrations.schema_migrations`.
- Timestamp de migration strictement supérieur à tout ce qui existe
  (`origin/main`, autres branches, registre de la prod).

## 1. Décisions à demander à Paul, en UNE fois, au début

AskUserQuestion, recommandation en premier. Aucun libellé visible écrit avant
sa réponse (`discuss-naming-before-writing`).

1. **Groupe témoin pour mesurer l'effet réel.** Aujourd'hui on mesure qui
   achète APRÈS un envoi, jamais ce qui se serait passé sans. Garder de côté
   une petite part de chaque audience (par ex. 10 %, tirée au hasard, jamais
   contactée par cet envoi) donnerait le vrai gain d'un envoi « Qui cibler » ou
   d'une recette.
   - Recommandé : oui, 10 %, réglable par compte, désactivable, dit clairement
     à l'écran (« 10 % gardés pour mesurer »).
   - Alternatives : seulement sur les automatisations ; ou jamais.
2. **Raisons contradictoires.** Une raison du score (« fréquente ce genre »)
   peut s'afficher alors que l'hypothèse de la même famille est « Testée, pas
   confirmée » sur le compte.
   - Recommandé : ne jamais montrer une raison dont la famille est
     `not_supported` sur le compte.
   - Alternative : laisser le modèle décider seul (il a ses propres poids).
3. **Correction des tests multiples.** Treize familles et leurs variantes,
   testées chaque nuit : quelques « Confirmée » peuvent être des faux positifs.
   Corriger (Benjamini-Hochberg sur les z, plus une marge pour éviter qu'un
   statut ne bascule d'un jour à l'autre) fera passer certaines familles
   limites de « Confirmée » à « À tester ».
   - Recommandé : corriger, et montrer « confirmée depuis » seulement après
     2 calculs complets consécutifs.
   - Alternative : garder les seuils actuels.
4. **Ouvrir la projection de remplissage aux pros.**
   - Recommandé : quand son écart moyen à la réalité est sous 15 % sur les 8
     dernières soirées d'un compte (mesuré par le lot 1), seulement pour ce
     compte.
   - Alternatives : à la main par Paul, compte par compte ; jamais.

## 2. Les règles d'honnêteté (inchangées, non négociables)

- On n'affirme jamais un motif : des faits, puis un statut. Interdit partout :
  « vient pour », « fan de », « aime », « son ami », « il préfère ».
- Une chance par personne : une étiquette et ses raisons, **jamais un
  pourcentage** (décision de Paul).
- Un score ou une estimation n'est montré que s'il passe ses portes ; sinon
  l'écran le dit. Une amélioration qui fait baisser un indicateur de
  validation sur un compte n'est PAS une amélioration.
- Pas de triche avec le futur : tout facteur se calcule avec ce qui était connu
  avant l'ouverture de la vente de la soirée prédite.
- Sous 10 personnes : des nombres, pas de taux.

## 3. Ce que la première construction a appris (point de départ)

Mesures du 07/10, compte démo (`crm@womber.fr`, ~2 650 contacts, ~8 000
billets, 29 soirées), sur la prod :

| Élément | Mesure |
|---|---|
| Calcul complet de l'analyse | 10,9 s |
| Score (entraînement + validation + 8 840 chances) | 15,8 s |
| « Qui cibler » (une soirée) | 0,4 à 0,85 s |
| Écran Automatisations (`crm_automations`) | 4,1 s (l'API coupe à 8 s) |
| Score de la démo | AUC 0,705 (récence seule 0,684) ; clients actifs 0,699 (0,674) ; calibration 1,7 pt |

Constats :

- **Tout n'a été validé que sur la démo**, un compte synthétique. Aucun vrai
  compte n'était branché sur Shotgun en prod le 07/10.
- Sur toute la base, la récence trie déjà presque tout ; la valeur du modèle se
  joue sur les clients actifs. Les portes en tiennent compte, les seuils sont
  au plus juste (0,705 pour 0,70).
- Sur le banc synthétique, l'artiste prédit fort (15 % d'achat après 2 vues
  contre 2,6 %) mais concerne peu de monde : le modèle ne le valorise pas.
  Le format des facteurs compte autant que leur présence.
- La chance d'acheter sur toute la vente surestime une soirée proche : la
  correction par la part restante des achats est en place, sa justesse n'est
  pas mesurée.
- Recette 1re soirée : si un compte manque de Yunits au moment du SMS, la
  campagne SMS retombe en brouillon et le registre empêche toute nouvelle
  tentative. Ces personnes ne reçoivent jamais le SMS, sans que personne ne
  le voie.
- Le banc PGlite (Postgres en WebAssembly) qui a permis de mettre le moteur au
  point vit dans un dossier temporaire de la session : il est perdu. Il faut le
  reconstruire et le garder.

## 4. Ce qu'il faut faire (dans cet ordre)

### Lot 0 — Le banc d'essai, gardé et à l'échelle

- Recréer un banc PGlite **dans le dépôt** (`scripts/crm-bench/`, avec un
  README) : un schéma réduit de la prod (seulement les tables et fonctions
  utiles à l'analyse), les migrations réelles rejouées, un générateur de
  comptes synthétiques paramétrable (taille, part de fidèles, effet artiste,
  effet concept, achat tôt / tard, groupes), une commande unique.
- Trois comptes de référence : « démo », « grand » (12 000 contacts, 30 000
  billets, 60 soirées), « petit » (300 contacts, 10 soirées).
- Mesurer chaque fonction lourde sur le « grand » (`EXPLAIN ANALYZE`), écrire
  les temps dans le plan. Cible : tout calcul de nuit sous 60 s par compte,
  toute lecture d'écran sous 1 s, `crm_automations` sous 2 s.

### Lot 1 — Mesurer dans le temps (avant d'optimiser le modèle)

- **Journal des prédictions** : à chaque calcul de nuit, garder par soirée à
  venir la projection (vendues, connus attendus, bande, nouveaux) et, par
  personne, la chance donnée. Quand la soirée est passée, comparer à la
  réalité : calibration par tranche, écart de la projection, acheteurs
  attendus vs réels par audience « Qui cibler ».
- Une table d'agrégats seulement pour l'historique de long terme ; les chances
  par personne ne se gardent que jusqu'à la comparaison (purge ensuite).
- Admin CRM : courbe « prévu / réel » par compte, et l'alerte
  `admin_crm_score_drift` (via `emit_admin_notification`, `dedup_key`) quand
  la calibration dérive.
- Selon la décision 1 : le groupe témoin dans « Qui cibler » et les recettes,
  et le vrai gain d'un envoi (acheteurs du groupe contacté − groupe témoin).

### Lot 2 — Un meilleur score, prouvé

Chaque changement est gardé SEULEMENT s'il améliore, sur les soirées tenues à
l'écart du « grand » ET de la démo, l'AUC des clients actifs ou la perte
logarithmique, sans dégrader la calibration :

- Format des facteurs : artiste (vu récemment, nombre de vues), concept
  (dernière édition faite ou non), tranche de prix habituelle contre prix de
  la soirée, achat en groupe, venu avec un client déjà venu, jour et créneau
  croisés, saison.
- Réglage de la pénalité L2 par validation (0,3 / 1 / 3 / 10) ;
  recalibration (Platt) sur les soirées tenues à l'écart.
- Raisons : appliquer la décision 2, et vérifier que les 3 raisons montrées
  sont celles qui pèsent le plus pour la personne.
- Temps de calcul : le score reste sous 60 s par compte sur le « grand ».

### Lot 3 — Un moteur d'hypothèses plus robuste

- Selon la décision 3 : correction des tests multiples et stabilité des
  statuts.
- Familles « non concluantes » qui le restent des mois : le dire autrement
  (« pas de différence nette sur votre compte ») plutôt que « À tester ».
- Vérifier sur le « grand » que les statuts ne changent pas quand on retire
  10 % des données au hasard (stabilité), et l'écrire dans le plan.

### Lot 4 — Recette 1re soirée et « Qui cibler », fiables

- SMS manqué faute de Yunits : ne marquer la personne comme traitée qu'une fois
  le SMS réellement parti, ou retenter tant que la fenêtre est ouverte, et le
  montrer sur la carte de la recette (« 12 SMS en attente de Yunits »).
- « Qui cibler » : montrer le recouvrement entre audiences (« 40 % des fidèles
  du concept ont aussi vu l'artiste ») pour éviter d'écrire deux fois aux
  mêmes personnes, et proposer un ordre d'envoi.
- Délai de la recette : comparer le délai médian du compte à un délai par
  profil (récence de la 1re soirée, distance, canal) et ne changer que si le
  journal du lot 1 montre un gain.

### Lot 5 — Le premier vrai compte

Quand un vrai compte se branche sur Shotgun (Paul le dira) :

- relever sa couverture (`crm_signal_coverage`), ses statuts, les portes du
  score, et comparer à la démo ;
- écrire dans le plan ce qui change, sans toucher à ses données ;
- si le score n'y passe pas les portes, chercher pourquoi sur le banc, pas en
  baissant les seuils.

### Lot 6 — Leçons communes (seulement après la clause validée)

Rien tant que `crm_learning_settings.enabled` est faux. Ensuite : rapprocher
les estimations d'un petit compte des leçons communes (rétrécissement
bayésien des gains de familles et des poids du score), avec les mêmes portes.

## 5. Sécurité (inchangée)

- SECURITY DEFINER : `search_path` fixé, `REVOKE … FROM PUBLIC, anon` (et
  `authenticated` pour l'interne), `GRANT` explicites.
- Lectures gardées (`crm_scope_allowed`), écritures (`crm_scope_writable`),
  montants (`_crm_money_gate`) ; super admin pour l'Admin CRM.
- Aucune garde ne rend NULL pour un inconnu ; `EXISTS` plutôt que
  `= ANY(sous-requête)`.
- Les chances par personne ne sortent jamais dans un export ni dans
  l'apprentissage commun ; l'opposition au profilage les efface.
- Matrice de rôles en blocs DO annulés pour toute RPC nouvelle ;
  `has_function_privilege('anon', …)` faux.

## 6. Contrôles et livraison

Un par un :

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npx vitest run
npm run build
python3 scripts/deno-check-edge.py <fonctions touchées>
supabase db lint --linked     # « relation _… does not exist » = tables temporaires, faux positifs
```

Fin de session, ce que tu rends à Paul :

1. les mesures avant / après, lot par lot (temps, AUC des actifs, calibration,
   écart des projections), et ce que tu as REFUSÉ de garder faute de gain ;
2. ce qui est vérifié, avec les sorties, et ce qui ne l'est pas ;
3. les captures des écrans changés (ordinateur et 390 px) ;
4. avec son go : chaque migration répétée sur la prod dans une transaction
   annulée, puis appliquée ; front, Worker MCP, fonctions edge ;
5. les décisions encore ouvertes et la suite, ajoutées au plan.

| Lot | Équipe humaine | Claude Code |
|---|---|---|
| 0 Banc à l'échelle | 3 jours | 3 h |
| 1 Journal prévu / réel, témoin | 1 semaine | 1 jour |
| 2 Score amélioré et prouvé | 1 semaine | 1 jour |
| 3 Moteur plus robuste | 3 jours | 3 h |
| 4 Recette et Qui cibler fiables | 3 jours | 3 h |
| 5 Premier vrai compte | 1 jour | 1 h |
| 6 Leçons communes | après la clause | — |
