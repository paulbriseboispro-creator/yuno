// Shared Yuno pro-dashboard design tokens + primitives for the guest-list "parts"
// surface. Single source so PartCard, AddPartSheet and the OwnerGuestList
// orchestrator can't drift. See docs/DESIGN_SYSTEM.md.

export const RED         = '#E8192C';
export const POS         = 'var(--acc-34d399)';
export const NEG         = 'var(--acc-ff5c63)';
export const T1          = 'rgb(var(--ink)/var(--ink-a96,0.96))';
export const T2          = 'rgb(var(--ink)/var(--ink-a58,0.58))';
export const T3          = 'rgb(var(--ink)/var(--ink-a36,0.36))';
export const BORDER      = 'rgb(var(--ink)/0.085)';
export const F_BORDER    = 'rgb(var(--ink)/0.055)';
export const C_FAINT     = 'rgb(var(--ink)/0.06)';
export const INNER_BG    = 'rgb(var(--ink)/0.032)';
export const TILE_BG     = 'rgb(var(--ink)/0.025)';
export const CARD_BG     = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
export const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

export function YunoSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{ width: 44, height: 26, borderRadius: 13, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: checked ? RED : 'rgb(var(--ink)/0.14)', position: 'relative', transition: 'background 0.2s', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
    </button>
  );
}
