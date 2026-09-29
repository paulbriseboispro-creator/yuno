/**
 * Onglet « Automatiques » de la page Notifications (club et organisateur).
 *
 * Yuno envoie les notifications des soirées selon ses règles (moteur de
 * notifications, `docs/designs/NOTIFICATION_ENGINE_PLAN.md`) ; le pro voit ce
 * qui est parti pour SES soirées — menées, en collab, co-hébergées — et ce que
 * ça a rapporté. Tous les chiffres viennent de `get_push_center`.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, Compass, Loader2, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { UpdatedAt } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, ReportCard, StatCard } from '@/components/event-report/ui';
import { INNER_BG } from '@/components/event-report/tokens';
import { usePushCenter, type PushCenterScope } from '@/hooks/usePushCenter';
import AnnounceScheduleDialog from './AnnounceScheduleDialog';
import {
  ENGINE_RULES, ruleParam, tapRate, timelineFor,
  type EngineRuleKey, type PushCenterEvent, type PushCenterRule, type PushCenterStep, type TimelineItem,
} from '@/lib/pushEngine';

const EMOJI = new Map(ENGINE_RULES.map((r) => [r.key, r.emoji]));

export default function PushCenterView({ scope }: { scope: PushCenterScope }) {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const { data, loading, error, fetchedAt, reload } = usePushCenter(scope, 30);
  const [scheduling, setScheduling] = useState<PushCenterEvent | null>(null);

  const rulesByKey = useMemo(() => new Map((data?.rules ?? []).map((r) => [r.key, r])), [data?.rules]);
  const enabled = (key: EngineRuleKey) => rulesByKey.get(key)?.enabled !== false;

  if (loading && !data) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: KIT.T3 }} /></div>;
  }
  if (error || !data) {
    return <ReportCard><EmptyNote text={error === 'forbidden' ? t('pe.forbidden') : t('pe.error')} /></ReportCard>;
  }

  const s = data.summary;
  const rate = tapRate(s.taps, s.sent);
  const dateFmt = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
  const dateTimeFmt = (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <div className="space-y-5">
      {/* Ce que fait Yuno, en une phrase et trois promesses */}
      <ReportCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.22)' }}>
              <Zap className="h-4 w-4" style={{ color: KIT.RED }} />
            </div>
            <div className="min-w-0">
              <h2 style={{ color: KIT.T1, fontSize: 16, fontWeight: 650, letterSpacing: '-0.01em' }}>{t('pe.intro.title')}</h2>
              <p style={{ color: KIT.T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.55, maxWidth: '72ch' }}>{t('pe.intro.body')}</p>
            </div>
          </div>
          <UpdatedAt at={fetchedAt} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Pledge icon={<CalendarClock className="h-3.5 w-3.5" />} title={t('pe.intro.p1Title')} text={t('pe.intro.p1')} />
          <Pledge icon={<Users className="h-3.5 w-3.5" />} title={t('pe.intro.p2Title')} text={t('pe.intro.p2')} />
          <Pledge icon={<ShieldCheck className="h-3.5 w-3.5" />} title={t('pe.intro.p3Title')} text={t('pe.intro.p3')} />
        </div>
      </ReportCard>

      {/* Les 30 derniers jours + à venir */}
      <div>
        <p className="px-1 pb-2" style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          {t('pe.kpi.period').replace('{days}', n(data.days))}
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={t('pe.kpi.sent')}
            hint={t('pe.kpi.sentHint')}
            value={n(s.sent)}
            sub={(s.people === 1 ? t('pe.kpi.peopleOne') : t('pe.kpi.people')).replace('{n}', n(s.people))}
          />
          <StatCard
            label={t('pe.kpi.opened')}
            hint={t('pe.kpi.openedHint')}
            value={n(s.taps)}
            sub={rate == null ? undefined : t('pe.kpi.rate').replace('{pct}', pctFmt(rate, locale))}
          />
          <StatCard
            label={t('pe.kpi.buyers')}
            hint={t('pe.kpi.buyersHint')}
            value={n(s.buyers)}
            sub={s.influenced > 0 ? t('pe.kpi.influenced').replace('{n}', n(s.influenced)) : (s.entries > 0 ? t('pe.kpi.entries').replace('{n}', n(s.entries)) : undefined)}
          />
          {data.money && s.revenue != null ? (
            <StatCard label={t('pe.kpi.revenue')} hint={t('pe.kpi.revenueHint')} value={eur(s.revenue)} />
          ) : (
            <StatCard label={t('pe.kpi.held')} hint={t('pe.kpi.heldHint')} value={n(s.held)} />
          )}
        </div>
        {(s.held > 0 || s.boughtBefore > 0 || s.queued > 0) && (
          <p className="px-1 pt-2.5" style={{ color: KIT.T3, fontSize: 12, lineHeight: 1.55 }}>
            {[
              s.queued > 0 ? t('pe.kpi.queuedLine').replace('{n}', n(s.queued)) : null,
              s.held > 0 && data.money ? t('pe.kpi.heldLine').replace('{n}', n(s.held)) : null,
              s.boughtBefore > 0 ? t('pe.kpi.boughtBeforeLine').replace('{n}', n(s.boughtBefore)) : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* Co-soirées : ce que TON audience a donné */}
      {data.viaMe.multiParty && (
        <ReportCard padding={18}>
          <CardTitle title={t('pe.via.title')} hint={t('pe.via.hint')} />
          <div className="grid grid-cols-3 gap-2.5">
            <Mini label={t('pe.via.sent')} value={n(data.viaMe.sent)} />
            <Mini label={t('pe.via.taps')} value={n(data.viaMe.taps)} />
            <Mini label={t('pe.via.buyers')} value={n(data.viaMe.buyers)} />
          </div>
        </ReportCard>
      )}

      {/* Par soirée */}
      <ReportCard>
        <CardTitle title={t('pe.events.title')} hint={t('pe.events.hint')} />
        {data.events.length === 0 ? (
          <EmptyNote text={t('pe.events.empty')} />
        ) : (
          <div className="space-y-2.5">
            {data.events.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                timeline={timelineFor(ev, enabled)}
                money={data.money}
                dateFmt={dateFmt}
                dateTimeFmt={dateTimeFmt}
                onSchedule={() => setScheduling(ev)}
              />
            ))}
          </div>
        )}
      </ReportCard>

      {/* Les règles, en français */}
      <ReportCard>
        <CardTitle title={t('pe.rules.title')} hint={t('pe.rules.hint')} />
        <div className="grid gap-2.5 md:grid-cols-2">
          {ENGINE_RULES.map(({ key, emoji }) => (
            <RuleCard key={key} ruleKey={key} emoji={emoji} rule={rulesByKey.get(key)} money={data.money} />
          ))}
        </div>
      </ReportCard>

      {/* Découverte Yuno */}
      {data.discovery.people > 0 && (
        <ReportCard padding={18}>
          <div className="flex items-start gap-3">
            <Compass className="mt-0.5 h-4 w-4 flex-none" style={{ color: KIT.POS }} />
            <div>
              <p style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 600 }}>{t('pe.disc.title')}</p>
              <p style={{ color: KIT.T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>
                {t('pe.disc.body').replace('{people}', n(data.discovery.people)).replace('{opened}', n(data.discovery.opened))}
              </p>
            </div>
          </div>
        </ReportCard>
      )}

      <p className="px-1" style={{ color: KIT.T3, fontSize: 11.5, lineHeight: 1.55 }}>{t('pe.footnote')}</p>

      <AnnounceScheduleDialog
        event={scheduling}
        open={!!scheduling}
        onOpenChange={(v) => { if (!v) setScheduling(null); }}
        onSaved={reload}
      />
    </div>
  );
}

