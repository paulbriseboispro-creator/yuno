/**
 * Pièces communes du Parcours client : titre de section, bandeau « à
 * retenir » et menu déroulant des filtres.
 */
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { JR_IC } from './jrLib';

export function SecHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px 20px' }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.2 }}>{title}</h2>
        {sub && <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** Bandeau « à retenir » du prototype : point rouge et phrase. */
export function Note({ children, size = 15, tone = 'red' }: { children: ReactNode; size?: number; tone?: 'red' | 'amber' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: tone === 'red' ? 'var(--red-50)' : 'var(--amber-50)', color: tone === 'red' ? 'var(--ink)' : 'var(--amber-700)' }}>
      {tone === 'red' && <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />}
      <span style={{ fontSize: size, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{children}</span>
    </div>
  );
}

export interface DropOption { key: string; label: string; sub?: string; tag?: { label: string; bg: string; fg: string }; on: boolean; disabled?: boolean; pick: () => void }

/** Menu déroulant d'un filtre (étiquette mono, valeur, liste à coches). */
export function FilterDrop({
  label, value, options, open, onToggle, width, disabled,
}: { label: string; value: string; options: DropOption[]; open: boolean; onToggle: () => void; width: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ position: 'relative', opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 200ms', maxWidth: '100%' }}>
      <Hv
        as="button"
        type="button"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        style={{ height: 42, maxWidth: 'min(300px, calc(100vw - 32px))', padding: '0 12px 0 16px', borderRadius: 99, background: '#fff', border: `1px solid ${open ? 'var(--sand-400)' : 'var(--sand-200)'}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', transition: 'border-color 140ms' }}
        hover={{ borderColor: 'var(--sand-300)' }}
      >
        <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', fontWeight: 500 }}>{label}</span>
        <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
        <Icon name="chevronDown" size={14} stroke={2.4} color="var(--sand-400)" style={{ transform: `rotate(${open ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
      </Hv>
      {open && (
        <div role="listbox" style={{ position: 'absolute', top: 48, left: 0, width, maxHeight: 'min(440px, 70vh)', overflowY: 'auto', boxSizing: 'border-box', padding: 8, borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', zIndex: 30, display: 'flex', flexDirection: 'column', gap: 2, animation: `yc-pop 180ms ${EASE} both` }}>
          {options.map((o) => (
            <Hv
              key={o.key}
              as="button"
              type="button"
              role="option"
              aria-selected={o.on}
              aria-disabled={o.disabled || undefined}
              onClick={o.disabled ? undefined : o.pick}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: 0, borderRadius: 12, background: 'none', cursor: o.disabled ? 'default' : 'pointer', textAlign: 'left', fontSize: 14.5, color: o.disabled ? 'var(--sand-400)' : 'var(--ink)' }}
              hover={o.disabled ? {} : { background: 'var(--sand-50)' }}
            >
              <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 99, display: 'grid', placeItems: 'center', background: o.on ? 'var(--red-500)' : 'var(--sand-100)', color: '#fff' }}>{o.on && <Icon d={JR_IC.check} size={11} stroke={3.2} />}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {o.sub && <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.sub}</span>}
              </span>
              {o.tag && <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: o.tag.bg, color: o.tag.fg, whiteSpace: 'nowrap' }}>{o.tag.label}</span>}
            </Hv>
          ))}
        </div>
      )}
    </div>
  );
}
