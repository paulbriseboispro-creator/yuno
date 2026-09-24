# Yuno Dark Premium — Design System

> **⚠️ Périmètre : dashboards internes uniquement.**
> Ce design system s'applique exclusivement aux interfaces réservées aux opérateurs :
> owners, organizers, managers, barmans, bouncer, DJ, VIP hosts, cloakroom, etc.
>
> Il ne s'applique **pas** à l'app publique (pages venue, checkout tickets/boissons/tables,
> flux guest, confirmation de commande, invite club, explore, profil client, etc.).
> L'app publique a ses propres conventions de design.
>
> Ce style est dérivé du composant de référence `OwnerAnalytics.tsx`.
> Toutes les valeurs ci-dessous sont **directement copiables** dans n'importe quel composant dashboard.

---

## 1. Philosophie

| Principe | Description |
|---|---|
| **Fond pur noir** | `#000` ou `#0a0a0c` — jamais de gris ou bleu foncé (thème sombre ; le clair est décrit au §17) |
| **Lumière subtractibe** | Les éléments s'éclairent, ils ne s'assombrissent pas |
| **Accent rouge unique** | `#E8192C` est le seul accent de couleur systémique |
| **Hiérarchie par opacité** | Blanc à 96% → 58% → 36% — jamais de classes Tailwind `text-foreground` |
| **Pas de shadcn Card** | `<Card>` shadcn est banni — toujours des `<div>` avec inline styles |
| **Zéro emoji** | Uniquement des icônes Lucide |

---

## 2. Design Tokens

Copie ce bloc en haut de chaque composant ou fichier de page. Les dashboards
existent en **thème sombre ET clair** (§17) : un token n'est jamais un blanc ou
un noir en dur, c'est une **encre** (`--ink`) ou une **surface** (`--sf-…`) qui
bascule. En sombre, chaque valeur vaut EXACTEMENT l'ancienne (`--ink` = blanc,
`--sf-0a0a0c` = `#0a0a0c`) ; en clair, la même hiérarchie se lit en noir sur
blanc — c'est la palette zinc de la landing.

```tsx
// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';                              // accent principal (identique dans les deux thèmes)
const POS     = 'var(--acc-34d399)';                    // positif / live / succès (assombri en clair)
const NEG     = 'var(--acc-ff5c63)';                    // négatif / erreur / drop-off
const T1      = 'rgb(var(--ink)/0.96)';                 // texte primaire
const T2      = 'rgb(var(--ink)/0.58)';                 // texte secondaire
const T3      = 'rgb(var(--ink)/0.36)';                 // texte tertiaire / labels / muted
const C_HI    = 'rgb(var(--ink)/0.92)';                 // fill haute intensité (sparklines)
const C_MID   = 'rgb(var(--ink)/0.40)';                 // fill moyen (barres secondaires)
const C_LO    = 'rgb(var(--ink)/0.14)';                 // fill bas (funnel outer)
const C_FAINT = 'rgb(var(--ink)/0.06)';                 // fond de tile interne
const BORDER  = 'rgb(var(--ink)/0.085)';                // bordure standard
const F_BORDER= 'rgb(var(--ink)/0.055)';                // bordure faible (séparateurs)

// Fonds
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const INNER_BG = 'rgb(var(--ink)/0.032)';               // carte imbriquée dans CARD_BG
const TILE_BG  = 'rgb(var(--ink)/0.025)';               // tile imbriqué dans INNER_BG

// Ombres (le liseré intérieur reste blanc : --sheen ; l'ombre s'allège en clair)
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';
```

---

## 3. Surfaces / Cartes

### 3.1 Carte principale (top-level)

Utilisé pour chaque section de page. Exemple : KPI row, Revenue chart, Finance strip dans `OwnerAnalytics.tsx`.

```tsx
<div
  style={{
    background: CARD_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 18,
    boxShadow: CARD_SHADOW,
    padding: 22,
    overflow: 'hidden',
    position: 'relative',
  }}
>
  {children}
</div>
```

**Référence :** `PCard` dans `src/pages/OwnerAnalytics.tsx:50–96`

---

### 3.2 Carte imbriquée (inner card)

Utilisé à l'intérieur d'une carte principale ou d'un layout en grille (tiles, lignes de liste, segments).

```tsx
<div
  style={{
    background: INNER_BG,          // 'rgba(255,255,255,0.032)'
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    overflow: 'hidden',
    padding: '20px 22px',
  }}
>
  {children}
</div>
```

