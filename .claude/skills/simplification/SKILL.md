---
name: simplification
description: Méthode Yuno pour rendre un écran, une page ou un parcours plus clair et plus facile à utiliser SANS perdre de données ni d'exactitude — tirée de la refonte d'Analytics (Console Club + Console Organisateur, plan Shotgun, sept.-2026). À utiliser dès qu'on demande de simplifier, clarifier, réorganiser, « rendre lisible », désencombrer, auditer l'ergonomie ou la hiérarchie d'une surface Yuno (dashboard pro, page de données, réglages, formulaire, page publique), quand un pro « ne comprend pas », quand une page empile trop de blocs, d'onglets ou de chiffres, ou quand deux écrans se contredisent. Mots déclencheurs : simplifier, simplification, trop chargé, illisible, pas clair, réorganiser, restructurer, désencombrer, UX, hiérarchie, une page = une question.
---

# Simplification — rendre Yuno lisible sans l'appauvrir

**Principe directeur : simplifier, c'est RANGER, pas RETIRER.** La refonte
d'Analytics n'a supprimé aucune donnée : les 15 zones de l'ancien « Global »
ont toutes trouvé une page qui répond à la question qu'on se pose en les
cherchant. Ce qui a disparu, ce sont les doublons, les contradictions, le
jargon et les chiffres sans définition.

Le cas complet (avant → après, fichiers, erreurs commises) est dans
`references/cas-analytics.md`. La grille d'audit à remplir est dans
`references/grille-audit.md`. Le lexique jargon → mots de pro dans
`references/lexique.md`. Les lire avant de commencer un chantier de taille.

## Quand l'utiliser — et à quelle échelle

| Demande | Profondeur |
|---|---|
| « Ce bloc / cette carte n'est pas clair » | Étapes 3-4 seulement (grammaire + qualité), sur le bloc |
| « Cette page est trop chargée » | Étapes 1 → 7 sur la page |
| « Toute la section X est un fouillis » (Analytics, Marketing, Réglages…) | Méthode complète + plan en lots écrit dans `docs/designs/<SUJET>_SIMPLIFICATION_PLAN.md` |

Toujours respecter le design system de la surface : `docs/DESIGN_SYSTEM.md`
(Console, pro, thème clair ET sombre) ou `docs/DESIGN_SYSTEM_PUBLIC.md`
(public). Ne jamais mélanger.

## La méthode, en huit étapes

### 1. Inventaire — ce qu'il y a VRAIMENT à l'écran

Ouvrir la page (code ET rendu), puis remplir la grille de
`references/grille-audit.md` : une ligne par bloc visible. Pour chaque bloc :
la question à laquelle il répond, sa source de données (RPC ? agrégat
front ?), qui a le droit de le voir, ce qu'il affiche quand c'est vide, et
s'il répète ou contredit un autre bloc.

Chercher en particulier :
- **Doublons à chiffres différents** — le même mot, deux sources (le Hype Score
  répétait les ventes avec le CA billets seul et une autre soirée de
  référence). C'est le pire défaut : le pro croit à une erreur.
- **Contradictions** — « 96 % de récurrence » au-dessus de « 54 % venus une
  fois ».
- **Chiffres sans définition**, **données partielles sans couverture**,
  **totaux sans « aujourd'hui »**.
