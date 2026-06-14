import { motion } from 'framer-motion';
import { Trophy, ChevronRight, Crown } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useLeaderboard, getStatusBadge, anonymizeName } from '@/hooks/useLeaderboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface LeaderboardSectionProps {
  venueId: string;
  venueName: string;
  venueSlug?: string;
}

export function LeaderboardSection({ venueId, venueName, venueSlug }: LeaderboardSectionProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { settings, scores, myRank, loading } = useLeaderboard(venueId);

  if (loading || !settings?.is_enabled || scores.length === 0) return null;

  const top3 = scores.filter(s => s.rank && s.rank <= 3 && s.leaderboard_visibility !== 'hidden');

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <Crown className="h-4 w-4 text-yellow-500" />
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground/60 font-medium">
            {t('leaderboard.title') || 'Leaderboard'}
          </h2>
        </div>
        <span className="text-xs text-muted-foreground/40">{venueName}</span>
      </div>

      {/* My rank card */}
      {myRank && (
        <motion.div
          whileHover={{ scale: 1.01 }}
          className={cn(
            "p-4 rounded-2xl relative overflow-hidden",
            "bg-gradient-to-br from-primary/10 via-primary/5 to-transparent",
            "border border-primary/20"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center font-bold text-lg",
                myRank.rank === 1 && "bg-yellow-500/20 text-yellow-400",
                myRank.rank && myRank.rank > 1 && myRank.rank <= 5 && "bg-violet-500/20 text-violet-400",
                myRank.rank && myRank.rank > 5 && "bg-primary/20 text-primary"
              )}>
                #{myRank.rank}
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">
                  {t('leaderboard.yourRank') || 'Your Ranking'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(myRank.total_score).toLocaleString()} pts
                </p>
              </div>
            </div>
            {(() => {
              const badge = getStatusBadge(myRank.rank);
              if (!badge) return null;
              return (
                <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full border", badge.colorClass)}>
                  {badge.icon} {badge.label}
                </span>
              );
            })()}
          </div>
        </motion.div>
      )}

      {/* Top 3 mini list */}
      <div className="space-y-1.5">
        {top3.map((score, i) => {
          const isMe = score.user_id === user?.id;
          const displayName = score.leaderboard_visibility === 'anonymous'
            ? anonymizeName(score.first_name || null, score.last_name || null)
            : [score.first_name, score.last_name].filter(Boolean).join(' ') || 'Anonymous';

          return (
            <div
              key={score.id}
              className={cn(
                "flex items-center gap-3 p-2.5 rounded-xl transition-colors",
                isMe ? "bg-primary/10 border border-primary/20" : "bg-white/[0.03]"
              )}
            >
              <span className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
                i === 0 && "bg-yellow-500/20 text-yellow-400",
                i === 1 && "bg-slate-400/20 text-slate-300",
                i === 2 && "bg-amber-700/20 text-amber-600"
              )}>
                {score.rank}
              </span>
              <Avatar className="h-7 w-7">
                <AvatarImage src={score.avatar_url || undefined} />
                <AvatarFallback className="text-[10px] bg-muted">
                  {(score.first_name || '?').charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className={cn("text-sm flex-1 truncate", isMe && "font-semibold text-primary")}>
                {displayName} {isMe && '(You)'}
              </span>
              <span className="text-xs text-muted-foreground font-medium">
                {Math.round(score.total_score).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      {/* See full leaderboard */}
      {venueSlug && (
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => navigate(`/club/${venueSlug}/leaderboard`)}
          className={cn(
            "w-full p-3 rounded-xl",
            "bg-white/[0.03] border border-white/[0.08]",
            "flex items-center justify-center gap-2",
            "text-muted-foreground text-xs font-medium",
            "hover:bg-white/[0.06] transition-all"
          )}
        >
          <Trophy className="h-3.5 w-3.5" />
          {t('leaderboard.viewFull') || 'View full leaderboard'}
          <ChevronRight className="h-3.5 w-3.5" />
        </motion.button>
      )}
    </motion.section>
  );
}
