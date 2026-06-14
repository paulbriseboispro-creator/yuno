import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Lightbulb, CheckSquare, Square, ExternalLink, BarChart2 } from 'lucide-react';
import { HypePillar } from '@/hooks/useHypeScore';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const TILE_BG  = 'rgba(255,255,255,0.025)';

interface HypePillarDetailProps {
  pillar: HypePillar;
  isVisible: boolean;
  checkedActionIds: string[];
  onToggleAction: (actionId: string) => void;
}

export function HypePillarDetail({ pillar, isVisible, checkedActionIds, onToggleAction }: HypePillarDetailProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden"
        >
          <div style={{ padding: '0 14px 14px' }} className="space-y-4">
            {/* Metrics */}
            <div>
              <h4
                className="flex items-center gap-2 mb-3"
                style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}
              >
                <BarChart2 className="h-3.5 w-3.5" />
                {t('hype.whyThisLevel')}
              </h4>
              <div className="space-y-2">
                {pillar.metrics.map((metric, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    className="flex items-center justify-between"
                    style={{ padding: '10px 12px', background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 10 }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{t(metric.labelKey)}</span>
                        {metric.change !== undefined && (
                          <span
                            className="flex items-center tabular-nums"
                            style={{ color: metric.change > 0 ? POS : metric.change < 0 ? NEG : T3, fontSize: 11.5, fontWeight: 600 }}
                          >
                            {metric.change > 0
                              ? <TrendingUp className="h-3 w-3 mr-0.5" />
                              : metric.change < 0
                                ? <TrendingDown className="h-3 w-3 mr-0.5" />
                                : <Minus className="h-3 w-3 mr-0.5" />
                            }
                            {metric.change > 0 ? '+' : ''}{metric.change}%
                          </span>
                        )}
                      </div>
                      {metric.insightKey && (
                        <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>{t(metric.insightKey)}</p>
                      )}
                    </div>
                    <span className="tabular-nums" style={{ color: T1, fontSize: 15, fontWeight: 700 }}>
                      {metric.value}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Insight */}
            <div style={{ padding: '12px 14px', background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.18)', borderRadius: 10 }}>
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 flex-none mt-0.5" style={{ color: RED }} />
                <div>
                  <p style={{ color: RED, fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>{t('hype.ourInsight')}</p>
                  <p style={{ color: T2, fontSize: 13 }}>{t(pillar.insightKey)}</p>
                </div>
              </div>
            </div>

            {/* Checklist */}
            <div>
              <h4
                className="flex items-center gap-2 mb-3"
                style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {t('hype.checklist')}
              </h4>
              <div className="space-y-2">
                {pillar.actions.map((action, idx) => {
                  const isChecked = checkedActionIds.includes(action.id);
                  return (
                    <motion.button
                      key={action.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + idx * 0.08 }}
                      onClick={() => onToggleAction(action.id)}
                      className="w-full flex items-center gap-3 text-left cursor-pointer transition-all duration-150"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: isChecked ? '1px solid rgba(52,211,153,0.25)' : `1px solid ${BORDER}`,
                        background: isChecked ? 'rgba(52,211,153,0.06)' : TILE_BG,
                      }}
                    >
                      {isChecked
                        ? <CheckSquare className="h-4 w-4 flex-none" style={{ color: POS }} />
                        : <Square className="h-4 w-4 flex-none" style={{ color: T3 }} />
                      }
                      <div className="flex-1 min-w-0">
                        <p style={{
                          color: isChecked ? T3 : T1,
                          fontSize: 13,
                          fontWeight: 500,
                          textDecoration: isChecked ? 'line-through' : 'none',
                        }}>
                          {t(action.labelKey)}
                        </p>
                        <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>{t(action.descriptionKey)}</p>
                      </div>
                      {action.link && (
                        <ExternalLink
                          className="h-3.5 w-3.5 flex-none cursor-pointer transition-colors duration-150"
                          style={{ color: T3 }}
                          onClick={(e) => { e.stopPropagation(); navigate(action.link!); }}
                        />
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
