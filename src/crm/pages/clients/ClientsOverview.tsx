/**
 * Haut de l'écran Clients : « Votre base de clients » (total, courbe des 30
 * jours, répartition par cycle de vie, endormis) et trois chiffres —
 * joignables, reviennent, dépense moyenne — chacun avec son lien vers la liste.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { clamp01, reveal, wipe } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { ClientsOverview as Overview, Lifecycle } from '@/crm/data/clients';
import { LIFECYCLE_COLOR } from '@/crm/lib/lifecycle';

export function ClientsOverview({
  data, intro, cc, onSeg, onUnreachable, onOnce, onSpend,
}: {
  data: Overview;
  intro: boolean;
  cc: number;
  onSeg: (s: Lifecycle) => void;
  onUnreachable: () => void;
  onOnce: () => void;
  onSpend: () => void;
}) {
  const { t, n, pct, eur, n1, time, locale } = useCrmT();
  const [wh, setWh] = useState<Lifecycle | null>(null);
  const [sh, setSh] = useState<number | null>(null);
  const tot = Math.max(1, data.total);
  const rules = data.rules;
  const segs: Lifecycle[] = (['hab', 'occ', 'nou', 'end', 'none'] as Lifecycle[]).filter((k) => k !== 'none' || data.lifecycle.none > 0);
  const def = (k: Lifecycle) => t(`yc.cli.seg.${k}.def`, { n: rules.min_nights, m: k === 'end' ? rules.lapse_months : rules.window_months });

  // Courbe des 30 jours.
  const ser = data.spark.length ? data.spark : [data.total];
  const spn = ser.length;
  const lo = Math.min(...ser);
  const hi = Math.max(...ser);
  const sx = (i: number) => (i / Math.max(1, spn - 1)) * 100;
  const sy = (v: number) => 36 - ((v - lo) / Math.max(1, hi - lo + 2)) * 32;
  const spPath = 'M' + ser.map((v, i) => `${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' L');
  let spTip: null | { left: string; top: string; tx: string; date: string; v: string } = null;
  if (sh !== null) {
    const d = new Date(); d.setDate(d.getDate() - (spn - 1 - sh));
    spTip = {
      left: `${sx(sh).toFixed(1)}%`, top: `${((sy(ser[sh]) / 40) * 100).toFixed(1)}%`,
      tx: sh < spn * 0.65 ? 'translateX(-12px)' : 'translateX(calc(-100% + 12px))',
      date: d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
      v: t('yc.cli.base.sparkV', { n: n(ser[sh]) }),
    };
  }

  const reachPct = Math.round((data.reachable / tot) * 100);
  const ret = data.returning_pct;
  const retPrev = data.prev?.returning_pct ?? null;
  const retD = ret !== null && retPrev !== null ? ret - retPrev : null;
  const sp = data.avg_spend;
  const spPrev = data.prev?.avg_spend ?? null;
  const spD = sp !== null && spPrev !== null ? sp - spPrev : null;
  const G = 'var(--green-700)';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
      <Hv
        as="section"
        style={{
          flex: '1.8 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28,
          background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff',
          boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', ...reveal(intro, 380),
        }}
        hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' }}
      >
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.cli.base.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.cli.base.sub', { time: time(data.updated_at) })}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 32px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '4px 20px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,7vw,96px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(data.total * clamp01(cc))}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6 }}>
              <span style={{ fontSize: 17, fontWeight: 600, color: data.today ? G : 'var(--sand-500)' }}>{data.today ? t('yc.cli.base.today', { n: n(data.today) }) : t('yc.cli.base.noneToday')}</span>
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.cli.base.month', { n: n(data.month) })}</span>
            </div>
          </div>
          <div
            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(spn - 1, Math.round(((e.clientX - r.left) / r.width) * (spn - 1)))); if (sh !== i) setSh(i); }}
            onMouseLeave={() => setSh(null)}
            style={{ position: 'relative', flex: '0 1 240px', minWidth: 160, height: 72, cursor: 'crosshair' }}
          >
            <svg viewBox="0 0 100 40" width="100%" height="72" preserveAspectRatio="none" aria-label={t('yc.cli.base.sparkAria')} role="img" style={{ display: 'block', clipPath: wipe(clamp01(cc * 1.15)) }}>
              <path d={`${spPath} L100 40 L0 40 Z`} fill="var(--red-50)" />
              <path d={spPath} fill="none" stroke="var(--red-500)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {spTip && (
              <>
                <i style={{ position: 'absolute', left: spTip.left, top: spTip.top, width: 10, height: 10, margin: '-5px 0 0 -5px', borderRadius: 99, background: 'var(--red-500)', boxShadow: '0 0 0 4px rgba(227,20,27,.18)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: 80, left: spTip.left, transform: spTip.tx, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 1, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 3 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{spTip.date}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{spTip.v}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.cli.base.where')}</span>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.cli.base.whereHint')}</span>
          </div>
          <div style={{ display: 'flex', height: 16, gap: 3, borderRadius: 99, overflow: 'hidden', clipPath: wipe(clamp01(cc * 1.2)) }}>
            {segs.filter((k) => data.lifecycle[k] > 0).map((k) => (
              <Hv
                key={k}
                as="button"
                type="button"
                onClick={() => onSeg(k)}
                onMouseEnter={() => setWh(k)}
                onMouseLeave={() => setWh(null)}
                aria-label={`${t(`yc.cli.seg.${k}`)} : ${n(data.lifecycle[k])}`}
                title={`${t(`yc.cli.seg.${k}`)} : ${n(data.lifecycle[k])}`}
                style={{ flex: `${data.lifecycle[k]} 1 0`, minWidth: 6, height: '100%', border: 0, padding: 0, background: k === 'none' ? 'var(--sand-200)' : LIFECYCLE_COLOR[k], opacity: wh && wh !== k ? 0.35 : 1, cursor: 'pointer', transition: 'opacity 160ms,filter 160ms' }}
                hover={{ filter: 'brightness(.94)' }}
              />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 6 }}>
            {segs.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onSeg(k)}
                onMouseEnter={() => setWh(k)}
                onMouseLeave={() => setWh(null)}
                style={{
                  textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', border: 0, borderRadius: 16,
                  background: wh === k ? 'var(--sand-50)' : 'transparent', opacity: wh && wh !== k ? 0.55 : 1, cursor: 'pointer',
                  transition: 'background 160ms,opacity 160ms,translate 220ms cubic-bezier(.22,1,.36,1)', translate: wh === k ? '0 -2px' : '0 0',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: k === 'none' ? 'var(--sand-200)' : LIFECYCLE_COLOR[k], display: 'inline-block' }} />
                  {t(`yc.cli.seg.${k}`)}
                </span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{n(data.lifecycle[k] * clamp01(cc))}</span>
                  <span style={{ fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{pct(Math.round((data.lifecycle[k] / tot) * 100))}</span>
                </span>
                <span style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--sand-500)' }}>{def(k)}</span>
              </button>
            ))}
          </div>
        </div>

        {data.lifecycle.end > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
            <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
            <span style={{ flex: '1 1 280px', fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>
              {t('yc.cli.dormant', { n: n(data.lifecycle.end), m: rules.lapse_months, r: n(data.end_reachable) })}
            </span>
            <Hv as="button" type="button" onClick={() => onSeg('end')} style={{ flex: 'none', border: 0, background: 'none', padding: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--red-700)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>
              {t('yc.cli.dormantCta')}<Icon name="arrowRight" size={15} stroke={2.4} />
            </Hv>
          </div>
        )}
      </Hv>

      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Kpi intro={intro} delay={480} label={t('yc.cli.kpi.reach')}
          value={pct(Math.round(reachPct * cc))}
          ring={reachPct * 3.6 * cc}
          delta={t('yc.cli.kpi.reachOf', { a: n(data.reachable), b: n(data.total) })} deltaColor={G}
          def={t('yc.cli.kpi.reachDef')}
          cta={data.unreachable > 0 ? t('yc.cli.kpi.reachCta', { n: n(data.unreachable) }) : null} onCta={onUnreachable}
        />
        <Kpi intro={intro} delay={570} label={t('yc.cli.kpi.return')}
          value={ret === null ? '—' : pct(Math.round(ret * cc))}
          delta={retD === null ? '' : Math.abs(retD) < 0.05 ? t('yc.cli.kpi.returnFlat') : retD > 0 ? t('yc.cli.kpi.returnUp', { pts: n1(Math.abs(retD)) }) : t('yc.cli.kpi.returnDown', { pts: n1(Math.abs(retD)) })}
          deltaColor={retD !== null && retD < 0 ? 'var(--red-600)' : retD !== null && Math.abs(retD) >= 0.05 ? G : 'var(--sand-500)'}
          def={t('yc.cli.kpi.returnDef')}
          cta={data.once > 0 ? t('yc.cli.kpi.returnCta') : null} onCta={onOnce}
        />
        <Kpi intro={intro} delay={660} label={t('yc.cli.kpi.spend')}
          value={sp === null ? '—' : eur(sp * cc)}
          delta={spD === null ? '' : Math.abs(spD) < 0.5 ? t('yc.cli.kpi.spendFlat') : spD > 0 ? t('yc.cli.kpi.spendUp', { v: eur(Math.abs(spD)) }) : t('yc.cli.kpi.spendDown', { v: eur(Math.abs(spD)) })}
          deltaColor={spD !== null && spD < -0.5 ? 'var(--red-600)' : spD !== null && Math.abs(spD) >= 0.5 ? G : 'var(--sand-500)'}
          def={t('yc.cli.kpi.spendDef')}
          cta={sp !== null ? t('yc.cli.kpi.spendCta') : null} onCta={onSpend}
        />
      </div>
    </div>
  );
}

function Kpi({
  intro, delay, label, value, ring, delta, deltaColor, def, cta, onCta,
}: {
  intro: boolean; delay: number; label: string; value: string; ring?: number; delta: string; deltaColor: string; def: string; cta: string | null; onCta: () => void;
}) {
  return (
    <Hv
      style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', ...reveal(intro, delay) }}
      hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {ring !== undefined && (
          <div style={{ position: 'relative', flex: 'none', width: 52, height: 52, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${ring.toFixed(1)}deg,var(--red-100) 0)` }}>
            <span style={{ position: 'absolute', inset: 8, borderRadius: '50%', background: '#fff' }} />
          </div>
        )}
      </div>
      {delta && <span style={{ fontSize: 13, fontWeight: 600, color: deltaColor }}>{delta}</span>}
      <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)' }}>{def}</span>
      {cta && (
        <Hv as="button" type="button" onClick={onCta} style={{ alignSelf: 'flex-start', marginTop: 4, border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>
          {cta}<Icon name="arrowRight" size={14} stroke={2.4} />
        </Hv>
      )}
    </Hv>
  );
}
