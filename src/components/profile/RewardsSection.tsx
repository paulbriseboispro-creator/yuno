import { motion } from 'framer-motion';
import { Gift, Sparkles, Trophy, ChevronRight } from 'lucide-react';
import { ClubLoyaltyCard } from './ClubLoyaltyCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface LoyaltyTransaction {
  id: string;
  points: number;
  transaction_type: string;
  description: string | null;
  created_at: string | null;
}

interface LoyaltyCard {
  venue_id: string;
  venue_name: string;
  venue_logo: string | null;
  venue_slug: string | null;
  current_balance: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  next_reward_name: string | null;
  next_reward_points: number | null;
  progress_percent: number;
  recent_transactions: LoyaltyTransaction[];
  rank?: number | null;
}

interface RewardsSectionProps {
  loyaltyCards: LoyaltyCard[];
  onCardClick: (venueId: string) => void;
}

export function RewardsSection({ loyaltyCards, onCardClick }: RewardsSectionProps) {
  const { t } = useLanguage();

  const totalPoints = loyaltyCards.reduce((sum, card) => sum + card.current_balance, 0);
  const highestTier = loyaltyCards.reduce<'bronze' | 'silver' | 'gold' | 'platinum'>((best, card) => {
    const tierOrder = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
    return tierOrder[card.tier] > tierOrder[best] ? card.tier : best;
  }, 'bronze');

  if (loyaltyCards.length === 0) return null;

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <motion.section
      initial="hidden"
      animate="show"
      variants={container}
      className="space-y-3"
    >
      {/* Header with global summary */}
      <motion.div variants={item} className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <Trophy className="h-4 w-4 text-primary" />
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground/60 font-medium">
            {t('profile.myRewards')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/40">
            {totalPoints} {t('loyalty.pts')} · {loyaltyCards.length} {loyaltyCards.length > 1 ? 'clubs' : 'club'}
          </span>
          <div className={cn(
            "px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 backdrop-blur-sm",
            highestTier === 'platinum' && "bg-white/[0.06] text-violet-400 border border-white/[0.08]",
            highestTier === 'gold' && "bg-white/[0.06] text-yellow-500 border border-white/[0.08]",
            highestTier === 'silver' && "bg-white/[0.05] text-foreground/50 border border-white/[0.06]",
            highestTier === 'bronze' && "bg-white/[0.04] text-amber-700 border border-white/[0.05]"
          )}>
            <Sparkles className="h-2.5 w-2.5" />
            {highestTier.charAt(0).toUpperCase() + highestTier.slice(1)}
          </div>
        </div>
      </motion.div>

      {/* Horizontal scrollable cards */}
      <motion.div variants={item}>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 snap-x snap-mandatory scrollbar-none">
          {loyaltyCards.map((card) => (
            <div key={card.venue_id} className="snap-start shrink-0 w-[280px]">
              <ClubLoyaltyCard
                venueName={card.venue_name}
                venueLogo={card.venue_logo}
                currentBalance={card.current_balance}
                tier={card.tier}
                nextRewardName={card.next_reward_name}
                nextRewardPoints={card.next_reward_points}
                progressPercent={card.progress_percent}
                rank={card.rank}
                venueSlug={card.venue_slug}
                onClick={() => onCardClick(card.venue_id)}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* Discover CTA */}
      <motion.button
        variants={item}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "w-full p-3.5 rounded-xl",
          "bg-white/[0.03] backdrop-blur-sm",
          "border border-white/[0.08]",
          "flex items-center justify-center gap-2",
          "text-foreground/70 font-medium text-sm",
          "hover:bg-white/[0.06] hover:border-white/[0.12] transition-all"
        )}
        onClick={() => window.location.href = '/'}
      >
        <Gift className="h-4 w-4" />
        {t('profile.discoverClubs')}
        <ChevronRight className="h-4 w-4" />
      </motion.button>
    </motion.section>
  );
}