**Référence :** `crd` dans `src/components/analytics/AcquisitionDashboard.tsx`

---

### 3.3 Tile (niveau 3)

Petit élément imbriqué dans une inner card. Exemple : `StatTile`, `KpiTile`, `TierTile`.

```tsx
<div
  style={{
    background: TILE_BG,           // 'rgba(255,255,255,0.025)'
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: '10px 12px',
  }}
>
  {children}
</div>
```

**Référence :** `StatTile` dans `src/components/analytics/BehaviorAnalytics.tsx:190–205`

---

### 3.4 Carte accent RED (highlight)

Pour mettre en avant une métrique clé. Exemple : CA période dans `LiveActivityHero`.

```tsx
<div
  style={{
    background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))',
    border: '1px solid rgba(232,25,44,0.22)',
    borderRadius: 12,
    padding: '10px 12px',
  }}
>
  {children}
</div>
```

**Référence :** `KpiTile` highlight dans `src/components/analytics/LiveActivityHero.tsx`

---

### 3.5 Carte avec glow ambiant (hero)

Pour les sections live ou hero. Le fond intègre un radial gradient rouge.

```tsx
<div
  className="relative overflow-hidden"
  style={{
    background: `radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.08) 0%, transparent 65%),
      linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
    border: `1px solid ${BORDER}`,
    borderRadius: 18,
    boxShadow: CARD_SHADOW,
  }}
>
  {/* Blobs de glow décoratifs */}
  <div className="pointer-events-none absolute -top-14 -right-14 w-52 h-52 rounded-full"
    style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(56px)' }} />
  <div className="pointer-events-none absolute -bottom-20 left-6 w-44 h-44 rounded-full"
    style={{ background: 'rgba(232,25,44,0.06)', filter: 'blur(56px)' }} />
  <div style={{ position: 'relative', padding: 22 }}>
    {children}
  </div>
</div>
```

**Référence :** `LiveActivityHero` dans `src/components/analytics/LiveActivityHero.tsx:124–140`

---

## 4. Typographie

### Règles

| Rôle | Taille | Poids | Couleur | Lettre-espacement |
|---|---|---|---|---|
| Titre de section | `15–15.5px` | 600–700 | `T1` | `-0.01em` |
| KPI principal | `clamp(26px,3vw,36px)` | 640 | `T1` | `-0.025em` |
| KPI secondaire | `22–24px` | 640 | `T1` | `-0.02em` |
| Label uppercase | `10–11px` | 600 | `T3` | `0.07–0.08em` |
| Texte corps | `13–14px` | 400–500 | `T2` | normal |
| Texte muted | `11–12px` | 400 | `T3` | normal |
| Valeur tabular | `13–14px` | 620 | `T1` | `-0.01em` |

### Exemples

```tsx
{/* Titre de card avec icon */}
<h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
  Revenu brut — horaire
</h3>

{/* Sous-titre / sub-label */}
<p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
  Distribution sur la période sélectionnée
</p>

{/* Chiffre KPI géant */}
<div style={{ color: T1, fontSize: 'clamp(26px,3vw,36px)', fontWeight: 640, letterSpacing: '-0.025em' }}
  className="tabular-nums leading-none">
  €12.4k
</div>

{/* Label uppercase */}
<span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
  Revenu brut
</span>
```

**Référence :** KPI cards dans `src/pages/OwnerAnalytics.tsx:627–647`

---

## 5. Icônes & Headers de carte

Pattern standard pour l'en-tête d'une card avec icon + titre + sous-titre + élément droit.

```tsx
<div className="flex items-start justify-between gap-3 mb-4">
  <div className="flex items-center gap-3">
    {/* Icon container */}
    <div
      className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
    >
      <TrendingUp className="w-4 h-4" />
    </div>
    <div>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
        Titre
      </h3>
      <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
        Sous-titre
      </p>
    </div>
  </div>
  {/* Élément droit optionnel */}
  {right}
</div>
```

**Variante accent RED (section premium) :**

```tsx
<div
  className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
>
  <Sparkles className="w-4 h-4" style={{ color: RED }} />
</div>
```

**Référence :** `PCard` header dans `src/pages/OwnerAnalytics.tsx:74–91` · `AcquisitionDashboard` dans `src/components/analytics/AcquisitionDashboard.tsx:130–141`

---

## 6. Contrôles de navigation

### 6.1 Segment control (toggle)

```tsx
<div
  className="inline-flex gap-0.5 p-1 rounded-xl"
  style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}
