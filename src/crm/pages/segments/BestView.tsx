/**
 * Vue « Qui répond le mieux » : un classement des segments sur une mesure
 * (cliquent, vont en billetterie, achètent, rapportent), puis la matrice
 * étape par étape, chaque case teintée selon la meilleure de sa colonne.
 */
import { useState } from 'react';
import { Segmented } from '@/crm/ui/kit';
import { EASE, clamp01, useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { MsgStats, SegPeriod } from '@/crm/data/segments';
import { rate, ratePct } from './segFormat';
import type { SegVM } from './vm';

type Metric = 'click' | 'ticketing' | 'buy' | 'sales';
const METRICS: Metric[] = ['click', 'ticketing', 'buy', 'sales'];

const valueOf = (m: Metric, x: MsgStats) => (m === 'click' ? rate(x.clicked, x.received)
  : m === 'ticketing' ? rate(x.ticketing, x.received)
    : m === 'buy' ? rate(x.bought, x.received) : x.revenue);

export function BestView({ segs, period, onOpen }: { segs: SegVM[]; period: SegPeriod; onOpen: (key: string) => void }) {
  const T = useCrmT();
  const { t, n, eur, pct } = T;
  const [metric, setMetric] = useState<Metric>('click');
  const [hov, setHov] = useState<string | null>(null);
  const kk = useProgress(800, 0, metric);
  const withS = segs.filter((s) => s.msg.received > 0).sort((a, b) => valueOf(metric, b.msg) - valueOf(metric, a.msg));
  const noS = segs.filter((s) => s.msg.received === 0);
  const maxV = Math.max(1e-9, ...withS.map((s) => valueOf(metric, s.msg)));
  const fmtV = (v: number, s: SegVM) => (metric === 'sales' ? eur(v) : metric === 'click' ? ratePct(pct, s.msg.clicked, s.msg.received)
    : metric === 'ticketing' ? ratePct(pct, s.msg.ticketing, s.msg.received) : ratePct(pct, s.msg.bought, s.msg.received));
  const colMax = (f: (x: MsgStats) => number) => Math.max(1e-9, ...withS.map((s) => f(s.msg)));
  const mC = colMax((x) => rate(x.clicked, x.received));
  const mT = colMax((x) => rate(x.ticketing, x.received));
  const mB = colMax((x) => rate(x.bought, x.received));
  const heat = (v: number, m: number) => `rgba(227,20,27,${(0.04 + 0.2 * (v / m)).toFixed(3)})`;
  const on = t(`yc.seg.on.${period}`);

  const bar = (s: SegVM, has: boolean) => {
    const v = has ? valueOf(metric, s.msg) : 0;
    return (
      <button
        key={s.key}
        type="button"
        onClick={() => onOpen(s.key)}
        onMouseEnter={() => setHov(s.key)}
        onMouseLeave={() => setHov(null)}
        style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,210px) minmax(0,1fr) 120px', alignItems: 'center', gap: 16, padding: '10px 12px', border: 0, borderRadius: 16, background: hov === s.key ? 'var(--sand-50)' : 'transparent', opacity: hov && hov !== s.key ? 0.5 : has ? 1 : 0.8, textAlign: 'left', cursor: 'pointer', transition: 'background 160ms,opacity 160ms', color: 'var(--ink)' }}
      >
        <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: s.color }} />
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{has ? t('yc.seg.rep.recv', { n: n(s.msg.received) }) : t('yc.seg.rep.noSend', { on })}</span>
          </span>
        </span>
        <span style={{ height: 14, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
          <i style={{ display: 'block', width: has ? `${((v / maxV) * 100 * clamp01(kk * 1.15)).toFixed(1)}%` : '0%', height: '100%', borderRadius: 99, background: has && v === maxV ? 'var(--gradient-brand)' : 'var(--ink)' }} />
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: has ? 'var(--ink)' : 'var(--sand-400)' }}>{has ? fmtV(v, s) : '—'}</span>
      </button>
    );
  };

  const cell = (v: string, bg?: string, fw?: number) => (
    <span style={{ height: 48, borderRadius: 12, background: bg || 'var(--sand-50)', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 14.5, fontWeight: fw || 500, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{v}</span>
  );
  const MXCOLS = 'minmax(180px,1.6fr) repeat(6,minmax(0,1fr))';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(18px,2.2vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 20px' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t(`yc.seg.m.${metric}.t`)}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 560, textWrap: 'pretty' }}>{t(`yc.seg.m.${metric}.s`)}</div>
          </div>
          <Segmented<Metric> value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: t(`yc.seg.m.${m}.l`) }))} ariaLabel={t('yc.seg.tab.rep')} />
        </div>
        {withS.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '28px 8px', textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.seg.rep.empty', { on })}</span>
            <span style={{ fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.seg.rep.emptyHint')}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {withS.map((s) => bar(s, true))}
            {noS.map((s) => bar(s, false))}
          </div>
        )}
        <span style={{ fontSize: 13, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.seg.rep.note')}</span>
      </section>

      {withS.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(18px,2.2vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.seg.mx.title')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.seg.mx.sub')}</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: MXCOLS, gap: 6, padding: '0 4px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
                <span>{t('yc.seg.col.segment')}</span><span>{t('yc.seg.mx.messages')}</span><span>{t('yc.seg.mx.click')}</span><span>{t('yc.seg.mx.ticketing')}</span>
                <span>{t('yc.seg.mx.buy')}</span><span>{t('yc.seg.mx.sales')}</span><span>{t('yc.seg.mx.basket')}</span>
              </div>
              {withS.map((s, i) => {
                const x = s.msg;
                return (
                  <button key={s.key} type="button" onClick={() => onOpen(s.key)} style={{ display: 'grid', gridTemplateColumns: MXCOLS, gap: 6, alignItems: 'stretch', padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', animation: `yc-rise 460ms ${EASE} both`, animationDelay: `${i * 40}ms` }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', fontSize: 14.5, fontWeight: 600, minWidth: 0 }}>
                      <i style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: s.color }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    </span>
                    {cell(n(x.received))}
                    {cell(ratePct(pct, x.clicked, x.received), heat(rate(x.clicked, x.received), mC), 600)}
                    {cell(ratePct(pct, x.ticketing, x.received), heat(rate(x.ticketing, x.received), mT), 600)}
                    {cell(ratePct(pct, x.bought, x.received), heat(rate(x.bought, x.received), mB), 600)}
                    {cell(eur(x.revenue))}
                    {cell(x.buyers ? eur(x.revenue / x.buyers) : '—')}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
