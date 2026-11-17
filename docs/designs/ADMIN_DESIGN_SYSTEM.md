# Admin Yuno : système de design v3 (17/11/2026)

La v2 était propre et monotone : chaque page = six tuiles égales + un graphique
Recharts + un tableau, dans des cartes bordées. Aucune hiérarchie, aucune forme
propre à la question. La v3 compose chaque page pour SA question.
Page vivante : **`/admin/system/ui`** (toutes les primitives, données d'exemple).
Code : `src/admin/ui/` (tokens `--a-*` dans `admin.css`, dessins SVG dans `viz/`).

## Ce qu'on a lu, et ce qu'on en garde

| Source | Ce qu'on retient |
|---|---|
| Stephen Few, *Information Dashboard Design* | Un écran se lit d'un coup d'œil ; le plus important en haut à gauche, en plus grand ; un chiffre sans contexte (comparaison, objectif) ne dit rien ; bullet graph plutôt que jauge ; sparklines pour la tendance ; les erreurs classiques (décoration, couleurs inutiles, contexte absent, tout au même poids). |
| Edward Tufte | Rapport encre / donnée : retirer bordures, fonds, grilles lourdes ; small multiples sur un même axe ; étiquetage direct plutôt que légende ; sparklines de la taille d'un mot. |
| Gestalt, attributs préattentifs | Proximité et alignement groupent mieux que des boîtes ; couleur, taille et position se voient avant la lecture : n'en mettre qu'UNE en avant par page. |
| Bach et al., *Dashboard Design Patterns* (IEEE VIS 2022) | Penser en patrons : abstraction (valeur, tendance, détail), méta (période, référence, filtre), structure (hiérarchie, ouverture du détail), interaction (survol, sélection, navigation). |
| Stripe Dashboard / Sigma | Une grande valeur, sa courbe juste dessous, la période précédente en gris, la plage qu'on glisse. Des chiffres qui ouvrent leur liste. |
| Linear | Boîte de traitement : liste dense à gauche, contexte à droite, j / k / e, « ? » pour l'aide ; barre latérale repliable ; rien de décoratif. |
| Superhuman | Traiter une file au clavier sans quitter l'écran ; l'action principale toujours au même endroit. |
| Vercel Observability, Datadog, Grafana | Feu d'état = un point + un mot, regroupés dans une barre ; la santé lisible partout, pas sur une seule page. |
| Statuspage | Disponibilité = 30 barres d'un jour, couleur selon l'état, survol pour le détail. |
| Amplitude, Mixpanel | Entonnoir en étapes horizontales, la perte écrite entre deux étapes ; cohortes en triangle teinté. |
| Baremetrics, ChartMogul | MRR en cascade (nouveau, expansion, perte) ; composition d'un revenu en barre à 100 %. |
| Observable Plot, visx | Dessiner sur mesure en SVG quand une bibliothèque impose sa forme : marques fines, une échelle, étiquettes directes. |
| skill `dataviz` | Une seule échelle par graphique ; grand chiffre en chiffres proportionnels, colonnes en tabulaires ; réticule qui suit l'axe X ; texte en encre, jamais en couleur de série ; couleurs d'état réservées. |

## Douze règles

1. **Un héros par page.** En tête, LA réponse : une phrase calculée, un grand chiffre
   (56 px, chiffres proportionnels, interlettrage −0,03 em), son graphique collé dessous.
2. **Tout le reste pèse moins.** Bande de stats sans boîtes (libellé 11 mono, valeur 20,
   écart, mini-courbe) ou small multiples sur le même axe du temps.
3. **Moins de boîtes.** Espace, filets fins et titres de section. Une carte seulement
   pour un objet qu'on manipule (ligne de file, compte, dialogue). Jamais une carte dans une carte.
4. **La forme suit la question.** Composition = barre à 100 % ; passage d'un total à un
   autre = cascade ; rétention = triangle teinté ; seuil = bullet ; santé = barres de
   disponibilité ; activité = calendrier ; classement = barres triées ; mois = cellules teintées.
5. **Étiqueter directement**, légende seulement au-delà de quatre séries. Annoter ce qui
   compte (pic, creux). Un repère quand il existe (moyenne, période précédente, objectif).
6. **Le rouge porte l'attention**, rien d'autre : la courbe du héros, le filet sous le
   titre, la sélection, le bouton principal. Une baisse s'écrit en encre neutre.
7. **Deux voix.** Geist Sans pour les phrases, Geist Mono pour les étiquettes de données,
   unités, dates d'axe et petits chiffres (le ton « instrument »).
8. **Densité variable.** Dense où l'on scanne (file, tableaux), aéré où l'on lit (héros).
9. **Tout chiffre ouvre sa liste** dans un tiroir ou sa page filtrée, le filtre écrit en clair.
10. **Vivant.** Réticule et valeurs alignées au survol ; survol synchronisé entre small
    multiples ; glisser sur le héros change la période ; transitions ≤ 150 ms ;
    `prefers-reduced-motion` respecté.
11. **Clavier.** `g` + lettre pour changer de rubrique, `j / k` dans une liste, `e` traité,
    `l` plus tard, `entrée` action, `[` replie la barre, `?` l'aide.
12. **Jamais vide, jamais cassé.** Yuno a de petits volumes : un point seul, des zéros ou
    un total nul se disent en phrase (« aucune vente cette semaine »), jamais une courbe
    plate sans un mot, jamais un pourcentage sur une base de deux.

## Tokens

Ceux de la v2 restent (sable chaud, rouge Radix à 12 pas, états, palette de
graphiques validée). La v3 ajoute :

| Rôle | Valeur |
|---|---|
| Fond sombre | noir chaud `#0e0d0c` (page), `#161514` (panneau) |
| Fond clair | papier `#faf9f6`, panneau `#ffffff` |
| Héros | 56 px / 600 / −0,03 em ; phrase 15 px encre 2, chiffres de la phrase en encre 1 |
| Bande de stats | libellé mono 11 px, valeur 20 px, écart 12 px, filets verticaux |
| Teinte de cellule | `color-mix(var(--a-accent) N %, transparent)`, N de 0 à 30 selon la valeur |
| Disponibilité | ok `--a-pos`, incident `--a-warn`, panne `--a-neg-soft`, inconnu `--a-grid` |

## Primitives (src/admin/ui, dessins dans `viz/`)

`Hero` (phrase, grand chiffre, écart, graphique) · `HeroChart` (SVG : série rouge,
période précédente en pointillé gris, réticule, annotations pic / creux, plage glissée)
· `StatStrip` · `SmallMultiples` + `HoverSync` · `Sparkline` · `BulletBar` ·
`Waterfall` · `StackedShare` · `Heatmap` / `CohortGrid` · `CalendarHeat` · `RankBars`
· `UptimeBars` · `FunnelSteps` · `SplitView` · `DrillDrawer` · teinte des cellules de
`DataTable` (`meta.tint`) · repères dans `Chart` (`refs`) · raccourcis globaux et leur
aide · barre latérale repliable · barre de pouls (paiements, e-mail, tâches, apps,
ventes du jour) dans l'en-tête, visible partout.

## Composition par rubrique

```
AUJOURD'HUI (boîte de traitement)
┌ Brief : « 5 décisions, dont 2 urgentes. Hier : 612 € vendus, 2 comptes créés. » ┐
├ File (groupée par urgence, j/k/e/l) ─────────┬ Contexte de la ligne choisie ────┤
│ ● Maintenant                                  │ Pourquoi elle est là             │
│ ● Cette semaine                               │ Le compte : faits clés           │
│ ● Quand c'est possible                        │ [Action] [Traité] [Plus tard]    │
├───────────────────────────────────────────────┴──────────────────────────────────┤
│ La semaine : six small multiples synchronisés                                     │
│ Fil d'activité en frise compacte                                                  │
└───────────────────────────────────────────────────────────────────────────────────┘

PILOTAGE › VUE D'ENSEMBLE
┌ Héros : revenu de Yuno, phrase, 56 px, courbe vs période précédente, plage ┐ Composition 100 % ┐
│                                                                             │ Cascade           │
├ Cinq small multiples sur les 12 mois (ventes, MRR, pros qui vendent, acheteurs, nouveaux pros) ┤
├ 12 mois en cellules teintées ─────────────────────┬ Concentration : barres triées ──────────────┤
```

| Rubrique | Composition prévue |
|---|---|
| Pilotage › Acquisition | Héros « comptes créés » + FunnelSteps (perte écrite) ; sources en RankBars. |
| Pilotage › Rétention | Héros « encore actifs à 3 mois » ; CohortGrid ; courbe moyenne en repère. |
| Pilotage › Audience | Héros « acheteurs » ; CalendarHeat des visites ; villes en RankBars. |
| Pilotage › Produit | Signaux en StatStrip ; usage par page en RankBars ; IA en barres de coût. |
| Pros › Tous les comptes | Tableau dense + SplitView (fiche à droite) ; grille récence × ventes. |
| Pros › Fiche | Héros « ce que ce compte vend », mois teintés, frise des faits. |
| Pros › Prospects | SplitView comme la file ; pipeline en colonnes ; FunnelSteps. |
| Clients | Grille récence × fréquence cliquable (segments) ; fiche en SplitView. |
| Argent › Ventes | Héros « ventes » ; Waterfall ventes → frais → revenu ; jours en CalendarHeat. |
| Argent › À régler | Boîte de traitement ; délais en BulletBar. |
| Argent › Yuno CRM | Héros MRR ; cascade du MRR ; Yunits en StackedShare. |
| Communication | Délivrabilité : BulletBar par seuil (plaintes, rebonds) ; envois en CalendarHeat. |
| Légal | File d'obligations en SplitView ; échéances en BulletBar de délai. |
| Système › Santé | UptimeBars par service sur 30 jours ; tâches planifiées en grille d'état. |

## À faire / à ne pas faire

| À faire | À ne pas faire |
|---|---|
| Une phrase-réponse au-dessus du grand chiffre | Six tuiles de même poids en tête |
| Un filet fin et de l'espace entre deux blocs | Une carte bordée autour de chaque bloc |
| L'étiquette au bout de la barre ou de la courbe | Une légende à décoder pour deux séries |
| `↘ −12 %` en encre neutre | Une baisse en rouge |
| Un chiffre qui ouvre sa liste | Un chiffre mort |
| « Aucune vente cette semaine » | Une courbe plate à zéro sans un mot |
| Une couleur = une variable `--a-*` | Un hexadécimal dans une page |
