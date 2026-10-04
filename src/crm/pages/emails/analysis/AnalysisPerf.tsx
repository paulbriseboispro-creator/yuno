/**
 * Analyse › Performance : la courbe campagne par campagne (ouvertures, clics
 * ou achats pour 1 000), sa tendance, le classement des campagnes qui vendent
 * et les résultats par type d'e-mail (modèle de départ).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Segmented } from '@/crm/ui/kit';
import { EASE, clamp01, useProgress, wipe } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { niceTop } from '@/crm/lib/axis';
import { venueAt } from '@/crm/lib/emailTemplates';
import { kindStats, metricOf, trend, type Campaign, type Metric } from '@/crm/lib/emailAnalysis';
import { box, h2, subCss } from './analysisUi';

export function AnalysisPerf({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <Curve campaigns={campaigns} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <Ranking campaigns={campaigns} />
        <Kinds campaigns={campaigns} />
      </div>
    </div>
  );
}

function Curve({ campaigns }: { campaigns: Campaign[] }) {
  const { t, tp, n, n1, pct, dShort } = useCrmT();
  const narrow = useNarrow(640);
  const [metric, setMetric] = useState<Metric>('or');
  const [hov, setHov] = useState<number | null>(null);
  const g = useProgress(1200, 450, metric);
  const N = campaigns.length;
  const vals = campaigns.map((c) => metricOf(c, metric));
  const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, N);
  const tr = trend(vals);
  const fmt = (v: number) => (metric === 'bp' ? n1(v) : pct(v * 100, metric === 'cr' ? 1 : 0));
  const top = metric === 'bp' ? niceTop(Math.max(...vals, 0), { empty: 10 }) : Math.min(1, niceTop(Math.max(...vals, 0) * 100, { empty: 100 }) / 100);
  const px = (i: number) => ((i + 0.5) / N) * 100;
  const py = (v: number) => 100 - (v / top) * 100;
  const line = `M${vals.map((v, i) => `${px(i).toFixed(2)} ${py(v).toFixed(2)}`).join(' L')}`;
  const area = `${line} L${px(N - 1).toFixed(2)} 100 L${px(0).toFixed(2)} 100 Z`;
  // Les dates sous la courbe : une sur deux (ou trois) quand elles se serrent.
  const every = Math.max(1, Math.ceil(N / (narrow ? 4 : 12)));

  return (
    <section style={{ ...box, gap: 16, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.06),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={h2}>{t('yc.em.an.p.t')}</h2><div style={subCss}>{t('yc.em.an.p.s')}</div></div>
        <Segmented<Metric> value={metric} onChange={(m) => { setMetric(m); setHov(null); }} ariaLabel={t('yc.em.an.p.metric')} options={(['or', 'cr', 'bp'] as const).map((m) => ({ value: m, label: t(`yc.em.an.p.m.${m}`) }))} />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: '4px 18px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(48px,6vw,80px)', lineHeight: 0.92, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{fmt(avg * (metric === 'bp' ? 1 : g))}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6 }}>
          {tr === null
            ? <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--sand-500)' }}>{t('yc.em.an.p.noTrend')}</span>
            : <span style={{ fontSize: 16, fontWeight: 600, color: tr >= 0 ? 'var(--green-700)' : 'var(--red-600)' }}>{t(tr >= 0 ? 'yc.em.an.p.up' : 'yc.em.an.p.down', { p: pct(Math.abs(tr) * 100) })}</span>}
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t(`yc.em.an.p.def.${metric}`)} {tp('yc.em.an.p.avg', N, { n: n(N) })}</span>
        </div>
      </div>
      <div style={{ position: 'relative', height: 230, marginLeft: 56 }} onMouseLeave={() => setHov(null)}>
        {[0, 0.5, 1].map((r) => (
          <div key={r} style={{ position: 'absolute', left: -56, right: 0, bottom: `${r * 100}%`, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, top: -9, width: 48, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box' }}>{r === 0 ? '0' : metric === 'bp' ? n(top * r) : pct(top * r * 100)}</span>
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', clipPath: wipe(clamp01(g * 1.15)) }}>
          <path d={area} fill="var(--red-50)" />
          <path d={line} fill="none" stroke="var(--red-500)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {campaigns.map((c, i) => {
          const on = hov === i;
          const sz = on ? 16 : 10;
          const top = `${py(vals[i] * clamp01(g * 1.2 - 0.1)).toFixed(1)}%`;
          return (
            <Link
              key={c.id}
              to={CRM_ROUTES.emailResults(c.id)}
              onMouseEnter={() => setHov(i)}
              onFocus={() => setHov(i)}
              onBlur={() => setHov(null)}
              aria-label={c.name ?? c.subject ?? ''}
              className="yc-focus-ring"
              style={{ position: 'absolute', left: `${px(i).toFixed(2)}%`, top: 0, bottom: 0, width: `${(100 / N).toFixed(2)}%`, transform: 'translateX(-50%)', display: 'block', zIndex: on ? 3 : 1 }}
            >
              <i style={{ position: 'absolute', left: '50%', top, width: sz, height: sz, margin: `${-sz / 2}px 0 0 ${-sz / 2}px`, borderRadius: 99, background: on ? 'var(--red-600)' : 'var(--red-500)', boxShadow: `0 0 0 ${on ? 6 : 0}px rgba(227,20,27,.18),0 0 0 2px #fff`, transition: 'width 140ms,height 140ms,margin 140ms,box-shadow 140ms' }} />
              {on && (
                <span style={{ position: 'absolute', top: `calc(${top} - 14px)`, left: '50%', transform: `translate(${px(i) < 18 ? '-12%' : px(i) > 82 ? '-88%' : '-50%'},-100%)`, pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 3 }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{dShort(c.sent_at)}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.subject}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{metric === 'bp' ? t('yc.em.an.p.perK', { v: n1(vals[i]) }) : fmt(vals[i])}</span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <div style={{ marginLeft: 56, display: 'flex' }}>
        {campaigns.map((c, i) => (
          <span key={c.id} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'visible' }}>
            {(N - 1 - i) % every === 0 ? dShort(c.sent_at) : ''}
          </span>
        ))}
      </div>
    </section>
  );
}

function Ranking({ campaigns }: { campaigns: Campaign[] }) {
  const { t, tp, n, n1, dShort } = useCrmT();
  const g = useProgress(1100, 300, campaigns.length);
  const rank = useMemo(() => campaigns.slice().sort((a, b) => metricOf(b, 'bp') - metricOf(a, 'bp')), [campaigns]);
  const top = Math.max(0.0001, metricOf(rank[0], 'bp'));
  const shown = rank.slice(0, 8);
  return (
    <section style={{ ...box, flex: '1.2 1 460px', gap: 14, padding: 'clamp(20px,2.4vw,26px)' }}>
      <div><h2 style={h2}>{t('yc.em.an.r.t')}</h2><div style={subCss}>{t('yc.em.an.r.s')}</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.map((c, i) => {
          const v = metricOf(c, 'bp');
          return (
            <Hv
              as={Link}
              key={c.id}
              to={CRM_ROUTES.emailResults(c.id)}
              style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1.3fr) minmax(0,1fr) 54px', gap: 12, alignItems: 'center', padding: '10px 12px', margin: '0 -12px', borderRadius: 14, color: 'var(--ink)', textDecoration: 'none' }}
              hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--sand-400)' }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.subject}</b>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.em.an.r.meta', c.n, { date: dShort(c.sent_at), n: n(c.n) })}</span>
              </span>
              <div style={{ height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <div style={{ width: `${(v / top) * 100 * clamp01(g * 1.4 - i * 0.07)}%`, height: '100%', borderRadius: 99, background: i === 0 ? 'var(--gradient-brand)' : 'var(--red-200)' }} />
              </div>
              <b style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{n1(v)}</b>
            </Hv>
          );
        })}
      </div>
      {rank.length > shown.length && (
        <Hv as={Link} to={`${CRM_ROUTES.emailCampaigns}?s=sent`} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.em.an.r.more')} →</Hv>
      )}
    </section>
  );
}

function Kinds({ campaigns }: { campaigns: Campaign[] }) {
  const { t, tp, n, n1, pct, lang } = useCrmT();
  const { space } = useCrmScope();
  const g = useProgress(1100, 380, campaigns.length);
  const kinds = useMemo(() => kindStats(campaigns), [campaigns]);
  const top = Math.max(0.0001, kinds[0]?.perK ?? 0);
  const label = (k: string) => (k === 'autre' ? t('yc.em.an.k.autre') : t(`yc.em.tp.${k}.name`, { at: venueAt(space.name, lang), venue: space.name }));
  return (
    <section style={{ ...box, flex: '1 1 380px', gap: 14, padding: 'clamp(20px,2.4vw,26px)' }}>
      <div><h2 style={h2}>{t('yc.em.an.k.t')}</h2><div style={subCss}>{t('yc.em.an.k.s')}</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {kinds.map((k, i) => (
          <div key={k.kind} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 18, background: i === 0 ? 'var(--red-50)' : 'var(--paper)', boxShadow: `inset 0 0 0 1px ${i === 0 ? 'var(--red-200)' : 'var(--sand-100)'}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <b style={{ fontSize: 15 }}>{label(k.kind)}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{tp('yc.em.an.k.n', k.campaigns, { n: n(k.campaigns) })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <div style={{ width: `${(k.perK / top) * 100 * clamp01(g * 1.4 - i * 0.1)}%`, height: '100%', borderRadius: 99, background: i === 0 ? 'var(--gradient-brand)' : 'var(--red-200)' }} />
              </div>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t('yc.em.an.k.v', { v: n1(k.perK) })}</b>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.an.k.rates', { o: pct(k.open * 100), c: pct(k.click * 100) })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
