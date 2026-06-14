import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VenueHypeBaseline {
  capacity: number | null;
  typical_attendance: number | null;
  slow_attendance: number | null;
  sales_timing: 'door' | 'mixed' | 'advance' | null;
  sellout_frequency: 'never' | 'rarely' | 'sometimes' | 'often' | 'always' | null;
  avg_ticket_price: number | null;
}

export const EMPTY_BASELINE: VenueHypeBaseline = {
  capacity: null,
  typical_attendance: null,
  slow_attendance: null,
  sales_timing: null,
  sellout_frequency: null,
  avg_ticket_price: null,
};

/** True once the owner has given us at least the essentials to calibrate. */
export function isBaselineConfigured(b: VenueHypeBaseline | null): boolean {
  if (!b) return false;
  return (
    b.capacity != null ||
    b.typical_attendance != null ||
    b.sales_timing != null ||
    b.sellout_frequency != null
  );
}

export function useHypeBaseline(venueId: string | null) {
  const [baseline, setBaseline] = useState<VenueHypeBaseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!venueId) {
      setBaseline(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('venue_hype_baseline')
      .select('capacity, typical_attendance, slow_attendance, sales_timing, sellout_frequency, avg_ticket_price')
      .eq('venue_id', venueId)
      .maybeSingle();
    if (error) {
      console.warn('Could not load hype baseline:', error.message);
      setBaseline(null);
    } else {
      setBaseline((data as VenueHypeBaseline) ?? null);
    }
    setLoading(false);
  }, [venueId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (values: VenueHypeBaseline) => {
      if (!venueId) return false;
      setSaving(true);
      const { error } = await supabase
        .from('venue_hype_baseline')
        .upsert({ venue_id: venueId, ...values }, { onConflict: 'venue_id' });
      setSaving(false);
      if (error) {
        console.error('Could not save hype baseline:', error.message);
        return false;
      }
      setBaseline(values);
      return true;
    },
    [venueId],
  );

  return { baseline, loading, saving, save, reload: load };
}
