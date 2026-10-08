/**
 * Briques partagées des écrans Scénarios : champs de l'inspecteur, pastille
 * d'état, icône et couleur d'une étape, hauteur mesurée de l'éditeur (jamais
 * `100vh` : règle de l'Email Studio).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon, type IconName } from '@/crm/ui/Icon';
import { NODE_ICON, NODE_TINT } from './scnStyle';
import { Badge, type Tone } from '@/crm/ui/kit';
import type { ScnState } from '@/crm/data/scenarios';

export function NodeGlyph({ type, size = 34 }: { type: string; size?: number }) {
  const tint = NODE_TINT[type] ?? NODE_TINT.wait;
  return (
    <span style={{ flex: 'none', width: size, height: size, borderRadius: 11, background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}>
      <Icon name={NODE_ICON[type] ?? 'zap'} size={Math.round(size * 0.47)} stroke={2.2} />
    </span>
  );
}

const STATE_TONE: Record<ScnState, Tone> = {
  draft: 'wait', active: 'done', paused: 'warn', archived: 'wait', frozen: 'warn', plan_paused: 'warn',
};

export function StateBadge({ state, label }: { state: ScnState; label: string }) {
  return <Badge tone={STATE_TONE[state] ?? 'wait'}>{label}</Badge>;
}

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sand-700)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{hint}</span>}
      {error && <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--red-700)', fontWeight: 500 }}>{error}</span>}
    </label>
  );
}

const inputBase: CSSProperties = {
  height: 42, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)',
  background: '#fff', fontSize: 14.5, color: 'var(--ink)', outline: 'none', minWidth: 0, width: '100%', font: 'inherit',
};

export function TextInput({ value, onChange, placeholder, disabled, maxLength, ariaLabel }: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; maxLength?: number; ariaLabel?: string;
}) {
  return (
    <input className="yc-field" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      maxLength={maxLength} aria-label={ariaLabel} style={{ ...inputBase, opacity: disabled ? 0.6 : 1 }} />
  );
}

/** Un entier borné ; vide pendant la frappe, ramené dans les bornes à la sortie du champ. */
export function NumberInput({ value, onChange, min, max, disabled, suffix, ariaLabel, width = 110 }: {
  value: number | null | undefined; onChange: (v: number) => void; min: number; max: number; disabled?: boolean; suffix?: ReactNode; ariaLabel?: string; width?: number;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  const shown = txt ?? (value === null || value === undefined || Number.isNaN(value) ? '' : String(value));
  const commit = (s: string) => {
    const n = Math.round(Number(s.replace(',', '.')));
    if (s.trim() !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    setTxt(null);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <input
        className="yc-field" inputMode="numeric" value={shown} disabled={disabled} aria-label={ariaLabel}
        onChange={(e) => {
          setTxt(e.target.value);
          const n = Number(e.target.value.replace(',', '.'));
          if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={(e) => commit(e.target.value)}
        style={{ ...inputBase, width, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: disabled ? 0.6 : 1 }}
      />
      {suffix && <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{suffix}</span>}
    </span>
  );
}

export function SelectBox<T extends string>({ value, options, onChange, disabled, ariaLabel, placeholder }: {
  value: T | ''; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; disabled?: boolean; ariaLabel?: string; placeholder?: string;
}) {
  return (
    <span style={{ position: 'relative', display: 'block', minWidth: 0 }}>
      <select
        className="yc-field" value={value} disabled={disabled} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
        style={{ ...inputBase, appearance: 'none', WebkitAppearance: 'none', paddingRight: 38, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, textOverflow: 'ellipsis' }}
      >
        {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--sand-500)', display: 'grid' }}>
        <Icon name="chevronDown" size={15} stroke={2.4} />
      </span>
    </span>
  );
}

/** Pastilles à choix unique (petites listes) ou multiple. */
export function Chips<T extends string>({ value, options, onChange, multi, disabled }: {
  value: T | T[]; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T | T[]) => void; multi?: boolean; disabled?: boolean;
}) {
  const sel = Array.isArray(value) ? value : [value];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = sel.includes(o.value);
        return (
          <Hv
            key={o.value} as="button" type="button" aria-pressed={on} disabled={disabled || o.disabled}
            onClick={() => {
              if (!multi) { onChange(o.value); return; }
              const next = on ? sel.filter((x) => x !== o.value) : [...sel, o.value];
              onChange(next);
            }}
            style={{
              minHeight: 34, padding: '6px 13px', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: on ? 'var(--ink)' : 'var(--sand-200)',
              background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 13.5, fontWeight: 600,
              cursor: disabled || o.disabled ? 'default' : 'pointer', opacity: o.disabled ? 0.45 : 1, textAlign: 'left', lineHeight: 1.25,
            }}
            hover={on || disabled || o.disabled ? undefined : { borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
          >
            {o.label}
          </Hv>
        );
      })}
    </div>
  );
}

/** Ligne d'alerte (erreur rouge, avertissement ambre, information sable). */
export function Note({ tone, children, action }: { tone: 'error' | 'warn' | 'info'; children: ReactNode; action?: ReactNode }) {
  const c = tone === 'error' ? { bg: 'var(--red-50)', fg: 'var(--red-700)', ic: 'alert' as const }
    : tone === 'warn' ? { bg: 'var(--amber-50)', fg: 'var(--amber-700)', ic: 'alert' as const }
      : { bg: 'var(--sand-50)', fg: 'var(--sand-700)', ic: 'help' as const };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 12, background: c.bg, color: c.fg, fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>
      <span style={{ flex: 'none', marginTop: 1, display: 'grid' }}><Icon name={c.ic} size={15} stroke={2.3} /></span>
      <span style={{ flex: 1, minWidth: 0, textWrap: 'pretty', overflowWrap: 'anywhere' }}>{children}</span>
      {action}
    </div>
  );
}

export function SmallButton({ children, onClick, tone = 'light', disabled, icon, title }: {
  children?: ReactNode; onClick?: () => void; tone?: 'light' | 'dark' | 'ghost' | 'danger'; disabled?: boolean; icon?: IconName; title?: string;
}) {
  const s: Record<string, [CSSProperties, CSSProperties]> = {
    light: [{ background: '#fff', color: 'var(--ink)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)' }, { borderColor: 'var(--sand-300)', background: 'var(--paper)' }],
    dark: [{ background: 'var(--ink)', color: '#fff', borderWidth: 0, borderStyle: 'solid', borderColor: 'transparent' }, { background: 'var(--sand-700)' }],
    ghost: [{ background: 'transparent', color: 'var(--sand-700)', borderWidth: 0, borderStyle: 'solid', borderColor: 'transparent' }, { background: 'var(--sand-100)', color: 'var(--ink)' }],
    danger: [{ background: '#fff', color: 'var(--red-700)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--red-100)' }, { background: 'var(--red-50)' }],
  };
  const [base, hov] = s[tone];
  return (
    <Hv
      as="button" type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      style={{ height: 36, padding: children ? '0 14px' : 0, width: children ? undefined : 36, borderRadius: 99, fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap', flex: 'none', ...base }}
      hover={disabled ? undefined : hov}
      active={disabled ? undefined : { transform: 'scale(.97)' }}
    >
      {icon && <Icon name={icon} size={15} stroke={2.3} />}
      {children}
    </Hv>
  );
}
