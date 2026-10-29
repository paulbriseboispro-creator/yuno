# Banc d'essai de l'analyse client Yuno CRM

Un Postgres en WebAssembly (PGlite) qui rejoue les VRAIES migrations de
l'analyse client sur des comptes synthétiques. C'est ici qu'on met au point et
qu'on mesure le moteur d'hypothèses, le score « Chances de venir » et les
lectures d'écran, jamais sur la prod (machine Nano, vrais clients).

PGlite est plus lent qu'un Postgres natif (WebAssembly, un seul cœur) : les
temps se comparent entre eux, avant / après, pas à la prod.

## Installation

```bash
cd scripts/crm-bench
npm install          # PGlite seulement, hors du package.json de l'app
```

## Commandes

```bash
node run.mjs build             # schéma : prelude + schema/base.sql + migrations du dépôt
node run.mjs gen grand         # un compte synthétique (demo | grand | petit | hasard)
node run.mjs compute grand     # analyse complète + score : statuts des familles, portes
node run.mjs bench grand       # temps des calculs de nuit et des lectures d'écran,
                               # avec les instructions imbriquées les plus lentes
```

Les bases sont gardées dans `.data/` (ignoré par git) : `schema`, puis un
fichier par compte généré, puis `<compte>-computed` après `compute`.

## Trafic (crm_ana_clicks, 27/10)

```bash
node run.mjs build && node run.mjs gen demo
node traffic.mjs demo            # sème liens, clics, e-mails, pages /j/, puis lit le Trafic
node rehearse.mjs smoke/traffic.sql 20261112100000_crm_link_clicks_in_app.sql \
  20261112105000_crm_signup_go_link.sql 20261112110000_crm_ana_clicks.sql \
  20261112120000_crm_ana_traffic_links_messages.sql   # la prod, annulée
```

Le schéma du banc s'arrête avant les Scénarios : `traffic.mjs` recopie de la prod
(lecture seule) les fonctions plus récentes que lit `crm_ana_clicks`, puis rejoue
les migrations du Trafic. `smoke/traffic-capture.sql` rend (annulé) les réponses
réelles du compte démo, pour un banc d'écran.

## « Vos acheteurs » (exception clients, lot 1, 29/10)

```bash
node customer-basis.mjs roots    # racines lues dans la migration 20261114100000
node customer-basis.mjs dump     # définitions de la prod (lecture seule)
node customer-basis.mjs          # 63 vérifications : éligibilité, déclaration, oppositions, garde, droits
node rehearse.mjs smoke/customer-basis.sql 20261114100000_crm_customer_basis.sql   # la prod, annulée
```

Le compte synthétique couvre chaque cas de la règle (champ absent, jamais coché,
accord retiré, soirée co-organisée, invitation, entrée gratuite, plus de 36 mois,
adresse supprimée, désabonné dans la Billetterie, accord, opposition transmise,
remboursé, effacé, casse). La répétition rend, par espace, les comptes et le temps
du calcul (0,6 s sur 46 000 billets).

## Ce que contient le schéma

1. `schema/prelude.sql` : ce que Supabase fournit autour de `public` (rôles,
   `auth.uid()` / `auth.jwt()` / `auth.role()` lus dans `request.jwt.claims`,
   `auth.users`, un `cron.schedule` qui note sans rien lancer, pgcrypto).
2. `schema/base.sql` : GÉNÉRÉ par `dump-base.mjs` depuis la prod (lecture
   seule) : les tables (colonnes, défauts, index uniques ; ni clés étrangères ni
   RLS) et les fonctions dont les migrations de l'analyse ont besoin, fermeture
   comprise. Aucune donnée.
3. Les migrations du dépôt à partir de `FIRST_MIGRATION` (`config.mjs`),
   rejouées telles quelles. Une migration nouvelle de l'analyse est donc
   testée au banc dès qu'elle est écrite.

`check_function_bodies` est coupé : une fonction qui cite une table absente du
banc est créée, et n'échoue que si on l'appelle.

Régénérer la base (une migration plus ancienne a changé une fonction lue par
l'analyse, ou on mesure un nouveau point d'entrée — `EXTRA_ROOTS`) :

```bash
node prod.mjs --activity       # rien de lourd ne tourne ?
node dump-base.mjs && node run.mjs build
```

## Les comptes synthétiques (`profiles.mjs`, `gen.mjs`)

Une vérité cachée décide qui vient à quelle soirée : fidèles et occasionnels,
départs (durée de vie géométrique), récence, artiste invité déjà vu, concept
(série), genre préféré, jour habituel, invité populaire qui recrute, habitude
d'achat (tôt / milieu / dernière minute), groupes (commandes à plusieurs, billets
nominatifs ou non), invitations, distance (codes postaux réels de
`crm_postal_codes_fr`, étrangers). Graine fixe : un profil rend toujours le
même compte.

