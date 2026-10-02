// Bilan d'une soirée de la billetterie connectée (Yuno CRM).
// Une lecture : get_crm_night_report. La grammaire est celle du Rapport de
// soirée de la Suite (docs/DESIGN_SYSTEM.md) : une phrase-réponse, quatre
// chiffres, la courbe J-N comparée à la soirée précédente au même moment,
// puis ce qui s'est vendu, qui a acheté, ce que les emails ont rapporté et
// d'où venaient les acheteurs (UTM transmis par la billetterie).

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ExternalLink, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useConsoleBase } from '@/lib/crmProduct';
import { cumulativeCurve, curveWindow, daysUntil, newBuyersShare, soldBy, type CrmCurvePoint } from '@/lib/crm';
import { CrmPageShell } from '@/components/crm/CrmPageShell';
import {
  AnalyticsLoading, AnswerLine, CoverageNote, DeltaBadge, EmptyAnswer, KpiRow, KpiTile, RankedList, StackBar,
} from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, ReportCard } from '@/components/event-report/ui';

interface Report {
  event: {
    id: string; title: string; start_at: string; end_at: string; timezone: string; cover_url: string | null;
    url: string | null; cancelled: boolean; sold_out: boolean; location_city: string | null;
    external: { left_tickets: number | null; genres: string[] | null } | null;
  };
  totals: {
    tickets: number; revenue: number; fees: number; buyers: number; new_buyers: number; scanned: number;
    scan_known: boolean | null; refunded: number; with_email: number; all_tickets: number; optin_buyers: number;
  };
  curve: CrmCurvePoint[];
  compare: null | { event: { event_id: string; title: string; start_at: string; tickets: number; revenue: number }; curve: CrmCurvePoint[] };
  deals: { name: string; tickets: number; revenue: number }[];
  audience: {
    cities: { city: string; n: number }[]; ages: { band: string; n: number }[]; genders: Record<string, number>;
    with_city: number; with_age: number;
  };
  campaigns: {
    campaign_id: string; name: string | null; subject: string | null; sent_at: string | null; automation: boolean;
    recipients: number; opens: number; clicks: number; attributed_tickets: number; attributed_revenue: number;
  }[];
  utm: { source: string; medium: string | null; tickets: number; revenue: number }[];
}

