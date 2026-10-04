/** Briques de l'écran Envoi (maquette « Email Envoi »). */
import type { ReactNode } from 'react';
import { SPRING } from '@/crm/ui/motion';

export function StepTitle({ kick, a, b, c, sub }: { kick: string; a: string; b: string; c: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{kick}</span>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>
        {a}<span className="yc-accent-word">{b}</span>{c}
      </h1>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', maxWidth: 600, textWrap: 'pretty' }}>{sub}</p>
    </div>
  );
}

/** Interrupteur de la maquette (48 × 28, vert quand allumé). */
export function Toggle48({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ flex: 'none', position: 'relative', width: 48, height: 28, border: 0, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', cursor: 'pointer', padding: 0, transition: 'background 200ms' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: `left 220ms ${SPRING}` }} />
    </button>
  );
}

export function Pills<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ flex: 'none', display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, maxWidth: '100%', overflowX: 'auto' }} className="yc-noscroll">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)} aria-pressed={on} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ children, gap = 6, style }: { children: ReactNode; gap?: number; style?: React.CSSProperties }) {
  return <section style={{ display: 'flex', flexDirection: 'column', gap, padding: 'clamp(18px,2.2vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...style }}>{children}</section>;
}

export function CardHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{title}</h2>
      <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export function Row({ title, sub, right, first }: { title: string; sub: ReactNode; right: ReactNode; first?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 0', borderTop: first === false ? 'none' : '1px solid var(--sand-100)' }}>
      <span style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 15 }}>{title}</b>
        <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{sub}</span>
      </span>
      {right}
    </div>
  );
}
