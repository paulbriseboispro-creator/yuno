# design-sync — notes Yuno

Projet Claude Design : `58f89cdc-d4fc-4516-ac38-d444cc842ec0` (« Yuno Design System »).

## Périmètre : PUBLIC uniquement

Décision du 2026-07-19 : Claude Design ne porte que `docs/DESIGN_SYSTEM_PUBLIC.md`.
Le design system pro (`docs/DESIGN_SYSTEM.md`, dashboards owner/organizer/staff) est
**hors périmètre** et ne doit pas être synchronisé.

Constat qui a motivé le découpage, mesuré sur le code :

| | `ui/card` | `ui/button` |
|---|---|---|
| surfaces pro (owner, org, manager) | 17 fichiers | 37 fichiers |
| surfaces publiques (Explore, EventDetails, VenuePage) | 0 | 0 |

`src/components/ui/` est donc en pratique la couche **pro**. Le système public vit
dans des classes CSS (`.event-card`, `.yuno-card`, `.yuno-rule`) et dans
`src/components/explore/*`. Le périmètre synchronisé est l'intersection utile :
les 19 primitives `ui/` réellement atteintes par une surface publique, plus les
12 composants éditoriaux d'`explore/`, plus `BottomNav`.

Exclus délibérément : les 18 primitives pro-only (sidebar, dropdown-menu, accordion,
popover, tooltip, toast, sonner, toaster, switch, progress, radio-group, scroll-area,
sheet, pagination, kbd, collapsible, alert-dialog, date-input). La liste vit dans
`build-ds-package.sh`.

## Yuno est une app, pas une librairie — d'où les 3 scripts

`package.json` est `private`, sans `main`/`module`/`exports`, et `npm run build`
produit un SPA. Trois scripts comblent l'écart (tous appelés par `cfg.buildCmd`) :

- **`prepare-css.sh`** — `src/index.css` est du Tailwind non compilé ; livré tel quel
  aucune classe utilitaire n'existe et tout rend sans style. Récupère
  `dist/assets/index-<hash>.css` (nom haché → chemin stable) et préfixe l'`@import`
  Google Fonts que `index.html` fournit normalement par `<link>`.
- **`build-ds-package.sh`** — design-sync lit les props **depuis l'arbre `.d.ts`**, pas
  depuis les sources. Sans déclarations générées, les 72 composants sortaient avec
  `[key: string]: unknown` et l'agent n'apprenait rien de `variant`/`size`/`asChild`.
  Génère barrel + `tsc --emitDeclarationOnly` + bundle esbuild + manifeste `types`.
- **`gen-docs.mjs`** — une doc par composant : `category:` pour le groupe dans le
  panneau, corps pour le `.prompt.md` que lit l'agent. À relancer si un composant
  entre ou sort du périmètre (le script signale les orphelins).

## Pièges résolus (ne pas refaire)

- **`tsc` refuse `--paths` en ligne de commande** (TS6064) → tsconfig généré
  (`ds-package/tsconfig.dts.json`). L'émission sort ~13 erreurs bénignes
  (`import.meta.env` non typé, mismatches Supabase) mais **écrit quand même** les
  `.d.ts` : juger sur la sortie, jamais sur le code retour.
- **`supabaseUrl is required` tuait les 72 cartes.** Le barrel tire
  `integrations/supabase/client.ts`, qui lit `import.meta.env` au niveau module et
  jette à l'import. Résolu par des `define` esbuild avec des valeurs factices — les
  aperçus ne doivent jamais atteindre le réseau.
- **Le harness d'aperçu code en dur `body{background:#fff}`** dans un `<style>` inline
  postérieur à nos feuilles. Sur un DS sombre, `ghost` devient invisible et `outline`
  un pavé noir. Résolu dans `prepare-css.sh` par `body:has(> .ds-grid)` **et**
  `body:has(> .ds-single)` — les deux modes, la cellule isolée (`?story=`) utilisant
  `.ds-single`. Sélecteur plus spécifique → pas besoin d'`!important`, et les vrais
  designs gardent la main sur leur fond. Ne pas forker `lib/emit.mjs` (contrat de sortie).
- **Composants éditoriaux sans contexte = cartes vides.** `EventCard` lit
  `useNavigate` + `useLanguage` + `useFavorites`. `build-ds-package.sh` génère
  `__ds-preview-provider.tsx` (MemoryRouter + LanguageProvider + FavoritesProvider),
  câblé par `cfg.provider` et exclu des cartes par `componentSrcMap`.
- **Overlays Radix** (`Select`, `Dialog`, `Drawer`) : le panneau n'est monté qu'ouvert,
  dans un portail. Sans story `defaultOpen`, le style du contenu n'apparaît sur aucune
  carte. Motif : story `defaultOpen` + `cfg.overrides.<Nom>` avec
  `{cardMode:"single", primaryStory:"Ouvert", viewport:"420x340"}`.
- **Modifier `cfg.overrides` casse les clés de notation** (`[CONFIG_STALE]`) : il faut
  un `package-build.mjs` complet, un `preview-rebuild.mjs` ne suffit pas.