>
  {options.map(o => (
    <button
      key={o.key}
      onClick={() => onChange(o.key)}
      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150"
      style={value === o.key
        ? {
            color: T1,
            background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))',
            boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000',
          }
        : { color: T3 }
      }
    >
      {o.icon && <span style={{ opacity: 0.7 }}>{o.icon}</span>}
      {o.label}
    </button>
  ))}
</div>
```

**Référence :** `Seg` dans `src/pages/OwnerAnalytics.tsx:291–317`

---

### 6.2 Filter bar (période)

```tsx
<div
  className="flex gap-1 flex-wrap p-1 rounded-xl"
  style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}
>
  {options.map(opt => (
    <button
      key={opt.key}
      onClick={() => setRange(opt.key)}
      className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
      style={range === opt.key
        ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` }
        : { color: T3 }
      }
    >
      {opt.label}
    </button>
  ))}
</div>
```

**Référence :** `AnalyticsPeriodFilter` dans `src/components/analytics/AnalyticsPeriodFilter.tsx:75–92`

---

### 6.3 Tab bar (catégories avec indicateur)

```tsx
<div className="flex gap-0.5 mb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
  {tabs.map(tab => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id)}
        className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
        style={{ color: isActive ? T1 : T3 }}
      >
        <Icon className="w-4 h-4" />
        <span className="hidden sm:inline">{tab.label}</span>
        {isActive && (
          <span
            className="absolute left-3 right-3 rounded-full"
            style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }}
          />
        )}
      </button>
    );
  })}
</div>
```

**Référence :** Tab bar dans `src/pages/OwnerAnalytics.tsx:829–851`

---

### 6.4 Nav rail vertical (sidebar de pilier)

Active state utilise le RED comme accent. Pattern réutilisable pour toute navigation
verticale en rail (n'est plus monté dans la page Analytics, conservé ici comme référence).

```tsx
<button
  className="group relative flex items-center gap-2.5 p-3 w-full text-left rounded-xl transition-all cursor-pointer"
  style={active
    ? { background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.22)', boxShadow: '0 1px 0 rgba(255,255,255,.04) inset' }
    : { border: '1px solid transparent' }
  }
>
  <Icon className="h-4 w-4" style={{ color: active ? RED : 'rgba(255,255,255,0.35)' }} />
  <div className="flex-1 min-w-0">
    <div className="text-sm font-semibold" style={{ color: active ? T1 : 'rgba(255,255,255,0.5)' }}>
      {label}
    </div>
    <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.28)' }}>
      {description}
    </div>
  </div>
  {active && (
    <div className="w-1 h-5 rounded-full flex-none" style={{ background: RED, opacity: 0.8 }} />
  )}
</button>
```

**Référence :** pattern conservé ci-dessus (composant `AnalyticsHubLayout` retiré lors du passage aux zones natives).

---

## 7. Badges & Pills

### 7.1 Delta (variation %)

```tsx
function Delta({ delta, dir, vs }: { delta: number; dir: 'up' | 'down'; vs?: string }) {
  const up = dir === 'up';
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold tabular-nums"
      style={{ color: up ? POS : NEG }}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(delta).toFixed(1)}%
      {vs && <span className="font-normal ml-1" style={{ color: T3 }}>{vs}</span>}
    </span>
  );
}
```

**Référence :** `Delta` dans `src/pages/OwnerAnalytics.tsx:98–111`

---

### 7.2 Live badge

```tsx
<div
  className="flex items-center gap-2 px-3 py-1.5 rounded-full"
  style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}
>
  <div className="relative">
    <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
    <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75" style={{ background: POS }} />
  </div>
  <span className="text-sm font-semibold tabular-nums" style={{ color: POS }}>
    {count} <span className="font-normal opacity-70">online</span>
  </span>
</div>
```

**Référence :** Header live badge dans `src/pages/OwnerAnalytics.tsx:551–561`

---

### 7.3 Pill status (hot / accent / default)

```tsx
// hot = rouge / accent = jaune / default = blanc
<div
  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
  style={
    hot
      ? { border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.1)', color: RED }
      : accent
      ? { border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.06)', color: '#FCD34D' }
      : { border: `1px solid ${BORDER}`, background: C_FAINT, color: T1 }
  }
>
  <Icon className="h-3.5 w-3.5" />
  <span className="text-sm font-semibold tabular-nums">{value}</span>
</div>
```

**Référence :** `Pill` dans `src/components/analytics/LiveActivityHero.tsx:178–194`

---

### 7.4 Badge lock / plan

```tsx
<div
  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
  style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: RED }}
>
  <LockIcon className="w-3.5 h-3.5" />
  Pro
</div>
```

---

## 8. Indicateurs de données

### 8.1 Sparkline SVG (Catmull-Rom)

```tsx
function Sparkline({ pts, accent = false }: { pts: number[]; accent?: boolean }) {
  const W = 96, H = 34, pad = 3;
  // ... smooth() path helper (voir OwnerAnalytics.tsx:114–129)
  const stroke = accent ? RED : C_HI;
  const uid = `sg${pts.length}${Math.round((pts[0] ?? 0) * 10)}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="1" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.2} fill={stroke} />
    </svg>
  );
}
```

**Référence :** `Sparkline` dans `src/pages/OwnerAnalytics.tsx:131–156`

---

### 8.2 Barres verticales (hourly revenue)

```tsx
// bar peak = RED, autres = C_MID
// rounded top avec path SVG
// labels every 3 bars
```

**Référence :** `RevenueBars` dans `src/pages/OwnerAnalytics.tsx:158–197`

---

### 8.3 Progress bar

```tsx
{/* Track */}
<div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
  {/* Fill */}
  <div
    className="h-full rounded-full transition-all duration-700"
    style={{ width: `${pct}%`, background: color }}
  />
</div>

{/* Variante gradient RED pour funnels */}
<div style={{ background: 'linear-gradient(90deg, rgba(232,25,44,0.75), rgba(232,25,44,0.35))' }} />
```

**Référence :** Funnel steps dans `src/components/analytics/BehaviorAnalytics.tsx:158–174`

---

### 8.4 Donut chart SVG

```tsx
// Utilise strokeDasharray/offset sur des <circle> SVG
// Trait de fond : stroke="rgba(255,255,255,0.04)"
// Texte central : T1 pour la valeur, T3 pour le label
// rotate-90 sur le SVG pour partir en haut
```

**Référence :** `DonutChart` dans `src/pages/OwnerAnalytics.tsx:250–288` (revenue mix) · `src/components/analytics/AcquisitionDashboard.tsx` (sources)

---

### 8.5 Heatmap (jour × heure)

```tsx
// Cellule vide : 'rgba(255,255,255,0.03)'
// Cellule active : `rgba(232,25,44,${0.10 + intensity * 0.68})`
// Labels d'axe : T3
```

**Référence :** `Heatmap` dans `src/components/analytics/BehaviorAnalytics.tsx:207–236`

---

## 9. Listes & Tables

### 9.1 Liste ranked (top sellers)

```tsx
<div className="divide-y" style={{ '--tw-divide-opacity': 1, borderColor: BORDER } as any}>
  {items.map((p, i) => (
    <div key={i} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '20px 1fr auto' }}>
      {/* Rang */}
      <span className="text-[12.5px] tabular-nums" style={{ color: T3 }}>
        {String(i + 1).padStart(2, '0')}
      </span>
      {/* Contenu + barre */}
      <div className="min-w-0">
        <div className="text-sm font-[560] truncate" style={{ color: T1 }}>{p.name}</div>
        <div className="text-[11.5px] mt-1" style={{ color: T3 }}>{p.quantity} vendus</div>
        <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded transition-all"
            style={{
              width: `${barPct}%`,
              background: i === 0
                ? `linear-gradient(90deg,${RED}88,${RED})`
                : `linear-gradient(90deg,${C_MID},${C_HI})`,
            }}
          />
        </div>
      </div>
      {/* Valeur */}
      <div className="text-right">
        <div className="text-sm font-[620] tabular-nums" style={{ color: T1 }}>{p.revenue}</div>
      </div>
    </div>
  ))}
