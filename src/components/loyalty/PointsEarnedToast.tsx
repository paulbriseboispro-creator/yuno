import { motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface PointsEarnedToastProps {
  points: number;
  isWelcomeBonus?: boolean;
  nextRewardName?: string;
  nextRewardPoints?: number;
  currentBalance?: number;
}

export function PointsEarnedToast({
  points,
  isWelcomeBonus = false,
  nextRewardName,
  nextRewardPoints,
  currentBalance
}: PointsEarnedToastProps) {
  const { t } = useLanguage();

  const pointsToNextReward = nextRewardPoints && currentBalance 
    ? nextRewardPoints - currentBalance 
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30"
    >
      <motion.div
        initial={{ rotate: 0 }}
        animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="h-12 w-12 rounded-full bg-primary/30 flex items-center justify-center shrink-0"
      >
        <Sparkles className="h-6 w-6 text-primary" />
      </motion.div>

      <div className="flex-1 min-w-0">
        {isWelcomeBonus && (
          <p className="text-xs text-primary font-medium mb-0.5">{t('pointsToast.welcomeBonus')}</p>
        )}
        <p className="font-bold text-lg">
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            +{points}
          </motion.span>{' '}
          <span className="text-muted-foreground font-normal text-base">{t('pointsToast.earned')}</span>
        </p>
        
        {nextRewardName && pointsToNextReward && pointsToNextReward > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1"
          >
            <ArrowRight className="h-3 w-3" />
            <span>{t('pointsToast.nextReward')}:</span>
            <span className="font-medium text-foreground">{nextRewardName}</span>
            <span>({pointsToNextReward} {t('pointsToast.pointsToGo')})</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// Helper function to render the toast
export function showPointsEarnedToast(
  toastFn: (component: React.ReactNode) => void,
  props: PointsEarnedToastProps
) {
  toastFn(<PointsEarnedToast {...props} />);
}