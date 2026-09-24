/**
 * Thème clair des dashboards pro — la palette Tailwind devient VARIABLE.
 *
 * Toute l'app a été dessinée en sombre : `text-zinc-400` est un texte
 * secondaire, `bg-zinc-900` une carte, `text-emerald-400` un chiffre positif,
 * `bg-white/5` un fond de tuile. Plutôt que de réécrire des milliers de classes,
 * chaque nuance utilisée par les dashboards pointe sur une variable CSS
 * (`rgb(var(--pal-zinc-400) / <alpha-value>)`) :
 *
 *   • par défaut (`:root`), la variable vaut EXACTEMENT la couleur Tailwind —
 *     le rendu sombre et toutes les pages publiques ne bougent pas d'un pixel ;
 *   • sous `html[data-pro-theme="light"]` (posé par `ProThemeController`, et
 *     SEULEMENT sur une route pro), les gris s'inversent (400 ↔ 600,
 *     900 ↔ 100…) et les couleurs vives passent sur leur nuance lisible sur
 *     fond clair (400 → 600, 950 → 50) ; `white` devient l'encre.
 *   • `[data-theme-island="dark"]` rétablit le sombre dans un îlot (globe
 *     Live View, aperçu d'un écran client…).
 *
 * Les nuances 500-700 des couleurs vives ne bougent JAMAIS : ce sont les fonds
 * pleins des boutons (`bg-emerald-600 text-white`), qui restent identiques
 * dans les deux thèmes. `snow` est le blanc qui ne bascule pas : texte posé sur
 * un fond coloré, une photo, un QR code.
 */
import defaultColors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

const GREYS = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const;
const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const;
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

/** Nuance affichée en thème clair pour une nuance d'un GRIS : miroir exact. */
const GREY_LIGHT: Record<string, string> = {
  50: '950', 100: '900', 200: '800', 300: '700', 400: '600', 500: '500',
  600: '400', 700: '300', 800: '200', 900: '100', 950: '50',
};
/** Couleurs vives : les tons clairs foncent, les tons sombres éclaircissent,
 *  les fonds pleins (500-700) restent. */
const HUE_LIGHT: Record<string, string> = {
  50: '950', 100: '900', 200: '800', 300: '700', 400: '600', 500: '500',
  600: '600', 700: '700', 800: '200', 900: '100', 950: '50',
};

/** Surfaces historiques `yuno.*` (tailwind) : sombre → clair. */
const YUNO: Record<string, [string, string]> = {
  black: ['#0A0A0A', '#F5F5F6'],
  card: ['#141414', '#FFFFFF'],
  card2: ['#1B1B1E', '#F4F4F5'],
  input: ['#1F1F22', '#FFFFFF'],
  gray1: ['#E5E5E5', '#27272A'],
  gray2: ['#9A9A9A', '#71717A'],
  gray3: ['#5A5A5E', '#A1A1AA'],
  gray4: ['#3A3A3E', '#D4D4D8'],
};

/** Encre claire (zinc-950) : le « blanc » des dashboards en thème clair. */
export const LIGHT_INK = '9 9 11';

function rgb(hex: string): string {
  const h = hex.replace('#', '');
  const x = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return `${parseInt(x.slice(0, 2), 16)} ${parseInt(x.slice(2, 4), 16)} ${parseInt(x.slice(4, 6), 16)}`;
}

const v = (name: string) => `rgb(var(--pal-${name}) / <alpha-value>)`;

type Palette = Record<string, string>;
const palette = (defaultColors as unknown) as Record<string, Palette>;

/** Couleurs Tailwind à injecter dans `theme.extend.colors`. */
export function themeColors() {
  const colors: Record<string, string | Record<string, string>> = {
    white: v('white'),
    snow: '#ffffff',
    // Texte d'un bouton blanc inversé (noir en sombre, blanc en clair).
    paper: 'rgb(var(--paper) / <alpha-value>)',
    // Fond de page plein (noir en sombre, gris très clair en clair).
    page: 'rgb(var(--page) / <alpha-value>)',
  };
  for (const name of [...GREYS, ...HUES]) {
    colors[name] = Object.fromEntries(SHADES.map((s) => [s, v(`${name}-${s}`)]));
  }
  colors.yuno = Object.fromEntries(Object.keys(YUNO).map((k) => [k, v(`yuno-${k}`)]));
  return colors;
}

function vars(mode: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {
    '--pal-white': mode === 'dark' ? '255 255 255' : LIGHT_INK,
  };
  for (const name of GREYS) {
    for (const s of SHADES) {
      out[`--pal-${name}-${s}`] = rgb(palette[name][mode === 'dark' ? s : GREY_LIGHT[s]]);
    }
  }
  for (const name of HUES) {
    for (const s of SHADES) {
      out[`--pal-${name}-${s}`] = rgb(palette[name][mode === 'dark' ? s : HUE_LIGHT[s]]);
    }
  }
  for (const [k, [dark, light]] of Object.entries(YUNO)) {
    out[`--pal-yuno-${k}`] = rgb(mode === 'dark' ? dark : light);
  }
  return out;
}

export const LIGHT_SELECTOR = 'html[data-pro-theme="light"]';
export const DARK_ISLAND_SELECTOR = 'html[data-pro-theme="light"] [data-theme-island="dark"]';

/** Plugin : pose les variables de palette pour les deux thèmes. */
export const themePalettePlugin = plugin(({ addBase }) => {
  const dark = vars('dark');
  addBase({
    ':root': dark,
    [LIGHT_SELECTOR]: vars('light'),
    [DARK_ISLAND_SELECTOR]: dark,
  });
});