</div>
```

**Référence :** Top sellers dans `src/pages/OwnerAnalytics.tsx:748–787`

---

### 9.2 Table de données

```tsx
<table className="w-full text-xs">
  <thead>
    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
      <th className="px-2 py-2 font-medium text-left" style={{ color: T3 }}>Source</th>
      <th className="px-2 py-2 font-medium text-right" style={{ color: T3 }}>Visites</th>
    </tr>
  </thead>
  <tbody>
    {rows.map((r, i) => (
      <tr key={i} style={{ borderBottom: `1px solid ${F_BORDER}` }} className="last:border-0">
        <td className="px-2 py-2 font-semibold" style={{ color: T1 }}>{r.source}</td>
        <td className="px-2 py-2 text-right tabular-nums" style={{ color: T1 }}>{r.visits}</td>
      </tr>
    ))}
  </tbody>
</table>
```

**Référence :** UTM table dans `src/components/analytics/AcquisitionDashboard.tsx:152–200`

---

## 10. États spéciaux

### 10.1 Loading spinner

```tsx
<div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
  <div className="text-center">
    <div
      className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto"
      style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }}
    />
    <p className="text-sm" style={{ color: T3 }}>Chargement…</p>
  </div>
</div>
```

**Référence :** `src/pages/OwnerAnalytics.tsx:420–428`

---

### 10.2 Empty state

```tsx
<div className="text-center py-8 px-4">
  <Globe className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
  <p className="text-xs max-w-sm mx-auto" style={{ color: T3 }}>
    Aucune donnée pour cette période.
  </p>
