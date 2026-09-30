/**
 * En-tête commun des lentilles Trafic et Communauté d'une soirée : retour,
 * sélecteur de soirée (toujours au même endroit), onglets de lentille, puis
 * la carte de la soirée (affiche, titre, date, moment). Le Rapport de soirée
 * (Ventes) garde sa propre carte — elle porte le compte à rebours — mais
 * partage la ligne du haut et les onglets.
 */
import { ArrowLeft, MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { UpdatedAt } from '@/components/analytics/kit';
import { KIT } from '@/components/analytics/kitFormat';
import { ReportCard } from '@/components/event-report/ui';
import { useScopeEvents } from '@/hooks/useScopeEvents';
import type { AnalyticsFamily } from '@/lib/analyticsNav';
import type { EventLens } from '@/lib/eventLens';
import { EventLensTabs } from './EventLensTabs';

interface Props {
  lens: EventLens;
  eventId: string;
  onEventChange: (eventId: string) => void;
  onBack: () => void;
  go: (family: AnalyticsFamily, view?: string) => void;
  scope: { venueId?: string | null; organizerUserId?: string | null };
  /** La soirée, une fois lue (le titre du sélecteur et la carte en dépendent). */
  event: { title: string; startAt: string; poster: string | null; phase: 'before' | 'live' | 'after' } | null;
  tz?: string;
  fetchedAt: Date | null;
  /** Quand la personne s'occupe d'une soirée d'un autre lieu (collab), son nom. */
  venueName?: string | null;
}

/** « dimanche 27 septembre » → « Dimanche 27 septembre » (une seule majuscule). */
const capitalizeFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function EventLensHeader({ lens, eventId, onEventChange, onBack, go, scope, event, tz = 'Europe/Paris', fetchedAt, venueName }: Props) {
  const { t, language } = useLanguage();
  const events = useScopeEvents(scope);
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz });
  const optionFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/Paris' });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: KIT.T3 }}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t('owner.an.backToEvents')}
        </button>
        <label className="inline-flex min-w-0 items-center gap-2 text-[12px]" style={{ color: KIT.T3 }}>
          {t('er.pickEvent')}
          <select
            value={eventId}
            onChange={(e) => e.target.value && onEventChange(e.target.value)}
            className="max-w-[260px] cursor-pointer truncate rounded-lg px-2.5 py-1.5 text-[12.5px]"
            style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, outline: 'none' }}
          >
            {!events.some((e) => e.id === eventId) && <option value={eventId}>{event?.title ?? '…'}</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title} · {optionFmt.format(new Date(e.startAt))}</option>
            ))}
          </select>
        </label>
      </div>

      <EventLensTabs active={lens} go={go} />

      {event && (
        <ReportCard>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {event.poster && <img src={event.poster} alt="" className="h-16 w-16 flex-none rounded-xl object-cover" />}
            <div className="min-w-[180px] flex-1">
              <h1 style={{ color: KIT.T1, fontSize: 20, fontWeight: 680, letterSpacing: '-0.02em', textWrap: 'balance' }}>{event.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: KIT.T3, fontSize: 12.5 }}>
                <span>{capitalizeFirst(dateFmt.format(new Date(event.startAt)))}</span>
                {venueName && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{venueName}</span>}
              </p>
            </div>
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end sm:gap-1">
              <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={
                event.phase === 'live'
                  ? { background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)' }
                  : event.phase === 'after'
                    ? { background: 'rgb(var(--ink)/0.06)', color: KIT.T2 }
                    : { background: 'rgba(52,211,153,0.12)', color: 'var(--acc-34d399)' }
              }>
                {t(`er.phase.${event.phase}`)}
              </span>
              <UpdatedAt at={fetchedAt} />
            </div>
          </div>
        </ReportCard>
      )}
    </div>
  );
}