- **Jargon** (Funnel, ROI, Settlement, Mix revenu, RFM, CTR…).
- **Zéros qui mentent** (« 0 € » sur une soirée gratuite, « 0 % », « rien
  aujourd'hui » sous un total nul, un pilier éteint qui étale ses formules à 0).
- **Titres en double** (la page ET la vue embarquée portent chacune un titre).

Si possible, regarder aussi un concurrent (Shotgun, DICE, Shopify) sur la
même question : on copie sa GRAMMAIRE, jamais ses défauts (cf. « Ce qu'on ne
copie pas » dans `docs/designs/SHOTGUN_COMPETITIVE_PLAN.md`).

### 2. Les questions — réécrire la surface en questions de pro

- **Une page = une question**, formulée comme le pro la pense :
  « Combien ai-je vendu ? », « Est-ce qu'on me voit ? », « Qui sont mes
  clients ? », « Comment se vend cette soirée ? ».
- Regrouper les questions en **familles fixes, 4 au plus**, chacune avec
  **5 vues au plus**. Analytics = Ventes · Trafic · Communauté · En direct.
- Dans une page longue, les sections suivent aussi des questions, **toujours
  dans le même ordre** (Rapport de soirée : ventes → évolution → trafic → qui
  achète → ce qui a fait vendre).
- **L'ordre suit le moment** : avant/pendant la soirée les ventes mènent,
  après la soirée le verdict passe en tête.
- Produire une **table de destination** : chaque bloc de l'inventaire →
  `rangé dans <famille/vue>` | `fusionné avec <bloc>` | `replié sous Détail` |
  `retiré parce que <doublon/contradiction>`. Aucune ligne sans destination :
  c'est la preuve qu'on n'a rien perdu.

### 3. La grammaire de l'écran — la même partout

Toute page d'analyse passe par le kit `src/components/analytics/kit.tsx`
(+ `kitFormat.ts`) et les primitives `src/components/event-report/ui.tsx` ;
on ne redessine pas un chiffre à la main.

| Règle | Brique |
|---|---|
| Le titre de la page / section EST la question, le sous-titre dit comment lire | `Question` (clés `anf.q.*` / `anf.qs.*`) |
| Peu de blocs, gros chiffres : **4 tuiles clés au plus** au-dessus du pli | `StatCard` |
| Chaque total dit ce qui a bougé aujourd'hui | `TodayDelta` (« ▲ 6 aujourd'hui ») |
| Chaque chiffre a UNE phrase de définition | `MetricHint` (clés `gl.*`) |
| Une donnée partielle dit sur combien de personnes elle repose | `CoverageNote` |
| L'écran dit quand il a lu la base | `UpdatedAt` |
| Une liste d'objets se lit en **colonnes fixes** ; une case vide garde l'alignement | `EventMetricsGrid` |
| Résumé → détail : le secondaire est **replié** (« Détail », « Bilan complet ») | bouton de repli (`owner.an.advancedDetail`), `layout="summary"` (`EventPostAnalysisView`), `compact` (`HypeScoreSection`) |
| **Un seul titre par page** : une vue embarquée perd le sien | prop `embedded` |
| Comparer au **même moment relatif** (J-N calendaires), jamais à la même date | `buildCurve` |
| Montants et nombres au format de la langue, jamais `€${n}` | `useNumberFormat` |
| Couleur = statut seulement (rouge à faire / en cours, vert fait, gris en attente) ; le reste en T1/T2/T3 | tokens `KIT` |

Zéros honnêtes (`showsRevenue`, `todayActivity`) : une soirée gratuite montre
ses inscrits, pas « 0 € » ; un total nul n'affiche ni « rien aujourd'hui » ni
« 0 % » ; une soirée passée dit « Fermé » ; un pilier éteint disparaît.

### 4. La qualité des données — non négociable

Simplifier l'affichage ne doit jamais dégrader le chiffre.

- **Un écran = une RPC** qui rend des chiffres déjà calculés. Aucune
  agrégation côté front ; le front met en forme.
- **Mêmes formules, mêmes statuts que la référence** : CA club de
  `src/utils/fees.ts`, remboursements déduits, statuts de la compta. Deux RPC
  qui parlent de « CA » doivent donner le même CA.
- **Une métrique = une définition = une source.** Si deux blocs affichent un
  même libellé, ils lisent la même chose — sinon on en retire un.
- **Portes d'accès recopiées** : le CA ne part qu'à qui voit l'argent (owner,
  manager finance, fondateur, membre `view_finance`) ; un éditeur voit les
  jauges, jamais le CA ; démo exclue là où elle fausse.
- **Seuils de confiance** : une phrase « À retenir » se tait sur une base
  mince ; un agrégat sur des personnes ne sort qu'à partir de 10 par ligne.
- Tout helper pur (navigation, séries, compte à rebours, seuils) a son test
  dans `src/lib/__tests__/`.

### 5. L'adresse — chaque question a une URL

- État dans l'URL, jamais dans un `useState` nu :
  `?tab=<famille>&view=<vue>&event=<id>` (`src/lib/analyticsNav.ts`,
  `useAnalyticsRoute`, `useEventParam`, `useTabParam`).
- Une valeur inconnue retombe sur une page valide, jamais un écran vide.
- **Les anciennes adresses restent valables** (alertes émises, favoris) :
  traduites en un seul endroit, URL réécrite en place ; les anciennes pages
  deviennent des `<Navigate>`.
