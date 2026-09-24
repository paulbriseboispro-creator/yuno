import { motion } from 'framer-motion';
import { Users, Timer, Activity, RotateCcw, Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LiveAdvancedMetrics } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS      = 'var(--acc-34d399)';
const NEG      = 'var(--acc-ff5c63)';
const T1       = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2       = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3       = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER   = 'rgb(var(--ink)/0.085)';
const TILE_BG  = 'rgb(var(--ink)/0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

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
      color: metrics.attendanceRate >= 70 ? POS : metrics.attendanceRate >= 40 ? 'var(--acc-fcd34d)' : T3,
      hint: t('live.adv.attendanceHint'),
    },
    {
      key: 'prep',
      label: t('live.adv.prep'),
      value: `${metrics.avgPrepMinutes} min`,
      icon: Timer,
      color: metrics.avgPrepMinutes <= 5 ? POS : metrics.avgPrepMinutes <= 10 ? 'var(--acc-fcd34d)' : NEG,
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
      color: metrics.refundRatePct === 0 ? T3 : metrics.refundRatePct < 3 ? 'var(--acc-fcd34d)' : NEG,
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
