import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calcStripeFee } from '@/utils/fees';

export type NetGainPerspective =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerUserId: string };

interface NetGainResult {
  netEuros: number;
  loading: boolean;
  /** Number of distribution rows that contributed to the figure (debug) */
  rowCount: number;
  /** True when no `revenue_distributions` rows exist for this event yet (legacy / pre-split-tracking sales). */
  fallbackUsed: boolean;
}

/**
 * Calcule le gain NET réel d'un event pour le club ou l'organisateur,
 * basé sur les vrais transferts Stripe enregistrés dans `revenue_distributions`.
 *
 * - Pour un split (mode `separate`) : on additionne `primary_amount_cents`
 *   (si l'utilisateur est primary) ou `secondary_amount_cents` (si secondary).
 * - Pour les soirées solo (mode `destination`, sans split) : si aucune ligne
 *   `revenue_distributions` n'existe, on retombe sur l'estimation
 *   `gross - yuno_fee - stripe_fee` calculée depuis tickets / table_reservations.
 */
export function useEventNetGain(eventId: string | null | undefined, perspective: NetGainPerspective): NetGainResult {
  const [netEuros, setNetEuros] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rowCount, setRowCount] = useState(0);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Fetch all distributions for this event
        const { data: distros } = await supabase
          .from('revenue_distributions')
          .select(
            'primary_amount_cents, secondary_amount_cents, primary_recipient_venue_id, secondary_recipient_venue_id, primary_recipient_organizer_id, secondary_recipient_organizer_id'
          )
          .eq('event_id', eventId);

        if (cancelled) return;

        let totalCents = 0;
        let count = 0;
        (distros || []).forEach((d: any) => {
          if (perspective.kind === 'venue') {
            if (d.primary_recipient_venue_id === perspective.venueId) {
              totalCents += Number(d.primary_amount_cents || 0);
              count++;
            } else if (d.secondary_recipient_venue_id === perspective.venueId) {
              totalCents += Number(d.secondary_amount_cents || 0);
              count++;
            }
          } else {
            if (d.primary_recipient_organizer_id === perspective.organizerUserId) {
              totalCents += Number(d.primary_amount_cents || 0);
              count++;
            } else if (d.secondary_recipient_organizer_id === perspective.organizerUserId) {
              totalCents += Number(d.secondary_amount_cents || 0);
              count++;
            }
          }
        });

        if (count > 0) {
          setNetEuros(totalCents / 100);
          setRowCount(count);
          setFallbackUsed(false);
        } else {
          // 2. Fallback for solo / legacy events without distribution rows.
          // Estimate net = revenue - yuno service fees - stripe fees.
          const [tk, tr] = await Promise.all([
            supabase
              .from('tickets')
              .select('total_price, service_fee, insurance_fee')
              .eq('event_id', eventId)
              .eq('status', 'paid'),
            supabase
              .from('table_reservations')
              .select('total_price, deposit, service_fee')
              .eq('event_id', eventId)
              .in('status', ['confirmed', 'paid']),
          ]);
          if (cancelled) return;

          const ticketNet = (tk.data || []).reduce((s: number, t: any) => {
            const total = Number(t.total_price || 0);
            const yunoFee = Number(t.service_fee || 0) + Number(t.insurance_fee || 0);
            return s + Math.max(0, total - yunoFee - calcStripeFee(total));
          }, 0);
          const tableNet = (tr.data || []).reduce((s: number, r: any) => {
            const base = Number(r.deposit || r.total_price || 0);
            const yunoFee = Number(r.service_fee || 0);
            return s + Math.max(0, base - yunoFee - calcStripeFee(base));
          }, 0);
          setNetEuros(ticketNet + tableNet);
          setRowCount(0);
          setFallbackUsed(true);
        }
      } catch (err) {
        console.error('[useEventNetGain] error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, perspective.kind, perspective.kind === 'venue' ? perspective.venueId : perspective.organizerUserId]);

  return { netEuros, loading, rowCount, fallbackUsed };
}
