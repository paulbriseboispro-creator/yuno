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
  pos: 'var(--acc-34d399)',
  t1: 'rgb(var(--ink)/var(--ink-a96,0.96))',
  t2: 'rgb(var(--ink)/var(--ink-a58,0.58))',
  t3: 'rgb(var(--ink)/var(--ink-a36,0.36))',
  faint: 'rgb(var(--ink)/0.06)',
  border: 'rgb(var(--ink)/0.085)',
  fBorder: 'rgb(var(--ink)/0.055)',
  cardBg: 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)',
  innerBg: 'rgb(var(--ink)/0.032)',
  tileBg: 'rgb(var(--ink)/0.025)',
  shadow: '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))',
  font: "'Inter', system-ui, sans-serif",
} as const;

/** Espace fine insécable — le séparateur de milliers. */
const NBSP = ' ';

/** « 12 315 » — groupes de trois séparés par une fine insécable. */
export const actionFmt = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
