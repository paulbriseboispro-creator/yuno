import { motion } from 'framer-motion';
import { Gift, Sparkles, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TierBadge } from '@/components/loyalty/TierBadge';
import { LoyaltyProgressRing } from './LoyaltyProgressRing';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface ClubLoyaltyCardProps {
  venueName: string;
  venueLogo: string | null;
  currentBalance: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  nextRewardName: string | null;
  nextRewardPoints: number | null;
  progressPercent: number;
  onClick: () => void;
}

const TIER_BORDER = {
  bronze: 'border-amber-700/30',
  silver: 'border-slate-400/30',
  gold: 'border-yellow-500/40',
  platinum: 'border-violet-400/40',
};

const TIER_GLOW = {
  bronze: 'shadow-amber-900/10',
  silver: 'shadow-slate-400/10',
  gold: 'shadow-yellow-500/20',
  platinum: 'shadow-violet-400/20',
};

export function ClubLoyaltyCard({
  venueName,
  venueLogo,
  currentBalance,
  tier,
  nextRewardName,
  nextRewardPoints,
  progressPercent,
  onClick
}: ClubLoyaltyCardProps) {
  const { t } = useLanguage();
  const pointsToNext = nextRewardPoints ? nextRewardPoints - currentBalance : 0;
  const isCloseToReward = progressPercent >= 80;

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "w-full text-left p-4 rounded-2xl relative overflow-hidden",
        "bg-white/[0.04] backdrop-blur-sm",
        "border",
        TIER_BORDER[tier],
        "shadow-lg",
        TIER_GLOW[tier],
        "transition-all duration-300"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Progress ring with logo inside */}
        <LoyaltyProgressRing percent={progressPercent} size={64} strokeWidth={3} tier={tier}>
          <Avatar className="h-11 w-11 rounded-xl">
            <AvatarImage src={venueLogo || undefined} alt={venueName} className="object-cover" />
            <AvatarFallback className="rounded-xl font-bold text-sm bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
              {venueName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </LoyaltyProgressRing>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <h3 className="font-semibold text-sm text-foreground truncate">{venueName}</h3>
            <TierBadge tier={tier} size="sm" />
          </div>

          {/* Points */}
          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-xl font-bold text-primary">{currentBalance}</span>
            <span className="text-xs text-muted-foreground">{t('loyalty.pts')}</span>
          </div>

          {/* Next reward hint */}
          {nextRewardName ? (
            <div className="flex items-center gap-1 text-xs">
              <Gift className="h-3 w-3 text-primary shrink-0" />
              <span className="text-muted-foreground truncate">{nextRewardName}</span>
              {pointsToNext > 0 && (
                <span className={cn(
                  "ml-auto shrink-0 font-medium px-1.5 py-0.5 rounded-full text-[10px]",
                  isCloseToReward ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  -{pointsToNext}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
              <Gift className="h-3 w-3" />
              <span>{t('profile.allRewardsClaimed')}</span>
            </div>
          )}
        </div>

        {/* Right side: chevron */}
        <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />
      </div>

      {/* Close to reward indicator */}
      {isCloseToReward && nextRewardName && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-primary font-medium">
          <Sparkles className="h-3 w-3" />
          {t('profile.almostThere')}
        </div>
      )}
    </motion.button>
  );
}
