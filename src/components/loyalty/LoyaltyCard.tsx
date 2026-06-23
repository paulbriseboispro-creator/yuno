import { motion, useReducedMotion } from 'framer-motion';
import { Gift, ChevronRight, Sparkles } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { TierBadge } from './TierBadge';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface LoyaltyCardProps {
  balance: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  nextRewardName?: string;
  nextRewardPoints?: number;
  progressPercent: number;
  affordableRewardsCount: number;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
}

export function LoyaltyCard({
  balance,
  tier,
  nextRewardName,
  nextRewardPoints,
  progressPercent,
  affordableRewardsCount,
  onClick,
  compact = false,
  className
}: LoyaltyCardProps) {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();

  if (compact) {
    return (
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className={cn(
          'flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 w-full text-left',
          className
        )}
      >
        <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{balance.toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">{t('loyaltyCard.points')}</span>
          </div>
          {affordableRewardsCount > 0 && (
            <p className="text-xs text-primary truncate">
              {affordableRewardsCount} {t('loyaltyCard.rewardsAvailable')}
            </p>
          )}
        </div>
        <TierBadge tier={tier} size="sm" showLabel={false} />
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-card/80 border shadow-lg w-full',
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <motion.p
                key={balance}
                initial={reduceMotion ? { opacity: 0 } : { scale: 1.15, opacity: 0 }}
                animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="text-2xl font-bold leading-tight"
              >
                {balance.toLocaleString()}
              </motion.p>
              <p className="text-xs text-muted-foreground">{t('loyaltyCard.points')}</p>
            </div>
          </div>
          <TierBadge tier={tier} size="sm" />
        </div>

        {nextRewardName && nextRewardPoints && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">{t('loyaltyCard.nextReward')}</span>
              <span className="font-medium">{nextRewardName}</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground mt-1 text-right">
              {nextRewardPoints - balance} {t('loyaltyCard.pointsToGo')}
            </p>
          </div>
        )}

        {affordableRewardsCount > 0 && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <Gift className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium">
              {affordableRewardsCount} {t('loyaltyCard.rewardsAvailable')}!
            </span>
          </div>
        )}

        {onClick && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium"
          >
            <Gift className="h-5 w-5" />
            {t('loyaltyCard.viewRewards')}
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}