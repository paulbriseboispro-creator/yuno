import { supabase } from '@/integrations/supabase/client';
import type { CollabTier } from '@/hooks/useOrganizerPartnerships';

/**
 * Décompte de fin de soirée d'une collab à BARÈME — client partagé.
 *
 * Quand le contrat rémunère l'organisateur par barème sur le CA total de la
 * soirée (revenue_split_rules.remuneration.mode = 'tiered_total'), les billets
 * et tables vendus via Yuno sont RETENUS sur la plateforme (jamais versés au
 * club à la vente), et le paiement se décide après la soirée :
 *
 *   1. le CLUB déclare le chiffre hors Yuno (bar en caisse, billets à la porte,
 *      extras des tables, autre) → statut 'declared' ;
 *   2. l'ORGANISATEUR accepte → Yuno fige le total, applique le barème et
 *      répartit : le dû part D'ABORD des fonds retenus (virement Stripe vers
 *      l'organisateur, prorata par vente), le RESTE par SEPA via le cycle
 *      collab_table_settlements (kind 'night_closing') ; ou conteste → 'disputed',
 *      le club corrige et redéclare.
 *
 * Les RPC sont appelées via `(supabase as any)` tant que les types générés ne
 * les connaissent pas ; les types ci-dessous sont alignés sur les
 * jsonb_build_object de la migration 20260921120000_collab_night_closing.sql.
 */

export type ClosingStatus = 'declared' | 'disputed' | 'accepted';

export interface ClosingDeclaration {
  bar: number;
  doorCount: number;
  doorTickets: number;
  tablesExtra: number;
  other: number;
  otherLabel?: string | null;
  note?: string | null;
  evidence?: string | null;
}

export interface ClosingRow {
  id: string;
  status: ClosingStatus;
  revision: number;
  declared_bar: number;
  declared_door_count: number;
  declared_door_tickets: number;
  declared_tables_extra: number;
  declared_other: number;
  declared_other_label: string | null;
  declared_note: string | null;
  declared_evidence: string | null;
  declared_at: string;
  yuno_tickets: number;
  yuno_tables: number;
  yuno_drinks: number;
  total_revenue: number | null;
  tier_pct: number | null;
  organizer_due: number | null;
  held_amount: number | null;
  online_amount: number | null;
  sepa_amount: number | null;
  accepted_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  settlement_id: string | null;
}

export interface ClosingSettlement {
  id: string;
  status: 'pending' | 'approved' | 'paid' | 'disputed';
  amount: number;
  transfer_reference: string | null;
  confirm_due_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  created_at: string;
}

export interface ClosingComputeResult {
  eligible: boolean;
  reason?: 'not_a_collab' | 'no_contract' | 'not_tiered';
  event_ended?: boolean;
  end_at?: string;
  tiers?: CollabTier[];
  tiers_mode?: 'flat' | 'marginal';
  yuno?: {
    tickets: number; tickets_count: number;
    tables: number; tables_count: number;
    drinks: number; drinks_count: number;
  };
  /** Fonds Yuno retenus sur la plateforme (net des frais Stripe), non remboursés. */
  held_amount?: number;
  organizer_stripe_ready?: boolean;
  organizer_has_iban?: boolean;
  /** Figé si accepté ; sinon Yuno live + déclaration courante. */
  projection?: { total: number; pct: number; due: number; online: number; sepa: number };
  closing?: ClosingRow | null;
  settlement?: ClosingSettlement | null;
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const computeNightClosing = (eventId: string) =>
  callRpc<ClosingComputeResult>('compute_collab_night_closing', { p_event_id: eventId });

export const declareNightClosing = (eventId: string, d: ClosingDeclaration) =>
  callRpc<{ declared: boolean; closing_id: string; total: number; pct: number; due: number }>(
    'declare_collab_night_closing',
    {
      p_event_id: eventId,
      p_bar: d.bar,
      p_door_count: d.doorCount,
      p_door_tickets: d.doorTickets,
      p_tables_extra: d.tablesExtra,
      p_other: d.other,
      p_other_label: d.otherLabel ?? null,
      p_note: d.note ?? null,
      p_evidence: d.evidence ?? null,
    },
  );

export const acceptNightClosing = (closingId: string) =>
  callRpc<{ accepted: boolean; total: number; pct: number; due: number; held: number; online: number; sepa: number; settlement_id: string | null }>(
    'accept_collab_night_closing',
    { p_closing_id: closingId },
  );

export const disputeNightClosing = (closingId: string, reason?: string) =>
  callRpc<{ disputed: boolean }>('dispute_collab_night_closing', {
    p_closing_id: closingId,
    p_reason: reason ?? null,
  });

export const cancelNightClosing = (closingId: string) =>
  callRpc<{ cancelled: boolean }>('cancel_collab_night_closing', { p_closing_id: closingId });

/** Codes stables levés par les RPC → messages ciblés côté UI. */
export function closingErrorCode(err: unknown): string {
  const raw = String(
    (err as { message?: string })?.message ?? (err as { error?: string })?.error ?? err ?? '',
  ).toLowerCase();
  const known = [
    'organizer_iban_missing',
    'iban_recently_changed',
    'settlement_already_open',
    'event_not_ended',
    'closing_already_accepted',
    'closing_not_declared',
    'closing_not_found',
    'only_organizer_can_accept',
    'only_organizer_can_dispute',
    'not_tiered',
    'no_contract',
    'not_a_collab',
    'not_authorized',
    'negative_amount',
    'support_session_forbidden',
  ];
  return known.find((k) => raw.includes(k)) ?? 'unknown';
}
