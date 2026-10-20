/**
 * Les briques de l'espace invité : le look de la Console Yuno Tickets (cartes
 * sombres, rouge Yuno, chiffres en tabulaire), réduit à UNE soirée. Les
 * couleurs viennent d'`org-ui` (variables du thème pro) : jamais de blanc ou
 * de noir écrits en dur.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { OrgCard, RED, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import type { GuestSpaceWords } from '@/lib/guestSpace';

export const AMBER = 'var(--acc-fcd34d)';
export const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <OrgCard className={`p-5 ${className}`}>{children}</OrgCard>;
}

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 style={{ color: T1, fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{title}</h2>
        {sub && <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{sub}</p>}
      </div>
      {right && <div className="flex-none">{right}</div>}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{children}</div>;
}

export function Kpi({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <Label>{label}</Label>
      <div className="mt-1.5 truncate tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      {hint && <div className="mt-1" style={{ color: accent ? RED : T3, fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? 'grid-cols-2 lg:grid-cols-4' : cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2';
  return <div className={`grid gap-3 ${c}`}>{children}</div>;
}

export function Bar({ pct, tone = 'red', className = '' }: { pct: number; tone?: 'red' | 'green' | 'muted' | 'white'; className?: string }) {
  const bg = tone === 'green' ? POS : tone === 'muted' ? 'rgb(var(--ink)/0.28)' : tone === 'white' ? T1 : RED;
  return (
    <div className={`h-2 overflow-hidden rounded-full ${className}`} style={{ background: 'rgb(var(--ink)/0.08)' }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, Math.round(pct)))}%`, background: bg }} />
    </div>
  );
}

export function Row({ title, meta, right, children }: { title: ReactNode; meta?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        {meta && <div className="truncate tabular-nums" style={{ color: T3, fontSize: 12, marginTop: 2 }}>{meta}</div>}
      </div>
      {children}
      {right !== undefined && <div className="flex-none tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{right}</div>}
    </div>
  );
}

export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'amber' | 'green' }) {
  const border = tone === 'amber' ? 'rgba(234,179,8,0.25)' : tone === 'green' ? 'rgba(52,211,153,0.25)' : BORDER;
  const bg = tone === 'amber' ? 'rgba(234,179,8,0.06)' : tone === 'green' ? 'rgba(52,211,153,0.06)' : INNER_BG;
  return <div className="rounded-xl px-3.5 py-3" style={{ background: bg, border: `1px solid ${border}`, color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{children}</div>;
}

export function SubTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl p-1" role="group" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)} aria-pressed={value === t.value}
          className="flex-none rounded-lg px-3 py-1.5 transition-colors"
          style={{ fontSize: 12.5, fontWeight: 600, color: value === t.value ? T1 : T2, background: value === t.value ? 'rgb(var(--ink)/0.08)' : 'transparent' }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Un tableau sobre ; la première colonne prend la place. */
