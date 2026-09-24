import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Primitives éditoriales de la vue en direct — DESIGN_SYSTEM_PUBLIC : hex
 * durs, Space Grotesk pour les chiffres, JetBrains Mono pour tout ce qui
 * est une donnée, filet rouge pour ouvrir une section, radius tranchant.
 */

export const LV = {
  bg: 'var(--sf-0a0a0a)',
  card: '#141414',
  card2: '#1B1B1E',
  red: '#E8192C',
  white: '#FFFFFF',
  gray1: '#E5E5E5',
  gray2: '#9A9A9A',
  gray3: '#5A5A5E',
  gray4: '#3A3A3E',
  border: 'rgb(var(--ink)/0.08)',
  borderStrong: 'rgb(var(--ink)/0.14)',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/** Label de section à filet rouge (classe globale `.section-label-ruled`). */
export function Kicker({ children, right, className = '' }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <p className="section-label-ruled m-0">{children}</p>
      {right}
    </div>
  );
}

/** Metadata mono uppercase — la signature nightlife. */
export function Mono({ children, color = LV.gray2, size = 10.5, tracking = '0.08em', className = '', style }: {
  children: ReactNode; color?: string; size?: number; tracking?: string; className?: string; style?: CSSProperties;
}) {
  return (
    <span className={`font-mono uppercase ${className}`} style={{ fontSize: size, color, letterSpacing: tracking, lineHeight: 1.3, ...style }}>
      {children}
    </span>
  );
}

/** Compteur qui glisse vers sa nouvelle valeur (220 ms) — jamais un saut sec. */
export function useCountUp(value: number, duration = 220): number {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || Math.abs(value - from) > 5000) { fromRef.current = value; setShown(value); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * e;
      setShown(p < 1 ? v : value);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);
  return shown;
}

export function BigNumber({ value, format, size = 'clamp(34px, 5vw, 48px)', color = LV.white }: {
  value: number; format: (n: number) => string; size?: string; color?: string;
}) {
  const shown = useCountUp(value);
  return (
    <span className="font-display font-bold tabular-nums" style={{ fontSize: size, color, letterSpacing: '-0.03em', lineHeight: 0.95, display: 'block' }}>
      {format(Math.round(shown))}
    </span>
  );
}

/** Barre fine (2 px) — la barre de progression du design system public. */
export function ThinBar({ pct, accent = false, height = 2 }: { pct: number; accent?: boolean; height?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="w-full overflow-hidden" style={{ height, background: 'rgb(var(--ink)/0.06)', borderRadius: 1 }}>
      <div style={{ height: '100%', width: `${w}%`, background: accent ? LV.red : LV.gray4, transition: `width 0.6s ${LV.ease}`, borderRadius: 1 }} />
    </div>
  );
}

export function Section({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={`px-5 py-5 ${className}`} style={{ borderBottom: `1px solid rgb(var(--ink)/0.07)`, ...style }}>
      {children}
    </section>
  );
}
