import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, LucideIcon } from 'lucide-react';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';
const POS = 'var(--acc-34d399)';
const NEG = 'var(--acc-ff5c63)';

interface AnalyticsMetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; direction: 'up' | 'down' };
  note?: { text: string; color?: string };
  delay?: number;
}

export function AnalyticsMetricCard({ label, value, icon: Icon, trend, note, delay = 0 }: AnalyticsMetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          boxShadow: CARD_SHADOW,
          padding: '18px 20px',
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2.5 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.08em] font-medium" style={{ color: T3 }}>
              {label}
            </p>
            <p
              className="text-2xl sm:text-3xl font-[640] tabular-nums leading-none"
              style={{ color: T1, letterSpacing: '-0.025em' }}
            >
              {value}
            </p>
            {trend && (
              <div
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: trend.direction === 'up' ? 'rgba(52,211,153,0.1)' : 'rgba(255,92,99,0.1)',
                  border: `1px solid ${trend.direction === 'up' ? 'rgba(52,211,153,0.2)' : 'rgba(255,92,99,0.2)'}`,
                  color: trend.direction === 'up' ? POS : NEG,
                }}
              >
                {trend.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                <span>{trend.direction === 'up' ? '+' : ''}{trend.value.toFixed(1)}%</span>
              </div>
            )}
            {note && (
              <p className="text-[11px] font-medium" style={{ color: note.color || NEG }}>
                {note.text}
              </p>
            )}
          </div>
          <div
            className="flex-none flex items-center justify-center w-10 h-10 rounded-xl"
            style={{ background: 'rgb(var(--ink)/0.04)', border: `1px solid ${BORDER}`, color: T3 }}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
