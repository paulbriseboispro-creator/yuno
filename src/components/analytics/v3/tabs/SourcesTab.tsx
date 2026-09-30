/**
 * Sources (spec §4.3) : le tunnel horizontal (page club → page soirée → billet
 * choisi → checkout → payé → scanné) avec la chute à chaque étape, le tableau
 * par source (visites, acheteurs, conversion, CA, CA par visiteur), l'encart
 * « Ce que Yuno t'a apporté ». Visites = mesure d'audience anonyme, exemptée ;
 * ventes = attribution FIGÉE sur la vente au paiement.
 */
import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Sources, cardState, type An3Subject } from '@/hooks/useAn3';
import type { An3Scope, An3Sources } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { deliverCsv } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card } from '../an3Ui';
import { A3 } from '../an3Tokens';
import { KpiCard } from '../KpiCard';
import { sourceLabel } from '../an3Labels';

export function SourcesTab({ scope, subject, registerExport }: { scope: An3Scope; subject: An3Subject; registerExport: (fn: (() => void) | null) => void }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Sources(scope, subject);
  const data = q.data;
  const money = data?.money ?? false;

  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      const header = [t('an3.col.source'), t('an3.col.visits'), t('an3.col.visitors'), t('an3.col.orders'), t('an3.col.buyers'), t('an3.col.conversion'), ...(money ? [t('an3.col.revenue'), t('an3.col.revenuePerVisitor')] : [])];
      void deliverCsv('analytics-sources', header, data.sources.map((s) => [sourceLabel(t, s.source), s.sessions, s.visitors, s.orders, s.buyers, s.conversion, ...(money ? [s.revenue, s.revenue_per_visitor] : [])]));
    });
    return () => registerExport(null);
  }, [data, money, registerExport, t]);

  const top = data?.sources.filter((s) => s.orders > 0).slice(0, 1)[0];
  const topVisits = data?.sources.slice().sort((a, b) => b.sessions - a.sessions)[0];

  return (
    <div className="flex flex-col gap-4">
      <A3Card title={t('an3.src.funnel')} hint={t('an3.src.funnelHint')} state={cardState(q, (d) => d.funnel.some((s) => s.n > 0))} minHeight={200}
        empty={{ title: t('an3.src.funnelEmpty'), body: t('an3.src.funnelEmptyBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
        {data && <Funnel data={data} />}
        {data && <p className="m-0 mt-3 text-[11.5px]" style={{ color: A3.t3 }}>{t('an3.src.exemptNote')}</p>}
      </A3Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <A3Card title={t('an3.src.bySource')} hint={t('an3.src.bySourceHint')} state={cardState(q, (d) => d.sources.length > 0)} minHeight={260}
          empty={{ title: t('an3.src.noSources'), body: t('an3.src.noSourcesBody') }}>
          {data && (
            <>
              {(top || topVisits) && (
                <A3Answer>
                  {top && money && top.revenue != null && data.totals.revenue ? t('an3.src.topSales').replace('{source}', sourceLabel(t, top.source)).replace('{pct}', pct((top.revenue / data.totals.revenue) * 100, locale)) : top ? t('an3.src.topOrders').replace('{source}', sourceLabel(t, top.source)).replace('{n}', compactNumber(top.orders, locale)) : ''}
                  {topVisits && data.totals.sessions >= 10 && ` ${t('an3.src.topVisits').replace('{source}', sourceLabel(t, topVisits.source)).replace('{pct}', pct((topVisits.sessions / data.totals.sessions) * 100, locale))}`}
                </A3Answer>
              )}
              <div className="overflow-x-auto -mx-1 mt-2">
                <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead><tr>
                    {[t('an3.col.source'), t('an3.col.visits'), t('an3.col.buyers'), t('an3.col.conversion'), ...(money ? [t('an3.col.revenue'), t('an3.col.revenuePerVisitor')] : [])].map((h, i) => (
                      <th key={h} className={`py-2 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {data.sources.map((s) => (
                      <tr key={s.source}>
                        <td className="py-2.5 px-1.5" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{sourceLabel(t, s.source)}{s.signups > 0 && <span className="block text-[11px]" style={{ color: A3.t3 }}>{t('an3.src.signups').replace('{n}', compactNumber(s.signups, locale))}</span>}</td>
                        <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: s.sessions ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{s.sessions ? compactNumber(s.sessions, locale) : '—'}</td>
                        <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactNumber(s.buyers, locale)}<span className="text-[11px]" style={{ color: A3.t3 }}> · {compactNumber(s.orders, locale)}</span></td>
                        <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: s.conversion != null ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{s.conversion != null ? pct(s.conversion, locale) : '—'}</td>
                        {money && <td className="py-2.5 px-1.5 text-right tabular-nums font-semibold" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactMoney(s.revenue, locale)}</td>}
                        {money && <td className="py-2.5 px-1.5 text-right tabular-nums" style={{ color: s.revenue_per_visitor != null ? A3.t1 : A3.t3, borderBottom: `1px solid ${A3.faint}` }}>{s.revenue_per_visitor != null ? compactMoney(s.revenue_per_visitor, locale) : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="m-0 mt-2 text-[11px]" style={{ color: A3.t3 }}>{t('an3.src.attributionNote')}</p>
            </>
          )}
        </A3Card>

        <A3Card title={t('an3.src.yuno')} hint={t('an3.src.yunoHint')} state={cardState(q, () => true)} minHeight={260}>
          {data && (
            <div className="flex flex-col gap-3">
              <A3Answer>{data.yuno.orders > 0
                ? t('an3.src.yunoSentence').replace('{orders}', compactNumber(data.yuno.orders, locale)).replace('{new}', compactNumber(data.yuno.new_customers, locale))
                : t('an3.src.yunoNone')}</A3Answer>
              <div className="grid grid-cols-2 gap-2">
                <KpiCard spec={{ key: 'yv', label: t('an3.src.yunoVisits'), value: data.yuno.visits, reference: null, format: 'n', polarity: 'up' }} />
                <KpiCard spec={{ key: 'yo', label: t('an3.col.orders'), value: data.yuno.orders, reference: null, format: 'n', polarity: 'up', sub: data.totals.orders >= 10 ? t('an3.src.shareOfOrders').replace('{pct}', pct((data.yuno.orders / data.totals.orders) * 100, locale)) : undefined }} />
                {money && <KpiCard spec={{ key: 'yr', label: t('an3.kpi.revenue'), value: data.yuno.revenue, reference: null, format: 'money', polarity: 'up' }} />}
                <KpiCard spec={{ key: 'yn', label: t('an3.src.yunoNew'), hint: t('an3.src.yunoNewHint'), value: data.yuno.new_customers, reference: null, format: 'n', polarity: 'up' }} />
              </div>
            </div>
          )}
        </A3Card>
      </div>
    </div>
  );
}

function Funnel({ data }: { data: An3Sources }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const steps = data.funnel;
  const max = Math.max(...steps.map((s) => s.n), 1);
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].n : null;
        const rate = prev && prev > 0 ? (s.n / prev) * 100 : null;
        return (
          <div key={s.step} className="min-w-0 flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] truncate" style={{ color: A3.t3 }}>{t(`an3.src.step.${s.step}`)}</span>
            <span className="tabular-nums text-[18px] sm:text-[22px] font-semibold leading-none" style={{ color: A3.t1 }}>{compactNumber(s.n, locale)}</span>
            <div className="h-16 sm:h-20 w-full rounded-md overflow-hidden flex items-end" style={{ background: A3.faint }} aria-hidden="true">
              <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (s.n / max) * 100)}%`, background: i === steps.length - 1 ? A3.ref : A3.accent }} />
            </div>
            <span className="text-[11px] tabular-nums" style={{ color: A3.t3 }}>
              {i === 0 ? t('an3.src.start') : rate != null && prev !== null && prev >= 10 && rate <= 100 ? t('an3.src.ofPrevious').replace('{pct}', pct(rate, locale)) : s.step === 'event_page' ? t('an3.src.directArrivals') : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
