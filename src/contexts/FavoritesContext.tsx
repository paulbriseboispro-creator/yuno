import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert } from '@/integrations/supabase/types';
import { insertOwnerNotif } from '@/utils/ownerNotifications';

export type FavoriteType = 'club' | 'event' | 'drink' | 'dj' | 'affiliate_event' | 'affiliate_venue';

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
  toggleFavorite: (type: FavoriteType, id: string) => Promise<'added' | 'removed' | 'login_required'>;
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
        djId: (f as any).dj_id || undefined,
        affiliateEventId: (f as any).affiliate_event_id || undefined,
        affiliateVenueId: (f as any).affiliate_venue_id || undefined,
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
          } else {
            console.log(`Deleted ${pastFavoriteIds.length} past event favorites`);
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

  const toggleFavorite = useCallback(async (type: FavoriteType, id: string): Promise<'added' | 'removed' | 'login_required'> => {
    if (!userId) return 'login_required';

    // Prevent adding past events to favorites (check end_at, not start_at)
    if (type === 'event') {
      const { data: event } = await supabase
        .from('events')
        .select('end_at')
        .eq('id', id)
        .single();

      if (event && new Date(event.end_at) < new Date()) {
        console.log('Cannot add past event to favorites');
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
        console.log('Cannot add past affiliate event to favorites');
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

        const { data, error } = await supabase
          .from('favorites')
          .insert([insertData])
          .select()
          .single();

        if (error) throw error;

        setFavorites(prev => [...prev, {
          id: data.id,
          odataId: data.id,
          userId: data.user_id,
          favoriteType: data.favorite_type as FavoriteType,
          venueId: data.venue_id || undefined,
          eventId: data.event_id || undefined,
          drinkId: data.drink_id || undefined,
          djId: (data as any).dj_id || undefined,
          affiliateEventId: (data as any).affiliate_event_id || undefined,
          affiliateVenueId: (data as any).affiliate_venue_id || undefined,
          createdAt: data.created_at,
        }]);

        // Owner notification: club or event added to favorites
        if (type === 'club' && data.venue_id) {
          insertOwnerNotif({
            venueId: data.venue_id,
            type: 'favorite_added',
            title: 'Nouveau favori — Club',
            message: 'Un utilisateur a ajouté votre club à ses favoris',
            priority: 'low',
            referenceType: 'venue',
            referenceId: data.venue_id,
            metadata: { favorite_type: 'club' },
          });
        } else if (type === 'event' && data.event_id) {
          // Resolve venue_id for event favorites
          supabase
            .from('events')
            .select('venue_id, title')
            .eq('id', data.event_id)
            .single()
            .then(({ data: ev }) => {
              if (ev?.venue_id) {
                insertOwnerNotif({
                  venueId: ev.venue_id,
                  type: 'favorite_added',
                  title: 'Nouveau favori — Soirée',
                  message: `Un utilisateur a ajouté "${ev.title}" à ses favoris`,
                  priority: 'low',
                  referenceType: 'event',
                  referenceId: data.event_id!,
                  eventId: data.event_id!,
                  metadata: { favorite_type: 'event', event_title: ev.title },
                });
              }
            });
        }

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
