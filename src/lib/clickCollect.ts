import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Demande de préparation Click & Collect — porte unique côté client.
 *
 * Le client n'a AUCUN droit d'écriture sur `orders` : les anciens
 * `.update({ prep_requested: true })` étaient refusés par la RLS sans erreur
 * (PostgREST rend 0 ligne), l'écran disait « demande envoyée » et le bar ne
 * recevait rien — aucune commande n'a jamais été demandée ainsi. La RPC
 * `request_order_prep` (migration 20260929236000) vérifie le titulaire, le
 * paiement et marque les unités choisies (index DÉPLIÉS, base 0 — le même
 * ordre que le QR de sélection).
 */
export type OrderPrepFailure = 'not_found' | 'not_redeemable' | 'in_progress' | 'nothing_to_prepare' | 'error';

export class OrderPrepError extends Error {
  constructor(public reason: OrderPrepFailure) {
    super(`order_prep_${reason}`);
    this.name = 'OrderPrepError';
  }
}

export async function requestOrderPrep(
  orderId: string,
  unitIndices: number[] | null = null,
  bar: string | null = null,
): Promise<void> {
  const { data, error } = await (supabase as unknown as SupabaseClient).rpc('request_order_prep', {
    p_order_id: orderId,
    p_unit_indices: unitIndices,
    p_bar: bar,
  });
  if (error) throw new OrderPrepError('error');
  const outcome = data as { ok: boolean; reason?: OrderPrepFailure } | null;
  if (!outcome?.ok) throw new OrderPrepError(outcome?.reason ?? 'error');
}
