import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { Calendar, Clock, Euro, TrendingUp, Layers, MapPin, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { DJShareCard } from '@/components/dj/DJShareCard';
import {
  DJPage, DJHeading, ZoneHeading, PCard, Sparkline, Pill,
  POS, T1, T2, T3, WARN, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';
import type { DJSet } from '@/contexts/DJDataContext';

export default function DJOverview() {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  // KPIs read the unified agenda (every venue + organizer profile this DJ has),
  // not just the selected venue — otherwise a DJ whose upcoming gigs and earnings
  // sit on another roster sees all zeros. Money is computed from the gig fees
  // (fee_paid flag) which is where the real "paid / owed" signal lives.
  const { dj, allSets, venues, isProfileIncomplete } = useDJData();

  const multiVenue = venues.length > 1;

  const upcoming = useMemo(
    () => allSets.filter(s => new Date(s.start_time) >= new Date()),
    [allSets],
  );
  const pending = useMemo(
    () => allSets.filter(s => !s.fee_paid && s.fee > 0).reduce((sum, s) => sum + s.fee, 0),
    [allSets],
  );
  const received = useMemo(
    () => allSets.filter(s => s.fee_paid && s.fee > 0).reduce((sum, s) => sum + s.fee, 0),
    [allSets],
  );
  // Monthly earnings series for the sparkline — paid gig fees grouped by gig month.
  // allSets is ordered ascending by start_time, so insertion order is chronological.
  const earnSeries = useMemo(() => {
    const grouped: Record<string, number> = {};
    allSets.filter(s => s.fee_paid && s.fee > 0).forEach(s => {
      const m = format(new Date(s.start_time), 'MMM yyyy', { locale: dateLocale });
      grouped[m] = (grouped[m] || 0) + s.fee;
    });
    return Object.values(grouped);
  }, [allSets, dateLocale]);

  if (!dj) return null;
  const displayName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;

  const kpis = [
    { label: t('dj.upcomingSets'), val: String(upcoming.length), icon: <Calendar className="w-4 h-4" />, color: T1, spark: [] as number[] },
    { label: t('dj.totalSets'), val: String(allSets.length), icon: <Clock className="w-4 h-4" />, color: T1, spark: [] as number[] },
    { label: t('dj.pending'), val: `${pending} €`, icon: <Euro className="w-4 h-4" />, color: pending > 0 ? WARN : T1, spark: [] as number[] },
    { label: t('dj.totalReceived'), val: `${received} €`, icon: <TrendingUp className="w-4 h-4" />, color: received > 0 ? POS : T1, spark: earnSeries },
  ];

  const venueLabel = (s: DJSet) => s.venue?.name || s.event?.title || t('dj.planning.booking');

  return (
    <DJPage>
      <DJHeading title={displayName} subtitle={multiVenue ? t('dj.planning.allVenues') : dj.venue?.name} />

      {isProfileIncomplete && (
        <Link to="/dj/profile"
          className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm transition-colors hover:bg-[rgba(234,179,8,0.12)]"
          style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', color: WARN }}>
          <span>{t('dj.completeProfile')}</span>
          <ArrowRight className="h-4 w-4 flex-none" />
        </Link>
      )}

      <ZoneHeading icon={<Layers className="w-4 h-4" />} label={t('dj.overview')} />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => (
          <PCard key={i}>
            <div className="flex flex-col min-h-[112px]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{kpi.label}</span>
                <span style={{ color: T3 }}>{kpi.icon}</span>
              </div>
              <div className="mt-3 text-[clamp(24px,3vw,32px)] font-[640] leading-none tabular-nums"
                style={{ color: kpi.color, letterSpacing: '-0.025em' }}>
                {kpi.val}
              </div>
              {kpi.spark.length > 1 && (
                <div className="mt-auto pt-3 flex justify-end">
                  <Sparkline pts={kpi.spark} accent />
                </div>
              )}
            </div>
          </PCard>
        ))}
      </motion.div>

      {dj.slug && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <DJShareCard slug={dj.slug} stageName={displayName} />
        </motion.div>
      )}

      <PCard
        icon={<Calendar className="w-4 h-4" />}
        title={t('dj.upcomingSets')}
        sub={multiVenue ? t('dj.planning.allVenues') : undefined}
        right={
          <Link to="/dj/planning" className="text-[13px] font-medium inline-flex items-center gap-1 transition-colors hover:text-white" style={{ color: T3 }}>
            {t('dj.mySchedule')}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {upcoming.length === 0 ? (
          <p className="text-sm" style={{ color: T3 }}>{t('dj.noSets')}</p>
        ) : (
          <div className="space-y-2">
            {upcoming.slice(0, 5).map((set, i) => (
              <motion.div
                key={set.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
              >
                <div className="min-w-0">
                  <p className="font-[560] text-sm truncate" style={{ color: T1 }}>
                    {set.event?.title || set.title || format(new Date(set.start_time), 'EEEE d MMMM', { locale: dateLocale })}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs" style={{ color: T3 }}>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock className="h-3 w-3" />
                      {format(new Date(set.start_time), 'EEE d MMM', { locale: dateLocale })} · {format(new Date(set.start_time), 'HH:mm')}
                    </span>
                    <span className="inline-flex items-center gap-1 truncate" style={{ color: T2 }}>
                      <MapPin className="h-3 w-3" />
                      {venueLabel(set)}
                    </span>
                  </div>
                </div>
                {set.fee > 0 && <Pill tone={set.fee_paid ? 'pos' : 'warn'}>{set.fee} €</Pill>}
              </motion.div>
            ))}
          </div>
        )}
      </PCard>
    </DJPage>
  );
}
