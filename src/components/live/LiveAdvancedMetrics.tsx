import { motion } from 'framer-motion';
import { Users, Timer, Activity, RotateCcw, Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LiveAdvancedMetrics } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  metrics: LiveAdvancedMetrics;
}

export function LiveAdvancedMetricsBar({ metrics }: Props) {
  const { t } = useLanguage();

  const cards = [
    {
      key: 'attendance',
      label: t('live.adv.attendance'),
      value: `${metrics.attendanceRate}%`,
      icon: Users,
      color: metrics.attendanceRate >= 70 ? POS : metrics.attendanceRate >= 40 ? '#FCD34D' : T3,
      hint: t('live.adv.attendanceHint'),
    },
    {
      key: 'prep',
      label: t('live.adv.prep'),
      value: `${metrics.avgPrepMinutes} min`,
      icon: Timer,
      color: metrics.avgPrepMinutes <= 5 ? POS : metrics.avgPrepMinutes <= 10 ? '#FCD34D' : NEG,
      hint: t('live.adv.prepHint'),
    },
    {
      key: 'throughput',
      label: t('live.adv.throughput'),
      value: `${metrics.ordersPerMinuteLive}/min`,
      icon: Activity,
      color: T2,
      hint: t('live.adv.throughputHint'),
    },
    {
      key: 'refunds',
      label: t('live.adv.refundRate'),
      value: `${metrics.refundRatePct}%`,
      icon: RotateCcw,
      color: metrics.refundRatePct === 0 ? T3 : metrics.refundRatePct < 3 ? '#FCD34D' : NEG,
      hint: t('live.adv.refundRateHint'),
    },
    {
      key: 'rpa',
      label: t('live.adv.revenuePerAttendee'),
      value: `${metrics.revenuePerAttendee} €`,
      icon: Wallet,
      color: POS,
      hint: t('live.adv.revenuePerAttendeeHint'),
    },
  ];

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
        {t('live.adv.title')}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', lineHeight: 1.3 }}>
                  {card.label}
                </span>
                <Icon className="h-3.5 w-3.5" style={{ color: card.color }} />
              </div>
              <p className="tabular-nums" style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', lineHeight: 1 }}>
                {card.value}
              </p>
              <p style={{ color: T3, fontSize: 10, marginTop: 4 }}>{card.hint}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
