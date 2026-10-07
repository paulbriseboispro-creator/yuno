# PROMPT — Construire l'analyse client de Yuno CRM (hypothèses testées, apprentissage anonyme)

> À coller tel quel dans une session NEUVE de Claude Code, dans
> `/Users/paul/Desktop/yuno-app.nosync`. Écrit le 2026-10-07.

Tu construis la partie **analyse client** de Yuno CRM : à partir des billets
Shotgun déjà en base, comprendre ce qui fait venir chaque client, sous forme
d'**hypothèses testées**, jamais d'affirmations. Et tu poses le mécanisme qui
permet à Yuno de **s'améliorer avec les données de tous les comptes sans qu'une
donnée personnelle ne quitte son compte**.

Tu ne construis PAS la suite (relances en plusieurs temps, automatisation
« 1re → 2e soirée », plan ou audit d'une soirée, correction des outils MCP vides
sur un compte CRM). Elle viendra dans un plan séparé. Tu la notes, tu ne la codes pas.

Personne n'envoie rien, rien n'est poussé, aucune migration n'est appliquée en
production et aucune fonction n'est déployée **sans un « go » explicite de
Paul dans la conversation**.

---

## 0. Avant d'écrire une ligne

### Lire

1. `CLAUDE.md` en entier. Surtout : toutes les sections « Yuno CRM » ;
   « Backend Supabase — gotchas critiques » (la prod est une petite machine
   gratuite, déjà tombée) ; « Comptes démo » ; « Règles de travail ».
2. `docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md` en entier. C'est le plan de fond :
   ce qui existe, les treize familles de signaux, l'architecture.
3. `docs/designs/SHOTGUN_API_REFERENCE.md`. **Tout chiffre sort d'un champ de
   cette liste ou d'une mesure Yuno.**
4. `docs/designs/CRM_SEGMENT_CATALOG.md`, `docs/designs/CRM_GUEST_LIST_ANALYTICS.md`.
5. `docs/SUPABASE_PROD_HEALTH.md`.
6. La mémoire du projet :
   `/Users/paul/.claude/projects/-Users-paul-Desktop-yuno-app-nosync/memory/MEMORY.md`,
   puis au minimum ces fichiers :
   - `discuss-naming-before-writing.md`
   - `crm-unmeasurable-shows-soon.md`
   - `no-parallel-heavy-checks.md`
   - `supabase-free-plan-nano-outage.md`
   - `prod-db-saturation-concurrent-smokes.md`
   - `never-git-stash-shared-worktree.md`
   - `concurrent-sessions-share-worktree.md`
   - `rtk-hook-fabricates-file-content.md`
   - `tsc-noemit-checks-nothing.md`
   - `plpgsql-auth-guard-null-in-trap.md`
   - `sql-smoke-test-rolled-back-do-block.md`
   - `crm-segment-catalog-2026-10-06.md`
   - `crm-first-client-kevin-2026-10-05.md`

### Préparer la branche

- Le `main` local avait 29 commits de retard sur `origin/main` le 07/10.
  D'autres sessions travaillent dans ce même dossier : **ne touche pas à son
  arbre de travail, ne fais jamais `git stash`**.
- Travaille dans un worktree neuf :
  ```bash
  git fetch origin
  git worktree add /Users/paul/Desktop/yuno-crm-analysis.nosync -b crm/client-analysis origin/main
  ```
- Copie dans la branche les deux documents (non suivis dans le dossier
  principal), puis fais-en le premier commit :
  - `docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md`
  - `docs/designs/CRM_CLIENT_ANALYSIS_PROMPT.md`
- `git add <fichiers précis>` toujours, jamais `-A`. Un commit = un changement
  logique (migration, puis front, puis aide…).

### Hygiène de la machine et de la prod

- **Un seul contrôle lourd à la fois** : tsc, eslint, vitest, build, deno check,
  requête SQL. Le Mac a planté le 30/09 avec des contrôles en parallèle.
- Si une sortie du shell paraît résumée (« N matches in 0 files »), relance avec
  `rtk proxy <commande>` : le hook RTK réécrit certaines sorties.
