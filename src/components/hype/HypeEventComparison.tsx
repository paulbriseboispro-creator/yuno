import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Minus, GitCompare } from 'lucide-react';
import { EventComparisonData } from '@/hooks/useHypeScore';
import { useLanguage } from '@/contexts/LanguageContext';

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

interface HypeEventComparisonProps {
  data: EventComparisonData;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <Minus className="h-3 w-3" style={{ color: T3 }} />;
  if (previous === 0) return <span style={{ color: POS, fontSize: 11, fontWeight: 700 }}>NEW</span>;
  const delta = Math.round(((current - previous) / previous) * 100);
  const isUp = delta > 0;
  return (
    <span className="flex items-center tabular-nums" style={{ color: isUp ? POS : NEG, fontSize: 11.5, fontWeight: 700 }}>
      {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isUp ? '+' : ''}{delta}%
    </span>
  );
}

export function HypeEventComparison({ data }: HypeEventComparisonProps) {
  const { t } = useLanguage();

  const rows = [
    { label: t('hype.ticketsSold'), current: data.currentTickets, previous: data.previousTickets },
    { label: t('hype.views24h'), current: data.currentViews, previous: data.previousViews },
    { label: t('hype.metric.revenue24h').replace(' (24h)', ''), current: data.currentRevenue, previous: data.previousRevenue, isCurrency: true },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2 }}
          >
            <GitCompare className="w-4 h-4" />
          </div>
          <div>
            <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
              {t('hype.vsLastEvent')}
            </h3>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
              {t('hype.comparedTo')}{' '}
              <span style={{ color: T2, fontWeight: 500 }}>{data.previousEventTitle}</span>{' '}
              {t('hype.atSameStage')} (J-{data.daysBeforeEvent})
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <motion.div
              key={row.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + idx * 0.08 }}
              className="flex items-center justify-between"
              style={{ padding: '10px 12px', background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 10 }}
            >
              <span style={{ color: T2, fontSize: 13 }}>{row.label}</span>
              <div className="flex items-center gap-3">
                <span className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 640 }}>
                  {row.isCurrency ? `${row.current.toFixed(0)} €` : row.current}
                </span>
                <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                  vs {row.isCurrency ? `${row.previous.toFixed(0)} €` : row.previous}
                </span>
                <DeltaBadge current={row.current} previous={row.previous} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
