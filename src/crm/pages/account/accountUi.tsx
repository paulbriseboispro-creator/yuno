/**
 * Pièces communes du Compte : la carte (ombre qui monte au survol), son
 * titre, les champs, l'interrupteur encre des préférences et le bouton
 * principal de l'en-tête.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING } from '@/crm/ui/motion';

export function Card({ children, gap = 18, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  return (
    <Hv
      as="section"
      style={{ display: 'flex', flexDirection: 'column', gap, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', transition: 'box-shadow 260ms', minWidth: 0, ...style }}
      hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' }}
    >
      {children}
    </Hv>
  );
}

export function CardHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{title}</h2>
        {sub && <span style={{ fontSize: 14, color: 'var(--sand-500)', textWrap: 'pretty' }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

export const inputCss: CSSProperties = {
  height: 48, boxSizing: 'border-box', padding: '0 16px', borderRadius: 14, border: '1px solid var(--sand-200)', background: '#fff',
  fontSize: 15, color: 'var(--ink)', outline: 'none', width: '100%', transition: 'border-color 160ms,box-shadow 160ms',
};

export function Field({ label, hint, error, right, children }: { label: string; hint?: string; error?: string | null; right?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{label}{right}</span>
      {children}
      {(error || hint) && <span style={{ fontSize: 12.5, lineHeight: 1.4, color: error ? 'var(--red-600)' : 'var(--sand-500)' }}>{error || hint}</span>}
    </label>
  );
}

/** Interrupteur encre (préférences), 44 × 26 ou 48 × 28. */
export function InkSwitch({ on, onChange, label, disabled, size = 'md' }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 44 : 48;
  const h = size === 'sm' ? 26 : 28;
  const k = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ flex: 'none', position: 'relative', width: w, height: h, padding: 0, border: 0, borderRadius: 99, background: on ? 'var(--ink)' : 'var(--sand-300)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition: 'background 240ms' }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? w - k - 3 : 3, width: k, height: k, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: `left 240ms ${SPRING}` }} />
    </button>
  );
}

export function HeadCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      style={{ flex: 'none', height: 48, padding: '0 6px 0 22px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
      hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
      active={{ transform: 'scale(.97)' }}
    >
      {label}
      <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="plus" size={17} stroke={2.4} /></span>
    </Hv>
  );
}

/** Bouton fantôme bordé (Modifier, Voir…), avec chevron qui tourne. */
export function GhostToggle({ label, open, onClick }: { label: string; open?: boolean; onClick: () => void }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      aria-expanded={open}
      style={{ flex: 'none', height: 40, padding: '0 14px 0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
      hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
      active={{ transform: 'scale(.97)' }}
    >
      {label}
      {open !== undefined && <Icon name="chevronDown" size={15} stroke={2.4} style={{ transform: `rotate(${open ? 180 : 0}deg)`, transition: `transform 320ms ${EASE}` }} />}
    </Hv>
  );
}

/** Zone dépliable (grid-rows 0fr → 1fr). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div style={{ flex: '1 1 100%', display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transition: `grid-template-rows 460ms ${EASE},opacity 320ms ease` }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

/** Barre « Modifications non enregistrées » (bas d'écran). */
export function DirtyBar({ label, onCancel, onSave, saving, disabled, saveLabel, cancelLabel }: { label: string; onCancel: () => void; onSave: () => void; saving: boolean; disabled: boolean; saveLabel: string; cancelLabel: string }) {
  return (
    <div role="region" aria-label={label} style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px 8px 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: 'var(--shadow-md)', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', animation: `yc-toast-in 260ms ${EASE} both` }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--red-400)', flex: 'none' }} />{label}
      </span>
      <Hv as="button" type="button" onClick={onCancel} style={{ flex: 'none', height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.22)' }}>{cancelLabel}</Hv>
      <Hv as="button" type="button" onClick={onSave} disabled={disabled || saving} style={{ flex: 'none', height: 38, padding: '0 20px', border: 0, borderRadius: 99, background: disabled ? 'rgba(255,255,255,.16)' : 'var(--gradient-brand)', color: disabled ? 'rgba(255,255,255,.55)' : '#fff', fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }} hover={disabled ? {} : { filter: 'brightness(1.08)' }}>
        {saving && <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />}
        {saveLabel}
      </Hv>
    </div>
  );
}
