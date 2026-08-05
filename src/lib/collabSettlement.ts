import { supabase } from '@/integrations/supabase/client';

/**
 * Règlement collab des tables (base « total dépensé ») — client partagé.
 *
 * Quand le contrat de collaboration partage les tables sur le TOTAL dépensé de
 * la soirée (split_rules.tables.basis = 'total_spend'), l'acompte en ligne est
 * partagé via Stripe comme avant, et le COMPLÉMENT (solde sur place + extras)
 * est dû par le club à l'organisateur en fin de soirée. Ce cycle est copié du
 * règlement promoteur : Yuno sécurise l'ACCORD, jamais les fonds.
 *
 *   'pending'  → lot PRÉPARÉ    : calcul figé par réservation, annulable
 *   'approved' → virement DÉCLARÉ par le club, attente d'accusé de réception
 *   'paid'     → réception CONFIRMÉE par l'organisateur — et lui seul
 *   'disputed' → contesté, ou sans réponse passé le délai (watchdog quotidien)
 *
 * Les RPC sont appelées via `(supabase as any)` tant que les types générés
 * n'incluent pas le cycle ; les types de retour ci-dessous sont la source de
 * vérité côté front — alignés sur les jsonb_build_object de la migration
 * 20260805103000_collab_table_settlement.sql.
 */

export type SettlementStatus = 'pending' | 'approved' | 'paid' | 'disputed';

export interface CollabSettlementRow {
  id: string;
  event_id: string;
  venue_id: string;
  organizer_user_id: string;
  amount: number;
  organizer_pct_applied: number | null;
  night_revenue: number | null;
  organizer_theoretical: number | null;
  organizer_prepaid: number | null;
  status: SettlementStatus;
  transfer_reference: string | null;
  confirm_due_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  created_at: string;
}

/** Colonnes à demander pour reconstituer un {@link CollabSettlementRow}. */
export const SETTLEMENT_COLUMNS =
  'id, event_id, venue_id, organizer_user_id, amount, organizer_pct_applied, night_revenue, ' +
  'organizer_theoretical, organizer_prepaid, status, transfer_reference, confirm_due_at, ' +
  'approved_at, paid_at, disputed_at, dispute_reason, created_at';

export interface SettlementComputeResult {
  eligible: boolean;
  reason?: 'not_a_collab' | 'no_contract' | 'deposit_basis' | 'tables_pillar_disabled' | 'no_organizer_share';
  event_ended?: boolean;
  basis?: string;
  organizer_pct?: number;
  reservations?: number;
  night_revenue?: number;
  organizer_theoretical?: number;
  organizer_prepaid?: number;
  amount_due?: number;
  already_settled?: number;
  organizer_has_iban?: boolean;
  open_settlement?: {
    id: string;
    status: SettlementStatus;
    amount: number;
    transfer_reference: string | null;
    confirm_due_at: string | null;
    approved_at: string | null;
    disputed_at: string | null;
    dispute_reason: string | null;
    created_at: string;
  } | null;
}

export interface SettlementPrepareResult {
  prepared: boolean;
  reason?: string;
  settlement_id?: string;
  amount?: number;
  count?: number;
  iban?: string | null;
  bic?: string | null;
  reference?: string;
}

// ─── Appel RPC ───────────────────────────────────────────────────────────────

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const computeSettlement = (eventId: string) =>
  callRpc<SettlementComputeResult>('compute_collab_table_settlement', { p_event_id: eventId });

export const prepareSettlement = (eventId: string) =>
  callRpc<SettlementPrepareResult>('prepare_collab_table_settlement', { p_event_id: eventId });

export const declareSettlementSent = (settlementId: string) =>
  callRpc<{ declared: boolean; confirm_due_at: string }>('declare_collab_settlement_sent', {
    p_settlement_id: settlementId,
  });

export const confirmSettlementReceived = (settlementId: string) =>
  callRpc<{ confirmed: boolean; amount: number }>('confirm_collab_settlement_received', {
    p_settlement_id: settlementId,
  });

export const disputeSettlement = (settlementId: string, reason?: string) =>
  callRpc<{ disputed: boolean }>('dispute_collab_settlement', {
    p_settlement_id: settlementId,
    p_reason: reason ?? null,
  });

export const resolveSettlementDispute = (settlementId: string, action: 'redeclare' | 'cancel') =>
  callRpc<{ resolved: boolean; action: string }>('resolve_collab_settlement_dispute', {
    p_settlement_id: settlementId,
    p_action: action,
  });

export const cancelSettlement = (settlementId: string) =>
  callRpc<{ cancelled: boolean }>('cancel_collab_table_settlement', { p_settlement_id: settlementId });

/**
 * IBAN/BIC de l'organisateur servis au club, UNIQUEMENT via RPC et tant que le
 * lot est ouvert : organizer_payout_details n'est jamais lisible en direct.
 */
export const getSettlementBankDetails = (settlementId: string) =>
  callRpc<{ iban: string | null; bic: string | null; reference: string | null; amount: number }>(
    'get_collab_settlement_bank_details',
    { p_settlement_id: settlementId },
  );

// ─── Erreurs ─────────────────────────────────────────────────────────────────

/** Codes stables levés par les RPC du cycle → messages ciblés côté UI. */
export function settlementErrorCode(err: unknown): string {
  const raw = String(
    (err as { message?: string })?.message ?? (err as { error?: string })?.error ?? err ?? ''
  ).toLowerCase();

  const known = [
    'organizer_iban_missing',
    'iban_recently_changed',
    'settlement_already_open',
    'event_not_ended',
    'deposit_basis',
    'tables_pillar_disabled',
    'no_organizer_share',
    'no_contract',
    'not_a_collab',
    'not_authorized',
    'settlement_not_found',
    'settlement_not_prepared',
    'settlement_not_declared',
    'settlement_not_disputed',
    'settlement_not_cancellable',
    'settlement_closed',
    'only_organizer_can_confirm',
    'only_organizer_can_dispute',
    'settlement_direct_write_forbidden',
  ];

  return known.find((k) => raw.includes(k)) ?? 'generic';
}
