# PROMPT — Yuno CRM : prouver que l'analyse client et la prédiction marchent

> À coller tel quel dans une session NEUVE de Claude Code, dans
> `/Users/paul/Desktop/yuno-app.nosync`. Écrit le 2026-10-08.

Tu reprends l'analyse client de Yuno CRM (« Ce qui fait venir », « Qui
cibler », « Chances de venir », groupe témoin, journal prévu / réel). Elle est
en ligne et protégée, mais elle n'a été mesurée que sur des données
fabriquées, et son test d'hypothèses a un défaut de méthode. Ton travail :
**corriger ce défaut, ne montrer que des chiffres vérifiés, puis juger le
système sur un vrai compte**. Chaque changement se prouve au banc par un
chiffre avant la prod. Tu n'ajoutes aucune fonctionnalité visible hors du plan.

Rien n'est poussé sur `main`, aucune migration n'est appliquée en production,
aucune fonction n'est déployée **sans un « go » explicite de Paul dans la
conversation**. Le mode auto refuse ces actions : quand tu en es là, demande à
Paul de passer la session en « Demander les permissions », ou d'ouvrir et
fusionner la pull request lui-même.

---

## 0. Avant d'écrire une ligne

### Lire

1. **Le plan à exécuter** : `docs/designs/CRM_ANALYSIS_PROOF_PLAN.md` (branche
   `crm/analysis-proof`). Ses décisions sont PRISES : ne les repose pas, sauf le
   libellé du lot 2, à faire valider par Paul avant de l'écrire.
2. `CLAUDE.md` en entier ; surtout « Yuno CRM — analyse client : « Ce qui fait
   venir » » (moteur, score, optimisation, textes légaux), « Backend Supabase —
   gotchas critiques », « Comptes démo », « Règles de travail ».
3. `docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md` (mesures, décisions ouvertes),
   `docs/designs/CRM_PREDICTION_SCORE_PLAN.md`, `scripts/crm-bench/README.md`,
   `docs/legal/CRM_ANALYSE_CLIENT_REVUE_JURIDIQUE.md` (promesses faites aux pros).
4. Les migrations de l'analyse, dans l'ordre : `20261010100000` → `150000`,
   `20261011100000` → `130000`, `20261012100000` + `110000`, `20261013100000`
   → `120000`, `20261014100000` → `130000`. Le test d'affinité est dans
   `_crm_an_engine` (dernière version : `20261014110000_crm_hypothesis_fdr.sql`,
   table `_anch` puis `p = avg(val)`).
5. La mémoire : `/Users/paul/.claude/projects/-Users-paul-Desktop-yuno-app-nosync/memory/MEMORY.md`,
   puis au minimum `crm-client-analysis-2026-10-07.md`,
   `crm-legal-v1-2026-10-08.md`, `discuss-naming-before-writing.md`,
   `crm-unmeasurable-shows-soon.md`, `no-parallel-heavy-checks.md`,
   `supabase-free-plan-nano-outage.md`, `prod-db-saturation-concurrent-smokes.md`,
   `never-git-stash-shared-worktree.md`, `concurrent-sessions-share-worktree.md`,
   `rtk-hook-fabricates-file-content.md`, `tsc-noemit-checks-nothing.md`,
   `sql-smoke-test-rolled-back-do-block.md`, `rehearse-migration-rolled-back-on-prod.md`,
   `deploy-edge-from-clean-main.md`, `preview-from-worktree.md`.

### Préparer la branche

