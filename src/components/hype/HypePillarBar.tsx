import { motion } from 'framer-motion';
import { ChevronRight, Eye, MessageCircle, CreditCard, RotateCcw, Zap, BarChart3 } from 'lucide-react';
import { HypePillar } from '@/hooks/useHypeScore';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';
const POS     = 'var(--acc-34d399)';
const T1      = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2      = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3      = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER  = 'rgb(var(--ink)/0.085)';
const C_FAINT = 'rgb(var(--ink)/0.06)';

interface HypePillarBarProps {
  pillar: HypePillar;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}

const PILLAR_ICONS: Record<string, typeof Eye> = {
  interest:   Eye,
  engagement: MessageCircle,
  conversion: CreditCard,
  recurrence: RotateCcw,
  momentum:   Zap,
};

export function HypePillarBar({ pillar, isExpanded, onToggle, index }: HypePillarBarProps) {
  const { t } = useLanguage();
  const Icon = PILLAR_ICONS[pillar.id] || BarChart3;

  const scoreColor = pillar.score >= 7 ? POS : pillar.score >= 5 ? 'var(--acc-fcd34d)' : pillar.score >= 3 ? 'var(--acc-fb923c)' : RED;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.08 }}
      style={{
        borderRadius: 12,
        border: `1px solid ${isExpanded ? BORDER : 'rgb(var(--ink)/0.05)'}`,
        background: isExpanded ? 'rgb(var(--ink)/0.04)' : 'transparent',
        overflow: 'hidden',
        transition: 'all 0.15s',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 cursor-pointer"
        style={{ padding: '12px 14px', textAlign: 'left' }}
      >
        <div
          className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
        >
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t(pillar.nameKey)}</span>
            <span className="tabular-nums" style={{ color: scoreColor, fontSize: 12.5, fontWeight: 700, marginRight: 8 }}>
              {pillar.score}/10
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ink)/0.06)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pillar.score * 10}%` }}
              transition={{ duration: 0.8, delay: index * 0.08, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: scoreColor }}
            />
          </div>
        </div>

        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
        </motion.div>
      </button>
    </motion.div>
  );
}
