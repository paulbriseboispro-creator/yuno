import { motion } from 'framer-motion';
import { Users, Wallet, TrendingUp, TrendingDown, Minus, Wine, PartyPopper, CreditCard, Percent, Timer, Star, Repeat, DoorOpen, Ticket, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ExtendedStatsData } from '@/hooks/usePostEventAnalysis';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PostEventExtendedStatsProps {
  stats: ExtendedStatsData;
}

type Stat = { icon: typeof Users; label: string; value: string | number; change?: number; sub?: string };

export function PostEventExtendedStats({ stats }: PostEventExtendedStatsProps) {
  const { t } = useLanguage();
  const dash = '—';

  // Grouped into meaningful clusters so the block reads as labeled chapters,
  // not a flat wall of 12 equal-weight numbers.
  const groups: { label: string; items: Stat[] }[] = [
    {
      label: t('postEvent.grpCrowd'),
      items: [
        { icon: Users,    label: t('postEvent.attendees'),   value: stats.attendance, change: stats.attendanceChange },
        { icon: DoorOpen, label: t('postEvent.showUp'),      value: stats.showUpRate != null ? `${Math.round(stats.showUpRate)}%` : dash },
        { icon: Ticket,   label: t('postEvent.sellThrough'), value: stats.sellThrough != null ? `${Math.round(stats.sellThrough)}%` : dash },
        { icon: Timer,    label: t('postEvent.medianArrival'), value: stats.medianArrival ?? dash },
      ],
    },
    {
      label: t('postEvent.grpMoney'),
      items: [
        { icon: Wallet,      label: t('postEvent.revenuePerHead'), value: `${stats.revenuePerHead.toFixed(0)} €`, change: stats.revenuePerHeadChange },
        { icon: CreditCard,  label: t('postEvent.avgBasket'),      value: `${stats.avgOrderValue.toFixed(0)} €` },
        { icon: PartyPopper, label: t('postEvent.peakRevenue'),    value: `${stats.peakHourRevenue} €`, sub: stats.peakHourLabel },
        { icon: RotateCcw,   label: t('postEvent.refunds'),        value: `${stats.refunds.toFixed(0)} €` },
      ],
    },
    {
      label: t('postEvent.grpBar'),
      items: [
        { icon: Wine,    label: t('postEvent.drinksPerPerson'), value: stats.drinksPerPerson.toFixed(1), change: stats.drinksPerPersonChange },
        { icon: Percent, label: t('postEvent.drinkRedemption'), value: stats.drinkRedemption != null ? `${Math.round(stats.drinkRedemption)}%` : dash },
      ],
    },
    {
      label: t('postEvent.grpLoyalty'),
      items: [
        { icon: Star,   label: t('postEvent.vipTables'),        value: stats.tablesBooked, sub: `${stats.tablesRevenue} €` },
        { icon: Repeat, label: t('postEvent.returningClients'), value: `${Math.round(stats.returningRate)}%` },
      ],
    },
  ];

  let order = 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>
          {t('postEvent.detailedStats')}
        </h3>

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                {group.label}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {group.items.map((stat) => {
                  const Icon = stat.icon;
                  const delay = (order++) * 0.025;
                  return (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, delay }}
                      style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-6 h-6 flex items-center justify-center rounded-lg flex-none" style={{ background: C_FAINT }}>
                          <Icon className="h-3 w-3" style={{ color: T2 }} />
                        </div>
                        <p style={{ color: T3, fontSize: 10, fontWeight: 500 }} className="truncate">{stat.label}</p>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="tabular-nums" style={{ color: T1, fontSize: 17, fontWeight: 640, letterSpacing: '-0.02em' }}>
                          {stat.value}
                        </span>
                        {stat.change !== undefined && (
                          <span className="flex items-center tabular-nums" style={{ color: stat.change > 0 ? POS : stat.change < 0 ? NEG : T3, fontSize: 10.5, fontWeight: 600 }}>
                            {stat.change > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : stat.change < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                          </span>
                        )}
                      </div>
                      {stat.sub && (
                        <p style={{ color: T3, fontSize: 10.5, marginTop: 2 }} className="truncate">{stat.sub}</p>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
