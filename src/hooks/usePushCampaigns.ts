import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PushCampaignsPage, PushFilter } from '@/lib/pushHistory';

export interface PushScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

/**
 * Historique des push d'un club ou d'un organisateur (`get_push_campaigns`),
 * une page à la fois. `reload()` après un envoi ou une annulation.
 */
export function usePushCampaigns(scope: PushScope, filter: PushFilter, page: number, pageSize = 20) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [data, setData] = useState<PushCampaignsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'error' | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!venueId && !organizerUserId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: raw, error: rpcError } = await supabase.rpc('get_push_campaigns', {
          p_venue_id: venueId ?? undefined,
          p_organizer_user_id: organizerUserId ?? undefined,
          p_filter: filter,
          p_limit: pageSize,
          p_offset: page * pageSize,
        });
        if (cancelled) return;
        if (rpcError) throw rpcError;
        const res = raw as unknown as (PushCampaignsPage | { ok: false; reason?: string }) | null;
        if (!res || !res.ok) {
          setError(res && 'reason' in res && res.reason === 'forbidden' ? 'forbidden' : 'error');
          setData(null);
          return;
        }
        // Accusés de réception (lot G) : un appel à part, qui ne bloque jamais la liste.
        let withReceipts = res;
        const ids = res.campaigns.map((c) => c.id);
        if (ids.length > 0) {
          const { data: counts } = await supabase.rpc('get_push_delivery_counts' as never, { p_campaign_ids: ids } as never);
          if (cancelled) return;
          const byId = (counts ?? {}) as Record<string, number>;
          withReceipts = { ...res, campaigns: res.campaigns.map((c) => ({ ...c, delivered: byId[c.id] ?? null })) };
        }
        setError(null);
        setData(withReceipts);
        setFetchedAt(new Date());
      } catch (e) {
        console.error('get_push_campaigns', e);
        if (!cancelled) setError('error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, organizerUserId, filter, page, pageSize, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, fetchedAt, reload };
}
