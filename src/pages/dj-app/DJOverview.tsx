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

export default function DJOverview() {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj, sets, upcomingSets, pendingAmount, totalPaid, chartData, isProfileIncomplete } = useDJData();

  if (!dj) return null;
  const displayName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;

  const kpis = [
    { label: t('dj.upcomingSets'), val: String(upcomingSets.length), icon: <Calendar className="w-4 h-4" />, color: T1, spark: [] as number[] },
    { label: t('dj.totalSets'), val: String(sets.length), icon: <Clock className="w-4 h-4" />, color: T1, spark: [] as number[] },
    { label: t('dj.pending'), val: `${pendingAmount} €`, icon: <Euro className="w-4 h-4" />, color: pendingAmount > 0 ? WARN : T1, spark: [] as number[] },
    { label: t('dj.totalReceived'), val: `${totalPaid} €`, icon: <TrendingUp className="w-4 h-4" />, color: totalPaid > 0 ? POS : T1, spark: chartData.map(d => d.amount) },
  ];

  return (
    <DJPage>
      <DJHeading title={displayName} subtitle={dj.venue?.name} />

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
        right={
          <Link to="/dj/planning" className="text-[13px] font-medium inline-flex items-center gap-1 transition-colors hover:text-white" style={{ color: T3 }}>
            {t('dj.mySchedule')}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {upcomingSets.length === 0 ? (
          <p className="text-sm" style={{ color: T3 }}>{t('dj.noSets')}</p>
        ) : (
          <div className="space-y-2">
            {upcomingSets.slice(0, 5).map((set, i) => (
              <motion.div
                key={set.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-xl p-3.5 space-y-2"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-[560] text-sm truncate" style={{ color: T1 }}>
                    {set.event?.title || format(new Date(set.start_time), 'EEEE d MMMM', { locale: dateLocale })}
                  </p>
                  {set.fee > 0 && <Pill tone={set.fee_paid ? 'pos' : 'warn'}>{set.fee} € {set.fee_paid ? `· ${t('dj.paid')}` : ''}</Pill>}
                </div>
                <div className="flex items-center gap-2 text-sm" style={{ color: T2 }}>
                  <Clock className="h-3.5 w-3.5" style={{ color: T3 }} />
                  <span className="tabular-nums">{format(new Date(set.start_time), 'HH:mm')} - {format(new Date(set.end_time), 'HH:mm')}</span>
                  {set.music_genre && <span style={{ color: T3 }}>• {set.music_genre}</span>}
                </div>
                {set.venue?.address && (
                  <div className="flex items-center gap-2 text-sm" style={{ color: T2 }}>
                    <MapPin className="h-3.5 w-3.5" style={{ color: T3 }} />
                    {set.venue.address}
                  </div>
                )}
                {set.notes && <p className="text-xs italic" style={{ color: T3 }}>{set.notes}</p>}
              </motion.div>
            ))}
          </div>
        )}
      </PCard>
    </DJPage>
  );
}
