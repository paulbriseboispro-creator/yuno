/**
 * Pièces de l'écran Analyses, transposées du design : la carte, les tuiles
 * (étincelle, anneau, barre empilée, jauge horizontale, texte), la courbe à
 * barres ou à aire avec la période d'avant et les envois, la courbe empilée
 * par source, l'anneau des segments, la demi-jauge d'objectif et les courbes
 * de vente d'une soirée. Chaque pièce rejoue son entrée quand `go` repasse à
 * vrai (nouveau filtre, nouvelle mesure).
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING, prefersReducedMotion } from '@/crm/ui/motion';
import { niceTop, COARSE_STEPS } from '@/crm/lib/axis';
import type { CrmFormatters } from '@/crm/i18n';
import type { AnaMeta } from '@/crm/data/analytics';

// ── Mouvement ─────────────────────────────────────────────────────────────

/** Vrai deux images après chaque changement de `key` (et seulement si prêt). */
export function useGo(key: string, ready: boolean): boolean {
  const [go, setGo] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (prefersReducedMotion()) { setGo(true); return; }
    setGo(false);
    if (!ready) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setGo(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [key, ready]);
  return go;
}

/** Apparition d'un contenu prêt : montée de 18 px, flou de 8 px. */
export function fadeIn(rv: boolean, delay = 0): CSSProperties {
  return {
    opacity: rv ? 1 : 0,
    transform: rv ? 'none' : 'translateY(18px)',
    filter: rv ? 'none' : 'blur(8px)',
    transition: `opacity 700ms ${EASE} ${delay}ms,transform 700ms ${EASE} ${delay}ms,filter 700ms ${EASE} ${delay}ms`,
  };
}

// ── Cartes et textes ──────────────────────────────────────────────────────

