/**
 * Audience (spec §4.4, phase 1) : nouveaux vs habitués par soirée, taux de
 * retour, top clients, âge, genre, villes — cellules < 10 masquées.
 */
import { useEffect } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Audience, cardState, type An3Subject } from '@/hooks/useAn3';
import type { An3Scope } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { deliverCsv } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card, A3Swatch } from '../an3Ui';
import { A3, CHART_H, TOOLTIP_STYLE } from '../an3Tokens';
import { HBarList } from '../charts/HBarList';
import { KpiCard } from '../KpiCard';
import { CohortsCard, RfmCard } from '../IntelligenceCards';

export function AudienceTab({ scope, subject, registerExport, campaignsHref }: {
  scope: An3Scope; subject: An3Subject; registerExport: (fn: (() => void) | null) => void; campaignsHref?: string;
}) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Audience(scope, subject);
  const data = q.data;
  const money = data?.money ?? false;
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      const header = [t('an3.col.night'), t('an3.col.date'), t('an3.col.customers'), t('an3.aud.new'), t('an3.aud.returning')];
      void deliverCsv('analytics-audience', header, data.per_night.map((n) => [n.title, n.start_at.slice(0, 10), n.customers, n.new_customers, n.returning]));
    });
    return () => registerExport(null);
  }, [data, registerExport, t]);

  const k = data?.k ?? 10;
  const masked = t('an3.aud.masked').replace('{k}', String(k));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <A3Card title={t('an3.aud.newVsReturning')} hint={t('an3.aud.newVsReturningHint')} state={cardState(q, (d) => d.per_night.some((n) => n.customers > 0))} minHeight={CHART_H + 120}
          empty={{ title: t('an3.empty.noNightsTitle'), body: t('an3.empty.noNightsBody') }} error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }}>
          {data && (
            <>
              <A3Answer>{data.totals.customers >= k
                ? t('an3.aud.sentence').replace('{pct}', pct((data.totals.new_customers / data.totals.customers) * 100, locale)).replace('{n}', compactNumber(data.totals.customers, locale))
                : t('an3.aud.smallBase').replace('{n}', String(data.totals.customers))}</A3Answer>
              <div style={{ height: CHART_H }} className="w-full min-w-0 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.per_night.map((n) => ({ ...n, label: dateFmt.format(new Date(n.start_at)) }))} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <XAxis dataKey="label" tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: A3.faint }} labelFormatter={(_, p) => (p?.[0]?.payload as { title?: string })?.title ?? ''}
                      formatter={(v: number, name: string) => [String(v), name === 'new_customers' ? t('an3.aud.new') : t('an3.aud.returning')]} />
                    <Bar dataKey="returning" stackId="a" fill={A3.ref} isAnimationActive={false} />
                    <Bar dataKey="new_customers" stackId="a" fill={A3.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 mt-2"><A3Swatch color={A3.accent}>{t('an3.aud.new')}</A3Swatch><A3Swatch color={A3.ref}>{t('an3.aud.returning')}</A3Swatch></div>
            </>
          )}
        </A3Card>

        <A3Card title={t('an3.aud.return')} hint={t('an3.aud.returnHint')} state={cardState(q, () => true)} minHeight={CHART_H + 120}>
          {data && (
            <div className="grid grid-cols-2 gap-2">
              <KpiCard spec={{ key: 'ret', label: t('an3.aud.return'), value: data.return_90d.rate, reference: null, format: 'pct', polarity: 'up', sub: t('an3.aud.returnSub').replace('{r}', compactNumber(data.return_90d.returning, locale)).replace('{n}', compactNumber(data.return_90d.customers, locale)) }} />
              <KpiCard spec={{ key: 'cust', label: t('an3.kpi.customers'), value: data.totals.customers, reference: null, format: 'n', polarity: 'up', sub: t('an3.aud.buyersSub').replace('{n}', compactNumber(data.totals.buyers, locale)) }} />
              <KpiCard spec={{ key: 'new', label: t('an3.aud.new'), value: data.totals.new_customers, reference: null, format: 'n', polarity: 'neutral' }} />
              <KpiCard spec={{ key: 'old', label: t('an3.aud.returning'), value: data.totals.customers - data.totals.new_customers, reference: null, format: 'n', polarity: 'up' }} />
            </div>
          )}
        </A3Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <A3Card title={t('an3.aud.age')} hint={t('an3.aud.ageHint')} state={cardState(q, (d) => d.age.known >= k)} minHeight={220}
          empty={{ title: t('an3.aud.ageEmpty'), body: t('an3.aud.ageEmptyBody').replace('{k}', String(k)) }}>
          {data && <HBarList rows={data.age.bands.map((b) => ({ key: b.band, label: t(`an3.aud.band.${b.band}`), value: b.n ?? 0, display: b.masked ? masked : compactNumber(b.n ?? 0, locale), masked: b.masked }))} limit={5} />}
        </A3Card>
        <A3Card title={t('an3.aud.gender')} hint={t('an3.aud.genderHint')} state={cardState(q, (d) => d.gender.known >= k)} minHeight={220}
          empty={{ title: t('an3.aud.genderEmpty'), body: t('an3.aud.genderEmptyBody') }}>
          {data && <HBarList rows={data.gender.rows.map((g) => ({ key: g.gender, label: t(`an3.aud.g.${g.gender}`) === `an3.aud.g.${g.gender}` ? g.gender : t(`an3.aud.g.${g.gender}`), value: g.n ?? 0, display: g.masked ? masked : compactNumber(g.n ?? 0, locale), masked: g.masked }))} limit={4} />}
        </A3Card>
        <A3Card title={t('an3.aud.cities')} hint={t('an3.aud.citiesHint')} state={cardState(q, (d) => d.cities.rows.length > 0)} minHeight={220}
          empty={{ title: t('an3.aud.citiesEmpty'), body: t('an3.aud.citiesEmptyBody').replace('{k}', String(k)) }}>
          {data && <HBarList rows={data.cities.rows.map((c) => ({ key: c.city, label: c.city, value: c.n, display: compactNumber(c.n, locale) }))} limit={8} />}
        </A3Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RfmCard scope={scope} campaignsHref={campaignsHref} />
        <CohortsCard scope={scope} />
      </div>

      {money && (
        <A3Card title={t('an3.aud.top')} hint={t('an3.aud.topHint')} state={cardState(q, (d) => d.top_customers.length > 0)} minHeight={200}
          empty={{ title: t('an3.aud.topEmpty') }}
          right={campaignsHref ? <a href={campaignsHref} className="text-[12px] font-medium" style={{ color: A3.accent }}>{t('an3.aud.createCampaign')}</a> : undefined}>
          {data && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr>{[t('an3.col.customer'), t('an3.col.nights'), t('an3.col.spend'), t('an3.col.lastVisit')].map((h, i) => <th key={h} className={`py-2 px-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.top_customers.map((c) => (
                    <tr key={c.email}>
                      <td className="py-2 px-2" style={{ borderBottom: `1px solid ${A3.faint}` }}><span className="block truncate max-w-[220px]" style={{ color: A3.t1 }}>{c.name ?? c.email}</span>{c.name && <span className="block text-[11px] truncate max-w-[220px]" style={{ color: A3.t3 }}>{c.email}</span>}</td>
                      <td className="py-2 px-2 text-right tabular-nums" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{c.nights}{c.tables > 0 && <span className="text-[11px]" style={{ color: A3.t3 }}> · {c.tables} {t('an3.unit.tables')}</span>}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold" style={{ color: A3.t1, borderBottom: `1px solid ${A3.faint}` }}>{compactMoney(c.spend, locale)}</td>
                      <td className="py-2 px-2 text-right tabular-nums" style={{ color: A3.t2, borderBottom: `1px solid ${A3.faint}` }}>{dateFmt.format(new Date(c.last_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </A3Card>
      )}
    </div>
  );
}
