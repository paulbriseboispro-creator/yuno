import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { BarChart3, Music, Euro, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import {
  DJPage, DJHeading, PCard, MonthlyBars,
  POS, T1, T3, WARN, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';

export default function DJPayments() {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj, sets, payments, totalPaid, pendingAmount, chartData } = useDJData();

  if (!dj) return null;

  const feeSets = sets.filter(s => s.fee > 0);

  return (
    <DJPage>
      <DJHeading title={t('dj.myPayments')} subtitle={dj.venue?.name} />

      {chartData.length > 0 && (
        <PCard
          icon={<BarChart3 className="w-4 h-4" />}
          title={t('dj.monthlyEarnings')}
          right={
            <div className="text-right">
              <div className="text-[clamp(20px,2.5vw,26px)] font-[640] tabular-nums leading-none" style={{ color: POS, letterSpacing: '-0.025em' }}>
                {totalPaid} €
              </div>
              <div className="text-xs mt-1" style={{ color: T3 }}>{t('dj.totalReceived')}</div>
            </div>
          }
        >
          <MonthlyBars data={chartData} />
        </PCard>
      )}

      {feeSets.length > 0 && (
        <PCard icon={<Music className="w-4 h-4" />} title={t('dj.perSetBreakdown')}>
          <div className="space-y-2">
            {feeSets
              .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
              .map(set => (
                <div key={set.id} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <div className="min-w-0">
                    <p className="font-[560] text-sm truncate" style={{ color: T1 }}>{set.title || set.event?.title || t('dj.set')}</p>
                    <p className="text-xs truncate" style={{ color: T3 }}>
                      {format(new Date(set.start_time), 'dd MMM yyyy', { locale: dateLocale })}
                      {set.venue && ` • ${set.venue.name}`}
                    </p>
                  </div>
                  <div className="text-right flex-none">
                    <span className="font-[640] text-sm tabular-nums" style={{ color: set.fee_paid ? POS : WARN }}>{set.fee} €</span>
                    <p className="text-[10px]" style={{ color: T3 }}>{set.fee_paid ? t('dj.paid') : t('dj.pending')}</p>
                  </div>
                </div>
              ))}
          </div>
        </PCard>
      )}

      <PCard icon={<Euro className="w-4 h-4" />} title={t('dj.paymentHistory')}>
        {payments.length === 0 ? (
          <p className="text-sm" style={{ color: T3 }}>{t('dj.noPayments')}</p>
        ) : (
          <div className="space-y-2">
            {payments.map(payment => (
              <div key={payment.id} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="min-w-0">
                  <p className="font-[560] text-sm truncate" style={{ color: T1 }}>{payment.description || t('dj.payment')}</p>
                  <p className="text-xs" style={{ color: T3 }}>{format(new Date(payment.paid_at), 'dd MMMM yyyy', { locale: dateLocale })}</p>
                </div>
                <span className="font-[640] tabular-nums flex-none inline-flex items-center gap-1" style={{ color: POS }}>
                  <ArrowUpRight className="h-3.5 w-3.5" />+{payment.amount} €
                </span>
              </div>
            ))}
          </div>
        )}
      </PCard>

      {/* Pending strip — quick read on what's still owed across the period. */}
      {pendingAmount > 0 && (
        <PCard>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{t('dj.pending')}</span>
            <span className="text-xl font-[640] tabular-nums" style={{ color: WARN }}>{pendingAmount} €</span>
          </div>
        </PCard>
      )}
    </DJPage>
  );
}
