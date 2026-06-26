import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calcStripeFee } from '@/utils/fees';

export type NetGainPerspective =
  | { kind: 'venue'; venueId: string }
  | { kind: 'organizer'; organizerUserId: string };

interface NetGainResult {
  /** Total net share earned (received + pending + failed), in EUR. Headline figure. */
  netEuros: number;
  /** Part already on the recipient's Stripe account (direct charges + released transfers). */
  paidEuros: number;
  /** Part still held on the Yuno platform, scheduled to transfer after the refund window. */
  pendingEuros: number;
  /** Part whose transfer failed (e.g. recipient not onboarded to Stripe) — needs attention. */
  failedEuros: number;
  /** Earliest scheduled release date among the pending legs (ISO), or null if nothing pending. */
  releaseAt: string | null;
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
 *   (si l'utilisateur est primary) ou `secondary_amount_cents` (si secondary),
 *   en classant chaque part selon le statut du transfert :
 *     · `succeeded` / `not_required` → déjà versé (paidEuros)
 *     · `scheduled`                  → en attente sur la plateforme (pendingEuros)
 *     · `failed`                     → transfert échoué (failedEuros)
 *     · `cancelled` / `refunded`     → exclu (l'argent est revenu / n'est jamais parti)
 * - Pour les soirées solo (mode `destination`/`direct`, charge directe sur le compte) :
 *   la part est créditée immédiatement → comptée comme `paid`. Si aucune ligne
 *   `revenue_distributions` n'existe (legacy), on retombe sur l'estimation
 *   `gross - yuno_fee - stripe_fee` calculée depuis tickets / table_reservations.
 */
export function useEventNetGain(eventId: string | null | undefined, perspective: NetGainPerspective): NetGainResult {
  const [netEuros, setNetEuros] = useState(0);
  const [paidEuros, setPaidEuros] = useState(0);
  const [pendingEuros, setPendingEuros] = useState(0);
  const [failedEuros, setFailedEuros] = useState(0);
  const [releaseAt, setReleaseAt] = useState<string | null>(null);
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
            'primary_amount_cents, secondary_amount_cents, primary_recipient_venue_id, secondary_recipient_venue_id, primary_recipient_organizer_id, secondary_recipient_organizer_id, primary_transfer_status, secondary_transfer_status, transfers_release_at'
          )
          .eq('event_id', eventId);

        if (cancelled) return;

        // Money already on the recipient's account (direct charge or released transfer).
        const RECEIVED = new Set(['succeeded', 'not_required', 'partially_refunded']);
        // Money the recipient never receives — exclude from the net figure entirely.
        const EXCLUDED = new Set(['cancelled', 'refunded']);

        let paidCents = 0;
        let pendingCents = 0;
        let failedCents = 0;
        let earliestRelease: string | null = null;
        let count = 0;

        const considerLeg = (amountCents: number, status: string | null, releaseIso: string | null) => {
          const cents = Number(amountCents || 0);
          if (cents <= 0) return;
          const s = status ?? 'scheduled';
          if (EXCLUDED.has(s)) return;
          count++;
          if (s === 'scheduled') {
            pendingCents += cents;
            if (releaseIso && (!earliestRelease || releaseIso < earliestRelease)) earliestRelease = releaseIso;
          } else if (s === 'failed') {
            failedCents += cents;
          } else if (RECEIVED.has(s)) {
            paidCents += cents;
          } else {
            // Unknown status → treat as pending so the money is never silently dropped.
            pendingCents += cents;
            if (releaseIso && (!earliestRelease || releaseIso < earliestRelease)) earliestRelease = releaseIso;
          }
        };

        (distros || []).forEach((d: any) => {
          if (perspective.kind === 'venue') {
            if (d.primary_recipient_venue_id === perspective.venueId) {
              considerLeg(d.primary_amount_cents, d.primary_transfer_status, d.transfers_release_at);
            } else if (d.secondary_recipient_venue_id === perspective.venueId) {
              considerLeg(d.secondary_amount_cents, d.secondary_transfer_status, d.transfers_release_at);
            }
          } else {
            if (d.primary_recipient_organizer_id === perspective.organizerUserId) {
              considerLeg(d.primary_amount_cents, d.primary_transfer_status, d.transfers_release_at);
            } else if (d.secondary_recipient_organizer_id === perspective.organizerUserId) {
              considerLeg(d.secondary_amount_cents, d.secondary_transfer_status, d.transfers_release_at);
            }
          }
        });

        if (count > 0) {
          setPaidEuros(paidCents / 100);
          setPendingEuros(pendingCents / 100);
          setFailedEuros(failedCents / 100);
          setNetEuros((paidCents + pendingCents + failedCents) / 100);
          setReleaseAt(earliestRelease);
          setRowCount(count);
          setFallbackUsed(false);
        } else {
          // 2. Fallback for solo / legacy events without distribution rows.
          // Estimate net = revenue - yuno service fees - stripe fees. A direct
          // charge lands on the recipient's account immediately → counts as paid.
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
          const est = ticketNet + tableNet;
          setNetEuros(est);
          setPaidEuros(est);
          setPendingEuros(0);
          setFailedEuros(0);
          setReleaseAt(null);
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

  return { netEuros, paidEuros, pendingEuros, failedEuros, releaseAt, loading, rowCount, fallbackUsed };
}
