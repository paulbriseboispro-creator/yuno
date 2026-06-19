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
| **Fond pur noir** | `#000` ou `#0a0a0c` — jamais de gris ou bleu foncé |
| **Lumière subtractibe** | Les éléments s'éclairent, ils ne s'assombrissent pas |
| **Accent rouge unique** | `#E8192C` est le seul accent de couleur systémique |
| **Hiérarchie par opacité** | Blanc à 96% → 58% → 36% — jamais de classes Tailwind `text-foreground` |
| **Pas de shadcn Card** | `<Card>` shadcn est banni — toujours des `<div>` avec inline styles |
| **Zéro emoji** | Uniquement des icônes Lucide |

---

## 2. Design Tokens

Copie ce bloc en haut de chaque composant ou fichier de page.

```tsx
// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';                        // accent principal
const POS     = '#34D399';                        // positif / live / succès
const NEG     = '#FF5C63';                        // négatif / erreur / drop-off
const T1      = 'rgba(255,255,255,0.96)';         // texte primaire
const T2      = 'rgba(255,255,255,0.58)';         // texte secondaire
const T3      = 'rgba(255,255,255,0.36)';         // texte tertiaire / labels / muted
const C_HI    = 'rgba(255,255,255,0.92)';         // fill haute intensité (sparklines)
const C_MID   = 'rgba(255,255,255,0.40)';         // fill moyen (barres secondaires)
const C_LO    = 'rgba(255,255,255,0.14)';         // fill bas (funnel outer)
const C_FAINT = 'rgba(255,255,255,0.06)';         // fond de tile interne
const BORDER  = 'rgba(255,255,255,0.085)';        // bordure standard
const F_BORDER= 'rgba(255,255,255,0.055)';        // bordure faible (séparateurs)

// Fonds
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';       // carte imbriquée dans CARD_BG
const TILE_BG  = 'rgba(255,255,255,0.025)';       // tile imbriqué dans INNER_BG

// Ombres
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
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
- [ ] **Fond de page `background: '#000'`** sur le wrapper principal
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
