/**
 * Pièces de formulaire de la rubrique Communication, composées avec le kit
 * (`a-input`, `a-btn`, variables `--a-*`) : un champ avec sa phrase d'aide,
 * un interrupteur. Le kit n'a pas encore de primitive de formulaire.
 */
import type { ReactNode } from 'react';

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <span className="a-t1 text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="a-t3 text-[12px] leading-snug">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="a-focus relative h-5 w-9 flex-none rounded-full border-0 p-0 transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--a-pos)' : 'var(--a-border-strong, var(--a-border))', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span aria-hidden className="absolute top-0.5 h-4 w-4 rounded-full transition-all" style={{ left: checked ? 18 : 2, background: 'var(--a-panel)' }} />
    </button>
  );
}

export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="a-t1 text-[13px] font-medium">{label}</div>
        {hint && <div className="a-t3 text-[12px]">{hint}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={typeof label === 'string' ? label : ''} />
    </div>
  );
}