</div>
```

**Référence :** `EmptyState` dans `src/components/analytics/AcquisitionDashboard.tsx`

---

### 10.3 Locked / Upgrade gate

```tsx
<div className="text-center py-4">
  <LockIcon className="h-8 w-8 mx-auto mb-3" style={{ color: RED }} />
  <p className="font-semibold mb-1" style={{ color: T1 }}>Fonctionnalité Pro</p>
  <p className="text-sm mb-4" style={{ color: T3 }}>Description de la feature.</p>
  <Button asChild style={{ background: RED, color: '#fff' }}>
    <Link to="/owner/billing">Passer à Pro</Link>
  </Button>
</div>
```

**Référence :** `src/pages/OwnerAnalytics.tsx:459–468`

---

## 11. Layout & Structure de page

### 11.1 Page wrapper

```tsx
<div className="min-h-screen pb-28" style={{ background: '#000' }}>
  {/* Vignette ambiante */}
  <div className="fixed inset-0 pointer-events-none z-0"
    style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

  <OwnerHeader title="…" rightContent={<LiveBadge />} />

  <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">
    {/* Sections */}
  </div>
</div>
```

---

### 11.2 Grille de KPI (4 colonnes)

```tsx
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
  {kpis.map((kpi, i) => (
    <div key={i} style={{ ...MAIN_CARD_STYLE }}>
      {/* contenu */}
    </div>
  ))}
</div>
```

---

### 11.3 Finance strip (séparation par bordure)

```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
  {items.map((f, i) => (
    <div key={i}
      className={i > 0 ? 'sm:border-l pl-0 sm:pl-4' : ''}
      style={{ borderColor: BORDER }}
    >
      <div style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{f.label}</div>
      <div style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums mt-2">
        {f.val}
      </div>
      <div style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{f.desc}</div>
    </div>
  ))}
</div>
```

**Référence :** Finance strip dans `src/pages/OwnerAnalytics.tsx:893–913`

---

## 12. Animation & Motion

Utilise `framer-motion` pour toutes les animations de page.

```tsx
import { motion } from 'framer-motion';

// Apparition de section (stagger par delay)
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.05 }}
>
  {children}
</motion.div>

// Apparition d'item de liste (stagger par index)
<motion.div
  initial={{ opacity: 0, x: -8 }}
  animate={{ opacity: 1, x: 0 }}
  transition={{ delay: i * 0.04 }}
>
  {item}
</motion.div>

// Transition de tab/pilier (AnimatePresence)
<AnimatePresence mode="wait">
  <motion.div
    key={activeTab}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -4 }}
    transition={{ duration: 0.2 }}
  >
    {content}
  </motion.div>
</AnimatePresence>
```

**Durées :** micro-interactions 150ms · transitions 200ms · entrées de section 300ms

---

## 13. Checklist pré-livraison

Avant de soumettre un composant redesigné :

- [ ] **Aucun `<Card>` shadcn** — tous remplacés par `<div>` inline-styled
- [ ] **Aucun `text-foreground` / `text-muted-foreground`** — remplacés par `T1` / `T2` / `T3`
- [ ] **Aucun `text-primary` / `bg-primary`** — remplacés par `RED` ou token de couleur explicite
- [ ] **Fond de page `background: 'var(--sf-000000)'`** sur le wrapper principal (jamais `'#000'` : le thème clair ne le verrait pas)
- [ ] **Vérifié dans les DEUX thèmes** (§17) : aucun `rgba(255,255,255,…)`, `#fff`, `#0a0a0c` en dur ; blanc sur fond coloré = `snow`
- [ ] **Tous les boutons cliquables** ont `cursor-pointer`
- [ ] **`tabular-nums`** sur tous les chiffres
- [ ] **`letterSpacing: '-0.02em'`** sur les grandes valeurs numériques
- [ ] **`overflow-hidden`** sur toutes les cartes avec contenu débordant
- [ ] **`transition-all duration-150`** sur les hover states
- [ ] **Responsive** : tester à 375px, 768px, 1024px, 1440px
- [ ] **Pas d'emoji** — uniquement icônes Lucide