| Profil | Contacts | Billets | Soirées | Rôle |
|---|---|---|---|---|
| `demo` | ~2 500 | ~7 400 | 29 + 4 à venir | ordre de grandeur de crm@womber.fr |
| `grand` | ~11 900 | ~30 800 | 60 + 4 | gros organisateur, cible de temps |
| `petit` | ~300 | ~570 | 10 + 4 | doit rester « à tester » |
| `hasard` | ~2 900 | ~6 000 | 40 + 4 | aucun effet planté : rien ne doit être confirmé |
| `amoris` | ~18 800 | ~60 000 | 280 + 1 | taille du premier vrai compte (4 ans d'historique) : calcul de nuit |

Les achats FUTURS des soirées à venir (ce que la billetterie ne sait pas
encore) sont dans `bench_future` : c'est la réalité contre laquelle on mesure
la projection de remplissage et le score sur les soirées à venir.

## Lire la prod (lecture seule)

```bash
node prod.mjs --activity                 # pg_stat_activity, AVANT toute requête lourde
node prod.mjs "SELECT count(*) FROM crm_person_profile"
node prod.mjs -f requete.sql
```

Chaque requête part dans une transaction `READ ONLY` (une écriture lève une
erreur). Jeton : `SUPABASE_ACCESS_TOKEN` de `.env.local`, jamais affiché.

La prod est-elle le dépôt ? (lecture seule, quelques secondes)

```bash
node prod-functions-reference.mjs scan      # toutes les fonctions applicatives de la prod
node prod-functions-reference.mjs list      # identiques / réécrites / absentes / plus anciennes, d'où vient le texte
node prod-functions-reference.mjs report ../../docs/audit/…/ops04-functions.md ../../supabase/reference/<date>_prod_functions_reference.sql
node history-holes.mjs scan && node history-holes.mjs report <md>   # tables, triggers, policies, crons sans création dans le dépôt
node isolation.mjs run --club <md>          # séparation entre deux espaces CLUB (sans --club : deux organisateurs)
```

La référence générée vit hors de `supabase/migrations` : `db push` ne la joue
jamais. La rejouer après de nouvelles migrations annulerait celles-ci.

## Correctifs de l'audit du 18/10 : avant / après sur les définitions de la prod

```bash
node sec06.mjs dump && node sec06.mjs run <md>    # gardes du règlement promoteur (20261024100000)
node sec07.mjs run <md>                           # colonnes qu'un promoteur écrit dans sa fiche (20261025200000), après sec06 dump
node link01.mjs scan                              # tout quantificateur {n,m} > 255 de la prod
node link01.mjs dump && node link01.mjs run <md>  # capture d'une story sur un lien (20261024100100)
node sec09.mjs dump && node sec09.mjs run <md>    # promoteur d'une vente et promoteurs d'agence (20261026100000 + 100100, checkouts)
```

`dump` prend un instantané de la prod (dump-base.mjs en mode instantané, plus
policies, triggers, contraintes et droits des fonctions pour SEC-06) ; `run`
joue chaque scénario sous l'identité de l'API, AVANT puis APRÈS la migration,
puis le smoke de répétition (`smoke/sec06.sql`, `smoke/link01.sql`,
`smoke/sec07.sql`, `smoke/sec09.sql`) qui servira
à `rehearse.mjs` sur la prod. PGlite ne rend pas la session d'origine après un
`RESET SESSION AUTHORIZATION` ni au `ROLLBACK` : ces scripts changent
d'identité par `SET LOCAL` seulement et repassent par `SET SESSION AUTHORIZATION
postgres` entre deux scénarios.

## Mettre en ligne (jamais par ces scripts)

1. Vérifier que la prod = le dépôt pour chaque fonction réécrite : lire
   `pg_get_functiondef` sur la prod et le comparer au DERNIER fichier de
   migration qui la définit.
2. Répéter la migration sur la prod dans une transaction annulée.
3. Avec le « go » de Paul : une transaction qui contient le fichier ET sa
   ligne `supabase_migrations.schema_migrations`, puis `db lint`.

## Comparer avant / après une migration

`BENCH_UNTIL=<version>` construit, génère et calcule SANS cette migration ni
les suivantes ; `diff.mjs` compare ensuite les tables calculées des deux bases.

```bash
BENCH_UNTIL=20261013100000 node run.mjs build
BENCH_UNTIL=20261013100000 node run.mjs gen grand
BENCH_UNTIL=20261013100000 node run.mjs compute grand
node run.mjs build && node run.mjs gen grand && node run.mjs compute grand
node diff.mjs grand-before-20261013100000-computed grand-computed
```

## Témoin, journal, droits

```bash
node run.mjs journal demo      # relevé, achats futurs rejoués, règlement 70 j plus tard
node journal-report.mjs demo-journal   # le détail : perte log, Brier, projection décomposée
node run.mjs holdout demo      # envoi « Qui cibler » e-mail + SMS, témoin, mesure (test A/A)
node security.mjs              # qui peut exécuter quoi (anon, autre compte, titulaire)
```

## Essayer un réglage du score

```bash
# un autre tirage du même profil, ou un réglage du générateur (essai, écrase la base du profil)
BENCH_PROFILE='{"seed":24}' node run.mjs gen grand
# un réglage du score pour le journal (config.score de la base du banc seulement)
BENCH_SCORE='{"timing_prior":1}' node run.mjs journal demo
# ablation : le score seul, recalculé sur des comptes déjà analysés, un réglage à la fois
node ablate.mjs demo-computed,grand-computed '{}' '{"l2":10}' '{"off":[]}'
```

Une soirée passée ne juge pas un réglage : les 4 soirées tenues à l'écart
varient de ±35 % chacune au banc. Comparer sur plusieurs comptes (`demo` et
au moins 3 tirages de `grand`) avant de garder quoi que ce soit.

La commande `journal` ABAISSE les portes du score dans la base du banc pour
qu'il note (le compte synthétique est `weak`) ; jamais ailleurs. Au banc, un
envoi ne change aucun achat : le gain mesuré par `holdout` doit être nul
(|z| < 2), c'est la preuve que la mesure n'invente pas d'effet.

## Le calcul de nuit du score, sur les définitions de la prod

Le cron `crm-score-nightly` tourne sous le délai de 120 s de la prod
(`statement_timeout` du fichier de configuration). `score-nightly.mjs` le
rejoue sur un instantané des définitions de la PROD (pas des migrations du
dépôt, qui ont pris du retard sur quatre fonctions du score), à la taille d'un
vrai compte :

```bash
node prod.mjs --activity
node score-nightly.mjs dump                 # instantané (lecture seule) + seuils actifs
node score-nightly.mjs gen amoris           # compte + analyse complète (~1 min)
node score-nightly.mjs run amoris --open ../../supabase/migrations/<m>.sql
node score-nightly.mjs warm amoris --open   # le lendemain : modèle d'hier, journal entamé
node score-nightly.mjs run amoris-warm ../../supabase/migrations/<m>.sql
```

`run` joue le calcul AVANT puis APRÈS les migrations dans une seule
transaction (même `now()`, état de départ rétabli entre les deux, puis
annulée), donne les instructions les plus lentes de chacun et compare ligne à
ligne les six tables que le score écrit : modèle, chances, étiquettes,
journal prévu / réel. `--open` abaisse les portes du score dans la base du
banc pour que la note et le journal tournent (le compte synthétique est
« weak »). `diff.mjs`, qui compare deux bases calculées à des moments
différents, ne convient pas ici : la part restante des achats dépend de
`now()`. `--nightly` fait passer les deux calculs par `crm_score_nightly` (la
passe du cron, qui choisit la portée et attrape les dépassements) au lieu de
`crm_score_compute`.

Une portée qui ne tient pas dans le temps (PERF-02) :

```bash
node score-nightly.mjs overrun amoris-warm ../../supabase/migrations/20261027100000_crm_score_fit_once_per_row.sql \
  ../../supabase/migrations/20261028100000_crm_score_nightly_overrun.sql
```

rejoue des passes de nuit, chacune dans sa transaction comme en prod, avec le
compte en tête de file et une petite portée vide derrière : budget abaissé
(`score.budget_s` = 3 s), puis délai de l'instruction simulé (PGlite n'a pas
de minuteur : le journal lève `query_canceled` à la place du minuteur, à
l'étape où la prod a coupé le 18/10), puis annulation à la main (même erreur,
bien avant le délai), puis le temps rendu. Chaque passe vérifie que la portée
lente garde ses chances d'hier (six tables, ligne à ligne), que la suivante
est notée, que l'alerte ne part qu'une fois par nuit et que, la nuit suivante,
la portée lente ne passe plus en premier.

## Scénarios (automatisations sur mesure)

```bash
node scenarios.mjs conditions          # langage « et / ou » : cas partagés avec le
                                       # miroir TypeScript, effectifs compilés
```

Le script ouvre une base déjà analysée (`demo-computed` par défaut) et y
applique les migrations des Scénarios (`20261016100000` et suivantes) avant
les essais. Plan : `docs/designs/CRM_JOURNEYS_PLAN.md`.
