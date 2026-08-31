import type { EmailTheme } from './types';

// 4 presets — chaque thème est un jeu de tokens EMAIL complet. Les couleurs
// restent surchargeables individuellement dans le panneau Thème.

export const THEME_PRESETS: readonly EmailTheme[] = [
  {
    name: 'classic_dark',
    bg: '#f3f4f6', card: '#ffffff',
    headerBg: '#0a0a0a', headerText: '#ffffff',
    text: '#1a1a1a', muted: '#6b7280',
    accent: '#dc2626', btnText: '#ffffff',
    divider: '#e5e7eb', tile: '#f9fafb',
    footerBg: '#f9fafb', footerText: '#6b7280',
    dark: false,
  },
  {
    name: 'clean_light',
    bg: '#fafafa', card: '#ffffff',
    headerBg: '#ffffff', headerText: '#0a0a0a',
    text: '#111111', muted: '#6b7280',
    accent: '#000000', btnText: '#ffffff',
    divider: '#ececec', tile: '#f5f5f5',
    footerBg: '#fafafa', footerText: '#6b7280',
    dark: false,
  },
  {
    name: 'yuno_red',
    bg: '#1a0606', card: '#ffffff',
    headerBg: '#dc2626', headerText: '#ffffff',
    text: '#1a1a1a', muted: '#6b7280',
    accent: '#dc2626', btnText: '#ffffff',
    divider: '#f3dcdc', tile: '#fff7f7',
    footerBg: '#1a0606', footerText: '#9ca3af',
    dark: false,
  },
  {
    name: 'gold_night',
    bg: '#0a0a0a', card: '#0f0f0f',
    headerBg: '#0f0f0f', headerText: '#d4af37',
    text: '#f5f5f5', muted: '#9ca3af',
    accent: '#d4af37', btnText: '#0a0a0a',
    divider: '#262626', tile: '#171717',
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