---

## 14. Fichiers de référence

| Fichier | Rôle |
|---|---|
| `src/pages/OwnerAnalytics.tsx` | Page référence principale — tokens, PCard, Delta, Sparkline, RevenueBars, FunnelRibbon, DonutChart, Seg, ZoneHeading |
| `src/components/analytics/AcquisitionDashboard.tsx` | Zone Trafic web — cartes natives, table, ramp rouge+mono, DonutChart sources |
| `src/components/analytics/BehaviorAnalytics.tsx` | Zone Engagement web — StatTile, Heatmap, DeviceBar |
| `src/components/analytics/AudienceInsights.tsx` | Zone Audience — TierTile, segments RFM, new vs returning |
| `src/components/OwnerHeader.tsx` | Header pattern avec slot droit |

---

## 13. Page « travail partagé » (co-soirée club ↔ organisateur)

Référence : `src/components/collab/CollabEventDetail.tsx` + `CollabJourney.tsx` (2026-09-21).
Une page que DEUX entreprises lisent, souvent pour la première fois, sans formation.

| Règle | Pourquoi |
|---|---|
| **Feuille de route en tête** : six étapes (proposition → contrat → ventes → soirée → décompte → réglé), l'étape courante en rouge, UNE action dessous | La question numéro un d'un club est « et maintenant, je fais quoi ? ». Quand c'est à l'autre partie d'agir, on l'écrit (« Goya doit signer »), on n'invente pas de bouton |
| **Trois chiffres, pas cinq** : vendus / CA de la soirée / ma part | Deux montants « à moi » qui diffèrent (brut, net) se lisent comme une erreur |
| **Deux colonnes sur desktop** (`lg:grid-cols-[minmax(0,1fr)_340px]`) : le travail de la phase à gauche, ce qui accompagne à droite (contrat signé replié, fil partenaire, objectif) | Modèle Polaris « resource details » : le principal occupe les deux tiers ; sur mobile la colonne latérale passe DEVANT (`order-first`) |
| **L'ordre suit la phase** : après la soirée, le décompte passe devant l'argent et les outils | La page ne se lit pas dans le même ordre le jour de la signature et le lendemain de la soirée |
| **Une grille (barème, %) se montre UNE fois**, derrière « Voir le détail » une fois signée | Répétée trois fois (bannière, panneau, carte), elle faisait passer la page pour un contrat |
| **Analyses, bilan, carte du bar : repliés** (`Foldable`) | Vides avant la soirée, longs après (le bilan empile ses onglets sur mobile). Progressive disclosure : résumé → contexte → détail |
| **Pas de panneau argent tant que le contrat n'est pas signé** | Il retombait sur un défaut 50/50 pendant qu'une proposition 40/60 attendait juste au-dessus |
| **Couleur = statut seulement** : rouge = à faire, vert = fait, gris = en attente de l'autre | Le reste en typographie et opacité (T1/T2/T3) |

---

## 15. Centre d'aide pro (mode d'emploi club / organisateur / agence / manager)

Référence : `src/pages/OwnerHelpCenter.tsx` (coquille + URL) et `src/components/help/*`
(2026-09-22). Un seul moteur pour les quatre dashboards, le contenu vient de
`src/data/*HelpContent.ts`, les textes des clés `ohelp.*`.

