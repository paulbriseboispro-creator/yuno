# Yuno — design system PUBLIC

Ce système couvre **uniquement les surfaces publiques** de Yuno : Explore (home), pages
club et fiches event, sélection et checkout de billets / tables VIP / boissons, guest list,
confirmation de commande, profil client, favoris, fidélité, linktrees promoteurs, pages
publiques DJ et organisateur.

**Il ne couvre PAS les dashboards opérateurs** (owner, organizer, manager, barman, bouncer,
DJ, VIP host, vestiaire, admin). Ceux-ci suivent un autre design system, absent de ce projet.
Si la demande porte sur un écran opérateur — tableau de bord, KPI, gestion de stock, scan à
l'entrée — **dis-le au lieu de concevoir** : construire un écran pro avec ces composants
produirait le mauvais système. Test mental : le pro *informe*, le public *séduit*. Si l'écran
ressemble à un tableau de bord, il n'est pas public.

## Fond sombre obligatoire

Tout est conçu pour `--yuno-black` (#0A0A0A). Poser ce fond sur la racine, sinon les variants
`ghost` et `outline` deviennent illisibles.

```jsx
<div style={{ background: 'var(--yuno-black)', color: 'var(--yuno-white)', minHeight: '100dvh' }}>
```

## Contexte requis pour les composants éditoriaux

`EventCard`, `Explore*` et `BottomNav` lisent le routeur, la langue et les favoris. Sans
wrapper ils rendent vide. Le bundle exporte `window.YunoDS.YunoPreviewProvider`, qui compose
les trois :

```jsx
const { YunoPreviewProvider, EventCard } = window.YunoDS;
<YunoPreviewProvider><EventCard event={{ /* … */ }} /></YunoPreviewProvider>
```

Les primitives (`Button`, `Input`, `Card`, `Dialog`, `Drawer`, `Select`, `Tabs`…) n'ont besoin
d'aucun wrapper.

## Idiome de style : Tailwind + tokens + classes de marque

Trois couches, dans cet ordre de préférence.

**1. Composants du système d'abord.** Ne jamais réimplémenter une carte d'event à la main :
`EventCard`, `ExploreVenueCard`, `ExploreDJCard`, `ExploreRailCard`, `ExploreRankCard`,
`ExplorePopularClubCard`, `ExploreListRow`, `ExploreSeeAllCard`, `ExploreEventCarousel`,
`ExploreSectionTitle`, `ExploreChipRow`, `ExploreDayTabs` existent déjà.

**2. Classes CSS de marque** (définies dans `styles.css`) : `.event-card`, `.event-card-img`,
`.yuno-card`, `.yuno-rule`, `.yuno-divider`, `.yuno-qr-pulse`.

**3. Utilitaires Tailwind + tokens** pour ta propre mise en page :

| famille | valeurs réelles |
|---|---|
| polices | `font-display` (Space Grotesk, titres) · `font-sans` (Inter, corps) · `font-mono` (JetBrains Mono, métadonnées) |
| couleurs | `var(--yuno-red)` #E8192C accent unique · `--yuno-red-hover` `--yuno-red-dim` `--yuno-red-soft` `--yuno-red-tint` |
| surfaces | `--yuno-card` #141414 · `--yuno-card-2` · `--yuno-elev` · `--yuno-input` · `--yuno-surface`…`-3` |
| texte | hex durs, pas d'opacité : `--yuno-white` `--yuno-gray-1` `--yuno-gray-2` `--yuno-gray-3` `--yuno-gray-4` |
| bordures | `--border-subtle` (8 %) · `--border-strong` (14 %) |
| typo | `--text-hero` `--text-display` `--text-title` `--text-subtitle` `--text-body` `--text-small` `--text-xs` `--text-mono` |
| rayons | `--radius-sm` 4px … `--radius-xl` 14px · `--radius-pill` 999px |

**Le mono est la signature.** Toute date, heure, lieu, prix « from », tag ou compteur passe en
`font-mono uppercase` avec `tracking-[0.10em]`, en `--yuno-gray-2` ou `--yuno-gray-3`. Un écran
public sans mono uppercase quelque part ne ressemble pas à Yuno.

**Angles tranchants** sur l'éditorial (2–4px), pills 999px pour les actions. Jamais d'arrondi mou.
Colonne de lecture `max-width: 768px`, mobile-first.

## Pièges vérifiés

- **`bg-muted` est invisible** sur #0A0A0A (7 % de luminance contre 4 %). Pour un `Skeleton` ou
  un fond discret, utiliser `bg-white/[0.08]` — c'est ce que fait le produit.
- `Button`/`Badge` : `default` et `destructive` rendent presque pareil, le rouge est l'accent
  unique. Pour une action destructive, s'appuyer sur le libellé, pas sur la couleur.
- `Drawer` est le format modal par défaut sur mobile public ; `Dialog` pour le centré desktop.

## Où est la vérité

`guidelines/DESIGN_SYSTEM_PUBLIC.md` (le document de référence complet, avec les règles de
typographie, de motion et de hiérarchie), `styles.css` et ses imports pour les tokens réels,
et le `<Nom>.prompt.md` de chaque composant pour son API et sa composition. Lire ces fichiers
bat toujours un résumé.
