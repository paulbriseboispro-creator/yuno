/**
 * Courbe des ventes d'une soirée, jour par jour (maquette : trait rouge plein,
 * aire rouge pâle, « la fois d'avant » en pointillé, jauge de capacité en
 * tirets, bulle au survol). Les jours sont comptés avant la soirée, dans son
 * fuseau : deux soirées se comparent au même J-N.
 */
import { useState } from 'react';
import { useCrmT } from '@/crm/i18n';
import type { NightDetail } from '@/crm/data/nights';

export function SalesCurve({
  detail, progress, height = 150, showCapLabel = true,
}: { detail: NightDetail; progress: number; height?: number; showCapLabel?: boolean }) {
  const { t, n, locale } = useCrmT();
  const [hi, setHi] = useState<number | null>(null);
  const pts = detail.curve.length === 1 ? [detail.curve[0], detail.curve[0]] : detail.curve;
  const N = pts.length;
  if (!N) return null;
  const hasPrev = !!detail.prev && pts.some((p) => p.pv !== null);
  const peak = Math.max(1, ...pts.map((p) => Math.max(p.v, p.pv ?? 0)));
  const top = detail.cap && detail.cap >= peak ? detail.cap : peak * 1.12;
  const X = (i: number) => (N === 1 ? 50 : (i / (N - 1)) * 100);
  const Y = (v: number) => 37 - Math.min(1, v / top) * 31;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join(' ');
  const cur = path(pts.map((p) => p.v));
  const prev = hasPrev ? path(pts.map((p) => p.pv ?? 0)) : '';
  const capY = detail.cap && detail.cap >= peak ? Y(detail.cap) : null;
  const clip = `inset(-10% ${((1 - progress) * 100).toFixed(1)}% -10% 0)`;

  // Jour réel d'un point : jour de la soirée (fuseau) − d.
  const dayOf = (d: number) => {
    const ev = new Intl.DateTimeFormat('en-CA', { timeZone: detail.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(detail.start_at));
    const ms = Date.parse(ev + 'T12:00:00Z') - d * 86_400_000;
    return new Date(ms).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  };

  const tip = hi !== null && pts[hi] ? {
    left: `${X(hi).toFixed(2)}%`,
    top: `${((Y(pts[hi].v) / 40) * 100).toFixed(1)}%`,
    tx: hi > (N - 1) * 0.6 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
    date: dayOf(pts[hi].d),
    v: n(pts[hi].v),
    pv: hasPrev && pts[hi].pv !== null ? n(pts[hi].pv) : null,
  } : null;

  return (
    <div
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHi(Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * (N - 1)))));
      }}
      onMouseLeave={() => setHi(null)}
      style={{ position: 'relative', height, cursor: 'crosshair' }}
    >
      <svg viewBox="0 0 100 40" width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={t('yc.ni.curve.aria')} style={{ display: 'block', overflow: 'visible' }}>
        {capY !== null && <line x1="0" x2="100" y1={capY} y2={capY} stroke="var(--sand-300)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        <g style={{ clipPath: clip }}>
          {hasPrev && <path d={prev} fill="none" stroke="var(--sand-400)" strokeWidth={1.6} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          <path d={`${cur} L100 40 L0 40 Z`} fill="var(--red-50)" />
          <path d={cur} fill="none" stroke="var(--red-500)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      </svg>
      {showCapLabel && capY !== null && detail.cap && (
        <span style={{ position: 'absolute', right: 0, top: `${((capY / 40) * 100).toFixed(1)}%`, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--sand-400)', textTransform: 'uppercase', letterSpacing: '.06em', transform: 'translateY(calc(-100% - 4px))', pointerEvents: 'none' }}>
          {t('yc.ni.curve.cap', { n: n(detail.cap) })}
        </span>
      )}
      {tip && (
        <>
          <i style={{ position: 'absolute', left: tip.left, top: tip.top, width: 10, height: 10, margin: '-5px 0 0 -5px', borderRadius: 99, background: 'var(--red-500)', boxShadow: '0 0 0 4px rgba(227,20,27,.18)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, left: tip.left, transform: tip.tx, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 3 }}>
            <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tip.date}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{t('yc.ni.curve.tipV', { n: tip.v })}</span>
            {tip.pv !== null && <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{t('yc.ni.curve.tipPrev', { n: tip.pv })}</span>}
          </div>
        </>
      )}
    </div>
  );
}