- **Prod Supabase** (machine Nano, 426 Mo, partagée avec de vrais clients) :
  - une seule requête SQL à la fois, après un coup d'œil à `pg_stat_activity` ;
  - jamais pendant la migration d'une autre session ;
  - aucun cron plus fréquent que toutes les 30 minutes pour ce chantier.
- Avant de nommer une migration, prends un timestamp **strictement supérieur**
  à tout ce qui existe : `origin/main`, les autres branches
  (`git branch -a` puis `git ls-tree`), et le registre de la prod
  (`supabase_migrations.schema_migrations`, en lecture, avec l'accord de Paul).

## 1. Décisions à demander à Paul, en UNE fois, au début

Utilise AskUserQuestion, avec une recommandation en premier. Règle mémoire
`discuss-naming-before-writing` : **aucun libellé visible n'est écrit dans le
code ou les traductions avant son choix.** D'ici là, le code utilise des
identifiants techniques neutres en anglais.

1. **Les mots à l'écran.** Pour l'hypothèse d'une personne (pistes : « Piste »,
   « Hypothèse », « Ce qui pourrait le faire venir ») et pour la vue d'analyse
   (pistes : « Ce qui fait venir », « Pourquoi ils viennent », « Ce qui les
   ramène »). Donne 2 à 4 pistes chacune, avec pour et contre.
2. **Fiche client.** Montrer les hypothèses d'une personne sur sa fiche ?
   - Recommandé : oui, avec statut et preuve, seulement pour les rôles qui
     voient déjà les clients nommés, et jamais dans un export CSV.
   - Alternative : seulement en agrégé.
3. **Contribution anonyme aux leçons communes** (section 5).
   - Recommandé : contribuer par défaut, avec refus possible dans Réglages, une
     fois la clause validée par un juriste. Tant qu'elle ne l'est pas, le
     drapeau global reste éteint.
   - Alternatives : accord explicite de chaque compte ; ou éteint jusqu'à nouvel
     ordre.
4. **Les clients « de passage »** (étranger, ou à plus de N km) dans les
   « venus une seule fois ».
   - Recommandé : affichés à part, jamais retirés en silence.

Défaut posé sans question : un contact venu seulement d'un fichier importé
(Dice, Weezevent…) n'a ni line-up ni commande. Il n'entre que dans les familles
profil et trajectoire. Écris-le dans le récapitulatif.

## 2. Les règles d'honnêteté (non négociables)

- **On n'affirme jamais.** Interdit à l'écran, dans l'aide, dans l'assistant et
  dans le MCP : « vient pour », « fan de », « aime », « son ami », « il préfère ».
  On écrit des FAITS suivis d'un statut d'hypothèse. Exemples :
  - « A vu Malaa 2 fois, à deux séries différentes — hypothèse line-up,
    confirmée sur ton compte (84 revenants). »
  - « Sa 1re place était dans une commande de 3 billets avec un client déjà
    venu — hypothèse « venu à plusieurs », à tester. »
- **Quatre statuts par hypothèse et par compte** :
  - `untested` (à tester : pas assez de revenants) ;
  - `supported` (confirmée sur ce compte) ;
  - `not_supported` (testée, pas confirmée) ;
  - `prior_only` (observée sur d'autres comptes Yuno seulement, jamais présentée
    comme confirmée ici).
- **Pas de triche avec le futur.** Une hypothèse vérifiée sur la soirée N+1 est
  calculée avec les seules données disponibles avant N+1 : billets, profils de
  soirée et rareté des artistes **à la date de N**.
- **Silence plutôt que bruit.**
  - Sous 10 personnes : nombres bruts seulement (`MIN_SAMPLE`).
  - Une famille qui ne distingue personne sur le compte (toutes les soirées
    techno) est éteinte, et l'écran le dit en une ligne.
  - Une donnée que l'API Shotgun ne rend pas : `ShotgunSoonCard`, jamais un 0.
