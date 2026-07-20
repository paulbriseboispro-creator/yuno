import { supabase } from '@/integrations/supabase/client';

/**
 * Règlement promoteur en trois temps — client partagé.
 *
 * Yuno sécurise l'ACCORD, jamais les fonds : l'argent part du compte du club par
 * virement SEPA classique. Yuno horodate qui a préparé, qui a déclaré avoir viré,
 * et qui a accusé réception. Aucune détention de fonds, donc aucune exposition
 * réglementaire.
 *
 *   'pending'  → lot PRÉPARÉ    : périmètre figé, annulable, rien n'est soldé
 *   'approved' → virement DÉCLARÉ par le club, en attente d'accusé de réception
 *   'paid'     → réception CONFIRMÉE par le promoteur → commissions soldées
 *   'disputed' → contesté, ou sans réponse passé le délai
 *
 * Les RPC sont appelées via `(supabase as any)` : le fichier de types généré
 * n'a pas été régénéré depuis l'arrivée du cycle en trois temps, et le
 * régénérer réécrit 1,5 Mo de types pour quatre signatures. Les types de retour
 * ci-dessous sont donc la source de vérité côté front — ils doivent rester
 * alignés sur les `jsonb_build_object` des migrations
 * 20260720193000 et 20260721090000.
 */

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'disputed';

export interface PromoterPayoutRow {
  id: string;
  promoter_id: string;
  amount: number;
  status: PayoutStatus;
  period_label: string | null;
  transfer_reference: string | null;
  confirm_due_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  notes: string | null;
  created_at: string;
}

/** Colonnes à demander pour reconstituer un {@link PromoterPayoutRow}. */
export const PAYOUT_COLUMNS =
  'id, promoter_id, amount, status, period_label, transfer_reference, confirm_due_at, ' +
  'approved_at, paid_at, disputed_at, dispute_reason, notes, created_at';

export interface PrepareResult {
  prepared: boolean;
  reason?: string;
  payout_id?: string;
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

export const preparePayout = (promoterId: string, periodLabel?: string) =>
  callRpc<PrepareResult>('prepare_promoter_payout', {
    p_promoter_id: promoterId,
    p_period_label: periodLabel ?? null,
  });

export const declarePayoutSent = (payoutId: string) =>
  callRpc<{ declared: boolean; confirm_due_at: string }>('declare_promoter_payout_sent', {
    p_payout_id: payoutId,
  });

export const confirmPayoutReceived = (payoutId: string) =>
  callRpc<{ confirmed: boolean; amount: number }>('confirm_promoter_payout_received', {
    p_payout_id: payoutId,
  });

export const disputePayout = (payoutId: string, reason?: string) =>
  callRpc<{ disputed: boolean }>('dispute_promoter_payout', {
    p_payout_id: payoutId,
    p_reason: reason ?? null,
  });

export const resolvePayoutDispute = (payoutId: string, action: 'redeclare' | 'cancel') =>
  callRpc<{ resolved: boolean; action: string }>('resolve_promoter_payout_dispute', {
    p_payout_id: payoutId,
    p_action: action,
  });

export const cancelPayout = (payoutId: string) =>
  callRpc<{ cancelled: boolean }>('cancel_promoter_payout', { p_payout_id: payoutId });

// ─── Notification de l'autre partie ──────────────────────────────────────────

/**
 * Prévient l'autre partie qu'une étape vient d'être franchie.
 *
 * Volontairement « fire and forget » : un push qui échoue ne doit JAMAIS faire
 * croire que le règlement a échoué. La transition est déjà committée en base
 * quand on arrive ici, et les deux surfaces in-app (dashboard promoteur, écran
 * finance du club) affichent l'état réel sans dépendre du push.
 *
 * La fonction edge relit le statut en base pour décider quoi envoyer : on ne
 * lui passe que l'identifiant du lot.
 */
export function notifyPayoutParties(payoutId: string): void {
  supabase.functions
    .invoke('promoter-payout-notify', { body: { payout_id: payoutId } })
    .catch(() => {
      // Fonction pas encore déployée (cap edge Supabase) ou hors ligne : le
      // cycle continue de fonctionner sur les surfaces in-app.
    });
}

// ─── Erreurs ─────────────────────────────────────────────────────────────────

/**
 * Traduit l'erreur Postgres en clé i18n.
 *
 * Les RPC lèvent des codes stables (`iban_recently_changed`, `payout_already_open`…)
 * précisément pour ça. L'écran affichait auparavant un seul « Erreur de mise à
 * jour » pour tous les cas : un club bloqué par le gel anti-fraude de 24 h
 * n'avait aucun moyen de comprendre pourquoi, et réessayait en boucle.
 */
export function payoutErrorKey(err: unknown): string {
  const raw = String(
    (err as { message?: string })?.message ?? (err as { error?: string })?.error ?? err ?? ''
  ).toLowerCase();

  const known = [
    'iban_recently_changed',
    'payout_already_open',
    'promoter_iban_missing',
    'agency_managed',
    'not_authorized',
    'payout_not_found',
    'payout_not_prepared',
    'payout_not_declared',
    'payout_not_disputed',
    'payout_not_cancellable',
    'only_promoter_can_confirm',
    'only_promoter_can_dispute',
    'payout_direct_write_forbidden',
    'conversion_direct_write_forbidden',
    'use_two_step_flow',
  ];

  const hit = known.find((k) => raw.includes(k));
  return hit ? `promoterSettlement.err.${hit}` : 'promoterSettlement.err.generic';
}

// ─── Formats ─────────────────────────────────────────────────────────────────

/** Groupe l'IBAN par 4 pour la lecture à l'œil : FR76 3000 4000 03… */
export const formatIban = (iban: string) =>
  iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

/** Montant lisible : pas de décimales sur un compte rond, deux sinon. */
export const euro = (n: number) => (Number.isInteger(n) ? `${n}€` : `${n.toFixed(2)}€`);

/**
 * Jours restants avant bascule en litige. Négatif = délai dépassé.
 * `Math.ceil` : à 4 h de l'échéance on affiche « 1 jour », pas « 0 jour ».
 */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
