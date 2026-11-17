# Admin Yuno : système de design (17/11/2026)

Une page de référence pour tout écran de `/admin`. Elle se voit en vrai sur la
page cachée **`/admin/system/ui`** (toutes les primitives, tous les graphiques).
Code : `src/admin/ui/` (tokens `--a-*` dans `admin.css`).

## Sources

Radix Colors (échelles à 12 pas, rôle de chaque pas : 1-2 fonds, 3-5 composants,
6-8 bordures, 9-10 aplats, 11-12 texte) ; Stephen Few (un coup d'œil, haut à
gauche = le plus important, contexte d'un chiffre = sa comparaison, couleur rare) ;
IBM Carbon (palette catégorielle courte et ordonnée, statuts réservés, jamais la
couleur seule) ; Linear / Vercel / Stripe (neutres, un accent, densité de
tableau, en-tête fin) ; Refactoring UI (hiérarchie par le poids et le gris avant la
couleur). Palettes de graphiques passées au validateur de la skill `dataviz`
(bande de luminosité, chroma, écart en vision normale et daltonienne, contraste).

## Principes

1. **Le rouge est le seul accent**, et il est rare : bouton principal, entrée de
   menu active, anneau de focus, onglet actif, série principale d'un graphique.
2. **Le rouge ne veut jamais dire « mauvais ».** Un écart négatif s'écrit en encre
   neutre avec sa flèche vers le bas ; un écart positif en vert sobre. Un état se
   dit par un mot + une pastille ou un badge : ambre = « à traiter / attention »,
   aplat bordeaux plein = « en retard / en échec / critique ». Jamais la couleur seule.
3. **Une page = une question** : en-tête (question, une ligne de sous-titre,
   période et actions à droite) → 4 à 6 chiffres → le graphique principal → la
   liste → le détail replié.
4. **Hiérarchie par le gris et le poids** avant la couleur. Trois niveaux d'encre.
5. **Clair et sombre soignés pareil** : le sombre a ses propres pas, pas une inversion.

## Tokens (couleur)

| Rôle | Clair | Sombre |
|---|---|---|
| Fond de page / carte / carte imbriquée | `#f9f9f8` / `#ffffff` / `#f4f3f1` | `#111110` / `#191918` / `#222221` |
| Bordure / forte | `#e7e5e2` / `#d2d0cb` | `#2a2a28` / `#3b3a37` |
| Encre 1 / 2 / 3 | `#21201c` / `#63635e` / `#6f6d66` (5,2:1) | `#eeeeec` / `#b5b3ad` / `#8f8d86` (5,3:1) |
| Accent (aplat, texte blanc) | `#d42b38` (blanc 5,0:1) | `#d42b38` |
| Accent survol / doux / texte | `#c01f2d` / `#feebec` / `#c01f2d` | `#e5484d` / `#3b1219` / `#ff8f8a` (8,0:1) |
| Positif (texte) | `#218358` (4,5:1) | `#3dd68c` |
| Attention « à traiter » | ambre `#9a5b00` sur `#fff7c2` (5,0:1) | `#ffca16` sur `#302008` |
| Critique (badge plein) | blanc sur `#9b1c25` (8,1:1) | `#ffd1d9` sur `#641723` (9,1:1) |

Échelle de rouge complète (12 pas, Radix red, pas 9-10 assombris pour porter du
blanc en AA) : clair `#fffcfc #fff7f7 #feebec #ffdbdc #ffcdce #fdbdbe #f4a9aa
#eb8e90 #d42b38 #c01f2d #c01f2d #641723` ; sombre `#191111 #201314 #3b1219
#500f1c #611623 #72232d #8c333a #b54548 #d42b38 #e5484d #ff8f8a #ffd1d9`.
Neutres : Radix « sand » (gris légèrement chaud).

## Typographie

Geist Sans / Geist Mono. Cinq tailles : **12** (libellés, en-têtes de tableau,
notes), **13** (tableaux, boutons, champs), **14** (texte courant), **16** (titre
de section), **22** (titre de page). Chiffres des tuiles **26 demi-gras
tabulaires** ; tout nombre en `tabular-nums`. Pas de capitales espacées, sauf les
en-têtes de tableau (12, gris, sans capitales chez nous).

## Grille et espacements

Page centrée, **1280 px** max, gouttière 32 px (20 px mobile). Base 4 :
8 / 12 / 16 / 24 / 32. Entre deux blocs d'une page : 24. Dans une carte : 16.
Rayons : 6 (contrôles), 8 (boutons, champs), 12 (cartes). Bordures 1 px ; une
ombre à peine visible en clair, **aucune en sombre**.

## Graphiques

- Série principale en **rouge** ; période précédente en **gris pointillé** ;
  séries secondaires, dans cet ordre : bleu `#3358d4` / `#5b7ff0`, sarcelle
  `#0f9488` / `#19a393`, violet `#7c5cd6` / `#8f72ea` (validés clair et sombre).
- Une seule échelle par graphique, unité toujours dite (axe ou titre), grille
  horizontale discrète, axes sans trait, chiffres tabulaires dans l'info-bulle.
- Une série = pas de légende (le titre la nomme) ; deux ou plus = légende courte.
- Barres empilées : la série principale en bas ; 2 px d'espace entre segments.
- Hauteurs constantes : **grand 280**, **moyen 200**, **mini-courbe 32**.
- Aucune animation (lecture immédiate, captures nettes).

## Composants

- **Tuile chiffre** : libellé 12 gris (2 lignes max), valeur 26, écart en dessous
  (flèche + %, vert si bon, encre neutre sinon), lien vers la liste.
  Rangée de 4 à 6 tuiles sur une grille égale (jamais 5 + 2 orphelines).
- **Tableau** : ligne 40 px, en-tête collant gris, nombres à droite, tri visible,
  ligne entière cliquable, recherche et filtres AU-DESSUS, compteur en bas.
- **Badge / pastille** : neutre, accent, positif, attention, critique ; toujours un mot.
- **Formulaire** (`Form.tsx`) : libellé au-dessus, aide grise dessous ; interrupteur
  allumé = accent (jamais vert) ; ligne de réglage = titre + description + interrupteur
  à droite ; cases à l'accent ; boutons segmentés pour 2 à 5 choix ; liste de filtre
  32 px au-dessus du tableau ; détail replié par `Fold` (un `<details>` natif).
- **États** : squelettes aux dimensions du contenu ; vide = une phrase + une
  action ; erreur = une phrase + « Réessayer ». Les mêmes partout.
- **Coquille** : barre latérale sobre, entrée active = barre rouge + fond doux,
  badges discrets ; en-tête 48 px ; ⌘K en groupes, résultat actif en surbrillance.
- Transitions 120 ms maximum, focus visible au clavier, `prefers-reduced-motion`.

## À faire / à ne pas faire

| À faire | À ne pas faire |
|---|---|
| « 4 virements en retard » en badge critique avec le mot | Un chiffre peint en rouge pour dire « attention » |
| Une baisse de ventes : `↘ -12 %` en gris | Une baisse en rouge (le rouge est l'accent) |
| Une couleur = une variable `--a-*` | Un hexadécimal dans une page |
| Le bouton principal en haut à droite, un seul | Trois boutons pleins côte à côte |
| Unité sur l'axe (« € », « Nombre ») | Deux échelles sur un graphique |
| 4 ou 6 tuiles égales | 5 tuiles dont une coupée |
