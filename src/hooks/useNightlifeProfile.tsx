import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface NightlifeStats {
  nights_attended: number;
  drinks_ordered: number;
  most_active_hour: number;
  favorite_drink: string | null;
  favorite_club_id: string | null;
  favorite_club_name: string | null;
  favorite_club_logo: string | null;
  favorite_club_visits: number;
  last_event_id: string | null;
  last_event_title: string | null;
  last_event_date: string | null;
  last_event_venue_name: string | null;
  next_event_id: string | null;
  next_event_title: string | null;
  next_event_date: string | null;
  next_event_venue_name: string | null;
  total_spent: number;
  venues_visited: number;
  cities_explored: number;
  has_vip_reservation: boolean;
  has_redeemed_reward: boolean;
}

interface StreakData {
  currentStreak: number;
  longestStreak: number;
}

function calculateWeekStreaks(eventDates: string[]): StreakData {
  if (!eventDates.length) return { currentStreak: 0, longestStreak: 0 };

  // Get ISO week number (Mon-Sun)
  const getWeekKey = (d: Date) => {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${weekNo}`;
  };

  // Unique weeks with at least one event
  const weeks = new Set(eventDates.map(d => getWeekKey(new Date(d))));
  const sortedWeeks = Array.from(weeks).sort();

  // Current week key
  const now = new Date();
  const currentWeekKey = getWeekKey(now);
  // Last week key
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekKey = getWeekKey(lastWeek);

  // Build consecutive sequences
  let longest = 0;
  let current = 0;
  let streak = 1;

  for (let i = 1; i < sortedWeeks.length; i++) {
    // Check if consecutive: parse year & week
    const [prevY, prevW] = sortedWeeks[i - 1].split('-W').map(Number);
    const [curY, curW] = sortedWeeks[i].split('-W').map(Number);

    const isConsecutive =
      (curY === prevY && curW === prevW + 1) ||
      (curY === prevY + 1 && prevW >= 52 && curW === 1);

    if (isConsecutive) {
      streak++;
    } else {
      longest = Math.max(longest, streak);
      streak = 1;
    }
  }
  longest = Math.max(longest, streak);

  // Current streak = streak that includes current week or last week
  const lastSorted = sortedWeeks[sortedWeeks.length - 1];
  if (lastSorted === currentWeekKey || lastSorted === lastWeekKey) {
    current = streak; // the last streak sequence
  }

  return { currentStreak: current, longestStreak: longest };
}

interface TasteProfile {
  music_style: string;
  drink_preference: string;
  vibe_preference: string;
  crowd_size: string;
  night_type: string;
}

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
  total_points_earned: number;
  next_reward_name: string | null;
  next_reward_points: number | null;
  progress_percent: number;
  recent_transactions: LoyaltyTransaction[];
}

interface Profile {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  background_url: string | null;
  city: string | null;
  birth_date: string | null;
  email: string;
  leaderboard_visibility: string;
}

export type UserBadge = 'new' | 'regular' | 'vip';

export function useNightlifeProfile() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dataFetched, setDataFetched] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<NightlifeStats | null>(null);
  const [loyaltyCards, setLoyaltyCards] = useState<LoyaltyCard[]>([]);
  const [tasteProfile, setTasteProfile] = useState<TasteProfile | null>(null);
  const [badge, setBadge] = useState<UserBadge>('new');
  const [streak, setStreak] = useState<StreakData>({ currentStreak: 0, longestStreak: 0 });

  const refreshTimerRef = useRef<number | null>(null);

  const calculateBadge = useCallback((nightsAttended: number, totalSpent: number, cards: LoyaltyCard[]): UserBadge => {
    // VIP if: 10+ nights, any platinum tier, or total spent > 500€
    const hasPlatinum = cards.some(c => c.tier === 'platinum');
    if (nightsAttended >= 10 || hasPlatinum || totalSpent >= 500) {
      return 'vip';
    }
    // Regular if: 2-9 nights
    if (nightsAttended >= 2) {
      return 'regular';
    }
    // New otherwise
    return 'new';
  }, []);

  const calculateTierFromSpent = (totalSpent: number): 'bronze' | 'silver' | 'gold' | 'platinum' => {
    if (totalSpent >= 1000) return 'platinum';
    if (totalSpent >= 500) return 'gold';
    if (totalSpent >= 200) return 'silver';
    return 'bronze';
  };

  const fetchData = useCallback(async () => {
    if (!user || authLoading) {
      if (!authLoading && !user) {
        setLoading(false);
      }
      return;
    }

    try {
      /* ══ VAGUE 1 ══════════════════════════════════════════════════════════
         Tout ne dépend que de user.id : ces requêtes n'avaient AUCUNE raison de
         s'attendre les unes les autres. Elles partaient pourtant en file indienne
         (profil → stats → salles → villes → VIP → récompense → boisson → commandes
         → tickets → goûts → fidélité), soit une douzaine d'allers-retours empilés
         avant que la page Profil n'ait le droit de s'afficher. D'où l'écran vide.

         Au passage, `venue_customers` était interrogée DEUX fois (une fois pour
         les salles, une fois pour les villes) : une seule requête sert désormais
         les salles, les villes, les stats de repli ET les cartes de fidélité. ══ */
      const [
        profileRes, statsRes, vcRes, vipRes, rewardRes, favoriteDrinkRes,
        ordersRes, ticketsRes, tasteRes, loyaltyRes,
      ] = await Promise.all([
        supabase.from('profiles')
          .select('first_name, last_name, avatar_url, background_url, city, birth_date, email, leaderboard_visibility')
          .eq('id', user.id).single(),
        supabase.rpc('get_user_nightlife_stats', { p_user_id: user.id }),
        supabase.from('venue_customers')
          .select('venue_id, order_count, ticket_count, table_count, total_spent, venues(id, name, logo_url, city)')
          .eq('user_id', user.id),
        supabase.from('table_reservations').select('id').eq('user_id', user.id).eq('status', 'paid').limit(1),
        supabase.from('loyalty_transactions').select('id').eq('transaction_type', 'spend').limit(1),
        supabase.from('favorites').select('drink_id, drinks(name)')
          .eq('user_id', user.id).eq('favorite_type', 'drink').not('drink_id', 'is', null)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('orders').select('items')
          .eq('user_id', user.id).in('status', ['paid', 'served', 'ready', 'picked_up']),
        supabase.from('tickets').select('event_id, events(start_at)')
          .eq('user_id', user.id).eq('status', 'paid'),
        supabase.from('user_taste_profiles')
          .select('music_style, drink_preference, vibe_preference, crowd_size, night_type')
          .eq('user_id', user.id).maybeSingle(),
        supabase.from('customer_loyalty')
          .select('id, venue_id, current_balance, tier, total_points_earned, venues:venue_id (id, name, logo_url)')
          .eq('user_id', user.id),
      ]);

      const profileData = profileRes.data;
      const { data: statsData, error: statsError } = statsRes;
      const ordersData = ordersRes.data;
      const loyaltyData = loyaltyRes.data;

      // venue_customers, trié une fois pour toutes (le repli de stats prenait la
      // salle la plus « fréquentée » — order by ticket_count desc côté serveur).
      const vcRows = [...(vcRes.data ?? [])].sort(
        (a, b) => (b.ticket_count || 0) - (a.ticket_count || 0),
      );

      setProfile(profileData ? { ...profileData, leaderboard_visibility: profileData.leaderboard_visibility || 'public' } as Profile : null);

      let fetchedStats: NightlifeStats | null = null;

      const favoriteDrinkFromFavorites = (() => {
        const drinkData = favoriteDrinkRes.data?.drinks as
          | { name?: string | null }
          | Array<{ name?: string | null }>
          | null
          | undefined;

        if (Array.isArray(drinkData)) {
          return drinkData[0]?.name ?? null;
        }

        return drinkData?.name ?? null;
      })();

      let mostOrderedDrink: string | null = null;
      if (ordersData && ordersData.length > 0) {
        const drinkCounts: Record<string, number> = {};
        
        ordersData.forEach(order => {
          try {
            // Handle items as JSON - could be array or string
            let items: any[] = [];
            if (typeof order.items === 'string') {
              items = JSON.parse(order.items);
            } else if (Array.isArray(order.items)) {
              items = order.items;
            }
            
            if (Array.isArray(items)) {
              items.forEach((item: any) => {
                // Support both 'name' and 'drink_name' keys
                const drinkName = item?.name || item?.drink_name;
                if (!drinkName) return;
                const qty = Number(item?.qty || item?.quantity || 1);
                drinkCounts[drinkName] = (drinkCounts[drinkName] || 0) + qty;
              });
            }
          } catch (e) {
            // Skip malformed items
          }
        });

        // Find the drink with highest count
        let maxCount = 0;
        Object.entries(drinkCounts).forEach(([name, count]) => {
          if (count > maxCount) {
            maxCount = count;
            mostOrderedDrink = name;
          }
        });
      }

      // Tout se déduit des lignes venue_customers déjà chargées en vague 1.
      const venuesVisited = new Set(vcRows.map(v => v.venue_id)).size;
      const citiesExplored = new Set(
        vcRows
          .map(v => (v.venues as { city: string } | null)?.city)
          .filter(Boolean)
      ).size;
      const hasVipReservation = (vipRes.data?.length || 0) > 0;
      const hasRedeemedReward = (rewardRes.data?.length || 0) > 0;

      if (statsError) {
        console.error('Error fetching nightlife stats:', statsError);
        // Repli : stats de base recalculées depuis venue_customers (déjà en mémoire).
        const vcData = vcRows;

      if (vcData && vcData.length > 0) {
          // Count actual drink items from orders instead of order count
          let totalDrinkItems = 0;
          if (ordersData && ordersData.length > 0) {
            ordersData.forEach(order => {
              const items = order.items as Array<{ name: string; qty: number }>;
              if (Array.isArray(items)) {
                items.forEach(item => {
                  totalDrinkItems += (item.qty || 1);
                });
              }
            });
          }
          const totalTickets = vcData.reduce((sum, vc) => sum + (vc.ticket_count || 0), 0);
          const totalSpent = vcData.reduce((sum, vc) => sum + Number(vc.total_spent || 0), 0);
          const topVenue = vcData[0];
          const venueInfo = topVenue?.venues as unknown as { name: string; logo_url: string | null } | null;
          const favoriteClubVisits = (topVenue?.ticket_count || 0) + (topVenue?.order_count || 0) + (topVenue?.table_count || 0);

          fetchedStats = {
            nights_attended: totalTickets,
            drinks_ordered: totalDrinkItems,
            most_active_hour: 23,
            favorite_drink: mostOrderedDrink || favoriteDrinkFromFavorites,
            favorite_club_id: topVenue?.venue_id || null,
            favorite_club_name: venueInfo?.name || null,
            favorite_club_logo: venueInfo?.logo_url || null,
            favorite_club_visits: favoriteClubVisits,
            last_event_id: null,
            last_event_title: null,
            last_event_date: null,
            last_event_venue_name: null,
            next_event_id: null,
            next_event_title: null,
            next_event_date: null,
            next_event_venue_name: null,
            total_spent: totalSpent,
            venues_visited: venuesVisited,
            cities_explored: citiesExplored,
            has_vip_reservation: hasVipReservation,
            has_redeemed_reward: hasRedeemedReward
          };
          setStats(fetchedStats);
        } else {
          // No data at all
          fetchedStats = {
            nights_attended: 0,
            drinks_ordered: 0,
            most_active_hour: 23,
            favorite_drink: mostOrderedDrink || favoriteDrinkFromFavorites,
            favorite_club_id: null,
            favorite_club_name: null,
            favorite_club_logo: null,
            favorite_club_visits: 0,
            last_event_id: null,
            last_event_title: null,
            last_event_date: null,
            last_event_venue_name: null,
            next_event_id: null,
            next_event_title: null,
            next_event_date: null,
            next_event_venue_name: null,
            total_spent: 0,
            venues_visited: 0,
            cities_explored: 0,
            has_vip_reservation: false,
            has_redeemed_reward: false
          };
          setStats(fetchedStats);
        }
      } else if (statsData && statsData.length > 0) {
        const baseStats = statsData[0];

        // Visites du club favori : lues dans les lignes venue_customers déjà
        // chargées, au lieu d'un aller-retour de plus pour une seule ligne.
        let favoriteClubVisits = 0;
        if (baseStats.favorite_club_id) {
          const vc = vcRows.find(v => v.venue_id === baseStats.favorite_club_id);
          if (vc) {
            favoriteClubVisits = (vc.ticket_count || 0) + (vc.order_count || 0) + (vc.table_count || 0);
          }
        }

        fetchedStats = {
          ...baseStats,
          // Override favorite_drink with the actual most ordered drink from orders
          favorite_drink: mostOrderedDrink || baseStats.favorite_drink || favoriteDrinkFromFavorites,
          favorite_club_visits: favoriteClubVisits,
          venues_visited: venuesVisited,
          cities_explored: citiesExplored,
          has_vip_reservation: hasVipReservation,
          has_redeemed_reward: hasRedeemedReward
        } as NightlifeStats;
        setStats(fetchedStats);
      }

      // Série de soirées : calculée depuis les billets payés (chargés en vague 1).
      const ticketDates = ticketsRes.data;
      if (ticketDates && ticketDates.length > 0) {
        const eventDatesArr = ticketDates
          .map(t => {
            const evt = t.events as unknown as { start_at: string } | null;
            return evt?.start_at;
          })
          .filter(Boolean) as string[];
        setStreak(calculateWeekStreaks(eventDatesArr));
      } else {
        setStreak({ currentStreak: 0, longestStreak: 0 });
      }

      const tasteData = tasteRes.data;
      if (tasteData) {
        setTasteProfile(tasteData as TasteProfile);
      }

      let cardsWithRewards: LoyaltyCard[] = [];

      if (loyaltyData && loyaltyData.length > 0) {
        // Use existing loyalty records
        cardsWithRewards = await Promise.all(
          loyaltyData.map(async (loyalty) => {
            const venueData = loyalty.venues as unknown as { id: string; name: string; logo_url: string | null };
            
            // Get next available reward + recent transactions in parallel
            const [rewardsRes, txRes] = await Promise.all([
              supabase
                .from('loyalty_rewards')
                .select('name, points_required')
                .eq('venue_id', loyalty.venue_id)
                .eq('is_active', true)
                .gt('points_required', loyalty.current_balance || 0)
                .order('points_required')
                .limit(1),
              supabase
                .from('loyalty_transactions')
                .select('id, points, transaction_type, description, created_at')
                .eq('customer_loyalty_id', loyalty.id)
                .order('created_at', { ascending: false })
                .limit(5),
            ]);

            const nextReward = rewardsRes.data?.[0];
            const progress = nextReward 
              ? Math.min(100, ((loyalty.current_balance || 0) / nextReward.points_required) * 100)
              : 100;

            return {
              venue_id: loyalty.venue_id,
              venue_name: venueData?.name || 'Unknown Club',
              venue_logo: venueData?.logo_url || null,
              venue_slug: venueData?.id || loyalty.venue_id || null,
              current_balance: loyalty.current_balance || 0,
              tier: (loyalty.tier || 'bronze') as 'bronze' | 'silver' | 'gold' | 'platinum',
              total_points_earned: loyalty.total_points_earned || 0,
              next_reward_name: nextReward?.name || null,
              next_reward_points: nextReward?.points_required || null,
              progress_percent: progress,
              recent_transactions: (txRes.data || []) as LoyaltyTransaction[],
            };
          })
        );
      } else {
        // Repli : cartes virtuelles dérivées de venue_customers (déjà en mémoire,
        // filtrées côté client sur total_spent > 0 plutôt qu'en refaisant la requête).
        const vcData = vcRows.filter(v => Number(v.total_spent || 0) > 0);

        if (vcData && vcData.length > 0) {
          cardsWithRewards = await Promise.all(
            vcData.map(async (vc) => {
              const venueInfo = vc.venues as unknown as { id: string; name: string; logo_url: string | null } | null;
              const points = Math.floor(Number(vc.total_spent) || 0);

              // Get next available reward for this venue
              const { data: rewardsData } = await supabase
                .from('loyalty_rewards')
                .select('name, points_required')
                .eq('venue_id', vc.venue_id)
                .eq('is_active', true)
                .gt('points_required', points)
                .order('points_required')
                .limit(1);

              const nextReward = rewardsData?.[0];
              const progress = nextReward 
                ? Math.min(100, (points / nextReward.points_required) * 100)
                : 100;

              return {
                venue_id: vc.venue_id,
                venue_name: venueInfo?.name || 'Unknown Club',
                venue_logo: venueInfo?.logo_url || null,
                venue_slug: venueInfo?.id || vc.venue_id || null,
                current_balance: points,
                tier: calculateTierFromSpent(Number(vc.total_spent) || 0),
                total_points_earned: points,
                next_reward_name: nextReward?.name || null,
                next_reward_points: nextReward?.points_required || null,
                progress_percent: progress,
                recent_transactions: [],
              };
            })
          );
        }
      }

      setLoyaltyCards(cardsWithRewards);

      // Calculate badge
      const nightsAttended = fetchedStats?.nights_attended || 0;
      const totalSpent = fetchedStats?.total_spent || 0;
      setBadge(calculateBadge(Number(nightsAttended), Number(totalSpent), cardsWithRewards));
    } catch (error) {
      console.error('Error fetching nightlife profile:', error);
    } finally {
      setLoading(false);
      setDataFetched(true);
    }
  }, [user, authLoading, calculateBadge]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Keep loyalty cards in sync right after a purchase/refund (points change)
  useEffect(() => {
    if (!user) {
      return () => {};
    }

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        fetchData();
      }, 400);
    };

    const channel = supabase
      .channel(`nightlife_profile_loyalty_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_loyalty',
          filter: `user_id=eq.${user.id}`,
        },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [user, fetchData]);

  const updateProfile = async (updates: Partial<Pick<Profile, 'first_name' | 'last_name' | 'city' | 'avatar_url' | 'background_url' | 'birth_date' | 'leaderboard_visibility'>>) => {
    if (!user) return { success: false };

    try {
      const sanitized = {
        ...updates,
        ...(updates.birth_date !== undefined && { birth_date: updates.birth_date || null }),
      };

      const { error } = await supabase
        .from('profiles')
        .update(sanitized)
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, ...updates } : null);
      return { success: true };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { success: false };
    }
  };

  return {
    loading,
    profile,
    stats,
    loyaltyCards,
    tasteProfile,
    badge,
    streak,
    updateProfile,
    refetch: fetchData
  };
}
