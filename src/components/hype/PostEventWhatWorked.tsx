import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Sparkles } from 'lucide-react';
import { WhatWorkedItem } from '@/hooks/usePostEventAnalysis';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PostEventWhatWorkedProps {
  items: WhatWorkedItem[];
}

export function PostEventWhatWorked({ items }: PostEventWhatWorkedProps) {
  const { t } = useLanguage();

  const positiveItems = items.filter(i => i.type === 'positive');
  const negativeItems = items.filter(i => i.type === 'negative');

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.20)' }}>
            <Sparkles className="w-4 h-4" style={{ color: RED }} />
          </div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('postEvent.whatWorked')}
          </h3>
        </div>

        <div className="space-y-4">
          {positiveItems.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 mb-3"
                style={{ color: POS, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                <CheckCircle className="h-3.5 w-3.5" />
                {t('postEvent.whatWorkedWell')}
              </h4>
              <div className="space-y-2">
                {positiveItems.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.35 + idx * 0.08 }}
                    className="flex items-center justify-between"
                    style={{ padding: '10px 12px', background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)', borderRadius: 10 }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <CheckCircle className="h-4 w-4 flex-none" style={{ color: POS }} />
                      <div className="min-w-0">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{item.label}</p>
                        <p style={{ color: T3, fontSize: 11, marginTop: 1 }}>{item.value}</p>
                      </div>
                    </div>
                    <span className="tabular-nums flex-none ml-3 px-2 py-0.5 rounded-full"
                      style={{ color: POS, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.22)', fontSize: 11.5, fontWeight: 700 }}>
                      {item.metric}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {negativeItems.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 mb-3"
                style={{ color: NEG, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                <XCircle className="h-3.5 w-3.5" />
                {t('postEvent.whatDidnt')}
              </h4>
              <div className="space-y-2">
                {negativeItems.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.45 + idx * 0.08 }}
                    className="flex items-center justify-between"
                    style={{ padding: '10px 12px', background: 'rgba(255,92,99,0.06)', border: '1px solid rgba(255,92,99,0.18)', borderRadius: 10 }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <XCircle className="h-4 w-4 flex-none" style={{ color: NEG }} />
                      <div className="min-w-0">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{item.label}</p>
                        <p style={{ color: T3, fontSize: 11, marginTop: 1 }}>{item.value}</p>
                      </div>
                    </div>
                    <span className="tabular-nums flex-none ml-3 px-2 py-0.5 rounded-full"
                      style={{ color: NEG, background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.22)', fontSize: 11.5, fontWeight: 700 }}>
                      {item.metric}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {positiveItems.length === 0 && negativeItems.length === 0 && (
            <p className="text-center py-4" style={{ color: T3, fontSize: 13 }}>
              {t('postEvent.notEnoughData')}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
