import { type ReactNode, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { VenueSelector } from '@/components/VenueSelector';
import { useDJData } from '@/contexts/DJDataContext';
import { isProApp } from '@/lib/native';

/**
 * Shared design primitives for the DJ dashboard app. One visual language across
 * every DJ page (overview / planning / audience / payments / profile). Yuno Dark
 * Premium — mirrors the tokens documented in docs/DESIGN_SYSTEM.md and the sibling
 * affiliate app (affiliate-ui.tsx).
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────
export const RED      = '#E8192C';
export const POS      = '#34D399';
export const NEG      = '#FF5C63';
export const WARN     = '#FCD34D';
export const T1       = 'rgba(255,255,255,0.96)';
export const T2       = 'rgba(255,255,255,0.58)';
export const T3       = 'rgba(255,255,255,0.36)';
export const C_HI     = 'rgba(255,255,255,0.92)';
export const C_MID    = 'rgba(255,255,255,0.40)';
export const C_FAINT  = 'rgba(255,255,255,0.06)';
export const BORDER   = 'rgba(255,255,255,0.085)';
export const F_BORDER = 'rgba(255,255,255,0.055)';
export const INNER_BG = 'rgba(255,255,255,0.032)';
export const TILE_BG  = 'rgba(255,255,255,0.025)';
export const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Page shell ──────────────────────────────────────────────────────────────
// Lives inside DJLayout's <SidebarInset>. Top bar = sidebar toggle (left) +
// venue switcher (right, shown only for multi-venue DJs). Then the centered
// content column over the ambient vignette.
export function DJPage({ children, maxWidth = 1100 }: { children: ReactNode; maxWidth?: number }) {
  const { venues, selectedVenueId, setSelectedVenueId } = useDJData();
  // Dans l'app Pro, la barre d'onglets flotte au-dessus du contenu : sans cette
  // réserve (hauteur de la barre + marge basse + encoche du bas), le dernier
  // bloc de chaque page finit caché derrière elle.
  const bottomPad = isProApp() ? 'calc(env(safe-area-inset-bottom, 0px) + 92px)' : undefined;
  return (
    <div className="min-h-screen pb-24 relative" style={{ background: '#000', paddingBottom: bottomPad }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      <div className="relative z-10 flex items-center justify-between gap-2 px-4 sm:px-6 pt-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <SidebarTrigger className="text-white/60 hover:text-white -ml-1" />
        <VenueSelector venues={venues} selectedVenueId={selectedVenueId} onSelect={setSelectedVenueId} />
      </div>
      <div className="relative z-10 mx-auto px-4 sm:px-6 pt-2 space-y-4" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

// ─── Page heading ─────────────────────────────────────────────────────────────
export function DJHeading({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 style={{ color: T1, fontSize: 'clamp(20px,2.4vw,26px)', fontWeight: 680, letterSpacing: '-0.02em', margin: 0 }}>
          {title}
        </h1>
        {subtitle && <p style={{ color: T3, fontSize: 13, marginTop: 3 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

// ─── Zone heading (uppercase section separator) ───────────────────────────────
export function ZoneHeading({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span style={{ color: T2 }}>{icon}</span>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: T2 }}>{label}</h3>
    </div>
  );
}

// ─── Premium card wrapper ─────────────────────────────────────────────────────
export function PCard({
  children, className = '', style = {}, icon, title, sub, right, accent,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  icon?: ReactNode;
  title?: string;
  sub?: string;
  right?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden relative ${className}`}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, ...style }}
    >
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={accent
                  ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }
                  : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className="m-0 text-[15.5px] font-semibold leading-tight truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{title}</h3>}
              {sub && <p className="m-0 mt-0.5 text-xs truncate" style={{ color: T3 }}>{sub}</p>}
            </div>
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Field label ──────────────────────────────────────────────────────────────
export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-[12.5px] font-medium" style={{ color: T2 }}>{children}</label>;
}

// ─── Pill ──────────────────────────────────────────────────────────────────────
export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'pos' | 'warn' | 'accent' }) {
  const style: CSSProperties =
    tone === 'pos' ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }
    : tone === 'warn' ? { background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', color: WARN }
    : tone === 'accent' ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }
    : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 };
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums" style={style}>
      {children}
    </span>
  );
}

// ─── Loading spinner (full surface) ───────────────────────────────────────────
export function DJSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
      <div className="h-10 w-10 animate-spin rounded-full border-2"
        style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
    </div>
  );
}

// ─── Catmull-Rom smooth path ──────────────────────────────────────────────────
export function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
export function Sparkline({ pts, accent = false }: { pts: number[]; accent?: boolean }) {
  const W = 96, H = 34, pad = 3;
  if (pts.length < 2) return <svg width={W} height={H} />;
  const max = Math.max(...pts), min = Math.min(...pts), rng = max - min || 1;
  const xs = pts.map((_, i) => pad + (i / Math.max(pts.length - 1, 1)) * (W - pad * 2));
  const ys = pts.map(v => H - pad - ((v - min) / rng) * (H - pad * 2));
  const linePts: [number, number][] = xs.map((x, i) => [x, ys[i]]);
  const line = smooth(linePts);
  const area = `${line} L ${xs[xs.length - 1]} ${H} L ${xs[0]} ${H} Z`;
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

// ─── Monthly bars ─────────────────────────────────────────────────────────────
export function MonthlyBars({ data }: { data: { month: string; amount: number }[] }) {
  if (!data.length) return null;
  const W = 640, plotH = 160, labelH = 24, H = plotH + labelH;
  const slot = W / data.length;
  const bw = Math.min(44, slot * 0.55);
  const maxVal = Math.max(...data.map(d => d.amount), 1) * 1.15;
  const peakIdx = data.reduce((m, d, i) => d.amount > data[m].amount ? i : m, 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: 'auto' }}>
        {[0.25, 0.5, 0.75].map((g, i) => (
          <line key={i} x1={0} x2={W} y1={plotH - plotH * g} y2={plotH - plotH * g} stroke={C_FAINT} strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const bh = Math.max(4, (d.amount / maxVal) * plotH);
          const y = plotH - bh;
          const r = Math.min(6, bw / 2, bh / 2);
          const isPeak = i === peakIdx;
          const x = i * slot + (slot - bw) / 2;
          return (
            <g key={i}>
              <motion.rect
                x={x} width={bw} rx={r} fill={isPeak ? RED : C_MID}
                initial={{ height: 0, y: plotH, opacity: 0 }}
                animate={{ height: bh, y, opacity: isPeak ? 0.95 : 0.8 }}
                transition={{ delay: i * 0.04, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 7} fill={T3} fontSize={10} textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {d.month}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
