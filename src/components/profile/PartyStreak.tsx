import { motion } from 'framer-motion';
import { Flame, Trophy } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface PartyStreakProps {
  currentStreak: number;
  longestStreak: number;
}

export function PartyStreak({ currentStreak, longestStreak }: PartyStreakProps) {
  const { t } = useLanguage();

  if (currentStreak <= 0) return null;

  // Flame scales up with streak
  const flameScale = Math.min(1.4, 1 + currentStreak * 0.06);
  const isHot = currentStreak >= 3;
  const isOnFire = currentStreak >= 5;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="relative overflow-hidden p-4"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
    >
      {/* Voile rouge éditorial */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ background: 'linear-gradient(135deg, #E8192C, transparent 70%)' }}
      />

      <div className="relative flex items-center gap-4">
        {/* Flamme rouge avec pulse */}
        <div className="relative flex-shrink-0">
          <motion.div
            animate={isHot ? {
              scale: [flameScale, flameScale * 1.08, flameScale],
            } : {}}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="flex items-center justify-center"
          >
            <Flame
              style={{ color: '#E8192C' }}
              size={32 * flameScale}
              strokeWidth={2.2}
              fill={isOnFire ? 'rgba(232,25,44,0.3)' : 'none'}
            />
          </motion.div>
          {/* Glow derrière la flamme */}
          {isHot && (
            <div
              className="absolute inset-0 -z-10 blur-xl opacity-50"
              style={{
                background: 'radial-gradient(circle, rgba(232,25,44,0.6) 0%, transparent 70%)',
              }}
            />
          )}
        </div>

        {/* Texte */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-display font-bold text-white" style={{ fontSize: '28px', letterSpacing: '-0.03em', lineHeight: 1 }}>
              {currentStreak}
            </span>
            <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.10em', color: '#9A9A9A' }}>
              {t('profile.streakWeekends')}
            </span>
          </div>

          {longestStreak > currentStreak && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Trophy className="h-3 w-3" style={{ color: '#5A5A5E' }} />
              <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#5A5A5E' }}>
                {t('profile.streakRecord').replace('{count}', String(longestStreak))}
              </span>
            </div>
          )}
        </div>

        {/* Badge numéro de série */}
        <div className="flex-shrink-0">
          <div
            className="flex h-10 w-10 items-center justify-center"
            style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.28)', borderRadius: 999 }}
          >
            <span className="font-mono font-bold" style={{ fontSize: '12px', color: '#E8192C' }}>
              {currentStreak}🔥
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
