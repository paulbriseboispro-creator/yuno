import { useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Clock, MapPin, CalendarDays, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { supabase } from '@/integrations/supabase/client';
import { DJCalendar } from '@/components/dj/DJCalendar';
import { DJPage, DJHeading, PCard, Pill, T1, T2, T3, INNER_BG, BORDER } from '@/components/dj/dj-ui';

export default function DJPlanning() {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj, allSets, venues, refetchAllSets } = useDJData();

  const multiVenue = venues.length > 1;

  const upcoming = useMemo(
    () => allSets.filter(s => new Date(s.start_time) >= new Date()),
    [allSets],
  );

  if (!dj) return null;

  const venueLabel = (s: typeof allSets[number]) =>
    s.venue?.name || s.event?.title || t('dj.planning.booking');

  const toggleVisibility = useCallback(async (setId: string, current: boolean) => {
    // Optimistic update via refetch; the column may default to true on old rows.
    await supabase.from('dj_sets').update({ show_on_profile: !current }).eq('id', setId);
    refetchAllSets();
  }, [refetchAllSets]);

  return (
    <DJPage>
      <DJHeading
        title={t('dj.mySchedule')}
        subtitle={multiVenue ? t('dj.planning.allVenues') : dj.venue?.name}
      />

      {/* Unified calendar — every gig across all clubs/orgs */}
      <DJCalendar
        sets={allSets.map(s => ({ ...s, dj: { first_name: dj.first_name, last_name: dj.last_name, stage_name: dj.stage_name } }))}
        showDJNames={false}
      />

      {/* Upcoming gigs, labelled by club so cross-venue context is obvious */}
      <PCard icon={<CalendarDays className="w-4 h-4" />} title={t('dj.upcomingSets')} sub={multiVenue ? t('dj.planning.allVenues') : undefined}>
        {upcoming.length === 0 ? (
          <p className="text-sm" style={{ color: T3 }}>{t('dj.noSets')}</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="min-w-0 flex-1">
                  <p className="font-[560] text-sm truncate" style={{ color: T1 }}>
                    {s.event?.title || s.title || format(new Date(s.start_time), 'EEEE d MMMM', { locale: dateLocale })}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs" style={{ color: T3 }}>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock className="h-3 w-3" />
                      {format(new Date(s.start_time), 'EEE d MMM', { locale: dateLocale })} · {format(new Date(s.start_time), 'HH:mm')}
                    </span>
                    <span className="inline-flex items-center gap-1 truncate" style={{ color: T2 }}>
                      <MapPin className="h-3 w-3" />
                      {venueLabel(s)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-none">
                  {s.fee > 0 && (
                    <Pill tone={s.fee_paid ? 'pos' : 'warn'}>{s.fee} €</Pill>
                  )}
                  {/* Only sets linked to a public event can appear on the profile. */}
                  {s.event_id && (
                    <button
                      title={s.show_on_profile !== false ? t('dj.planning.hideFromProfile') : t('dj.planning.showOnProfile')}
                      onClick={() => toggleVisibility(s.id, s.show_on_profile !== false)}
                      className="rounded-lg p-1.5 transition-colors hover:bg-white/10"
                    >
                      {s.show_on_profile !== false
                        ? <Eye className="h-4 w-4" style={{ color: T2 }} />
                        : <EyeOff className="h-4 w-4" style={{ color: T3 }} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PCard>
    </DJPage>
  );
}
