import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EventReport } from '@/lib/eventReport';

/** Une minute pendant la vente ; rien à rafraîchir une fois la soirée passée. */
const REFRESH_MS = 60_000;

/**
 * Rapport d'une soirée (`get_event_report`), un seul aller-retour. Rappelé
 * chaque minute tant que la soirée n'est pas terminée et que l'onglet est
 * visible. `eventId = null` ne charge rien (sert à la soirée comparée).
 */
export function useEventReport(eventId: string | null) {
  const [data, setData] = useState<EventReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'forbidden' | 'not_found' | 'error' | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const current = useRef<string | null>(null);
  // Une soirée terminée ne bouge plus : on cesse de la relire.
  const ended = useRef(false);

  const load = useCallback(async (id: string) => {
    try {
      const { data: raw, error: rpcError } = await supabase.rpc('get_event_report', { p_event_id: id });
      if (current.current !== id) return;
      if (rpcError) throw rpcError;
      const res = raw as unknown as (EventReport | { ok: false; reason?: string }) | null;
      if (!res || !res.ok) {
        const reason = res && 'reason' in res ? res.reason : null;
        setError(reason === 'forbidden' ? 'forbidden' : reason === 'not_found' ? 'not_found' : 'error');
        setData(null);
        return;
      }
      setError(null);
      ended.current = res.event.phase === 'after';
      setData(res);
      setFetchedAt(new Date());
    } catch (e) {
      console.error('get_event_report', e);
      if (current.current === id) setError('error');
    } finally {
      if (current.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    current.current = eventId;
    ended.current = false;
    setData(null);
    setError(null);
    if (!eventId) { setLoading(false); return; }
    setLoading(true);
    load(eventId);
    const tick = () => {
      if (document.visibilityState !== 'visible' || ended.current) return;
      load(eventId);
    };
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [eventId, load]);

  return { data, loading, error, fetchedAt, refresh: () => eventId && load(eventId) };
}
