import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EventTraffic } from '@/lib/eventTraffic';
import type { EventCommunity } from '@/lib/eventCommunity';

type LensRpc = 'get_event_traffic' | 'get_event_community';
type LensError = 'forbidden' | 'not_found' | 'error';

/**
 * Une lecture d'analyse PAR SOIRÉE (Trafic ou Communauté), un seul
 * aller-retour, même comportement que `useEventReport` : rappelée tant que
 * la soirée n'est pas terminée et que l'onglet est visible, plus jamais
 * ensuite. `eventId = null` ne charge rien.
 */
function useEventLens<T extends { ok: true; event: { phase: string } }>(rpc: LensRpc, eventId: string | null, refreshMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LensError | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const current = useRef<string | null>(null);
  const ended = useRef(false);

  const load = useCallback(async (id: string) => {
    try {
      const { data: raw, error: rpcError } = await supabase.rpc(rpc as never, { p_event_id: id } as never);
      if (current.current !== id) return;
      if (rpcError) throw rpcError;
      const res = raw as unknown as (T | { ok: false; reason?: string }) | null;
      if (!res || !res.ok) {
        const reason = res && 'reason' in res ? res.reason : null;
        setError(reason === 'forbidden' ? 'forbidden' : reason === 'not_found' ? 'not_found' : 'error');
        setData(null);
        return;
      }
      setError(null);
      ended.current = res.event.phase === 'after';
      setData(res as T);
      setFetchedAt(new Date());
    } catch (e) {
      console.error(rpc, e);
      if (current.current === id) setError('error');
    } finally {
      if (current.current === id) setLoading(false);
    }
  }, [rpc]);

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
    const id = window.setInterval(tick, refreshMs);
    return () => window.clearInterval(id);
  }, [eventId, load, refreshMs]);

  return { data, loading, error, fetchedAt };
}

/** Trafic d'une soirée : relu toutes les 30 s pendant la vente (le « en ce moment » bouge vite). */
export function useEventTraffic(eventId: string | null) {
  return useEventLens<EventTraffic>('get_event_traffic', eventId, 30_000);
}

/** Communauté d'une soirée : une minute suffit, les abonnés et contacts ne bougent pas à la seconde. */
export function useEventCommunity(eventId: string | null) {
  return useEventLens<EventCommunity>('get_event_community', eventId, 60_000);
}
