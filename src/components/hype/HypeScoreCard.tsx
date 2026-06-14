import { motion } from 'framer-motion';
import { Flame, Calendar, Euro, Users } from 'lucide-react';
import { HypeScoreData } from '@/hooks/useHypeScore';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDistanceToNow } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface HypeScoreCardProps {
  data: HypeScoreData;
}

function CircularGauge({ percentage, color, size = 72, strokeWidth = 5 }: {
  percentage: number; color: string; size?: number; strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, percentage));
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="tabular-nums leading-none" style={{ color: T1, fontSize: 13, fontWeight: 700 }}>
          {progress}%
        </span>
      </div>
    </div>
  );
}

export function HypeScoreCard({ data }: HypeScoreCardProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const levelConfig = {
    fire: {
      label: t('hype.onFire'),
      glowColor: 'rgba(232,25,44,0.09)',
      borderColor: 'rgba(232,25,44,0.22)',
      gaugeColor: RED,
      blobColor: 'rgba(232,25,44,0.12)',
      scoreColor: RED,
    },
    high: {
      label: t('hype.highHype'),
      glowColor: 'rgba(52,211,153,0.07)',
      borderColor: 'rgba(52,211,153,0.20)',
      gaugeColor: POS,
      blobColor: 'rgba(52,211,153,0.10)',
      scoreColor: POS,
    },
    medium: {
      label: t('hype.mediumHype'),
      glowColor: 'rgba(251,191,36,0.07)',
      borderColor: 'rgba(251,191,36,0.20)',
      gaugeColor: '#FCD34D',
      blobColor: 'rgba(251,191,36,0.10)',
      scoreColor: '#FCD34D',
    },
    low: {
      label: t('hype.lowHype'),
      glowColor: 'rgba(255,255,255,0.02)',
      borderColor: BORDER,
      gaugeColor: T3,
      blobColor: 'rgba(255,255,255,0.04)',
      scoreColor: T2,
    },
  };

  const cfg = levelConfig[data.level];

  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
      <div
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(ellipse 70% 50% at 90% -20%, ${cfg.glowColor} 0%, transparent 65%),
            linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
          border: `1px solid ${cfg.borderColor}`,
          borderRadius: 18,
          boxShadow: CARD_SHADOW,
          padding: 22,
        }}
      >
        {/* Ambient blob */}
        <div
          className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full"
          style={{ background: cfg.blobColor, filter: 'blur(48px)' }}
        />

        <div style={{ position: 'relative' }}>
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Hype Score
              </span>
              <div className="flex items-baseline gap-2">
                <motion.span
                  key={data.overallScore}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className="tabular-nums leading-none"
                  style={{ color: cfg.scoreColor, fontSize: 'clamp(36px,5vw,52px)', fontWeight: 700, letterSpacing: '-0.03em' }}
                >
                  {data.overallScore}
                </motion.span>
                <span style={{ color: T3, fontSize: 22, fontWeight: 400 }}>/10</span>
              </div>
              <p style={{ color: T2, fontSize: 13, marginTop: 4, fontWeight: 500 }}>{cfg.label}</p>
            </div>

            <div className="flex flex-col items-center gap-2">
              <CircularGauge percentage={data.quickStats.targetCompletion} color={cfg.gaugeColor} />
              <span style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {t('hype.filling')}
              </span>
            </div>

            <motion.div
              animate={data.level === 'fire' ? { scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] } : {}}
              transition={{ duration: 0.6, repeat: data.level === 'fire' ? Infinity : 0, repeatDelay: 1.5 }}
              className="w-10 h-10 flex items-center justify-center rounded-xl flex-none"
              style={{ background: data.level === 'fire' ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${cfg.borderColor}` }}
            >
              <Flame className="h-5 w-5" style={{ color: data.level === 'fire' ? RED : T2 }} />
            </motion.div>
          </div>

          {/* Bottom strip */}
          <div className="flex items-center flex-wrap gap-4 mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
            {data.quickStats.daysUntilEvent !== null && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" style={{ color: T3 }} />
                <span className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
                  J-{data.quickStats.daysUntilEvent}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Euro className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
                {data.quickStats.totalRevenue.toFixed(0)} €
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
                {data.quickStats.ticketsSold}
                {data.quickStats.maxTickets ? `/${data.quickStats.maxTickets}` : ''}{' '}
                {t('hype.ticketsSold').toLowerCase()}
              </span>
            </div>
            <span className="ml-auto" style={{ color: T3, fontSize: 10.5 }}>
              {formatDistanceToNow(data.lastUpdated, { addSuffix: true, locale: dateLocale })}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
