import { tableHeldBy, type ReservationLite } from '@/lib/vipTableRules';

/**
 * Règles pures de la réservation manuelle, du nombre de convives, des
 * précommandes de bouteilles et de l'argent d'une table (vague C3b).
 */

interface ErrLike { code?: string | null; message?: string | null; status?: number | null }

export interface CodedError {
  /** Clé i18n (préfixe tblm.). */
  key: string;
  /** Valeurs à glisser dans le texte : `{min}`, `{max}`, `{n}`. */
  params?: Record<string, string | number>;
  /** L'état a changé côté serveur : relire la liste. */
  refresh: boolean;
}

/** Erreurs de `create_manual_table_reservation` (SQLSTATE : message). */
export function manualReservationError(err: ErrLike | null | undefined): CodedError {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  const has = (s: string) => msg.includes(s);
  if (has('table_not_found')) return { key: 'tblm.err.tableNotFound', refresh: true };
  if (has('pack_not_in_event') || has('pack_not_in_zone')) return { key: 'tblm.err.packOutOfScope', refresh: false };
  if (has('email_required')) return { key: 'tblm.err.emailRequired', refresh: false };
  if (code === 'YU011' || has('guest_count_out_of_range')) {
    const m = msg.match(/guest_count_out_of_range:(\d+):(\d+)/);
    return { key: 'tblm.err.guestRange', params: { min: m?.[1] ?? 1, max: m?.[2] ?? 50 }, refresh: false };
  }
  if (code === '23505' || has('table_taken') || has('uq_table_reservations_live_table') || has('duplicate key')) {
    return { key: 'tblm.err.tableTaken', refresh: true };
  }
  if (code === '23514' || has('est complète') || has('is full')) return { key: 'tblm.err.zoneFull', refresh: true };
  if (code === '42501' || has('forbidden') || has('not_allowed')) return { key: 'tblm.err.notAllowed', refresh: false };
  return { key: 'tblm.err.generic', refresh: false };
}

/** Erreurs de `vip_set_table_guest_count`. */
export function guestCountError(err: ErrLike | null | undefined): CodedError {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  const has = (s: string) => msg.includes(s);
  if (code === 'YU011' || has('guest_count_out_of_range')) {
    const m = msg.match(/guest_count_out_of_range:(\d+):(\d+)/);
    return { key: 'tblm.guests.errRange', params: { min: m?.[1] ?? 1, max: m?.[2] ?? 50 }, refresh: false };
  }
  if (code === 'YU012' || has('guest_count_below_entered')) {
    const m = msg.match(/guest_count_below_entered:(\d+)/);
    return { key: 'tblm.guests.errEntered', params: { n: m?.[1] ?? 0 }, refresh: false };
  }
  if (code === 'YU013' || has('reservation_not_active') || code === 'P0002') return { key: 'tblm.guests.errNotActive', refresh: true };
  if (code === 'YU014' || has('guest_count_changed')) return { key: 'tblm.guests.errChanged', refresh: true };
  if (code === '42501' || has('forbidden')) return { key: 'tblm.err.notAllowed', refresh: false };
  return { key: 'tblm.err.generic', refresh: false };
}

/** Texte traduit d'une erreur codée : `{min}`, `{max}`, `{n}` remplacés. */
export function fillParams(text: string, params?: Record<string, string | number>): string {
  let out = text;
  for (const [k, v] of Object.entries(params ?? {})) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Une fonction d'e-mail de vente a répondu 202 `{queued:true}` : refusé par Resend, rejoué plus tard (D6). */
export function isQueuedEmail(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { queued?: unknown }).queued === true;
}

export interface PlanTableForManual {
  id: string;
  name: string;
  zoneId?: string;
  packId?: string;
}

/**
 * Tables libres pour une réservation manuelle : celles de la zone choisie
 * (une table sans zone connue reste proposée), non tenues par une réservation vivante.
 */
export function freeTablesForManual(
  tables: PlanTableForManual[],
  reservations: ReservationLite[],
  zoneId: string | null | undefined,
): PlanTableForManual[] {
  return tables.filter(tb =>
    (!zoneId || !tb.zoneId || tb.zoneId === zoneId) && !tableHeldBy(tb.id, reservations),
  );
}

/** Le nombre de convives proposé est-il acceptable avant l'appel ? Le serveur reste juge. */
export function guestCountValid(value: number, entered: number, max: number): boolean {
  return Number.isInteger(value) && value >= Math.max(1, entered) && value <= max;
}

// ── Précommandes de bouteilles (D8) ─────────────────────────────────────────

export interface PreorderLite {
  reservationId: string;
  status?: string | null;
  notes?: string | null;
  totalAmount: number;
  items?: { quantity: number }[];
}

/** Une précommande du checkout : statut `preorder`, ou la note posée par le serveur (anciennes lignes). */
export function isPreorderOrder(o: { status?: string | null; notes?: string | null }): boolean {
  if (o.status === 'preorder') return true;
  const n = (o.notes || '').toLowerCase();
  return n.includes('pré-commande') || n.includes('pre-order') || n.includes('preorder');
}

/** Encore à encaisser au club : une précommande ni servie, ni annulée (rien n'est payé en ligne, jamais). */
export function preorderDueOnSite(o: PreorderLite): number {
  if (!isPreorderOrder(o) || o.status === 'served' || o.status === 'cancelled') return 0;
  return Math.max(0, Number(o.totalAmount) || 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Précommandes d'une réservation : bouteilles et montant « à encaisser sur place ». */
export function preorderOfReservation(orders: PreorderLite[], reservationId: string): { bottles: number; due: number } {
  let bottles = 0;
  let due = 0;
  for (const o of orders) {
    if (o.reservationId !== reservationId || !isPreorderOrder(o) || o.status === 'cancelled') continue;
    bottles += (o.items ?? []).reduce((s, it) => s + it.quantity, 0);
    due = round2(due + preorderDueOnSite(o));
  }
  return { bottles, due };
}

/** Total « à encaisser sur place » par réservation et pour la soirée. */
export function preorderTotals(orders: PreorderLite[]): { byReservation: Map<string, number>; total: number; tables: number } {
  const byReservation = new Map<string, number>();
  let total = 0;
  for (const o of orders) {
    const due = preorderDueOnSite(o);
    if (due <= 0) continue;
    byReservation.set(o.reservationId, round2((byReservation.get(o.reservationId) ?? 0) + due));
    total = round2(total + due);
  }
  return { byReservation, total, tables: byReservation.size };
}