export const card: CSSProperties = {
  minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18, padding: 24, borderRadius: 28,
  background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)',
};

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px 16px' }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.15 }}>{title}</h2>
        {sub && <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Sk({ h, w = '100%', r = 8, style }: { h: number | string; w?: number | string; r?: number; style?: CSSProperties }) {
  return <div className="yc-skel" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

/** Bandeau « à retenir » : point rouge, phrase, bouton facultatif. */
export function Takeaway({ children, cta, onCta, size = 15 }: { children: ReactNode; cta?: string; onCta?: () => void; size?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)', alignSelf: cta ? 'center' : 'flex-start', marginTop: cta ? 0 : 7 }} />
      <span style={{ flex: '1 1 300px', fontSize: size, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{children}</span>
      {cta && onCta && (
        <Hv
          as="button"
          type="button"
          onClick={onCta}
          style={{ flex: 'none', height: 36, padding: '0 4px 0 14px', border: 0, borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', boxShadow: 'inset 0 0 0 1px var(--red-200)', transition: 'color 140ms' }}
          hover={{ color: 'var(--red-600)' }}
        >
          {cta}
          <span style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={14} stroke={2.4} /></span>
        </Hv>
      )}
    </div>
  );
}

export type NightState = 'tonight' | 'presale' | 'past';
export function StatePill({ state, label }: { state: NightState; label: string }) {
  const c = state === 'tonight' ? ['var(--red-50)', 'var(--red-700)'] : state === 'presale' ? ['var(--amber-50)', 'var(--amber-700)'] : ['var(--sand-100)', 'var(--sand-600)'];
  return <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: c[0], color: c[1], whiteSpace: 'nowrap' }}>{label}</span>;
}

/** Barre de remplissage qui pousse de gauche à droite. */
export function Fill({ pct, go, delay = 0, h = 8, bg = 'var(--gradient-brand)', dur = 900 }: { pct: number; go: boolean; delay?: number; h?: number; bg?: string; dur?: number }) {
  return (
    <span style={{ display: 'block', height: h, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: go ? `${Math.max(0, Math.min(100, pct))}%` : '0%', borderRadius: 99, background: bg, transition: go ? `width ${dur}ms ${EASE} ${delay}ms` : 'none' }} />
    </span>
  );
}

// ── Étincelle (tuiles) ────────────────────────────────────────────────────

export function sparkPaths(a: number[]): { line: string; area: string } {
  const v = a.length > 1 ? a : [a[0] ?? 0, a[0] ?? 0];
  const mn = Math.min(...v); const mx = Math.max(...v); const rg = (mx - mn) || 1;
  const line = 'M' + v.map((x, i) => `${((i / (v.length - 1)) * 100).toFixed(1)} ${(30 - ((x - mn) / rg) * 26).toFixed(1)}`).join(' L');
  return { line, area: `${line} L100 34 L0 34 Z` };
}

// ── Tuiles ────────────────────────────────────────────────────────────────

export type TileSpec =
  | { kind: 'spark'; label: string; value: string; delta?: string; dc?: string; cap: string; values: number[] }
  | { kind: 'ring'; label: string; value: string; delta?: string; dc?: string; cap: string; ring: number }
  | { kind: 'stack'; label: string; value: string; delta?: string; dc?: string; cap: string; parts: { w: number; c: string }[]; legL: string; legR: string }
  | { kind: 'hb'; label: string; value: string; delta?: string; dc?: string; cap: string; hb: number; hbL: string }
  | { kind: 'txt'; label: string; value: string; delta?: string; dc?: string; cap: string; color: string };

export function Tile({ t, i, go, rv }: { t: TileSpec; i: number; go: boolean; rv: boolean }) {
  const dl = i * 90;
  return (
    <Hv
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', minWidth: 0, ...fadeIn(rv, dl), transition: `${fadeIn(rv, dl).transition},box-shadow 160ms,border-color 160ms` }}
      hover={{ borderColor: 'var(--sand-300)', boxShadow: 'var(--shadow-sm)' }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{t.label}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: t.kind === 'txt' ? 30 : 44, lineHeight: 1.15, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t.value}</span>
        {t.kind === 'ring' && (
          <svg viewBox="0 0 42 42" width={58} height={58} style={{ flex: 'none', transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx={21} cy={21} r={15.9155} fill="none" stroke="var(--red-100)" strokeWidth={5} />
            <circle cx={21} cy={21} r={15.9155} fill="none" stroke="var(--red-500)" strokeWidth={5} strokeLinecap="round" strokeDasharray={go ? `${Math.min(100, Math.max(0, t.ring)).toFixed(1)} ${(100 - Math.min(100, Math.max(0, t.ring))).toFixed(1)}` : '0 100'} style={{ transition: `stroke-dasharray 1000ms ${EASE} 200ms` }} />
          </svg>
        )}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: t.dc ?? 'var(--green-700)', minHeight: 18 }}>{t.delta ?? ''}</span>
      {t.kind === 'spark' && (() => {
        const p = sparkPaths(t.values);
        return (
          <div style={{ marginTop: 8, clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? `clip-path 1100ms ${EASE} ${dl + 200}ms` : 'none' }}>
            <svg viewBox="0 0 100 34" width="100%" height={48} preserveAspectRatio="none" aria-hidden>
              <path d={p.area} fill="var(--red-50)" stroke="none" />
              <path d={p.line} fill="none" stroke="var(--red-500)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        );
      })()}
      {t.kind === 'stack' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 99, overflow: 'hidden', clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? `clip-path 1100ms ${EASE} ${dl + 200}ms` : 'none' }}>
            {t.parts.filter((p) => p.w > 0).map((p, k) => <div key={k} style={{ width: `${p.w}%`, background: p.c }} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--sand-500)' }}><span>{t.legL}</span><span>{t.legR}</span></div>
        </div>
      )}
      {t.kind === 'hb' && (
        <div style={{ marginTop: 8 }}>
          <Fill pct={t.hb} go={go} delay={dl + 200} h={12} />
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sand-500)' }}>{t.hbL}</div>
        </div>
      )}
      {t.kind === 'txt' && <div style={{ marginTop: 8, height: 12, borderRadius: 99, background: t.color, boxShadow: 'inset 0 0 0 1px var(--sand-200)' }} />}
      <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', marginTop: 6 }}>{t.cap}</span>
    </Hv>
  );
}

export function TileSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)' }}>
      <Sk h={14} w="45%" /><Sk h={44} w="70%" r={12} /><Sk h={13} w="55%" /><Sk h={44} /><Sk h={12} w="80%" />
    </div>
  );
}

