/**
 * Les constantes de l'écran d'action, hors du fichier de composants : un
 * module qui exporte à la fois des composants et des valeurs casse le
 * rafraîchissement à chaud de Vite.
 *
 * Tokens du design system des dashboards pro (`docs/DESIGN_SYSTEM.md` §2) :
 * l'écran d'action ne vit QUE dans la Console, jamais sur une page publique.
 */

export const ACTION_ACCENT = '#E8192C';

export const ACT = {
  red: ACTION_ACCENT,
  pos: '#34D399',
  t1: 'rgba(255,255,255,0.96)',
  t2: 'rgba(255,255,255,0.58)',
  t3: 'rgba(255,255,255,0.36)',
  faint: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.085)',
  fBorder: 'rgba(255,255,255,0.055)',
  cardBg: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
  innerBg: 'rgba(255,255,255,0.032)',
  tileBg: 'rgba(255,255,255,0.025)',
  shadow: '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)',
  font: "'Inter', system-ui, sans-serif",
} as const;

/** Espace fine insécable — le séparateur de milliers. */
const NBSP = ' ';

/** « 12 315 » — groupes de trois séparés par une fine insécable. */
export const actionFmt = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
