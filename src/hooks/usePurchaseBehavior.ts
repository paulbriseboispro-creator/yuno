import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PurchaseBehavior } from '@/lib/purchaseBehavior';

export interface PurchaseBehaviorScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

/**
 * Onglet « Comportement d'achat » : un seul aller-retour
 * (`get_purchase_behavior`), rappelé quand la portée ou la période changent.
 */
export function usePurchaseBehavior(scope: PurchaseBehaviorScope, range: { from: string; to: string }) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [data, setData] = useState<PurchaseBehavior | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'error' | null>(null);

  // L'appelant mémorise la fenêtre par période ; la clé à la minute garde en
  // plus une fenêtre recalculée (« maintenant » bouge) de relancer à chaque rendu.
  const fromKey = range.from.slice(0, 16);
  const toKey = range.to.slice(0, 16);

  useEffect(() => {
    if (!venueId && !organizerUserId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: raw, error: rpcError } = await supabase.rpc('get_purchase_behavior', {
          p_venue_id: venueId ?? undefined,
          p_organizer_user_id: organizerUserId ?? undefined,
          p_from: range.from,
          p_to: range.to,
        });
        if (cancelled) return;
        if (rpcError) throw rpcError;
        const res = raw as unknown as (PurchaseBehavior | { ok: false; reason?: string }) | null;
        if (!res || !res.ok) {
          setError(res && 'reason' in res && res.reason === 'forbidden' ? 'forbidden' : 'error');
          setData(null);
          return;
        }
        setData(res);
      } catch (e) {
        console.error('get_purchase_behavior', e);
        if (!cancelled) { setError('error'); setData(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, organizerUserId, fromKey, toKey]);

  return { data, loading, error };
}
