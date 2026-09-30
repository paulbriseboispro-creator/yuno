/**
 * Analytics › Communauté › Par soirée — « ce que cette soirée m'a apporté ».
 * Une adresse par soirée (`?tab=community&view=event&event=`).
 *
 * La phrase-réponse, quatre chiffres, puis des QUESTIONS toujours dans le même
 * ordre :
 *   1. Qui est venu ?                         fidélité, retour, acheteurs / guest list, public
 *   2. Qu'est-ce que ça a ajouté à ma base ?  nouveaux contacts, joignables par canal
 *   3. Et mes abonnés ?                       gagnés, perdus, via la page soirée, rythme habituel
 *   4. Dans le temps                          personnes et abonnés, jour par jour
 *   5. Qui a amené qui ?                      soirée à plusieurs : chaque partie, volumes seulement
 * Tout vient de `get_event_community` (migration 20260930245000).
 *
 * Volumes seulement : jamais un nom, un email ou un numéro. Sur une soirée à
 * plusieurs, une partie voit combien de contacts une autre a gagnés, pas
 * lesquels — le consentement nommé décide qui reçoit un contact.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnswerLine, BulletBar, EmptyAnswer, KpiRow, KpiTile, StackBar, Takeaways } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, Question, ReportCard } from '@/components/event-report/ui';
import { followerLift, isCollabNight, myParty, sharePct, windowDays, type EventCommunity } from '@/lib/eventCommunity';
import { MIN_SAMPLE } from '@/lib/metrics';
import { useEventCommunity } from '@/hooks/useEventLens';
import type { AnalyticsFamily } from '@/lib/analyticsNav';
import { EventLensHeader } from './EventLensHeader';
import { PartyChip } from './PartyChip';

interface Props {
  eventId: string;
  onEventChange: (eventId: string) => void;
  onBack: () => void;
  go: (family: AnalyticsFamily, view?: string) => void;
  scope: { venueId?: string | null; organizerUserId?: string | null };
  /** Âge / sexe / villes du public (`EventAudienceDemographics`), sous « Qui est venu ? ». */
  demographics?: ReactNode;
  /** Base de contacts de la Console (absente côté manager, qui n'y a pas accès). */
  contactsHref?: string;
  /** Écrire aux participants : l'Email Studio, soirée préremplie. */
  campaignHref?: string;
}

const dayLabel = (d: number, t: (k: string) => string) =>
  d > 0 ? t('er.day.before').replace('{n}', String(d)) : d === 0 ? t('er.day.j') : t('er.day.after').replace('{n}', String(-d));

export function EventCommunityView({ eventId, onEventChange, onBack, go, scope, demographics, contactsHref, campaignHref }: Props) {
  const { t } = useLanguage();
  const { data, loading, error, fetchedAt } = useEventCommunity(eventId);
  return (
    <div className="space-y-4">
      <EventLensHeader
        lens="community" eventId={eventId} onEventChange={onEventChange} onBack={onBack} go={go} scope={scope}
        event={data?.event ?? null} tz={data?.tz} fetchedAt={fetchedAt}
      />
      {error ? (
        <ReportCard><EmptyNote text={t(`er.error.${error}`)} /></ReportCard>
      ) : !data ? (
        <div className="space-y-3" aria-busy>
          {[72, 112, 260, 200].map((h, i) => <div key={i} className="animate-pulse rounded-2xl" style={{ height: h, background: 'rgb(var(--ink)/0.04)' }} />)}
        </div>
      ) : (
        <CommunityBody data={data} demographics={demographics} contactsHref={contactsHref} campaignHref={campaignHref} />
      )}
      {loading && data && <span className="sr-only">{t('er.loading')}</span>}
    </div>
  );
}