- **Une estimation chiffrée** se libelle « Estimation ». Une couverture
  partielle se dit (`CoverageNote` : « connu pour N sur M »).

## 3. Les données (relevé du 07/10, à revérifier sur la base liée)

**Ce qui est utilisable :**

- Billet `external_tickets` : `external_order_id`, `deal_id`, `deal_name`,
  `price`, `purchased_at`, `scanned_at`, `utm` (source, medium), âge, genre,
  ville, code postal, pays, `newsletter_optin`, `raw`.
- Dans `raw` seulement : `deal_channel`, `deal_visibilities` (dont
  `promoters`), `deal_sub_category`, `ticket_seating` (Table, Booth),
  `payment_method`.
- Soirée `external_events` : `artists` (jsonb : id, name, slug, avatar, url),
  `genres` (bruts Shotgun), `type_of_place`, `deals`, `published_at`,
  `launched_at`, `left_tickets`, adresse et coordonnées (dans `raw` si pas en
  colonne).
- Existant à réutiliser :
  - `_crm_ticket_is_sale`, `_crm_ticket_gl_kind`, `_crm_ticket_source`
    (familles de source) ;
  - `_crm_night_series(title)` ;
  - `_crm_event_scan_known` (porte qui a scanné au moins la moitié) ;
  - `_crm_people_build` (`_cp`), `_crm_filter_sql`, `crm_segment_catalog`.

**À corriger dans ce chantier :**

- `first_utm` de `_cp` lit n'importe quel billet (invitation, remboursé,
  duplicata) sans ordre fiable. Il faut le 1er billet VENDU, par `purchased_at`.
- Les genres de la soirée miroir sont convertis en 8 libellés Yuno, avec « Open
  Format » par défaut. L'analyse lit les genres BRUTS de `external_events`.
- Les artistes de la miroir ne sont copiés qu'à sa création. L'analyse lit
  `external_events.artists`, relu à chaque synchro.
- La phase de vente d'un tarif (`deals[].subcategory.start_time`) est perdue au
  mapping (`_shared/ticketing-shotgun.ts`). La garder.
- `_crm_people_build` doit rester tel quel en coût. Toute nouveauté est
  PRÉ-CALCULÉE puis jointe.

**Inconnu** (aucun vrai compte Shotgun branché au 07/10, WOH compris) :

- Les billets d'une commande portent-ils des détenteurs différents ?
- Quelles valeurs prend `type_of_place` ?
- Les genres et line-ups sont-ils remplis ?

Le code doit **découvrir ça seul** (lot A) et s'adapter.

## 4. Ce qu'il faut construire

Chaque lot se termine par ses tests et un commit. Les seuils de départ vivent
dans UNE fonction de configuration `crm_analysis_config()` (jsonb versionné,
`rules_version`), jamais en dur ailleurs.

### Lot A — Couverture des signaux (le « lot 0 » automatique)

`crm_signal_coverage(portée)`, en lecture, gardée. Par connexion Shotgun, elle
rend :

- part des commandes à plusieurs billets, et parmi elles part à détenteurs
  différents ;
- part des soirées avec artistes, avec genres, avec type de lieu ;
- valeurs distinctes de `type_of_place` ;
- répartition de `deal_channel`, de `utm_medium` ;
- part des tarifs `promoters` ;
- couverture du scan, du code postal, de `launched_at`.

Chaque famille lit cette couverture et se déclare `unavailable` quand sa
matière manque, ou en mode réduit : par exemple « achète pour N » au lieu de
« venu avec ». Affichage dans l'Admin CRM (tiroir d'un compte) et en une ligne
dans la vue d'analyse.

### Lot B — Profils pré-calculés

Tables sans policy, écrites par des fonctions SECURITY DEFINER, lues par des
RPC gardées :

- **`crm_artist_seen`** (soirée, artiste, première apparition) : la mémoire
  des annonces de line-up. Alimentée à chaque synchro à partir d'aujourd'hui.
  Les soirées déjà en base reçoivent `published_at` comme borne et un drapeau
  « date d'annonce inconnue ».