- **Playwright** : ne rien télécharger. Le cache `~/Library/Caches/ms-playwright/`
  contient chromium 1208, épinglé par **playwright 1.58.2** (installé dans `.ds-sync/`).
- **Polices** : `document.fonts.check()` renvoie `false` pour Space Grotesk et
  JetBrains Mono tant qu'aucun élément de la carte ne les utilise — une `@font-face`
  ne se télécharge qu'à l'usage. Ce n'est pas un défaut ; vérifier sur une carte
  éditoriale (`EventCard`), où le mono est visiblement chargé.

## Écrire un aperçu

- Déterminisme obligatoire : dates ISO figées (jamais `Date.now()`) et images en
  **SVG inline data-URI**. Une image distante rend le contrôle de rendu instable et
  re-clé la capture, ce qui efface les notes.
- Contenu réaliste Yuno (clubs madrilènes, prix en €, genres, « From 15€ »), jamais
  `foo`/`test` : ces cartes sont imitées par l'agent de design via `.prompt.md`.
- Les sous-parties de composés (`CardHeader`, `DialogTitle`, `SelectItem`…) s'écrivent
  comme la **composition parente complète** — c'est le seul rendu vrai.

## Acquis de la campagne d'aperçus (5 vagues, 2026-07-19)

### Un composant qui « rend vide » a presque toujours une boîte intrinsèque nulle

Les 4 `RENDER_BLANK` signalés (Skeleton, Avatar, Slider, Checkbox, InputOTPSeparator)
n'étaient pas des bugs : `Slider` a une racine `flex w-full` (largeur 0 sans parent
dimensionné) et dérive ses poignées de `value`/`defaultValue` ; `Checkbox` fait 16×16 px ;
`InputOTPSeparator` est un point isolé ; les slots Avatar sont `h-full w-full`. Avant de
conclure au bug, poser une dimension explicite et composer. Le correctif est **toujours**
côté aperçu, jamais côté design system.

### `bg-muted` est invisible sur le fond public — constat sur le DS, pas sur le sync

`--muted` = `0 0% 7%` (#121212) contre une page à `#0A0A0A` : 2 points de luminance.
`Skeleton` et `AvatarFallback` ne peignent donc rien de visible. L'app a déjà tranché au
cas par cas — `src/pages/VenuePage.tsx:511-536` force `bg-white/[0.08]` sur chaque
Skeleton avec un commentaire explicite. Deux primitives sur onze doivent être détournées
à chaque usage public. Piste (décision de design system, hors sync) : monter `--muted`
vers ~12 %, ou brancher la primitive `ui/skeleton` sur la classe `.skeleton` qui existe
déjà dans `index.css` sans être câblée.

### Les rails horizontaux coupent en silence

Moitié du groupe `explore` = scrollers `overflow-x: auto`. Dans une colonne mobile à
400px (le réflexe pourtant prescrit par le doc), le contenu est tronqué **sans indice
visuel** : le fond noir de la cellule remplit le reste et la coupure passe pour une fin
de rangée voulue. Une story censée montrer plusieurs genres n'en affichait aucun d'actif.
Le rapport largeur → contenu visible n'est pas linéaire (400→620 a révélé 2 chips,
620→780 une seule) : élargir et recapturer, ne pas calculer. Valeur retenue : **780**.
Règle : sur un rail, vérifier que le **dernier** enfant est présent avant de noter.

### Les planches composées sous-lisent le mono 10-11px sur fond sombre

Soit exactement la signature typographique du DS public. Sur `BottomNav`, la pastille
active paraissait vide : sondes `getComputedStyle` (opacity 1, largeur 58px, bon rouge,
JetBrains Mono), `getAnimations()` vide, et capture ×5 parfaitement lisible. Avant de
noter `needs-work` sur du petit mono coloré, ouvrir
`ds-bundle/_screenshots/review/raw/<groupe>__<Nom>__<Cellule>.png` (déjà écrite par la
capture, pas besoin de recapturer). Une sonde Playwright doit être lancée **depuis
`.ds-sync/`** — playwright n'est installé que là.
Corollaire à ne pas re-tester : `page.clock.setFixedTime()` ne gèle **pas** framer-motion ;
toutes les entrées `motion` atteignent leur état final.

### `position: fixed` se dompte sans override

Un wrapper `transform: translateZ(0)` devient le bloc conteneur du `fixed` et rapatrie la
barre dans sa cellule. C'est ce qui a évité un `cardMode` (et donc un `[CONFIG_STALE]`)
sur `BottomNav`/`BottomNavBar`. Même mécanique inverse à connaître : `.ds-single` porte ce
même `translateZ(0)`, donc un élément hors portail **ne peut pas** passer au-dessus du
voile d'un overlay — le portail est monté sur `body`, hors de ce contexte d'empilement.
Le `z-index` n'y peut rien ; rendre l'élément lisible *à travers* le voile.

### Overlays : `defaultOpen` ne suffit pas quand le sujet est derrière le panneau

`DialogOverlay`/`DrawerOverlay`/`*Portal` ne se démontrent que si l'on voit la page
voilée. Borner la largeur du panneau **en style inline** (les classes `sm:*` ne se
déclenchent jamais sous 640px, donc jamais dans une carte) et rendre une vraie page
dessous — un fond uni ne prouve rien une fois flouté.

