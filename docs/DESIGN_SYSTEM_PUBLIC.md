# Yuno — Design System de l'app publique (éditorial nightlife)

> **⚠️ Périmètre : app publique uniquement (interfaces client / grand public).**
> Ce design system s'applique aux pages destinées aux fêtards / acheteurs :
> Explore (home), pages venue, fiches event, sélection + checkout billets/tables/boissons,
> guest list, confirmation de commande, profil client, favoris, loyalty, linktrees promoteurs,
> pages organizer/DJ publiques, etc.
>
> Il ne s'applique **pas** aux dashboards opérateurs (owner / organizer / manager / barman /
> bouncer / DJ / VIP host / cloakroom / admin). Ceux-ci suivent
> [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (« Yuno Dark Premium »).
>
> L'identité publique est dérivée du site vitrine **yunoapp.eu / yuno-madrid** : une esthétique
> **éditoriale / magazine / affiche de club**, pas un dashboard. La source de vérité des tokens
> est `src/index.css` (`:root` + classes utilitaires). Référence vivante : `Explore.tsx`,
> `EventDetails.tsx`, `VenuePage.tsx` et `src/components/explore/*`.

---

## 0. Public vs Pro — la différence en un coup d'œil

Les deux univers partagent **le fond noir et le rouge `#E8192C`**. Tout le reste diverge.

| Dimension | App publique (ce doc) | Dashboards pro (`DESIGN_SYSTEM.md`) |
|---|---|---|
| **Intention** | Affiche de club, magazine, désir | Densité de données, lisibilité opérateur |
| **Typo titres** | `Space Grotesk` **uppercase**, géant (jusqu'à 100px) | System font, 15–36px, sobre |
| **Typo metadata** | `JetBrains Mono` uppercase, tracking large — **partout** | Pas de mono ; labels en system font |
| **Couleurs texte** | Hex durs : `#FFF` / `#E5E5E5` / `#9A9A9A` / `#5A5A5E` | Opacités du blanc : `0.96` / `0.58` / `0.36` |
| **Surfaces** | Classes CSS (`.event-card`, `.yuno-card`) + hex `#141414` | `<div>` inline-styled, `rgba` + gradients |
| **Border-radius** | **Tranchant** : 2–4px sur l'éditorial, pills 999px | Doux : 12–18px partout |
| **Layout** | Colonne lecture `max-width: 768px`, mobile-first | Large `max-width: 1340px`, grilles KPI |
| **Navigation** | `BottomNav` (PWA mobile) | Sidebar verticale |
| **Hero** | Full-bleed cinématique 1:1 + overlay gradient | Carte avec glow ambiant rouge |
| **Motion** | Entrées staggered « affiche », press `scale(0.97)` | Apparitions framer-motion discrètes |
| **Styling** | Classes CSS partagées **+** inline styles | Tokens inline copiés en tête de fichier |

**Règle mentale :** le pro *informe*, le public *séduit*. Si un écran ressemble à un tableau de
bord, il n'est pas public. Si un écran ressemble à la couverture d'un magazine de nuit, il est public.

---

## 1. Philosophie

| Principe | Description |
|---|---|
| **Noir profond `#0A0A0A`** | Fond de base (`--yuno-black`), pas le `#000` pur du pro |
| **Affiche, pas dashboard** | Image plein cadre, titre énorme, peu de chrome |
| **Trois polices, trois rôles** | `Space Grotesk` (titres) · `Inter` (corps) · `JetBrains Mono` (métadonnées) |
| **Mono = signal nightlife** | Toute date / heure / lieu / prix / tag passe en mono uppercase tracké |
| **Rouge unique `#E8192C`** | Seul accent systémique. Amber = rareté, violet = partenaire/affilié |
| **Tranchant** | Radius 2–4px sur l'éditorial, jamais d'arrondi mou ; pills pour les actions |
| **Tactile** | Press `scale(0.97)`, hover lift `translateY(-4px)`, transitions `cubic-bezier(0.16,1,0.3,1)` |
| **Colonne lecture** | Contenu centré `max-width: 768px` — largeur d'un magazine |

---

## 2. Design Tokens

Tous définis dans `src/index.css` (`:root`). À consommer via `var(--token)` ou classes Tailwind
`yuno-*`. **Ne pas recopier les tokens inline du pro ici** — l'app publique consomme le CSS global.

```css
/* ─── Couleurs marque ─── */
--yuno-black:     #0A0A0A;   /* fond de page */
--yuno-bg-2:      #0E0E10;
--yuno-card:      #141414;   /* surface carte (info panel des cards) */
--yuno-card-2:    #1B1B1E;
--yuno-elev:      #222226;
--yuno-input:     #1F1F22;   /* champs / search bar */

--yuno-red:       #E8192C;   /* accent principal */
--yuno-red-hover: #FF2438;
--yuno-red-dim:   rgba(232,25,44,0.10);
--yuno-red-soft:  rgba(232,25,44,0.18);
--yuno-red-tint:  rgba(232,25,44,0.06);

/* ─── Échelle de gris (HEX DURS, pas d'opacité) ─── */
--yuno-white:  #FFFFFF;   /* titres, valeurs fortes */
--yuno-gray-1: #E5E5E5;   /* texte secondaire clair */
--yuno-gray-2: #9A9A9A;   /* metadata mono (date, lieu) */
--yuno-gray-3: #5A5A5E;   /* labels faibles, hints */
--yuno-gray-4: #3A3A3E;   /* séparateurs, désactivé */
--yuno-live-dot: #FF3B30;

--border-subtle: rgba(255,255,255,0.08);
--border-strong: rgba(255,255,255,0.14);

/* ─── Échelle typographique (affiche → corps) ─── */
--text-hero:     clamp(48px, 8vw, 96px);
--text-display:  clamp(28px, 5vw, 64px);
--text-title:    clamp(20px, 3vw, 36px);
--text-subtitle: 18px;
--text-body:     16px;
--text-small:    14px;
--text-xs:       12px;
--text-mono:     13px;

/* ─── Layout ─── */
--gutter:    clamp(16px, 4vw, 48px);
--max-width: 768px;          /* colonne de lecture */
--radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 10px;
--radius-xl: 14px; --radius-pill: 999px;
```

**Polices** (`tailwind.config.ts`, chargées dans `index.html`) :

| Famille Tailwind | Police | Usage |
|---|---|---|
| `font-display` | **Space Grotesk** 700 | Tous les titres, prix géants, dates typographiques |
| `font-sans` | **Inter** | Corps de texte, descriptions, boutons |
| `font-mono` | **JetBrains Mono** | Metadata : date/heure, lieu, tags, prix « from », labels |
| `font-serif` | Cormorant Garamond | Réservé (rare, accents éditoriaux) |

---

## 3. Typographie — les règles qui font le style

### 3.1 Titre hero (couverture d'event / venue)

`Space Grotesk`, **uppercase**, énorme, ultra-serré, line-height < 1.

```tsx
<h1
  className="font-display text-white uppercase animate-hero-h1"
  style={{
    fontSize: 'clamp(38px, 9vw, 100px)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
    lineHeight: 0.9,
  }}
>
  {event.title}
</h1>
```

**Référence :** hero `EventDetails.tsx:692–697`

### 3.2 Date typographique géante (bloc Infos)

Le « chiffre du jour » et l'heure d'ouverture sont traités comme des **éléments d'affiche**.

```tsx
<p className="font-display font-bold text-white"
   style={{ fontSize: 'clamp(48px, 12vw, 72px)', letterSpacing: '-0.04em', lineHeight: 0.85 }}>
  {format(date, 'dd')}
</p>
```

**Référence :** info table `EventDetails.tsx:884–909`

### 3.3 Titre de section (carrousels Explore)

```tsx
<h2 className="font-display font-bold"
    style={{ fontSize: '21px', color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
  {title}
</h2>
```

**Référence :** `ExploreSectionTitle.tsx:22–27`

### 3.4 Metadata mono (LA signature)

Toute donnée factuelle — date, heure, lieu, distance, prix « à partir de », kicker — passe en
`JetBrains Mono`, **uppercase**, tracking large, gris.

```tsx
{/* Ligne date · heure · distance */}
<p className="font-mono" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
  {dateLabel} · {timeLabel}
</p>

{/* Kicker de section */}
<p className="font-mono" style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F' }}>
  {kicker}
</p>

{/* Nom de club (au-dessus du titre de card) */}
<p className="font-mono" style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
  {venueName}
</p>
```

**Référence :** `EventCard.tsx:152–208` · `ExploreSectionTitle.tsx:15–20`

### Barème typographique

| Rôle | Police | Taille | Poids | Couleur | Tracking | Transform |
|---|---|---|---|---|---|---|
| Hero | display | `clamp(38px,9vw,100px)` | 700 | `#FFF` | `-0.025em` | UPPER |
| Date géante | display | `clamp(48px,12vw,72px)` | 700 | `#FFF` | `-0.04em` | — |
| Titre section | display | 21px | 700 | `#FFF` | `-0.01em` | — |
| Titre card | display | `clamp(14px,2.5vw,17px)` | 700 | `#FFF` | `-0.005em` | UPPER |
| Metadata | mono | 10–12px | 400–500 | `#9A9A9A` | `0.04–0.06em` | UPPER |
| Kicker / label | mono | 9–10.5px | 600 | `#5A5A5E` | `0.12–0.18em` | UPPER |
| Corps | sans | 14–16px | 400 | `#E5E5E5` | normal | — |

---

## 4. Le label de section à filet rouge

Pattern éditorial signature : un petit label mono uppercase précédé d'un **trait rouge**.
Deux variantes en classes CSS globales.

```tsx
{/* Variante riche (page event) — class CSS .section-label-ruled */}
<p className="section-label-ruled mb-6">{t('event.lineup')}</p>

{/* Variante compacte — class CSS .yuno-rule */}
<div className="yuno-rule">À LA UNE</div>
```

```css
/* index.css:637–655 */
.section-label-ruled {
  display: flex; align-items: center; gap: 12px;
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; color: #9A9A9A;
  font-family: 'JetBrains Mono', monospace;
}
.section-label-ruled::before {
  content: ''; width: 28px; height: 1px; background: #E8192C; flex-shrink: 0;
}
```

**Référence :** `index.css:480–498` (`.yuno-rule`) · `:637–655` (`.section-label-ruled`)

---

## 5. Boutons (classes CSS globales `.btn`)

Contrairement au pro (boutons inline-styled), le public a des **classes CSS partagées**.
Hauteur 44px, pill, press tactile.

```tsx
<button className="btn btn--primary">{t('event.bookNow')}</button>
<button className="btn btn--ghost">{t('common.share')}</button>
<button className="btn btn--secondary">{t('event.waitlist')}</button>
```

| Classe | Fond | Texte | Signature |
|---|---|---|---|
| `.btn--primary` | `#E8192C` | blanc | `box-shadow: 0 10px 28px rgba(232,25,44,.32)`, hover lift |
| `.btn--ghost` | `rgba(255,255,255,.06)` | blanc | bordure subtile |
| `.btn--secondary` | transparent | rouge | bordure rouge |

Tous : `border-radius: 999px`, `:active { transform: scale(0.97) }`.
**Référence :** `index.css:277–316`

### Variante « CTA d'affiche » tranchante (inline)

Pour les CTA in-hero, on voit aussi des boutons **rectangulaires** radius 3px, mono uppercase,
press scriptée :

```tsx
<button
  className="font-mono font-bold uppercase"
  style={{ height: 44, padding: '0 22px', background: '#E8192C', color: '#fff',
           border: 'none', borderRadius: 3, fontSize: '11px', letterSpacing: '0.10em',
           transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)' }}
  onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
  onMouseUp={(e) => (e.currentTarget.style.transform = '')}
  onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
>
  {t('event.bookNow')}
</button>
```

**Référence :** callout billets `EventDetails.tsx:808–819`

---

## 6. Cartes

### 6.1 Event card (carrousels Explore)

Le composant le plus réutilisé. Image carrée 1:1, info panel `#141414`, hover lift via
classe `.event-card`.

Anatomie :
- **Image 1:1** — `object-cover`, hover `scale(1.04)` sur 700ms, overlay sombre léger.
- **Badges top-left** — `LIVE` (`.badge-live`), genre (`.genre-tag`), partenaire (violet).
- **Scarcity top-right** — `Zap` ambre + `{percent}%` mono quand 20 < % < 100.
- **Sold out** — overlay noir + pastille rouge `SOLD OUT` mono.
- **Fav button bottom-right** — cercle glassmorphe `rgba(10,10,10,0.55)` + blur.
- **Info panel** — club (mono gris), titre (display uppercase), filet, puis `DATE · HEURE` (mono) + prix (`from X€` rouge mono bold).

```tsx
<article className="event-card group flex flex-col">
  <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>…</div>
  <div className="flex flex-col flex-1 px-3.5 py-3 gap-1.5" style={{ background: '#141414' }}>…</div>
</article>
```

```css
/* index.css:344–354 */
.event-card { background: var(--yuno-card); border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle); overflow: hidden; cursor: pointer;
  transition: transform 250ms cubic-bezier(0.16,1,0.3,1), box-shadow 250ms, border-color 250ms; }
.event-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.4);
  border-color: rgba(232,25,44,0.28); }
```

**Référence :** `EventCard.tsx` (intégral) · `.event-card` `index.css:344–354`

### 6.2 Callout accent rouge (in-page)

Encadré tranchant radius 4px, bordure + fond rouge translucides, pour pousser un prix / CTA.

```tsx
<div style={{ border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4,
              padding: '16px 20px', background: 'rgba(232,25,44,0.04)' }}>
  <p className="font-mono uppercase" style={{ fontSize: '9px', color: '#E8192C', letterSpacing: '0.14em' }}>
    {t('event.ticketsAvailable')}
  </p>
  <p className="font-display font-bold text-white"
     style={{ fontSize: 'clamp(22px, 5vw, 32px)', letterSpacing: '-0.025em', lineHeight: 1 }}>
    {t('event.startingFrom')} {minPrice}€
  </p>
</div>
```

**Référence :** callout billets `EventDetails.tsx:790–841`

### 6.3 Carte neutre

`.yuno-card` : `#141414`, radius 10px, bordure subtile. Utilisée pour les blocs info posés.
**Référence :** `index.css:337–342`

---

## 7. Hero cinématique (page event / venue)

Section plein cadre, ratio 1:1, image en `object-cover`, overlay gradient noir, contenu ancré en
bas, contrôles flottants en haut, entrées staggered.

Structure :
1. `<section>` `aspectRatio: '1 / 1'`, `overflow-hidden`, bordure basse.
2. Image de fond (ou gradient fallback `linear-gradient(160deg, #1a0a0d, #7a1428)`).
3. Overlay : `linear-gradient(to top, rgba(10,10,10,0.97) 0%, …0.2 50%, …0.55 100%)`.
4. Top bar : back (gauche) + share/fav (droite) — boutons 36px, radius **2px**, `rgba(0,0,0,0.4)` + blur.
5. Bottom : badges → titre hero → ligne meta mono + countdown.

Les entrées utilisent les classes CSS staggered :

```css
/* index.css:657–669 */
.animate-hero-label { animation: slide-up .65s cubic-bezier(.16,1,.3,1) .05s backwards; }
.animate-hero-h1    { animation: slide-up .75s cubic-bezier(.16,1,.3,1) .18s backwards; }
.animate-hero-body  { animation: slide-up .65s cubic-bezier(.16,1,.3,1) .35s backwards; }
.animate-hero-cta   { animation: slide-up .6s  cubic-bezier(.16,1,.3,1) .48s backwards; }
```

**Référence :** `EventDetails.tsx:607–730`

---

## 8. Header & navigation publique

### 8.1 Header Explore (sticky, glassmorphe)

`position: sticky`, fond `rgba(10,10,10,0.90)` + `blur(20px)`, bordure basse. Trois zones :
logo Yuno (display rouge + pill « Beta » mono), pills ville/date (mono, radius 10px), puis barre
de recherche (`#1F1F22`) + bouton filtres.

```tsx
<header className="sticky top-0 z-40"
  style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)',
           borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
```

Logo :

```tsx
<span className="font-display font-bold" style={{ fontSize: '20px', color: '#E8192C', letterSpacing: '-0.025em' }}>
  Yuno
</span>
```

**Référence :** `ExploreHeader.tsx:154–360`

### 8.2 Pills de navigation / filtre

Petites pills mono, radius 10px, `rgba(255,255,255,0.05)` + bordure ; état actif rouge.

```tsx
<button className="flex items-center gap-1.5 font-mono font-medium"
  style={{ fontSize: '11px', letterSpacing: '0.04em', color: '#E5E5E5', padding: '5px 12px',
           borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
  <MapPin className="h-3 w-3 text-primary" /> {city}
</button>
```

**Référence :** city/date pills `ExploreHeader.tsx:191–226`

### 8.3 BottomNav

Navigation principale mobile (PWA) — pas de sidebar côté public.
**Référence :** `src/components/BottomNav.tsx`

---

## 9. Badges, tags & indicateurs

| Élément | Classe / style | Usage |
|---|---|---|
| **Live** | `.badge-live` — mono 10px, bordure rouge, blur, `.dot-live` pulsant | event en cours |
| **Genre** | `.genre-tag` — mono 10px uppercase, `rgba(255,255,255,.06)` | techno, house… |
| **Partenaire** | inline violet `#C084FC` sur `rgba(192,132,252,.15)` | events affiliés |
| **Scarcity** | `Zap` ambre `text-amber-400` + `%` mono | remplissage 20–100% |
| **Sold out** | pastille `#E8192C`, mono bold tracking `0.18em` | complet |
| **Beta** | pill rouge mono dans le logo | header |

```css
/* index.css:360–395 */
.badge-live { font-family: 'JetBrains Mono'; font-size: 10px; font-weight: 700;
  letter-spacing: 0.10em; text-transform: uppercase; color: var(--yuno-red);
  border: 1px solid rgba(232,25,44,0.5); background: rgba(10,10,10,0.6);
  backdrop-filter: blur(12px); padding: 4px 9px; border-radius: 999px; }
.genre-tag { font-family: 'JetBrains Mono'; font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--yuno-gray-1);
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);
  padding: 3px 10px; border-radius: 999px; }
```

**Référence :** `index.css:356–395` · usages dans `EventCard.tsx:96–127`

---

## 10. Barre de progression (rounds de billetterie)

Track fin (2px), fill rouge si > 80% vendu, sinon gris `#3A3A3E`, transition douce.

```tsx
<div className="w-full overflow-hidden" style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
  <div style={{ height: '100%', width: `${pctSold}%`,
                background: pctSold > 80 ? '#E8192C' : '#3A3A3E',
                transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)', borderRadius: 1 }} />
</div>
```

**Référence :** rounds `EventDetails.tsx:832–834`

---

## 11. Éléments éditoriaux additionnels

| Élément | Classe | Rôle |
|---|---|---|
| **Marquee ticker** | `.marquee-strip` / `.marquee-inner` / `.marquee-item` | bandeau défilant mono uppercase |
| **Divider** | `.yuno-divider` | trait 1px `rgba(255,255,255,.08)` |
| **Link slide** | `.link-slide` | soulignement animé au hover |
| **Skeleton** | `.skeleton` | shimmer de chargement |
| **Hero overlay** | `.hero-overlay` / `.card-overlay` | gradients d'image standard |
| **Fixed bottom bar** | `.fixed-bottom-bar` | barre d'action checkout (safe-area) |
| **Stagger grid** | `.stagger-grid` | apparition en cascade d'une grille de cards |

**Référence :** `index.css:243–271, 401–530, 671–679`

---

## 12. Layout & structure de page

```tsx
{/* Page event/venue type */}
<div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>

  {/* Hero plein cadre — déborde la colonne */}
  <section style={{ aspectRatio: '1 / 1' }}>…</section>

  {/* Contenu : colonne de lecture 768px */}
  <div style={{ maxWidth: '768px', margin: '0 auto' }}>
    <section style={{ padding: 'clamp(32px,5vw,44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <p className="section-label-ruled mb-6">INFOS</p>
      …
    </section>
  </div>
</div>
```

- **Fond de page** : `#0A0A0A` (pas `#000`).
- **Hero** : full-bleed, sort de la colonne.
- **Contenu** : `max-width: 768px` centré, padding latéral `20px`.
- **Sections** : séparées par `borderBottom: 1px rgba(255,255,255,0.07)`, padding vertical fluide.
- **Bas de page** : `pb-28` pour laisser respirer la `BottomNav` / barre d'action fixe.

**Référence :** `EventDetails.tsx:604–605, 732–733`

---

## 13. Motion

- **Courbe maison** : `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out doux) pour entrées et hovers.
- **Press tactile** : `button:active { transform: scale(0.97) }` global (`index.css:153–155`).
- **Hover card** : lift `translateY(-4px)` + glow rouge léger.
- **Entrées hero** : classes staggered `.animate-hero-*` (§7).
- **Grilles** : `.stagger-grid` (cascade 0 → 240ms).
- `framer-motion` est utilisé pour les overlays interactifs (drawer date, search) — pas pour
  l'animation éditoriale de base, qui passe par les keyframes CSS.

**Durées :** press 100ms · hover 200–250ms · entrées 550–750ms.

---

## 14. Checklist pré-livraison (public)

Avant de soumettre une page / composant **public** :

- [ ] **Fond `#0A0A0A`** sur le wrapper (pas `#000`, pas `#141414`).
- [ ] **Titres en `font-display` (Space Grotesk)** uppercase quand c'est un titre fort.
- [ ] **Toute metadata en `font-mono`** uppercase, tracking ≥ `0.04em`, gris `#9A9A9A`/`#5A5A5E`.
- [ ] **Couleurs texte en hex durs** (`#FFF` / `#E5E5E5` / `#9A9A9A` / `#5A5A5E`) — pas d'opacités du pro.
- [ ] **Radius tranchant** (2–4px) sur l'éditorial ; pills 999px pour les actions.
- [ ] **Réutiliser les classes CSS globales** (`.btn`, `.event-card`, `.badge-live`, `.genre-tag`,
      `.section-label-ruled`, `.yuno-rule`) avant d'inline-styler.
- [ ] **Label de section à filet rouge** pour ouvrir une section éditoriale.
- [ ] **Colonne `max-width: 768px`** pour le contenu lu ; hero en full-bleed.
- [ ] **Press `scale(0.97)`** et hover lift sur les éléments cliquables.
- [ ] **Rouge `#E8192C`** comme seul accent (amber = rareté, violet = partenaire).
- [ ] **Mobile-first** : tester 375px d'abord, `BottomNav` non masquée (`pb-28`).
- [ ] **Pas de patterns dashboard** (grilles KPI, glass cards `rgba`, tokens `T1/T2/T3`).

---

## 15. Fichiers de référence

| Fichier | Rôle |
|---|---|
| `src/index.css` | **Source de vérité** : tokens `:root` + toutes les classes utilitaires publiques |
| `tailwind.config.ts` | Familles de polices, couleurs `yuno-*`, keyframes, shadows |
| `src/pages/Explore.tsx` | Home — composition des carrousels, header, filtres |
| `src/components/explore/EventCard.tsx` | Carte event de référence (badges, scarcity, info panel) |
| `src/components/explore/ExploreHeader.tsx` | Header sticky glassmorphe, pills ville/date, search |
| `src/components/explore/ExploreSectionTitle.tsx` | Titre de section + kicker mono |
| `src/pages/EventDetails.tsx` | Hero cinématique, callouts, info table typographique |
| `src/pages/VenuePage.tsx` | Page club publique (hero + sections venue) |
| `src/pages/TicketSelection.tsx` | Flux checkout billets (barre d'action fixe) |
| `src/components/BottomNav.tsx` | Navigation principale mobile |
