// Shared Yuno pro-dashboard design tokens + primitives for the guest-list "parts"
// surface. Single source so PartCard, AddPartSheet and the OwnerGuestList
// orchestrator can't drift. See docs/DESIGN_SYSTEM.md.

export const RED         = '#E8192C';
export const POS         = '#34D399';
export const NEG         = '#FF5C63';
export const T1          = 'rgba(255,255,255,0.96)';
export const T2          = 'rgba(255,255,255,0.58)';
export const T3          = 'rgba(255,255,255,0.36)';
export const BORDER      = 'rgba(255,255,255,0.085)';
export const F_BORDER    = 'rgba(255,255,255,0.055)';
export const C_FAINT     = 'rgba(255,255,255,0.06)';
export const INNER_BG    = 'rgba(255,255,255,0.032)';
export const TILE_BG     = 'rgba(255,255,255,0.025)';
export const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

export function YunoSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{ width: 44, height: 26, borderRadius: 13, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: checked ? RED : 'rgba(255,255,255,0.14)', position: 'relative', transition: 'background 0.2s', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
    </button>
  );
}
