import { motion } from 'framer-motion';
import { DollarSign, Ticket, ShoppingCart, Clock, CheckCircle, TrendingUp, Users, RotateCcw, Shirt } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LiveKPIs } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  kpis: LiveKPIs;
}

export function LiveKPIBar({ kpis }: Props) {
  const { t } = useLanguage();

  const cards = [
    { key: 'revenue',   label: t('live.revenue'),      value: `${kpis.revenue.toFixed(0)} €`, icon: DollarSign,  iconColor: POS },
    { key: 'tickets',   label: t('live.ticketsSold'),  value: kpis.ticketsSold,               icon: Ticket,       iconColor: T3 },
    { key: 'orders',    label: t('live.ordersPlaced'), value: kpis.ordersPlaced,              icon: ShoppingCart, iconColor: T3 },
    { key: 'pending',   label: t('live.pending'),      value: kpis.ordersPending,             icon: Clock,        iconColor: kpis.ordersPending > 5 ? '#FCD34D' : T3 },
    { key: 'completed', label: t('live.completed'),    value: kpis.ordersCompleted,           icon: CheckCircle,  iconColor: POS },
    { key: 'avg',       label: t('live.avgOrder'),     value: `${kpis.avgOrderValue.toFixed(0)} €`, icon: TrendingUp, iconColor: T3 },
    { key: 'entries',   label: t('live.entries'),      value: kpis.entriesCount,              icon: Users,        iconColor: T3 },
    { key: 'refunds',   label: t('live.refunds'),      value: kpis.refundsCount,              icon: RotateCcw,    iconColor: kpis.refundsCount > 0 ? NEG : T3 },
    ...(kpis.cloakroomCount > 0
      ? [{ key: 'cloakroom', label: t('live.cloakroom'), value: kpis.cloakroomCount, icon: Shirt, iconColor: T3 }]
      : []),
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card, i) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
            style={{
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 18,
              boxShadow: CARD_SHADOW,
              padding: '16px 18px',
              overflow: 'hidden',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {card.label}
              </span>
              <Icon className="h-3.5 w-3.5" style={{ color: card.iconColor }} />
            </div>
            <p className="tabular-nums leading-none" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>
              {card.value}
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}
