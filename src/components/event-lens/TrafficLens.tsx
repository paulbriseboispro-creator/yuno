/**
 * Analytics › Trafic › Vue d'ensemble — « est-ce qu'on voit mes soirées, et où
 * est-ce qu'on lâche ? ». Toutes les soirées sur une période, OU une soirée
 * choisie dans la colonne de droite (`&event=`) : les MÊMES blocs, seul le
 * périmètre change (`get_traffic_period` / `get_event_traffic`, même forme).
 *
 * Même grammaire que le Rapport de soirée : la réponse en une phrase, quatre
 * chiffres, puis des QUESTIONS dans le même ordre à chaque fois —
 *   1. Où est-ce qu'on lâche ?          le tunnel, global et par pilier, les refus, les temps
 *   2. Qu'est-ce qui est choisi ?        les paliers et formules, face à ce qui s'est vendu
 *   3. D'où viennent-ils, sur quoi ?      sources et appareils, avec leur conversion
 *   4. Que fait la page ?                visites par jour, durée, défilement, villes
 *   5. Qui amène du trafic ?             UNE soirée à plusieurs : clics et ventes de chaque partie
 * (la 5e lit `get_collab_party_breakdown`).
 * Visites et étapes consenties seulement (CMP) : un minimum, et l'écran le dit.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnswerLine, ChoicePills, DeltaBadge, EmptyAnswer, KpiRow, KpiTile, MoreDetail, TodayDelta, Takeaways } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, Question, RankRow, ReportCard } from '@/components/event-report/ui';
import { visitSourceLabel } from '@/lib/eventReport';
import {
  biggestLeak, failureLabelKey, formatDuration, overallStages, pillarStages, visitConversion, withConversion,
  type EventTraffic, type TrafficPillar,
} from '@/lib/eventTraffic';
import { peopleOf, type PartyBreakdown } from '@/lib/collabPartyBreakdown';
import { MIN_SAMPLE } from '@/lib/metrics';
import { fillAxis } from '@/lib/lensSeries';
import { useAxisLabel } from './useAxisLabel';
import { useTrafficLens, type LensScope, type LensSubject } from '@/hooks/useLens';
import { usePartyBreakdown } from '@/hooks/usePartyBreakdown';
import { useAnalyticsPeriod } from '@/hooks/useAnalyticsPeriod';
import { periodHours } from '@/lib/analyticsPeriod';
import { SubjectHeader } from './SubjectHeader';
import { FunnelBars } from './FunnelBars';
import { PartyChip } from './PartyChip';

interface Props {
  scope: LensScope;
  /** La soirée choisie dans la colonne de droite ; `null` = toutes les soirées sur la période. */
  eventId: string | null;
  onClear: () => void;
}

const PILLAR_ORDER: TrafficPillar[] = ['tickets', 'tables', 'guest_list'];
export function TrafficLens({ scope, eventId, onClear }: Props) {
  const { t } = useLanguage();
  const [period] = useAnalyticsPeriod();
  const subject: LensSubject = eventId ? { kind: 'event', id: eventId } : { kind: 'period', hours: periodHours(period) };
  const { data, loading, error, fetchedAt } = useTrafficLens(scope, subject);
  const parties = usePartyBreakdown(data && eventId ? eventId : null);

  return (
    <div className="space-y-4">
      {eventId && !data
        ? <div className="animate-pulse rounded-2xl" style={{ height: 96, background: 'rgb(var(--ink)/0.04)' }} />
        : <SubjectHeader event={data?.event ?? null} tz={data?.tz} fetchedAt={fetchedAt} nights={data?.period?.nights ?? null} onClear={onClear} />}
      {error ? (
        <ReportCard><EmptyNote text={t(`er.error.${error}`)} /></ReportCard>
      ) : !data ? (
        <div className="space-y-3" aria-busy>
          {[72, 112, 300, 220].map((h, i) => <div key={i} className="animate-pulse rounded-2xl" style={{ height: h, background: 'rgb(var(--ink)/0.04)' }} />)}
        </div>
      ) : (
        <TrafficBody data={data} parties={parties} />
      )}
      {loading && data && <span className="sr-only">{t('er.loading')}</span>}
    </div>
  );
}

