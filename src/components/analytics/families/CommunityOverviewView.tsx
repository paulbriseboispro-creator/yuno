/**
 * Analytics › Communauté › Vue d'ensemble — « Qui sont mes clients ? ».
 *
 * La page Communauté de Shotgun, sur la base VIVANTE de Yuno (fichiers
 * importés ∪ clients venus par Yuno) : combien de contacts et d'abonnés, à
 * combien de soirées ils viennent, quand ils ont acheté pour la dernière fois,
 * comment la base grandit, et ce que chaque soirée a apporté de nouveaux. Des
 * mots de pro : les segments (Fidèles, À risque…) restent dans le CRM, où l'on
 * agit. Tout vient de `get_community_overview`.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { CoverageNote, UpdatedAt } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, RankRow, ReportCard, StatCard } from '@/components/event-report/ui';
import { useCommunityOverview, type AnalyticsScope } from '@/hooks/useAnalyticsFamilies';
import { needsSecondAxis, onceShare, pct, trimLeadingEmpty } from '@/lib/communityAnalytics';

const CONTACTS = '#E8192C';
const FOLLOWERS = 'var(--acc-60a5fa)';

interface Props {
  scope: AnalyticsScope;
  /** La base de contacts de la portée (`/owner/campaigns/contacts`…). */
  contactsHref: string;
  /** Rapport d'une soirée. */
  eventHref: (eventId: string) => string;
  /** Ce qui suit (fidélité), rendu sous les blocs de la page. */
  children?: ReactNode;
}

