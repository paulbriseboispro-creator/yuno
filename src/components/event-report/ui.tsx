/**
 * Primitives du Rapport de soirée — design system pro (`docs/DESIGN_SYSTEM.md`),
 * encre `--ink` pour suivre le thème clair. La grammaire est celle de Shotgun :
 * chaque section s'ouvre sur la QUESTION à laquelle elle répond.
 */
import type { ReactNode } from 'react';
import { FillBar, MetricHint, TodayDelta } from '@/components/analytics/kit';
import { KIT } from '@/components/analytics/kitFormat';
import { CARD_BG, CARD_SHADOW, FAINT, INNER_BG } from './tokens';


export function ReportCard({ children, className = '', padding = 20 }: { children: ReactNode; className?: string; padding?: number }) {
  return (
    <div className={`min-w-0 ${className}`} style={{ background: CARD_BG, border: `1px solid ${KIT.BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding }}>
      {children}
    </div>
  );
}

/** Titre de section = la question, sous-titre = comment la lire. */
export function Question({ id, title, sub, right }: { id?: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div id={id} className="flex flex-wrap items-end justify-between gap-3 px-1 pt-4" style={{ scrollMarginTop: 84 }}>
      <div className="min-w-0">
        <h2 style={{ color: KIT.T1, fontSize: 18, fontWeight: 650, letterSpacing: '-0.015em', textWrap: 'balance' }}>{title}</h2>
        {sub && <p style={{ color: KIT.T3, fontSize: 12.5, marginTop: 3, maxWidth: '68ch' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Titre d'une carte à l'intérieur d'une section. */
export function CardTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className="inline-flex items-center gap-1.5" style={{ color: KIT.T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
        {title}
        {hint && <MetricHint text={hint} label={title} />}
      </h3>
      {right}
    </div>
  );
}

/** Carte chiffre : libellé + ⓘ, gros chiffre, sous-ligne, « aujourd'hui », jauge. */
export function StatCard({ label, hint, value, sub, today, todayDisplay, pct, soldOut }: {
  label: string; hint?: string; value: string; sub?: ReactNode;
  today?: number; todayDisplay?: string; pct?: number | null; soldOut?: boolean;
}) {
  return (
    <ReportCard padding={18}>
      <div className="flex min-h-[112px] flex-col gap-1.5">
        <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          {label}
          {hint && <MetricHint text={hint} label={label} />}
        </span>
        <span className="tabular-nums leading-none" style={{ color: KIT.T1, fontSize: 'clamp(24px,2.6vw,32px)', fontWeight: 640, letterSpacing: '-0.025em' }}>
          {value}
        </span>
        {sub && <span style={{ color: KIT.T3, fontSize: 12 }}>{sub}</span>}
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          {pct !== undefined && <FillBar pct={pct ?? null} soldOut={soldOut} />}
          {today !== undefined && <TodayDelta value={today} display={todayDisplay} />}
        </div>
      </div>
    </ReportCard>
  );
}

/** Ligne classée : libellé, valeur, barre de part. */
export function RankRow({ label, value, note, share, color = 'rgb(var(--ink)/0.72)', icon }: {
  label: string; value: string; note?: string; share: number | null; color?: string; icon?: ReactNode;
}) {
  const pct = share == null ? 0 : Math.max(0, Math.min(100, share));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 truncate" style={{ color: KIT.T2 }}>
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className="whitespace-nowrap tabular-nums" style={{ color: KIT.T1 }}>
          {value}
          {note && <span style={{ color: KIT.T3 }}> · {note}</span>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: FAINT }}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <p className="py-6 text-center" style={{ color: KIT.T3, fontSize: 13 }}>{text}</p>;
}

/** Segment control du design system (§6.1). */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-xl p-1" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={active ? { background: 'rgb(var(--ink)/0.1)', color: KIT.T1 } : { color: KIT.T3 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
