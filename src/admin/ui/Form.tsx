/**
 * Pièces de formulaire et de filtre du kit : un champ avec sa phrase d'aide,
 * un interrupteur (seul ou en ligne avec sa description), une case à cocher,
 * des boutons segmentés, un champ nombre, une liste déroulante de filtre et une
 * section repliée. Avant elles, chaque rubrique avait les siennes (deux
 * interrupteurs de couleurs différentes, quatre `Field`).
 * Règles : un libellé toujours visible ou annoncé (`aria-label`), l'interrupteur
 * allumé prend l'accent, une liste de filtre fait 32 px de haut.
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** Un champ : libellé au-dessus, contrôle, phrase d'aide grise dessous. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <span className="a-t1 text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="a-t3 text-[12px] leading-snug">{hint}</span>}
    </label>
  );
}

/** Interrupteur à deux états (role="switch") : accent allumé, bordure forte éteint. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="a-focus relative h-[22px] w-[40px] flex-none rounded-full border-0 p-0 transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--a-accent)' : 'var(--a-border-strong)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span aria-hidden className="absolute top-[3px] h-4 w-4 rounded-full transition-[left]" style={{ left: checked ? 21 : 3, background: 'var(--a-accent-fg)' }} />
    </button>
  );
}

/** Une ligne de réglage : titre et description à gauche, interrupteur à droite. */
export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="a-t1 text-[13px] font-medium">{label}</div>
        {hint && <div className="a-t3 mt-0.5 text-[12px] leading-snug">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof label === 'string' ? label : ''} />
    </div>
  );
}

/** Une case à cocher alignée sur son texte, avec une phrase d'aide facultative. */
export function Checkbox({ checked, onChange, children, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-start gap-2">
      <input type="checkbox" className="a-check mt-[2px]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col gap-0.5">
        <span className="a-t1 text-[13px]">{children}</span>
        {hint && <span className="a-t3 text-[12px] leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

/** Un choix parmi quelques valeurs, en boutons segmentés. */
export function Segmented<V extends string>({ value, options, onChange, label }: {
  value: NoInfer<V>; options: { value: V; label: ReactNode; disabled?: boolean }[]; onChange: (v: NoInfer<V>) => void; label?: string;
}) {
  return (
    <div className="a-seg flex-wrap self-start" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Un nombre aligné à droite, qui ne descend pas sous `min`. */
export function NumberInput({ value, onChange, step = 1, min = 0, width = 96, label }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; width?: number; label: string;
}) {
  return (
    <input type="number" className="a-input a-num text-right" style={{ width }} aria-label={label}
      value={Number.isFinite(value) ? value : 0} min={min} step={step}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value)))} />
  );
}

/** Une liste déroulante de formulaire. */
export function Select<V extends string>({ value, options, onChange, label }: {
  value: NoInfer<V>; options: { value: V; label: string }[]; onChange: (v: NoInfer<V>) => void; label?: string;
}) {
  return (
    <select className="a-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Liste déroulante de la barre de filtres d'un tableau (32 px, largeur du contenu). */
export function FilterSelect<V extends string>({ value, options, onChange, label }: {
  value: NoInfer<V>; options: { value: V; label: string }[]; onChange: (v: NoInfer<V>) => void; label: string;
}) {
  return (
    <select className="a-input a-input--filter" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Une section repliée, sans boîte : un filet, un chevron, le titre (un `<details>` natif : clavier et lecteur d'écran gratuits). */
export function Fold({ title, hint, children, defaultOpen = false }: {
  title: ReactNode;
  /** Une ligne grise à droite du titre (« 12 lignes », « 3 en attente »). */
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border-t pt-2" open={defaultOpen}>
      <summary className="a-focus flex min-h-[40px] cursor-pointer list-none items-center gap-2 rounded-md py-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="a-t3 h-4 w-4 flex-none transition-transform group-open:rotate-90" />
        <span className="a-t1 min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</span>
        {hint && <span className="a-mono a-t3 flex-none text-[11px]">{hint}</span>}
      </summary>
      <div className="flex flex-col gap-4 pt-3">{children}</div>
    </details>
  );
}

/** Une puce de filtre qui s'allume et s'éteint (choisie = encre inversée). */
export function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number | null }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className="a-focus inline-flex h-7 items-center gap-1.5 rounded-full border px-3 font-[inherit] text-[12.5px]"
      style={{ cursor: 'pointer', background: on ? 'var(--a-text)' : 'transparent', color: on ? 'var(--a-bg)' : 'var(--a-text-2)', borderColor: on ? 'var(--a-text)' : 'var(--a-border)' }}>
      {children}
      {count != null && <span className="a-mono text-[11px]" style={{ opacity: 0.7 }}>{count}</span>}
    </button>
  );
}

/** Des puces de filtre, un seul choix, avec leur nombre. */
export function Chips<V extends string>({ value, options, onChange, label }: {
  value: V;
  options: Array<{ value: V; label: ReactNode; count?: number | null }>;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => <Chip key={o.value} on={o.value === value} onClick={() => onChange(o.value)} count={o.count}>{o.label}</Chip>)}
    </div>
  );
}
