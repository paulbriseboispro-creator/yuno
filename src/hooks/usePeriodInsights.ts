/**
 * Les trois lectures « par soirée » étendues à une période (migration
 * 20261001300000) : courbe J-N moyenne, ce qui a fait vendre, nouveaux ou
 * habitués. Même grammaire que le rapport d'une soirée ; une seule différence,
 * le périmètre. Trois RPC, chacune avec son état : une carte vide n'attend pas
 * les deux autres.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EventReport, ReportDay, ReportMessage } from '@/lib/eventReport';

export interface PeriodScope { venueId?: string | null; organizerUserId?: string | null }

export interface PeriodCurve {
  ok: true;
  money: boolean;
  tz: string;
  from: string;
  to: string;
  cur: { nights: number; series: ReportDay[] };
  prev: { nights: number; series: ReportDay[] };
}

export interface PeriodDrivers {
  ok: true;
  money: boolean;
  nights: number;
  channels: EventReport['channels'];
  links: EventReport['links'];
  messages: (ReportMessage & { eventTitle?: string | null })[];
}

export interface PeriodAudience {
  ok: true;
  nights: number;
  people: number;
  returning: number;
  new: number;
  buyers: number;
  priorEvents: number;
}

interface State<T> { data: T | null; loading: boolean; error: string | null }

function useRpc<T extends { ok: true }>(fn: string, scope: PeriodScope, from: string, to: string, enabled: boolean): State<T> {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [state, setState] = useState<State<T>>({ data: null, loading: enabled, error: null });

  useEffect(() => {
    if (!enabled || (!venueId && !organizerUserId)) { setState({ data: null, loading: false, error: null }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const { data, error } = await supabase.rpc(fn as never, {
        p_venue_id: venueId, p_organizer_user_id: organizerUserId, p_from: from, p_to: to,
      } as never);
      if (!alive) return;
      const res = data as unknown as { ok: boolean; reason?: string } | null;
      if (error || !res) { setState({ data: null, loading: false, error: error?.message ?? 'empty' }); return; }
      if (!res.ok) { setState({ data: null, loading: false, error: res.reason ?? 'error' }); return; }
      setState({ data: res as unknown as T, loading: false, error: null });
    })();
    return () => { alive = false; };
  }, [fn, venueId, organizerUserId, from, to, enabled]);

  return state;
}

/**
 * `from` / `to` : la fenêtre de la page (ISO). Les RPC lisent les soirées
 * COMMENCÉES dans cette fenêtre et, pour la courbe, celles de la même durée
 * juste avant.
 */
export function usePeriodInsights(scope: PeriodScope, from: string, to: string, enabled = true) {
  const curve = useRpc<PeriodCurve>('get_sales_period_curve', scope, from, to, enabled);
  const drivers = useRpc<PeriodDrivers>('get_sales_period_drivers', scope, from, to, enabled);
  const audience = useRpc<PeriodAudience>('get_sales_period_audience', scope, from, to, enabled);
  return { curve, drivers, audience };
}
