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
| 5 | Autonomie | Les agents PRÉPARENT (brouillons, plans, bilans), le pro valide. Jamais un envoi, une publication ni un interrupteur |
| 6 | Fournisseur d'IA | **Aucun chez Yuno pour commencer** : l'IA du pro (Claude, ChatGPT…) branchée par le MCP fait le travail d'IA ; ce qui doit tourner seul est calculé en SQL, sans IA. Pas de clé, pas de sous-traitant, pas de coût. Des agents Claude côté Yuno viendront si l'usage le justifie |
| 7 | Où | Boutons en contexte (« Préparer avec mon IA ») + bilan de la semaine dans les notifications. Pas de fenêtre de discussion de plus |
| 8 | Noms | Noms de tâche, sans mascotte : « Plan de soirée », « Créer avec l'IA », « Bilan de la semaine », « Pistes d'amélioration » |

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

Prompt §3, recadré par les décisions 5 à 8 (08/10). Un « agent » n'est pas un
programme qui appelle une IA chez Yuno : c'est soit l'IA DU PRO, guidée par le
MCP (consignes, prompts, lectures composites, brouillons), soit un calcul SQL
déterministe pour ce qui doit tourner seul.

Pourquoi : aucune clé ni coût d'IA chez Yuno, aucun sous-traitant nouveau ; le
consentement, le retrait des données personnelles et les brouillons existent
déjà dans le MCP (principe 3 tenu par construction : un seul plan d'outils).
Limites assumées : un pro sans IA branchée n'a que la partie calculée ; le
vérificateur de chiffres ne voit que ce que l'IA DÉPOSE dans Yuno, pas ce
qu'elle dit dans sa conversation — d'où la règle : tout chiffre d'un plan ou
d'un bilan est CALCULÉ par le serveur, jamais écrit par l'IA.

Où ça tourne : SQL (RPC gardées) + Worker MCP existant. Ni fonction edge
nouvelle (quota atteint), ni Workers / Agents SDK, ni cron de plus que
nécessaire (le bilan de la semaine se calcule à la lecture, comme le fil de
notifications ; le bilan plateforme passe par le balayage admin quotidien).

Bouton « Préparer avec mon IA » : ouvre l'IA de la connexion MCP du pro avec
la demande écrite (`claude.ai/new?q=…`, `chatgpt.com/?q=…` ; les deux
l'envoient aussitôt, la demande ne fait que préparer des brouillons), sinon
« Copier la demande » ; sans connexion, il explique comment en brancher une
(Réglages › Assistants IA).

## 8. Lots

| Lot | Contenu | État |
|---|---|---|
| J1 | Langage de conditions, compilateur, miroir TS, validateur du graphe (forme) | fait (08/10) |
| J2 | Tables, versions, RPC (brouillon, publication, pause, archives, chiffres), gardes | fait (08/10) |
| J3 | File des déclencheurs, moteur, nœuds, politique, témoin, Yunits, report / expiration, démo | fait (08/10) |
| J4 | Éditeur, conditions, modèles, estimation, tests, rapport | fait (08/10) |
| J5 | MCP, aide, assistant, Admin CRM, fil de notifications, CLAUDE.md, semis démo | fait (08/10) |
| A0-A5 | Agents | après J5 |

## 9. Décisions ouvertes (à soumettre à Paul au fil de l'eau)

- Liens dans un e-mail de scénario : le modèle vient de l'Email Studio, qui
  accepte toute adresse dans un bouton. Lecture retenue : « pas de lien autre
  que ceux de Yuno » vise le texte des SMS et l'objet ; les liens d'un modèle
  restent ceux que le pro a mis.

## 10. État

**08/10** — Section 0 faite (lectures, worktree, `launch.json`), décisions
1-4 prises, plan écrit.

**J1 fait (08/10)** — migrations `20261016100000_crm_scenario_conditions`
(`_crm_cond_errors`, `_crm_cond_sql`, `_crm_cond_resolve`,
`_crm_family_confirmed`) et `20261016110000_crm_scenario_graph`
(`_crm_scenario_graph_errors`) ; miroirs `src/crm/lib/scenarioConditions.ts`
et `scenarioGraph.ts` ; cas partagés `src/crm/lib/__tests__/fixtures/
scenario-conditions.json` (69) et `scenario-graphs.json` (57), rejoués par
vitest ET par `node scripts/crm-bench/scenarios.mjs conditions` (identiques).
Choix pris en route : le temps du rythme se compte en minutes entières ; un
déclencheur illisible ne fait pas pleuvoir les « sans soirée » ; une attente
illisible ne compte pas dans le rythme ; espaces retirées comme `btrim`.

**J2 fait (08/10)** — migration `20261016120000_crm_scenarios` : tables
`crm_scenarios`, `crm_scenario_versions` (immuables, trigger),
`crm_scenario_runs`, `crm_scenario_steps`, `crm_scenario_messages` (RLS
sans policy) ; `child_kind = 'scenario'` ; garde `guard_recipe_vs_scenario`
sur `email_automations` (une recette copiée ne se rallume pas tant que le
scénario vit) ; contrôles de base `_crm_scenario_content` (modèle, soirée
fixe, page, segment, identité SMS, avertissements famille non confirmée /
chances indisponibles) ; RPC `crm_scenarios`, `crm_scenario`,
`crm_scenario_save` (brouillon, `draft_changed`), `crm_scenario_publish`
(éteint la recette copiée, refusé en accès assisté), `crm_scenario_set_status`
(reprendre refusé en accès assisté), `crm_scenario_delete` (jamais publié),
`crm_scenario_duplicate`, `crm_scenario_report` (nœuds, témoin, CA par
`_crm_email_attrib`, `_crm_money_gate`). État affiché : gel d'envoi =
`frozen`, compte en pause = `plan_paused`. Banc : `node
scripts/crm-bench/scenarios.mjs crud` (36 vérifications, rôles compris).
Le banc a été reconstruit (`run.mjs build`, `gen demo`, `compute demo`) : la
base copiée du lot d'optimisation n'avait pas `crm_sms_rates`.

**J3 fait (08/10)** — migration `20261016130000_crm_scenario_engine` :
`crm_scenario_tick()` (cron `crm-scenario-tick`, minutes 2, 12… 52, budget
4 s, une portée à la fois sous verrou consultatif, une portée en erreur
n'arrête pas les autres). Choix pris en route, à connaître pour reprendre :
- **Pas de file remplie par `ticketing_after_sync`** : les billets neufs et
  les inscriptions confirmées se lisent depuis un repère par portée
  (`crm_scenario_scope_state`, une heure de marge, `first_seen_at`). Même
  effet, et la synchro Shotgun n'est jamais touchée ni bloquée (la règle
  « jamais bloquante » tenue par construction).
- **Entrées** : candidats par déclencheur, déjà-inscrits écartés AVANT de
  construire `_cp`, filtre d'entrée compilé par soirée (`$event`), joignable
  (e-mail ou SMS), pas d'exclusion du profilage, règle de retour, 48 h avec
  les recettes et les autres scénarios du compte → `crm_scenario_pending`
  (« en attente ») jusqu'à la fin de la fenêtre, puis `crm_scenario_skips`
  (« non entrés », par raison). Témoin `_crm_holdout_pick('scn:<id>:<clé>')`.
  3 000 entrées au plus par scénario et par passage. Une soirée (ou un jour)
  dont le déclencheur a été lu en entier est marquée dans `trigger_state.done`
  et n'est plus relue (sinon `_cp` serait reconstruit 144 fois par jour).
- **Avance** en ensembles par paquet (version, nœud), jusqu'à 32 tours :
  sorties forcées (exclusion du profilage, adresse supprimée, désinscription,
  STOP, soirée annulée), objectif (jointure, heure de l'achat ou du scan),
  puis le nœud. Attentes, embranchement, A/B déterministe, étiquette (dans
  `crm_contact_notes`), notification (compteur `crm_scenario_notify_daily`).
- **Messages** : e-mail = une campagne enfant par (version, nœud, soirée),
  `child_kind = 'scenario'`, `product = 'crm'`, SA PROPRE MÈRE (hors des
  listes et des bilans d'e-mails, comme les relances des pages), drainée par
  `send-campaign` ; SMS = une campagne CRM programmée par passage (dans la
  liste SMS sous « <scénario> · SMS », comme ceux de « 1re soirée »). Fenêtre
  d'un message : 48 h après l'arrivée, jamais après « 2 h avant la soirée ».
  Reporté (raison) : gel, compte en pause, 20 h (tous scénarios du compte),
  politique d'envoi (1 / 24 h, 3 / 7 j, fatigue), plafond SMS de la semaine,
  Yunits (place réservée au tarif étranger, au pire). Expiré : fenêtre
  passée (avec la dernière raison), pas d'accord, adresse supprimée, plus de
  soirée. Un SMS retombé en brouillon (Yunits, identité, pause) attend et
  repart seul (`_crm_scenario_sms_retry`). Démo : « aurait envoyé ».
- Journal prévu / réel : `crm_prediction_people.contacted_at` posé par un
  message de scénario relié à la soirée. `_crm_erase_contacts` réécrite
  (prod = dépôt vérifié) : inscriptions anonymisées, en route → sortie.

Mesures au banc (PGlite, plus lent qu'un vrai Postgres) : « demo » 1 733
entrées + 586 e-mails au 1er passage en 0,84 s, 2e passage 7 ms ; « grand »
7 845 entrées en trois passages, le plus long à 2,6 s. Smoke :
`node scripts/crm-bench/scenarios.mjs engine` (19 vérifications : entrée,
« ou », témoin, campagne, idempotence, objectif, STOP, 20 h, SMS, reprise
Yunits, effacement, rapport, pression puis expiration, gel, démo).

Ouvert après J3 (pour J4-J5) :
- le fil de notifications du CRM (`get_crm_notifications`, calculé à la
  volée) ne lit pas encore `crm_scenario_notify_daily` ;
- la règle des 48 h des RECETTES ne voit pas les messages des scénarios
  (asymétrie assumée : la politique 1 / 24 h les voit ; changer la recette
  demanderait de réécrire `collect_email_automations`) ;
- `crm_holdout_overview` ne liste pas les scénarios (leur témoin vit dans
  `crm_scenario_report`).

**J4 (08/10)** — serveur : `crm_scenario_counts` (effectif en direct de
chaque groupe, même compilation que l'envoi ; un groupe qui porte une
feuille d'inscription rend « au lancement »), `crm_scenario_preview`
(moteur À BLANC pour « qui entrerait aujourd'hui », estimation par semaine
sur les 8 dernières, coût au pire par personne), tests d'un e-mail
(`send-campaign`, `scenario_id` + `node_id`) et d'un SMS
(`send-sms-campaign`) lus dans le brouillon ENREGISTRÉ ; ces lectures et
« Qui cibler » (`crm_night_targets`, absent depuis le 11/10 — bug trouvé
en chemin) entrent dans `demo_preview_writable_rpc`.
Front : onglets Recettes / Scénarios (`?tab=scenarios`), liste (état,
entrés, en route, objectif, verdict du témoin), galerie des sept modèles +
page blanche (chaque modèle crée ses e-mails CRM et ses SMS en GSM-7),
« Personnaliser » une recette (`recipeToGraph`, publier éteint la
recette ; allumer une recette couverte le dit), éditeur plein écran
`/crm/automations/scenarios/:id` (`src/crm/pages/automations/scenarios/`) :
flux vertical (`flowLayout` : colonnes qui se rejoignent à l'étape commune
la plus proche, empilées quand la place manque), inspecteur (départ :
déclencheur, qui entre, nouvelle entrée, objectif, témoin ; chaque étape),
conditions par famille avec effectif en direct, ajout / retrait d'étape
(`insertAt`, `removalPlan`), enregistrement automatique (conflit
`draft_changed` → bandeau « Recharger »), « Avant de publier », tests,
résultats par étape. Vérifié au banc visuel (front du worktree + session
démo, RPC des scénarios servies en mémoire) : 1440 px et 390 px, aucun
débordement. tsc, eslint, vitest (1 413), build : verts.

Écarts assumés :
- « 1re → 2e soirée » : le prompt dit « SMS à J-2 sans achat » ; le moteur
  ne sait pas ancrer une attente sur la soirée choisie POUR la personne
  (`until_event` lit la soirée du déclencheur, ici passée). Le modèle envoie
  donc le SMS cinq jours après l'e-mail. L'ancrage par personne est une
  évolution du moteur (à décider).
- Créer un modèle depuis la galerie écrit ses e-mails dans
  `email_campaign_templates` (comme une recette) : ils apparaissent dans
  E-mails › Modèles.

Prochaine étape : J5 (MCP, aide, assistant, CLAUDE.md, semis démo).

**J5 fait (08/10)** — rien de poussé, appliqué, déployé ni semé.
- Fil de notifications : `20261016150000` (`_crm_notif_list` lit
  `crm_scenario_notify_daily` : « N personnes ont atteint l'étape … », un
  compteur par jour). Banc : `scenarios.mjs feed`.
- Aide : FAQ `yc.faq.scenario` / `scenariorules` (Compte › Aide), article
  `crm-scenarios` pour l'assistant (`owner-assistant` à redéployer).
- MCP : `20261016160000` (`mcp_grants.can_scenarios`, `_mcp_scenario_tool`,
  `_mcp_scenario_write`, `mcp_call` / `mcp_write` routés) ; Worker
  `worker/mcp/scenarioTools.ts`, outils `list_scenarios`,
  `get_scenario_report` (toute connexion d'un espace CRM), `get_scenario_kit`,
  `create_scenario_draft`, `update_scenario_draft` (derrière `can_scenarios`) ;
  consignes SCENARIOS de `guide.ts` ; `/connect-ai` et Réglages › Assistants IA
  (`aiMcp.can6`, nombre de scénarios préparés) ; pastille « Préparé par … ».
  Écart de nom assumé : le prompt dit `list_journeys`…, les outils disent
  `scenario` (décision 1). Banc : `scenarios.mjs mcp` ; vitest
  `worker/mcp/__tests__/scenario.test.ts`.
- Admin CRM : `20261016170000` (`crm_admin_scenarios`), onglet Plateforme ›
  Scénarios (agrégats par compte). Banc : `scenarios.mjs admin`.
- Gel → pause : déjà tenu par le moteur (J3) ; rien à ajouter.
- Démo : `scripts/demo/seed-crm-journeys.sql` (fin de `refresh-crm-demo.sh`) :
  deux scénarios en ligne aux chiffres rejoués sur les vraies soirées de la
  démo, un SMS retenu faute de Yunits, un en pause, un brouillon. Le SMS
  « retenu » contredit le solde de Yunits de la démo (≈ 27 000) : choix du
  prompt, à confirmer par Paul. Banc : `scenarios.mjs seed` (joué deux fois,
  puis un passage du vrai moteur).
- CLAUDE.md : section « Yuno CRM — les Scénarios ».
