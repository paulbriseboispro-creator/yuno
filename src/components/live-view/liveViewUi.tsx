import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Primitives de la vue en direct — DESIGN_SYSTEM (dashboards pro) : fond
 * `#0a0a0c`, hiérarchie par opacité (T1 → T2 → T3), cartes à 18 / 14 / 12 px,
 * labels uppercase de 10–11 px, accent rouge unique, vert pour le « live ».
 */

export const LV = {
  bg: '#0a0a0c',
  red: '#E8192C',
  pos: '#34D399',
  t1: 'rgba(255,255,255,0.96)',
  t2: 'rgba(255,255,255,0.58)',
  t3: 'rgba(255,255,255,0.36)',
  cHi: 'rgba(255,255,255,0.92)',
  cMid: 'rgba(255,255,255,0.40)',
  faint: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.085)',
  fBorder: 'rgba(255,255,255,0.055)',
  cardBg: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
  innerBg: 'rgba(255,255,255,0.032)',
  tileBg: 'rgba(255,255,255,0.025)',
  shadow: '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/** En-tête de section : titre 15 px + élément droit optionnel. */
export function SectionTitle({ children, right, className = '' }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h3 className="m-0 text-[14.5px] font-semibold leading-tight" style={{ color: LV.t1, letterSpacing: '-0.01em' }}>{children}</h3>
      {right}
    </div>
  );
}

/** Label uppercase 10–11 px (§4 « Label uppercase »). */
export function Label({ children, color = LV.t3, size = 10.5, className = '', style }: {
  children: ReactNode; color?: string; size?: number; className?: string; style?: CSSProperties;
}) {
  return (
    <span className={`font-semibold uppercase ${className}`} style={{ fontSize: size, color, letterSpacing: '0.07em', lineHeight: 1.3, ...style }}>
      {children}
    </span>
  );
}

/** Texte muted 11–12 px (métadonnées, sous-titres). */
export function Muted({ children, color = LV.t3, size = 11.5, className = '', style }: {
  children: ReactNode; color?: string; size?: number; className?: string; style?: CSSProperties;
}) {
  return (
    <span className={className} style={{ fontSize: size, color, lineHeight: 1.35, ...style }}>
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

/** Chiffre KPI (§4 : 640, lettre-espacement serré, chiffres tabulaires). */
export function BigNumber({ value, format, size = 'clamp(26px,3vw,36px)', color = LV.t1 }: {
  value: number; format: (n: number) => string; size?: string; color?: string;
}) {
  const shown = useCountUp(value);
  return (
    <span className="tabular-nums" style={{ fontSize: size, color, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1, display: 'block' }}>
      {format(Math.round(shown))}
    </span>
  );
}

/** Progress bar (§8.3) : piste 6 px arrondie, remplissage rouge ou blanc. */
export function ThinBar({ pct, accent = false, height = 6 }: { pct: number; accent?: boolean; height?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: LV.faint }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${w}%`,
          background: accent ? `linear-gradient(90deg,${LV.red}88,${LV.red})` : `linear-gradient(90deg,${LV.cMid},${LV.cHi})`,
          transition: `width 0.7s ${LV.ease}`,
        }}
      />
    </div>
  );
}

/** Carte imbriquée (§3.2) — un bloc de la colonne droite. */
export function Section({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section
      className={className}
      style={{ background: LV.innerBg, border: `1px solid ${LV.border}`, borderRadius: 14, padding: '16px 18px', ...style }}
    >
      {children}
    </section>
  );
}

/** Tile (§3.3) — un KPI dans une carte imbriquée. */
export function Tile({ children, highlight = false, className = '' }: { children: ReactNode; highlight?: boolean; className?: string }) {
  return (
    <div
      className={`min-w-0 ${className}`}
      style={highlight
        ? { background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.22)', borderRadius: 12, padding: '10px 12px' }
        : { background: LV.tileBg, border: `1px solid ${LV.border}`, borderRadius: 12, padding: '10px 12px' }}
    >
      {children}
    </div>
  );
}

/** Live badge (§7.2) — point vert pulsé. */
export function LiveBadge({ children, paused = false }: { children: ReactNode; paused?: boolean }) {
  const color = paused ? LV.t3 : LV.pos;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-2.5 py-1"
      style={paused
        ? { background: LV.faint, border: `1px solid ${LV.border}` }
        : { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}
    >
      <span className="relative flex h-2 w-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {!paused && <span className="absolute inset-0 h-2 w-2 animate-ping rounded-full opacity-75" style={{ background: color }} />}
      </span>
      <span className="text-[11px] font-semibold uppercase" style={{ color, letterSpacing: '0.07em' }}>{children}</span>
    </span>
  );
}