| Règle | Pourquoi |
|---|---|
| **Trois écrans adressés par l'URL** : `/help`, `/help?category=<id>`, `/help?article=<id>[&s=<n>]` | Un article se partage, le bouton « retour » du navigateur marche, un écran peut envoyer sur SON article (`?article=`) et même sur la section qui répond (`&s=`) |
| **Accueil = héros + recherche, thèmes, populaires, aide** (`HelpHome`) : titre centré, halo rouge (§3.5) et trame de points derrière, barre de recherche 50 px avec raccourci `/`, tuiles de thème (2 col. mobile / 3 desktop, la première en accent rouge), articles populaires (`quickStart`), « Encore besoin d'aide ? » | Modèle « FAQ / documentation landing » : la recherche d'abord, l'escalade humaine en bas, jamais 30 articles à plat |
| **Article = deux colonnes sur desktop** (`minmax(0,1fr) 236px`) : fil d'Ariane, titre, pastilles (thème, temps de lecture, sections), capture héros plafonnée à 420 px, sommaire « Sur cette page » collant à droite avec suivi du défilement (barre rouge), sommaire replié « Dans cet article » sur mobile | Une page de 18 sections se lit avec un plan ; l'étape courante se voit |
| **Les pâtés de texte sont dessinés, pas réécrits** (`src/lib/helpText.ts`) : « 1. » → étapes numérotées en pastilles rouges reliées, « • » → puces (✅ / ❌ → coche verte / croix rouge), « A → B → C » → pastilles enchaînées, `"libellé"` → T1 semi-gras, `**gras**` | Les 2 000 clés restent intactes ; une convention absente rend un paragraphe |
| **Encadrés** (`type` de section) : conseil = POS, attention = AMBER `#F2B23C`, exemple = blanc 70 %, étapes = RED — liseré gauche 3 px + dégradé 7 % | La couleur dit la nature du bloc, pas la marque |
| **L'IA est une conversation DANS la page** (`HelpAiChat`, carte rouge à orbe : en-tête, fil à bulles, champ, suggestions, pied « réponses générées d'après le mode d'emploi »), présente pour tous les pros sur l'accueil et en bas de chaque article (contexte « À propos de « titre » »). La ligne « Demander à l'assistant : « requête » » sous les résultats envoie la question à cette carte ; « Pas utile » y place le curseur | Un panneau à part coupait le pro de l'article qu'il lisait ; ici la réponse arrive sous le texte, avec un lien vers l'article utile |
| **Une couleur par thème** (`CATEGORY_COLORS`) : rouge = démarrage, bleu = vue d'ensemble, violet = événements, rose = marketing, ambre = opérations, cyan = paramètres, vert = écosystème, sarcelle = finance — sur la tuile, l'icône d'article, la pastille de résultat. IA rouge, support bleu, email violet | Six tuiles grises se ressemblent ; la couleur est le repère qui survit d'un écran à l'autre |
| **En-tête de l'app hôte** : `OwnerHeader` chez le club / manager, `OrgPageHeader` chez l'organisateur / l'agence | Deux barres empilées (celle du layout + celle de la page) laissaient un « trou » noir et deux flèches |
| **Recherche** (`src/lib/helpSearch.ts`) : pliée sans accents, scorée titre > mots-clés > description > sections, résultat = article + section qui a fait mouche + extrait surligné | Ouvrir l'article au bon paragraphe, pas en haut |
| **Avis « utile ? » et « reprendre »** vivent en `localStorage` | Aucune table, aucune migration : ce sont des conforts, pas des données |


---

## 16. Écran d'action (publication, envoi, import, décompte)

Les quatre « animations » de la Console — publier une soirée
(`PublishingOverlay`), envoyer une campagne (`ReviewStep`), importer des
contacts (`ContactImportDialog`), répartir une co-soirée
(`CollabNightClosingCard`) — passent toutes par UN moteur :
`src/components/action/ActionOverlay.tsx`, tokens dans
`src/components/action/tokens.ts` (`ACT`). Elles sont dans CE design system
depuis le 2026-09-24 (elles avaient d'abord été dessinées en DA publique :
Space Grotesk, mono, filet rouge — à ne pas réintroduire).

- Fond flouté `rgba(0,0,0,.72)`, une **carte hero** (§3.5) de 520 px max au
  centre : icône d'état 40 px (spinner rouge → coche verte), titre 17 px sur
  UNE ligne (les `\n` des clés i18n sont repliés), étape en cours en T3,
  pourcentage en KPI à droite, remplacé à la fin par une pill verte (§7.2)
  portant le mot final.
- Progress bar §8.3 (6 px, rouge en cours, `POS` terminé). Étapes dans une
  carte imbriquée (§3.2) : numéro → spinner → coche, statut coloré
  (T3 / rouge / vert).
- Carte de résultat = `ActionResultCard` + `ActionFigure` (KPI + label
  uppercase, `primary` / `secondary`) + `ActionNote` (muted). Un nouvel écran
  d'action compose ces trois-là, il ne redessine pas de chiffre à la main.
