import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Info, ChevronDown, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { useHypeScore } from '@/hooks/useHypeScore';
import { HypeScoreCard } from './HypeScoreCard';
import { HypeForecastCard } from './HypeForecastCard';
import { HypePillarBar } from './HypePillarBar';
import { HypePillarDetail } from './HypePillarDetail';
import { HypeTrendChart } from './HypeTrendChart';
import { HypeEventComparison } from './HypeEventComparison';
import { PreEventQuickStats } from './PreEventQuickStats';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface HypeScoreSectionProps {
  venueId: string | null;
  eventId?: string | null;
  /** Whether the venue has a saved baseline. */
  baselineSet?: boolean;
  /** Opens the baseline form (owned by the page so it works from any tab). */
  onEditBaseline?: () => void;
  /** Increments whenever the baseline is saved — triggers a forecast refetch. */
  baselineVersion?: number;
}

export function HypeScoreSection({ venueId, eventId, baselineSet = false, onEditBaseline, baselineVersion = 0 }: HypeScoreSectionProps) {
  const { t } = useLanguage();
  const { loading, hypeData, refetch, toggleCheckAction } = useHypeScore(venueId, eventId);
  const [expandedPillar, setExpandedPillar] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  // Recompute the forecast when the baseline changes from anywhere on the page.
  useEffect(() => {
    if (baselineVersion > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineVersion]);

  const [checkedActions, setCheckedActions] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`hype_checklist_${venueId}_${eventId || 'global'}`) || '[]');
    } catch { return []; }
  });

  const handleToggleAction = useCallback((actionId: string) => {
    const updated = toggleCheckAction(actionId);
    setCheckedActions(updated);
  }, [toggleCheckAction]);

  const explanationContent = [
    t('hype.howItWorksContent1'),
    t('hype.howItWorksContent2'),
    t('hype.howItWorksContent3'),
    t('hype.howItWorksContent4'),
    t('hype.howItWorksContent5'),
    t('hype.howItWorksContent6'),
  ];

  if (loading) {
    return (
      <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 22 }} className="space-y-4">
        {[120, 48, 48, 48].map((h, i) => (
          <div key={i} style={{ height: h, background: 'rgba(255,255,255,0.04)', borderRadius: 10 }} className="animate-pulse" />
        ))}
      </div>
    );
  }

  if (!hypeData) return null;

  return (
    <div className="space-y-4">
      <HypeScoreCard data={hypeData} />

      {/* Calibration prompt — shown until the venue has given us its baseline */}
      {!baselineSet && onEditBaseline && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onEditBaseline}
          className="w-full text-left cursor-pointer transition-all duration-150"
          style={{
            background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))',
            border: '1px solid rgba(232,25,44,0.22)',
            borderRadius: 16,
            padding: '16px 18px',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-xl flex-none"
              style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.25)' }}>
              <SlidersHorizontal className="w-4 h-4" style={{ color: RED }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('baseline.promptTitle')}</p>
              <p style={{ color: T2, fontSize: 12.5, marginTop: 2 }}>{t('baseline.promptBody')}</p>
            </div>
            <ArrowRight className="w-4 h-4 flex-none" style={{ color: RED }} />
          </div>
        </motion.button>
      )}

      {hypeData.forecast && (
        <HypeForecastCard forecast={hypeData.forecast} currentSold={hypeData.quickStats.ticketsSold} />
      )}

      {/* Adjust calibration — subtle entry once configured */}
      {baselineSet && onEditBaseline && (
        <button
          onClick={onEditBaseline}
          className="flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
          style={{ color: T3, fontSize: 12, fontWeight: 560 }}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {t('baseline.adjust')}
        </button>
      )}

      {/* Live metrics */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
          <h3 style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 16 }}>
            {t('hype.liveMetrics')}
          </h3>
          <PreEventQuickStats stats={hypeData.quickStats} />
        </div>
      </motion.div>

      <HypeTrendChart data={hypeData.trendData} />

      {hypeData.comparison && <HypeEventComparison data={hypeData.comparison} />}

      {/* How it works — custom accordion */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <button
            onClick={() => setShowExplanation(!showExplanation)}
            className="w-full flex items-center justify-between px-5 py-4 cursor-pointer transition-all duration-150"
          >
            <span className="flex items-center gap-2" style={{ color: T2, fontSize: 13.5, fontWeight: 560 }}>
              <Info className="h-4 w-4" style={{ color: T3 }} />
              {t('hype.howItWorks')}
            </span>
            <motion.div animate={{ rotate: showExplanation ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="h-4 w-4" style={{ color: T3 }} />
            </motion.div>
          </button>
          <AnimatePresence>
            {showExplanation && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div style={{ padding: '0 20px 20px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <ul className="space-y-2 mt-4">
                    {explanationContent.map((item, idx) => (
                      <motion.li
                        key={idx}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.04 }}
                        className="flex items-start gap-2"
                        style={{ color: T2, fontSize: 13 }}
                      >
                        <span style={{ color: RED, marginTop: 2, flexShrink: 0 }}>•</span>
                        <span>{item}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Pillars breakdown */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
              {t('hype.scoreBreakdown')}
            </h3>
            <button
              onClick={refetch}
              className="w-8 h-8 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T3 }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {hypeData.pillars.map((pillar, index) => (
              <div key={pillar.id}>
                <HypePillarBar
                  pillar={pillar}
                  isExpanded={expandedPillar === pillar.id}
                  onToggle={() => setExpandedPillar(expandedPillar === pillar.id ? null : pillar.id)}
                  index={index}
                />
                <HypePillarDetail
                  pillar={pillar}
                  isVisible={expandedPillar === pillar.id}
                  checkedActionIds={checkedActions}
                  onToggleAction={handleToggleAction}
                />
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
