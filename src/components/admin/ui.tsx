/**
 * Kit UI du super admin — l'unique source des tokens et des primitives.
 *
 * Tout vient de docs/DESIGN_SYSTEM.md (Yuno Dark Premium) : fond noir pur,
 * cartes inline-stylées, hiérarchie par opacité, un seul accent rouge, icônes
 * Lucide, zéro emoji, zéro <Card> shadcn. Aucune page admin ne redéclare un
 * token ni une carte : elle importe d'ici.
 */
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Inbox, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';

// ─── Tokens (DS §2) ──────────────────────────────────────────────────────────
export const RED = '#E8192C';
export const POS = '#34D399';
export const NEG = '#FF5C63';
/** Ambre du DS (pill « accent », §7.3). Seul jaune autorisé. */
export const WARN = '#FCD34D';
export const T1 = 'rgba(255,255,255,0.96)';
export const T2 = 'rgba(255,255,255,0.58)';
export const T3 = 'rgba(255,255,255,0.36)';
export const C_HI = 'rgba(255,255,255,0.92)';
export const C_MID = 'rgba(255,255,255,0.40)';
export const C_LO = 'rgba(255,255,255,0.14)';
export const C_FAINT = 'rgba(255,255,255,0.06)';
export const BORDER = 'rgba(255,255,255,0.085)';
export const F_BORDER = 'rgba(255,255,255,0.055)';
export const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const INNER_BG = 'rgba(255,255,255,0.032)';
export const TILE_BG = 'rgba(255,255,255,0.025)';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
export const RED_SOFT_BG = 'rgba(232,25,44,0.10)';
export const RED_SOFT_BORDER = 'rgba(232,25,44,0.22)';

/** Palette de séries pour les graphiques : rouge d'abord, puis des blancs. */
export const CHART = [RED, C_HI, 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.30)', WARN, POS] as const;

export const CARD_STYLE: CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  overflow: 'hidden',
  position: 'relative',
};

export const INNER_STYLE: CSSProperties = {
  background: INNER_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  overflow: 'hidden',
};

export const TILE_STYLE: CSSProperties = {
  background: TILE_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: '10px 12px',
};

/** Style d'un champ de saisie sombre (input, select, textarea). */
export const INPUT_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  color: T1,
  fontSize: 13,
  padding: '8px 11px',
  outline: 'none',
  width: '100%',
};

export const LABEL_STYLE: CSSProperties = {
  color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
};

export const RECHARTS_TOOLTIP: CSSProperties = {
  background: '#0f0f12', border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 12, boxShadow: CARD_SHADOW,
};

