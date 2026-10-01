/**
 * Le chiffre de la carte « Guest list » de la barre des piliers d'Analytics :
 * les inscrits de la période, lus par la MÊME RPC que l'onglet
 * (`get_guest_list_analytics`, `totals.signups`), pour que la carte et son
 * onglet ne disent jamais deux nombres différents.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Args {
  venueId?: string | null;
  organizerUserId?: string | null;
  eventId?: string | null;
  from: string;
  to: string;
  enabled?: boolean;
}

export function useGuestListSignups({ venueId, organizerUserId, eventId, from, to, enabled = true }: Args): number | null {
  const [signups, setSignups] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || (!venueId && !organizerUserId)) { setSignups(null); return; }
    let alive = true;
    setSignups(null);
    (async () => {
      const { data } = await supabase.rpc('get_guest_list_analytics', {
        p_venue_id: venueId ?? undefined,
        p_organizer_user_id: venueId ? undefined : (organizerUserId ?? undefined),
        p_event_id: eventId ?? undefined,
        p_from: from,
        p_to: to,
      });
      if (!alive) return;
      const res = data as unknown as { ok?: boolean; totals?: { signups?: number } } | null;
      setSignups(res && res.ok && typeof res.totals?.signups === 'number' ? res.totals.signups : null);
    })();
    return () => { alive = false; };
  }, [venueId, organizerUserId, eventId, from, to, enabled]);
  return signups;
}
