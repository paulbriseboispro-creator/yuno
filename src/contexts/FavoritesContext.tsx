import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type FavoriteType = 'club' | 'event' | 'drink' | 'dj' | 'affiliate_event' | 'affiliate_venue';

/**
 * Two semantics over the SAME storage: a "favori" is an item you save (boissons,
 * soirées), an "abonnement" is a place/créateur you follow (clubs, DJs). The row
 * counts the same; only the meaning — and therefore icon, verb, toast — differs.
 * Organizers also live in the abonnement family but are stored in their own
 * `organizer_profile_followers` table, so they're handled at the call site.
 */
const SUBSCRIPTION_TYPES: readonly FavoriteType[] = ['club', 'dj', 'affiliate_venue'];

export function isSubscriptionType(type: FavoriteType): boolean {
  return SUBSCRIPTION_TYPES.includes(type);
}

export interface Favorite {
  id: string;
  userId: string;
  favoriteType: FavoriteType;
  venueId?: string;
  eventId?: string;
  drinkId?: string;
  djId?: string;
  affiliateEventId?: string;
  affiliateVenueId?: string;
  createdAt: string;
}

interface FavoritesContextValue {
  favorites: Favorite[];
  loading: boolean;
  refetch: () => Promise<void>;
  isFavorite: (type: FavoriteType, id: string) => boolean;
  toggleFavorite: (type: FavoriteType, id: string, source?: string) => Promise<'added' | 'removed' | 'login_required'>;
  getFavoritesByType: (type: FavoriteType) => Favorite[];
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Auth listener
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch favorites when userId changes, auto-remove past events
  const fetchFavorites = useCallback(async () => {
    if (!userId) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('favorites')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;

      const allFavorites = (data || []).map(f => ({
        id: f.id,
        odataId: f.id,
        userId: f.user_id,
        favoriteType: f.favorite_type as FavoriteType,
        venueId: f.venue_id || undefined,
        eventId: f.event_id || undefined,
        drinkId: f.drink_id || undefined,
        djId: f.dj_id || undefined,
        affiliateEventId: f.affiliate_event_id || undefined,
        affiliateVenueId: f.affiliate_venue_id || undefined,
        createdAt: f.created_at,
      }));

      // Get all event favorites to check if they're past
      const eventFavorites = allFavorites.filter(f => f.favoriteType === 'event' && f.eventId);
      const eventIds = eventFavorites.map(f => f.eventId).filter(Boolean) as string[];

      if (eventIds.length > 0) {
        const { data: events } = await supabase
          .from('events')
          .select('id, end_at')
          .in('id', eventIds);

        const now = new Date();
        const pastEventIds: string[] = [];

        (events || []).forEach(event => {
          // Event is past when it has ended, not when it started
          const eventEndDate = new Date(event.end_at);
          if (eventEndDate < now) {
            pastEventIds.push(event.id);
          }
        });

        // Delete past event favorites from database
        if (pastEventIds.length > 0) {
          const pastFavoriteIds = eventFavorites
            .filter(f => f.eventId && pastEventIds.includes(f.eventId))
            .map(f => f.id);

          const { error: deleteError } = await supabase
            .from('favorites')
            .delete()
            .in('id', pastFavoriteIds);

          if (deleteError) {
            console.error('Error deleting past event favorites:', deleteError);
          }

          // Filter out past events from the list
          setFavorites(allFavorites.filter(f => 
            !(f.favoriteType === 'event' && f.eventId && pastEventIds.includes(f.eventId))
          ));
          return;
        }
      }

      setFavorites(allFavorites);
    } catch (error) {
      console.error('Error fetching favorites:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const isFavorite = useCallback((type: FavoriteType, id: string): boolean => {
    return favorites.some(f => {
      if (type === 'club') return f.favoriteType === 'club' && f.venueId === id;
      if (type === 'event') return f.favoriteType === 'event' && f.eventId === id;
      if (type === 'drink') return f.favoriteType === 'drink' && f.drinkId === id;
      if (type === 'dj') return f.favoriteType === 'dj' && f.djId === id;
      if (type === 'affiliate_event') return f.favoriteType === 'affiliate_event' && f.affiliateEventId === id;
      if (type === 'affiliate_venue') return f.favoriteType === 'affiliate_venue' && f.affiliateVenueId === id;
      return false;
    });
  }, [favorites]);

  const toggleFavorite = useCallback(async (type: FavoriteType, id: string, source?: string): Promise<'added' | 'removed' | 'login_required'> => {
    if (!userId) return 'login_required';

    // Prevent adding past events to favorites (check end_at, not start_at)
    if (type === 'event') {
      const { data: event } = await supabase
        .from('events')
        .select('end_at')
        .eq('id', id)
        .single();

      if (event && new Date(event.end_at) < new Date()) {
        return 'removed'; // Silently ignore
      }
    }

    // Prevent adding past affiliate events to favorites
    if (type === 'affiliate_event') {
      const { data: affEvent } = await supabase
        .from('affiliate_events')
        .select('event_date')
        .eq('id', id)
        .single();

      if (affEvent && new Date(affEvent.event_date) < new Date(new Date().toISOString().split('T')[0])) {
        return 'removed';
      }
    }

    const isCurrentlyFavorite = isFavorite(type, id);

    try {
      if (isCurrentlyFavorite) {
        let query = supabase.from('favorites').delete().eq('user_id', userId).eq('favorite_type', type);
        if (type === 'club') query = query.eq('venue_id', id);
        else if (type === 'event') query = query.eq('event_id', id);
        else if (type === 'drink') query = query.eq('drink_id', id);
        else if (type === 'dj') query = query.eq('dj_id', id);
        else if (type === 'affiliate_event') query = query.eq('affiliate_event_id', id);
        else if (type === 'affiliate_venue') query = query.eq('affiliate_venue_id', id);

        const { error } = await query;
        if (error) throw error;

        setFavorites(prev => prev.filter(f => {
          if (type === 'club') return !(f.favoriteType === 'club' && f.venueId === id);
          if (type === 'event') return !(f.favoriteType === 'event' && f.eventId === id);
          if (type === 'drink') return !(f.favoriteType === 'drink' && f.drinkId === id);
          if (type === 'dj') return !(f.favoriteType === 'dj' && f.djId === id);
          if (type === 'affiliate_event') return !(f.favoriteType === 'affiliate_event' && f.affiliateEventId === id);
          if (type === 'affiliate_venue') return !(f.favoriteType === 'affiliate_venue' && f.affiliateVenueId === id);
          return true;
        }));

        return 'removed';
      } else {
        const insertData: TablesInsert<'favorites'> = {
          user_id: userId,
          favorite_type: type
        };
        if (type === 'club') insertData.venue_id = id;
        else if (type === 'event') insertData.event_id = id;
        else if (type === 'drink') insertData.drink_id = id;
        else if (type === 'dj') insertData.dj_id = id;
        else if (type === 'affiliate_event') insertData.affiliate_event_id = id;
        else if (type === 'affiliate_venue') insertData.affiliate_venue_id = id;

        // Capture de la source d'acquisition (club/dj) : la RPC follow_subject pose
        // le GUC yuno.follow_source DANS la même transaction que l'INSERT, que le
        // trigger de journal lit. Sans source, on garde l'insert direct (inchangé).
        let data: Tables<'favorites'> | null;
        let error: unknown;
        if (source && (type === 'club' || type === 'dj')) {
          const res = await (supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<{ data: Tables<'favorites'>[] | null; error: unknown }>)(
            'follow_subject', { p_favorite_type: type, p_target_id: id, p_source: source },
          );
          data = res.data?.[0] ?? null;
          error = res.error;
        } else {
          const res = await supabase.from('favorites').insert([insertData]).select().single();
          data = res.data;
          error = res.error;
        }

        if (error) throw error;
        if (!data) throw new Error('favorite insert returned no row');

        setFavorites(prev => [...prev, {
          id: data.id,
          odataId: data.id,
          userId: data.user_id,
          favoriteType: data.favorite_type as FavoriteType,
          venueId: data.venue_id || undefined,
          eventId: data.event_id || undefined,
          drinkId: data.drink_id || undefined,
          djId: data.dj_id || undefined,
          affiliateEventId: data.affiliate_event_id || undefined,
          affiliateVenueId: data.affiliate_venue_id || undefined,
          createdAt: data.created_at,
        }]);

        // La notif owner « nouvel abonné / nouveau favori » est émise côté SERVEUR
        // par le trigger trg_notify_owner_new_favorite (SECURITY DEFINER) : l'INSERT
        // client dans staff_notifications était de toute façon rejeté par la RLS (un
        // fan n'est pas staff) et avalé. Le trigger dédup + résout le venue de l'event.

        return 'added';
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      throw error;
    }
  }, [userId, isFavorite]);

  const getFavoritesByType = useCallback((type: FavoriteType) => {
    return favorites.filter(f => f.favoriteType === type);
  }, [favorites]);

  return (
    <FavoritesContext.Provider value={{
      favorites,
      loading,
      refetch: fetchFavorites,
      isFavorite,
      toggleFavorite,
      getFavoritesByType,
    }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavoritesContext() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavoritesContext must be used within a FavoritesProvider');
  }
  return context;
}
