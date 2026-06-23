import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';

interface BookerHomeCity {
  scope: 'owner' | 'manager' | 'organizer';
  /** The club's city (venue scope) or the organizer's public city (organizer scope). */
  city: string | null;
  /** False until the city is known, so the marketplace can hold its first query. */
  ready: boolean;
}

/**
 * The booker's "home city" — used to pre-seed the DJ marketplace city filter so a
 * club or organizer first sees local DJs instead of the whole world.
 *
 * - venue / manager scope → `venues.city`, already resolved in context (no fetch).
 * - organizer scope       → `organizer_profiles.city`, fetched once for the org.
 *
 * `ready` flips true only when the city is known (venue loaded, or org lookup
 * resolved). The marketplace holds its first query until then so it never flashes
 * world results before snapping to local. A null city (no city set) is a valid,
 * ready state — the marketplace simply shows everyone.
 */
export function useBookerHomeCity(): BookerHomeCity {
  const { scope, venue, organizerUserId, loading } = useVenueContext();
  const [orgCity, setOrgCity] = useState<string | null>(null);
  const [orgReady, setOrgReady] = useState(false);

  useEffect(() => {
    if (scope !== 'organizer') return;
    if (!organizerUserId) return; // wait for the authenticated org user id
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('organizer_profiles')
        .select('city')
        .eq('user_id', organizerUserId)
        .maybeSingle();
      if (!cancelled) {
        setOrgCity((data?.city as string | null) || null);
        setOrgReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, organizerUserId]);

  if (scope === 'organizer') {
    return { scope, city: orgCity, ready: orgReady };
  }
  return { scope, city: venue?.city ?? null, ready: !loading };
}