export function Table({ head, rows, foot }: { head: { label: string; right?: boolean }[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse tabular-nums" style={{ fontSize: 13 }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} className={`px-1 pb-2 ${h.right ? 'text-right' : 'text-left'}`} style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
              {r.map((c, j) => <td key={j} className={`px-1 py-2.5 ${head[j]?.right ? 'text-right' : ''}`} style={{ color: j === 0 ? T1 : T2 }}>{c}</td>)}
            </tr>
          ))}
          {foot && (
            <tr style={{ borderTop: `1px solid rgb(var(--ink)/0.16)` }}>
              {foot.map((c, j) => <td key={j} className={`px-1 py-2.5 ${head[j]?.right ? 'text-right' : ''}`} style={{ color: T1, fontWeight: 650 }}>{c}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function useNarrow(): boolean {
  const query = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * Billets par jour (barres), cumul (ligne) et tables réservées (points), de
 * J-(n-1) au jour J. Le futur reste grisé avant la soirée.
 */
export function SalesChart({ points, todayIdx, phase, w, tall = false }: {
  points: { d: number; tickets: number; tables: number; cumul: number }[];
  /** Le jour d'aujourd'hui (barre rouge) ; après lui, avant la soirée, tout est « à venir ». */
  todayIdx: number;
  phase: string;
  w: GuestSpaceWords;
  tall?: boolean;
}) {
  const n = points.length || 1;
  const narrow = useNarrow();
  // Au téléphone le dessin est moins large : les libellés gardent une taille lisible.
  const W = narrow ? 380 : 760, H = narrow ? (tall ? 240 : 220) : (tall ? 250 : 230), L = narrow ? 24 : 34, R = narrow ? 28 : 40, Tp = 16, B = 28;
  const maxBar = Math.max(5, Math.ceil(Math.max(...points.map((p) => p.tickets), 1) / 5) * 5);
  const maxCum = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.cumul), 1) / 10) * 10);
  const bw = (W - L - R) / n;
  const x = (i: number) => L + i * bw + bw / 2;
  const yb = (v: number) => Tp + (H - Tp - B) * (1 - v / maxBar);
  const yc = (v: number) => Tp + (H - Tp - B) * (1 - v / maxCum);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelAt = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  const cut = phase === 'before' ? todayIdx : n - 1;
  const last = points[cut];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={w('guestSpace.chart.aria')}>
      {ticks.map((f) => {
        const y = Tp + (H - Tp - B) * (1 - f);
        return (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y} y2={y} stroke="rgb(var(--ink)/0.08)" />
            <text x={L - 6} y={y + 4} textAnchor="end" fontSize="10" fill="rgb(var(--ink)/0.4)" fontFamily={MONO}>{Math.round(maxBar * f)}</text>
            <text x={W - R + 6} y={y + 4} fontSize="10" fill="rgb(var(--ink)/0.4)" fontFamily={MONO}>{Math.round(maxCum * f)}</text>
          </g>
        );
      })}
      {phase === 'before' && cut < n - 1 && (
        <g>
          <rect x={x(cut) + bw / 2} y={Tp} width={W - R - x(cut) - bw / 2} height={H - Tp - B} fill="rgb(var(--ink)/0.025)" />
          <text x={(x(cut) + bw / 2 + W - R) / 2} y={Tp + 14} textAnchor="middle" fontSize="10.5" fill="rgb(var(--ink)/0.4)">{w('guestSpace.chart.upcoming')}</text>
        </g>
      )}
      {points.slice(0, cut + 1).map((p, i) => {
        const bwid = bw * 0.56;
        return (
          <g key={p.d}>
            <rect x={x(i) - bwid / 2} y={yb(p.tickets)} width={bwid} height={Math.max(0, yb(0) - yb(p.tickets))} rx="2.5"
              fill={i === cut ? RED : 'rgba(232,25,44,0.45)'} />
            {p.tables > 0 && <circle cx={x(i)} cy={yb(p.tickets) - 8} r="3.5" fill={AMBER} />}
          </g>
        );
      })}
      <polyline points={points.slice(0, cut + 1).map((p, i) => `${x(i).toFixed(1)},${yc(p.cumul).toFixed(1)}`).join(' ')} fill="none"
        stroke="rgb(var(--ink)/0.9)" strokeWidth="2" strokeLinejoin="round" />
      {last && <circle cx={x(cut)} cy={yc(last.cumul)} r="4.5" fill="rgb(var(--ink)/0.95)" stroke="var(--sf-0a0a0c)" strokeWidth="2" />}
      {labelAt.map((i) => points[i] && (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="rgb(var(--ink)/0.4)" fontFamily={MONO}>
          {points[i].d === 0 ? w('guestSpace.chart.dayJ') : w('guestSpace.chart.dMinus', { n: points[i].d })}
        </text>
      ))}
    </svg>
  );
}

export function ChartLegend({ w }: { w: GuestSpaceWords }) {
  const item = (swatch: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>{swatch}{label}</span>
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {item(<i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(232,25,44,0.6)' }} />, w('guestSpace.chart.perDay'))}
      {item(<i className="inline-block h-[3px] w-3 rounded" style={{ background: T1 }} />, w('guestSpace.chart.cumul'))}
      {item(<i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: AMBER }} />, w('guestSpace.chart.table'))}
    </div>
  );
}

export function Steps({ steps }: { steps: { k: string; v: string; state: 'done' | 'now' | 'next' }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s) => (
        <div key={s.k} className="rounded-xl px-3 py-2.5" style={{
          background: s.state === 'now' ? 'rgba(232,25,44,0.08)' : INNER_BG,
          border: `1px solid ${s.state === 'now' ? 'rgba(232,25,44,0.35)' : BORDER}`,
        }}>
          <div style={{ color: s.state === 'done' ? POS : s.state === 'now' ? RED : T3, fontSize: 11, fontWeight: 650, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {s.state === 'done' ? '✓ ' : ''}{s.k}
          </div>
          <div style={{ color: T1, fontSize: 13, fontWeight: 600, marginTop: 3 }}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}