// ─── Page ────────────────────────────────────────────────────────────────────
export function AdminPage({ eyebrow, title, subtitle, actions, children, wide }: {
  eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="min-h-screen pb-20" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.045),transparent 55%)' }} />
      <div className={`relative z-10 mx-auto px-4 sm:px-6 pt-6 space-y-6 ${wide ? 'max-w-[1560px]' : 'max-w-[1340px]'}`}>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            {eyebrow && <div className="mb-1.5 flex items-center gap-2" style={{ color: RED, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{eyebrow}</div>}
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>{title}</h1>
            {subtitle && <p style={{ color: T3, fontSize: 13, marginTop: 6, maxWidth: 720 }}>{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Cartes (DS §3 + §5) ─────────────────────────────────────────────────────
export function Card({ title, subtitle, icon: Icon, right, accent, children, pad = 22, style, className, flush }: {
  title?: ReactNode; subtitle?: ReactNode; icon?: LucideIcon; right?: ReactNode; accent?: boolean;
  children?: ReactNode; pad?: number | string; style?: CSSProperties; className?: string; flush?: boolean;
}) {
  return (
    <div className={className} style={{ ...CARD_STYLE, padding: flush ? 0 : pad, ...style }}>
      {(title || Icon || right) && (
        <div className="flex items-start justify-between gap-3" style={{ marginBottom: children ? 16 : 0, padding: flush ? `${typeof pad === 'number' ? pad : 22}px ${typeof pad === 'number' ? pad : 22}px 0` : 0 }}>
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={accent ? { background: RED_SOFT_BG, border: `1px solid ${RED_SOFT_BORDER}` } : { background: C_FAINT, border: `1px solid ${BORDER}` }}>
                <Icon className="w-4 h-4" style={{ color: accent ? RED : T2 }} />
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{title}</h3>}
              {subtitle && <p style={{ color: T3, fontSize: 11.5, marginTop: 2, margin: '2px 0 0' }}>{subtitle}</p>}
            </div>
          </div>
          {right && <div className="flex-none flex items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Inner({ children, style, className, pad = '16px 18px' }: { children: ReactNode; style?: CSSProperties; className?: string; pad?: number | string }) {
  return <div className={className} style={{ ...INNER_STYLE, padding: pad, ...style }}>{children}</div>;
}

export function Tile({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return <div className={className} style={{ ...TILE_STYLE, ...style }}>{children}</div>;
}

/** Titre de zone (numéro + libellé), pour découper une page longue. */
export function SectionHeading({ n, label, icon: Icon, right, accent }: { n?: string | number; label: ReactNode; icon?: LucideIcon; right?: ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <div className="flex items-center gap-2.5">
        {n !== undefined && <span className="tabular-nums" style={{ color: accent ? RED : T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>{String(n).padStart(2, '0')}</span>}
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color: accent ? RED : T3 }} />}
        <h2 style={{ color: T1, fontSize: 12.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>{label}</h2>
      </div>
      {right}
    </div>
  );
}

// ─── KPI (DS §4, §11.2) ──────────────────────────────────────────────────────
export function Delta({ value, suffix = '%', invert, vs }: { value: number | null | undefined; suffix?: string; invert?: boolean; vs?: ReactNode }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span style={{ color: T3, fontSize: 12 }}>—</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  const color = value === 0 ? T3 : good ? POS : NEG;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums" style={{ color }}>
      {value === 0 ? null : up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}{suffix}
      {vs && <span className="font-normal ml-1" style={{ color: T3 }}>{vs}</span>}
    </span>
  );
}

export function Stat({ label, value, sub, delta, deltaVs, deltaInvert, icon: Icon, highlight, tone, spark, sparkAccent, to, compact }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; delta?: number | null; deltaVs?: ReactNode; deltaInvert?: boolean;
  icon?: LucideIcon; highlight?: boolean; tone?: 'pos' | 'neg' | 'warn'; spark?: number[]; sparkAccent?: boolean; to?: string; compact?: boolean;
}) {
  const valueColor = tone === 'neg' ? NEG : tone === 'pos' ? POS : tone === 'warn' ? WARN : highlight ? RED : T1;
  const body = (
    <div style={{
      background: highlight ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.035)),#0a0a0c' : CARD_BG,
      border: `1px solid ${highlight ? 'rgba(232,25,44,0.24)' : BORDER}`,
      borderRadius: 16, boxShadow: CARD_SHADOW, padding: compact ? '12px 14px' : '16px 18px', height: '100%', overflow: 'hidden', position: 'relative',
    }} className={to ? 'transition-all duration-150 hover:border-white/20' : undefined}>
      <div className="flex items-start justify-between gap-2" style={{ marginBottom: compact ? 8 : 12 }}>
        <p style={{ ...LABEL_STYLE, margin: 0 }}>{label}</p>
        {Icon && (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
            style={{ background: highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${highlight ? RED_SOFT_BORDER : F_BORDER}` }}>
            <Icon className="h-3.5 w-3.5" style={{ color: highlight ? RED : T2 }} />
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular-nums leading-none" style={{ color: valueColor, fontSize: compact ? 22 : 26, fontWeight: 640, letterSpacing: '-0.025em', margin: 0 }}>{value}</p>
          {(sub || delta !== undefined) && (
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 8 }}>
              {delta !== undefined && <Delta value={delta} vs={deltaVs} invert={deltaInvert} />}
              {sub && <span style={{ color: T3, fontSize: 11 }}>{sub}</span>}
            </div>
          )}
        </div>
        {spark && spark.length > 1 && <Sparkline pts={spark} accent={sparkAccent ?? highlight} />}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

// ─── Sparkline (DS §8.1) ─────────────────────────────────────────────────────
function smoothPath(xs: number[], ys: number[]): string {
  if (xs.length < 2) return '';
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const p0x = xs[i - 1] ?? xs[i], p0y = ys[i - 1] ?? ys[i];
    const p1x = xs[i], p1y = ys[i];
    const p2x = xs[i + 1], p2y = ys[i + 1];
    const p3x = xs[i + 2] ?? p2x, p3y = ys[i + 2] ?? p2y;
    const c1x = p1x + (p2x - p0x) / 6, c1y = p1y + (p2y - p0y) / 6;
    const c2x = p2x - (p3x - p1x) / 6, c2y = p2y - (p3y - p1y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2x},${p2y}`;
  }
  return d;
}

export function Sparkline({ pts, accent = false, w = 96, h = 34 }: { pts: number[]; accent?: boolean; w?: number; h?: number }) {
  const { line, area, lx, ly, uid } = useMemo(() => {
    const pad = 3;
    const max = Math.max(...pts, 1), min = Math.min(...pts, 0);
    const xs = pts.map((_, i) => pad + (i / Math.max(pts.length - 1, 1)) * (w - pad * 2));
    const ys = pts.map((v) => h - pad - ((v - min) / Math.max(max - min, 1)) * (h - pad * 2));
    const line = smoothPath(xs, ys);
    const area = `${line} L${xs[xs.length - 1]},${h} L${xs[0]},${h} Z`;
    const uid = `sg${pts.length}${Math.round((pts[0] ?? 0) * 10)}${Math.round((pts[pts.length - 1] ?? 0) * 10)}${accent ? 'a' : 'w'}`;
    return { line, area, lx: xs[xs.length - 1], ly: ys[ys.length - 1], uid };
  }, [pts, accent, w, h]);
  const stroke = accent ? RED : C_HI;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="1" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={lx} cy={ly} r={2.2} fill={stroke} />
    </svg>
  );
}

/** Petites barres verticales (répartition horaire, jours…). */
export function MiniBars({ pts, h = 36, accentIndex }: { pts: number[]; h?: number; accentIndex?: number }) {
  const max = Math.max(...pts, 1);
  return (
    <div className="flex items-end gap-[2px]" style={{ height: h }}>
      {pts.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(4, (v / max) * 100)}%`, background: i === accentIndex ? RED : v === max && v > 0 ? C_HI : C_MID, opacity: v === 0 ? 0.25 : 1 }} />
      ))}
    </div>
  );
}

// ─── Contrôles (DS §6) ───────────────────────────────────────────────────────
export function Seg<K extends string>({ value, onChange, options, size = 'md' }: { value: K; onChange: (k: K) => void; options: { key: K; label: ReactNode; icon?: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex gap-0.5 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`inline-flex items-center gap-1.5 rounded-lg font-medium cursor-pointer transition-all duration-150 ${size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-4 py-1.5 text-[13px]'}`}
          style={value === o.key
            ? { color: T1, background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000' }
            : { color: T3 }}>
          {o.icon && <span style={{ opacity: 0.7 }}>{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodFilter<K extends string>({ value, onChange, options }: { value: K; onChange: (k: K) => void; options: { key: K; label: ReactNode }[] }) {
  return (
    <div className="flex gap-1 flex-wrap p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
          style={value === o.key ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` } : { color: T3 }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TabBar<K extends string>({ value, onChange, tabs }: { value: K; onChange: (k: K) => void; tabs: { id: K; label: ReactNode; icon?: LucideIcon; count?: number }[] }) {
  return (
    <div className="flex gap-0.5 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDER}` }}>
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button key={tab.id} type="button" onClick={() => onChange(tab.id)}
            className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer whitespace-nowrap"
            style={{ color: active ? T1 : T3 }}>
            {tab.icon && <tab.icon className="w-4 h-4" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && <span className="tabular-nums rounded-full px-1.5 text-[10.5px]" style={{ background: active ? RED_SOFT_BG : C_FAINT, color: active ? RED : T3, border: `1px solid ${active ? RED_SOFT_BORDER : F_BORDER}` }}>{tab.count}</span>}
            {active && <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => !disabled && onChange(!checked)}
      className="inline-flex items-center gap-2.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
      <span className="relative inline-flex h-[22px] w-[40px] flex-none rounded-full transition-colors duration-150"
        style={{ background: checked ? RED : 'rgba(255,255,255,0.12)', boxShadow: checked ? `0 0 14px -4px ${RED}` : 'none', border: `1px solid ${checked ? RED : BORDER}` }}>
        <span className="absolute top-[2px] h-[16px] w-[16px] rounded-full transition-all duration-150" style={{ left: checked ? 20 : 2, background: '#fff' }} />
      </span>
      {label && <span style={{ color: checked ? T1 : T2, fontSize: 13 }}>{label}</span>}
    </button>
  );
}

export function Btn({ children, onClick, variant = 'ghost', size = 'md', icon: Icon, disabled, loading, type = 'button', to, href, title, className, style }: {
  children?: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'subtle'; size?: 'sm' | 'md';
  icon?: LucideIcon; disabled?: boolean; loading?: boolean; type?: 'button' | 'submit'; to?: string; href?: string; title?: string; className?: string; style?: CSSProperties;
}) {
  const base = `inline-flex items-center justify-center gap-2 rounded-xl font-medium cursor-pointer transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[12.5px]'} ${className ?? ''}`;
  const styles: Record<string, CSSProperties> = {
    primary: { background: RED, color: '#fff', border: `1px solid ${RED}`, boxShadow: `0 0 18px -6px ${RED}aa` },
    ghost: { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 },
    subtle: { background: 'transparent', border: '1px solid transparent', color: T3 },
    danger: { background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.3)', color: NEG },
  };
  const inner = (<>
    {loading ? <RefreshCw className={`${size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} animate-spin`} /> : Icon ? <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> : null}
    {children}
  </>);
  if (to) return <Link to={to} className={base} style={{ ...styles[variant], ...style }} title={title}>{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={base} style={{ ...styles[variant], ...style }} title={title}>{inner}</a>;
  return <button type={type} onClick={onClick} disabled={disabled || loading} className={base} style={{ ...styles[variant], ...style }} title={title}>{inner}</button>;
}

// ─── Badges (DS §7) ──────────────────────────────────────────────────────────
export type PillTone = 'default' | 'hot' | 'accent' | 'pos' | 'neg' | 'muted';
export function Pill({ children, tone = 'default', icon: Icon, size = 'sm', title }: { children: ReactNode; tone?: PillTone; icon?: LucideIcon; size?: 'xs' | 'sm'; title?: string }) {
  const s: Record<PillTone, CSSProperties> = {
    default: { border: `1px solid ${BORDER}`, background: C_FAINT, color: T1 },
    hot: { border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.1)', color: RED },
    accent: { border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.06)', color: WARN },
    pos: { border: '1px solid rgba(52,211,153,0.25)', background: 'rgba(52,211,153,0.08)', color: POS },
    neg: { border: '1px solid rgba(255,92,99,0.3)', background: 'rgba(255,92,99,0.08)', color: NEG },
    muted: { border: `1px solid ${F_BORDER}`, background: 'transparent', color: T3 },
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full font-semibold tabular-nums whitespace-nowrap ${size === 'xs' ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[11.5px]'}`} style={s[tone]}>
      {Icon && <Icon className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
      {children}
    </span>
  );
}

export function LiveBadge({ count, label }: { count: number; label: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
      <div className="relative">
        <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
        <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75" style={{ background: POS }} />
      </div>
      <span className="text-sm font-semibold tabular-nums" style={{ color: POS }}>{count} <span className="font-normal opacity-70">{label}</span></span>
    </div>
  );
}

// ─── Données (DS §8, §9) ─────────────────────────────────────────────────────
export function ProgressBar({ pct, color, height = 6 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', height }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color ?? `linear-gradient(90deg,${RED}88,${RED})` }} />
    </div>
  );
}

/** Ligne classée (top N) : rang, libellé + barre, valeur à droite. */
export function RankRow({ index, label, sub, value, pct, leader, to, right }: { index: number; label: ReactNode; sub?: ReactNode; value?: ReactNode; pct: number; leader?: boolean; to?: string; right?: ReactNode }) {
  const body = (
    <div className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '22px 1fr auto' }}>
      <span className="text-[12px] tabular-nums" style={{ color: T3 }}>{String(index + 1).padStart(2, '0')}</span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-[560] truncate" style={{ color: T1 }}>{label}</div>
        {sub && <div className="text-[11.5px] mt-0.5 truncate" style={{ color: T3 }}>{sub}</div>}
        <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded transition-all" style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: leader ? `linear-gradient(90deg,${RED}88,${RED})` : `linear-gradient(90deg,${C_MID},${C_HI})` }} />
        </div>
      </div>
      <div className="text-right">
        {value !== undefined && <div className="text-sm font-[620] tabular-nums" style={{ color: T1 }}>{value}</div>}
        {right}
      </div>
    </div>
  );
  return <div style={{ borderBottom: `1px solid ${F_BORDER}` }} className="last:border-0">{to ? <Link to={to} className="block hover:opacity-90">{body}</Link> : body}</div>;
}

/** Paire libellé / valeur compacte (barres de distribution, listes courtes). */
export function DistRow({ label, value, pct, color, sub }: { label: ReactNode; value: ReactNode; pct: number; color?: string; sub?: ReactNode }) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3 text-[12.5px]">
        <span className="truncate" style={{ color: T2 }}>{label}</span>
        <span className="tabular-nums flex-none" style={{ color: T1, fontWeight: 600 }}>{value}{sub && <span className="font-normal ml-1.5" style={{ color: T3 }}>{sub}</span>}</span>
      </div>
      <ProgressBar pct={pct} color={color ?? `linear-gradient(90deg,${C_MID},${C_HI})`} height={4} />
    </div>
  );
}

export function KeyValue({ rows }: { rows: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="m-0">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
          <dt style={{ color: T3, fontSize: 12 }}>{r.k}</dt>
          <dd className="text-right tabular-nums m-0" style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TableWrap({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" style={{ minWidth }}>{children}</table>
    </div>
  );
}
export function Th({ children, right, style }: { children?: ReactNode; right?: boolean; style?: CSSProperties }) {
  return <th className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`} style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${F_BORDER}`, whiteSpace: 'nowrap', ...style }}>{children}</th>;
}
export function Td({ children, right, muted, strong, style, className, title, colSpan }: { children?: ReactNode; right?: boolean; muted?: boolean; strong?: boolean; style?: CSSProperties; className?: string; title?: string; colSpan?: number }) {
  return <td title={title} colSpan={colSpan} className={`px-3 py-3 ${right ? 'text-right tabular-nums' : ''} ${className ?? ''}`} style={{ color: muted ? T3 : strong ? T1 : T2, fontWeight: strong ? 620 : 400, borderBottom: `1px solid ${F_BORDER}`, ...style }}>{children}</td>;
}

// ─── États (DS §10) ──────────────────────────────────────────────────────────
export function Spinner({ label, full }: { label?: ReactNode; full?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${full ? 'min-h-screen' : 'py-16'}`} style={{ background: full ? '#000' : undefined }}>
      <div className="text-center">
        <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
        {label && <p className="text-sm" style={{ color: T3 }}>{label}</p>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, text, action }: { icon?: LucideIcon; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <Icon className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
      <p className="text-xs max-w-sm mx-auto" style={{ color: T3 }}>{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Avis de page : une ligne, pas un panneau. Un `EmptyState` dans une `Card`
 * occupait 200 px en haut de Revenus pour dire « aucune vente » alors que les
 * compteurs juste en dessous le disent déjà.
 */
export function Notice({ icon: Icon = Inbox, children, tone = 'default' }: { icon?: LucideIcon; children: ReactNode; tone?: 'default' | 'warn' }) {
  const color = tone === 'warn' ? WARN : T3;
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-4 py-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
      <Icon className="h-4 w-4 shrink-0" style={{ color, opacity: tone === 'warn' ? 0.9 : 0.5 }} />
      <p className="text-xs leading-relaxed" style={{ color: T2 }}>{children}</p>
    </div>
  );
}

export function ErrorState({ text, onRetry, retryLabel }: { text: ReactNode; onRetry?: () => void; retryLabel?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <TriangleAlert className="h-9 w-9 mx-auto mb-2" style={{ color: NEG, opacity: 0.8 }} />
      <p className="text-xs max-w-md mx-auto" style={{ color: T2 }}>{text}</p>
      {onRetry && <div className="mt-4"><Btn onClick={onRetry} icon={RefreshCw}>{retryLabel}</Btn></div>}
    </div>
  );
}

/** Squelette de page (cartes fantômes) pendant le premier chargement. */
export function PageSkeleton({ tiles = 4, blocks = 2 }: { tiles?: number; blocks?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: tiles }).map((_, i) => <div key={i} style={{ ...CARD_STYLE, height: 96, background: 'rgba(255,255,255,0.03)' }} />)}
      </div>
      {Array.from({ length: blocks }).map((_, i) => <div key={i} style={{ ...CARD_STYLE, height: 220, background: 'rgba(255,255,255,0.03)' }} />)}
    </div>
  );
}

/** Apparition standard d'une section (DS §12). */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
      {children}
    </motion.div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T3 }}>{children}</kbd>;
}

/** Puce colorée de légende. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full flex-none" style={{ width: size, height: size, background: color }} />;
}

/** Fenêtre modale sombre minimaliste (sans shadcn). */
export function Modal({ open, onClose, title, subtitle, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }} onClick={onClose} role="dialog" aria-modal="true">
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()} style={{ ...CARD_STYLE, width: '100%', maxWidth: width, padding: 22, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ color: T1, fontSize: 16, fontWeight: 650, letterSpacing: '-0.01em', margin: 0 }}>{title}</h3>
        {subtitle && <p style={{ color: T3, fontSize: 12, margin: '4px 0 0' }}>{subtitle}</p>}
        <div className="mt-4 space-y-3">{children}</div>
        {footer && <div className="mt-5 flex items-center justify-end gap-2">{footer}</div>}
      </motion.div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span style={{ ...LABEL_STYLE, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <span style={{ color: T3, fontSize: 11, display: 'block', marginTop: 4 }}>{hint}</span>}
    </label>
  );
}
