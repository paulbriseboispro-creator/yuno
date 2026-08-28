import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { celebrateOnce } from '@/lib/celebrate';
import type { Json } from '@/integrations/supabase/types';

/** Ordre des paliers pour détecter une montée (jamais une descente). */
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'] as const;

interface LoyaltySettings {
  is_enabled: boolean;
  points_per_euro: number;
  welcome_bonus: number;
  post_visit_notification: boolean;
  post_visit_message: string;
}

interface LoyaltyReward {
  id: string;
  name: string;
  description: string | null;
  points_required: number;
  reward_type: string;
  reward_value: Json;
  is_active: boolean;
  position: number;
}

interface CustomerLoyalty {
  id: string;
  venue_id: string;
  total_points_earned: number;
  total_points_spent: number;
  current_balance: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  last_points_earned_at: string | null;
}

interface LoyaltyTransaction {
  id: string;
  transaction_type: 'earn' | 'redeem' | 'bonus' | 'expire' | 'adjustment';
  points: number;
  description: string | null;
  reference_type: string | null;
  created_at: string;
}

interface RewardRedemption {
  id: string;
  reward_id: string | null;
  points_spent: number;
  status: 'pending' | 'used' | 'expired' | 'cancelled';
  qr_code: string | null;
  expires_at: string | null;
  created_at: string;
  source?: string;
  reward_label?: string | null;
  reward?: LoyaltyReward;
}

