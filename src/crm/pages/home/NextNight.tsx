/**
 * Prochaine soirée (bloc nuit de l'accueil) : places vendues sur la jauge,
 * ventes du jour, courbe des 8 derniers jours comparée à la soirée précédente
 * au même J-N, projection ; et « Qui achète ? » (habitués, occasionnels,
 * nouveaux) en anneau.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { ArrowLink } from '@/crm/ui/kit';
import { clamp01, reveal, SPRING, wipe } from '@/crm/ui/motion';
import { Rich } from '@/crm/ui/Rich';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import type { CrmHome } from '@/crm/data/home';
import { CRM_ROUTES } from '@/crm/shell/nav';

type Next = NonNullable<CrmHome['next']>;

function niceStep(range: number): number {
  const raw = range / 3;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export function NextNightCard({ next, intro, cc }: { next: Next; intro: boolean; cc: number }) {
  const { t, n, pct, time, dLong, dShort, locale } = useCrmT();
  const { space } = useCrmScope();
  const [hi, setHi] = useState<number | null>(null);
  const cap = next.left !== null ? next.sold + next.left : null;
  const curve = next.curve;
  const N = curve.length;
  const hasPrev = !!next.prev && curve.some((p) => p.prev !== null);
  const vals = curve.flatMap((p) => [p.cur, ...(hasPrev && p.prev !== null ? [p.prev] : [])]);
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals, vmin + 1);
  const step = niceStep(vmax - vmin);
  const lo = Math.max(0, Math.floor((vmin - step * 0.15) / step) * step);
  const hiV = Math.max(vmax + step * 0.15, lo + step * 3);
  const X = (i: number) => (i / Math.max(1, N - 1)) * 280;
  const Y = (v: number) => 160 - ((v - lo) / (hiV - lo)) * 150;
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const cur = curve.map((p) => p.cur);
  const prev = curve.map((p) => p.prev ?? 0);
  const ntCur = line(cur);
  const ntPrev = hasPrev ? line(prev) : '';
  const gapFill = hasPrev ? `${ntCur} ${prev.map((_, i) => `L${X(N - 1 - i).toFixed(1)} ${Y(prev[N - 1 - i]).toFixed(1)}`).join(' ')} Z` : '';
  const ticks = [0, 1, 2].map((k) => lo + step * (k + 1)).filter((v) => v < hiV);
  const last = N - 1;
  const gap = hasPrev ? cur[last] - prev[last] : 0;
  const ahead = gap >= 0;
  const endY = Y(cur[last]);
  const markO = clamp01((cc - 0.75) / 0.25);

  const prevSame = hasPrev ? prev[last] : 0;
  const finalPrev = next.prev?.final ?? 0;
  let proj = prevSame > 0 ? Math.round((next.sold * finalPrev) / prevSame) : null;
  if (proj !== null && cap !== null) proj = Math.min(proj, cap);
  const aheadPct = prevSame > 0 ? Math.round(((next.sold - prevSame) / prevSame) * 100) : null;

  const chip = next.days_to <= 0 ? t('yc.home.next.tonight', { time: time(next.start_at) })
    : next.days_to === 1 ? t('yc.home.next.tomorrow', { time: time(next.start_at) })
      : t('yc.home.next.inDays', { n: next.days_to, time: time(next.start_at) });

  let insight = '';
  if (!hasPrev || proj === null || aheadPct === null) insight = t('yc.home.next.insightFirst');
  else if (aheadPct > 0) insight = t('yc.home.next.insightAhead', { pct: pct(aheadPct), proj: n(proj) });
  else if (aheadPct < 0) insight = t('yc.home.next.insightBehind', { pct: pct(-aheadPct), proj: n(proj) });
  else insight = t('yc.home.next.insightEven', { proj: n(proj) });

  let tip: null | { left: string; yCur: string; yPrev: string; tx: string; date: string; v: string; p: string; d: string; dc: string } = null;
  if (hi !== null && curve[hi]) {
    const k = hi;
    const isLast = k === last;
    const dl = cur[k] - prev[k];
    tip = {
      left: `${((k / Math.max(1, last)) * 100).toFixed(2)}%`,
      yCur: `${Y(cur[k]).toFixed(1)}px`,
      yPrev: `${Y(prev[k]).toFixed(1)}px`,
      tx: k < N / 2 ? 'translateX(18px)' : 'translateX(calc(-100% - 18px))',
      date: isLast ? `${t('yc.home.next.today2')} · ${time(new Date())}` : new Date(`${curve[k].day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
      v: t('yc.home.next.places', { n: n(cur[k]) }),
      p: hasPrev && next.prev ? t('yc.home.next.prevAt', { title: next.prev.title, date: dShort(next.prev.start_at), n: n(prev[k]) }) : '',
      d: hasPrev ? t('yc.home.next.sameMoment', { sign: dl >= 0 ? '▲ +' : '▼ −', n: n(Math.abs(dl)) }) : '',
      dc: dl >= 0 ? '#1F8F4E' : 'var(--red-600)',
    };
  }

  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  return (
    <Hv
      as="section"
      style={{
        flex: '1.6 1 640px', minWidth: 0, position: 'relative', overflow: 'hidden', isolation: 'isolate', display: 'flex', flexWrap: 'wrap',
        gap: '24px 36px', padding: 28, borderRadius: 28, color: 'var(--text-on-night)',
        background: 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.4),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', ...reveal(intro, 620),
      }}
      hover={{ translate: '0 -4px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.12),0 24px 48px -16px rgba(227,20,27,.35)' }}
    >
      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.home.next.label')}</span>
          <span style={{ height: 26, padding: '0 12px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,.08)', boxShadow: 'inset 0 0 0 1px var(--border-night)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--tangerine-500)' }} />{chip}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', lineHeight: 1.05 }}>{next.title}</span>
          <span style={{ fontSize: 14.5, color: 'var(--text-on-night-2)' }}>{[space.name, dLong(next.start_at)].join(' · ')}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 10px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 80, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{n(next.sold * cc)}</span>
            <span style={{ fontSize: 16, color: 'var(--text-on-night-2)' }}>{cap !== null ? t('yc.home.next.ofPlaces', { n: n(cap) }) : t('yc.home.next.placesSold')}</span>
          </div>
          {cap !== null && cap > 0 && (
            <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}>
              <div style={{ width: `${((next.sold / cap) * 100 * cc).toFixed(1)}%`, height: '100%', borderRadius: 99, background: 'var(--gradient-brand)' }} />
            </div>
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: next.today > 0 ? '#7CE0A2' : 'var(--text-on-night-2)' }}>
            {next.today > 0 ? t('yc.home.next.today', { n: n(next.today) }) : t('yc.home.next.noneToday')}
          </span>
        </div>
      </div>

      <div style={{ flex: '1.2 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative', height: 170, padding: '0 52px 0 32px' }}>
            <div
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const i = Math.max(0, Math.min(last, Math.round(((e.clientX - r.left) / r.width) * last)));
                if (hi !== i) setHi(i);
              }}
              onMouseLeave={() => setHi(null)}
              style={{ position: 'relative', height: 170, cursor: 'crosshair' }}
            >
              <div style={{ position: 'absolute', inset: 0, clipPath: wipe(clamp01(cc * 1.15)) }}>
                <svg viewBox="0 0 280 170" width="100%" height="170" style={{ display: 'block', overflow: 'visible' }} preserveAspectRatio="none" role="img" aria-label={t('yc.home.next.chartAria')}>
                  <path d={ticks.map((v) => `M0 ${Y(v).toFixed(1)} H280`).join(' ')} stroke="rgba(255,255,255,.12)" strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" />
                  {hasPrev && <path d={gapFill} fill={ahead ? 'rgba(124,224,162,.3)' : 'rgba(255,148,141,.28)'} />}
                  {hasPrev && <path d={ntPrev} fill="none" stroke="rgba(255,255,255,.6)" strokeWidth={1.6} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
                  <path d={ntCur} fill="none" stroke="#fff" strokeWidth={2.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </div>
              {ticks.map((v) => (
                <span key={v} style={{ position: 'absolute', left: -32, top: Y(v) - 6, fontSize: 11, color: 'var(--text-on-night-2)', pointerEvents: 'none' }}>{n(v)}</span>
              ))}
              <i style={{ position: 'absolute', right: -5, top: endY, width: 10, height: 10, marginTop: -5, borderRadius: 99, background: '#fff', pointerEvents: 'none', opacity: markO }} />
              {tip && (
                <>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: tip.left, width: 0, borderLeft: '1px solid rgba(255,255,255,.45)', pointerEvents: 'none', transition: 'left 90ms linear' }} />
                  {hasPrev && <i style={{ position: 'absolute', left: tip.left, top: tip.yPrev, width: 10, height: 10, margin: '-5px 0 0 -5px', borderRadius: 99, background: '#2a1a17', border: '2px solid rgba(255,255,255,.7)', pointerEvents: 'none', transition: 'left 90ms linear,top 90ms linear' }} />}
                  <i style={{ position: 'absolute', left: tip.left, top: tip.yCur, width: 14, height: 14, margin: '-7px 0 0 -7px', borderRadius: 99, background: '#fff', boxShadow: '0 0 0 5px rgba(255,255,255,.22)', pointerEvents: 'none', transition: 'left 90ms linear,top 90ms linear' }} />
                  <div style={{ position: 'absolute', top: -6, left: tip.left, transform: tip.tx, pointerEvents: 'none', zIndex: 3, background: '#fff', color: 'var(--ink)', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{tip.date}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.1 }}>{tip.v}</span>
                    {tip.p && <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{tip.p}</span>}
                    {tip.d && <span style={{ fontSize: 12.5, fontWeight: 600, color: tip.dc }}>{tip.d}</span>}
                  </div>
                </>
              )}
            </div>
            {hasPrev && (
              <>
                <div style={{ position: 'absolute', right: 34, top: Math.min(endY, Y(prev[last])), width: 10, height: Math.max(2, Math.abs(endY - Y(prev[last]))), border: `2px solid ${ahead ? '#7CE0A2' : '#FF948D'}`, borderLeft: 0, borderRadius: '0 2px 2px 0', pointerEvents: 'none', opacity: markO }} />
                <span style={{ position: 'absolute', right: 0, top: endY, marginTop: -2, fontSize: 15, fontWeight: 700, color: ahead ? '#7CE0A2' : '#FF948D', pointerEvents: 'none', opacity: markO, lineHeight: '16px', whiteSpace: 'nowrap' }}>
                  {gap >= 0 ? '+' : '−'}{n(Math.abs(gap))}
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 52px 0 32px', fontSize: 11.5, color: 'var(--text-on-night-2)' }}>
            <span>{curve[0] ? dayLabel(curve[0].day) : ''}</span>
            <span>{next.days_to <= 0 ? t('yc.common.tonight') : t('yc.home.next.today2')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--text-on-night-2)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 3, borderRadius: 2, background: '#fff', display: 'inline-block' }} />{t('yc.home.next.thisNight')}</span>
          {hasPrev && next.prev && (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 0, borderTop: '2px dashed rgba(255,255,255,.5)', display: 'inline-block' }} />{t('yc.home.next.prevLegend', { title: next.prev.title, date: dShort(next.prev.start_at) })}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 8, borderRadius: 2, background: ahead ? 'rgba(124,224,162,.45)' : 'rgba(255,148,141,.45)', display: 'inline-block' }} />{t(ahead ? 'yc.home.next.ahead' : 'yc.home.next.behind')}</span>
            </>
          )}
        </div>
      </div>
      <div style={{ flex: '1 1 100%', minWidth: 0, display: 'flex', alignItems: 'center', padding: '14px 18px', borderRadius: 16, background: 'rgba(255,255,255,.07)', boxShadow: 'inset 0 0 0 1px var(--border-night)' }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}><Rich text={insight} /></p>
      </div>
    </Hv>
  );
}

export function WhoBuysCard({ next, intro, cc, minNights }: { next: Next; intro: boolean; cc: number; minNights: number }) {
  const { t, n, pct } = useCrmT();
  const [dh, setDh] = useState<number | null>(null);
  const b = next.buyers;
  const tot = Math.max(1, b.total);
  const DS = [
    { l: t('yc.home.who.regulars'), v: b.regulars, sub: t('yc.home.who.regularsSub', { n: minNights }), c: 'var(--red-500)', dim: 'color-mix(in srgb,var(--red-500) 28%,#fff)' },
    { l: t('yc.home.who.occasional'), v: b.occasional, sub: t('yc.home.who.occasionalSub', { n: minNights }), c: 'var(--tangerine-500)', dim: 'color-mix(in srgb,var(--tangerine-500) 28%,#fff)' },
    { l: t('yc.home.who.new'), v: b.new, sub: t('yc.home.who.newSub'), c: 'var(--red-100)', dim: 'var(--red-50)' },
  ];
  const shares = DS.map((d) => d.v / tot);
  // Pourcentages qui tombent à 100 (le plus gros reste prend l'arrondi).
  const raw = shares.map((s) => s * 100);
  const floors = raw.map(Math.floor);
  let rest = (b.total ? 100 : 0) - floors.reduce((a, x) => a + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, z) => z[0] - a[0]);
  const pcts = [...floors];
  for (const [, i] of order) { if (rest <= 0) break; pcts[i] += 1; rest -= 1; }
  const A = shares[0] * 360;
  const B = A + shares[1] * 360;
  const sel = dh !== null;
  const empty = b.total === 0;

  const pt = (r: number, a: number) => `${(74 + r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(74 - r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
  const arcs: [number, number][] = [[0, A], [A, B], [B, 359.99]];
  const arcPath = (a0: number, a1: number) => {
    const RO = 73; const RI = 49; const large = a1 - a0 > 180 ? 1 : 0;
    return `M${pt(RO, a0)} A${RO} ${RO} 0 ${large} 1 ${pt(RO, a1)} L${pt(RI, a1)} A${RI} ${RI} 0 ${large} 0 ${pt(RI, a0)} Z`;
  };

  const kNew = Math.round(shares[2] * 10);
  const kReg = Math.round(shares[0] * 10);
  const insight = empty ? t('yc.home.who.empty')
    : shares[2] >= 0.3 ? t('yc.home.who.insightNew', { k: kNew })
      : shares[0] >= 0.4 ? t('yc.home.who.insightRegulars', { k: kReg })
        : t('yc.home.who.insightMix');
  const cta = shares[2] >= 0.3 || empty ? 'welcome' : 'thanks';

  return (
    <Hv
      as="section"
      style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: 24, borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...reveal(intro, 700) }}
      hover={{ translate: '0 -4px', boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' }}
    >
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.home.who.title')}</h2>
        <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.home.who.sub', { n: n(b.total), title: next.title })}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 24px' }}>
        <div
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
            const rn = Math.hypot(dx, dy) / (r.width / 2);
            let h: number | null = null;
            if (!empty && rn >= 0.62 && rn <= 1) { const ang = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360; h = ang < A ? 0 : ang < B ? 1 : 2; }
            if (dh !== h) setDh(h);
          }}
          onMouseLeave={() => setDh(null)}
          style={{
            position: 'relative', flex: 'none', width: 148, height: 148, borderRadius: '50%',
            background: empty ? 'var(--sand-100)' : `conic-gradient(${!sel || dh === 0 ? DS[0].c : DS[0].dim} 0 ${(A * cc).toFixed(1)}deg,${!sel || dh === 1 ? DS[1].c : DS[1].dim} 0 ${(B * cc).toFixed(1)}deg,${!sel || dh === 2 ? DS[2].c : DS[2].dim} 0)`,
            transform: `scale(${sel ? 1.05 : 1})`, transition: `transform 240ms ${SPRING}`,
          }}
        >
          <span style={{ position: 'absolute', inset: 26, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{sel ? n(DS[dh].v) : n(b.total * cc)}</span>
              <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1, color: 'var(--sand-500)' }}>{sel ? DS[dh].l : t('yc.home.who.buyers')}</span>
            </span>
          </span>
          {sel && (
            <svg viewBox="0 0 148 148" width={148} height={148} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
              <path d={arcPath(arcs[dh][0], arcs[dh][1])} fill="none" stroke="var(--red-400)" strokeWidth={2} strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <div style={{ flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14.5 }}>
          {DS.map((d, i) => (
            <div
              key={i}
              onMouseEnter={() => setDh(i)}
              onMouseLeave={() => setDh(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', margin: '0 -10px', borderRadius: 12,
                background: dh === i ? 'var(--sand-50)' : 'transparent', opacity: sel && dh !== i ? 0.45 : 1, translate: dh === i ? '4px 0' : '0 0',
                transition: 'background 160ms,opacity 160ms,translate 220ms cubic-bezier(.22,1,.36,1)', cursor: 'default',
              }}
            >
              <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: d.c, boxShadow: i === 2 ? 'inset 0 0 0 1px var(--red-200)' : 'none' }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: dh === i ? 600 : 400 }}>{d.l}</span>
                <span style={{ fontSize: 12.5, lineHeight: '16px', color: 'var(--sand-500)', maxHeight: dh === i ? 18 : 0, opacity: dh === i ? 1 : 0, overflow: 'hidden', transition: 'max-height 220ms,opacity 220ms' }}>{d.sub}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{empty ? '—' : pct(pcts[i])}</b>
                <span style={{ fontSize: 12.5, lineHeight: '16px', color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums', maxHeight: dh === i ? 18 : 0, opacity: dh === i ? 1 : 0, overflow: 'hidden', transition: 'max-height 220ms,opacity 220ms' }}>{t('yc.home.who.nBuyers', { n: n(d.v) })}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-700)' }}><Rich text={insight} /></p>
      <div style={{ marginTop: 'auto' }}>
        <ArrowLink to={`${CRM_ROUTES.emailTemplates}?start=${cta}`} size={15}>{t(cta === 'welcome' ? 'yc.home.who.ctaWelcome' : 'yc.home.who.ctaThanks')}</ArrowLink>
      </div>
    </Hv>
  );
}
