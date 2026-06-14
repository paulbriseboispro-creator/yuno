import { motion } from 'framer-motion';
import { Lightbulb, ArrowRight, Zap, Clock, TrendingUp } from 'lucide-react';
import { Suggestion } from '@/hooks/usePostEventAnalysis';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const PRIORITY_CONFIG = {
  high: {
    icon: Zap,
    color: RED,
    border: 'rgba(232,25,44,0.25)',
    bg:    'rgba(232,25,44,0.08)',
  },
  medium: {
    icon: TrendingUp,
    color: '#FCD34D',
    border: 'rgba(251,191,36,0.25)',
    bg:    'rgba(251,191,36,0.08)',
  },
  low: {
    icon: Clock,
    color: T3,
    border: 'rgba(255,255,255,0.08)',
    bg:    TILE_BG,
  },
};

interface PostEventSuggestionsProps {
  suggestions: Suggestion[];
  onApply?: (suggestion: Suggestion) => void;
}

export function PostEventSuggestions({ suggestions, onApply }: PostEventSuggestionsProps) {
  const { t } = useLanguage();

  const priorityLabels = {
    high:   t('postEvent.highPriority'),
    medium: t('postEvent.mediumPriority'),
    low:    t('postEvent.optional'),
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.6 }}>
      <div
        style={{
          background: `radial-gradient(ellipse 60% 40% at 5% 100%, rgba(232,25,44,0.05) 0%, transparent 60%), ${CARD_BG}`,
          border: `1px solid ${BORDER}`,
          borderRadius: 18,
          boxShadow: CARD_SHADOW,
          padding: '20px 22px',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.20)' }}>
            <Lightbulb className="w-4 h-4" style={{ color: RED }} />
          </div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('postEvent.nextTime')}
          </h3>
        </div>

        <div className="space-y-2">
          {suggestions.length === 0 ? (
            <p className="text-center py-4" style={{ color: T3, fontSize: 13 }}>
              {t('postEvent.noSuggestions')}
            </p>
          ) : suggestions.map((suggestion, idx) => {
            const cfg = PRIORITY_CONFIG[suggestion.priority];
            const Icon = cfg.icon;
            return (
              <motion.div
                key={suggestion.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.65 + idx * 0.08 }}
                className="flex items-center gap-3"
                style={{ padding: '12px 14px', background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12 }}
              >
                {/* Priority badge */}
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded-full flex-none"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                >
                  <Icon className="h-3 w-3" style={{ color: cfg.color }} />
                  <span style={{ color: cfg.color, fontSize: 10.5, fontWeight: 600 }}>
                    {priorityLabels[suggestion.priority]}
                  </span>
                </div>

                <p className="flex-1" style={{ color: T2, fontSize: 13, fontWeight: 500 }}>
                  {suggestion.text}
                </p>

                {onApply && (
                  <button
                    onClick={() => onApply(suggestion)}
                    className="flex items-center gap-1 flex-none cursor-pointer transition-all duration-150"
                    style={{ color: T3, fontSize: 12, fontWeight: 500 }}
                  >
                    {t('postEvent.apply')}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
