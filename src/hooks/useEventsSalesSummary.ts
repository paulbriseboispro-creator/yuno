import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EventsSalesSummary } from '@/lib/eventsSales';

export interface EventsSalesScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

/** Une minute : assez pour voir bouger une release, sans marteler la base. */
const REFRESH_MS = 60_000;

/**
 * Ventes des soirées à venir (`get_events_sales_summary`), un seul aller-retour
 * pour toute la liste. Rappelée toutes les minutes tant que l'onglet est
 * visible, et au retour sur l'onglet. `fetchedAt` alimente le « Mis à jour à ».
 */
export function useEventsSalesSummary(scope: EventsSalesScope, enabled = true) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [data, setData] = useState<EventsSalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'error' | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || (!venueId && !organizerUserId) || inFlight.current) return;
    inFlight.current = true;
    try {
      const { data: raw, error: rpcError } = await supabase.rpc('get_events_sales_summary', {
        p_venue_id: venueId ?? undefined,
        p_organizer_user_id: organizerUserId ?? undefined,
      });
      if (rpcError) throw rpcError;
      const res = raw as unknown as (EventsSalesSummary | { ok: false; reason?: string }) | null;
      if (!res || !res.ok) {
        setError(res && 'reason' in res && res.reason === 'forbidden' ? 'forbidden' : 'error');
        setData(null);
        return;
      }
      setError(null);
      setData(res);
      setFetchedAt(new Date());
    } catch (e) {
      console.error('get_events_sales_summary', e);
      setError('error');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [venueId, organizerUserId, enabled]);

  useEffect(() => {
    if (!enabled || (!venueId && !organizerUserId)) { setLoading(false); return; }
    setLoading(true);
    load();
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, enabled, venueId, organizerUserId]);

  return { data, loading, error, fetchedAt, refresh: load };
}
