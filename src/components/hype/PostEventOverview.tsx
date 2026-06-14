import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-react';
import { PostEventData } from '@/hooks/usePostEventAnalysis';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const NEG      = '#FF5C63';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PostEventOverviewProps {
  data: PostEventData;
}

export function PostEventOverview({ data }: PostEventOverviewProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const scoreConfig = data.overallScore >= 8
    ? { glow: 'rgba(52,211,153,0.09)', border: 'rgba(52,211,153,0.22)', blob: 'rgba(52,211,153,0.12)', scoreColor: POS }
    : data.overallScore >= 6
      ? { glow: 'rgba(255,255,255,0.04)', border: BORDER, blob: 'rgba(255,255,255,0.06)', scoreColor: T1 }
      : data.overallScore >= 4
        ? { glow: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.20)', blob: 'rgba(251,191,36,0.10)', scoreColor: '#FCD34D' }
        : { glow: 'rgba(232,25,44,0.08)', border: 'rgba(232,25,44,0.20)', blob: 'rgba(232,25,44,0.10)', scoreColor: RED };

  return (
    <div className="space-y-4">
      {/* Score hero card */}
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
        <div
          className="relative overflow-hidden"
          style={{
            background: `radial-gradient(ellipse 70% 50% at 90% -20%, ${scoreConfig.glow} 0%, transparent 65%),
              linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
            border: `1px solid ${scoreConfig.border}`,
            borderRadius: 18,
            boxShadow: CARD_SHADOW,
            padding: 22,
          }}
        >
          <div className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full"
            style={{ background: scoreConfig.blob, filter: 'blur(48px)' }} />

          <div style={{ position: 'relative' }} className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {data.eventDate ? (
                <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>
                  {format(data.eventDate, 'EEEE d MMMM', { locale: dateLocale })}
                </p>
              ) : data.isAggregate && (
                <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{t('postEvent.overallPerformance')}</p>
              )}
              <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 12 }}>
                {data.eventTitle}
              </h2>
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums leading-none" style={{ color: scoreConfig.scoreColor, fontSize: 'clamp(36px,5vw,52px)', fontWeight: 700, letterSpacing: '-0.03em' }}>
                  {data.overallScore}
                </span>
                <span style={{ color: T3, fontSize: 22, fontWeight: 400 }}>/10</span>
              </div>
              <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginTop: 4 }}>{data.scoreLabel}</p>
            </div>

            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${scoreConfig.border}` }}>
              <Trophy className="h-6 w-6" style={{ color: scoreConfig.scoreColor }} />
            </div>
          </div>
        </div>
      </motion.div>

      {/* KPIs grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {data.kpis.map((kpi, index) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px 16px', overflow: 'hidden' }}
          >
            <p style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }} className="truncate">
              {kpi.label}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
                {kpi.value}
              </span>
              {kpi.change !== undefined && (
                <span className="flex items-center tabular-nums" style={{ color: kpi.change > 0 ? POS : kpi.change < 0 ? NEG : T3, fontSize: 11.5, fontWeight: 600 }}>
                  {kpi.change > 0 ? <TrendingUp className="h-3 w-3 mr-0.5" />
                    : kpi.change < 0 ? <TrendingDown className="h-3 w-3 mr-0.5" />
                    : <Minus className="h-3 w-3 mr-0.5" />}
                  {kpi.change > 0 ? '+' : ''}{kpi.change}%
                </span>
              )}
            </div>
            {kpi.changeLabel && (
              <p style={{ color: T3, fontSize: 10.5, marginTop: 3 }}>{kpi.changeLabel}</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
