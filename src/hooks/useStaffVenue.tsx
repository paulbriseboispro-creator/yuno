import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useStaffVenue() {
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStaffVenue();
  }, []);

  const fetchStaffVenue = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Get staff's venue from profile
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('venue_id')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (profile?.venue_id) {
        setVenueId(profile.venue_id);

        // Fetch venue name
        const { data: venue } = await supabase
          .from('venues')
          .select('name')
          .eq('id', profile.venue_id)
          .single();

        if (venue) {
          setVenueName(venue.name);
        }
      }
    } catch (err) {
      console.error('Error fetching staff venue:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    venueId,
    venueName,
    loading,
  };
}
