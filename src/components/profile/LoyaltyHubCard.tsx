import { motion } from 'framer-motion';
import { Trophy, Crown, Sparkles, ChevronRight, Gift, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LoyaltyProgressRing } from '@/components/profile/LoyaltyProgressRing';
import { TierBadge } from '@/components/loyalty/TierBadge';
import { useMemo } from 'react';

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
  rank?: number | null;
}

interface LoyaltyHubCardProps {
  cards: LoyaltyCard[];
  onCardClick: (venueId: string) => void;
  onViewAll: () => void;
}

const TIER_GRADIENT = {
  bronze: 'from-primary/10 via-primary/5 to-transparent',
  silver: 'from-primary/12 via-primary/5 to-transparent',
  gold: 'from-primary/15 via-primary/5 to-transparent',
  platinum: 'from-primary/20 via-primary/8 to-transparent',
};

export function LoyaltyHubCard({ cards, onCardClick, onViewAll }: LoyaltyHubCardProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const totalPoints = cards.reduce((s, c) => s + c.current_balance, 0);
  const totalClubs = cards.length;

  const highestTier = useMemo(() => {
    const order = { bronze: 0, silver: 1, gold: 2, platinum: 3 } as const;
    return cards.reduce<'bronze' | 'silver' | 'gold' | 'platinum'>((best, c) => {
      return order[c.tier] > order[best] ? c.tier : best;
    }, 'bronze');
  }, [cards]);

  const bestRank = useMemo(() => {
    const ranks = cards.filter(c => c.rank && c.rank > 0).map(c => c.rank!);
    return ranks.length > 0 ? Math.min(...ranks) : null;
  }, [cards]);

  const hasData = cards.length > 0;

  return (
    <motion.div
      whileTap={{ scale: 0.985 }}
      className="relative overflow-hidden"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
    >
      {/* Voile accent rouge basé sur le tier */}
      <div className={cn(
        "absolute inset-0 bg-gradient-to-br opacity-60 pointer-events-none",
        hasData ? TIER_GRADIENT[highestTier] : 'from-primary/10 to-transparent'
      )} />

      {/* Zone cliquable principale */}
      <button
        onClick={onViewAll}
        className="relative w-full text-left p-4"
      >
        {/* Ligne du haut : icône + titre + flèche */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="h-11 w-11 flex items-center justify-center shrink-0"
            style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4 }}
          >
            <Trophy className="h-5 w-5" style={{ color: '#E8192C' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold uppercase text-white" style={{ fontSize: '15px', letterSpacing: '-0.005em' }}>{t('loyaltyHub.title')}</h3>
            <p className="font-mono uppercase mt-1 leading-tight" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
              {t('loyaltyHub.profileCta')}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#5A5A5E' }} />
        </div>

        {/* Ligne de stats */}
        {hasData && (
          <div className="flex items-center gap-3 mb-1">
            {/* Points */}
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" style={{ color: '#E8192C' }} />
              <span className="font-display font-bold tabular-nums" style={{ fontSize: '18px', letterSpacing: '-0.02em', color: '#E8192C' }}>
                {totalPoints.toLocaleString()}
              </span>
              <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#5A5A5E' }}>pts</span>
            </div>

            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.10)' }} />

            {/* Meilleur rang */}
            {bestRank && (
              <>
                <div className="flex items-center gap-1">
                  <Crown className="h-3 w-3" style={{ color: '#E8192C' }} />
                  <span className="font-mono font-bold text-white" style={{ fontSize: '13px' }}>#{bestRank}</span>
                </div>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.10)' }} />
              </>
            )}

            {/* Nombre de clubs */}
            <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
              {totalClubs} {totalClubs > 1 ? 'clubs' : 'club'}
            </span>

            {/* Badge tier */}
            <div className="ml-auto">
              <TierBadge tier={highestTier} size="sm" />
            </div>
          </div>
        )}
      </button>

      {/* Club cards carousel */}
      {hasData && (
        <div className="relative px-4 pb-4">
          <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory scrollbar-none -mx-1 px-1 pb-1">
            {cards.map((card) => (
              <button
                key={card.venue_id}
                onClick={() => onCardClick(card.venue_id)}
                className="snap-start shrink-0 w-[220px] p-3 text-left transition-all duration-200 hover:brightness-110"
                style={{ background: '#1B1B1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}
              >
                <div className="flex items-center gap-2.5">
                  <LoyaltyProgressRing
                    percent={card.progress_percent}
                    size={44}
                    strokeWidth={2.5}
                    tier={card.tier}
                  >
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage src={card.venue_logo || undefined} alt={card.venue_name} className="object-cover" />
                      <AvatarFallback className="rounded-lg text-[10px] font-bold bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
                        {card.venue_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </LoyaltyProgressRing>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-display font-bold uppercase text-white truncate" style={{ fontSize: '12px', letterSpacing: '-0.005em' }}>{card.venue_name}</span>
                      <TierBadge tier={card.tier} size="sm" showLabel={false} />
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="font-display font-bold" style={{ fontSize: '14px', color: '#E8192C' }}>{card.current_balance}</span>
                      <span className="font-mono uppercase" style={{ fontSize: '8px', letterSpacing: '0.06em', color: '#5A5A5E' }}>pts</span>
                    </div>
                  </div>

                  {card.rank && card.rank > 0 && (
                    <div
                      className="flex items-center gap-0.5 px-1.5 py-1 font-mono font-bold shrink-0"
                      style={{
                        fontSize: '10px', borderRadius: 3,
                        background: card.rank <= 10 ? 'rgba(232,25,44,0.14)' : 'rgba(255,255,255,0.05)',
                        color: card.rank <= 10 ? '#E8192C' : '#9A9A9A',
                      }}
                    >
                      <Crown className="h-2.5 w-2.5" />
                      #{card.rank}
                    </div>
                  )}
                </div>

                {/* Indice prochaine récompense */}
                {card.next_reward_name ? (
                  <div className="flex items-center gap-1 mt-2.5 font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.04em', color: '#9A9A9A' }}>
                    <Gift className="h-2.5 w-2.5 shrink-0" style={{ color: 'rgba(232,25,44,0.7)' }} />
                    <span className="truncate">{card.next_reward_name}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 mt-2.5 font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.04em', color: '#5A5A5E' }}>
                    <Star className="h-2.5 w-2.5 shrink-0" />
                    <span>{t('profile.allRewardsClaimed')}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* État vide */}
      {!hasData && (
        <button onClick={onViewAll} className="relative w-full px-4 pb-4">
          <div className="flex items-center justify-center gap-2 py-3 font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
            <Gift className="h-3.5 w-3.5" />
            <span>{t('loyaltyHub.noClubsDesc')}</span>
          </div>
        </button>
      )}

      {/* Explication du bas */}
      {hasData && (
        <div className="px-4 pb-3">
          <button
            onClick={onViewAll}
            className="w-full flex items-center justify-center gap-1.5 py-2 font-mono uppercase transition-colors hover:brightness-125"
            style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#5A5A5E' }}
          >
            <span>{t('loyaltyHub.seeFullDetails')}</span>
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </motion.div>
  );
}