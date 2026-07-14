import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Crown, Gift, ChevronLeft, Sparkles, ArrowRight, Star, Medal, Award } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNightlifeProfile } from '@/hooks/useNightlifeProfile';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { TierBadge } from '@/components/loyalty/TierBadge';
import { LoyaltyProgressRing } from '@/components/profile/LoyaltyProgressRing';
import { LoyaltyRewardsSheet } from '@/components/loyalty/LoyaltyRewardsSheet';
import { cn } from '@/lib/utils';
import { PublicPage } from '@/components/PublicPage';

interface VenueScore {
  venue_id: string;
  rank: number | null;
  total_score: number;
  monthly_rank: number | null;
}

const TIER_ACCENT = {
  bronze: 'from-primary/10 to-primary/5',
  silver: 'from-primary/12 to-primary/5',
  gold: 'from-primary/15 to-primary/5',
  platinum: 'from-primary/20 to-primary/5',
};

const TIER_ICON = {
  bronze: Medal,
  silver: Award,
  gold: Star,
  platinum: Crown,
};

export default function LoyaltyHub() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { loyaltyCards, loading: profileLoading } = useNightlifeProfile();

  const [venueScores, setVenueScores] = useState<VenueScore[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth?redirect=/loyalty');
    }
  }, [user, authLoading, navigate]);

  // Fetch leaderboard scores for all venues
  useEffect(() => {
    if (!user) return;
    supabase
      .from('client_scores')
      .select('venue_id, rank, total_score, monthly_rank')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) setVenueScores(data as VenueScore[]);
      });
  }, [user]);

  const scoreMap = useMemo(() => {
    const map: Record<string, VenueScore> = {};
    venueScores.forEach(s => { map[s.venue_id] = s; });
    return map;
  }, [venueScores]);

  const totalPoints = loyaltyCards.reduce((sum, c) => sum + c.current_balance, 0);
  const totalClubs = loyaltyCards.length;

  const highestTier = useMemo(() => {
    const tierOrder = { bronze: 0, silver: 1, gold: 2, platinum: 3 } as const;
    return loyaltyCards.reduce<'bronze' | 'silver' | 'gold' | 'platinum'>((best, card) => {
      return tierOrder[card.tier] > tierOrder[best] ? card.tier : best;
    }, 'bronze');
  }, [loyaltyCards]);

  const bestRank = useMemo(() => {
    const ranks = venueScores.filter(s => s.rank && s.rank > 0).map(s => s.rank!);
    return ranks.length > 0 ? Math.min(...ranks) : null;
  }, [venueScores]);

  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const HighestTierIcon = TIER_ICON[highestTier];

  return (
    <div className="min-h-screen bg-background pb-24">
      <PublicPage variant="discovery">
      {/* Hero Header */}
      <div className="relative overflow-hidden">
        <div className={cn(
          "absolute inset-0 bg-gradient-to-b",
          TIER_ACCENT[highestTier]
        )} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

        <div className="relative px-4 pt-4 pb-6">
          {/* Back button */}
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('profile.title')}
          </button>

          {/* Title section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-3"
          >
            <div className="flex items-center justify-center gap-2">
              <Trophy className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">{t('loyaltyHub.title')}</h1>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              {t('loyaltyHub.subtitle')}
            </p>
          </motion.div>

          {/* Global Stats Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-3 gap-2 mt-6"
          >
            {/* Total Points */}
            <div className="bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] rounded-2xl p-3 text-center">
              <Sparkles className="h-4 w-4 text-primary mx-auto mb-1" />
              <p className="text-xl font-bold text-foreground">{totalPoints.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('loyaltyHub.totalPoints')}</p>
            </div>

            {/* Best Rank */}
            <div className="bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] rounded-2xl p-3 text-center">
              <Crown className="h-4 w-4 text-primary mx-auto mb-1" />
              <p className="text-xl font-bold text-foreground">
                {bestRank ? `#${bestRank}` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('loyaltyHub.bestRank')}</p>
            </div>

            {/* Clubs */}
            <div className="bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] rounded-2xl p-3 text-center">
              <HighestTierIcon className="h-4 w-4 text-primary mx-auto mb-1" />
              <p className="text-xl font-bold text-foreground">{totalClubs}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{totalClubs > 1 ? 'Clubs' : 'Club'}</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Club Cards */}
      <div className="px-4 space-y-3 mt-2">
        <div className="flex items-center gap-2 px-1">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground/60 font-medium">
            {t('loyaltyHub.myClubs')}
          </h2>
          <div className="h-px flex-1 bg-border/30" />
        </div>

        {loyaltyCards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 space-y-4"
          >
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
              <Trophy className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-medium text-foreground">{t('loyaltyHub.noClubsYet')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('loyaltyHub.noClubsDesc')}</p>
            </div>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => navigate('/')}
            >
              {t('loyaltyHub.discoverClubs')}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </motion.div>
        ) : (
          <AnimatePresence>
            {loyaltyCards.map((card, idx) => {
              const score = scoreMap[card.venue_id];
              const rank = score?.rank || null;

              return (
                <motion.button
                  key={card.venue_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setSelectedVenueId(card.venue_id);
                    setShowSheet(true);
                  }}
                  className={cn(
                    "w-full text-left rounded-2xl overflow-hidden",
                    "bg-white/[0.03] backdrop-blur-sm",
                    "border border-white/[0.08]",
                    "hover:bg-white/[0.06] hover:border-white/[0.12]",
                    "transition-all duration-300",
                    "p-4"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Progress ring + logo */}
                    <LoyaltyProgressRing
                      percent={card.progress_percent}
                      size={64}
                      strokeWidth={3}
                      tier={card.tier}
                    >
                      <Avatar className="h-11 w-11 rounded-xl">
                        <AvatarImage src={card.venue_logo || undefined} alt={card.venue_name} className="object-cover" />
                        <AvatarFallback className="rounded-xl font-bold text-sm bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
                          {card.venue_name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </LoyaltyProgressRing>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <h3 className="font-semibold text-sm text-foreground truncate">{card.venue_name}</h3>
                        <TierBadge tier={card.tier} size="sm" showLabel={false} />
                      </div>

                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-xl font-bold text-primary">{card.current_balance}</span>
                        <span className="text-xs text-muted-foreground">pts</span>
                      </div>

                      {card.next_reward_name ? (
                        <div className="flex items-center gap-1 text-xs">
                          <Gift className="h-3 w-3 text-primary shrink-0" />
                          <span className="text-muted-foreground truncate">{card.next_reward_name}</span>
                          {card.next_reward_points && (
                            <span className={cn(
                              "ml-auto shrink-0 font-medium px-1.5 py-0.5 rounded-full text-[10px]",
                              card.progress_percent >= 80
                                ? "bg-primary/20 text-primary"
                                : "bg-muted text-muted-foreground"
                            )}>
                              -{(card.next_reward_points - card.current_balance)}
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

                    {/* Rank badge */}
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      {rank && rank > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (card.venue_slug) {
                              navigate(`/club/${card.venue_slug}/leaderboard`);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors",
                            rank <= 3 && "bg-primary/20 text-primary hover:bg-primary/30",
                            rank > 3 && rank <= 10 && "bg-primary/10 text-primary/80 hover:bg-primary/20",
                            rank > 10 && "bg-muted/50 text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <Crown className="h-3.5 w-3.5" />
                          #{rank}
                        </button>
                      ) : card.venue_slug ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/club/${card.venue_slug}/leaderboard`);
                          }}
                          className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
                        >
                          <Crown className="h-4 w-4" />
                        </button>
                      ) : (
                        <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
                      )}
                    </div>
                  </div>

                  {/* Close to reward indicator */}
                  {card.progress_percent >= 80 && card.next_reward_name && (
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-primary font-medium pt-2 border-t border-white/[0.06]">
                      <Sparkles className="h-3 w-3" />
                      {t('profile.almostThere')}
                    </div>
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}

        {/* Discover more clubs CTA */}
        {loyaltyCards.length > 0 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/')}
            className={cn(
              "w-full p-4 rounded-2xl",
              "bg-white/[0.03] backdrop-blur-sm",
              "border border-dashed border-white/[0.1]",
              "flex items-center justify-center gap-2",
              "text-muted-foreground font-medium text-sm",
              "hover:bg-white/[0.06] hover:border-white/[0.15] transition-all"
            )}
          >
            <Gift className="h-4 w-4" />
            {t('loyaltyHub.discoverMore')}
            <ArrowRight className="h-4 w-4" />
          </motion.button>
        )}
      </div>
      </PublicPage>


      {/* Loyalty Rewards Sheet */}
      {selectedVenueId && (
        <LoyaltyRewardsSheet
          open={showSheet}
          onOpenChange={setShowSheet}
          venueId={selectedVenueId}
        />
      )}
    </div>
  );
}
