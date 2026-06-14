import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { TrendDataPoint } from '@/hooks/useHypeScore';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const C_HI     = 'rgba(255,255,255,0.92)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface HypeTrendChartProps {
  data: TrendDataPoint[];
}

export function HypeTrendChart({ data }: HypeTrendChartProps) {
  const { t } = useLanguage();

  if (!data || data.length === 0) return null;
  if (!data.some(d => d.tickets > 0 || d.views > 0)) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2 }}
          >
            <TrendingUp className="w-4 h-4" />
          </div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('hype.trend7d')}
          </h3>
        </div>

        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="hypeViewsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C_HI} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={C_HI} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="hypeTicketsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={RED} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={RED} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: T3 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: T3 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0a0a0c',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  fontSize: 12,
                  color: T1,
                }}
                labelStyle={{ color: T3 }}
              />
              <Area
                type="monotone"
                dataKey="views"
                name={t('hype.views24h')}
                stroke={C_HI}
                fill="url(#hypeViewsGrad)"
                strokeWidth={1.6}
                opacity={0.9}
              />
              <Area
                type="monotone"
                dataKey="tickets"
                name={t('hype.ticketsSold')}
                stroke={RED}
                fill="url(#hypeTicketsGrad)"
                strokeWidth={1.6}
                opacity={0.9}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
}
