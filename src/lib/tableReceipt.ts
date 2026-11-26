/**
 * Reçu d'une réservation de table pour un acheteur SANS compte, partage des QR d'invités, messages d'erreur du checkout.
 * PUR (sauf `fetchTableReceipt` / le stockage, qui prennent leurs dépendances en argument) : testé dans
 * src/lib/__tests__/tableReceipt.test.ts.
 *
 * Contrats serveur (vague A) : create-table-checkout rend `receiptToken` ; verify-table-payment le redemande
 * (`receiptToken`) et répond `receiptRequired: true` sans lui ; get_table_receipt(p_reservation_id, p_qr) rend le reçu
 * à qui détient le QR de la réservation ; get_table_guest_pass(p_qr) rend UN QR d'invité.
 */

export const TABLE_RECEIPT_TOKEN_PREFIX = 'yuno:table-receipt:';
export const TABLE_RECEIPT_QR_PREFIX = 'yuno:table-qr:';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/** Jeton de reçu : localStorage (survit au passage par Stripe et à un onglet rouvert), jamais dans une URL. */
export function saveReceiptToken(store: StorageLike, reservationId: string, token: string | null | undefined): void {
  if (!reservationId || !token) return;
  safe(() => store.setItem(TABLE_RECEIPT_TOKEN_PREFIX + reservationId, token));
}
export function readReceiptToken(store: StorageLike, reservationId: string | null | undefined): string | null {
  if (!reservationId) return null;
  return safe(() => store.getItem(TABLE_RECEIPT_TOKEN_PREFIX + reservationId)) || null;
}

/** QR de la réservation, gardé le temps de la session pour que la page de confirmation survive à un rechargement. */
export function saveReceiptQr(store: StorageLike, reservationId: string, qr: string | null | undefined): void {
  if (!reservationId || !qr) return;
  safe(() => store.setItem(TABLE_RECEIPT_QR_PREFIX + reservationId, qr));
}
export function readReceiptQr(store: StorageLike, reservationId: string | null | undefined): string | null {
  if (!reservationId) return null;
  return safe(() => store.getItem(TABLE_RECEIPT_QR_PREFIX + reservationId)) || null;
}

export interface TableReceiptGuest {
  guest_number: number;
  full_name: string | null;
  qr_code: string;
  entry_scanned: boolean;
}

