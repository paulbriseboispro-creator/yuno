import type { CSSProperties } from 'react';
import type { EmailBlock, EmailTheme, LiveData, SocialLinks } from '@/lib/email';
import { DEFAULT_PX, DEFAULT_PY } from '@/lib/email';

/** Contexte de rendu du canvas (aperçu d'édition, PAS l'email final). */
export interface CanvasCtx {
  venueName: string;
  socialLinks: SocialLinks;
  live: LiveData;
  baseUrl: string;
}

export const EMAIL_FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

/** Marges internes du bloc (px/py du prototype). */
export function blockPad(b: EmailBlock): { px: number; py: number } {
  return { px: b.px ?? DEFAULT_PX, py: b.py ?? DEFAULT_PY };
}

/** Fond du bloc (Auto / Teinte / Accent). */
export function blockBgColor(b: EmailBlock, theme: EmailTheme): string {
  if (b.bg === 'tile') return theme.tile;
  if (b.bg === 'accent') return theme.dark ? 'rgba(212,175,55,0.07)' : 'rgba(232,25,44,0.05)';
  return 'transparent';
}

/** Style des chips de variables {{…}} dans le canvas (varSt du prototype). */
export function varChipStyle(theme: EmailTheme, fontSize: number): CSSProperties {
  return {
    background: theme.dark ? 'rgba(212,175,55,0.18)' : 'rgba(232,25,44,0.12)',
    color: theme.dark ? '#e6c65c' : '#b3101f',
    padding: '1px 6px', borderRadius: 5,
    fontFamily: 'ui-monospace,Menlo,monospace',
    fontSize: fontSize - 2,
  };
}

/** Découpe un texte en segments [texte, variable, texte…] pour le surlignage. */
export function splitVariables(text: string): { token: string; isVar: boolean }[] {
  return String(text || '')
    .split(/(\{\{[^}]+\}\})/g)
    .filter((part) => part.length > 0)
    .map((part) => ({ token: part, isVar: /^\{\{[^}]+\}\}$/.test(part) }));
}

/** Placeholder image hachuré (imgBox du prototype). */
export function stripesBg(theme: EmailTheme, strong = false): string {
  if (theme.dark) return 'repeating-linear-gradient(135deg,#1c1c1c 0 10px,#232323 10px 20px)';
  return strong
    ? 'repeating-linear-gradient(135deg,#e6e6e6 0 10px,#f1f1f1 10px 20px)'
    : 'repeating-linear-gradient(135deg,#ececec 0 10px,#f6f6f6 10px 20px)';
}

/** Label mono des placeholders (imgLabel du prototype). */
export function placeholderLabelStyle(theme: EmailTheme): CSSProperties {
  return {
    fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11,
    color: theme.dark ? '#777' : '#8a8a8a', letterSpacing: '0.06em',
  };
}

/** Bouton email dans le canvas (btn / ctaBtn / evBtn du prototype). */
export function emailBtnStyle(theme: EmailTheme, opts: { radius?: number; full?: boolean; small?: boolean } = {}): CSSProperties {
  return {
    display: opts.full ? 'block' : 'inline-block',
    background: theme.accent,
    color: theme.btnText,
    fontFamily: EMAIL_FONT,
    fontWeight: opts.small ? 600 : 700,
    fontSize: opts.small ? 14 : 16,
    padding: opts.small ? '10px 20px' : '15px 40px',
    borderRadius: Math.min(opts.radius ?? (opts.small ? 6 : 8), 999),
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}
