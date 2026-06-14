import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface OwnerVenue {
  id: string;
  name: string;
  city: string;
  address?: string;
  coverUrl?: string;
  logoUrl?: string;
  floorPlanUrl?: string;
}

interface OwnerVenueContextType {
  venue: OwnerVenue | null;
  venueId: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const OwnerVenueContext = createContext<OwnerVenueContextType | undefined>(undefined);

export function OwnerVenueProvider({ children }: { children: ReactNode }) {
  const [venue, setVenue] = useState<OwnerVenue | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOwnerVenue = async () => {
    try {
      setLoading(true);

      // Timeout wrapper — prevents infinite spinner if Supabase is unresponsive
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Supabase timeout after ${ms}ms`)), ms),
          ),
        ]);

      const { data: { user } } = await withTimeout(supabase.auth.getUser(), 8000);
      if (!user) {
        setError('Not authenticated');
        return;
      }

      // Find venue where this user is the owner (via owner_id)
      const { data: venueData, error: venueError } = await withTimeout(
        supabase.from('venues').select('*').eq('owner_id', user.id).maybeSingle() as unknown as Promise<any>,
        8000,
      );

      if (venueError) throw venueError;

      if (venueData) {
        setVenue({
          id: venueData.id,
          name: venueData.name,
          city: venueData.city,
          address: venueData.address || undefined,
          coverUrl: venueData.cover_url || undefined,
          logoUrl: venueData.logo_url || undefined,
          floorPlanUrl: venueData.floor_plan_url || undefined,
        });
        setVenueId(venueData.id);
        setError(null);
      } else {
        setVenue(null);
        setVenueId(null);
        setError('no_venue_assigned');
      }
    } catch (err) {
      console.error('Error fetching owner venue:', err);
      setError('Failed to fetch venue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOwnerVenue();
  }, []);

  return (
    <OwnerVenueContext.Provider value={{ venue, venueId, loading, error, refetch: fetchOwnerVenue }}>
      {children}
    </OwnerVenueContext.Provider>
  );
}

export function useOwnerVenueContext() {
  const context = useContext(OwnerVenueContext);
  if (context === undefined) {
    throw new Error('useOwnerVenueContext must be used within an OwnerVenueProvider');
  }
  return context;
}
