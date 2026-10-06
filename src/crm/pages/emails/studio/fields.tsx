/**
 * Briques de formulaire du panneau de droite du Studio CRM (maquette : champs
 * 44 px, rayon 12) — partagées par l'inspecteur et les réglages des Blocs Yuno.
 */
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { NightRow } from '@/crm/data/nights';
import { insertVariable, useStudioUi } from './studioUi';
import { VARS, cap, inputCss } from './fieldHelpers';

// ── Briques de formulaire (maquette : champs 44 px, rayon 12) ─────────────────

export function Field({ label, hint, children, right }: { label?: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {(label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          {label && <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>}
          {right}
        </div>
      )}
      {children}
      {hint && <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{hint}</span>}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, label, onFocusEl }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; onFocusEl?: (el: HTMLInputElement) => void }) {
  return <input className="yc-field" value={value} onChange={(e) => onChange(e.target.value)} onFocus={(e) => onFocusEl?.(e.currentTarget)} placeholder={placeholder} aria-label={label} style={{ ...inputCss, fontSize: 14.5 }} />;
}

export function TextArea({ value, onChange, rows = 3, label, onFocusEl }: { value: string; onChange: (v: string) => void; rows?: number; label?: string; onFocusEl?: (el: HTMLTextAreaElement) => void }) {
  return <textarea className="yc-field" value={value} rows={rows} onChange={(e) => onChange(e.target.value)} onFocus={(e) => onFocusEl?.(e.currentTarget)} aria-label={label} style={{ ...inputCss, height: 'auto', padding: '12px 14px', lineHeight: 1.5, resize: 'vertical' }} />;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" style={{ display: 'flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)} aria-pressed={on} style={{ flex: 1, height: 34, padding: '0 6px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ flex: 'none', position: 'relative', width: 44, height: 26, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', transition: 'background 200ms' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: `left 220ms ${SPRING}` }} />
      </span>
      <span style={{ fontSize: 14, color: 'var(--sand-700)' }}>{label}</span>
    </button>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{children}</div>;
}

export function VarChips({ active }: { active?: boolean }) {
  const { t } = useCrmT();
  const ui = useStudioUi();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <span style={{ width: '100%', fontSize: 12.5, color: 'var(--sand-500)' }}>{t(active ? 'yc.em.st.f.varsActive' : 'yc.em.st.f.vars')}</span>
      {VARS.map((v) => (
        <Hv
          key={v}
          as="button"
          type="button"
          // onMouseDown : le champ garde son curseur, la variable s'insère à sa place.
          onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); insertVariable(ui, v); }}
          title={t(`yc.em.st.var.${v}`)}
          style={{ height: 28, padding: '0 10px', border: 0, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', font: "500 12px 'Geist Mono',monospace", cursor: 'pointer' }}
          hover={{ background: 'var(--red-100)' }}
        >
          {`{{${v}}}`}
        </Hv>
      ))}
    </div>
  );
}

export function NightPick({ value, onPick, nights }: { value?: string | null; onPick: (n: NightRow) => void; nights: NightRow[] }) {
  const { t, dLong, time } = useCrmT();
  if (!nights.length) return <Note>{t('yc.em.st.f.noNights')}</Note>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {nights.map((n) => {
        const on = value === n.id;
        return (
          <button key={n.id} type="button" onClick={() => onPick(n)} aria-pressed={on} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 14, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'border-color 160ms,background 160ms' }}>
            <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 99, border: `2px solid ${on ? 'var(--red-500)' : 'var(--sand-300)'}`, display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? 'var(--red-500)' : 'transparent' }} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <b style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</b>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{cap(dLong(n.start_at))} · {time(n.start_at)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

