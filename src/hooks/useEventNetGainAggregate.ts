import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calcStripeFee } from '@/utils/fees';

export type AggregatePerspective =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerUserId: string };

interface AggregateResult {
  netEuros: number;
  loading: boolean;
  rowCount: number;
  fallbackEuros: number;
  contractEuros: number;
}

/**
 * Aggregates the REAL net gain for a venue/organizer across many events,
 * honoring the actual revenue split contract via `revenue_distributions`.
 * Falls back to estimation when no distribution rows exist (legacy/solo).
 */
export function useEventNetGainAggregate(
  perspective: AggregatePerspective,
  options?: { startDate?: Date | null; endDate?: Date | null; eventIds?: string[] | null }
): AggregateResult {
  const [netEuros, setNetEuros] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rowCount, setRowCount] = useState(0);
  const [fallbackEuros, setFallbackEuros] = useState(0);
  const [contractEuros, setContractEuros] = useState(0);

  const idKey = perspective.kind === 'venue' ? perspective.venueId : perspective.organizerUserId;
  const startKey = options?.startDate?.toISOString() || '';
  const endKey = options?.endDate?.toISOString() || '';
  const evKey = (options?.eventIds || []).join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Real distributions from contract
        let distQuery = supabase
          .from('revenue_distributions')
          .select(
            'event_id, primary_amount_cents, secondary_amount_cents, primary_recipient_venue_id, secondary_recipient_venue_id, primary_recipient_organizer_id, secondary_recipient_organizer_id, created_at'
          );

        if (perspective.kind === 'venue') {
          distQuery = distQuery.or(
            `primary_recipient_venue_id.eq.${perspective.venueId},secondary_recipient_venue_id.eq.${perspective.venueId}`
          );
        } else {
          distQuery = distQuery.or(
            `primary_recipient_organizer_id.eq.${perspective.organizerUserId},secondary_recipient_organizer_id.eq.${perspective.organizerUserId}`
          );
        }

        if (options?.startDate) distQuery = distQuery.gte('created_at', options.startDate.toISOString());
        if (options?.endDate) distQuery = distQuery.lte('created_at', options.endDate.toISOString());
        if (options?.eventIds && options.eventIds.length > 0) {
          distQuery = distQuery.in('event_id', options.eventIds);
        }

        const { data: distros } = await distQuery;
        if (cancelled) return;

        let totalCents = 0;
        let count = 0;
        const eventsCovered = new Set<string>();
        (distros || []).forEach((d: any) => {
          if (d.event_id) eventsCovered.add(d.event_id);
          if (perspective.kind === 'venue') {
            if (d.primary_recipient_venue_id === perspective.venueId) {
              totalCents += Number(d.primary_amount_cents || 0); count++;
            } else if (d.secondary_recipient_venue_id === perspective.venueId) {
              totalCents += Number(d.secondary_amount_cents || 0); count++;
            }
          } else {
            if (d.primary_recipient_organizer_id === perspective.organizerUserId) {
              totalCents += Number(d.primary_amount_cents || 0); count++;
            } else if (d.secondary_recipient_organizer_id === perspective.organizerUserId) {
              totalCents += Number(d.secondary_amount_cents || 0); count++;
            }
          }
        });

        const contractNet = totalCents / 100;

        // 2. Fallback for events without distribution rows (solo / legacy)
        let fallbackNet = 0;
        if (perspective.kind === 'venue') {
          // Sum tickets + tables + drinks for this venue's events not covered
          const { data: events } = await supabase
            .from('events')
            .select('id')
            .or(`venue_id.eq.${perspective.venueId},partner_venue_id.eq.${perspective.venueId}`);
          const fallbackEventIds = (events || [])
            .map((e: any) => e.id)
            .filter((id: string) => !eventsCovered.has(id));

          if (fallbackEventIds.length > 0) {
            const [tk, tr, dr] = await Promise.all([
              supabase.from('tickets').select('total_price, service_fee, insurance_fee, event_id').in('event_id', fallbackEventIds).eq('status', 'paid'),
              supabase.from('table_reservations').select('deposit, total_price, service_fee, event_id').in('event_id', fallbackEventIds).in('status', ['confirmed', 'paid']),
              supabase.from('orders').select('total, venue_id').eq('venue_id', perspective.venueId).eq('status', 'paid'),
            ]);
            const tNet = (tk.data || []).reduce((s: number, t: any) => {
              const total = Number(t.total_price || 0);
              const fee = Number(t.service_fee || 0) + Number(t.insurance_fee || 0);
              return s + Math.max(0, total - fee - calcStripeFee(total));
            }, 0);
            const rNet = (tr.data || []).reduce((s: number, r: any) => {
              const base = Number(r.deposit || r.total_price || 0);
              const fee = Number(r.service_fee || 0);
              return s + Math.max(0, base - fee - calcStripeFee(base));
            }, 0);
            const dNet = (dr.data || []).reduce((s: number, o: any) => {
              const total = Number(o.total || 0);
              return s + Math.max(0, total - total * 0.03 - calcStripeFee(total));
            }, 0);
            fallbackNet = tNet + rNet + dNet;
          }
        } else {
          const { data: events } = await supabase
            .from('events')
            .select('id')
            .or(`organizer_user_id.eq.${perspective.organizerUserId},partner_organizer_id.eq.${perspective.organizerUserId}`);
          const fallbackEventIds = (events || [])
            .map((e: any) => e.id)
            .filter((id: string) => !eventsCovered.has(id));

          if (fallbackEventIds.length > 0) {
            const [tk, tr] = await Promise.all([
              supabase.from('tickets').select('total_price, service_fee, insurance_fee, event_id').in('event_id', fallbackEventIds).eq('status', 'paid'),
              supabase.from('table_reservations').select('deposit, total_price, service_fee, event_id').in('event_id', fallbackEventIds).in('status', ['confirmed', 'paid']),
            ]);
            const tNet = (tk.data || []).reduce((s: number, t: any) => {
              const total = Number(t.total_price || 0);
              const fee = Number(t.service_fee || 0) + Number(t.insurance_fee || 0);
              return s + Math.max(0, total - fee - calcStripeFee(total));
            }, 0);
            const rNet = (tr.data || []).reduce((s: number, r: any) => {
              const base = Number(r.deposit || r.total_price || 0);
              const fee = Number(r.service_fee || 0);
              return s + Math.max(0, base - fee - calcStripeFee(base));
            }, 0);
            fallbackNet = tNet + rNet;
          }
        }

        if (cancelled) return;
        setRowCount(count);
        setContractEuros(contractNet);
        setFallbackEuros(fallbackNet);
        setNetEuros(contractNet + fallbackNet);
      } catch (err) {
        console.error('[useEventNetGainAggregate] error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [perspective.kind, idKey, startKey, endKey, evKey]);

  return { netEuros, loading, rowCount, fallbackEuros, contractEuros };
}
