import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ClientScore {
  id: string;
  user_id: string;
  venue_id: string;
  total_score: number;
  spend_score: number;
  visit_score: number;
  vip_score: number;
  event_score: number;
  recency_boost: number;
  rank: number | null;
  monthly_score: number;
  monthly_rank: number | null;
  yearly_score: number;
  yearly_rank: number | null;
  last_activity_at: string | null;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  leaderboard_visibility?: string;
}

export interface LeaderboardSettings {
  id: string;
  venue_id: string;
  is_enabled: boolean;
  leaderboard_type: string;
  spend_weight: number;
  visit_weight: number;
  vip_weight: number;
  event_weight: number;
  recency_enabled: boolean;
  recency_days: number;
  show_top_count: number;
  auto_reward: boolean;
  contest_event_id: string | null;
}

export interface LeaderboardReward {
  id: string;
  venue_id: string;
  rank_min: number;
  rank_max: number;
  reward_type: string;
  reward_description: string | null;
  reward_config: {
    quantity?: number;
    drink_category?: string;
    zone_id?: string;
    pack_id?: string;
  } | null;
  is_active: boolean;
}

export interface LeaderboardContest {
  id: string;
  venue_id: string;
  name: string;
  contest_type: string;
  event_id: string | null;
  start_date: string;
  end_date: string;
  status: string;
  reward_preset_ids: string[];
  scoring_config: Record<string, any>;
  auto_reward: boolean;
  rewards_distributed: boolean;
  created_at: string;
  updated_at: string;
  // joined
  event_title?: string;
}

export interface ContestWinner {
  id: string;
  contest_id: string;
  venue_id: string;
  user_id: string;
  rank: number;
  score: number;
  reward_type: string;
  reward_config: Record<string, any>;
  reward_description: string | null;
  redeemed: boolean;
  redeemed_at: string | null;
  created_at: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
}

