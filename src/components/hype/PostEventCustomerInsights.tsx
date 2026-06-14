import { motion } from 'framer-motion';
import { Users, Wine, RefreshCw, UserPlus } from 'lucide-react';
import { CustomerInsight } from '@/hooks/usePostEventAnalysis';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PostEventCustomerInsightsProps {
  insights: CustomerInsight;
}

export function PostEventCustomerInsights({ insights }: PostEventCustomerInsightsProps) {
  const { t } = useLanguage();

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2 }}>
            <Users className="w-4 h-4" />
          </div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('postEvent.customerBehavior')}
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Loyal vs new — full width */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className="col-span-2"
            style={{ padding: '16px 18px', background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14 }}
          >
            <div className="flex items-center justify-between mb-3">
              <span style={{ color: T2, fontSize: 13.5, fontWeight: 560 }}>{t('postEvent.loyalCustomers')}</span>
              <span className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
                {Math.round(insights.returningRate)}%
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${insights.returningRate}%`, background: `linear-gradient(90deg, rgba(232,25,44,0.75), rgba(232,25,44,0.35))` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="flex items-center gap-1" style={{ color: T3, fontSize: 11 }}>
                <RefreshCw className="h-3 w-3" />
                {insights.returningCustomers} {t('postEvent.loyalCustomers').toLowerCase()}
              </span>
              <span className="flex items-center gap-1" style={{ color: T3, fontSize: 11 }}>
                <UserPlus className="h-3 w-3" />
                {insights.newCustomers} {t('postEvent.newCustomers').toLowerCase()}
              </span>
            </div>
          </motion.div>

          {/* Top segment */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6 }}
            style={{ padding: '14px 16px', background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12 }}
          >
            <p style={{ color: T3, fontSize: 10.5, fontWeight: 500, marginBottom: 6 }}>{t('postEvent.topSegment')}</p>
            <p style={{ color: T1, fontSize: 17, fontWeight: 640, letterSpacing: '-0.01em' }}>{insights.topSegment}</p>
          </motion.div>

          {/* Top drink */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.7 }}
            style={{ padding: '14px 16px', background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12 }}
          >
            <p className="flex items-center gap-1" style={{ color: T3, fontSize: 10.5, fontWeight: 500, marginBottom: 6 }}>
              <Wine className="h-3 w-3" />
              {t('postEvent.topDrink')}
            </p>
            <p className="truncate" style={{ color: T1, fontSize: 17, fontWeight: 640, letterSpacing: '-0.01em' }}>
              {insights.topDrink}
            </p>
            <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>
              {insights.topDrinkCount} {t('postEvent.sold')}
            </p>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
