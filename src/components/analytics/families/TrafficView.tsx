/**
 * Analytics › Trafic — « Est-ce qu'on me voit ? ».
 *
 *   • Ma page     : la page publique du club (`/club/…`) ou de l'organisateur
 *                   (`/o/…`), visites par jour, aujourd'hui, visiteurs, sources.
 *   • Par soirée  : chaque soirée, ses visites et la part qui a commandé ; un
 *                   clic ouvre son Rapport de soirée.
 * Visites consenties seulement (CMP) : c'est un minimum, et l'écran le dit.
 * Tout vient de `get_page_traffic`.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { UpdatedAt } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, RankRow, ReportCard, Segmented, StatCard } from '@/components/event-report/ui';
import { usePageTraffic, type AnalyticsScope } from '@/hooks/useAnalyticsFamilies';
import { pct } from '@/lib/communityAnalytics';
import { visitSourceLabel } from '@/lib/eventReport';

type Days = '30' | '90' | '365';

interface Props {
  scope: AnalyticsScope;
  mode: 'page' | 'events';
  /** Adresse publique de la page (pour « Voir ma page »), si connue. */
  publicPath?: string | null;
  eventHref: (eventId: string) => string;
}

export function TrafficView({ scope, mode, publicPath, eventHref }: Props) {
  const { t, language } = useLanguage();
  const { n, locale } = useNumberFormat();
  const [days, setDays] = useState<Days>('90');
  const { data, loading, error, fetchedAt } = usePageTraffic(scope, Number(days));

  const period = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented<Days>
        label={t('anf.tr.period')}
        value={days}
        onChange={setDays}
        options={[
          { value: '30', label: t('anf.tr.days').replace('{n}', '30') },
          { value: '90', label: t('anf.tr.days').replace('{n}', '90') },
          { value: '365', label: t('anf.tr.year') },
        ]}
      />
      <UpdatedAt at={fetchedAt} />
    </div>
  );

  if (error) return <div className="space-y-4">{period}<ReportCard><EmptyNote text={t(error === 'forbidden' ? 'anf.forbidden' : 'anf.error')} /></ReportCard></div>;
  if (!data) {
    return (
      <div className="space-y-4" aria-busy={loading}>
        {period}
        {[112, 260].map((h, i) => <div key={i} className="animate-pulse rounded-2xl" style={{ height: h, background: 'rgb(var(--ink)/0.04)' }} />)}
      </div>
    );
  }

  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit' });

  if (mode === 'events') {
    const rows = data.events.rows;
    return (
      <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
        {period}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label={t('anf.tr.eventVisits')} hint={t('gl.visits')} value={n(data.events.total)} today={data.events.today} />
          <StatCard label={t('anf.tr.eventsSeen')} value={n(rows.length)} sub={t('anf.tr.overPeriod').replace('{n}', days)} />
        </div>
        <ReportCard>
          <CardTitle title={t('anf.tr.byEventTitle')} hint={t('gl.visits')} />
          {rows.length === 0 ? <EmptyNote text={t('anf.tr.noEventVisits')} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr style={{ color: KIT.T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th className="pb-2 text-left font-semibold">{t('anf.co.colEvent')}</th>
                    <th className="pb-2 pl-3 text-right font-semibold">{t('anf.tr.colVisits')}</th>
                    <th className="pb-2 pl-3 text-right font-semibold">{t('anf.tr.colToday')}</th>
                    <th className="pb-2 pl-3 text-right font-semibold">{t('anf.tr.colOrdered')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const conv = pct(r.ordered, r.visits);
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                        <td className="py-2.5 pr-3">
                          <Link to={eventHref(r.id)} className="block truncate font-medium hover:underline" style={{ color: KIT.T1, maxWidth: 360 }}>{r.title}</Link>
                          <span style={{ color: KIT.T3, fontSize: 11.5 }}>{dateFmt.format(new Date(r.startAt))}</span>
                        </td>
                        <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T1 }}>{n(r.visits)}</td>
                        <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: r.today > 0 ? 'var(--acc-34d399)' : KIT.T3 }}>{r.today > 0 ? `+${n(r.today)}` : '—'}</td>
                        <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T2 }}>
                          {n(r.ordered)}{conv != null && <span className="ml-1.5" style={{ color: KIT.T3 }}>{pctFmt(conv, locale)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('anf.tr.consent')}</p>
        </ReportCard>
      </div>
    );
  }

  const p = data.page;
  const sourcesTop = Math.max(1, ...p.sources.map((s) => s.visits));
  return (
    <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
      {period}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('anf.tr.pageVisits')} hint={t('gl.pageVisits')} value={n(p.total)} today={p.today} />
        <StatCard label={t('anf.tr.visitors')} hint={t('gl.visitors')} value={n(p.visitors)} />
        <StatCard
          label={t('anf.tr.returning')}
          value={pct(p.returning, p.total) != null ? pctFmt(pct(p.returning, p.total) ?? 0, locale) : '—'}
          sub={t('anf.tr.returningSub').replace('{n}', n(p.returning))}
        />
      </div>

      <ReportCard>
        <CardTitle
          title={t(p.kind === 'venue' ? 'anf.tr.curveVenue' : 'anf.tr.curveOrg')}
          right={publicPath ? (
            <a href={publicPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: KIT.T2 }}>
              {t('anf.tr.openPage')} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : undefined}
        />
        {p.total === 0 ? <EmptyNote text={t('anf.tr.noPageVisits')} /> : (
          <div className="h-[240px] w-full" lang={language}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={p.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trPage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={KIT.RED} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={KIT.RED} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgb(var(--ink)/0.06)" />
                <XAxis dataKey="date" tickFormatter={(d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`))} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis width={40} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: 'rgb(var(--ink)/0.25)', strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--sf-111113)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
                        <div style={{ color: KIT.T3, marginBottom: 2 }}>{dayFmt.format(new Date(`${label}T12:00:00Z`))}</div>
                        <span className="tabular-nums font-semibold">{t('er.reach.sessions').replace('{n}', n(Number(payload[0].value)))}</span>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="visits" stroke={KIT.RED} strokeWidth={2} fill="url(#trPage)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('anf.tr.consent')}</p>
      </ReportCard>

      <ReportCard>
        <CardTitle title={t('anf.tr.sourcesTitle')} hint={t('gl.sources')} />
        {p.sources.length === 0 ? <EmptyNote text={t('anf.tr.noPageVisits')} /> : (
          <div className="space-y-3">
            {p.sources.map((s) => (
              <RankRow
                key={s.source}
                label={visitSourceLabel(s.source, t)}
                value={n(s.visits)}
                note={pct(s.visits, p.total) != null ? pctFmt(pct(s.visits, p.total) ?? 0, locale) : undefined}
                share={(s.visits / sourcesTop) * 100}
              />
            ))}
          </div>
        )}
      </ReportCard>
    </div>
  );
}