function TrafficBody({ data, parties }: { data: EventTraffic; parties: PartyBreakdown | null }) {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const [pillar, setPillar] = useState<'all' | TrafficPillar>('all');
  const f = data.funnel;
  const v = data.visits;

  const pillarsWithData = useMemo(
    () => PILLAR_ORDER.filter((p) => data.pillars.some((x) => x.pillar === p && x.selected > 0)),
    [data.pillars],
  );
  // Le pilier choisi disparaît du jeu de données (changement de soirée) : retour à « Tout ».
  const activePillar: 'all' | TrafficPillar = pillar !== 'all' && pillarsWithData.includes(pillar) ? pillar : 'all';
  const stages = useMemo(() => {
    if (activePillar === 'all') return overallStages(f);
    const row = data.pillars.find((x) => x.pillar === activePillar);
    return row ? pillarStages(row) : [];
  }, [activePillar, f, data.pillars]);
  const leak = useMemo(() => biggestLeak(stages), [stages]);

  if (v.total === 0 && !f.tracked) {
    return (
      <EmptyAnswer
        title={t(!data.event ? 'evl.tr.empty.period' : data.event.phase === 'after' ? 'evl.tr.empty.after' : 'evl.tr.empty.before')}
        body={t('evl.tr.empty.body')}
      />
    );
  }

  const conv = f.tracked ? visitConversion(f.purchased, f.sessions) : null;
  const prev = data.previous ?? null;
  const sessionsKnown = f.sessions >= MIN_SAMPLE;

  // ── La phrase-réponse ───────────────────────────────────────────────────
  const B = ({ children }: { children: ReactNode }) => <strong style={{ fontWeight: 650 }}>{children}</strong>;
  const fill = (tpl: string, parts: Record<string, ReactNode>): ReactNode[] =>
    tpl.split(/(\{[a-zA-Z]+\})/g).map((chunk, i) => {
      const m = chunk.match(/^\{([a-zA-Z]+)\}$/);
      return m && m[1] in parts ? <span key={i}>{parts[m[1]]}</span> : chunk;
    });
  const answer = f.tracked && sessionsKnown
    ? fill(t(data.event ? 'evl.tr.answer' : 'evl.tr.answerPeriod'), { visits: <B>{n(v.total)}</B>, checkout: <B>{n(f.checkout)}</B>, purchased: <B>{n(f.purchased)}</B>, conv: conv !== null ? ` (${pctFmt(conv, locale, 1)})` : '' })
    : fill(t(data.event ? 'evl.tr.answerNoFunnel' : 'evl.tr.answerPeriodNoFunnel'), { visits: <B>{n(v.total)}</B>, visitors: <B>{n(v.visitors)}</B> });

  // ── À retenir ───────────────────────────────────────────────────────────
  const tkText = (key: string, p: Record<string, string | number | null>): string => {
    const k = key === 'abandoned' && p.amount == null ? 'abandonedCount' : key;
    return t(`evl.tr.tk.${k}`)
      .replace('{lost}', n(Number(p.lost ?? 0)))
      .replace('{pct}', pctFmt(Number(p.pct ?? 0), locale, key === 'best_source' ? 1 : 0))
      .replace('{a}', pctFmt(Number(p.a ?? 0), locale, 1))
      .replace('{b}', pctFmt(Number(p.b ?? 0), locale, 1))
      .replace('{n}', n(Number(p.n ?? 0)))
      .replace('{amount}', p.amount != null ? eur(Number(p.amount)) : '')
      .replace('{source}', visitSourceLabel(String(p.source ?? ''), t));
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sectionId = (s?: string) => (s === 'funnel' ? 'evl-funnel' : s === 'audience' ? 'evl-audience' : undefined);

  const engaged = v.scrollSample >= MIN_SAMPLE;
  const sources = withConversion(data.sources, (r) => r.source);
  const devices = withConversion(data.devices, (r) => r.device);
  const topVisits = Math.max(1, ...data.sources.map((s) => s.visits));
  const topSelection = Math.max(1, ...data.selections.map((s) => s.sessions));
  const topCity = Math.max(1, ...data.cities.map((c) => c.visits));
  const topFail = Math.max(1, ...data.failures.map((x) => x.sessions));

  return (
    <div className="space-y-4">
      {data.live.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)' }}>
          <span className="inline-flex items-center gap-2" style={{ color: KIT.POS, fontSize: 13, fontWeight: 600 }}>
            <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full opacity-70" style={{ background: KIT.POS }} /><span className="relative h-2 w-2 rounded-full" style={{ background: KIT.POS }} /></span>
            {t('evl.tr.live').replace('{n}', n(data.live.total))}
          </span>
          {(data.live.cart > 0 || data.live.checkout > 0) && (
            <span style={{ color: KIT.T2, fontSize: 12.5 }}>
              {t('evl.tr.liveStages').replace('{cart}', n(data.live.cart)).replace('{checkout}', n(data.live.checkout))}
            </span>
          )}
        </div>
      )}

      <AnswerLine>{answer}</AnswerLine>
      <Takeaways
        title={t('ak.takeaways')}
        openLabel={t('ak.takeawayOpen')}
        items={(data.takeaways ?? []).map((tk) => ({
          key: tk.key, tone: tk.tone, text: tkText(tk.key, tk.params),
          onOpen: sectionId(tk.section) ? () => scrollTo(sectionId(tk.section)!) : undefined,
        }))}
      />

      <KpiRow narrow>
        <KpiTile label={t('evl.tr.kpi.visits')} hint={t('gl.visits')} value={n(v.total)}
          delta={prev ? <DeltaBadge current={v.total} previous={prev.visits} format="n" vs={t('evl.vsBefore')} /> : <TodayDelta value={v.today} />} />
        {f.tracked && sessionsKnown ? (
          <>
            <KpiTile label={t('m.conversion')} hint={t('evl.tr.hint.conversion')} value={conv !== null ? pctFmt(conv, locale, 1) : '—'}
              delta={prev && prev.sessions >= MIN_SAMPLE && conv !== null
                ? <DeltaBadge current={conv} previous={Math.round((prev.purchased / prev.sessions) * 1000) / 10} format="pct" vs={t('evl.vsBefore')} /> : undefined}
              sub={t('evl.tr.kpi.convSub').replace('{n}', n(f.purchased)).replace('{total}', n(f.sessions))} />
            <KpiTile label={t('evl.tr.kpi.checkout')} hint={t('evl.tr.hint.checkout')} value={n(f.checkout)}
              sub={f.sessions > 0 ? t('evl.tr.kpi.checkoutSub').replace('{pct}', pctFmt((f.checkout / f.sessions) * 100, locale)) : undefined} />
            <KpiTile
              label={t('evl.tr.kpi.abandoned')} hint={t('evl.tr.hint.abandoned')}
              value={data.abandoned.amount != null ? eur(data.abandoned.amount) : n(data.abandoned.sessions)}
              sub={data.abandoned.amount != null ? t('evl.tr.kpi.abandonedSub').replace('{n}', n(data.abandoned.sessions)) : t('evl.tr.kpi.abandonedSubCount')}
            />
          </>
        ) : (
          <>
            <KpiTile label={t('evl.tr.kpi.visitors')} hint={t('gl.visitors')} value={n(v.visitors)} />
            <KpiTile label={t('evl.tr.kpi.returning')} value={v.total >= MIN_SAMPLE ? pctFmt((v.returning / v.total) * 100, locale) : '—'} />
            <KpiTile label={t('evl.tr.kpi.duration')} value={v.avgDuration != null ? formatDuration(v.avgDuration, { min: t('evl.unit.min'), sec: t('evl.unit.sec') }) : '—'} />
          </>
        )}
      </KpiRow>

      {/* 1. Où est-ce qu'on lâche ? */}
      <Question id="evl-funnel" title={t('evl.tr.q.funnel')} sub={t('evl.tr.q.funnelSub')} />
      {!f.tracked ? (
        <ReportCard>
          <EmptyNote text={t('evl.tr.funnelPending')} />
        </ReportCard>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <ReportCard>
            <CardTitle
              title={t('evl.tr.funnelTitle')}
              hint={t('evl.tr.hint.funnel')}
              right={pillarsWithData.length > 1 ? (
                <ChoicePills<'all' | TrafficPillar>
                  label={t('evl.tr.pillarLabel')}
                  value={activePillar}
                  onChange={setPillar}
                  options={[{ value: 'all', label: t('evl.pillar.all') }, ...pillarsWithData.map((p) => ({ value: p, label: t(`evl.pillar.${p}`) }))]}
                />
              ) : undefined}
            />
            {(activePillar === 'all' ? f.sessions : stages[0]?.count ?? 0) === 0
              ? <EmptyNote text={t('evl.tr.funnelPending')} />
              : <FunnelBars stages={stages} leak={leak} pillar={activePillar === 'all' ? null : activePillar} />}
            <p className="mt-4" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('evl.tr.funnelNote')}</p>
          </ReportCard>

          <div className="flex flex-col gap-3">
            <ReportCard>
              <CardTitle title={t('evl.tr.timeTitle')} hint={t('evl.tr.hint.time')} />
              {data.timing.viewToBuy != null && data.timing.checkoutToBuy != null ? (
                <div className="grid grid-cols-2 gap-4">
                  <Stat label={t('evl.tr.time.viewToBuy')} value={formatDuration(data.timing.viewToBuy, { min: t('evl.unit.min'), sec: t('evl.unit.sec') })} />
                  <Stat label={t('evl.tr.time.checkoutToBuy')} value={formatDuration(data.timing.checkoutToBuy, { min: t('evl.unit.min'), sec: t('evl.unit.sec') })} />
                </div>
              ) : <EmptyNote text={t('evl.tr.time.pending')} />}
            </ReportCard>
            <ReportCard>
              <CardTitle title={t('evl.tr.failTitle')} hint={t('evl.tr.hint.fail')} />
              {data.failures.length === 0 ? <EmptyNote text={t('evl.tr.failNone')} /> : (
                <div className="space-y-3">
                  {data.failures.map((x) => (
                    <RankRow key={x.reason} label={t(failureLabelKey(x.reason))} value={t('evl.tr.failSessions').replace('{n}', n(x.sessions))} share={(x.sessions / topFail) * 100} />
                  ))}
                </div>
              )}
            </ReportCard>
          </div>
        </div>
      )}

      {/* 2. Qu'est-ce qui est choisi ? */}
      {data.selections.length > 0 && (
        <>
          <Question id="evl-selections" title={t('evl.tr.q.selections')} sub={t('evl.tr.q.selectionsSub')} />
          <ReportCard>
            <CardTitle title={t('evl.tr.selTitle')} hint={t('evl.tr.hint.selections')} />
            <div className="space-y-3">
              {data.selections.map((s) => (
                <RankRow
                  key={`${s.pillar}:${s.ref}`}
                  label={s.name ?? t('evl.tr.selUnknown')}
                  icon={<span className="rounded-full px-1.5 py-0.5" style={{ background: 'rgb(var(--ink)/0.06)', color: KIT.T3, fontSize: 10, fontWeight: 650 }}>{t(`evl.pillar.${s.pillar}`)}</span>}
                  value={t('evl.tr.selChosen').replace('{n}', n(s.sessions))}
                  note={t(s.pillar === 'tickets' ? 'evl.tr.selSoldTickets' : 'evl.tr.selSoldTables').replace('{n}', n(s.sold))}
                  share={(s.sessions / topSelection) * 100}
                />
              ))}
            </div>
          </ReportCard>
        </>
      )}

      {/* 3. D'où viennent-ils, et sur quoi ? */}
      <Question id="evl-audience" title={t('evl.tr.q.audience')} sub={t('evl.tr.q.audienceSub')} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ReportCard>
          <CardTitle title={t('evl.tr.sourcesTitle')} hint={t('gl.sources')} />
          {data.sources.length === 0 ? <EmptyNote text={t('evl.tr.noSources')} /> : (
            <div className="space-y-3">
              {sources.map((s) => (
                <RankRow
                  key={s.key}
                  label={s.key === 'unknown' ? t('evl.tr.sourceUnknown') : visitSourceLabel(s.key, t)}
                  value={t('er.reach.sessions').replace('{n}', n(s.visits))}
                  note={s.conversion !== null ? t('evl.tr.convNote').replace('{pct}', pctFmt(s.conversion, locale, 1)).replace('{n}', n(s.purchased)) : s.purchased > 0 ? t('er.reach.orders').replace('{n}', n(s.purchased)) : undefined}
                  share={(s.visits / topVisits) * 100}
                />
              ))}
            </div>
          )}
        </ReportCard>
        <ReportCard>
          <CardTitle title={t('evl.tr.devicesTitle')} hint={t('evl.tr.hint.devices')} />
          {devices.length === 0 ? <EmptyNote text={t('evl.tr.noSources')} /> : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ color: KIT.T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th className="pb-2 text-left font-semibold">{t('evl.tr.colDevice')}</th>
                  <th className="pb-2 pl-3 text-right font-semibold">{t('anf.tr.colVisits')}</th>
                  <th className="pb-2 pl-3 text-right font-semibold">{t('evl.tr.colCheckout')}</th>
                  <th className="pb-2 pl-3 text-right font-semibold">{t('evl.tr.colBought')}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.key} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                    <td className="py-2.5" style={{ color: KIT.T2 }}>{t(`evl.device.${d.key}`)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T1 }}>{n(d.visits)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T2 }}>{d.sessions > 0 ? n(d.checkout) : '—'}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T2 }}>
                      {d.sessions > 0 ? n(d.purchased) : '—'}
                      {d.conversion !== null && <span className="ml-1.5" style={{ color: KIT.T3 }}>{pctFmt(d.conversion, locale, 1)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportCard>
      </div>

      {/* 4. Que fait la page ? */}
      <Question id="evl-page" title={t('evl.tr.q.page')} sub={t('evl.tr.q.pageSub')} />
      <ReportCard>
        <CardTitle title={t('evl.tr.curveTitle')} hint={t('evl.tr.hint.curve')} />
        <VisitsCurve data={data} />
        {data.funnel.tracked && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: KIT.T3, fontSize: 11.5 }}>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: KIT.RED }} />{t('evl.tr.legend.visits')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'rgb(var(--ink)/0.55)' }} />{t('evl.tr.legend.checkout')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--acc-34d399)' }} />{t('evl.tr.legend.bought')}</span>
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 lg:grid-cols-4" style={{ borderColor: 'rgb(var(--ink)/0.055)' }}>
          <Stat label={t('evl.tr.kpi.visitors')} value={n(v.visitors)} />
          <Stat label={t('evl.tr.kpi.returning')} value={v.total >= MIN_SAMPLE ? pctFmt((v.returning / v.total) * 100, locale) : '—'} />
          <Stat label={t('evl.tr.kpi.duration')} value={v.avgDuration != null ? formatDuration(v.avgDuration, { min: t('evl.unit.min'), sec: t('evl.unit.sec') }) : '—'} hint={t('evl.tr.hint.duration')} />
          <Stat label={t('evl.tr.kpi.scroll')} value={engaged ? pctFmt((v.scrollHalf / v.scrollSample) * 100, locale) : '—'} hint={t('evl.tr.hint.scroll')} />
        </div>
        <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('anf.tr.consent')}</p>
      </ReportCard>

      {data.cities.length > 0 && (
        <MoreDetail label={t('evl.tr.moreCities')}>
          <ReportCard>
            <CardTitle title={t('evl.tr.citiesTitle')} />
            <div className="space-y-3">
              {data.cities.map((c) => (
                <RankRow key={c.city} label={c.city} value={t('er.reach.sessions').replace('{n}', n(c.visits))} share={(c.visits / topCity) * 100} />
              ))}
            </div>
          </ReportCard>
        </MoreDetail>
      )}

      {/* 5. Soirée à plusieurs : qui amène du trafic */}
      {parties && <PartiesTraffic parties={parties} />}
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

