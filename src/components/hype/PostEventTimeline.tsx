import { motion } from 'framer-motion';
import { Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { TimelineDataPoint } from '@/hooks/usePostEventAnalysis';
import { useLanguage } from '@/contexts/LanguageContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PostEventTimelineProps {
  timeline: TimelineDataPoint[];
  insights: string[];
}

export function PostEventTimeline({ timeline, insights }: PostEventTimelineProps) {
  const { t } = useLanguage();
  // Down-sample only when the night is split into many 15-min buckets.
  const filteredData = timeline.length > 16 ? timeline.filter((_, i) => i % 2 === 0) : timeline;
  const hasEntries = timeline.some((d) => d.entries > 0);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2 }}>
            <Clock className="w-4 h-4" />
          </div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('postEvent.nightTimeline')}
          </h3>
          {hasEntries && (
            <div className="flex items-center gap-3 ml-auto">
              <span className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: POS, display: 'inline-block' }} />
                {t('postEvent.entries')}
              </span>
              <span className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: RED, display: 'inline-block' }} />
                {t('postEvent.orders')}
              </span>
            </div>
          )}
        </div>

        {/* Chart */}
        <div style={{ height: 192, marginBottom: 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={RED} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={RED} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="entriesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={POS} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={POS} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: T3, fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: T3, fontSize: 10 }}
                width={30}
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
                cursor={{ stroke: 'rgba(232,25,44,0.3)', strokeWidth: 1 }}
              />
              {hasEntries && (
                <Area
                  type="monotone"
                  dataKey="entries"
                  name={t('postEvent.entries')}
                  stroke={POS}
                  strokeWidth={1.6}
                  fill="url(#entriesGrad)"
                />
              )}
              <Area
                type="monotone"
                dataKey="orders"
                name={t('postEvent.orders')}
                stroke={RED}
                strokeWidth={1.8}
                fill="url(#ordersGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Key insights */}
        {insights.length > 0 && (
          <div className="space-y-2">
            <h4 style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
              {t('postEvent.keyInsights')}
            </h4>
            {insights.map((insight, idx) => {
              const isPeak = insight.toLowerCase().includes('peak') || insight.toLowerCase().includes('pic');
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + idx * 0.08 }}
                  className="flex items-start gap-2"
                  style={{ padding: '10px 12px', background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 10 }}
                >
                  {isPeak
                    ? <TrendingUp className="h-4 w-4 flex-none mt-0.5" style={{ color: POS }} />
                    : <TrendingDown className="h-4 w-4 flex-none mt-0.5" style={{ color: '#FB923C' }} />
                  }
                  <p style={{ color: T2, fontSize: 13 }}>{insight}</p>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