export interface TableReceipt {
  id: string;
  status: string;
  payment_mode: string | null;
  paid_at: string | null;
  qr_code: string;
  reference_code: string | null;
  scannable: boolean;
  event: {
    id: string;
    title: string | null;
    start_at: string | null;
    end_at: string | null;
    timezone: string | null;
    poster_url: string | null;
    slug: string | null;
    location_name: string | null;
    location_address: string | null;
    location_city: string | null;
    address_deferred: boolean;
    location_is_secret: boolean;
  };
  venue: { id: string; name: string | null; city: string | null; address: string | null } | null;
  pack: { id: string; name: string | null } | null;
  zone: { id: string; name: string | null } | null;
  requested_table_id: string | null;
  requested_table_name: string | null;
  assigned_table_id: string | null;
  assigned_table_name: string | null;
  placement_status: string | null;
  placement_adjustment: string | null;
  placement_adjustment_amount: number | null;
  guest_count: number | null;
  total_price: number | null;
  deposit: number | null;
  service_fee: number | null;
  management_fee: number | null;
  charged_total: number | null;
  fee_absorbed: boolean;
  minimum_spend: number | null;
  remaining_on_site: number | null;
  holder: { full_name: string | null; email: string | null };
  guests: TableReceiptGuest[];
  /** Précommande de bouteilles (D8) : brute, à lire par `parseReceiptPreorder` ; à régler sur place. */
  preorder?: unknown;
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Lit le reçu par preuve QR. Jamais d'exception : `null` = rien à montrer (mauvaise preuve, réseau). */
export async function fetchTableReceipt(
  client: RpcClient,
  reservationId: string,
  qr: string,
): Promise<TableReceipt | null> {
  if (!reservationId || !qr) return null;
  try {
    const { data, error } = await client.rpc('get_table_receipt', { p_reservation_id: reservationId, p_qr: qr });
    if (error || !data || typeof data !== 'object') return null;
    return data as TableReceipt;
  } catch {
    return null;
  }
}

export interface TableGuestPass {
  qr_code: string;
  guest_number: number;
  is_holder: boolean;
  scannable: boolean;
  entry_scanned: boolean;
  event: { title: string | null; start_at: string | null; timezone: string | null; city: string | null };
  pack_name: string | null;
}

export async function fetchTableGuestPass(client: RpcClient, qr: string): Promise<TableGuestPass | null> {
  if (!qr) return null;
  try {
    const { data, error } = await client.rpc('get_table_guest_pass', { p_qr: qr });
    if (error || !data || typeof data !== 'object') return null;
    return data as TableGuestPass;
  } catch {
    return null;
  }
}

/** Ce que l'écran dit du placement : `kind` choisit la phrase, `name` la table. */
export type PlacementView =
  | { kind: 'assigned'; name: string | null }
  | { kind: 'requested'; name: string | null }
  | { kind: 'on_arrival' }
  | { kind: 'none' };

export function placementView(r: Pick<TableReceipt,
  'assigned_table_id' | 'assigned_table_name' | 'requested_table_id' | 'requested_table_name' | 'placement_status'>): PlacementView {
  if (r.assigned_table_id) return { kind: 'assigned', name: r.assigned_table_name || null };
  // Le serveur écrit 'assign_on_arrival' (vip_set_table_placement, checkout) ; 'on_arrival' est gardé par tolérance.
  if (r.placement_status === 'assign_on_arrival' || r.placement_status === 'on_arrival') return { kind: 'on_arrival' };
  if (r.requested_table_id && r.placement_status !== 'rejected') return { kind: 'requested', name: r.requested_table_name || null };
  if (r.placement_status === 'rejected') return { kind: 'on_arrival' };
  return { kind: 'none' };
}

/** Surclassement offert / différence à régler sur place, ou rien. */
export function placementAdjustmentView(r: Pick<TableReceipt, 'placement_adjustment' | 'placement_adjustment_amount'>):
  | { kind: 'upgrade_free' }
  | { kind: 'pay_on_site'; amount: number }
  | null {
  if (r.placement_adjustment === 'upgrade_free') return { kind: 'upgrade_free' };
  if (r.placement_adjustment === 'pay_on_site' && typeof r.placement_adjustment_amount === 'number') {
    return { kind: 'pay_on_site', amount: r.placement_adjustment_amount };
  }
  return null;
}

/** Montant encaissé en ligne : ce que Stripe a prélevé si le serveur l'a figé, sinon acompte + frais de gestion. */
export function paidOnline(r: Pick<TableReceipt, 'charged_total' | 'deposit' | 'management_fee' | 'fee_absorbed' | 'payment_mode'>): number {
  if (r.payment_mode === 'on_site') return 0;
  if (typeof r.charged_total === 'number' && r.charged_total > 0) return r.charged_total;
  const fee = r.fee_absorbed ? 0 : (r.management_fee || 0);
  return Math.max((r.deposit || 0) + fee, 0);
}

/** Reste à régler au club : jamais négatif, jamais affiché pour rien. */
export function remainingOnSite(r: Pick<TableReceipt, 'remaining_on_site' | 'total_price' | 'deposit'>): number {
  if (typeof r.remaining_on_site === 'number') return Math.max(r.remaining_on_site, 0);
  return Math.max((r.total_price || 0) - (r.deposit || 0), 0);
}

/** Lien public d'un QR d'invité : n'ouvre que ce QR. `origin` = domaine public (publicUrl). */
export function guestPassPath(qr: string): string {
  return `/t/${encodeURIComponent(qr)}`;
}
export function guestPassUrl(origin: string, qr: string): string {
  return origin.replace(/\/+$/, '') + guestPassPath(qr);
}
export function whatsappShareHref(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`.trim())}`;
}

/** Remplace {event} / {holder} / {n} dans un modèle de phrase. */
export function fillTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Code d'un refus de create-table-checkout → clé i18n. `null` = pas de message propre, on garde celui du serveur. */
export function checkoutErrorKey(code: unknown): string | null {
  switch (code) {
    case 'invalid_pack': return 'tblc.err.invalidPack';
    case 'invalid_guest_count': return 'tblc.err.invalidGuestCount';
    case 'invalid_preorder': return 'tblb.err.invalidPreorder';
    case 'promo_not_applicable_to_deposit': return 'tblc.err.promoNotApplicable';
    case 'table_taken':
    case 'table_unavailable': return 'tblc.err.tableTaken';
    default: return null;
  }
}

/** Les refus qui veulent dire « la table / la zone n'est plus là » : seuls ceux-là proposent la liste d'attente. */
export function isAvailabilityRefusal(code: unknown, message: string | null | undefined): boolean {
  if (code === 'table_taken' || code === 'table_unavailable') return true;
  if (code) return false;
  return /compl[eè]t|full|agotad|sold out|no longer|plus disponible|ya no/i.test(message || '');
}