/** Visites par jour (aire) et entrées au paiement / achats (lignes, échelle à droite : deux ordres de grandeur). */
function VisitsCurve({ data }: { data: EventTraffic }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const points = useMemo(() => fillAxis(data.series, { visits: 0, checkout: 0, purchased: 0 }), [data.series]);
  const axisLabel = useAxisLabel();
  if (points.length === 0) return <EmptyNote text={t('evl.tr.noCurve')} />;
  const withFunnel = data.funnel.tracked;
  return (
    <div className="h-[250px] w-full" role="img" aria-label={t('evl.tr.curveTitle')}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="evlVisits" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={KIT.RED} stopOpacity={0.22} />
              <stop offset="100%" stopColor={KIT.RED} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgb(var(--ink)/0.06)" />
          <XAxis dataKey="key" tickFormatter={(k: string) => axisLabel(k)} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis yAxisId="l" width={40} tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          {withFunnel && <YAxis yAxisId="r" orientation="right" hide />}
          <Tooltip
            cursor={{ stroke: 'rgb(var(--ink)/0.25)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as { visits: number; checkout: number; purchased: number };
              return (
                <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--sf-111113)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
                  <div style={{ color: KIT.T3, marginBottom: 4 }}>{axisLabel(String(label))}</div>
                  <div className="tabular-nums font-semibold">{t('er.reach.sessions').replace('{n}', n(row.visits))}</div>
                  {withFunnel && (
                    <>
                      <div className="tabular-nums" style={{ color: KIT.T2 }}>{t('evl.tr.curveCheckout').replace('{n}', n(row.checkout))}</div>
                      <div className="tabular-nums" style={{ color: KIT.T2 }}>{t('evl.tr.curveBought').replace('{n}', n(row.purchased))}</div>
                    </>
                  )}
                </div>
              );
            }}
          />
          <Area yAxisId="l" type="monotone" dataKey="visits" stroke={KIT.RED} strokeWidth={2} fill="url(#evlVisits)" dot={false} isAnimationActive={false} />
          {withFunnel && <Line yAxisId="r" type="monotone" dataKey="checkout" stroke="rgb(var(--ink)/0.55)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
          {withFunnel && <Line yAxisId="r" type="monotone" dataKey="purchased" stroke="var(--acc-34d399)" strokeWidth={2} dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Soirée à plusieurs : clics sur le lien de chaque partie, personnes amenées, et la part de clics qui ont donné une venue. */
function PartiesTraffic({ parties }: { parties: PartyBreakdown }) {
  const { t } = useLanguage();
  const { n, locale } = useNumberFormat();
  return (
    <>
      <Question id="evl-parties" title={t('evl.tr.q.parties')} sub={t('evl.tr.q.partiesSub')} />
      <ReportCard>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-[13px]">
            <thead>
              <tr style={{ color: KIT.T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th className="pb-2 text-left font-semibold">{t('evl.party.col')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.tr.partyClicks')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.tr.partyPeople')}</th>
                <th className="pb-2 pl-3 text-right font-semibold">{t('evl.tr.partyConv')}</th>
              </tr>
            </thead>
            <tbody>
              {parties.parties.map((p) => {
                const people = peopleOf(p);
                return (
                  <tr key={p.party} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                    <td className="py-2.5 pr-3"><PartyChip name={p.name} avatar={p.avatar_url} role={p.role} mine={p.mine} /></td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T1 }}>{n(p.clicks)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T1 }}>{n(people)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums" style={{ color: KIT.T2 }}>
                      {p.clicks >= MIN_SAMPLE ? pctFmt(Math.min(100, (people / p.clicks) * 100), locale, 1) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>{t('evl.tr.partiesNote')}</p>
      </ReportCard>
    </>
  );
}