export function useLoyalty(venueId?: string) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  // Distingue « pas de crédit » (data null, cas normal) d'un échec réseau/RLS.
  // Sans ça, un hoquet réseau affichait un solde à 0 à un client qui a payé.
  const [loadError, setLoadError] = useState(false);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);

  const fetchLoyaltyData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    try {
      setLoadError(false);
      // Fetch loyalty settings — 0 ligne = club sans programme (cas normal),
      // donc maybeSingle(). Une vraie erreur (réseau/RLS) doit remonter.
      const { data: settingsData, error: settingsError } = await supabase
        .from('loyalty_settings')
        .select('*')
        .eq('venue_id', venueId)
        .maybeSingle();
      if (settingsError) throw settingsError;

      setSettings(settingsData as LoyaltySettings | null);

      // Fetch available rewards
      const { data: rewardsData, error: rewardsError } = await supabase
        .from('loyalty_rewards')
        .select('*')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('position');
      if (rewardsError) throw rewardsError;

      setRewards((rewardsData || []) as LoyaltyReward[]);

      // Fetch user-specific data if logged in
      if (user) {
        // Fetch customer loyalty — 0 ligne = jamais venu dans ce club (normal),
        // donc maybeSingle(). Une erreur ici ne doit JAMAIS se déguiser en solde 0.
        const { data: loyaltyData, error: loyaltyError } = await supabase
          .from('customer_loyalty')
          .select('*')
          .eq('venue_id', venueId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (loyaltyError) throw loyaltyError;

        setLoyalty(loyaltyData as CustomerLoyalty | null);

        // Tier-up — célébration 1×/palier/club (fidélité light : on met en
        // avant l'existant, on ne reconstruit rien). Le premier passage
        // mémorise sans célébrer (pas de fête rétroactive) ; les montées
        // suivantes déclenchent l'overlay TierBadge.
        if (loyaltyData) {
          try {
            const tier = (loyaltyData as CustomerLoyalty).tier;
            const seenKey = `yuno_tier_seen:${venueId}`;
            const seen = localStorage.getItem(seenKey);
            if (seen && TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(seen as CustomerLoyalty['tier'])) {
              celebrateOnce(`tier:${venueId}:${tier}`, 'tierUp', { tier });
            }
            localStorage.setItem(seenKey, tier);
          } catch {
            // Storage indispo : pas de détection de montée, jamais bloquant.
          }
        }

        if (loyaltyData) {
          // Fetch transactions (secondaire — l'historique, pas le solde)
          const { data: transactionsData, error: transactionsError } = await supabase
            .from('loyalty_transactions')
            .select('*')
            .eq('customer_loyalty_id', loyaltyData.id)
            .order('created_at', { ascending: false })
            .limit(50);
          if (transactionsError) console.error('Error fetching loyalty transactions:', transactionsError);

          setTransactions((transactionsData || []) as LoyaltyTransaction[]);

          // Fetch redemptions (secondaire)
          const { data: redemptionsData, error: redemptionsError } = await supabase
            .from('reward_redemptions')
            .select('*, reward:loyalty_rewards(*)')
            .eq('customer_loyalty_id', loyaltyData.id)
            .order('created_at', { ascending: false });
          if (redemptionsError) console.error('Error fetching redemptions:', redemptionsError);

          setRedemptions((redemptionsData || []) as unknown as RewardRedemption[]);
        }
      }
    } catch (error) {
      // Échec du chargement critique (settings / solde) : on signale une erreur,
      // jamais un solde à 0 silencieux. Le consommateur affiche un état « réessayer ».
      console.error('Error fetching loyalty data:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [venueId, user]);

  useEffect(() => {
    fetchLoyaltyData();
  }, [fetchLoyaltyData]);

  const redeemReward = async (
    rewardId: string,
    options?: { 
      drinkId?: string; 
      eventId?: string; 
      drinkName?: string; 
      eventTitle?: string;
      roundId?: string;
      roundName?: string;
    }
  ): Promise<{ success: boolean; qrCode?: string; orderId?: string; ticketId?: string; error?: string }> => {
    if (!user || !venueId || !loyalty) {
      return { success: false, error: 'Not authenticated' };
    }

    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) {
      return { success: false, error: 'Reward not found' };
    }

    if (loyalty.current_balance < reward.points_required) {
      return { success: false, error: 'Insufficient points' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('redeem-loyalty-reward', {
        body: { 
          rewardId, 
          venueId,
          drinkId: options?.drinkId,
          eventId: options?.eventId,
          drinkName: options?.drinkName,
          eventTitle: options?.eventTitle,
          roundId: options?.roundId,
          roundName: options?.roundName
        }
      });

      if (error) throw error;

      // Refresh data
      await fetchLoyaltyData();

      return { 
        success: true, 
        qrCode: data.qrCode, 
        orderId: data.orderId,
        ticketId: data.ticketId 
      };
    } catch (error) {
      console.error('Error redeeming reward:', error);
      return { success: false, error: 'Failed to redeem reward' };
    }
  };

  const getNextReward = () => {
    if (!loyalty || rewards.length === 0) return null;
    
    const affordableRewards = rewards.filter(r => r.points_required <= loyalty.current_balance);
    const nextReward = rewards
      .filter(r => r.points_required > loyalty.current_balance)
      .sort((a, b) => a.points_required - b.points_required)[0];

    return {
      nextReward,
      affordableRewards,
      pointsToNext: nextReward ? nextReward.points_required - loyalty.current_balance : 0,
      progressPercent: nextReward 
        ? Math.min(100, (loyalty.current_balance / nextReward.points_required) * 100)
        : 100
    };
  };

  return {
    loading,
    loadError,
    settings,
    loyalty,
    rewards,
    transactions,
    redemptions,
    redeemReward,
    getNextReward,
    refetch: fetchLoyaltyData,
    isEnabled: settings?.is_enabled ?? false
  };
}

// Hook for owner/manager to manage loyalty
export function useLoyaltyManagement(venueId?: string) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [stats, setStats] = useState({
    totalPointsIssued: 0,
    totalPointsRedeemed: 0,
    totalRedemptions: 0,
    activeCustomers: 0,
    tierDistribution: { bronze: 0, silver: 0, gold: 0, platinum: 0 }
  });

  const fetchData = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    try {
      // Fetch settings
      const { data: settingsData } = await supabase
        .from('loyalty_settings')
        .select('*')
        .eq('venue_id', venueId)
        .single();

      setSettings(settingsData as LoyaltySettings | null);

      // Fetch all rewards
      const { data: rewardsData } = await supabase
        .from('loyalty_rewards')
        .select('*')
        .eq('venue_id', venueId)
        .order('position');

      setRewards((rewardsData || []) as LoyaltyReward[]);

      // Fetch stats
      const { data: loyaltyData } = await supabase
        .from('customer_loyalty')
        .select('total_points_earned, total_points_spent, tier')
        .eq('venue_id', venueId);

      if (loyaltyData) {
        const tierDist = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
        let totalEarned = 0;
        let totalSpent = 0;

        loyaltyData.forEach((cl: { total_points_earned: number; total_points_spent: number; tier: string }) => {
          totalEarned += cl.total_points_earned || 0;
          totalSpent += cl.total_points_spent || 0;
          tierDist[cl.tier as keyof typeof tierDist]++;
        });

        const { count: redemptionCount } = await supabase
          .from('reward_redemptions')
          .select('*', { count: 'exact', head: true })
          .eq('venue_id', venueId);

        setStats({
          totalPointsIssued: totalEarned,
          totalPointsRedeemed: totalSpent,
          totalRedemptions: redemptionCount || 0,
          activeCustomers: loyaltyData.length,
          tierDistribution: tierDist
        });
      }
    } catch (error) {
      console.error('Error fetching loyalty management data:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateSettings = async (newSettings: Partial<LoyaltySettings>) => {
    if (!venueId) return { success: false };

    try {
      const { error } = await supabase
        .from('loyalty_settings')
        .upsert({
          venue_id: venueId,
          ...settings,
          ...newSettings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'venue_id' });

      if (error) throw error;

      setSettings(prev => prev ? { ...prev, ...newSettings } : null);
      return { success: true };
    } catch (error) {
      console.error('Error updating settings:', error);
      return { success: false };
    }
  };

  const createReward = async (reward: {
    name: string;
    description?: string | null;
    points_required: number;
    reward_type: string;
    reward_value?: Json;
    is_active?: boolean;
  }) => {
    if (!venueId) return { success: false };

    try {
      const { data, error } = await supabase
        .from('loyalty_rewards')
        .insert({
          venue_id: venueId,
          name: reward.name,
          description: reward.description,
          points_required: reward.points_required,
          reward_type: reward.reward_type,
          reward_value: reward.reward_value ?? {},
          is_active: reward.is_active ?? true,
          position: rewards.length
        })
        .select()
        .single();

      if (error) throw error;

      setRewards(prev => [...prev, data as LoyaltyReward]);
      return { success: true, reward: data };
    } catch (error) {
      console.error('Error creating reward:', error);
      return { success: false };
    }
  };

  const updateReward = async (rewardId: string, updates: {
    name?: string;
    description?: string | null;
    points_required?: number;
    reward_type?: string;
    reward_value?: Json;
    is_active?: boolean;
    position?: number;
  }) => {
    try {
      const { error } = await supabase
        .from('loyalty_rewards')
        .update(updates)
        .eq('id', rewardId);

      if (error) throw error;

      setRewards(prev => prev.map(r => r.id === rewardId ? { ...r, ...updates } as LoyaltyReward : r));
      return { success: true };
    } catch (error) {
      console.error('Error updating reward:', error);
      return { success: false };
    }
  };

  const deleteReward = async (rewardId: string) => {
    try {
      const { error } = await supabase
        .from('loyalty_rewards')
        .delete()
        .eq('id', rewardId);

      if (error) throw error;

      setRewards(prev => prev.filter(r => r.id !== rewardId));
      return { success: true };
    } catch (error) {
      console.error('Error deleting reward:', error);
      return { success: false };
    }
  };

  return {
    loading,
    settings,
    rewards,
    stats,
    updateSettings,
    createReward,
    updateReward,
    deleteReward,
    refetch: fetchData
  };
}