- **`crm_night_profile`** (portée, soirée miroir) : série, artistes avec leur
  rareté **à la date de la soirée**, genres bruts, format, créneau (dérivé de
  l'heure locale), jour, lieu, entrées, nouveaux venus, part de nouveaux,
  rythme de vente (part vendue dans les 48 h après la mise en vente), origine
  des nouveaux (canal, distance, à plusieurs).
- **`crm_person_profile`** (portée, e-mail normalisé) :
  - faits du 1er billet vendu : soirée, tarif, rang du tarif, délai d'achat,
    temps depuis la mise en vente, source, plateforme, taille de commande,
    « commande avec un client déjà venu », invitation ;
  - agrégats : artistes vus, genres, formats, créneaux, jours, éditions par
    série, profil d'achat, profil de groupe, distance, « de passage » ;
  - hypothèses (lot C) ; date de calcul ; `rules_version`.
- **`crm_artist_stats`** (portée, artiste) : soirées, entrées, nouveaux amenés,
  revenants parmi eux, vus 2 fois ou plus.
- **Distance.** Table de référence code postal → coordonnées pour la France
  (Base officielle des codes postaux, données ouvertes La Poste ; citer la
  source et la licence dans la migration). Hors France : pays seulement.
  Pas d'appel réseau au calcul.
- **Rafraîchissement.**
  - `ticketing_after_sync()` marque les e-mails et soirées touchés ;
  - un cron toutes les 30 à 60 min recalcule ceux-là, avec un budget de temps
    (modèle : moteur d'e-mails, 4 s par passe) ;
  - un recalcul complet la nuit, un compte à la fois.
- **Purge.**
  - Profils effacés avec la connexion (`ticketing_purge`, déconnexion), avec le
    contact (chemins de suppression existants) et à la suppression du compte.
  - Un contact peut être **exclu du profilage** (droit d'opposition) : drapeau
    posé depuis sa fiche, qui efface son profil et l'empêche d'être recalculé.
- **Jointure dans `_cp`.** Seulement les colonnes nécessaires aux filtres, sans
  alourdir le constructeur. Mesurer avant et après sur la démo.

### Lot C — Le moteur d'hypothèses

Tout en SQL, déterministe, rejouable. Pas d'IA dans le calcul.

**Familles d'AFFINITÉ** (artiste, genre, format, créneau, jour, lieu, série).
Pour chaque revenant, à chaque transition soirée N → soirée suivante N+1 :

- on liste les soirées du compte qui étaient « au choix » entre N et N+1
  (début après N, mises en vente avant l'achat de N+1) ;
- on calcule la probabilité `p` qu'une soirée tirée au hasard dans cette liste
  partage le trait avec ce qu'il avait vu jusqu'à N ;
- on note `o` = 1 si N+1 le partage, sinon 0.

Sur le compte : `O = Σo`, `E = Σp`, `V = Σp(1−p)`, gain = `O / E`,
`z = (O − E) / √V`. Seules comptent les transitions où il y avait au moins une
soirée qui partageait le trait et une qui ne le partageait pas.

- `supported` : 30 transitions utiles ou plus, gain ≥ 1,3 et z ≥ 2.
- `not_supported` : 30 ou plus, et gain < 1,1 ou z < 1.
- Entre les deux : `inconclusive` (affiché « à tester »).

**Familles de COMPORTEMENT** (anticipe, dernière minute, à la porte, à
plusieurs, table) : P(même classe à N+1 | classe à N) comparée à la part de
cette classe sur l'ensemble des achats N+1. Même calcul de gain, z sur deux
proportions, mêmes seuils.

**Familles de RETOUR** (découverte Shotgun, de passage, invité, venu à
plusieurs, canal d'arrivée) : taux de retour à 180 jours de ce groupe contre les
autres nouveaux venus. Seulement les 1res soirées de plus de 180 jours. Écart
d'au moins 30 % et z ≥ 2 pour `supported`. Le sens (revient plus ou moins) est
dit.

**Hypothèses d'une personne.** Pour chaque famille dont la matière existe chez
elle, une force (fort, moyen, faible) tirée de ses faits, selon les règles du
plan, section 3 : par exemple « a vu le même artiste rare 2 fois à des séries
différentes » = fort. Chaque hypothèse rend :

- une clé de preuve et ses paramètres (texte traduit au front, comme les
  constats « À retenir ») ;
- le statut de sa famille sur le compte.

Venu une seule fois : hypothèses tirées de sa soirée (profil de soirée) et de
son achat, jamais au-dessus de « moyen ».

**Historique des statuts.** Une table d'AGRÉGATS par compte (famille, version,
date, O, E, V, n, statut), sans aucune donnée personnelle. Elle permet de dire
« confirmée depuis août » et nourrit le lot E.

### Lot D — Les écrans (analyse seulement)

Design de la Console CRM :

- primitives `src/crm/ui/kit` + `Hv`, `useCrmT()`, `useCrmScope()`,
  `useCrmCaps()`, `rpc()` (délai 30 s), `CrmLoadError` ;
- textes dans `src/i18n/locales/crm/modules/*`, triplets `[EN, FR, ES]`, clés
  `yc.*`, une clé définie une seule fois ;
- 390 px sans défilement horizontal.

Écrans :

1. **Fiche client** (`src/crm/pages/clients/ClientDrawer.tsx`, RPC
   `crm_client`) : bloc d'hypothèses (selon la décision 2), puis les faits.
   Bouton d'exclusion du profilage, refusé en accès assisté.
2. **Analyses › Communauté** (`src/crm/pages/analytics/CommunityTab.tsx`), une
   vue de plus :
   - répartition des hypothèses chez les nouveaux venus ;
   - statut de chaque famille sur le compte, avec ses chiffres (« 61 choix
     conformes pour 33 attendus au hasard ») ;
   - taux de retour par famille ;
   - « venus une fois » séparés en locaux et de passage ;
   - délai médian de retour ;
   - couverture des données.
3. **Tiroir d'une soirée** (`src/crm/pages/nights/NightDrawer.tsx`) : ce que la
   soirée a attiré (nouveaux, d'où, combien de jours avant, à plusieurs, quels
   artistes rares).
4. **Artistes** : qui amène des nouveaux, et des nouveaux qui reviennent
   (statut d'hypothèse affiché).
5. **Clients et segments** :
   - nouvelles clés dans `_crm_filter_sql` : famille, artiste, genre, format,
     série, profil d'achat, à plusieurs, canal d'arrivée, distance, de passage ;
     une valeur illisible = personne ;
   - `hasCriteria` (`src/crm/data/clients.ts`) mis à jour ;
   - nouveaux modèles dans `SEGMENT_TEMPLATES` et `crm_segment_catalog`
     (familles `supported` seulement en « Recommandé ») ;
   - test `segmentCatalog.test.ts` étendu.
6. **Admin CRM** : couverture des signaux et statuts des familles dans le
   tiroir d'un compte (agrégats seulement).

Vérification visuelle : ajoute à `.claude/launch.json` du dossier principal
une entrée qui pointe sur TON worktree (modèle : `yuno-crm-dev`,
`npm --prefix <worktree> run dev`, un port libre), session démo
`crm@womber.fr` (mémoire `preview-from-worktree.md`). Captures ordinateur et 390 px à montrer à
Paul. Rien n'est vérifié contre la prod sans son accord.

### Lot E — Apprendre sans exposer les données

Le principe : **les données personnelles ne quittent jamais la portée de leur
compte**. Ce qui en sort, ce sont des comptages agrégés et anonymes.

- **`crm_learning_contrib`** (RLS sans policy, `service_role` seul).
  - Une ligne par (contributeur, `rules_version`, famille, variante de seuil,
    trimestre) avec `O`, `E`, `V`, `n`.
  - Le contributeur est une clé opaque aléatoire tenue dans une table de
    correspondance séparée, effacée avec le compte.
  - Cellules sous 10 supprimées à la source.
  - Interdits : e-mail, empreinte d'e-mail, identifiant de personne, titre de
    soirée, nom d'artiste, ville.
  - Comptes démo et comptes qui refusent : exclus.
- **`crm_learning_priors`**, publiés seulement si 5 comptes au moins
  contribuent ET qu'aucun ne pèse plus de 50 % de `E` (règle du secret
  statistique). Gain mis en commun = `ΣO / ΣE`. Lus par les écrans comme statut
  `prior_only` : « observé sur N comptes Yuno ».
- **Réglage des seuils sur des agrégats.**
  - Chaque compte contribue les comptages d'une petite grille de seuils (rareté
    10/20/30 %, délai 24/72 h, distance 50/80/150 km).
  - Le meilleur jeu est choisi sur les comptes « laissés de côté » un à un
    (pas sur ceux qui l'ont produit).
  - Il devient une **proposition** de nouvelle `rules_version`, visible dans
    l'Admin CRM, que **Paul valide** (geste audité, motif obligatoire). Jamais
    appliqué seul.
- **Interdit.** Entraîner un modèle sur des lignes de personnes ; envoyer des
  données personnelles à une IA (OpenAI, Claude) pour « apprendre » ; croiser
  deux comptes au niveau d'une personne (une même adresse chez deux orgas reste
  deux personnes sans lien).
- **Plus tard, pas maintenant** (à écrire dans le plan) :
  - repères entre comptes (« ton taux de retour est dans la moitié haute ») :
    8 comptes au moins, en quartiles ;
  - statistiques d'artistes entre comptes : secret des affaires des orgas, au
    moins 3 orgas et aucune au-dessus de 50 %.
- **Réglage du compte** : drapeau de contribution dans `crm_settings`, lu par
  le collecteur, plus un drapeau global (éteint tant que Paul ne l'a pas
  allumé, selon la décision 3). Écran Réglages, avec une phrase qui dit
  exactement ce qui sort.
- **Juridique** : rédige pour Paul, dans le plan (section 13), le texte de la
  clause « statistiques anonymes » des conditions et du DPA de Yuno CRM
  (`src/data/legalContent.ts` porte le DPA actuel). L'anonymisation est
  elle-même un traitement que l'organisateur doit autoriser.
  - Vérifie aussi ce que les conditions de l'API Shotgun disent de l'usage des
    données. Si tu ne peux pas les lire, dis-le.
  - **Ne publie aucun texte légal** : proposition seulement.

### Lot F — MCP, assistant, aide

- **MCP** (`worker/mcp/*`) :
  - un outil de lecture des hypothèses AGRÉGÉES et de la couverture (niveau
    `analytics`) ;
  - `get_customer_profile` enrichi des hypothèses de la personne (niveau
    `customers`) ;
  - filtres de `list_customers` ;
  - la RPC appelée par `mcp_call` est une RPC déjà gardée.
  - La description d'un outil DÉCRIT ce qu'il rend, elle ne donne jamais
    d'ordre à l'IA (motif de refus des annuaires). La consigne « hypothèses,
    jamais d'affirmation » va dans `INSTRUCTIONS` et le playbook de `guide.ts`.
  - Glossaire mis à jour. Tests : `npx vitest run worker/mcp`.
- **Assistant** : article `crm-*` dans
  `supabase/functions/_shared/console-help-articles.ts`, même vocabulaire.
- **Aide** : FAQ `yc.faq.*` (3 langues) qui explique le test au hasard en mots
  simples, les statuts et ce qui sort du compte.
- **CLAUDE.md** : une section « Yuno CRM — analyse client » qui fixe les règles
  posées ici, dans le style des sections voisines.
- **Mémoire** : un fichier de mémoire projet sur l'état du chantier.

### Lot G — Démo

`scripts/demo/seed-crm-analysis.sql` : rejouable, borné au périmètre démo
(`crm@womber.fr`), joué par `refresh-crm-demo.sh` après `seed-crm-guestlist.sql`.

Il sème des motifs RÉALISTES et mélangés :

- des artistes récurrents et rares ;
- des genres et formats variés ;
- des commandes à plusieurs billets, une partie à détenteurs différents ;
- des délais d'achat contrastés ;
- des gens de passage.

Il doit faire apparaître au moins une famille `supported`, une `not_supported`
et une `untested`. Une démo où tout est confirmé ment.

Adresses sans accent. Aucune vraie identité. **Ne le joue sur la prod qu'avec
le go de Paul, seul, jamais en parallèle d'autre chose.**

## 5. Sécurité (vérifiée, pas supposée)

- Toute fonction SECURITY DEFINER : `search_path` fixé, puis
  `REVOKE … FROM PUBLIC, anon` et `GRANT` explicites.
- Lecture gardée par `crm_scope_allowed`, écriture par `crm_scope_writable`.
  Montants derrière `_crm_money_gate`.
- Données personnelles (hypothèses d'une personne) : seulement pour les rôles
  qui voient déjà les clients nommés. Lis comment `crm_client` filtre
  aujourd'hui et fais pareil.
- Aucune garde ne rend NULL pour un inconnu (piège `IF NOT` avec NULL).
- `= ANY(sous-requête)` interdit, utiliser `EXISTS`.
- Démo matérialisée une fois (`WITH d AS MATERIALIZED`).
- Lecture qui crée des tables temporaires : ajoutée à `demo_preview_writable_rpc`.
- Accès assisté : lecture permise ; exclusion du profilage et réglage de
  contribution refusés.
- **Matrice de rôles** en blocs DO annulés (`RAISE EXCEPTION 'SMOKE_OK'`), avec
  `set_config('request.jwt.claims', …, true)`. Pour chaque RPC nouvelle, les
  cas : inconnu, lecteur, éditeur, titulaire, membre d'un autre compte, super
  admin.
- `has_function_privilege('anon', …)` faux pour tout ce qui est nouveau.
- `supabase db lint --linked` après chaque migration de fonction : les
  « relation does not exist » sur tables temporaires sont des faux positifs, le
  dire.

## 6. Performance

- **Budget** : chaque RPC de lecture sous 1 s sur la démo (environ 2 650
  personnes). Estimation écrite pour un compte à 30 000 billets et 12 000
  contacts.
- **Cron** : jamais sous 30 minutes, lots bornés en temps, un compte à la fois,
  `SKIP LOCKED` si concurrence.
- **Mesure** : `EXPLAIN ANALYZE` de toute requête au-dessus de 1 s. Le test de
  hasard (soirées « au choix ») est le plus coûteux : pré-calcule la liste des
  soirées par compte, jamais une sous-requête par transition.

## 7. Contrôles et livraison

**Contrôles, un par un :**

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run lint                      # 0 erreur, supabase/functions compris
npx vitest run
npm run build
python3 scripts/deno-check-edge.py affiliate-ticket-sync owner-assistant
python3 scripts/check-selects.py
supabase db lint --linked
```

**Tests à écrire :**

- port TS des règles pures s'il en existe ;
- clés i18n présentes en 3 langues ;
- catalogue de segments ;
- MCP ;
- smoke SQL des statuts sur un jeu construit à la main dans un bloc DO annulé.
  Cas : un compte où le hasard explique tout (`not_supported`), un où le
  trait compte (`supported`), un trop petit (`untested`).

**Fin de session, ce que tu rends à Paul :**

1. ce qui est construit, lot par lot, avec les fichiers ;
2. ce qui est vérifié, avec la sortie des commandes, et ce qui ne l'est pas ;
3. les captures ;
4. avec son go : la migration répétée sur la prod dans une transaction ANNULÉE,
   durée et résultat ;
5. l'ordre de mise en ligne : migration, puis front poussé, puis Worker MCP et
   fonctions edge (`affiliate-ticket-sync`, `owner-assistant`), puis semis de
   démo ;
6. les décisions encore ouvertes ;
7. la liste de la suite (relances, « 1re → 2e soirée », audit de soirée, outils
   MCP vides sur CRM) ajoutée au plan.

Pas de push, pas de migration appliquée, pas de déploiement, pas de semis de
démo **sans un go explicite de Paul pour chaque étape**.
