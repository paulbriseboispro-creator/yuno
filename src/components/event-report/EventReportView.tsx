/**
 * Rapport de soirée — Analytics › Soirée, club ET organisateur.
 *
 * Une adresse par soirée (`?tab=event&event=<id>`), qui change de visage selon
 * le moment : AVANT et PENDANT, les ventes mènent ; APRÈS, le verdict passe en
 * tête. Cinq questions, toujours dans le même ordre (grammaire Shotgun, trois
 * piliers Yuno) :
 *   1. Où en sont mes ventes ?        2. Comment évoluent-elles ?
 *   3. Est-ce qu'on voit ma soirée ?  4. Qui achète ?
 *   5. Qu'est-ce qui a fait vendre ?
 * Tout vient de `get_event_report` ; la comparaison rappelle la même RPC.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmptyAnswer, MoreDetail, UpdatedAt } from '@/components/analytics/kit';
import { KIT } from '@/components/analytics/kitFormat';
import { CountdownTile } from '@/components/events-sales/EventSalesParts';
import { useEventReport } from '@/hooks/useEventReport';
import type { EventSales } from '@/lib/eventsSales';
import { reportHasActivity, type EventReport } from '@/lib/eventReport';
import { ReportSales } from './ReportSales';
import { ReportTrend, type ScopeEventOption } from './ReportTrend';
import { ReportAudience, ReportDrivers, ReportTraffic } from './ReportReach';
import { EmptyNote, Question, ReportCard } from './ui';
import { ReportAnswer } from './ReportAnswer';

interface Props {
  eventId: string;
  onEventChange: (eventId: string) => void;
  onBack: () => void;
  scope: { venueId?: string | null; organizerUserId?: string | null };
  /** Le verdict d'après-soirée (`EventPostAnalysisView`), rendu en tête une fois la soirée passée. */
  verdict?: ReactNode;
  /** L'âge / le sexe / les villes du public (`EventAudienceDemographics`). */
  demographics?: ReactNode;
  /** La prévision avant la soirée (Hype Score, club) : détail replié. */
  forecast?: ReactNode;
  /** La même prévision en une ligne, posée sous les jauges. */
  projection?: ReactNode;
}

/** Les soirées de la portée, pour changer de soirée et pour comparer. */
function useScopeEvents(scope: Props['scope']) {
  const [events, setEvents] = useState<ScopeEventOption[]>([]);
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  useEffect(() => {
    if (!venueId && !organizerUserId) return;
    let cancelled = false;
    (async () => {
      const filter = venueId
        ? `venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`
        : `organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`;
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at')
        .or(filter)
        .is('cancelled_at', null)
        .order('start_at', { ascending: false })
        .limit(120);
      if (!cancelled) setEvents((data ?? []).map((e) => ({ id: e.id, title: e.title, startAt: e.start_at })));
    })();
    return () => { cancelled = true; };
  }, [venueId, organizerUserId]);
  return events;
}

/** Soirée comparée par défaut : la précédente de la portée (celle d'avant, déjà passée). */
function previousOf(events: ScopeEventOption[], current: EventReport | null): string | null {
  if (!current) return null;
  const start = new Date(current.event.startAt).getTime();
  const prev = events
    .filter((e) => e.id !== current.event.id && new Date(e.startAt).getTime() < start)
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0];
  return prev?.id ?? null;
}

/** « dimanche 27 septembre » → « Dimanche 27 septembre » (une seule majuscule). */
function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Adapte le rapport au format du compte à rebours partagé avec la liste des soirées. */
function asSales(r: EventReport): EventSales {
  return {
    id: r.event.id, title: r.event.title, startAt: r.event.startAt, endAt: r.event.endAt, poster: r.event.poster,
    status: r.event.status, isActive: true, publishedAt: r.event.publishedAt, dayStart: r.dayStart,
    tickets: { ...r.totals.tickets }, tables: { ...r.totals.tables }, guestList: { ...r.totals.guestList },
    drinks: r.totals.drinks, visits: { total: r.totals.visits.total, today: r.totals.visits.today }, revenue: r.totals.revenue,
  };
}