- Un lien vers une vue se construit par un helper (`eventReportHref`), jamais
  à la main. Un écran qui renvoie ailleurs pointe sur LA vue qui répond.

### 6. La vitesse — une vue ne charge que ses chiffres

- Les hooks de données prennent `enabled` ; la page ne les allume que sur la
  vue qui les lit. **Jamais de verrou de page entière** (70 requêtes en série =
  6 à 25 s pour ouvrir une vue qui n'en avait besoin d'aucune).
- La navigation se rend tout de suite ; seul le contenu de la vue attend,
  sous un squelette (`AnalyticsLoading`).
- Lectures indépendantes en parallèle ; ne pas recalculer deux fois quand une
  liste arrive (attendre `eventsReady`).

### 7. La preuve — joué en vrai, pas supposé

Leçon du 25/09 : tout avait été livré « fini » et rien ne marchait contre la
vraie base. Avant de dire que c'est fait :

1. Migrations appliquées (`supabase db push`, puis `supabase db lint --linked`),
   edge functions déployées, types régénérés (stderr redirigé).
2. Données de démo qui rendent la page vivante
   (`scripts/demo/seed-upcoming-sales.sql`, `node scripts/demo/audit.mjs`).
3. Page pilotée avec un compte démo (`scripts/demo/drive.mjs`) et regardée :
   club ET organisateur, thème sombre ET clair, largeur mobile (contraindre
   le conteneur, Chromium headless ne descend pas sous 500 px), EN/FR/ES.
4. **Test des cinq secondes**, vue par vue : en haut de l'écran, sans défiler,
   le pro a-t-il la réponse à la question du titre ? Sinon, remonter la réponse.
5. `npm run lint`, `npm test`, `npm run build`.

### 8. La propagation — l'écran, l'aide et l'IA disent la même chose

Dans le même chantier (sinon ce n'est pas fini) :
- i18n EN/FR/ES pour chaque clé nouvelle ou renommée ;
- mode d'emploi `ohelp.*` (3 langues, `src/i18n/locales/help/*`) et fils
  d'Ariane quand la structure bouge ;
- articles de l'Assistant Console (`owner-assistant` `HELP_ARTICLES`) qui
  décrivent l'écran tel qu'il est ;
- barres latérales (`buildNavGroups`, `buildOrgNavGroups`, `PATH_CAPABILITY`) ;
- règles durables ajoutées à `CLAUDE.md`, état des lots dans le plan.

## Livrable attendu

1. **Diagnostic** court au pro/à Paul : la grille remplie (résumée), les 3 à 5
   défauts majeurs, la table de destination.
2. **Plan en lots** livrables séparément (kit commun d'abord, puis une
   famille ou une page par lot), écrit dans `docs/designs/` pour un gros
   chantier.
3. **Code** lot par lot, chaque lot vérifié (étape 7) avant le suivant.
4. **Compte rendu** : ce qui a été rangé où, ce qui a été retiré et pourquoi,
   ce qui reste à faire hors code.

## Ce qu'on ne fait pas

- Retirer une donnée juste pour alléger — on la range ou on la replie.
- Ajouter une sixième famille, une troisième colonne de chiffres, un
  troisième bouton d'action : une nouveauté se range sous l'existant.
- Deux titres empilés, deux barres d'en-tête, deux chiffres « à moi » qui
  diffèrent (brut/net) côte à côte.
- Pagination « 1 / 57 », jours de la semaine sans l'heure, violet, jargon.
- Un nouveau composant de chiffre alors que le kit en a un.
- Déclarer « terminé » sans avoir vu la page tourner sur la vraie base.

## Hors analytics

La méthode vaut pour toute surface ; seule l'unité change :
- **Réglages / formulaires** : une page = une TÂCHE ; champs groupés par
  décision, avancé replié, un seul bouton principal.
- **Écran d'action** (publier, envoyer, importer) : une action, étapes
  visibles, résultat en `ActionFigure` (`docs/DESIGN_SYSTEM.md` §16).
- **Page partagée** (co-soirée) : feuille de route en tête, UNE action, trois
  chiffres (§13).
- **Barre latérale** : groupe → entrée → sous-entrée ; une sous-entrée est un
  job, pas un filtre (règles dans `CLAUDE.md`).
- **Pages publiques** : même rigueur de questions et de zéros honnêtes, mais
  esthétique éditoriale de `DESIGN_SYSTEM_PUBLIC.md`.
