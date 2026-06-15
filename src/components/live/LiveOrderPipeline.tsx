import { motion } from 'framer-motion';
import { CreditCard, Clock, CheckCircle, ShoppingBag, RotateCcw, Flame } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { OrderPipeline } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  pipeline: OrderPipeline;
}

export function LiveOrderPipeline({ pipeline }: Props) {
  const { t } = useLanguage();
  const total = pipeline.pending + pipeline.paid + pipeline.preparing + pipeline.ready + pipeline.served + pipeline.refunded;

  const stages = [
    { key: 'pending',   label: t('live.pipelinePending'),   count: pipeline.pending,   color: '#FCD34D',            icon: Clock },
    { key: 'paid',      label: t('live.pipelinePaid'),      count: pipeline.paid,      color: 'rgba(167,139,250,1)', icon: CreditCard },
    { key: 'preparing', label: t('live.pipelinePreparing'), count: pipeline.preparing, color: '#FB923C',            icon: Flame },
    { key: 'ready',     label: t('live.pipelineReady'),     count: pipeline.ready,     color: POS,                   icon: CheckCircle },
    { key: 'served',   label: t('live.pipelineServed'),   count: pipeline.served,   color: T2,                    icon: ShoppingBag },
    { key: 'refunded', label: t('live.pipelineRefunded'), count: pipeline.refunded, color: NEG,                   icon: RotateCcw },
  ];

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {t('live.orderPipeline')}
        </h3>
        <span className="tabular-nums" style={{ color: T3, fontSize: 12 }}>
          {total} {t('live.pipelineTotal')}
        </span>
      </div>

      {/* Visual pipeline bar */}
      {total > 0 && (
        <div className="h-2 rounded-full overflow-hidden flex mb-5" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {stages.map(stage => {
            const pct = total > 0 ? (stage.count / total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <motion.div
                key={stage.key}
                style={{ background: stage.color, height: '100%' }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-5 gap-2">
        {stages.map(stage => {
          const Icon = stage.icon;
          return (
            <div key={stage.key} className="text-center">
              <div className="flex flex-col items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" style={{ color: stage.color }} />
                <span className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
                  {stage.count}
                </span>
              </div>
              <p style={{ color: T3, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>
                {stage.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