### `position="item-aligned"` recouvre le trigger dans une carte courte

Défaut shadcn de `SelectContent`. Dans ~290px utiles, Radix pose le panneau par-dessus le
trigger et scrolle le haut de liste hors champ (une story « trois groupes » n'en montrait
que deux). Le `popper` par défaut respecte `--radix-select-content-available-height` et
garde la composition entière. `item-aligned` ne se justifie que pour les deux boutons de
scroll, où c'est précisément ce mode qui fait apparaître les chevrons.

### INVARIANT à ne pas casser : la story ouverte doit rester le PREMIER export

Les 29 composants en `cardMode:"single"` (9 sous-parties de `Select` + 20 overlays) n'ont
**pas** de `primaryStory` en config : le harness retombe donc sur le premier export du
module. Toutes leurs previews placent volontairement une composition **ouverte** en tête
de fichier. Réordonner les exports ferait silencieusement retomber la carte produit sur
un panneau non monté, et rien ne le signalerait. Si un jour on ajoute `primaryStory`,
viser : sous-parties de `Select` → `Ouvert`, `Dialog` → `TableVIP`, `Drawer` →
`Bouteilles`, autres sous-parties d'overlay → leur story de composition complète (jamais
les stories `Ferme`).

### Déterminisme, pièges rencontrés

- `ExploreDayTabs` affiche `format(date, 'dd')` en heure **locale** : des ISO à minuit
  basculent d'un jour selon le fuseau et effacent les notes. Dates de semaine figées à
  `T12:00:00.000Z`.
- `Calendar` : choisir un mois à **5 semaines** (juin 2026), sinon les cellules `h-12`
  débordent le viewport 420px et la grille est rognée.
- `InputOTP` : valeur contrôlée + `onChange` no-op. Sans focus, `hasFakeCaret` reste faux
  — sinon le caret clignotant re-clé la capture à chaque run.
- `AvatarImage` ne s'écrit jamais sans `AvatarFallback` : Radix retire le slot si la src
  échoue, donc un aperçu image-seule rend vide par intermittence selon le timing.

### Le skin des champs publics existe déjà dans le produit

Ne pas réinventer. `src/pages/TableCheckout.tsx:50` porte la constante de style des
champs, `:781` le label public (JetBrains Mono, uppercase, `tracking 0.10em`, `#5A5A5E`).
Les reprendre verbatim garantit aussi que les utilitaires Tailwind correspondants sont
bien présents dans la CSS compilée. Un aperçu de formulaire sans mono uppercase quelque
part ne ressemble pas à Yuno.

## Warns de rendu connus (attendus, ne pas chasser)

- `[TOKENS_MISSING]` sur `--radix-*` : variables posées par Radix au runtime.
- `[TOKENS_MISSING]` sur `--sidebar-width` / `--skeleton-width` : la CSS compilée
  couvre toute l'app, y compris des surfaces pro hors périmètre.
- `Button` et `Badge` : `default` et `destructive` rendent presque identiques — c'est le
  système réel (le rouge `#E8192C` est l'accent unique), pas un défaut d'aperçu.
- Anneau rouge sur le premier bouton d'un overlay : c'est le focus-ring que Radix pose à
  l'ouverture, pas une variante de bouton.
- `DialogFooter` empile en `flex-col-reverse` sous 640px, `DrawerFooter` en `flex-col` :
  la différence est réelle et vaut d'être visible sur les deux planches.
- Bavure en bas de la dernière cellule d'une planche (vue sur `ExploreListRow`) : hauteur
  de planche fixe (2185px) quand une story est nettement plus haute que les autres.
  Artefact du harness, pas du composant.
- Les six planches `Card*` se ressemblent beaucoup : c'est voulu (chaque sous-partie n'a
  de rendu vrai qu'en composition parente entière), ce n'est pas une duplication.
- `AnimatedOrb` rend un blob asymétrique et non un cercle net : c'est la première image
  clé réelle des anneaux contra-rotatifs, pas un défaut de capture.

## Risques de re-sync

- **`_ds_bundle.js` pèse ~4,5 Mo.** Le provider d'aperçu tire `LanguageProvider`, qui
  tire `src/i18n/data.ts` (1,5 Mo). Si la taille devient gênante, la piste est un
  provider de langue allégé — mais les composants appellent le vrai `useLanguage()`,
  donc un faux contexte casserait `t()`.
- **La liste des primitives publiques est figée dans `build-ds-package.sh`**, dérivée
  d'un scan d'usage à un instant donné. Si une surface publique se met à importer une
  primitive pro-only, elle manquera silencieusement : re-lancer le scan d'usage.
- **`.design-sync/yuno-styles.css` est régénéré depuis `dist/`** : un `npm run build`
  périmé livre une CSS périmée. `buildCmd` enchaîne les deux, ne pas court-circuiter.
- Les valeurs Supabase factices sont figées dans `build-ds-package.sh` : si le client
  se met à valider la clé plus strictement, les cartes retomberont d'un coup.