export function CommunityOverviewView({ scope, contactsHref, eventHref, children }: Props) {
  const { t, language } = useLanguage();
  const { n, locale } = useNumberFormat();
  const { data, loading, error, fetchedAt } = useCommunityOverview(scope);

  if (error) return <ReportCard><EmptyNote text={t(error === 'forbidden' ? 'anf.forbidden' : 'anf.error')} /></ReportCard>;
  if (!data) {
    return (
      <div className="space-y-3" aria-busy={loading}>
        {[112, 240, 260].map((h, i) => <div key={i} className="animate-pulse rounded-2xl" style={{ height: h, background: 'rgb(var(--ink)/0.04)' }} />)}
      </div>
    );
  }

  const tot = data.totals;
  const once = onceShare(data.participation);
  const growth = trimLeadingEmpty(data.growth.series);
  const twoAxes = needsSecondAxis(growth.map((g) => g.contacts), growth.map((g) => g.followers));
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' });
  const monthLabel = (m: string) => monthFmt.format(new Date(`${m}-01T12:00:00Z`));
  const partTop = Math.max(1, ...data.participation.buckets.map((b) => b.n));
  const lastTop = Math.max(1, ...data.lastPurchase.buckets.map((b) => b.n));
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><UpdatedAt at={fetchedAt} /></div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('anf.co.contacts')}
          hint={t('gl.contacts')}
          value={n(tot.contacts)}
          sub={<>
            {t('anf.co.contactsSub').replace('{yuno}', n(tot.yunoCustomers)).replace('{imported}', n(tot.imported))}
            <In30d value={tot.newContacts30d} />
          </>}
        />
        <StatCard
          label={t('anf.co.emailReachable')}
          hint={t('gl.emailReachable')}
          value={n(tot.emailReachable)}
          sub={pct(tot.emailReachable, tot.contacts) != null ? t('anf.co.ofContacts').replace('{pct}', pctFmt(pct(tot.emailReachable, tot.contacts) ?? 0, locale)) : undefined}
        />
        <StatCard
          label={t('anf.co.followers')}
          hint={t('gl.followers')}
          value={n(tot.followers)}
          sub={<In30d value={tot.newFollowers30d} />}
        />
        <StatCard
          label={t('anf.co.pushReachable')}
          hint={t('gl.pushReachable')}
          value={n(tot.pushReachable)}
          sub={pct(tot.pushReachable, tot.followers) != null ? t('anf.co.ofFollowers').replace('{pct}', pctFmt(pct(tot.pushReachable, tot.followers) ?? 0, locale)) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard>
          <CardTitle title={t('anf.co.partTitle')} hint={t('gl.participation')} />
          {data.participation.known === 0 ? <EmptyNote text={t('anf.co.empty')} /> : (
            <>
              {data.participation.avg != null && (
                <p className="mb-4" style={{ color: KIT.T2, fontSize: 13 }}>
                  {t('anf.co.partSentence')
                    .replace('{avg}', new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(data.participation.avg))
                    .replace('{once}', once == null ? '—' : pctFmt(once, locale))}
                </p>
              )}
              <div className="space-y-3">
                {data.participation.buckets.map((b) => (
                  <RankRow
                    key={b.bucket}
                    label={t(`anf.co.part.${b.bucket === '4+' ? 'many' : b.bucket}`)}
                    value={n(b.n)}
                    note={pct(b.n, data.participation.known) != null ? pctFmt(pct(b.n, data.participation.known) ?? 0, locale) : undefined}
                    share={(b.n / partTop) * 100}
                  />
                ))}
              </div>
              <div className="mt-3"><CoverageNote known={data.participation.known} total={tot.contacts} /></div>
            </>
          )}
        </ReportCard>

        <ReportCard>
          <CardTitle title={t('anf.co.lastTitle')} hint={t('gl.lastPurchase')} />
          {data.lastPurchase.known === 0 ? <EmptyNote text={t('anf.co.empty')} /> : (
            <>
              <div className="space-y-3">
                {data.lastPurchase.buckets.map((b) => (
                  <RankRow
                    key={b.bucket}
                    label={t(`anf.co.last.${b.bucket}`)}
                    value={n(b.n)}
                    note={pct(b.n, data.lastPurchase.known) != null ? pctFmt(pct(b.n, data.lastPurchase.known) ?? 0, locale) : undefined}
                    share={(b.n / lastTop) * 100}
                    color={b.bucket === 'lt3' ? 'var(--acc-34d399)' : undefined}
                  />
                ))}
              </div>
              <div className="mt-3"><CoverageNote known={data.lastPurchase.known} total={tot.contacts} /></div>
              <Link to={contactsHref} className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: KIT.T1 }}>
                {t('anf.co.openContacts')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </>
          )}
        </ReportCard>
      </div>

      <ReportCard>
        <CardTitle title={t('anf.co.growthTitle')} hint={t('gl.growth')} />
        <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px]" style={{ color: KIT.T2 }}>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[2px] w-4 rounded" style={{ background: CONTACTS }} aria-hidden />{t('anf.co.contacts')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[2px] w-4 rounded" style={{ background: FOLLOWERS }} aria-hidden />{t('anf.co.followers')}{twoAxes && <span style={{ color: KIT.T3 }}> · {t('anf.co.rightAxis')}</span>}</span>
        </div>
        {growth.every((g) => g.contacts === 0 && g.followers === 0) ? <EmptyNote text={t('anf.co.empty')} /> : (
          <div className="h-[240px] w-full" lang={language}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growth} margin={{ top: 8, right: twoAxes ? 4 : 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--ink)/0.06)" />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="c" width={52} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => n(v)} />
                <YAxis yAxisId="f" orientation="right" hide={!twoAxes} width={twoAxes ? 44 : 0} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => n(v)} />
                <Tooltip
                  cursor={{ stroke: 'rgb(var(--ink)/0.25)', strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as { contacts: number; followers: number };
                    return (
                      <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--sf-111113)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
                        <div style={{ color: KIT.T3, marginBottom: 4 }}>{monthLabel(String(label))}</div>
                        <div className="flex justify-between gap-4"><span>{t('anf.co.contacts')}</span><span className="tabular-nums font-semibold">{n(p.contacts)}</span></div>
                        <div className="flex justify-between gap-4"><span>{t('anf.co.followers')}</span><span className="tabular-nums font-semibold">{n(p.followers)}</span></div>
                      </div>
                    );
                  }}
                />
                <Line yAxisId="c" type="monotone" dataKey="contacts" stroke={CONTACTS} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId={twoAxes ? 'f' : 'c'} type="monotone" dataKey="followers" stroke={FOLLOWERS} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {data.growth.known < tot.contacts && <div className="mt-3"><CoverageNote known={data.growth.known} total={tot.contacts} /></div>}
      </ReportCard>

      <ReportCard>
        <CardTitle title={t('anf.co.byEventTitle')} hint={t('gl.newContacts')} />
        {data.byEvent.length === 0 ? <EmptyNote text={t('anf.co.noEvents')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[13px]">
              <thead>
                <tr style={{ color: KIT.T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th className="pb-2 text-left font-semibold">{t('anf.co.colEvent')}</th>
                  <th className="pb-2 pl-3 text-right font-semibold">{t('anf.co.colParticipants')}</th>
                  <th className="pb-2 pl-3 text-right font-semibold">{t('anf.co.colNew')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byEvent.map((e) => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                    <td className="py-2.5 pr-3">
                      <Link to={eventHref(e.id)} className="block truncate font-medium hover:underline" style={{ color: KIT.T1, maxWidth: 360 }}>{e.title}</Link>
                      <span style={{ color: KIT.T3, fontSize: 11.5 }}>{dateFmt.format(new Date(e.startAt))}</span>
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T1 }}>{n(e.participants)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: e.newContacts > 0 ? 'var(--acc-34d399)' : KIT.T3 }}>
                      {e.newContacts > 0 ? `+${n(e.newContacts)}` : '0'}
                      {pct(e.newContacts, e.participants) != null && e.newContacts > 0 && (
                        <span className="ml-1.5" style={{ color: KIT.T3 }}>{pctFmt(pct(e.newContacts, e.participants) ?? 0, locale)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>

      {children}
    </div>
  );
}

/** « +12 en 30 jours » sous un total (vert), ou « rien en 30 jours » (gris). */
function In30d({ value }: { value: number }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  return (
    <span className="mt-0.5 block tabular-nums" style={{ color: value > 0 ? 'var(--acc-34d399)' : KIT.T3, fontWeight: value > 0 ? 600 : 400 }}>
      {value > 0 ? t('anf.co.in30d').replace('{n}', n(value)) : t('anf.co.none30d')}
    </span>
  );
}
