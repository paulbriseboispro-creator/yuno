# Yuno CRM — les Scénarios (automatisations sur mesure « et / ou ») et les agents

Plan d'exécution de `CRM_JOURNEYS_AGENTS_PROMPT.md`. Branche `crm/journeys`,
worktree `/Users/paul/Desktop/yuno-crm-journeys.nosync`, partie d'origin/main
d2e5fe20. Vérification visuelle : entrée `yuno-crm-journeys-dev` (port 8104)
du `launch.json` du dossier principal. **Rien n'est poussé, appliqué en
production, déployé ni semé sans le « go » de Paul pour chaque étape.**

Le fichier garde le nom de travail « journeys » ; la fonction s'appelle
**« Scénarios »** (décision 1).

## 1. Ce que fait le marché (et ce qu'on en garde)

| Outil | Ce qu'il fait | On prend | On refuse |
|---|---|---|---|
| Klaviyo (Flows) | Déclencheur (liste, segment, événement, date), filtres de flux évalués à chaque étape, attentes, embranchements conditionnels et par test A/B, « smart sending » (pas deux envois sous N h) | Filtres de flux relus à CHAQUE étape (quelqu'un qui a acheté sort), attente « jusqu'à », A/B déterministe | Le canevas libre, les déclencheurs de panier et de navigation (Shotgun ne les rend pas) |
| Brevo (Automatisations / scénarios) | Modèles prêts, « attendre jusqu'à », conditions et/ou, sortie quand un objectif est atteint | Modèles de départ expliqués, objectif = sortie | Les webhooks sortants et le code personnalisé |
| Customer.io (Campaigns) | Conditions d'entrée ET de sortie, « goal » qui mesure la conversion, groupes témoins par campagne, « time window » d'envoi | Objectif + témoin par scénario, fenêtres d'envoi, sorties forcées | Les étapes « webhook » et « code » (aucun appel sortant choisi par le pro) |
| Braze (Canvas) | Audience Paths (jusqu'à 8 groupes), Action Paths (fenêtre d'évaluation ≤ 31 j), Experiment Paths avec témoin, critères de sortie, groupe témoin global | Embranchement par condition, chemin d'expérience avec témoin, critères de sortie, fenêtre d'attente bornée | Le canevas libre et les huit branches : un oui / non lisible au téléphone suffit, on imbrique |
| Nevent (CRM d'événements, Espagne) | Campagnes e-mail, SMS, WhatsApp et push, segmentation par achats, score de « température » (chaud, tiède, froid) | Rien de neuf : Yuno a déjà mieux que la température (« Chances de venir » validé, hypothèses testées) | Un score montré sans validation |

Ce qu'aucun d'eux ne fait, et que Yuno fait : la condition « famille
d'hypothèse CONFIRMÉE sur ton compte » (on cible ce qui se vérifie chez toi,
pas une intuition), « Chances de venir » validé par compte, le témoin de
10 % appliqué par défaut, le journal prévu / réel, et la porte : un
scénario sait qui est ENTRÉ à la soirée.

Sources du relevé : documentation Braze (Canvas : Audience Paths, Action
Paths, Experiment Paths, Exit Criteria, Global Control Group), présentation
de Nevent (alternativeto.net, Dealroom), connaissance des produits Klaviyo,
Brevo et Customer.io.

## 2. Décisions de Paul

| # | Sujet | Décision (08/10) |
|---|---|---|
| 1 | Nom | **« Scénarios »** — EN « Scenarios », ES « Escenarios » |
| 2 | Recettes et scénarios | Les 8 recettes restent. « Personnaliser » crée un scénario qui copie la recette ; publier ce scénario éteint la recette ; jamais les deux allumés sur un même sujet |
| 3 | Pression d'envoi | L'ENTRÉE respecte le délai de 48 h avec les autres automatisations du compte. Les étapes en sont exemptées, restent à 20 h au moins l'une de l'autre, et comptent dans les plafonds globaux (1 / 24 h, 3 / 7 j, fatigue). Deux e-mails d'un même scénario sont donc à 24 h au moins en pratique : celui qui tombe trop tôt est reporté, jamais perdu |
| 4 | Qui publie | Les rôles qui allument une recette (`crm_scope_writable`), jamais un lecteur, **jamais en accès assisté** |
| 5-8 | Agents | À poser au début de la phase agents |

Identifiants techniques : `scenario` (`crm_scenarios`, `crm_scenario_versions`,
`crm_scenario_runs`…), pas `journey` : `/crm/journey`, `crm_journey` et
`yc.jr.*` sont l'écran d'analyse « Parcours client », qui reste tel quel.
Textes : module `src/i18n/locales/crm/modules/scenarios.ts`, clés `yc.scn.*`
(`yc.sc.*` est déjà le score).

## 3. Le langage de conditions (lot J1)

### 3.1 La forme

```json
{ "op": "and", "not": false, "items": [
  { "k": "nb_min", "v": 1 },
  { "op": "or", "items": [ { "k": "hyp", "v": ["artist"] }, { "k": "sc_family", "v": "series" } ] }
] }
```

- Groupe : `{ op: "and" | "or", not?: boolean, items: [...] }`, au moins un
  élément. Feuille : `{ k, v }`.
- Profondeur maximale 3 (racine comprise), 20 feuilles au plus.
- **Règle de sûreté** : une feuille inconnue, une valeur illisible, une
  référence qui n'existe plus (segment effacé, soirée d'un autre compte)
  rendent l'arbre ENTIER faux à l'exécution, même sous un « non ». Sans cette
  règle, `not` inverserait un `false` de sûreté et l'audience grossirait.
  À la publication, ces cas sont des erreurs.

