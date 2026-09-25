import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SalesOverview, SalesPeriod } from '@/lib/salesOverview';

/**
 * Bilan des soirées passées (`get_sales_overview`) : un aller-retour pour la
 * vue d'ensemble ET les quatre piliers. La période se compte en soirées.
 * `withTakeaways` passe par `get_sales_takeaways`, qui rend la même vue
 * d'ensemble complétée de ses constats « À retenir » (un seul calcul).
 */
export function useSalesOverview(
  scope: { venueId?: string | null; organizerUserId?: string | null },
  period: SalesPeriod,
  enabled = true,
  withTakeaways = false,
) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [data, setData] = useState<SalesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'error' | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    // Sans portée (club ou organisateur pas encore connu), on ATTEND : rendre
    // « rien » ici affichait une erreur le temps que le contexte arrive.
    if (!enabled || (!venueId && !organizerUserId)) return;
    setLoading(true);
    try {
      const { data: raw, error: rpcError } = await supabase.rpc(withTakeaways ? 'get_sales_takeaways' : 'get_sales_overview', {
        p_venue_id: organizerUserId ? undefined : venueId ?? undefined,
        p_organizer_user_id: organizerUserId ?? undefined,
        p_period: period,
      });
      if (rpcError) throw rpcError;
      const res = raw as unknown as SalesOverview | null;
      if (!res || !res.ok) {
        setError(res?.reason === 'forbidden' ? 'forbidden' : 'error');
        setData(null);
        return;
      }
      setError(null);
      setData(res);
      setFetchedAt(new Date());
    } catch (e) {
      console.error('get_sales_overview', e);
      setError('error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [venueId, organizerUserId, period, enabled, withTakeaways]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, fetchedAt, refresh: load };
}