function Pledge({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
      <p className="flex items-center gap-1.5" style={{ color: KIT.T1, fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ color: KIT.RED }}>{icon}</span>{title}
      </p>
      <p style={{ color: KIT.T3, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
      <p style={{ color: KIT.T3, fontSize: 11 }}>{label}</p>
      <p className="tabular-nums" style={{ color: KIT.T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 2 }}>{value}</p>
    </div>
  );
}

function EventRow({ event, timeline, money, dateFmt, dateTimeFmt, onSchedule }: {
  event: PushCenterEvent;
  timeline: TimelineItem[];
  money: boolean;
  dateFmt: (iso: string) => string;
  dateTimeFmt: (iso: string) => string;
  onSchedule: () => void;
}) {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const [open, setOpen] = useState(false);
  const totals = event.steps.reduce((acc, st) => ({
    sent: acc.sent + st.sent, taps: acc.taps + st.taps, buyers: acc.buyers + st.buyers,
    revenue: acc.revenue + (st.revenue ?? 0),
  }), { sent: 0, taps: 0, buyers: 0, revenue: 0 });
  const withData = event.steps.filter((st) => st.sent > 0 || st.queued > 0 || st.held > 0);

  return (
    <div className="rounded-xl" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
      <div className="flex flex-wrap items-start gap-3 p-3">
        {event.image ? (
          <img src={event.image} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" loading="lazy" />
        ) : (
          <div className="h-12 w-12 flex-none rounded-lg" style={{ background: 'rgb(var(--ink)/0.06)' }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate" style={{ color: KIT.T1, fontSize: 14, fontWeight: 600 }}>{event.title}</p>
            {event.parties > 1 && (
              <span className="rounded-full px-2 py-0.5" style={{ background: 'rgb(var(--ink)/0.06)', border: `1px solid ${KIT.BORDER}`, color: KIT.T2, fontSize: 10.5, fontWeight: 600 }}>
                {t('pe.events.parties').replace('{n}', n(event.parties))}
              </span>
            )}
          </div>
          <p style={{ color: KIT.T3, fontSize: 12, marginTop: 1 }}>
            {dateFmt(event.startAt)}
            {event.upcoming && event.visibility === 'public' && !event.announced && (
              <> · {event.announceAt
                ? t('pe.events.announceAt').replace('{date}', dateTimeFmt(event.announceAt))
                : t('pe.events.announceAuto')}</>
            )}
            {event.visibility !== 'public' && <> · {t('pe.events.private')}</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {timeline.map((item) => <StepChip key={item.rule} item={item} dateTimeFmt={dateTimeFmt} />)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {totals.sent > 0 && (
            <p className="tabular-nums text-right" style={{ color: KIT.T2, fontSize: 12 }}>
              {t('pe.events.totals')
                .replace('{sent}', n(totals.sent))
                .replace('{rate}', totals.sent > 0 ? pctFmt(tapRate(totals.taps, totals.sent) ?? 0, locale) : '—')
                .replace('{buyers}', n(totals.buyers))}
              {money && totals.revenue > 0 && <b style={{ color: KIT.T1 }}> · {eur(totals.revenue)}</b>}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            {event.canSchedule && (
              <button
                type="button"
                onClick={onSchedule}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold"
                style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: KIT.RED }}
              >
                <CalendarClock className="h-3 w-3" />{t('pe.events.schedule')}
              </button>
            )}
            {withData.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium"
                style={{ background: 'transparent', border: `1px solid ${KIT.BORDER}`, color: KIT.T2 }}
              >
                {t('pe.events.details')}
                <ChevronDown className="h-3 w-3 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
              </button>
            )}
          </div>
        </div>
      </div>
      {open && withData.length > 0 && (
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: KIT.T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th className="pb-1.5 text-left font-semibold">{t('pe.col.rule')}</th>
                <th className="pb-1.5 text-right font-semibold">{t('pe.col.sent')}</th>
                <th className="pb-1.5 text-right font-semibold">{t('pe.col.opened')}</th>
                <th className="pb-1.5 text-right font-semibold">{t('pe.col.buyers')}</th>
                {money && <th className="pb-1.5 text-right font-semibold">{t('pe.col.revenue')}</th>}
                <th className="pb-1.5 text-right font-semibold">{t('pe.col.held')}</th>
              </tr>
            </thead>
            <tbody>
              {sortSteps(withData).map((st) => (
                <tr key={st.rule} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                  <td className="py-2 pr-2" style={{ color: KIT.T1 }}>{EMOJI.get(st.rule as EngineRuleKey) ?? '•'} {t(`pe.rule.${st.rule}.name`)}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: KIT.T1 }}>{n(st.sent)}{st.queued > 0 && <span style={{ color: KIT.T3 }}> +{n(st.queued)}</span>}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: KIT.T2 }}>
                    {n(st.taps)}{st.sent > 0 && <span style={{ color: KIT.T3 }}> · {pctFmt(tapRate(st.taps, st.sent) ?? 0, locale)}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={{ color: KIT.T1 }}>
                    {n(st.buyers)}{st.influenced > st.buyers && <span style={{ color: KIT.T3 }}> ({n(st.influenced)})</span>}
                  </td>
                  {money && <td className="py-2 text-right tabular-nums" style={{ color: KIT.T1, fontWeight: (st.revenue ?? 0) > 0 ? 600 : 400 }}>{(st.revenue ?? 0) > 0 ? eur(st.revenue ?? 0) : '—'}</td>}
                  <td className="py-2 text-right tabular-nums" style={{ color: KIT.T3 }}>{st.held > 0 ? n(st.held) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: KIT.T3, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>{t('pe.events.detailsNote')}</p>
        </div>
      )}
    </div>
  );
}

function sortSteps(steps: PushCenterStep[]): PushCenterStep[] {
  const order = new Map(ENGINE_RULES.map((r, i) => [r.key as string, i]));
  return [...steps].sort((a, b) => (order.get(a.rule) ?? 99) - (order.get(b.rule) ?? 99));
}

function StepChip({ item, dateTimeFmt }: { item: TimelineItem; dateTimeFmt: (iso: string) => string }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const st = item.step;
  const tone = item.state === 'sent'
    ? { color: KIT.POS, bg: 'rgba(52,211,153,0.08)', line: 'rgba(52,211,153,0.25)' }
    : item.state === 'held'
      ? { color: 'var(--acc-fcd34d)', bg: 'rgba(252,211,77,0.08)', line: 'rgba(252,211,77,0.25)' }
      : item.state === 'upcoming'
        ? { color: KIT.T3, bg: 'transparent', line: KIT.BORDER }
        : { color: KIT.T2, bg: 'rgb(var(--ink)/0.05)', line: KIT.BORDER };
  const status = item.state === 'sent'
    ? t('pe.state.sent').replace('{n}', n(st?.sent ?? 0))
    : item.state === 'scheduled' && st?.nextAt
      ? t('pe.state.scheduled').replace('{date}', dateTimeFmt(st.nextAt))
      : t(`pe.state.${item.state}`);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{ background: tone.bg, border: `1px solid ${tone.line}`, color: tone.color, fontSize: 10.5, fontWeight: 600 }}
      title={t(`pe.rule.${item.rule}.when`)}
    >
      <span aria-hidden>{EMOJI.get(item.rule)}</span>
      {t(`pe.rule.${item.rule}.name`)}
      <span style={{ fontWeight: 500, opacity: 0.85 }}>· {status}</span>
    </span>
  );
}

function RuleCard({ ruleKey, emoji, rule, money }: { ruleKey: EngineRuleKey; emoji: string; rule?: PushCenterRule; money: boolean }) {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const off = rule?.enabled === false;
  const when = t(`pe.rule.${ruleKey}.when`)
    .replace('{days}', n(ruleParam(rule, ruleKey === 'vip_upsell' ? 'days_before' : ruleKey === 'last_tickets' ? 'max_days_before' : 'window_days', ruleKey === 'vip_upsell' ? 3 : ruleKey === 'last_tickets' ? 14 : 5)))
    .replace('{pct}', n(ruleParam(rule, 'threshold_pct', 80)))
    .replace('{hours}', n(ruleParam(rule, 'hours_before', 5)))
    .replace('{minutes}', n(ruleParam(rule, ruleKey === 'doors_open' ? 'minutes_before' : 'delay_minutes', ruleKey === 'doors_open' ? 45 : 45)))
    .replace('{hour}', n(ruleParam(rule, 'start_hour', ruleKey === 'vip_upsell' ? 14 : 12)))
    .replace('{end}', n(ruleParam(rule, 'end_hour', 21)));
  const rate = rule ? tapRate(rule.taps, rule.sent) : null;
  return (
    <div className="rounded-xl p-3.5" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}`, opacity: off ? 0.6 : 1 }}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2" style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 600 }}>
          <span aria-hidden style={{ fontSize: 16 }}>{emoji}</span>{t(`pe.rule.${ruleKey}.name`)}
        </p>
        {off && (
          <span className="rounded-full px-2 py-0.5" style={{ border: `1px solid ${KIT.BORDER}`, color: KIT.T3, fontSize: 10, fontWeight: 600 }}>{t('pe.rules.paused')}</span>
        )}
      </div>
      <p style={{ color: KIT.T2, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
        <Sparkles className="mr-1 inline h-3 w-3" style={{ color: KIT.T3 }} />{when}
      </p>
      <p style={{ color: KIT.T3, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
        <Users className="mr-1 inline h-3 w-3" />{t(`pe.rule.${ruleKey}.who`)}
      </p>
      {rule && rule.sent > 0 && (
        <p className="tabular-nums" style={{ color: KIT.T2, fontSize: 11.5, marginTop: 8 }}>
          {t('pe.rules.stats')
            .replace('{sent}', n(rule.sent))
            .replace('{rate}', rate == null ? '—' : pctFmt(rate, locale))
            .replace('{buyers}', n(rule.buyers))}
          {money && (rule.revenue ?? 0) > 0 && <b style={{ color: KIT.T1 }}> · {eur(rule.revenue ?? 0)}</b>}
        </p>
      )}
    </div>
  );
}