### 3.2 Les feuilles « personne » = le vocabulaire de `_crm_filter_sql`

Chaque feuille est compilée par `_crm_filter_sql` lui-même
(`{"f": {k: v}}`, ou `{"seg": v}`) : le chiffre affiché = le filtre = l'envoi.

Clés reprises, telles quelles : `seg`, `ev`, `last`, `last_gt_days`, `nb`,
`sp`, `rc`, `src`, `tags`, `msg`, `gl`, `glev`, `nb_min`, `nb_max`,
`last_lt_days`, `sp_min`, `basket_min`, `paid_min`, `age_min`, `age_max`,
`gender`, `area`, `country`, `country_not`, `up`, `click_lt_days`, `ch`,
`hyp`, `artist`, `genre`, `fmt`, `series`, `buy`, `grp`, `arr`, `dist_min`,
`dist_max`, `pass`, `ntgt`.

Écartées, et pourquoi :
- `emails` (liste fixe d'adresses) et `q` (recherche par nom) : une
  définition de scénario ne porte JAMAIS de donnée personnelle. C'est ce qui
  permet aux agents de l'écrire (principe agents n° 1). Une liste fixe passe
  par un segment enregistré (feuille `segment`).

Ajoutée : `segment` (id d'un segment enregistré du compte) — remplacé par sa
définition au moment de l'évaluation (`_crm_cond_resolve`, portée vérifiée).

`ntgt.e` accepte `"$event"` : la soirée du scénario (« Qui cibler » de SA
soirée), résolue à l'exécution.

### 3.3 Les feuilles « scénario » (contexte de l'inscription)

| Clé | Valeur | Sens |
|---|---|---|
| `sc_bought` | `true` / `false` | a acheté pour la soirée du scénario depuis son entrée (`_crm_ticket_is_sale`) |
| `sc_entered` | `true` / `false` | est entré à la porte pour la soirée du scénario (scan) |
| `sc_opened` | id d'un nœud e-mail | a ouvert ce message du scénario |
| `sc_clicked` | id d'un nœud e-mail | a cliqué dans ce message |
| `sc_sms_delivered` | id d'un nœud SMS | ce SMS lui a été remis |
| `sc_chance` | `["high", "medium", "low"]` (sous-ensemble) | étiquette « Chances de venir » pour la soirée du scénario |
| `sc_family` | une famille (`artist`, `series`, `genre`…) | famille CONFIRMÉE sur le compte (même règle que `supportedForSegments`) ET portée par la personne (`h:<famille>` dans ses clés) |

Le clic par personne sur un SMS n'existe pas (le lien court est partagé par
soirée) : la feuille est « Bientôt » dans l'éditeur, refusée à la
publication.

Les feuilles `sc_bought`, `sc_entered`, `sc_opened`, `sc_clicked`,
`sc_sms_delivered` n'ont de sens qu'une fois inscrit : refusées dans le filtre
d'ENTRÉE, permises dans `branch`, `wait` « jusqu'à » et l'objectif.
`sc_chance` et `sc_family` sont permises partout ; sans soirée de scénario,
`sc_chance` est fausse.

### 3.4 Familles de l'éditeur

Profil (`age_min`, `age_max`, `gender`, `area`, `country`, `country_not`,
`dist_min`, `dist_max`, `pass`, `src`, `tags`, `segment`) · Soirées (`seg`,
`ev`, `last`, `last_gt_days`, `last_lt_days`, `nb`, `nb_min`, `nb_max`, `sp`,
`sp_min`, `basket_min`, `paid_min`, `up`, `sc_bought`, `sc_entered`) · Ce qui
fait venir (`hyp`, `sc_family`, `artist`, `genre`, `fmt`, `series`, `buy`,
`grp`, `ntgt`) · Chances de venir (`sc_chance`) · Messages (`msg`,
`click_lt_days`, `sc_opened`, `sc_clicked`, `sc_sms_delivered`) · Guest list
(`gl`, `glev`) · Canal (`rc`, `ch`, `arr`).

### 3.5 SQL = vérité, TypeScript = miroir

- `_crm_cond_errors(tree, ctx)` → `[{code, path}]` (IMMUTABLE) ;
  `_crm_cond_sql(tree, alias_person, alias_run)` → texte SQL, `'false'` dès
  qu'une erreur existe ; `_crm_cond_resolve(scope, tree)` (STABLE) remplace
  les feuilles `segment` et `$event`.
- `src/crm/lib/scenarioConditions.ts` : mêmes codes d'erreur, mêmes chemins.
- Cas partagés : `src/crm/lib/__tests__/fixtures/scenario-conditions.json`,
  lus par vitest ET par le banc (`scripts/crm-bench`) qui compare les codes du
  SQL à ceux attendus. Modèle : `statusOf` / `_crm_an_status`.

## 4. Le graphe (J1 pour la forme, J2 pour le stockage)

```json
{ "v": 1,
  "trigger": { "type": "before_event", "days": 10, "scope": { "series": null, "genre": null } },
  "entry": { "filter": { … }, "reentry": { "mode": "per_event" }, "holdout": true },
  "goal": { "type": "bought_event" },
  "start": "w1",
  "nodes": {
    "w1": { "type": "wait", "mode": "until_event", "anchor": "start", "days": -3, "at": "18:00", "next": "b1" },
    "b1": { "type": "branch", "cond": { … }, "yes": "e1", "no": "x" },
    "e1": { "type": "email", "template_id": "…", "subject": "…", "event": "scenario", "next": "x" },
    "x":  { "type": "end" }
  } }
```

Déclencheurs (`trigger.type`) : `event_published`, `before_event`,
`after_event` (`who`: `entered` | `absent_buyers` | `all`), `ticket_bought`
(`first` | `series`), `segment_joined` (évalué une fois par jour, budgété),
`absence` (N jours), `click_no_buy`, `signup_confirmed` (une page), `chance_high`
(soirée à venir, sans place), `manual_segment` (une fois). « Bientôt »
(grisés) : panier abandonné, visite de la page Shotgun.

Nœuds : `wait` (`duration` | `until_event` | `until_cond` avec `max_hours`,
`next` et `timeout`), `branch` (`cond`, `yes`, `no`), `split` (A/B
déterministe, 2 à 4 chemins, parts en %), `email`, `sms`, `tag`, `notify`,
`end`. `instagram_dm` existe dans le modèle, « Bientôt » tant que
`CRM_INSTAGRAM_LIVE` est faux, refusé à la publication.

### Validation (SQL = vérité, TS = miroir)

- **Structure** : `start` existe, tout id cité existe, aucun nœud orphelin,
  aucun cycle, tout chemin finit sur `end`.
- **Taille** : 30 nœuds, 6 messages par chemin.
- **Rythme** : 20 h au moins entre deux messages d'un même chemin quand
  l'écart est CALCULABLE (attentes de durée, deux attentes relatives à la
  soirée) ; sinon (attente « jusqu'à une condition ») le moteur reporte le
  message jusqu'aux 20 h. Une attente « avant la soirée » ne dépasse pas son
  début.
- **Contenu** : e-mail = un modèle du compte ; SMS = identité légale prête
  (`get_sms_sender_readiness`), aucune adresse web dans le texte (seul
  `{{lien}}`, le lien court Yuno) ; objet sans adresse web.
- **Coût** : Yunits au plus par entrant = le chemin le plus cher (e-mail 1,
  SMS 35 France / 70 étranger par segment, lus dans `crm_pricing`), affiché.
- **Aucun appel sortant** : il n'existe aucun nœud webhook, et il n'y en aura
  pas.

## 5. Le moteur (J3)

- **Versions immuables** : publier fige le graphe dans `crm_scenario_versions`.
  Modifier un scénario actif = un brouillon ; les personnes en route finissent
  la version qu'elles ont commencée.
- **File des déclencheurs** (`crm_scenario_trigger_queue`) : remplie par
  `ticketing_after_sync` (billets neufs, scans ; jamais bloquant, comme
  `_crm_analysis_mark_sync`), par les confirmations de pages, et par un
  balayage des déclencheurs liés au temps (soirées publiées, J-N, J+N,
  absence, segment, chances élevées).
- **`crm_scenario_tick()`** : cron toutes les 10 min, budget 4 s, une portée
  à la fois, `SKIP LOCKED`, idempotent (registre unique : inscription, nœud,
  passage). Il ne construit `_cp` qu'une fois par portée et par passage, et
  seulement si une condition « personne » est due. Mesuré au banc avant d'être
  gardé (repli : `crm_person_profile` pré-calculé).
- **Messages par les chemins existants** : une campagne enfant par
  (version, nœud, soirée), `child_kind = 'scenario'` ; SMS par un
  `sms_campaigns` programmé (comme l'étape SMS de `first_return`). Ainsi la
  politique d'envoi, les heures calmes, les Yunits débités avant envoi,
  l'identité légale, le gel, `demo_no_send`, l'attribution et le témoin
  s'appliquent sans être réécrits.
- **Pression (décision 3)** : l'entrée est jugée avec la règle des 48 h des
  recettes (tout envoi automatique du compte, recettes et scénarios) ; chaque
  message passe `_email_send_policy_many(…, 'automation')` (1 / 24 h,
  3 / 7 j, fatigue, aversion). À vérifier en J3 : que la règle des 48 h des
  recettes voie aussi les messages de scénarios (sinon une recette
  renverrait le lendemain d'une entrée de scénario).
- **Rien ne se perd en silence** : bloqué = REPORTÉ jusqu'à la fin de la
  fenêtre du message, puis expiré avec sa raison (pression, heures, Yunits,
  gel, en retard). Chaque raison se lit dans les chiffres du nœud.
- **Témoin** : tirage à l'entrée par scénario
  (`_crm_holdout_pick('scn:<id>', email, holdout_pct)`). Le témoin suit le
  chemin sans rien recevoir ; son objectif est compté.
- **Démo** : le moteur inscrit et avance, n'envoie jamais (« aurait envoyé »).
- **Sorties forcées** : désinscription, STOP, adresse supprimée, exclusion du
  profilage, contact effacé, compte en pause.
- **Journal prévu / réel** : colonne « contacté » sur la ligne de la personne
  (`crm_prediction_people`), sinon le score apprendrait que « contacté » fait
  acheter.

## 6. Les écrans (J4), le reste (J5)

Comme le prompt §2 : page Automatisations à deux onglets (Recettes /
Scénarios), éditeur plein écran (hauteur mesurée, flux vertical, inspecteur à
droite, conditions par groupes « et / ou » avec effectif en direct par la même
RPC que l'envoi), « Avant de publier », test gratuit, modèles expliqués,
390 px sans défilement horizontal. Gel → pause. Admin CRM. MCP (lecture +
brouillons derrière un consentement propre). Aide, assistant, CLAUDE.md,
mémoire, semis démo.

## 7. Les agents (A0-A5)

Prompt §3. Décisions 5 à 8 à poser au début de la phase.

## 8. Lots

| Lot | Contenu | État |
|---|---|---|
| J1 | Langage de conditions, compilateur, miroir TS, validateur du graphe (forme) | à faire |
| J2 | Tables, versions, RPC (brouillon, publication, pause, archives, chiffres), gardes | à faire |
| J3 | File des déclencheurs, moteur, nœuds, politique, témoin, Yunits, report / expiration, démo | à faire |
| J4 | Éditeur, conditions, modèles, estimation, tests, rapport | à faire |
| J5 | MCP, aide, assistant, CLAUDE.md, semis démo | à faire |
| A0-A5 | Agents | après J5 |

## 9. Décisions ouvertes (à soumettre à Paul au fil de l'eau)

- Liens dans un e-mail de scénario : le modèle vient de l'Email Studio, qui
  accepte toute adresse dans un bouton. Lecture retenue : « pas de lien autre
  que ceux de Yuno » vise le texte des SMS et l'objet ; les liens d'un modèle
  restent ceux que le pro a mis.

## 10. État

**08/10** — Section 0 faite (lectures, worktree, `launch.json`), décisions
1-4 prises, plan écrit. Prochaine étape : J1.
