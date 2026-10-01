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
import { useLanguage } from '@/contexts/LanguageContext';
import { EmptyAnswer, MoreDetail } from '@/components/analytics/kit';
import { CountdownTile } from '@/components/events-sales/EventSalesParts';
import { useEventReport } from '@/hooks/useEventReport';
import { usePosthogEvent } from '@/hooks/usePosthogEvent';
import { marketProps } from '@/lib/geo';
import type { EventSales } from '@/lib/eventsSales';
import { reportHasActivity, type EventReport } from '@/lib/eventReport';
import { ReportSales } from './ReportSales';
import { ReportTrend, type ScopeEventOption } from './ReportTrend';
import { ReportAudience, ReportDrivers, ReportTraffic } from './ReportReach';
import { EmptyNote, Question, ReportCard } from './ui';
import { useScopeEvents } from '@/hooks/useScopeEvents';
import { usePartyBreakdown } from '@/hooks/usePartyBreakdown';
import { SalesCollabCard } from '@/components/event-lens/SalesCollabCard';
import { SubjectHeader } from '@/components/event-lens/SubjectHeader';
import { ReportAnswer } from './ReportAnswer';
import { ReportTakeaways } from './ReportTakeaways';

interface Props {
  eventId: string;
  /** Revenir à « toutes les soirées » (la soirée se choisit dans la colonne de droite). */
  onClear: () => void;
  scope: { venueId?: string | null; organizerUserId?: string | null };
  /** Le verdict d'après-soirée (`EventPostAnalysisView`), rendu en tête une fois la soirée passée. */
  verdict?: ReactNode;
  /** L'âge / le sexe / les villes du public (`EventAudienceDemographics`). */
  demographics?: ReactNode;
  /** La prévision avant la soirée (Hype Score, club) : détail replié. */
  forecast?: ReactNode;
  /** La même prévision en une ligne, posée sous les jauges. */
  projection?: ReactNode;
  /** `/owner` ou `/organizer-app` : où mène le lien du détail « Qui fait vendre ? ». */
  consolePrefix?: string;
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

export function EventReportView({ eventId, onClear, scope, verdict, demographics, forecast, projection, consolePrefix }: Props) {
  const { t } = useLanguage();
  const { data: report, loading, error, fetchedAt } = useEventReport(eventId);
  const events = useScopeEvents(scope);
  // Une fois par soirée ouverte, quand le rapport de CETTE soirée est chargé.
  usePosthogEvent('event_report_opened', report?.event.id === eventId ? eventId : null, {
    scope: report?.scope,
    phase: report?.event.phase,
    ...marketProps({ timezone: report?.tz, eventId, venueId: scope.venueId, organizerUserId: scope.organizerUserId }),
  });

  // Comparaison : choisie par la personne, sinon la soirée précédente dès
  // qu'elle est connue. `undefined` = pas encore décidé, `null` = aucune.
  const [compareChoice, setCompareChoice] = useState<string | null | undefined>(undefined);
  useEffect(() => { setCompareChoice(undefined); }, [eventId]);
  const compareId = compareChoice === undefined ? previousOf(events, report) : compareChoice;
  const { data: compare, loading: compareLoading } = useEventReport(compareId);
  // Soirée à plusieurs : ce que chaque partie a amené (null pour une soirée solo).
  const parties = usePartyBreakdown(report ? eventId : null);

  return (
    <div className="space-y-4">
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
          <SubjectHeader
            event={{ title: report.event.title, startAt: report.event.startAt, poster: report.event.poster, phase: report.event.phase, venueName: report.event.venueName }}
            tz={report.tz}
            fetchedAt={fetchedAt}
            onClear={onClear}
            lead={report.event.phase !== 'after' ? <CountdownTile ev={asSales(report)} /> : undefined}
          />

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
              <ReportTakeaways report={report} />

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

              {parties && consolePrefix && <SalesCollabCard breakdown={parties} eventId={eventId} consolePrefix={consolePrefix} />}

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
