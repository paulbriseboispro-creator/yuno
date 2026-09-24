// Primitives de l'assistant de campagne Meta — pensées pour quelqu'un qui n'a
// jamais ouvert Ads Manager : chaque champ porte son libellé ET la raison de
// son existence, les choix binaires sont des cartes qui expliquent, et rien
// n'est plus petit que 44 px sous le doigt (DESIGN_SYSTEM.md, dashboards pro).

import type { ReactNode, CSSProperties } from 'react';
import { Check, Info, Lightbulb } from 'lucide-react';

export const RED = '#E8192C';
export const POS = 'var(--acc-34d399)';
export const WARN = 'var(--acc-fbbf24)';
export const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
export const T2 = 'rgb(var(--ink)/var(--ink-a62,0.62))';
export const T3 = 'rgb(var(--ink)/var(--ink-a40,0.40))';
export const BORDER = 'rgb(var(--ink)/0.09)';
export const BORDER_STRONG = 'rgb(var(--ink)/0.16)';
export const INNER_BG = 'rgb(var(--ink)/0.034)';
export const FIELD_BG = 'rgb(var(--ink)/0.05)';
export const META_BLUE = '#0866FF';

export const inputStyle: CSSProperties = {
  background: FIELD_BG, border: `1px solid ${BORDER}`, color: T1, borderRadius: 12,
  padding: '12px 14px', fontSize: 15, lineHeight: 1.35, width: '100%', outline: 'none', minHeight: 46,
  transition: 'border-color 160ms ease, background 160ms ease',
};

export const focusRing = 'focus:border-white/30 focus:bg-white/[0.07]';

export function Field({ label, hint, children, counter, optional }: { label: ReactNode; hint?: ReactNode; children: ReactNode; counter?: string; optional?: string }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600, letterSpacing: '0.01em' }}>
          {label}
          {optional && <span className="ml-2 font-medium" style={{ color: T3, fontSize: 12 }}>{optional}</span>}
        </p>
        {counter && <span className="tabular-nums" style={{ color: T3, fontSize: 12 }}>{counter}</span>}
      </div>
      {children}
      {hint && <p className="mt-2" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

export function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3.5 rounded-full text-[13.5px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ minHeight: 40, ...(active
        ? { background: 'rgba(232,25,44,0.16)', border: '1px solid rgba(232,25,44,0.5)', color: 'var(--acc-ff8a91)' }
        : { background: FIELD_BG, border: `1px solid ${BORDER}`, color: T2 }) }}>
      {active && <Check className="w-3.5 h-3.5" />}{children}
    </button>
  );
}

/** Choix exclusif sous forme de cartes : un titre, une phrase qui explique. */
export function ChoiceCards<T extends string>({ value, options, onChange, columns = 2 }: {
  value: T;
  options: Array<{ value: T; label: string; desc?: string; icon?: ReactNode; badge?: string }>;
  onChange: (v: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className={`grid gap-2.5 ${columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} role="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            className="text-left rounded-2xl p-4 cursor-pointer transition-colors duration-150"
            style={{ background: active ? 'rgba(232,25,44,0.10)' : INNER_BG, border: `1px solid ${active ? 'rgba(232,25,44,0.5)' : BORDER}`, minHeight: 64 }}>
            <div className="flex items-start gap-3">
              {o.icon && <span className="mt-0.5 flex-shrink-0" style={{ color: active ? 'var(--acc-ff8a91)' : T3 }}>{o.icon}</span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p style={{ color: T1, fontSize: 14.5, fontWeight: 650 }}>{o.label}</p>
                  {o.badge && <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider" style={{ background: 'rgba(52,211,153,0.12)', color: POS, border: '1px solid rgba(52,211,153,0.3)' }}>{o.badge}</span>}
                </div>
                {o.desc && <p className="mt-1" style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{o.desc}</p>}
              </div>
              <span className="mt-1 h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: `1.5px solid ${active ? RED : BORDER_STRONG}`, background: active ? RED : 'transparent' }}>
                {active && <Check className="w-3 h-3 text-snow" />}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ToggleRow({ label, desc, checked, onChange, icon }: { label: ReactNode; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left cursor-pointer transition-colors duration-150"
      style={{ background: INNER_BG, border: `1px solid ${checked ? BORDER_STRONG : BORDER}`, minHeight: 56 }}>
      {icon && <span className="flex-shrink-0" style={{ color: checked ? T1 : T3 }}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{label}</span>
        {desc && <span className="block mt-0.5" style={{ color: T3, fontSize: 12.5, lineHeight: 1.45 }}>{desc}</span>}
      </span>
      <span className="rounded-full transition-colors duration-200" style={{ display: 'inline-block', position: 'relative', flexShrink: 0, width: 44, height: 26, background: checked ? RED : 'rgb(var(--ink)/0.14)' }}>
        <span className="rounded-full bg-white transition-transform duration-200" style={{ position: 'absolute', top: 3, left: 3, width: 20, height: 20, transform: `translateX(${checked ? 18 : 0}px)` }} />
      </span>
    </button>
  );
}

export function StepHeader({ title, intro }: { title: ReactNode; intro?: ReactNode }) {
  return (
    <div className="mb-1">
      <h2 style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.25 }}>{title}</h2>
      {intro && <p className="mt-1.5" style={{ color: T2, fontSize: 14, lineHeight: 1.55, maxWidth: 680 }}>{intro}</p>}
    </div>
  );
}

export function Section({ title, desc, children, right }: { title: ReactNode; desc?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 650, letterSpacing: '-0.01em' }}>{title}</h3>
          {desc && <p className="mt-1" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Tip({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'tip' | 'warn' | 'pos' }) {
  const s = tone === 'tip' ? { border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.06)', color: WARN }
    : tone === 'warn' ? { border: '1px solid rgba(232,25,44,0.3)', background: 'rgba(232,25,44,0.07)', color: 'var(--acc-ff8a91)' }
    : tone === 'pos' ? { border: '1px solid rgba(52,211,153,0.25)', background: 'rgba(52,211,153,0.06)', color: POS }
    : { border: `1px solid ${BORDER}`, background: INNER_BG, color: T3 };
  const Icon = tone === 'tip' ? Lightbulb : Info;
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3" style={{ border: s.border, background: s.background }}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: s.color }} />
      <p style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

export function GhostButton({ onClick, children, disabled, small }: { onClick: () => void; children: ReactNode; disabled?: boolean; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-xl font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${small ? 'px-3 text-[12.5px]' : 'px-3.5 text-[13.5px]'}`}
      style={{ background: FIELD_BG, border: `1px solid ${BORDER}`, color: T1, minHeight: small ? 36 : 42 }}>
      {children}
    </button>
  );
}
