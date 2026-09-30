import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PushCenterData, PushCredits } from '@/lib/pushEngine';

export interface PushCenterScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

/**
 * Ce que le moteur de notifications a envoyé pour les soirées de la portée
 * (`get_push_center`) : par soirée, par règle, « via ton audience ».
 */
export function usePushCenter(scope: PushCenterScope, days = 30, enabled = true) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [data, setData] = useState<PushCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'error' | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || (!venueId && !organizerUserId)) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: raw, error: rpcError } = await supabase.rpc('get_push_center' as never, {
          p_venue_id: venueId ?? undefined,
          p_organizer_user_id: organizerUserId ?? undefined,
          p_days: days,
        } as never);
        if (cancelled) return;
        if (rpcError) throw rpcError;
        const res = raw as unknown as (PushCenterData | { ok: false; reason?: string }) | null;
        if (!res || !res.ok) {
          setError(res && 'reason' in res && res.reason === 'forbidden' ? 'forbidden' : 'error');
          setData(null);
          return;
        }
        setError(null);
        setData(res);
        setFetchedAt(new Date());
      } catch (e) {
        console.error('get_push_center', e);
        if (!cancelled) setError('error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, organizerUserId, days, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, fetchedAt, reload };
}

export interface PushCreditsScope {
  venueId?: string | null;
  organizerUserId?: string | null;
  agencyId?: string | null;
}

/** Solde de crédits de campagnes manuelles d'une portée (`get_push_credits`). */
export function usePushCredits(scope: PushCreditsScope) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const agencyId = scope.agencyId ?? null;
  const [credits, setCredits] = useState<PushCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!venueId && !organizerUserId && !agencyId) return;
    let cancelled = false;
    setLoading(true);
    supabase.rpc('get_push_credits' as never, {
      p_venue_id: venueId ?? undefined,
      p_organizer_user_id: organizerUserId ?? undefined,
      p_agency_id: agencyId ?? undefined,
    } as never).then(({ data, error }) => {
      if (cancelled) return;
      const res = data as unknown as (PushCredits | { ok: false }) | null;
      setCredits(!error && res && res.ok ? res : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [venueId, organizerUserId, agencyId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { credits, loading, reload };
}