// ── Libellés des cases ───────────────────────────────────────────────────

function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Libellé long d'une case (infobulle). */
export function bucketTitle(meta: AnaMeta, i: number, f: CrmFormatters, jLabel: (k: number) => string): string {
  const raw = meta.labels[i];
  if (!raw) return '';
  if (meta.mode === 'hour') {
    const d = new Date(raw);
    return `${f.dWeek(d)} · ${f.lang === 'en' ? d.toLocaleTimeString(f.locale, { hour: 'numeric' }) : `${d.getHours()} h`}`;
  }
  if (meta.mode === 'month') return parseDay(raw).toLocaleDateString(f.locale, { month: 'long', year: 'numeric' });
  if (meta.mode === 'event') return `${jLabel(meta.n - 1 - i)} · ${f.dWeek(parseDay(raw))}`;
  return f.dWeek(parseDay(raw));
}

/** Cinq repères de l'axe horizontal. */
export function xLabels(meta: AnaMeta, f: CrmFormatters, jLabel: (k: number) => string): string[] {
  return [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const i = Math.round(r * (meta.n - 1));
    const raw = meta.labels[i];
    if (!raw) return '';
    if (meta.mode === 'hour') {
      const d = new Date(raw);
      const h = f.lang === 'en' ? d.toLocaleTimeString(f.locale, { hour: 'numeric' }) : `${d.getHours()} h`;
      return meta.n > 24 ? `${d.toLocaleDateString(f.locale, { weekday: 'short' })} ${h}` : h;
    }
    if (meta.mode === 'month') return parseDay(raw).toLocaleDateString(f.locale, { month: 'short' });
    if (meta.mode === 'event') return jLabel(meta.n - 1 - i);
    return f.dShort(parseDay(raw));
  });
}