export default function CrmNightReport() {
  const { eventId } = useParams<{ eventId: string }>();
  const { t } = useLanguage();
  const base = useConsoleBase();
  const { n, eur, locale } = useNumberFormat();

  const q = useQuery({
    queryKey: ['crm-night-report', eventId],
    enabled: !!eventId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_crm_night_report', { p_event_id: eventId as string });
      if (error) throw error;
      return data as unknown as Report;
    },
  });
  const r = q.data;

  const chart = useMemo(() => {
    if (!r) return [];
    const maxD = curveWindow(r.curve, r.compare?.curve);
    const mine = cumulativeCurve(r.curve, maxD);
    const prev = r.compare ? cumulativeCurve(r.compare.curve, maxD) : null;
    return mine.map((p, i) => ({ d: p.d, mine: p.total, prev: prev ? prev[i].total : undefined }));
  }, [r]);

  if (q.isLoading) return <CrmPageShell title={t('crm.report.title')} backTo={`${base}/crm/nights`}><AnalyticsLoading rows={4} /></CrmPageShell>;
  if (q.isError || !r) {
    return (
      <CrmPageShell title={t('crm.report.title')} backTo={`${base}/crm/nights`}>
        <EmptyAnswer title={t('crm.common.loadError')} />
      </CrmPageShell>
    );
  }

  const tt = r.totals;
  const upcoming = new Date(r.event.end_at).getTime() > Date.now();
  const dNow = Math.max(0, daysUntil(r.event.start_at, new Date(), r.event.timezone));
  // Comparaison : au même J-N pendant la vente, au total une fois la soirée passée.
  const prevAtSameMoment = r.compare ? (upcoming ? soldBy(r.compare.curve, dNow) : r.compare.event.tickets) : null;
  const newShare = newBuyersShare(tt.new_buyers, tt.buyers);
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: r.event.timezone })
    .format(new Date(r.event.start_at));
  const vs = r.compare ? t('crm.report.vs').replace('{title}', r.compare.event.title) : undefined;

  const answer = (() => {
    const head = t(upcoming ? 'crm.report.answerUpcoming' : 'crm.report.answerPast')
      .replace('{tickets}', n(tt.tickets)).replace('{revenue}', eur(tt.revenue)).replace('{d}', String(dNow));
    if (prevAtSameMoment == null || !r.compare) return head;
    const diff = tt.tickets - prevAtSameMoment;
    const key = diff > 0 ? 'crm.report.answerAhead' : diff < 0 ? 'crm.report.answerBehind' : 'crm.report.answerEqual';
    return `${head} ${t(key).replace('{n}', n(Math.abs(diff))).replace('{title}', r.compare.event.title)}`;
  })();

  const dealRows = r.deals.map((d) => ({ key: d.name, label: d.name, value: n(d.tickets), note: eur(d.revenue), share: d.tickets }));
  const cityRows = r.audience.cities.map((c) => ({ key: c.city, label: c.city, value: n(c.n), share: c.n }));
  const ageRows = r.audience.ages.map((a) => ({ key: a.band, label: a.band, value: n(a.n), share: a.n }));
  const utmRows = r.utm.map((u) => ({
    key: `${u.source}-${u.medium ?? ''}`, label: u.medium ? `${u.source} · ${u.medium}` : u.source,
    value: n(u.tickets), note: eur(u.revenue), share: u.tickets,
  }));
  const genders = r.audience.genders || {};

  return (
    <CrmPageShell title={r.event.title} backTo={`${base}/crm/nights`} actions={
      r.event.url ? (
        <a href={r.event.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold" style={{ color: KIT.T1, border: `1px solid ${KIT.BORDER}` }}>
          {t('crm.report.openTicketing')} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : undefined
    }>
      <ReportCard>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl" style={{ background: 'rgb(var(--ink)/0.06)' }}>
            {r.event.cover_url && <img src={r.event.cover_url} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="first-letter:uppercase" style={{ color: KIT.T2, fontSize: 13 }}>{date}{r.event.location_city ? ` · ${r.event.location_city}` : ''}</p>
            <p style={{ color: KIT.T3, fontSize: 12, marginTop: 2 }}>
              {r.event.cancelled ? t('crm.night.cancelled') : r.event.sold_out ? t('crm.night.soldOut') : upcoming ? t('crm.report.onSale') : t('crm.report.done')}
            </p>
          </div>
          {upcoming && !r.event.cancelled && (
            <Link to={`${base}/campaigns/new?event=${r.event.id}`} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: KIT.RED, color: '#fff' }}>
              <Mail className="h-4 w-4" /> {t('crm.report.writeBase')}
            </Link>
          )}
        </div>
      </ReportCard>

      <AnswerLine>{answer}</AnswerLine>

      <KpiRow>
        <KpiTile label={t('crm.kpi.tickets')} hint={t('crm.kpi.ticketsHint')} value={n(tt.tickets)}
          delta={prevAtSameMoment != null ? <DeltaBadge current={tt.tickets} previous={prevAtSameMoment} format="n" vs={vs} /> : undefined}
          sub={tt.refunded > 0 ? <span>{t('crm.report.refunded').replace('{n}', n(tt.refunded))}</span> : undefined} />
        <KpiTile label={t('crm.kpi.revenue')} hint={t('crm.kpi.revenueHint')} value={eur(tt.revenue)}
          delta={!upcoming && r.compare ? <DeltaBadge current={tt.revenue} previous={r.compare.event.revenue} format="eur" vs={vs} /> : undefined} />
        <KpiTile label={t('crm.kpi.buyers')} hint={t('crm.kpi.buyersHint')} value={n(tt.buyers)}
          sub={newShare != null ? <span>{t('crm.report.newShare').replace('{n}', String(newShare))}</span> : undefined} />
        <KpiTile label={t('crm.kpi.scanned')} hint={t('crm.kpi.scannedHint')} value={tt.scan_known ? n(tt.scanned) : '—'}
          sub={!tt.scan_known ? <span>{t('crm.report.noScans')}</span> : tt.tickets > 0 ? <span>{Math.round((tt.scanned / tt.tickets) * 100)} %</span> : undefined} />
      </KpiRow>

      <ReportCard>
        <CardTitle title={t('crm.report.curve')} hint={t('crm.report.curveHint')} />
        {chart.length > 1 && tt.tickets > 0 ? (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="rgb(var(--ink)/0.06)" vertical={false} />
                <XAxis dataKey="d" tickFormatter={(d: number) => (d === 0 ? t('crm.report.dayJ') : `J-${d}`)} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, borderRadius: 12, fontSize: 12 }}
                  labelFormatter={(d: number) => (d === 0 ? t('crm.report.dayJ') : `J-${d}`)}
                  formatter={(v: number, key: string) => [n(v), key === 'mine' ? r.event.title : r.compare?.event.title ?? '']}
                />
                <Area type="monotone" dataKey="mine" stroke={KIT.RED} fill="rgb(232 25 44/0.12)" strokeWidth={2} isAnimationActive={false} />
                {r.compare && <Line type="monotone" dataKey="prev" stroke="rgb(var(--ink)/0.45)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.report.noSales')}</p>}
        {r.compare && (
          <p className="mt-2" style={{ color: KIT.T3, fontSize: 12 }}>{t('crm.report.legend').replace('{title}', r.compare.event.title)}</p>
        )}
      </ReportCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <ReportCard>
          <CardTitle title={t('crm.report.deals')} />
          {dealRows.length ? <RankedList rows={dealRows} moreLabel={t('crm.common.showAll')} lessLabel={t('crm.common.showLess')} />
            : <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.report.noSales')}</p>}
        </ReportCard>
        <ReportCard>
          <CardTitle title={t('crm.report.audience')} hint={t('crm.report.audienceHint')} />
          <div className="flex flex-col gap-5">
            {tt.buyers >= 10 && (
              <StackBar format={n} parts={[
                { key: 'new', label: t('crm.report.newBuyers'), value: tt.new_buyers, color: KIT.RED },
                { key: 'back', label: t('crm.report.returning'), value: Math.max(0, tt.buyers - tt.new_buyers), color: 'rgb(var(--ink)/0.55)' },
              ]} />
            )}
            {cityRows.length > 0 && <RankedList rows={cityRows} limit={5} moreLabel={t('crm.common.showAll')} lessLabel={t('crm.common.showLess')} />}
            {ageRows.length > 0 && r.audience.with_age >= 10 && <RankedList rows={ageRows} limit={5} moreLabel={t('crm.common.showAll')} lessLabel={t('crm.common.showLess')} />}
            {(genders.female ?? 0) + (genders.male ?? 0) >= 10 && (
              <StackBar format={n} parts={[
                { key: 'f', label: t('crm.report.women'), value: genders.female ?? 0, color: 'rgb(var(--ink)/0.75)' },
                { key: 'm', label: t('crm.report.men'), value: genders.male ?? 0, color: 'rgb(var(--ink)/0.4)' },
                { key: 'o', label: t('crm.report.other'), value: genders.other ?? 0, color: 'rgb(var(--ink)/0.2)' },
              ]} />
            )}
            {cityRows.length === 0 && ageRows.length === 0 && tt.buyers < 10 && <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.report.audienceThin')}</p>}
            <CoverageNote known={r.audience.with_city} total={tt.tickets} unit={t('crm.report.ticketsUnit')} />
          </div>
        </ReportCard>
      </div>

      <ReportCard>
        <CardTitle title={t('crm.report.emails')} hint={t('crm.report.emailsHint')} />
        {r.campaigns.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p style={{ color: KIT.T3, fontSize: 13 }}>{t('crm.report.noEmails')}</p>
            {upcoming && !r.event.cancelled && (
              <Link to={`${base}/campaigns/new?event=${r.event.id}`} className="text-[13px] font-semibold underline" style={{ color: KIT.T1 }}>{t('crm.report.writeBase')}</Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {r.campaigns.map((c) => (
              <Link key={c.campaign_id} to={`${base}/campaigns/${c.campaign_id}/report`} className="flex flex-wrap items-center justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                <span className="min-w-0">
                  <span className="block truncate" style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 600 }}>{c.subject || c.name || '—'}</span>
                  <span className="block" style={{ color: KIT.T3, fontSize: 12 }}>
                    {c.automation ? t('crm.report.automation') : t('crm.report.campaign')}
                    {' · '}{t('crm.report.emailStats').replace('{r}', n(c.recipients)).replace('{o}', n(c.opens)).replace('{c}', n(c.clicks))}
                  </span>
                </span>
                <span className="text-right tabular-nums" style={{ color: KIT.T1, fontSize: 13 }}>
                  {t('crm.report.attributed').replace('{n}', n(c.attributed_tickets))}
                  <span className="block" style={{ color: KIT.T3, fontSize: 12 }}>{eur(c.attributed_revenue)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </ReportCard>

      {utmRows.length > 0 && (
        <ReportCard>
          <CardTitle title={t('crm.report.sources')} hint={t('crm.report.sourcesHint')} />
          <RankedList rows={utmRows} moreLabel={t('crm.common.showAll')} lessLabel={t('crm.common.showLess')} />
        </ReportCard>
      )}
    </CrmPageShell>
  );
}
