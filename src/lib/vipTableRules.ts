/**
 * Règles pures de la gestion pro des réservations de tables VIP (vague B3).
 * Miroir côté écran de ce que décident les RPC serveur (`vip_set_table_placement`,
 * `cancel_unpaid_table_reservation`, owner-refund `cancel_table`) : le serveur reste
 * seul juge, ces fonctions ne servent qu'à ne proposer que ce qu'il acceptera et à
 * nommer ce qui se passe.
 */

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

// ── Argent d'une table (P4.7, D5) ───────────────────────────────────────────

export interface TableMoneyInput {
  totalPrice: number;
  deposit: number;
  /** Frais de gestion payés en plus par le client (ce qui s'ajoute à l'acompte chez Stripe). */
  managementFee?: number | null;
  /** Frais absorbés par le club : le client ne les paie pas. */
  feeAbsorbed?: boolean | null;
  /** Ce que Stripe a réellement pris (acompte + frais), stocké au checkout. */
  chargedTotal?: number | null;
  /** Paiement Stripe passé par Yuno (intent ou session). */
  hasOnlinePayment: boolean;
  /** « Différence à régler sur place » posée par un déplacement vers une autre formule (D3). */
  onSiteAdjustment?: number | null;
}

export interface TableMoney {
  /** Acompte + frais, payés en ligne. 0 pour une table sur place ou manuelle. */
  paidOnline: number;
  /** Ce que le client règle encore au club. */
  remainingOnSite: number;
  /** Prix de la table : ce à quoi le client s'est engagé. */
  commitment: number;
}

/** Trois chiffres nommés : une table sur place à 800 € = 0 / 800 / 800. */
export function tableMoney(r: TableMoneyInput): TableMoney {
  const adj = Math.max(0, Number(r.onSiteAdjustment) || 0);
  const commitment = round2(Math.max(0, r.totalPrice || 0) + adj);
  if (!r.hasOnlinePayment) return { paidOnline: 0, remainingOnSite: commitment, commitment };
  const charged = r.chargedTotal != null && r.chargedTotal > 0
    ? r.chargedTotal
    : (r.deposit || 0) + (r.feeAbsorbed ? 0 : (r.managementFee || 0));
  return {
    paidOnline: round2(Math.max(0, charged)),
    remainingOnSite: round2(Math.max(0, commitment - Math.max(0, r.deposit || 0))),
    commitment,
  };
}

// ── Déplacement d'un client (P4.2, D3) ──────────────────────────────────────

export interface PlacementAdjustmentNeed {
  /** La table visée est d'une autre formule que celle de la réservation. */
  required: boolean;
  /** Écart de prix des formules (≥ 0) : proposé pour « différence à régler sur place ». */
  difference: number;
}

/** Même formule (ou table sans formule liée) = libre ; sinon le pro doit choisir. */
export function adjustmentNeed(args: {
  reservationPackId?: string | null;
  targetPackId?: string | null;
  reservationPrice: number;
  targetPrice?: number | null;
}): PlacementAdjustmentNeed {
  const { reservationPackId, targetPackId } = args;
  if (!targetPackId || !reservationPackId || targetPackId === reservationPackId) {
    return { required: false, difference: 0 };
  }
  const diff = round2((args.targetPrice ?? 0) - (args.reservationPrice || 0));
  return { required: true, difference: Math.max(0, diff) };
}

export type PlacementAdjustment = 'upgrade_free' | 'pay_on_site';

/** Arguments `p_adjustment` / `p_adjustment_amount` de la RPC, ou null si invalide. */
export function adjustmentArgs(
  choice: PlacementAdjustment | null,
  amount: number,
): { p_adjustment: PlacementAdjustment; p_adjustment_amount: number | null } | null {
  if (choice === 'upgrade_free') return { p_adjustment: 'upgrade_free', p_adjustment_amount: null };
  if (choice === 'pay_on_site') {
    const a = round2(amount);
    return a >= 0 ? { p_adjustment: 'pay_on_site', p_adjustment_amount: a } : null;
  }
  return null;
}

export interface PlanTableLite {
  id: string;
  packId?: string;
}
export interface ReservationLite {
  id: string;
  assignedTableId?: string | null;
  requestedTableId?: string | null;
  placementStatus?: string | null;
}

/** Table tenue par une autre réservation (attribuée, ou demande vivante non encore servie). */
export function tableHeldBy(tableId: string, reservations: ReservationLite[], excludeId?: string): ReservationLite | undefined {
  return reservations.find(r => {
    if (r.id === excludeId) return false;
    if (r.assignedTableId === tableId) return true;
    return !r.assignedTableId && r.requestedTableId === tableId
      && (r.placementStatus === 'requested' || r.placementStatus === 'approved');
  });
}

/** Tables libres de la même formule que la réservation (pour « Proposer une autre table »). */
export function freeTablesOfPack(
  tables: PlanTableLite[],
  reservations: ReservationLite[],
  packId: string | null | undefined,
  excludeId?: string,
): string[] {
  return tables
    .filter(tb => (!tb.packId || !packId || tb.packId === packId) && !tableHeldBy(tb.id, reservations, excludeId))
    .map(tb => tb.id);
}

/** Libellé d'un ajustement posé : texte + montant éventuel. */
export function adjustmentKind(adj?: string | null): PlacementAdjustment | null {
  return adj === 'upgrade_free' || adj === 'pay_on_site' ? adj : null;
}

// ── Erreurs serveur (P4.4) ──────────────────────────────────────────────────

export interface VipErrorInfo {
  /** Clé i18n (préfixe tblg.). */
  key: string;
  /** L'état a changé côté serveur : relire la liste. */
  refresh: boolean;
}

interface ErrLike { code?: string | null; message?: string | null; status?: number | null }

/** Traduit un code SQLSTATE YU00x, un message de RPC ou un statut HTTP d'edge function. */
export function vipErrorInfo(err: ErrLike | null | undefined): VipErrorInfo {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  const status = err?.status ?? 0;
  const has = (s: string) => msg.includes(s);
  if (code === 'YU004' || has('placement_changed')) return { key: 'tblg.err.placementChanged', refresh: true };
  if (code === 'YU005' || has('formula_change_requires_adjustment')) return { key: 'tblg.err.adjustmentRequired', refresh: false };
  if (code === 'YU006' || has('use_refund')) return { key: 'tblg.err.useRefund', refresh: true };
  if (code === 'YU007' || has('table_taken')) return { key: 'tblg.err.tableTaken', refresh: true };
  if (code === 'YU008' || has('reservation_not_active') || has('already_seated')) {
    return { key: has('already_seated') ? 'tblg.err.alreadySeated' : 'tblg.err.notActive', refresh: true };
  }
  if (code === 'YU009' || has('table_unknown')) return { key: 'tblg.err.tableUnknown', refresh: true };
  if (code === '42501' || has('not_allowed') || has('not_authenticated') || status === 403 || has('forbidden') || has('unauthorized')) {
    return { key: 'tblg.err.notAllowed', refresh: false };
  }
  if (status === 409 || has('state_mismatch')) return { key: 'tblg.err.stateMismatch', refresh: true };
  if (code === 'P0002' || has('reservation_not_found') || has('already cancelled')) return { key: 'tblg.err.notActive', refresh: true };
  if (code === '22023' || has('invalid_adjustment')) return { key: 'tblg.err.invalidAdjustment', refresh: false };
  if (has('collected by')) return { key: 'tblg.err.otherCollector', refresh: false };
  return { key: 'tblg.err.generic', refresh: true };
}
