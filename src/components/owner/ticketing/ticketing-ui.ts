import { type CSSProperties } from 'react';

// ─── Yuno Dark Premium — Design Tokens ────────────────────────────────────────
// See docs/DESIGN_SYSTEM.md. Pure-black surfaces, single red accent, hierarchy by
// opacity (T1/T2/T3), inline-styled divs (no shadcn Card), Lucide icons only.
// Extracted verbatim from OwnerTicketing.tsx — shared by the ticketing dialogs.
export const RED = '#E8192C';
export const POS = 'var(--acc-34d399)';
export const GOLD = 'var(--acc-fcd34d)';
export const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
export const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
export const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
export const C_FAINT = 'rgb(var(--ink)/0.06)';
export const BORDER = 'rgb(var(--ink)/0.085)';
// CARD_BG / INNER_BG are only consumed by the style objects below — kept module-internal.
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
export const TILE_BG = 'rgb(var(--ink)/0.025)';
export const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

// Top-level section card
export const MAIN_CARD: CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  overflow: 'hidden',
  position: 'relative',
};
// Nested card inside a MAIN_CARD
export const INNER_CARD: CSSProperties = {
  background: INNER_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
};
// Level-3 tile
export const TILE: CSSProperties = {
  background: TILE_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
};
// Uppercase micro-label
export const LABEL: CSSProperties = {
  color: T3,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
};
// Modal surface
export const DIALOG_SURFACE: CSSProperties = {
  background: 'linear-gradient(180deg,rgb(var(--ink)/.025) 0%,transparent 40%),var(--sf-0a0a0c)',
  border: `1px solid ${BORDER}`,
};
export const DIALOG_TITLE: CSSProperties = { color: T1, fontSize: 17, fontWeight: 600, letterSpacing: '-0.015em' };
export const HINT: CSSProperties = { color: T3, fontSize: 11.5 };