export function EventReportView({ eventId, onEventChange, onBack, scope, verdict, demographics, forecast, projection }: Props) {
  const { t, language } = useLanguage();
  const { data: report, loading, error, fetchedAt } = useEventReport(eventId);
  const events = useScopeEvents(scope);

  // Comparaison : choisie par la personne, sinon la soirée précédente dès
  // qu'elle est connue. `undefined` = pas encore décidé, `null` = aucune.
  const [compareChoice, setCompareChoice] = useState<string | null | undefined>(undefined);
  useEffect(() => { setCompareChoice(undefined); }, [eventId]);
  const compareId = compareChoice === undefined ? previousOf(events, report) : compareChoice;
  const { data: compare, loading: compareLoading } = useEventReport(compareId);

  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: report?.tz ?? 'Europe/Paris' });
  const optionFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/Paris' });

  return (
    <div className="space-y-4">
      {/* ── En-tête : la soirée, son moment, et le sélecteur toujours au même endroit ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: KIT.T3 }}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t('owner.an.backToEvents')}
        </button>
        <label className="inline-flex min-w-0 items-center gap-2 text-[12px]" style={{ color: KIT.T3 }}>
          {t('er.pickEvent')}
          <select
            id="er-event"
            value={eventId}
            onChange={(e) => e.target.value && onEventChange(e.target.value)}
            className="max-w-[260px] cursor-pointer truncate rounded-lg px-2.5 py-1.5 text-[12.5px]"
            style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, outline: 'none' }}
          >
            {!events.some((e) => e.id === eventId) && <option value={eventId}>{report?.event.title ?? '…'}</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title} · {optionFmt.format(new Date(e.startAt))}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <ReportCard><EmptyNote text={t(`er.error.${error}`)} /></ReportCard>
      ) : !report ? (
        <div className="space-y-3" aria-busy>
          {[120, 260, 200].map((h, i) => (
            <div key={i} className="animate-pulse rounded-2xl" style={{ height: h, background: 'rgb(var(--ink)/0.04)' }} />
          ))}
        </div>
      ) : (
        <>
          <ReportCard>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              {report.event.phase !== 'after' && <CountdownTile ev={asSales(report)} />}
              {report.event.poster && (
                <img src={report.event.poster} alt="" className="h-16 w-16 flex-none rounded-xl object-cover" />
              )}
              <div className="min-w-[180px] flex-1">
                <h1 style={{ color: KIT.T1, fontSize: 20, fontWeight: 680, letterSpacing: '-0.02em', textWrap: 'balance' }}>{report.event.title}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: KIT.T3, fontSize: 12.5 }}>
                  <span>{capitalizeFirst(dateFmt.format(new Date(report.event.startAt)))}</span>
                  {report.event.venueName && (
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{report.event.venueName}</span>
                  )}
                </p>
              </div>
              <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end sm:gap-1">
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={
                  report.event.phase === 'live'
                    ? { background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)' }
                    : report.event.phase === 'after'
                      ? { background: 'rgb(var(--ink)/0.06)', color: KIT.T2 }
                      : { background: 'rgba(52,211,153,0.12)', color: 'var(--acc-34d399)' }
                }>
                  {t(`er.phase.${report.event.phase}`)}
                </span>
                <UpdatedAt at={fetchedAt} />
              </div>
            </div>
          </ReportCard>

          {!reportHasActivity(report) ? (
            // Une soirée sans aucune vente ni entrée ne se note pas et n'étale
            // pas dix cartes à zéro : une phrase suffit.
            <EmptyAnswer
              title={t(report.event.phase === 'after' ? 'er.empty.after' : 'er.empty.before')}
              body={t(report.event.phase === 'after' ? 'er.empty.afterBody' : 'er.empty.beforeBody')}
            />
          ) : (
            <>
              {/* La réponse d'abord, en une phrase. */}
              <ReportAnswer report={report} compare={compareId ? compare : null} />

              {/* Après la soirée, le bilan détaillé (note, à retenir, déroulé)
                  est replié : la phrase et les jauges disent déjà l'essentiel. */}
              {report.event.phase === 'after' && verdict && (
                <MoreDetail label={t('er.more.verdict')}>{verdict}</MoreDetail>
              )}

              <Question id="er-sales"
                title={t(report.event.phase === 'after' ? 'er.q.salesAfter' : 'er.q.sales')}
                sub={t(report.event.phase === 'after' ? 'er.q.salesAfterSub' : 'er.q.salesSub')} />
              <ReportSales
                report={report}
                compare={compareId ? compare : null}
                projection={report.event.phase !== 'after' ? projection : undefined}
              />

              <Question id="er-trend" title={t('er.q.trend')} sub={t('er.q.trendSub')} />
              <ReportTrend
                report={report}
                compare={compareId ? compare : null}
                compareId={compareId}
                onCompare={(id) => setCompareChoice(id)}
                options={events}
                compareLoading={!!compareId && compareLoading}
              />

              {/* Trafic et canaux : une seule question, « d'où viennent les ventes ? ». */}
              <Question id="er-reach" title={t('er.q.reach2')} sub={t('er.q.reach2Sub')} />
              <ReportTraffic report={report} />
              <ReportDrivers report={report} />

              <Question id="er-who" title={t('er.q.who')} sub={t('er.q.whoSub')} />
              <ReportAudience report={report} demographics={demographics} />

              {report.event.phase !== 'after' && forecast && (
                <MoreDetail label={t('er.more.forecast')}>{forecast}</MoreDetail>
              )}
            </>
          )}
        </>
      )}
      {loading && report && <span className="sr-only">{t('er.loading')}</span>}
    </div>
  );
}
