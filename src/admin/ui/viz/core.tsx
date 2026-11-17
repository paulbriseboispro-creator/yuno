/**
 * Socle des dessins sur mesure du kit (v3) : mesure de la largeur, échelles,
 * graduations « rondes », survol synchronisé entre plusieurs graphiques.
 * Pur SVG, aucune bibliothèque : les formes suivent la question
 * (docs/designs/ADMIN_DESIGN_SYSTEM.md).
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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

/** Graduations rondes (1, 2, 5 × 10ⁿ) couvrant [0, max]. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Chemin d'une ligne brisée (les `null` coupent la ligne). */
export function linePath(pts: Array<[number, number] | null>): string {
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Le plus proche index pour une abscisse, sur `n` points répartis de x0 à x1. */
export function nearestIndex(x: number, n: number, x0: number, x1: number): number {
  if (n <= 1) return 0;
  const i = Math.round(((x - x0) / (x1 - x0)) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

/** Intensité 0..1 d'une valeur dans [0, max] (pour les teintes). */
export function intensity(v: number | null | undefined, max: number): number {
  if (v == null || !Number.isFinite(v) || max <= 0) return 0;
  return Math.max(0, Math.min(1, v / max));
}

/** Teinte d'accent pour une intensité : de transparent à 30 % (jamais un aplat plein). */
export function tintOf(k: number): string {
  return k <= 0 ? 'transparent' : `color-mix(in srgb, var(--a-accent) ${Math.round(4 + k * 26)}%, transparent)`;
}

// ── Survol synchronisé (small multiples, héros + bande) ─────────────────────

interface Sync { index: number | null; setIndex: (i: number | null) => void }
const SyncContext = createContext<Sync | null>(null);

/** Les graphiques posés dedans partagent l'index survolé (même axe du temps). */
export function HoverSync({ children }: { children: ReactNode }) {
  const [index, setIndexState] = useState<number | null>(null);
  const setIndex = useCallback((i: number | null) => setIndexState(i), []);
  const v = useMemo(() => ({ index, setIndex }), [index, setIndex]);
  return <SyncContext.Provider value={v}>{children}</SyncContext.Provider>;
}

/** L'index survolé : partagé dans un HoverSync, local sinon. */
export function useHoverIndex(): Sync {
  const shared = useContext(SyncContext);
  const [local, setLocal] = useState<number | null>(null);
  return shared ?? { index: local, setIndex: setLocal };
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
