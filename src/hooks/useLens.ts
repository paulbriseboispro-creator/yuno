import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EventTraffic } from '@/lib/eventTraffic';
import type { EventCommunity } from '@/lib/eventCommunity';

/**
 * Ce qu'on regarde dans Trafic ou Communauté : UNE soirée, ou toutes les
 * soirées sur une période (`hours`, `null` = depuis toujours). Les deux sont lus
 * par le même composant, avec la même forme de réponse.
 */
export type LensSubject = { kind: 'event'; id: string } | { kind: 'period'; hours: number | null };

export interface LensScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

type LensError = 'forbidden' | 'not_found' | 'error';

interface RpcCall {
  rpc: string;
  args: Record<string, unknown>;
}

/**
 * Une lecture d'analyse, un seul aller-retour. Rappelée tant que l'onglet est
 * visible, sauf pour une soirée terminée (elle ne bouge plus). `call = null` ne
 * charge rien (portée encore inconnue).
 */
function useRpcLens<T extends { ok: true; event: { phase: string } | null }>(call: RpcCall | null, refreshMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LensError | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const currentKey = useRef<string | null>(null);
  const ended = useRef(false);
  const key = call ? `${call.rpc}:${JSON.stringify(call.args)}` : null;

  const load = useCallback(async (c: RpcCall, k: string) => {
    try {
      const { data: raw, error: rpcError } = await supabase.rpc(c.rpc as never, c.args as never);
      if (currentKey.current !== k) return;
      if (rpcError) throw rpcError;
      const res = raw as unknown as (T | { ok: false; reason?: string }) | null;
      if (!res || !res.ok) {
        const reason = res && 'reason' in res ? res.reason : null;
        setError(reason === 'forbidden' ? 'forbidden' : reason === 'not_found' ? 'not_found' : 'error');
        setData(null);
        return;
      }
      setError(null);
      ended.current = res.event?.phase === 'after';
      setData(res as T);
      setFetchedAt(new Date());
    } catch (e) {
      console.error(c.rpc, e);
      if (currentKey.current === k) setError('error');
    } finally {
      if (currentKey.current === k) setLoading(false);
    }
  }, []);

  useEffect(() => {
    currentKey.current = key;
    ended.current = false;
    setData(null);
    setError(null);
    if (!call || !key) { setLoading(false); return; }
    setLoading(true);
    load(call, key);
    const tick = () => {
      if (document.visibilityState !== 'visible' || ended.current) return;
      load(call, key);
    };
    const id = window.setInterval(tick, refreshMs);
    return () => window.clearInterval(id);
    // `key` porte déjà tout le contenu de `call`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load, refreshMs]);

  return { data, loading, error, fetchedAt };
}

function callFor(family: 'traffic' | 'community', scope: LensScope, subject: LensSubject): RpcCall | null {
  if (subject.kind === 'event') {
    return { rpc: family === 'traffic' ? 'get_event_traffic' : 'get_event_community', args: { p_event_id: subject.id } };
  }
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  if (!venueId && !organizerUserId) return null;
  return {
    rpc: family === 'traffic' ? 'get_traffic_period' : 'get_community_period',
    args: { p_venue_id: venueId, p_organizer_user_id: organizerUserId, p_hours: subject.hours },
  };
}

/** Trafic : relu toutes les 30 s pendant la vente (le « en ce moment » bouge vite). */
export function useTrafficLens(scope: LensScope, subject: LensSubject) {
  return useRpcLens<EventTraffic>(callFor('traffic', scope, subject), 30_000);
}

/** Communauté : une minute suffit, les abonnés et contacts ne bougent pas à la seconde. */
export function useCommunityLens(scope: LensScope, subject: LensSubject) {
  return useRpcLens<EventCommunity>(callFor('community', scope, subject), 60_000);
}
