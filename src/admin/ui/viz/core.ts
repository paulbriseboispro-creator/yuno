/**
 * Socle des dessins sur mesure du kit (v3) : mesure de la largeur, échelles,
 * graduations « rondes », survol synchronisé entre plusieurs graphiques.
 * Pur SVG, aucune bibliothèque : les formes suivent la question
 * (docs/designs/ADMIN_DESIGN_SYSTEM.md).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Largeur d'un conteneur, suivie au redimensionnement. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setW(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Échelle linéaire [d0, d1] → [r0, r1]. Domaine nul : tout au milieu. */
export function linear(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0;
  return (v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
}

/**
 * Graduations rondes (1, 2, 2,5, 5 × 10ⁿ) couvrant [0, max]. `integer` : des
 * comptes (personnes, billets) n'ont que des graduations entières, sinon un
 * maximum de 1 donnait « 0 ; 0,25 ; 0,5 … », lus « 0, 0, 1, 1 » une fois arrondis.
 */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const mults = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = mults.map((m) => m * pow).find((s) => s >= raw) ?? raw;
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Vrai quand toutes les valeurs connues sont entières (des comptes, pas des montants). */
export function allIntegers(values: Array<number | null | undefined>): boolean {
  return values.every((v) => v == null || Number.isInteger(v));
}

/** Chemin d'une ligne brisée (les `null` coupent la ligne). */
export function linePath(pts: Array<[number, number] | null>): string {
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Le plus proche index pour une abscisse, sur `n` points répartis de x0 à x1. */
export function nearestIndex(x: number, n: number, x0: number, x1: number): number {
  if (n <= 1 || !Number.isFinite(x) || x1 === x0) return 0;
  const i = Math.round(((x - x0) / (x1 - x0)) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

/** Intensité 0..1 d'une valeur dans [0, max] (pour les teintes). */
export function intensity(v: number | null | undefined, max: number): number {
  if (v == null || !Number.isFinite(v) || max <= 0) return 0;
  return Math.max(0, Math.min(1, v / max));
}

/** Teinte d'une intensité, en encre neutre (le rouge reste réservé à l'attention) : 4 à 26 %. */
export function tintOf(k: number): string {
  return k <= 0 ? 'transparent' : `color-mix(in srgb, var(--a-text) ${Math.round(4 + k * 22)}%, transparent)`;
}

/** Vrai quand l'utilisateur demande moins d'animation. */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return r;
}

/** Teinte d'une cellule de tableau selon sa valeur (0..max), en encre neutre. */
export function cellTint(v: number | null | undefined, max: number): string | undefined {
  const k = intensity(v, max);
  return k > 0 ? `color-mix(in srgb, var(--a-text) ${Math.round(3 + k * 13)}%, transparent)` : undefined;
}

/**
 * Index de l'étape qui perd le plus de monde par rapport à la précédente. En
 * personnes, jamais en pourcentage : sur de petits volumes, un taux ment.
 * `null` quand aucune étape ne perd personne.
 */
export function biggestDrop(values: readonly number[]): number | null {
  let best: number | null = null;
  let bestLost = 0;
  for (let i = 1; i < values.length; i += 1) {
    const lost = Math.max(0, (values[i - 1] ?? 0) - (values[i] ?? 0));
    if (lost > bestLost) { bestLost = lost; best = i; }
  }
  return best;
}

/** Part d'un délai écoulée, bornée à [0, 1]. Une durée nulle ou une date illisible = 0. */
export function elapsedShare(from: number, to: number, now: number): number {
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.max(0, Math.min(1, (now - from) / span));
}

/** Teinte d'encre neutre pour un rang d'étape (0..n-1), de 10 à 30 %. */
export function stepInk(i: number, n: number): string {
  const k = n <= 1 ? 1 : i / (n - 1);
  return `color-mix(in srgb, var(--a-text) ${Math.round(10 + k * 20)}%, transparent)`;
}

/** Remplissage d'une barre selon le ton (le rouge vif reste l'attention, le retard est l'aplat bordeaux). */
export const TONE_FILL = {
  neutral: 'var(--a-text-2)',
  accent: 'var(--a-chart-1)',
  positive: 'var(--a-pos)',
  warning: 'var(--a-warn)',
  negative: 'var(--a-neg-soft)',
} as const;

/** L'heure courante, rafraîchie (échéances qui se vident). */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), everyMs); return () => window.clearInterval(id); }, [everyMs]);
  return now;
}
