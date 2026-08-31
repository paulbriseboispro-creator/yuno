import type { EmailTheme } from './types';

// 4 presets — tokens EMAIL exacts du prototype claude.design « Email Studio
// Yuno » (objet THEMES). Les couleurs restent surchargeables individuellement
// dans le panneau Thème.

export const THEME_PRESETS: readonly EmailTheme[] = [
  {
    name: 'classic_dark',
    bg: '#f3f4f6', card: '#ffffff',
    headerBg: '#0a0a0a', headerText: '#ffffff',
    text: '#1a1a1a', muted: '#7a7a7a',
    accent: '#dc2626', btnText: '#ffffff',
    divider: '#e5e7eb', tile: '#fafafa',
    footerBg: '#f9fafb', footerText: '#6b7280',
    dark: false,
  },
  {
    name: 'clean_light',
    bg: '#fafafa', card: '#ffffff',
    headerBg: '#ffffff', headerText: '#0a0a0a',
    text: '#111111', muted: '#8a8a8a',
    accent: '#000000', btnText: '#ffffff',
    divider: '#ececec', tile: '#fbfbfb',
    footerBg: '#ffffff', footerText: '#9ca3af',
    dark: false,
  },
  {
    name: 'yuno_red',
    bg: '#1a0606', card: '#ffffff',
    headerBg: '#dc2626', headerText: '#ffffff',
    text: '#1a1a1a', muted: '#7a7a7a',
    accent: '#dc2626', btnText: '#ffffff',
    divider: '#f0dede', tile: '#fff7f7',
    footerBg: '#fff5f5', footerText: '#9b6b6b',
    dark: false,
  },
  {
    name: 'gold_night',
    bg: '#0a0a0a', card: '#0f0f0f',
    headerBg: '#0f0f0f', headerText: '#d4af37',
    text: '#f5f5f5', muted: '#8a8a8a',
    accent: '#d4af37', btnText: '#0a0a0a',
    divider: '#262626', tile: '#161616',
    footerBg: '#0a0a0a', footerText: '#9ca3af',
    dark: true,
  },
];

export const THEME_LABELS: Record<string, string> = {
  classic_dark: 'Sombre élégant',
  clean_light: 'Clair épuré',
  yuno_red: 'Yuno red',
  gold_night: 'Or & nuit',
};

/** Pastilles des cartes de preset (3 chips, valeurs du prototype). */
export const THEME_SWATCHES: Record<string, [string, string, string]> = {
  classic_dark: ['#f3f4f6', '#0a0a0a', '#dc2626'],
  clean_light: ['#fafafa', '#ffffff', '#000000'],
  yuno_red: ['#1a0606', '#dc2626', '#fca5a5'],
  gold_night: ['#0a0a0a', '#d4af37', '#f5f5f5'],
};

export const DEFAULT_STUDIO_THEME: EmailTheme = THEME_PRESETS[0];

export function themePreset(name: string): EmailTheme | undefined {
  return THEME_PRESETS.find((t) => t.name === name);
}

/** Complète un thème partiel (colonne theme_json) avec le preset le plus proche. */
export function normalizeTheme(raw: unknown): EmailTheme {
  const partial = (raw && typeof raw === 'object' ? raw : {}) as Partial<EmailTheme>;
  const base = themePreset(partial.name || '') || DEFAULT_STUDIO_THEME;
  return { ...base, ...partial, name: partial.name || base.name };
}
