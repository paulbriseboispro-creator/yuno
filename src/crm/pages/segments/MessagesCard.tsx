/**
 * « Ce que rapportent vos messages » : ventes attribuées sur la période (achat
 * dans les 7 jours après un clic), comparées à la période précédente, la
 * courbe jour par jour avec les envois, les quatre étapes (reçus → cliqué →
 * billetterie → acheté) et le constat qui compare les segments.
 */
import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/crm/ui/kit';
import { clamp01, reveal, wipe } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { SegPeriod, SegmentsOverview } from '@/crm/data/segments';
import { PERIODS, rate, ratePct } from './segFormat';

export function MessagesCard({
  data, period, setPeriod, intro, cc, busy, insight, onCompare,
}: {
  data: SegmentsOverview;
  period: SegPeriod;
  setPeriod: (p: SegPeriod) => void;
  intro: boolean;
  cc: number;
  busy: boolean;
  insight: string | null;
  onCompare: () => void;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, pct, locale } = T;
  const [sh, setSh] = useState<number | null>(null);
  const tot = data.totals;
  const ser = data.series;
  const np = ser.length;
  const mx = Math.max(1, ...ser.map((x) => x.v));
  const sx = (i: number) => (np <= 1 ? 50 : (i / (np - 1)) * 100);
  const sy = (v: number) => 36 - (v / mx) * 32;
  const spPath = np ? 'M' + ser.map((x, i) => `${sx(i).toFixed(1)} ${sy(x.v).toFixed(1)}`).join(' L') : '';
  const showMarks = period === '30d';
  const on = t(`yc.seg.on.${period}`);

  const dl = tot.prev_revenue > 0 ? tot.revenue / tot.prev_revenue - 1 : null;
  const hDelta = !tot.has_prev || dl === null
    ? t('yc.seg.msg.noPrev')
    : t(dl >= 0 ? 'yc.seg.msg.up' : 'yc.seg.msg.down', { pct: pct(Math.abs(dl) * 100), vs: t(`yc.seg.vs.${period}`) });
  const hDeltaFg = !tot.has_prev || dl === null ? 'var(--sand-500)' : dl >= 0 ? 'var(--green-700)' : 'var(--sand-600)';

  const label = (i: number) => {
    const d = new Date(ser[i].t);
    if (data.step_days === 1) return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    if (data.step_days === 7) return t('yc.seg.msg.tipWeek', { date: d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) });
    return new Date(d.getTime() + 15 * 86_400_000).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  };
  const tip = sh !== null && ser[sh] ? {
    left: `${sx(sh).toFixed(1)}%`, top: `${((sy(ser[sh].v) / 40) * 100).toFixed(1)}%`,
    tx: sh < np * 0.6 ? 'translateX(-12px)' : 'translateX(calc(-100% + 12px))',
    date: label(sh), v: eur(ser[sh].v),
    send: ser[sh].sends.length ? t('yc.seg.msg.tipSend', { name: ser[sh].sends[0] + (ser[sh].sends.length > 1 ? ` +${ser[sh].sends.length - 1}` : '') }) : '',
  } : null;
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(np - 1, Math.round(((e.clientX - r.left) / r.width) * (np - 1))));
    if (sh !== i) setSh(i);
  };

  const fun = [
    { l: t('yc.seg.f.received'), v: tot.received, w: tot.received ? 1 : 0, pc: tp('yc.seg.f.sends', tot.sends, { n: n(tot.sends), on }), d: t('yc.seg.f.receivedDef') },
    { l: t('yc.seg.f.clicked'), v: tot.clicked, w: rate(tot.clicked, tot.received), pc: t('yc.seg.f.clickedPct', { pct: ratePct(pct, tot.clicked, tot.received) }), d: t('yc.seg.f.clickedDef') },
    { l: t('yc.seg.f.ticketing'), v: tot.ticketing, w: rate(tot.ticketing, tot.received), pc: t('yc.seg.f.ticketingPct', { pct: ratePct(pct, tot.ticketing, tot.clicked) }), d: t('yc.seg.f.ticketingDef') },
    { l: t('yc.seg.f.bought'), v: tot.bought, w: rate(tot.bought, tot.received), pc: t('yc.seg.f.boughtPct', { pct: ratePct(pct, tot.bought, tot.ticketing) }), d: t('yc.seg.f.boughtDef') },
  ];

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', ...reveal(intro, 380) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 24px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.seg.msg.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 560, textWrap: 'pretty' }}>{t('yc.seg.msg.sub')}</div>
        </div>
        <Segmented value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t(`yc.seg.per.${p}`) }))} ariaLabel={t('yc.seg.period')} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 32px', opacity: busy ? 0.55 : 1, transition: 'opacity 160ms' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '4px 20px' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(48px,6vw,84px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{eur(tot.revenue * clamp01(cc))}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6 }}>
            <span style={{ fontSize: 17, fontWeight: 600, color: hDeltaFg }}>{hDelta}</span>
            <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{tp('yc.seg.msg.buyers', tot.buyers, { n: n(tot.buyers), on })}</span>
          </div>
        </div>
        <div style={{ flex: '1 1 340px', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div onMouseMove={move} onMouseLeave={() => setSh(null)} style={{ position: 'relative', height: 84, cursor: 'crosshair' }}>
            <svg viewBox="0 0 100 40" width="100%" height="84" preserveAspectRatio="none" aria-label={t('yc.seg.msg.chartAria')} role="img" style={{ display: 'block', clipPath: wipe(clamp01(cc * 1.15)) }}>
              <path d={`${spPath} L100 40 L0 40 Z`} fill="var(--red-50)" />
              <path d={spPath} fill="none" stroke="var(--red-500)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {showMarks && ser.map((x, i) => (x.sends.length ? (
              <i key={i} style={{ position: 'absolute', left: `${sx(i).toFixed(1)}%`, top: `${((sy(x.v) / 40) * 100).toFixed(1)}%`, width: 7, height: 7, margin: '-3.5px 0 0 -3.5px', borderRadius: 99, background: 'var(--ink)', boxShadow: '0 0 0 2px #fff', pointerEvents: 'none', opacity: clamp01((cc - (i / np) * 0.8) * 4) }} />
            ) : null))}
            {tip && (
              <>
                <i style={{ position: 'absolute', left: tip.left, top: tip.top, width: 10, height: 10, margin: '-5px 0 0 -5px', borderRadius: 99, background: 'var(--red-500)', boxShadow: '0 0 0 4px rgba(227,20,27,.18)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: 92, left: tip.left, transform: tip.tx, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 3 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tip.date}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{tip.v}</span>
                  {tip.send && <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{tip.send}</span>}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: 'var(--sand-500)' }}>
            <span>{t(`yc.seg.from.${period}`)}</span>
            {showMarks && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--ink)', display: 'inline-block' }} />{t('yc.seg.msg.sendDot')}</span>}
            <span>{t('yc.seg.today')}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 12, opacity: busy ? 0.55 : 1, transition: 'opacity 160ms' }}>
        {fun.map((f, i) => (
          <div key={f.l} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', borderRadius: 20, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{f.l}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{n(f.v * clamp01(cc * 1.1))}</span>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
              <div style={{ width: `${(f.w * 100 * clamp01(cc * 1.2 - i * 0.08)).toFixed(1)}%`, height: '100%', borderRadius: 99, background: 'var(--gradient-brand)' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{f.pc}</span>
            <span style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--sand-500)', textWrap: 'pretty' }}>{f.d}</span>
          </div>
        ))}
      </div>

      {insight && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
          <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
          <span style={{ flex: '1 1 280px', fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{insight}</span>
          <Hv as="button" type="button" onClick={onCompare} style={{ flex: 'none', border: 0, background: 'none', padding: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--red-700)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>
            {t('yc.seg.ins.cta')}<Icon name="arrowRight" size={15} stroke={2.4} />
          </Hv>
        </div>
      )}
    </section>
  );
}