- D'autres sessions travaillent dans le dossier principal : **ne touche pas à
  son arbre de travail, jamais de `git stash`**. Reprends le worktree
  `/Users/paul/Desktop/yuno-crm-proof.nosync` (branche `crm/analysis-proof`, qui
  porte le plan), après `git fetch origin` ; si `origin/main` a avancé (la PR
  paulbriseboispro-creator/yuno#14 des textes légaux, par exemple), rebase
  dessus avant de commencer.
- `git add <fichiers précis>`, jamais `-A`. Un commit = un changement logique.
- `ln -s /Users/paul/Desktop/yuno-app.nosync/node_modules node_modules` et
  `.env.local` dans le worktree s'ils manquent ; `cd scripts/crm-bench && npm install`
  pour le banc.

### Hygiène de la machine et de la prod

- **Un seul contrôle lourd à la fois** (tsc, eslint, vitest, build, deno check,
  banc, requête SQL).
- Sortie de shell suspecte (« N matches in 0 files ») : relancer avec `rtk proxy`.
- **Prod Supabase** (machine Nano, 426 Mo, vrais clients) : `node prod.mjs --activity`
  avant toute requête lourde, une à la fois, jamais pendant la migration d'une
  autre session, aucun cron plus fréquent que toutes les 30 minutes.
- Toute réécriture de fonction repart de la définition de la PROD :
  `node same-as-prod.mjs --before <version>` doit dire « identique » avant
  d'écrire la migration.
- Migration : horodatage strictement supérieur à tout ce qui existe
  (`git fetch origin`, toutes les branches, registre de la prod). Répétition
  dans une transaction annulée (`rehearse.mjs`), lint `plpgsql_check` dans un DO
  annulé ; appliquer = UNE transaction avec le fichier ET sa ligne
  `supabase_migrations.schema_migrations` ; `NOTIFY pgrst` seulement si une
  signature visible par l'API change.

## 1. Les règles qui ne bougent pas

- **On n'affirme jamais pourquoi quelqu'un vient** : une hypothèse est un fait
  + un statut. Mots interdits : « vient pour », « fan de », « aime », « son
  ami », « il préfère » (test `src/crm/lib/__tests__/analysis.test.ts`).
- **Rien d'estimé sans le dire** : un chiffre non vérifié ne s'affiche pas, ou
  s'affiche « Estimation ». Une donnée que Shotgun ne rend pas = « Bientôt ».
- **Promesses des textes légaux** (Conditions Yuno CRM art. 6, accord de
  sous-traitance art. 12.4) : l'analyse et le score n'utilisent ni le genre ni
  les ouvertures ou clics d'e-mails ; jamais de pourcentage individuel ; rien
  dans un export ; jamais pour un prix, une remise, une prévente ou l'entrée.
  Une modification qui casserait une promesse s'arrête et se discute avec Paul.
- **Opposition** : une personne exclue du profilage (`crm_profile_optouts`)
  n'entre dans aucun calcul.
- **Démo** : le semis `scripts/demo/refresh-crm-demo.sh` se rejoue SEUL ; si une
  famille plantée tombe après ta correction, on règle le semis, jamais le moteur.
- Textes : 3 langues (triplets [EN, FR, ES]), vouvoiement, une phrase courte ;
  un nom nouveau se discute avec Paul avant d'être écrit.

## 2. Ce qu'il faut faire, dans l'ordre

Suis les lots du plan. Pour chacun : mesurer au banc, écrire les chiffres dans
la section « Mesures » du plan, commiter, puis demander le « go ».

1. **Lot 1a** — profil `populaire` et `nightPull` dans le générateur ; prouver
   (3 tirages) que le test actuel confirme une affinité qui n'existe pas. Si
   ce n'est pas le cas, le dire à Paul avant de corriger.
2. **Lot 1b** — variantes A (autres acheteurs) et B (nouveaux venus) du tirage
   pondéré, lues dans `crm_analysis_config()` ; les cinq critères du plan sur
   `populaire`, `hasard`, `demo`, 3 tirages de `grand`, `petit` ; temps.
   Présenter à Paul le tableau et la variante retenue.
3. **Lot 1c** — migration (rules v2), répétition prod annulée sur la démo,
   textes, aide, assistant, MCP, CLAUDE.md. « Go » de Paul, puis : appliquer la
   migration, pull request du front, `owner-assistant` redéployée depuis un
   worktree propre à la branche fusionnée (`supabase functions deploy
   owner-assistant --use-api`, une fonction par commande, vérifier par
   `functions download` que la prod = la branche), semis démo rejoué, smoke.
4. **Lot 2** — écart des clients connus dans le règlement du journal (s'il
   manque), `_crm_expected_gate`, `crm_night_targets`, écran « Qui cibler »,
   MCP et assistant. Faire valider le libellé par Paul avant de l'écrire. Même
   chemin de mise en ligne.
5. **Lot 3** — seulement quand Paul dit que Kevin / WOH a connecté Shotgun.
   Mesures en lecture seule, le tirage `uniform` contre pondéré dans une
   transaction annulée, le score, le compte rendu chiffré dans le plan, les
   décisions pour Paul. Aucune donnée personnelle dans le compte rendu.
6. **Lot 4** — `scripts/crm-bench/readout.mjs` et les règles de verdict écrites
   AVANT de lire les chiffres ; point d'étape à 4 soirées, verdict à 8.

## 3. Avant chaque « go », et à la fin

- `npm run lint` (0 erreur), `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`
  (0 erreur), `npm run build` avec `set -o pipefail` ; `deno check` des fonctions
  edge touchées. Un à la fois.
- Vérifier en vrai sur la démo avec `scripts/demo/drive.mjs --as crm --go <url>`
  ou le panneau navigateur (`preview-from-worktree.md`) : Analyses › Communauté
  `?v=why`, le tiroir d'une soirée (`?v=why`, `?v=target`), la fiche d'un client.
- Mettre à jour le plan (mesures, état), CLAUDE.md, la mémoire
  (`crm-client-analysis-2026-10-07.md` ou une nouvelle note datée) et dire à
  Paul, en clair, ce qui est en ligne, ce qui attend son « go » et ce que les
  chiffres disent du système.
