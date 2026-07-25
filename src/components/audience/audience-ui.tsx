// Primitives UI autonomes du dashboard d'audience (design system PRO : sombre,
// accent rouge unique). Volontairement sans dépendance aux pages Owner/Org en
// cours de refactor — c'est LE module partagé, pas une 3e copie. Le retrofit
// d'OwnerAnalytics/OrgAppAnalytics vers ces primitives est un nettoyage séparé.
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export const RED = '#E8192C';
export const POS = '#34D399';
export const NEG = '#FF5C63';
export const T1 = 'rgba(255,255,255,0.96)';
export const T2 = 'rgba(255,255,255,0.60)';
export const T3 = 'rgba(255,255,255,0.36)';
export const BORDER = 'rgba(255,255,255,0.085)';
export const C_FAINT = 'rgba(255,255,255,0.08)';
export const INNER_BG = 'rgba(255,255,255,0.03)';
export const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

export function PCard({ icon, title, sub, right, children, style }: {
  icon?: ReactNode; title?: string; sub?: string; right?: ReactNode; children?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="relative overflow-hidden"
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: 20, ...style }}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="flex-none" style={{ color: T3 }}>{icon}</span>}
            <div className="min-w-0">
              {title && <h3 className="text-[14px] font-[640] truncate" style={{ color: T1 }}>{title}</h3>}
              {sub && <p className="text-[11.5px] mt-0.5" style={{ color: T3 }}>{sub}</p>}
            </div>
          </div>
          {right && <div className="flex-none">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function ZoneHeading({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mt-8 mb-3">
      <span style={{ color: RED }}>{icon}</span>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: T2 }}>{label}</h2>
      <div className="flex-1 h-px" style={{ background: BORDER }} />
    </div>
  );
}

export function Kpi({ label, value, sub, tone, icon, delay = 0 }: {
  label: string; value: string; sub?: string; tone?: string; icon?: ReactNode; delay?: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <div className="relative overflow-hidden"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: 16 }}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{label}</span>
          {icon && <span style={{ color: T3 }}>{icon}</span>}
        </div>
        <div className="mt-2.5 text-[clamp(20px,2.6vw,26px)] font-[640] leading-none tabular-nums"
          style={{ color: tone ?? T1, letterSpacing: '-0.025em' }}>{value}</div>
        {sub && <p className="mt-1.5 text-[11px]" style={{ color: T3 }}>{sub}</p>}
      </div>
    </motion.div>
  );
}

export function BarRow({ label, sub, value, max, accent }: {
  label: string; sub?: string; value: number; max: number; accent?: boolean;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-[560] truncate capitalize" style={{ color: T1 }}>{label}</span>
        <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: accent ? RED : T2 }}>{sub ?? value}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C_FAINT }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent ? RED : 'rgba(255,255,255,0.45)' }} />
      </div>
    </div>
  );
}

export function SplitBar({ segments }: { segments: { label: string; count: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: C_FAINT }}>
        {segments.map(s => (
          <div key={s.label} title={s.label} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full flex-none" style={{ background: s.color }} />
            <span className="text-[12.5px]" style={{ color: T2 }}>{s.label}</span>
            <span className="text-[12.5px] font-[640] tabular-nums" style={{ color: T1 }}>
              {Math.round((s.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Coverage({ known, total, label }: { known: number; total: number; label: string }) {
  if (total === 0) return null;
  const pct = Math.round((known / total) * 100);
  return (
    <div className="mt-3 text-[11px]" style={{ color: T3 }}>{label} — {known}/{total} ({pct}%)</div>
  );
}

// Courbe d'évolution (SVG autonome). `series` = points {label, value}. `boundary`
// = index à partir duquel la donnée est NETTE (avant = brut) : on trace en pointillé
// avant, plein après, pour ne jamais présenter du brut comme du net (correctif 1.3).
export function MiniLine({ series, boundaryIndex }: {
  series: { label: string; value: number }[]; boundaryIndex?: number;
}) {
  const W = 640, H = 120, P = 6;
  if (series.length < 2) return <div className="text-[12px]" style={{ color: T3 }}>—</div>;
  const max = Math.max(...series.map(s => s.value), 1);
  const min = Math.min(...series.map(s => s.value), 0);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (series.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const pts = series.map((s, i) => `${x(i)},${y(s.value)}`);
  const b = Math.max(1, Math.min(series.length - 1, boundaryIndex ?? 0));
  const grossPath = boundaryIndex && boundaryIndex > 0 ? pts.slice(0, b + 1).join(' ') : '';
  const netPath = pts.slice(boundaryIndex && boundaryIndex > 0 ? b : 0).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
      {grossPath && <polyline points={grossPath} fill="none" stroke={T3} strokeWidth={2} strokeDasharray="4 4" />}
      <polyline points={netPath} fill="none" stroke={RED} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
