import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Whether the seller of record absorbs the Yuno commission (so the fan only pays the
 * Stripe transaction fee). Mirrors the edge-function rule in
 * supabase/functions/_shared/merchant-fees.ts: the VENUE's flag governs whenever a
 * venue exists (it is the seller of record, incl. co-events); only an organizer-only
 * sale falls back to the organizer's flag. Defaults to false (fan pays the commission).
 *
 * Used purely to render the correct pre-checkout total — the actual charge is always
 * recomputed server-side by the checkout edge functions.
 */
export function useAbsorbYunoFees(
  venueId: string | null | undefined,
  organizerUserId?: string | null,
): boolean {
  const [absorb, setAbsorb] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (venueId) {
        const { data } = await supabase
          .from('venues')
          .select('absorb_yuno_fees')
          .eq('id', venueId)
          .maybeSingle();
        if (!cancelled) setAbsorb((data as { absorb_yuno_fees?: boolean } | null)?.absorb_yuno_fees === true);
        return;
      }
      if (organizerUserId) {
        const { data } = await supabase
          .from('organizer_profiles')
          .select('absorb_yuno_fees')
          .eq('user_id', organizerUserId)
          .maybeSingle();
        if (!cancelled) setAbsorb((data as { absorb_yuno_fees?: boolean } | null)?.absorb_yuno_fees === true);
        return;
      }
      if (!cancelled) setAbsorb(false);
    })();

    return () => { cancelled = true; };
  }, [venueId, organizerUserId]);

  return absorb;
}
