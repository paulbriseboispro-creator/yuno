/** Styles communs de la page Connecteurs (carte, logo, entrée). */
import type { CSSProperties } from 'react';
import { EASE } from '@/crm/ui/motion';

export const CARD: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 24, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28,
  background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)',
};
export const LOGO = (size: number, r: number): CSSProperties => ({ flex: 'none', width: size, height: size, borderRadius: r, display: 'block', boxShadow: '0 0 0 1px rgba(28,21,23,.08),var(--shadow-xs)' });
export const ENTER = { animation: `yc-rise 700ms ${EASE} both` };
