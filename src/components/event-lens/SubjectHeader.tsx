/**
 * L'en-tête d'une vue d'ensemble : CE QU'ON REGARDE. Toutes les soirées sur une
 * période (avec son sélecteur), ou UNE soirée choisie dans la colonne de droite
 * (affiche, titre, date, moment, et un bouton pour revenir à toutes les soirées).
 * Partagé par Ventes, Trafic et Communauté : on lit le même en-tête partout.
 */
import { MapPin, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { UpdatedAt } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { ReportCard } from '@/components/event-report/ui';

export interface SubjectEvent {
  title: string;
  startAt: string;
  poster: string | null;
  phase: 'before' | 'live' | 'after';
  venueName?: string | null;
}

interface Props {
  /** La soirée regardée ; `null` = toutes les soirées sur la période. */
  event: SubjectEvent | null;
  tz?: string;
  fetchedAt: Date | null;
  /** Nombre de soirées concernées (vue période). */
  nights?: number | null;
  onClear: () => void;
  /** Un nœud à droite du bloc d'une soirée (ex. le compte à rebours du rapport). */
  lead?: React.ReactNode;
}

const capitalizeFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function SubjectHeader({ event, tz = 'Europe/Paris', fetchedAt, nights, onClear, lead }: Props) {
  const { t, language } = useLanguage();
  const { n } = useNumberFormat();
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz });

  if (!event) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 style={{ color: KIT.T1, fontSize: 17, fontWeight: 650, letterSpacing: '-0.015em' }}>{t('evl.rail.all')}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: KIT.T3, fontSize: 12 }}>
            {nights != null && <span>{t(nights === 1 ? 'evl.subject.nightsOne' : 'evl.subject.nights').replace('{n}', n(nights))}</span>}
            <UpdatedAt at={fetchedAt} />
          </p>
        </div>
        <PeriodSelector />
      </div>
    );
  }

  return (
    <ReportCard>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {lead}
        {event.poster && <img src={event.poster} alt="" className="h-16 w-16 flex-none rounded-xl object-cover" />}
        <div className="min-w-[180px] flex-1">
          <h2 style={{ color: KIT.T1, fontSize: 20, fontWeight: 680, letterSpacing: '-0.02em', textWrap: 'balance' }}>{event.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: KIT.T3, fontSize: 12.5 }}>
            <span>{capitalizeFirst(dateFmt.format(new Date(event.startAt)))}</span>
            {event.venueName && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{event.venueName}</span>}
          </p>
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end sm:gap-2">
          <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={
            event.phase === 'live'
              ? { background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)' }
              : event.phase === 'after'
                ? { background: 'rgb(var(--ink)/0.06)', color: KIT.T2 }
                : { background: 'rgba(52,211,153,0.12)', color: 'var(--acc-34d399)' }
          }>
            {t(`er.phase.${event.phase}`)}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-medium transition-colors duration-150 hover:opacity-80 focus-visible:outline focus-visible:outline-2"
            style={{ background: 'rgb(var(--ink)/0.05)', border: `1px solid ${KIT.BORDER}`, color: KIT.T2 }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />{t('evl.subject.clear')}
          </button>
          <UpdatedAt at={fetchedAt} />
        </div>
      </div>
    </ReportCard>
  );
}
