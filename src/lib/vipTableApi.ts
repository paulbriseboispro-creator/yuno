import { supabase } from '@/integrations/supabase/client';
import { vipErrorInfo, type PlacementAdjustment, type VipErrorInfo } from '@/lib/vipTableRules';

/**
 * Appels serveur de la gestion pro des tables VIP (vague B3). Aucune écriture
 * directe de `table_reservations` pour un placement ou une annulation : tout passe
 * par les RPC (état attendu relu sous verrou) et owner-refund.
 */

export interface VipApiError extends VipErrorInfo {
  code?: string;
  message?: string;
  status?: number;
}

type RpcResult = PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
// Les types générés ne connaissent pas encore les RPC de la vague A (types.ts à régénérer).
const rpc = (fn: string, args: Record<string, unknown>): RpcResult =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => RpcResult }).rpc(fn, args);

function toApiError(err: { code?: string | null; message?: string | null; status?: number | null }): VipApiError {
  return {
    ...vipErrorInfo(err),
    code: err.code ?? undefined,
    message: err.message ?? undefined,
    status: err.status ?? undefined,
  };
}

/** Erreur d'une edge function : statut HTTP + code lu dans le corps JSON. */
async function edgeError(error: unknown): Promise<VipApiError> {
  const ctx = (error as { context?: unknown })?.context;
  let status: number | undefined;
  let body: { error?: string; detail?: string } | null = null;
  if (ctx instanceof Response) {
    status = ctx.status;
    try { body = await ctx.clone().json(); } catch { body = null; }
  }
  return toApiError({ status, message: body?.error || (error as Error)?.message });
}

// Pas d'union discriminée : le projet n'est pas en strictNullChecks, `ok` ne ferait pas le tri.
export interface PlacementResult {
  ok: boolean;
  error: VipApiError | null;
  changedTable: boolean;
  previousTable: string | null;
  newTable: string | null;
  placementStatus: string | null;
  /** Décidé par le serveur : 'table_changed' = le client doit être prévenu par e-mail, null = rien à dire. */
  notify: 'table_changed' | null;
}
const placementFailure = (error: VipApiError): PlacementResult =>
  ({ ok: false, error, changedTable: false, previousTable: null, newTable: null, placementStatus: null, notify: null });

export interface PlacementArgs {
  reservationId: string;
  action: 'assign' | 'on_arrival';
  tableId?: string | null;
  adjustment?: { p_adjustment: PlacementAdjustment; p_adjustment_amount: number | null } | null;
  /** État de placement vu à l'écran : le serveur refuse si un collègue est déjà passé. */
  expectedPlacementStatus?: string | null;
}

export async function setTablePlacement(a: PlacementArgs): Promise<PlacementResult> {
  const { data, error } = await rpc('vip_set_table_placement', {
    p_reservation_id: a.reservationId,
    p_action: a.action,
    p_table_id: a.tableId ?? null,
    p_adjustment: a.adjustment?.p_adjustment ?? null,
    p_adjustment_amount: a.adjustment?.p_adjustment_amount ?? null,
    p_expected_placement_status: a.expectedPlacementStatus ?? null,
  });
  if (error) return placementFailure(toApiError(error));
  const r = (data ?? {}) as {
    changed_table?: boolean; previous_table?: string | null; new_table?: string | null; placement_status?: string | null;
    notify?: string | null;
  };
  return {
    ok: true,
    error: null,
    changedTable: !!r.changed_table,
    previousTable: r.previous_table ?? null,
    newTable: r.new_table ?? null,
    placementStatus: r.placement_status ?? null,
    notify: r.notify === 'table_changed' ? 'table_changed' : null,
  };
}

/** Remarque au client : champ de service, jamais un champ de placement. Rend false si rien n'a été écrit (RLS, erreur). */
export async function saveReservationNote(reservationId: string, note: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('table_reservations')
    .update({ placement_note: note })
    .eq('id', reservationId)
    .select('id');
  return !error && !!data && data.length > 0;
}

/** E-mail client « ta réservation tient, ta table change » (jamais bloquant pour le geste). */
export async function sendTableChangedEmail(reservationId: string): Promise<VipApiError | null> {
  const { error } = await supabase.functions.invoke('send-vip-confirmation', {
    body: { reservation_id: reservationId, type: 'table_changed' },
  });
  return error ? edgeError(error) : null;
}

export interface CancelResult { ok: boolean; error: VipApiError | null; amount: number }

/**
 * Annule une table. Payée en ligne : tout est rendu (frais de service compris, D10) ;
 * sans paiement Stripe : annulation simple. Dans les deux cas owner-refund envoie
 * lui-même l'e-mail au client : ne jamais le renvoyer d'ici.
 */
export async function cancelTable(reservationId: string): Promise<CancelResult> {
  const { data, error } = await supabase.functions.invoke('owner-refund', {
    body: { action: 'cancel_table', reservation_id: reservationId },
  });
  if (error) return { ok: false, error: await edgeError(error), amount: 0 };
  const res = (data as { results?: { success: boolean; error?: string; amount?: number }[] } | null)?.results?.[0];
  if (!res?.success) return { ok: false, error: toApiError({ message: res?.error }), amount: 0 };
  return { ok: true, error: null, amount: Number(res.amount) || 0 };
}
