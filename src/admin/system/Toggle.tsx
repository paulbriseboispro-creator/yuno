/**
 * Un interrupteur à deux états (role="switch"), aux couleurs du kit : accent
 * quand il est allumé, bordure forte quand il est éteint. Il ne fait rien
 * seul : l'écran qui le pose ouvre un `ReasonDialog` avant d'écrire.
 */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="a-focus relative h-[22px] w-[40px] flex-none rounded-full border-0 p-0 transition-colors disabled:opacity-50"
      style={{ background: on ? 'var(--a-accent)' : 'var(--a-border-strong)', cursor: disabled ? 'default' : 'pointer' }}>
      <span aria-hidden className="absolute top-[3px] h-4 w-4 rounded-full transition-[left]" style={{ left: on ? 21 : 3, background: 'var(--a-accent-fg)' }} />
    </button>
  );
}