/** Repères de l'axe horizontal : trois seulement quand le graphique est étroit. */
export function XAxis({ labels, left }: { labels: string[]; left: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 430));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = narrow && labels.length === 5 ? [labels[0], labels[2], labels[4]] : labels;
  return (
    <div ref={ref} style={{ marginLeft: left, display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>
      {shown.map((x, i) => <span key={i}>{x}</span>)}
    </div>
  );
}

// ── Courbe à barres / à aire ─────────────────────────────────────────────

export interface TrendMark { i: number; title: string }

export function TrendChart({
  kind, cur, prev, showPrev, marks, go, lo = 0, fy, tipTitle, tipValue, tipPrev, xl, height = 300,
}: {
  kind: 'bars' | 'area'; cur: number[]; prev: number[]; showPrev: boolean; marks: TrendMark[]; go: boolean; lo?: number;
  fy: (v: number) => string; tipTitle: (i: number) => string; tipValue: (v: number) => string; tipPrev?: (v: number) => string;
  xl: string[]; height?: number;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const n = cur.length;
  const mx = Math.max(0, ...cur, ...(showPrev ? prev : []));
  const hi = lo ? lo + niceTop(Math.max(1, mx - lo), { headroom: 1.25, empty: 1, steps: COARSE_STEPS }) : niceTop(mx, { headroom: 1.06, empty: 1, steps: COARSE_STEPS });
  const ys = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const xs = (i: number) => ((i + 0.5) / n) * 100;
  const pts = (a: number[]) => a.map((v, i) => `${xs(i).toFixed(2)} ${ys(v).toFixed(2)}`);
  const line = n ? `M${pts(cur).join(' L')}` : '';
  const area = n ? `${line} L${xs(n - 1).toFixed(2)} 100 L${xs(0).toFixed(2)} 100 Z` : '';
  const prevPath = prev.length ? `M${pts(prev).join(' L')}` : '';
  const gap = n > 60 ? 1 : n > 40 ? 3 : n > 14 ? 4 : 10;
  const mk = new Map(marks.map((m) => [m.i, m.title]));
  const cx = hov !== null ? xs(hov) : 0;
  const clip = { clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? `clip-path 1200ms ${EASE}` : 'none' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onMouseLeave={() => setHov(null)} style={{ position: 'relative', height, marginLeft: 60 }}>
        {[0, 0.5, 1].map((q) => (
          <div key={q} style={{ position: 'absolute', left: -60, right: 0, bottom: `${q * 100}%`, height: 0, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, top: -9, width: 52, whiteSpace: 'nowrap', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box' }}>
              {q === 0 && !lo ? '0' : fy(lo + (hi - lo) * q)}
            </span>
          </div>
        ))}
        {kind === 'bars' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap, pointerEvents: 'none' }}>
            {cur.map((v, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ width: '100%', height: `${Math.max(0, ((v - lo) / (hi - lo)) * 100).toFixed(1)}%`, borderRadius: '3px 3px 0 0', background: hov === i ? 'var(--red-700)' : 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 650ms ${EASE} ${Math.min(i * (n > 40 ? 5 : 16), 700)}ms,background 120ms` : 'none' }} />
              </div>
            ))}
          </div>
        )}
        {kind === 'area' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...clip }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <defs><linearGradient id="yc-ana-ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E3141B" stopOpacity=".22" /><stop offset="1" stopColor="#E3141B" stopOpacity="0" /></linearGradient></defs>
              <path d={area} fill="url(#yc-ana-ag)" />
              <path d={line} fill="none" stroke="var(--red-500)" strokeWidth={2.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        )}
        {showPrev && prevPath && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...clip }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <path d={prevPath} fill="none" stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        )}
        {marks.map((m, k) => (
          <div key={k} style={{ position: 'absolute', top: 0, bottom: 0, left: `${xs(m.i).toFixed(2)}%`, width: 0, borderLeft: '1.5px dashed var(--sand-400)', pointerEvents: 'none', opacity: go ? 1 : 0, transition: go ? 'opacity 400ms ease 900ms' : 'none' }}>
            <span title={m.title} style={{ position: 'absolute', top: -5, left: -6, width: 10, height: 10, borderRadius: 99, background: 'var(--ink)', boxShadow: '0 0 0 3px #fff', pointerEvents: 'auto', cursor: 'help' }} />
          </div>
        ))}
        {kind === 'area' && hov !== null && (
          <>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${cx.toFixed(2)}%`, width: 0, borderLeft: '1px solid var(--sand-300)', pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', left: `${cx.toFixed(2)}%`, top: `${ys(cur[hov]).toFixed(2)}%`, width: 12, height: 12, margin: '-6px 0 0 -6px', borderRadius: 99, background: 'var(--red-500)', boxShadow: '0 0 0 3px #fff', pointerEvents: 'none' }} />
          </>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {cur.map((_, i) => <div key={i} onMouseEnter={() => setHov(i)} style={{ flex: 1, minWidth: 0, height: '100%', cursor: 'crosshair' }} />)}
        </div>
        {hov !== null && hov < n && (
          <div style={{ position: 'absolute', top: 6, left: `${cx.toFixed(1)}%`, transform: cx < 55 ? 'translateX(22px)' : 'translateX(calc(-100% - 22px))', pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 3 }}>
            <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tipTitle(hov)}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{tipValue(cur[hov])}</span>
            {showPrev && tipPrev && prev.length > hov && <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tipPrev(prev[hov])}</span>}
            {mk.get(hov) && <span style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: '#FF948D' }}>● {mk.get(hov)}</span>}
          </div>
        )}
      </div>
      <XAxis labels={xl} left={60} />
    </div>
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  const H = [40, 62, 48, 75, 55, 88, 66, 52, 80, 70, 45, 92, 60, 74, 50, 84, 58, 68, 96, 54, 78, 64, 86, 72];
  return (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', gap: 6, paddingLeft: 56 }}>
      {H.map((h, i) => <div key={i} className="yc-skel" style={{ flex: 1, height: `${h}%`, borderRadius: '4px 4px 0 0' }} />)}
    </div>
  );
}

// ── Courbe empilée (Trafic) ──────────────────────────────────────────────

export interface StackSeries { k: string; label: string; c: string; v: number[] }

export function StackChart({
  series, hidden, focus, marks, go, fy, tipTitle, tipValue, xl, height = 300,
}: {
  series: StackSeries[]; hidden: string[]; focus: string | null; marks: TrendMark[]; go: boolean;
  fy: (v: number) => string; tipTitle: (i: number) => string; tipValue: (v: number) => string; xl: string[]; height?: number;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const vis = series.filter((s) => !hidden.includes(s.k));
  const n = series[0]?.v.length ?? 0;
  const stack = Array.from({ length: n }, (_, i) => vis.reduce((a, s) => a + s.v[i], 0));
  const top = niceTop(Math.max(0, ...stack), { headroom: 1.06, empty: 1, steps: COARSE_STEPS });
  const gap = n > 60 ? 1 : n > 40 ? 3 : n > 14 ? 4 : 10;
  const cx = hov !== null ? ((hov + 0.5) / n) * 100 : 0;
  const mk = new Map(marks.map((m) => [m.i, m.title]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onMouseLeave={() => setHov(null)} style={{ position: 'relative', height, marginLeft: 60 }}>
        {[0, 0.5, 1].map((q) => (
          <div key={q} style={{ position: 'absolute', left: -60, right: 0, bottom: `${q * 100}%`, height: 0, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, top: -9, width: 52, whiteSpace: 'nowrap', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box' }}>{q ? fy(top * q) : '0'}</span>
          </div>
        ))}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap }}>
          {stack.map((_, i) => (
            <div key={i} onMouseEnter={() => setHov(i)} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', background: hov === i ? 'rgba(28,21,23,.05)' : 'transparent', cursor: 'crosshair' }}>
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column-reverse', transform: `scaleY(${go ? 1 : 0})`, transformOrigin: 'bottom', transition: go ? `transform 650ms ${EASE} ${Math.min(i * (n > 40 ? 5 : 16), 700)}ms` : 'none' }}>
                {vis.map((s) => <div key={s.k} style={{ flex: 'none', width: '100%', height: `${((s.v[i] / top) * 100).toFixed(2)}%`, background: s.c, opacity: focus && focus !== s.k ? 0.18 : 1, transition: 'opacity 160ms' }} />)}
              </div>
            </div>
          ))}
        </div>
        {marks.map((m, k) => (
          <div key={k} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(((m.i + 0.5) / n) * 100).toFixed(2)}%`, width: 0, borderLeft: '1.5px dashed var(--sand-400)', pointerEvents: 'none', opacity: go ? 1 : 0, transition: go ? 'opacity 400ms ease 900ms' : 'none' }}>
            <span title={m.title} style={{ position: 'absolute', top: -5, left: -6, width: 10, height: 10, borderRadius: 99, background: 'var(--ink)', boxShadow: '0 0 0 3px #fff', pointerEvents: 'auto', cursor: 'help' }} />
          </div>
        ))}
        {hov !== null && hov < n && (
          <div style={{ position: 'absolute', top: 6, left: `${cx.toFixed(1)}%`, transform: cx < 55 ? 'translateX(22px)' : 'translateX(calc(-100% - 22px))', pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 4, whiteSpace: 'nowrap', zIndex: 3, minWidth: 190 }}>
            <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tipTitle(hov)}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{tipValue(stack[hov])}</span>
            {vis.filter((s) => s.v[hov] > 0).map((s) => (
              <span key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: s.c, boxShadow: '0 0 0 1px rgba(255,255,255,.4)' }} />
                <span style={{ flex: 1, color: 'var(--text-on-night-2)' }}>{s.label}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{tipValue(s.v[hov])}</b>
              </span>
            ))}
            {mk.get(hov) && <span style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: '#FF948D' }}>● {mk.get(hov)}</span>}
          </div>
        )}
      </div>
      <XAxis labels={xl} left={60} />
    </div>
  );
}

// ── Anneau des segments ──────────────────────────────────────────────────

export function Donut({ items, active, go, onEnter, onLeave, big, small }: {
  items: { k: string; c: string; v: number }[]; active: string | null; go: boolean;
  onEnter: (k: string) => void; onLeave: () => void; big: string; small: string;
}) {
  const tot = items.reduce((a, x) => a + x.v, 0) || 1;
  let off = 0;
  return (
    <div style={{ position: 'relative', width: 176, height: 176, alignSelf: 'center', flex: 'none' }}>
      <svg viewBox="0 0 42 42" width={176} height={176} style={{ transform: 'rotate(-90deg)', display: 'block' }} aria-hidden>
        <circle cx={21} cy={21} r={15.9155} fill="none" stroke="var(--sand-100)" strokeWidth={5.5} />
        {items.map((it, i) => {
          const share = (it.v / tot) * 100;
          const len = Math.max(0, share - 0.8);
          const o = -off; off += share;
          return (
            <circle
              key={it.k}
              cx={21} cy={21} r={15.9155} fill="none" stroke={it.c}
              strokeWidth={active === it.k ? 7.5 : 5.5}
              strokeDasharray={go ? `${len.toFixed(2)} ${(100 - len).toFixed(2)}` : '0 100'}
              strokeDashoffset={o.toFixed(2)}
              onMouseEnter={() => onEnter(it.k)}
              onMouseLeave={onLeave}
              style={{ opacity: active && active !== it.k ? 0.3 : 1, transition: go ? `stroke-dasharray 900ms ${EASE} ${i * 120}ms,stroke-width 160ms,opacity 160ms` : 'none', cursor: 'pointer' }}
            />
          );
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, letterSpacing: '-.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{big}</span>
          <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{small}</span>
        </div>
      </div>
    </div>
  );
}

// ── Demi-jauge d'objectif ────────────────────────────────────────────────

export function Gauge({ pct, mark, go, big, cap, label }: { pct: number; mark: number | null; go: boolean; big: string; cap: string; label: string }) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 290, alignSelf: 'center', aspectRatio: '260/150' }}>
      <svg viewBox="0 0 260 150" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden>
        <defs><linearGradient id="yc-ana-gg" x1="0" x2="1"><stop offset="0" stopColor="#E3141B" /><stop offset="1" stopColor="#FF6B35" /></linearGradient></defs>
        <path d="M20 135 A110 110 0 0 1 240 135" fill="none" stroke="var(--sand-100)" strokeWidth={18} strokeLinecap="round" />
        <path d="M20 135 A110 110 0 0 1 240 135" fill="none" stroke="url(#yc-ana-gg)" strokeWidth={18} strokeLinecap="round" pathLength={100} strokeDasharray={`${go ? Math.min(100, Math.max(0, pct)).toFixed(1) : '0'} 100`} style={{ transition: `stroke-dasharray 1400ms ${EASE}` }} />
        {mark !== null && (
          <g transform={`rotate(${(Math.min(100, Math.max(0, mark)) * 1.8).toFixed(1)} 130 135)`}>
            <line x1={12} y1={135} x2={36} y2={135} stroke="#1C1517" strokeWidth={2.5} strokeLinecap="round" />
          </g>
        )}
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 40, lineHeight: 1, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{big}<span style={{ fontSize: 18, color: 'var(--sand-500)' }}>{cap ? ` ${cap}` : ''}</span></div>
        <div style={{ fontSize: 12.5, color: 'var(--sand-500)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Courbes de vente d'une soirée ────────────────────────────────────────

export interface CurveLine { name: string; c: string; w: number; dash: string; vals: (number | null)[] }

export function MultiLine({ lines, top, go, fy, tipTitle, tipValue, xl, height = 240 }: {
  lines: CurveLine[]; top: number; go: boolean; fy: (v: number) => string; tipTitle: (i: number) => string;
  tipValue: (v: number) => string; xl: string[]; height?: number;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const n = lines[0]?.vals.length ?? 22;
  const P = (a: (number | null)[]) => {
    const pts = a.map((v, i) => (v === null ? null : `${((i / (n - 1)) * 100).toFixed(2)} ${(100 - (v / top) * 100).toFixed(2)}`)).filter(Boolean);
    return pts.length ? `M${pts.join(' L')}` : '';
  };
  const cx = hov !== null ? (hov / (n - 1)) * 100 : 0;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div ref={ref} onMouseLeave={() => setHov(null)} style={{ position: 'relative', height, marginLeft: 50 }}>
        {[0, 0.5, 1].map((q) => (
          <div key={q} style={{ position: 'absolute', left: -50, right: 0, bottom: `${q * 100}%`, height: 0, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, top: -9, width: 44, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>{fy(top * q)}</span>
          </div>
        ))}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', clipPath: `inset(0 ${go ? '0%' : '101%'} 0 0)`, transition: go ? `clip-path 1300ms ${EASE}` : 'none' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {lines.map((l, k) => <path key={k} d={P(l.vals)} fill="none" stroke={l.c} strokeWidth={l.w} strokeDasharray={l.dash || undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}
          </svg>
        </div>
        {hov !== null && lines.map((l, k) => {
          const v = l.vals[hov];
          if (v === null || v === undefined) return null;
          return <span key={k} style={{ position: 'absolute', left: `${cx.toFixed(2)}%`, top: `${(100 - (v / top) * 100).toFixed(2)}%`, width: 11, height: 11, margin: '-5.5px 0 0 -5.5px', borderRadius: 99, background: l.c, boxShadow: '0 0 0 3px #fff', pointerEvents: 'none' }} />;
        })}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {Array.from({ length: n }, (_, i) => <div key={i} onMouseEnter={() => setHov(i)} style={{ flex: 1, minWidth: 0, height: '100%', cursor: 'crosshair' }} />)}
        </div>
        {hov !== null && (
          <div style={{ position: 'absolute', top: 6, left: `${cx.toFixed(1)}%`, transform: cx < 55 ? 'translateX(20px)' : 'translateX(calc(-100% - 20px))', pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 4, whiteSpace: 'nowrap', zIndex: 3 }}>
            <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tipTitle(hov)}</span>
            {lines.filter((l) => l.vals[hov] !== null && l.vals[hov] !== undefined).map((l, k) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <i style={{ width: 8, height: 8, borderRadius: 99, background: l.c, boxShadow: '0 0 0 1px rgba(255,255,255,.5)' }} />
                <span style={{ color: 'var(--text-on-night-2)' }}>{l.name}</span>
                <b style={{ marginLeft: 'auto', paddingLeft: 12, fontVariantNumeric: 'tabular-nums' }}>{tipValue(l.vals[hov] as number)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <XAxis labels={xl} left={50} />
    </div>
  );
}

// ── Bandeau sombre (« Ce qui a fait vendre », « À réveiller ») ───────────

export const nightCard: CSSProperties = {
  position: 'relative', overflow: 'hidden', isolation: 'isolate', boxSizing: 'border-box', borderRadius: 28, color: 'var(--text-on-night)',
  background: 'radial-gradient(90% 120% at 100% 110%,rgba(227,20,27,.4),transparent 65%),radial-gradient(60% 80% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
};

export function BrandArrowButton({ label, onClick, h = 44 }: { label: string; onClick: () => void; h?: number }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      style={{ flex: 'none', height: h, padding: '0 5px 0 18px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: h > 40 ? 15 : 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', transition: `transform 200ms ${SPRING},filter 160ms` }}
      hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
      active={{ transform: 'scale(.97)' }}
    >
      {label}
      <span style={{ width: h - 10, height: h - 10, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
    </Hv>
  );
}
