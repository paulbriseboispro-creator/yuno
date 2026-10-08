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
