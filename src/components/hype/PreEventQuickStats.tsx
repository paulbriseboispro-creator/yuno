import { motion } from 'framer-motion';
import { Eye, Ticket, Target, TrendingUp, TrendingDown, Users, Clock, Heart, Zap, ShoppingCart } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PreEventQuickStatsData } from '@/hooks/useHypeScore';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS     = '#34D399';
const NEG     = '#FF5C63';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const BORDER  = 'rgba(255,255,255,0.085)';
const TILE_BG = 'rgba(255,255,255,0.025)';
const C_FAINT = 'rgba(255,255,255,0.06)';

interface PreEventQuickStatsProps {
  stats: PreEventQuickStatsData;
}

export function PreEventQuickStats({ stats }: PreEventQuickStatsProps) {
  const { t } = useLanguage();

  const heroStats = [
    { icon: Eye,    label: t('hype.views24h'),    value: stats.pageViews, change: stats.pageViewsChange },
    { icon: Ticket, label: t('hype.ticketsSold'), value: stats.ticketsSold, change: stats.ticketsChange },
    { icon: Target, label: t('hype.conversion'),  value: `${Math.min(100, stats.conversionRate).toFixed(1)}%` },
    { icon: Users,  label: t('hype.filling'),     value: `${stats.targetCompletion}%` },
  ];

  const secondaryStats = [
    { icon: ShoppingCart, label: t('hype.cartAdds'),     value: stats.cartAdds, subValue: `${stats.cartRate.toFixed(1)}%` },
    { icon: Clock,        label: t('hype.avgTime'),      value: `${stats.avgTimeOnPage}s` },
    { icon: Heart,        label: t('hype.favorites'),    value: stats.favoritesCount },
    { icon: Zap,          label: t('hype.velocity12h'), value: stats.velocityLast12h },
  ];

  return (
    <div className="space-y-3">
      {/* Hero KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {heroStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}
            >
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 flex items-center justify-center rounded-lg flex-none" style={{ background: C_FAINT }}>
                  <Icon className="h-3.5 w-3.5" style={{ color: T2 }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: T3, fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {stat.label}
                  </p>
                  <span className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', display: 'block', lineHeight: 1.2, marginTop: 2 }}>
                    {stat.value}
                  </span>
                  {stat.change !== undefined && (
                    <span className="flex items-center tabular-nums" style={{ color: stat.change > 0 ? POS : stat.change < 0 ? NEG : T3, fontSize: 11.5, fontWeight: 600 }}>
                      {stat.change > 0 ? <TrendingUp className="h-3 w-3 mr-0.5" /> : stat.change < 0 ? <TrendingDown className="h-3 w-3 mr-0.5" /> : null}
                      {stat.change > 0 ? '+' : ''}{stat.change}%
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-4 gap-2">
        {secondaryStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.3 + index * 0.05 }}
              className="flex flex-col items-center"
              style={{ padding: '8px 6px', borderRadius: 10, background: 'rgba(255,255,255,0.018)', border: 'rgba(255,255,255,0.04) 1px solid' }}
            >
              <Icon className="h-3.5 w-3.5 mb-1" style={{ color: T3 }} />
              <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{stat.value}</span>
              {(stat as any).subValue && (
                <span className="tabular-nums" style={{ color: T3, fontSize: 10 }}>{(stat as any).subValue}</span>
              )}
              <span style={{ color: T3, fontSize: 9.5, textAlign: 'center', marginTop: 2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>
                {stat.label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
