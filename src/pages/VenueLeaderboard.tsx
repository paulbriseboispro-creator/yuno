import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Trophy, Crown, Calendar, CalendarDays, Search, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLeaderboard, getStatusBadge, anonymizeName } from '@/hooks/useLeaderboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { PublicPage } from '@/components/PublicPage';

type LeaderboardMode = 'yearly' | 'monthly' | 'event';

export default function VenueLeaderboard() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [mode, setMode] = useState<LeaderboardMode>('monthly');
  const [showMyContext, setShowMyContext] = useState(false);
  const myContextRef = useRef<HTMLDivElement>(null);

  const venueQuery = useQuery<{ id: string; name: string; logo_url: string | null } | null>({
    queryKey: ['venue-by-slug', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data } = await (supabase as any)
        .from('venues')
        .select('id, name, logo_url')
        .eq('slug', slug)
        .maybeSingle();
      return data;
    },
    enabled: !!slug,
  });

  const venueId = venueQuery.data?.id;
  const { settings, scores, myRank, loading } = useLeaderboard(venueId || undefined);

  // Determine which score/rank to use based on mode
  const getScore = (s: any): number => {
    if (mode === 'monthly') return s.monthly_score || 0;
    if (mode === 'yearly') return s.yearly_score || 0;
    return s.total_score || 0; // event uses total_score for now
  };

  const getRank = (s: any): number | null => {
    if (mode === 'monthly') return s.monthly_rank;
    if (mode === 'yearly') return s.yearly_rank;
    return s.rank;
  };

  const sortedScores = [...scores]
    .filter(s => getScore(s) > 0)
    .sort((a, b) => (getRank(a) || 999) - (getRank(b) || 999));

  const visibleScores = sortedScores.filter(s => s.leaderboard_visibility !== 'hidden');
  const topCount = settings?.show_top_count || 10;

  const myCurrentRank = myRank ? getRank(myRank) : null;
  const isInTopList = myCurrentRank != null && myCurrentRank <= topCount;

  const getMyNeighbors = () => {
    if (!myRank || !myCurrentRank) return [];
    const myIndex = sortedScores.findIndex(s => s.user_id === user?.id);
    if (myIndex < 0) return [];
    const start = Math.max(0, myIndex - 2);
    const end = Math.min(sortedScores.length, myIndex + 3);
    return sortedScores.slice(start, end).filter(s => s.leaderboard_visibility !== 'hidden');
  };

  const handleFindMyRank = () => {
    setShowMyContext(true);
    setTimeout(() => {
      myContextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  // Determine available tabs based on settings
  const contestType = settings?.leaderboard_type || 'monthly';
  const showTabs = contestType !== 'event'; // event has no tab toggle

  if (loading || venueQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 flex-1">
            <Crown className="h-5 w-5 text-yellow-500" />
            <h1 className="text-base font-semibold">{venueQuery.data?.name || 'Leaderboard'}</h1>
          </div>
        </div>
      </header>

      <PublicPage variant="discovery">
      <div className="mx-auto max-w-3xl p-4 space-y-6">
        {/* Mode Toggle */}
        {showTabs && (
          <Tabs value={mode} onValueChange={(v) => { setMode(v as LeaderboardMode); setShowMyContext(false); }}>
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="monthly" className="gap-1.5">
                <Calendar className="h-4 w-4" />
                {language === 'fr' ? 'Ce mois' : language === 'es' ? 'Este mes' : 'This month'}
              </TabsTrigger>
              <TabsTrigger value="yearly" className="gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {language === 'fr' ? 'Cette année' : language === 'es' ? 'Este año' : 'This year'}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Event contest badge */}
        {contestType === 'event' && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {language === 'fr' ? 'Concours événement' : language === 'es' ? 'Concurso del evento' : 'Event Contest'}
            </span>
          </div>
        )}

        {/* My Position Highlight */}
        {myRank && isInTopList && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "p-4 rounded-2xl",
              "bg-gradient-to-r from-primary/10 to-primary/5",
              "border border-primary/20"
            )}
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center font-bold text-xl text-primary">
                #{myCurrentRank}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{language === 'fr' ? 'Votre position' : language === 'es' ? 'Tu posición' : 'Your position'}</p>
                <p className="text-sm text-muted-foreground">
                  {Math.round(getScore(myRank)).toLocaleString()} pts
                </p>
              </div>
              {(() => {
                const badge = getStatusBadge(myCurrentRank ?? null);
                if (!badge) return null;
                return (
                  <span className={cn("text-xs font-semibold px-3 py-1.5 rounded-full border", badge.colorClass)}>
                    {badge.icon} {badge.label}
                  </span>
                );
              })()}
            </div>
          </motion.div>
        )}

        {/* Leaderboard List */}
        <div className="space-y-2">
          {visibleScores.slice(0, topCount).map((score, index) => {
            const rank = getRank(score);
            const points = getScore(score);
            const isMe = score.user_id === user?.id;
            const displayName = score.leaderboard_visibility === 'anonymous'
              ? anonymizeName(score.first_name || null, score.last_name || null)
              : [score.first_name, score.last_name].filter(Boolean).join(' ') || 'Anonymous';
            const badge = getStatusBadge(rank);

            return (
              <motion.div
                key={score.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl transition-all",
                  isMe 
                    ? "bg-primary/10 border border-primary/20 shadow-sm" 
                    : "bg-white/[0.03] hover:bg-white/[0.06]",
                  index < 3 && "border border-white/[0.08]"
                )}
              >
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0",
                  index === 0 && "bg-yellow-500/20 text-yellow-400",
                  index === 1 && "bg-slate-400/20 text-slate-300",
                  index === 2 && "bg-amber-700/20 text-amber-600",
                  index > 2 && "bg-muted/50 text-muted-foreground"
                )}>
                  {rank}
                </div>

                <Avatar className={cn("h-9 w-9", index < 3 && "ring-2 ring-white/10")}>
                  <AvatarImage src={score.avatar_url || undefined} />
                  <AvatarFallback className="text-xs bg-muted">
                    {(score.first_name || '?').charAt(0)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-medium truncate", isMe && "text-primary")}>
                    {displayName} {isMe && <span className="text-xs text-primary/60">(You)</span>}
                  </p>
                  {badge && (
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 mt-0.5", badge.colorClass)}>
                      {badge.icon} {badge.label}
                    </span>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-bold">{Math.round(points).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">pts</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Find My Rank Button */}
        {myRank && !isInTopList && (
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full gap-2 h-12 rounded-xl border-primary/20 text-primary hover:bg-primary/5"
              onClick={handleFindMyRank}
            >
              <Search className="h-4 w-4" />
              {language === 'fr' ? 'Voir ma position' : language === 'es' ? 'Ver mi posición' : 'Find my position'}
              {showMyContext ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            <AnimatePresence>
              {showMyContext && (
                <motion.div
                  ref={myContextRef}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className={cn(
                    "p-4 rounded-2xl space-y-2",
                    "bg-gradient-to-br from-primary/10 via-primary/5 to-transparent",
                    "border border-primary/20"
                  )}>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
                      {language === 'fr' ? 'Votre classement' : language === 'es' ? 'Tu clasificación' : 'Your ranking'}
                    </p>
                    {getMyNeighbors().map((score) => {
                      const rank = getRank(score);
                      const points = getScore(score);
                      const isMe = score.user_id === user?.id;
                      const displayName = score.leaderboard_visibility === 'anonymous'
                        ? anonymizeName(score.first_name || null, score.last_name || null)
                        : [score.first_name, score.last_name].filter(Boolean).join(' ') || 'Anonymous';

                      return (
                        <div
                          key={score.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl transition-all",
                            isMe 
                              ? "bg-primary/15 border border-primary/30 shadow-sm" 
                              : "bg-white/[0.03]"
                          )}
                        >
                          <div className={cn(
                            "w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0",
                            isMe ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            #{rank}
                          </div>
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={score.avatar_url || undefined} />
                            <AvatarFallback className="text-xs bg-muted">
                              {(score.first_name || '?').charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className={cn("text-sm flex-1 truncate", isMe && "font-semibold text-primary")}>
                            {displayName} {isMe && '(You)'}
                          </span>
                          <span className="text-xs font-semibold text-muted-foreground">
                            {Math.round(points).toLocaleString()} pts
                          </span>
                        </div>
                      );
                    })}
                    
                    {/* Gap to next rank */}
                    {(() => {
                      const myIdx = sortedScores.findIndex(s => s.user_id === user?.id);
                      if (myIdx <= 0) return null;
                      const above = sortedScores[myIdx - 1];
                      const myScore = getScore(myRank);
                      const aboveScore = getScore(above);
                      const gap = Math.round(aboveScore - myScore);
                      if (gap <= 0) return null;
                      return (
                        <p className="text-xs text-center text-muted-foreground pt-2">
                          {language === 'fr' 
                            ? `${gap} pts pour monter d'un rang`
                            : `${gap} pts to climb one rank`}
                        </p>
                      );
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {visibleScores.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{t('leaderboard.noData') || 'No ranking data yet'}</p>
          </div>
        )}
      </div>
      </PublicPage>
    </div>
  );
}
