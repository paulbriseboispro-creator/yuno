import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

interface OwnerVenue {
  id: string;
  name: string;
  city: string;
  address?: string;
  coverUrl?: string;
  logoUrl?: string;
  floorPlanUrl?: string;
  legalName?: string;
  siret?: string;
  vatNumber?: string;
}

// Colonnes réellement consommées par ce hook — liste explicite car un
// select('*') sur venues prend un 403 total depuis que les internals
// Stripe/facturation sont réservés à la RPC get_my_venue_private
// (migration 20260823180003).
const OWNER_VENUE_COLUMNS = 'id, name, city, address, cover_url, logo_url, floor_plan_url, legal_name, siret, vat_number';
type OwnerVenueRow = Pick<Tables<'venues'>, 'id' | 'name' | 'city' | 'address' | 'cover_url' | 'logo_url' | 'floor_plan_url' | 'legal_name' | 'siret' | 'vat_number'>;

export function useOwnerVenue() {
  const [venue, setVenue] = useState<OwnerVenue | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOwnerVenue();
  }, []);

  const fetchOwnerVenue = async () => {
    try {
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
        setLoading(false);
        return;
      }

      // Find venue where this user is the owner.
      // Liste explicite (pas de select('*')) : les internals Stripe/facturation
      // sont retirés du rôle authenticated (migration 20260823180003) — un
      // select('*') prendrait un 403 total. Le privé passe par get_my_venue_private.
      const { data: venueData, error: venueError } = await withTimeout(
        // Cast needed: the Supabase builder is a thenable, not a Promise, so withTimeout can't accept it as-is.
        supabase.from('venues').select(OWNER_VENUE_COLUMNS).eq('owner_id', user.id).maybeSingle() as unknown as Promise<{ data: OwnerVenueRow | null; error: Error | null }>,
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
          legalName: venueData.legal_name || undefined,
          siret: venueData.siret || undefined,
          vatNumber: venueData.vat_number || undefined,
        });
        setVenueId(venueData.id);
      } else {
        // Fallback: check profile's venue_id
        const { data: profile } = await withTimeout(
          // Cast needed: thenable → Promise for withTimeout.
          supabase.from('profiles').select('venue_id').eq('id', user.id).single() as unknown as Promise<{ data: Pick<Tables<'profiles'>, 'venue_id'> | null; error: Error | null }>,
          8000,
        );

        if (profile?.venue_id) {
          const { data: fallbackVenue } = await withTimeout(
            // Cast needed: thenable → Promise for withTimeout.
            supabase.from('venues').select(OWNER_VENUE_COLUMNS).eq('id', profile.venue_id).single() as unknown as Promise<{ data: OwnerVenueRow | null; error: Error | null }>,
            8000,
          );

          if (fallbackVenue) {
            setVenue({
              id: fallbackVenue.id,
              name: fallbackVenue.name,
              city: fallbackVenue.city,
              address: fallbackVenue.address || undefined,
              coverUrl: fallbackVenue.cover_url || undefined,
              logoUrl: fallbackVenue.logo_url || undefined,
              floorPlanUrl: fallbackVenue.floor_plan_url || undefined,
              legalName: fallbackVenue.legal_name || undefined,
              siret: fallbackVenue.siret || undefined,
              vatNumber: fallbackVenue.vat_number || undefined,
            });
            setVenueId(fallbackVenue.id);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching owner venue:', err);
      setError('Failed to fetch venue');
    } finally {
      setLoading(false);
    }
  };

  return {
    venue,
    venueId,
    loading,
    error,
    refetch: fetchOwnerVenue,
  };
}