function CommunityBody({ data, demographics, contactsHref, campaignHref }: {
  data: EventCommunity; demographics?: ReactNode; contactsHref?: string; campaignHref?: string;
}) {
  const { t } = useLanguage();
  const { n, locale } = useNumberFormat();
  const p = data.people;
  const crm = data.crm;
  const me = myParty(data);
  const collab = isCollabNight(data);
  const days = windowDays(data.window);
  const lift = data.followers ? followerLift(data.followers, days) : null;

  if (p.total === 0) {
    return (
      <EmptyAnswer
        title={t(data.event.phase === 'after' ? 'evl.co.empty.after' : 'evl.co.empty.before')}
        body={t('evl.co.empty.body')}
      />
    );
  }

  const B = ({ children }: { children: ReactNode }) => <strong style={{ fontWeight: 650 }}>{children}</strong>;
  const fill = (tpl: string, parts: Record<string, ReactNode>): ReactNode[] =>
    tpl.split(/(\{[a-zA-Z]+\})/g).map((chunk, i) => {
      const m = chunk.match(/^\{([a-zA-Z]+)\}$/);
      return m && m[1] in parts ? <span key={i}>{parts[m[1]]}</span> : chunk;
    });
  const freshPct = sharePct(crm.new, p.total);
  const reachPct = sharePct(crm.anyReach, p.total);
  const answer = fill(t(data.event.phase === 'before' ? 'evl.co.answerBefore' : 'evl.co.answer'), {
    people: <B>{n(p.total)}</B>,
    buyers: n(p.buyers),
    guests: n(p.guestsOnly),
    fresh: <B>{n(crm.new)}</B>,
    freshPct: freshPct !== null ? ` (${pctFmt(freshPct, locale)})` : '',
    reach: <B>{n(crm.anyReach)}</B>,
  });

  const tkText = (key: string, prm: Record<string, string | number | null>): string =>
    t(`evl.co.tk.${key}`)
      .replace('{n}', n(Number(prm.n ?? 0)))
      .replace('{pct}', pctFmt(Number(prm.pct ?? 0), locale))
      .replace('{email}', n(Number(prm.email ?? 0)))
      .replace('{lift}', new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(prm.lift ?? 0)))
      .replace('{name}', String(prm.name ?? ''));
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const SECTION: Record<string, string> = { crm: 'evl-crm', followers: 'evl-followers', who: 'evl-who', parties: 'evl-parties' };

  const net = data.followers ? data.followers.gained - data.followers.lost : null;

  return (
    <div className="space-y-4">
      <AnswerLine>{answer}</AnswerLine>
      <Takeaways
        title={t('ak.takeaways')}
        openLabel={t('ak.takeawayOpen')}
        items={(data.takeaways ?? []).map((tk) => ({
          key: tk.key, tone: tk.tone, text: tkText(tk.key, tk.params),
          onOpen: tk.section && SECTION[tk.section] ? () => scrollTo(SECTION[tk.section!]) : undefined,
        }))}
      />

      <KpiRow>
        <KpiTile label={t('evl.co.kpi.people')} hint={t('evl.co.hint.people')} value={n(p.total)}
          sub={t('evl.co.kpi.peopleSub').replace('{buyers}', n(p.buyers)).replace('{guests}', n(p.guestsOnly))} />
        <KpiTile label={t('evl.co.kpi.fresh')} hint={t('evl.co.hint.fresh')} value={n(crm.new)}
          sub={freshPct !== null ? t('evl.co.kpi.freshSub').replace('{pct}', pctFmt(freshPct, locale)) : undefined} />
        <KpiTile label={t('evl.co.kpi.reach')} hint={t('evl.co.hint.reach')} value={reachPct !== null ? pctFmt(reachPct, locale) : '—'}
          sub={t('evl.co.kpi.reachSub').replace('{n}', n(crm.anyReach))} />
        <KpiTile label={t('evl.co.kpi.followers')} hint={t('evl.co.hint.followers')}
          value={net === null ? '—' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${n(Math.abs(net))}`}
          sub={data.followers && data.followers.eventPage > 0 ? t('evl.co.kpi.followersSub').replace('{n}', n(data.followers.eventPage)) : undefined} />
      </KpiRow>

      {/* 1. Qui est venu ? */}
      <Question id="evl-who" title={t('evl.co.q.who')} sub={t('evl.co.q.whoSub')} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ReportCard>
          <CardTitle title={t('evl.co.loyaltyTitle')} hint={t('evl.co.hint.loyalty')} />
          {p.total < MIN_SAMPLE ? <EmptyNote text={t('evl.co.thin')} /> : (
            <div className="space-y-5">
              <StackBar
                format={n}
                parts={[
                  { key: 'first', label: t('evl.co.loy.first'), value: data.loyalty.first, color: KIT.RED },
                  { key: 'second', label: t('evl.co.loy.second'), value: data.loyalty.second, color: 'rgb(var(--ink)/0.55)' },
                  { key: 'regulars', label: t('evl.co.loy.regulars'), value: data.loyalty.regulars, color: 'rgb(var(--ink)/0.28)' },
                ]}
              />
              {data.retention && (
                <p style={{ color: KIT.T2, fontSize: 13 }}>
                  {t('evl.co.retention')
                    .replace('{n}', n(data.retention.returned))
                    .replace('{pct}', pctFmt((data.retention.returned / p.total) * 100, locale))
                    .replace('{events}', n(data.retention.laterEvents))}
                </p>
              )}
            </div>
          )}
        </ReportCard>
        <ReportCard>
          <CardTitle title={t('evl.co.howTitle')} hint={t('evl.co.hint.how')} />
          {p.total < MIN_SAMPLE ? <EmptyNote text={t('evl.co.thin')} /> : (
            <div className="space-y-5">
              <StackBar
                format={n}
                parts={[
                  { key: 'buyers', label: t('evl.co.how.buyers'), value: p.buyers, color: KIT.RED },
                  { key: 'guests', label: t('evl.co.how.guests'), value: p.guestsOnly, color: 'rgb(var(--ink)/0.45)' },
                ]}
              />
              {p.spend != null && p.buyers > 0 && (
                <p style={{ color: KIT.T2, fontSize: 13 }}>
                  {t('evl.co.spend').replace('{n}', n(p.buyers)).replace('{avg}', new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(p.spend / p.buyers))}
                </p>
              )}
            </div>
          )}
        </ReportCard>
      </div>
      {demographics}

      {/* 2. Qu'est-ce que ça a ajouté à ma base ? */}
      <Question id="evl-crm" title={t('evl.co.q.crm')} sub={t('evl.co.q.crmSub')} />
      <ReportCard>
        <CardTitle title={t('evl.co.reachTitle')} hint={t('evl.co.hint.reachList')} />
        <div className="space-y-3.5">
          <BulletBar label={t('evl.co.ch.email')} value={crm.emailOk} display={n(crm.emailOk)} capacity={p.total} />
          <BulletBar label={t('evl.co.ch.sms')} value={crm.smsOk} display={n(crm.smsOk)} capacity={p.total} />
          <BulletBar label={t('evl.co.ch.app')} value={crm.app} display={n(crm.app)} capacity={p.total} />
          <BulletBar label={t('evl.co.ch.account')} value={crm.account} display={n(crm.account)} capacity={p.total} />
        </div>
        {crm.new > 0 && (
          <p className="mt-4" style={{ color: KIT.T2, fontSize: 13 }}>
            {t('evl.co.freshReach').replace('{n}', n(crm.newEmailOk)).replace('{fresh}', n(crm.new))}
          </p>
        )}
        {p.noEmail > 0 && (
          <p className="mt-2" style={{ color: 'var(--acc-f59e0b)', fontSize: 12.5 }}>
            {t('evl.co.noEmail').replace('{n}', n(p.noEmail))}
          </p>
        )}
        {(contactsHref || campaignHref) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {campaignHref && (
              <Link to={campaignHref} className="rounded-full px-4 py-2 text-[12.5px] font-semibold transition-opacity hover:opacity-90" style={{ background: KIT.RED, color: '#fff' }}>
                {t('evl.co.writeAttendees')}
              </Link>
            )}
            {contactsHref && (
              <Link to={contactsHref} className="rounded-full px-4 py-2 text-[12.5px] font-medium transition-colors" style={{ background: 'rgb(var(--ink)/0.05)', color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}>
                {t('evl.co.openBase')}
              </Link>
            )}
          </div>
        )}
        <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('evl.co.reachNote').replace('{party}', me?.name ?? '')}</p>
      </ReportCard>

      {/* 3. Et mes abonnés ? */}
      <Question id="evl-followers" title={t('evl.co.q.followers')} sub={t('evl.co.q.followersSub')} />
      <ReportCard>
        <CardTitle title={t('evl.co.followersTitle')} hint={t('evl.co.hint.followerFlow')} />
        {!data.followers ? <EmptyNote text={t('evl.co.followersNone')} /> : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label={t('evl.co.fw.gained')} value={n(data.followers.gained)} />
              <Stat label={t('evl.co.fw.lost')} value={n(data.followers.lost)} />
              <Stat label={t('evl.co.fw.eventPage')} value={n(data.followers.eventPage)} hint={t('evl.co.hint.eventPage')} />
              <Stat label={t('evl.co.fw.attendees')} value={n(data.followers.attendees)} hint={t('evl.co.hint.attendees')} />
            </div>
            {lift && lift.lift !== null && (
              <p className="mt-4" style={{ color: KIT.T2, fontSize: 13 }}>
                {t('evl.co.lift')
                  .replace('{n}', n(data.followers.gained))
                  .replace('{expected}', new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(lift.expected))
                  .replace('{lift}', new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(lift.lift))}
              </p>
            )}
            {data.followers.total != null && (
              <p className="mt-2" style={{ color: KIT.T3, fontSize: 12 }}>{t('evl.co.followersTotal').replace('{n}', n(data.followers.total))}</p>
            )}
          </>
        )}
      </ReportCard>

      {/* 4. Dans le temps */}
      <Question id="evl-timeline" title={t('evl.co.q.timeline')} sub={t('evl.co.q.timelineSub')} />
      <ReportCard>
        <CardTitle title={t('evl.co.timelineTitle')} hint={t('evl.co.hint.timeline')} />
        <Timeline data={data} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: KIT.T3, fontSize: 11.5 }}>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIT.RED, opacity: 0.6 }} />{t('evl.co.legend.fresh')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'rgb(var(--ink)/0.3)' }} />{t('evl.co.legend.known')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--acc-34d399)' }} />{t('evl.co.legend.followers')}</span>
        </div>
      </ReportCard>

      {/* 5. Soirée à plusieurs : qui a amené qui */}
      {collab && <PartiesTable data={data} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate tabular-nums" style={{ color: KIT.T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      <div className="mt-1" style={{ color: KIT.T3, fontSize: 12 }} title={hint}>{label}</div>
    </div>
  );
}

/** Personnes par jour (nouvelles au-dessus des connues, empilées) et abonnés gagnés (ligne, échelle à droite). */
function Timeline({ data }: { data: EventCommunity }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const points = useMemo(() => {
    const by = new Map(data.timeline.map((x) => [x.d, x]));
    const ds = [...by.keys()];
    if (ds.length === 0) return [];
    const max = Math.max(...ds, 0);
    const min = Math.min(...ds, 0);
    const out: { d: number; fresh: number; known: number; followers: number }[] = [];
    for (let d = max; d >= min; d--) {
      const r = by.get(d);
      out.push({ d, fresh: r?.fresh ?? 0, known: Math.max(0, (r?.people ?? 0) - (r?.fresh ?? 0)), followers: r?.followers ?? 0 });
    }
    return out;
  }, [data.timeline]);
  if (points.length === 0) return <EmptyNote text={t('evl.co.noTimeline')} />;
  return (
    <div className="h-[240px] w-full" role="img" aria-label={t('evl.co.timelineTitle')}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--ink)/0.06)" />
          <XAxis dataKey="d" tickFormatter={(d: number) => dayLabel(d, t)} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis yAxisId="l" width={40} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis yAxisId="r" orientation="right" hide />
          <Tooltip
            cursor={{ stroke: 'rgb(var(--ink)/0.25)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as { fresh: number; known: number; followers: number };
              return (
                <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--sf-111113)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
                  <div style={{ color: KIT.T3, marginBottom: 4 }}>{dayLabel(Number(label), t)}</div>
                  <div className="tabular-nums font-semibold">{t('evl.co.tl.people').replace('{n}', n(row.fresh + row.known))}</div>
                  <div className="tabular-nums" style={{ color: KIT.T2 }}>{t('evl.co.tl.fresh').replace('{n}', n(row.fresh))}</div>
                  <div className="tabular-nums" style={{ color: KIT.T2 }}>{t('evl.co.tl.followers').replace('{n}', n(row.followers))}</div>
                </div>
              );
            }}
          />
          <Area yAxisId="l" type="monotone" dataKey="fresh" stackId="p" stroke={KIT.RED} strokeWidth={1.5} fill={KIT.RED} fillOpacity={0.3} dot={false} isAnimationActive={false} />
          <Area yAxisId="l" type="monotone" dataKey="known" stackId="p" stroke="rgb(var(--ink)/0.45)" strokeWidth={1.5} fill="rgb(var(--ink)/0.45)" fillOpacity={0.14} dot={false} isAnimationActive={false} />
          <Line yAxisId="r" type="monotone" dataKey="followers" stroke="var(--acc-34d399)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Soirée à plusieurs : chaque partie, ce qu'elle a amené et gagné — des volumes, jamais des noms. */
function PartiesTable({ data }: { data: EventCommunity }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  return (
    <>
      <Question id="evl-parties" title={t('evl.co.q.parties')} sub={t('evl.co.q.partiesSub')} />
      <ReportCard>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr style={{ color: KIT.T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th className="pb-2 text-left font-semibold">{t('evl.party.col')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.co.colBrought')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.co.colEmail')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.co.colSms')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.co.colFollowers')}</th>
              </tr>
            </thead>
            <tbody>
              {data.parties.map((p) => (
                <tr key={p.party} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                  <td className="py-2.5 pr-3"><PartyChip name={p.name} avatar={p.avatar} role={p.role} mine={p.mine} /></td>
                  <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T1 }}>
                    {n(p.brought)}
                    {p.broughtNew > 0 && <span className="ml-1.5" style={{ color: KIT.T3 }}>{t('evl.co.broughtNew').replace('{n}', n(p.broughtNew))}</span>}
                  </td>
                  <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: p.emailGained > 0 ? 'var(--acc-34d399)' : KIT.T3 }}>{p.emailGained > 0 ? `+${n(p.emailGained)}` : '—'}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: p.smsGained > 0 ? 'var(--acc-34d399)' : KIT.T3 }}>{p.smsGained > 0 ? `+${n(p.smsGained)}` : '—'}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: p.followersGained > 0 ? 'var(--acc-34d399)' : KIT.T3 }}>
                    {p.followersGained > 0 ? `+${n(p.followersGained)}` : '—'}
                    {p.followersLost > 0 && <span className="ml-1.5" style={{ color: KIT.T3 }}>−{n(p.followersLost)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('evl.co.partiesNote')}</p>
      </ReportCard>
    </>
  );
}