- Rouge pendant le travail, vert quand c'est fait : c'est la seule
  sémantique de couleur de l'écran. La mécanique (plancher, plafond, compteur
  borné à 99 %) est décrite en tête du fichier et ne se touche pas pour un
  changement visuel.

---

## 17. Thème clair / sombre (2026-09-24)

Toute la Yuno Console (club, manager, organisateur, agence), les espaces
affilié, promoteur, DJ et le super admin existent en **sombre** (historique,
par défaut) et en **clair**. Réglage « Apparence » au pied de chaque barre
latérale (Clair / Sombre) + icône lune/soleil dans les en-têtes. La nouvelle
couleur s'ouvre en cercle depuis le bouton cliqué : tout bouton qui change le
thème passe son centre (`setPref(next, originOf(e.currentTarget))`).
Le cercle est une animation CSS (`pro-theme-reveal`, 600 ms, courbe presque
linéaire — un ease-out faisait ramper le bord vers le dernier coin et se
lisait comme un blocage à mi-course) lue dans `--vt-x/--vt-y/--vt-r`, posés avant la
capture ; pendant la bascule, `html.pro-theme-vt *` coupe toutes les
transitions et met en pause les animations de la page — sans ça, chaque
`transition-colors` se déclenchait sur le changement de couleur et faisait
accrocher le cercle en plein milieu.
Code : `src/lib/proTheme.ts`, `src/components/ProThemeController.tsx`,
`src/components/ProThemeSwitch.tsx`, `src/styles/pro-theme.css`,
`tailwind.theme.ts`. Garde-fou : `src/lib/__tests__/proTheme.test.ts`.

### Le principe : on change l'encre, pas le dessin

Le thème clair est posé par `html[data-pro-theme="light"]`, et SEULEMENT sur
une route pro (`isThemedProPath`). Tout vaut le sombre d'origine à `:root` :
les pages publiques, l'app client, les emails et le staff de nuit (bar, porte,
vestiaire, hôte VIP) ne bougent jamais.

| Besoin | Écrire | Jamais |
|---|---|---|
| Texte, bordure, fond translucide | `rgb(var(--ink)/0.58)`, les tokens `T1…BORDER` | `rgba(255,255,255,0.58)` |
| Fond de page / carte / champ | `var(--pro-page)`, `var(--pro-card)`, `var(--pro-elev)` (ou un `var(--sf-<hex>)` existant) | `#000`, `#0a0a0c`, `#1f1f22` |
| Accent vif (vert, ambre, bleu…) | `var(--acc-<hex>)` — valeur exacte en sombre, assombrie en clair | un hex pastel en dur pour du texte |
| Gris de texte (`#9A9A9A`…) | `var(--tx-<hex>)` (miroir en clair) | le hex en dur |
| Blanc SUR un fond coloré (bouton rouge, badge, photo) | `text-snow` / `color: '#fff'` | `text-white` (qui devient noir en clair) |
| Teinte translucide d'un accent | `tint(POS, '1A')` | `` `${POS}1A` `` (couleur invalide avec une variable) |
| Bouton blanc inversé | `bg-white text-paper` | `bg-white text-black` |

En Tailwind, **`white`, les gris (`zinc`, `neutral`, `gray`…) et les couleurs
vives sont des variables** : `text-white/60`, `bg-zinc-900`, `text-emerald-400`
basculent tout seuls (gris en miroir 400 ↔ 600, couleurs vives 400 → 600, les
fonds pleins 500-700 ne bougent pas). `snow` est le seul blanc fixe.

### Îlots sombres

`data-theme-island="dark"` sur un conteneur rétablit le sombre à l'intérieur :
bannière photo du tableau de bord (club et organisateur), la carte du globe de
la vue En direct (les panneaux autour suivent le thème),
maquettes de téléphone (SMS, pub Meta), aperçu de la page client. Toute surface
qui montre CE QUE VOIT LE CLIENT, ou une photo sous voile, est un îlot.

### Ajouter une couleur

Une nouvelle `var(--sf-…)`, `var(--acc-…)`, `var(--tx-…)` ou `var(--glass-…)`
se déclare dans les TROIS blocs de `pro-theme.css` (`:root`, clair, îlot) — le
test `proTheme.test.ts` échoue sinon, parce qu'une variable absente rend une
couleur invalide que le navigateur ignore en silence, dans les deux thèmes.
Ne jamais passer ces tokens à un canvas, à Mapbox, à un PDF ou à un email :
ces rendus ne connaissent pas les variables CSS (garder un hex).
