/**
 * Les deux constantes de l'écran d'action, hors du fichier de composants : un
 * module qui exporte à la fois des composants et des valeurs casse le
 * rafraîchissement à chaud de Vite.
 */

export const ACTION_ACCENT = '#E8192C';

/** Espace fine insécable — le séparateur de milliers du prototype. */
const NBSP = ' ';

/** « 12 315 » — groupes de trois séparés par une fine insécable. */
export const actionFmt = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
