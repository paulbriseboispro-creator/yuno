import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

/**
 * État de l'e-mail d'un billet, lu par la page de confirmation (migration
 * 20261105100000) : envoyé, livré ou rebondi. Un rebond dur arrive en quelques
 * secondes : la page relit l'état toutes les 5 s pendant 3 min tant que
 * l'e-mail n'est ni livré ni rebondi, puis s'arrête. La preuve est le QR du
 * billet, que seul l'acheteur a sur cette page.
 */
export type TicketEmailStatus = 'sent' | 'delivered' | 'bounced';

export interface TicketEmailDelivery {
  status: TicketEmailStatus;
  email: string;
  /** L'adresse peut encore être corrigée (rebond, ou < 2 h après le paiement). */
  canFix: boolean;
}

export type TicketEmailFixFailure = 'invalid_email' | 'same_email' | 'too_late' | 'too_many' | 'not_found' | 'not_paid' | 'error';

export interface TicketEmailFixResult {
  ok: boolean;
  reason?: TicketEmailFixFailure;
}

const POLL_EVERY_MS = 5_000;
const POLL_FOR_MS = 180_000;

interface DeliveryRow { status: TicketEmailStatus; email: string; can_fix: boolean }

export function useTicketEmailDelivery(
  ticketId?: string | null,
  qrCode?: string | null,
  /** false = une seule lecture (la Console lit l'état d'un billet déjà ancien). */
  { poll = true }: { poll?: boolean } = {},
) {
  const [delivery, setDelivery] = useState<TicketEmailDelivery | null>(null);
  // Point de départ de la relecture : l'arrivée sur la page, puis chaque renvoi.
  const [pollSince, setPollSince] = useState(() => Date.now());

  const read = useCallback(async () => {
    if (!ticketId || !qrCode) return null;
    const { data, error } = await (supabase as unknown as SupabaseClient).rpc('get_ticket_email_delivery', {
      p_ticket_id: ticketId,
      p_qr: qrCode,
    });
    if (error || !data) return null;
    const row = data as DeliveryRow;
    const next: TicketEmailDelivery = { status: row.status, email: row.email, canFix: !!row.can_fix };
    setDelivery(next);
    return next;
  }, [ticketId, qrCode]);

  useEffect(() => {
    if (!ticketId || !qrCode) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      const next = await read();
      if (stopped) return;
      const settled = next && next.status !== 'sent';
      if (poll && !settled && Date.now() - pollSince < POLL_FOR_MS) {
        timer = window.setTimeout(tick, POLL_EVERY_MS);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [ticketId, qrCode, read, pollSince, poll]);

  /** Corrige l'adresse et renvoie le billet. Rend la raison d'un refus. */
  const fix = useCallback(async (email: string): Promise<TicketEmailFixResult> => {
    if (!ticketId || !qrCode) return { ok: false, reason: 'not_found' };
    const { data } = await invokeEdgeFunction<{ success?: boolean; ok?: boolean; reason?: TicketEmailFixFailure }>(
      'send-ticket-confirmation',
      { body: { action: 'fix_email', ticketId, qrCode, email: email.trim() } },
    );
    if (data?.success) {
      setDelivery({ status: 'sent', email: email.trim().toLowerCase(), canFix: true });
      setPollSince(Date.now());
      return { ok: true };
    }
    if (data && data.ok === false && data.reason) return { ok: false, reason: data.reason };
    return { ok: false, reason: 'error' };
  }, [ticketId, qrCode]);

  return { delivery, fix };
}