export function useLeaderboard(venueId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['leaderboard-settings', venueId],
    queryFn: async () => {
      if (!venueId) return null;
      const { data, error } = await supabase
        .from('leaderboard_settings')
        .select('*')
        .eq('venue_id', venueId)
        .maybeSingle();
      if (error) throw error;
      return data as LeaderboardSettings | null;
    },
    enabled: !!venueId,
  });

  const scoresQuery = useQuery({
    queryKey: ['leaderboard-scores', venueId],
    queryFn: async () => {
      if (!venueId) return [];
      const { data, error } = await supabase
        .from('client_scores')
        .select('*')
        .eq('venue_id', venueId)
        .order('rank', { ascending: true, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      
      const userIds = (data || []).map((s: any) => s.user_id);
      if (userIds.length === 0) return [];
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url, leaderboard_visibility')
        .in('id', userIds);
      
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      
      return (data || []).map((score: any) => {
        const profile = profileMap.get(score.user_id) as any;
        return {
          ...score,
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          avatar_url: profile?.avatar_url,
          leaderboard_visibility: profile?.leaderboard_visibility || 'public',
        };
      }) as ClientScore[];
    },
    enabled: !!venueId,
  });

  const rewardsQuery = useQuery({
    queryKey: ['leaderboard-rewards', venueId],
    queryFn: async () => {
      if (!venueId) return [];
      const { data, error } = await supabase
        .from('leaderboard_rewards')
        .select('*')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('rank_min', { ascending: true });
      if (error) throw error;
      return (data || []) as LeaderboardReward[];
    },
    enabled: !!venueId,
  });

  // Contests
  const contestsQuery = useQuery({
    queryKey: ['leaderboard-contests', venueId],
    queryFn: async () => {
      if (!venueId) return [];
      const { data, error } = await supabase
        .from('leaderboard_contests')
        .select('*')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as LeaderboardContest[];
    },
    enabled: !!venueId,
  });

  const myRank = scoresQuery.data?.find(s => s.user_id === user?.id) || null;

  const updateSettings = useMutation({
    mutationFn: async (settings: Partial<LeaderboardSettings>) => {
      if (!venueId) throw new Error('No venue');
      const { error } = await supabase
        .from('leaderboard_settings')
        .upsert({ venue_id: venueId, ...settings } as any, { onConflict: 'venue_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leaderboard-settings', venueId] }),
  });

  const recalculateScores = useMutation({
    mutationFn: async () => {
      if (!venueId) throw new Error('No venue');
      const { error } = await supabase.rpc('calculate_client_scores', { p_venue_id: venueId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leaderboard-scores', venueId] }),
  });

  const saveReward = useMutation({
    mutationFn: async (reward: Partial<LeaderboardReward> & { venue_id: string }) => {
      if (reward.id) {
        const { id, ...rest } = reward;
        const { error } = await supabase
          .from('leaderboard_rewards')
          .update(rest as any)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('leaderboard_rewards')
          .insert(reward as any);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leaderboard-rewards', venueId] }),
  });

  const deleteReward = useMutation({
    mutationFn: async (rewardId: string) => {
      const { error } = await supabase
        .from('leaderboard_rewards')
        .delete()
        .eq('id', rewardId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leaderboard-rewards', venueId] }),
  });

  // Contest mutations
  const saveContest = useMutation({
    mutationFn: async (contest: Partial<LeaderboardContest> & { venue_id: string }) => {
      if (contest.id) {
        const { id, ...rest } = contest;
        const { error } = await supabase
          .from('leaderboard_contests')
          .update(rest as any)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('leaderboard_contests')
          .insert(contest as any);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leaderboard-contests', venueId] }),
  });

  const deleteContest = useMutation({
    mutationFn: async (contestId: string) => {
      const { error } = await supabase
        .from('leaderboard_contests')
        .delete()
        .eq('id', contestId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leaderboard-contests', venueId] }),
  });

  const finalizeContest = useMutation({
    mutationFn: async (contestId: string) => {
      const { data, error } = await supabase.rpc('finalize_leaderboard_contest', { p_contest_id: contestId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaderboard-contests', venueId] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard-scores', venueId] });
    },
  });

  return {
    settings: settingsQuery.data,
    scores: scoresQuery.data || [],
    rewards: rewardsQuery.data || [],
    contests: contestsQuery.data || [],
    myRank,
    loading: settingsQuery.isLoading || scoresQuery.isLoading,
    updateSettings,
    recalculateScores,
    saveReward,
    deleteReward,
    saveContest,
    deleteContest,
    finalizeContest,
  };
}

export interface ContestScore {
  id: string;
  contest_id: string;
  venue_id: string;
  user_id: string;
  spend: number;
  order_count: number;
  ticket_count: number;
  table_count: number;
  score: number;
  rank: number | null;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  leaderboard_visibility?: string;
}

// Window-correct ranking for a single contest (reads leaderboard_contest_scores,
// populated by calculate_contest_scores / the hourly recalc cron).
export function useContestScores(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contest-scores', contestId],
    queryFn: async () => {
      if (!contestId) return [];
      const { data, error } = await supabase
        .from('leaderboard_contest_scores')
        .select('*')
        .eq('contest_id', contestId)
        .order('rank', { ascending: true, nullsFirst: false })
        .limit(50);
      if (error) throw error;

      const userIds = (data || []).map((s: any) => s.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url, leaderboard_visibility')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      return (data || []).map((score: any) => {
        const profile = profileMap.get(score.user_id) as any;
        return {
          ...score,
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          avatar_url: profile?.avatar_url,
          leaderboard_visibility: profile?.leaderboard_visibility || 'public',
        };
      }) as ContestScore[];
    },
    enabled: !!contestId,
  });
}

export function useContestWinners(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contest-winners', contestId],
    queryFn: async () => {
      if (!contestId) return [];
      const { data, error } = await supabase
        .from('leaderboard_contest_winners')
        .select('*')
        .eq('contest_id', contestId)
        .order('rank', { ascending: true });
      if (error) throw error;
      
      const userIds = (data || []).map((w: any) => w.user_id);
      if (userIds.length === 0) return [];
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url')
        .in('id', userIds);
      
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      
      return (data || []).map((w: any) => {
        const profile = profileMap.get(w.user_id) as any;
        return {
          ...w,
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          avatar_url: profile?.avatar_url,
        };
      }) as ContestWinner[];
    },
    enabled: !!contestId,
  });
}

export function getStatusBadge(rank: number | null): { label: string; colorClass: string; icon: string } | null {
  if (!rank) return null;
  if (rank === 1) return { label: 'Top Client', colorClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: '👑' };
  if (rank <= 5) return { label: 'Elite Member', colorClass: 'bg-violet-500/20 text-violet-400 border-violet-500/30', icon: '💎' };
  if (rank <= 10) return { label: 'VIP Regular', colorClass: 'bg-primary/20 text-primary border-primary/30', icon: '⭐' };
  return null;
}

export function anonymizeName(firstName: string | null, lastName: string | null): string {
  const f = firstName || '?';
  const l = lastName || '?';
  return `${f.charAt(0)}*** ${l.charAt(0)}.`;
}
