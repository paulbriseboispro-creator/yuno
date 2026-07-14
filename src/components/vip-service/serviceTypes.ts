import type { VipConsumption, VipReservation } from '@/types';

// ─── Modèle de service ────────────────────────────────────────────────────────
// Une seule sémantique pour tout l'outil serveur :
//   Commandes (vip_table_orders)  = ce que le bar doit préparer.
//   Consos    (vip_consumptions)  = le grand livre de ce qui a été servi.
// Une commande n'impacte le crédit du client QUE lorsqu'elle est servie
// (copie dans vip_consumptions), jamais avant.

export type OrderStatus = 'preorder' | 'pending' | 'confirmed' | 'preparing' | 'served' | 'cancelled';

export interface ServiceOrderItem {
  id: string;
  menuItemId: string;
  name: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  isIncluded: boolean;
  parentOrderItemId: string | null;
}

export interface ServiceOrder {
  id: string;
  reservationId: string;
  userId: string | null;
  status: OrderStatus;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  servedAt: string | null;
  items: ServiceOrderItem[];
}

/** Réservation enrichie des colonnes de placement que l'ancien type ignorait. */
export interface ServiceReservation extends VipReservation {
  placementStatus: 'none' | 'requested' | 'approved' | 'modified' | 'rejected' | 'assign_on_arrival' | string;
  requestedTableId: string | null;
  requestedTableName?: string;
}

export interface ServiceMoment {
  id: string;
  reservationId: string | null;
  kind: string;
  label: string | null;
  scheduledAt: string | null;
  status: 'scheduled' | 'done' | 'cancelled';
}

export interface ServiceMenuItem {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  volumeCl: number | null;
  price: number;
  imageUrl: string | null;
  needsMixer: boolean;
  maxMixers: number;
  position: number;
}

/** Bouton rapide owner (vip_quick_items) : pas de menu_item_id → servi direct uniquement. */
export interface ServiceQuickItem {
  id: string;
  name: string;
  itemType: 'bottle' | 'extra' | 'service';
  defaultPrice: number;
}

// ─── Panier du composeur de commande ─────────────────────────────────────────

export interface CartMixer {
  item: ServiceMenuItem;
  quantity: number;
}

export interface CartLine {
  /** Item du menu (commande bar possible) OU bouton rapide (servi direct only). */
  menuItem?: ServiceMenuItem;
  quickItem?: ServiceQuickItem;
  quantity: number;
  mixers: CartMixer[];
}

export const cartLineName = (l: CartLine): string => l.menuItem?.name || l.quickItem?.name || '';
export const cartLinePrice = (l: CartLine): number => l.menuItem?.price ?? l.quickItem?.defaultPrice ?? 0;
export const cartTotal = (lines: CartLine[]): number =>
  lines.reduce(
    (sum, l) =>
      sum + cartLinePrice(l) * l.quantity + l.mixers.reduce((m, x) => m + x.item.price * x.quantity, 0),
    0
  );

// ─── Agrégats par réservation ────────────────────────────────────────────────

export interface TableServiceInfo {
  consumed: number;
  budget: number;
  minimum: number;
  creditLeft: number;
  extra: number;
  minReached: boolean;
  pendingOrders: number;
  barOrders: number;
  preorders: number;
  toSeat: boolean;
  placementRequested: boolean;
}

export function buildServiceInfo(
  r: ServiceReservation,
  consumptions: VipConsumption[],
  orders: ServiceOrder[]
): TableServiceInfo {
  const consumed = consumptions.reduce((s, c) => s + c.totalPrice, 0);
  const budget = r.totalPrice || 0;
  const minimum = r.minimumSpend || 0;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const barOrders = orders.filter(o => o.status === 'confirmed' || o.status === 'preparing').length;
  const preorders = orders.filter(o => o.status === 'preorder').length;
  return {
    consumed,
    budget,
    minimum,
    creditLeft: Math.max(0, budget - consumed),
    extra: Math.max(0, consumed - budget),
    minReached: minimum <= 0 || consumed >= minimum,
    pendingOrders,
    barOrders,
    preorders,
    toSeat: !!r.hasArrived && r.vipStatus === 'waiting',
    placementRequested: r.placementStatus === 'requested' && !r.assignedTableId,
  };
}

/** État visuel d'une table du plan pendant le service. */
export type TableVisualState =
  | 'free'
  | 'requested'      // une résa attend cette table précise
  | 'seated-under'   // installée, minimum pas atteint
  | 'seated-ok'      // installée, minimum atteint (ou pas de minimum)
  | 'seated-extra';  // installée, conso au-delà du crédit prépayé

export const TABLE_STATE_COLORS: Record<TableVisualState, { fill: string; stroke: string; text: string }> = {
  free: { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.28)', text: 'rgba(255,255,255,0.55)' },
  requested: { fill: 'rgba(232,25,44,0.16)', stroke: '#E8192C', text: '#FCA5A5' },
  'seated-under': { fill: 'rgba(245,158,11,0.30)', stroke: 'rgb(245,158,11)', text: '#fff' },
  'seated-ok': { fill: 'rgba(16,185,129,0.35)', stroke: 'rgb(16,185,129)', text: '#fff' },
  'seated-extra': { fill: 'rgba(231,193,90,0.35)', stroke: '#E7C15A', text: '#fff' },
};

export function tableVisualState(
  reservation: ServiceReservation | undefined,
  info: TableServiceInfo | undefined,
  requestedBy: ServiceReservation | undefined
): TableVisualState {
  if (!reservation) return requestedBy ? 'requested' : 'free';
  if (info && info.extra > 0) return 'seated-extra';
  if (info && !info.minReached) return 'seated-under';
  return 'seated-ok';
}

// ─── Petits helpers d'affichage ──────────────────────────────────────────────

export const fmtEuro = (n: number): string => `${Math.round(n).toLocaleString('fr-FR')}€`;

export const timeHM = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const minutesSince = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
};

/** "12 min" / "1 h 05" — âge compact pour timers de service. */
export const fmtAge = (iso: string | null | undefined): string => {
  const m = minutesSince(iso);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

const BOTTLE_CATEGORIES = new Set(['champagne', 'vodka', 'whisky', 'gin', 'rum', 'tequila', 'cognac', 'wine', 'bottle']);

export type ComposerSection = 'bottles' | 'softs' | 'extras';

export function menuSection(category: string): ComposerSection {
  if (BOTTLE_CATEGORIES.has(category)) return 'bottles';
  if (category === 'soft' || category === 'mixer') return 'softs';
  return 'extras';
}

/** item_type de vip_consumptions dérivé de la catégorie menu (parité vue analytics). */
export function consumptionItemType(category: string | null): 'bottle' | 'extra' | 'service' {
  if (!category) return 'bottle';
  if (BOTTLE_CATEGORIES.has(category)) return 'bottle';
  if (category === 'mixer' || category === 'soft') return 'extra';
  return 'service';
}

// ─── Tri "qui a besoin de moi" pour la liste des tables ─────────────────────

export function reservationPriority(r: ServiceReservation, info: TableServiceInfo): number {
  if (info.toSeat) return 0;
  if (info.placementRequested && r.hasArrived) return 1;
  if (info.pendingOrders > 0) return 2;
  if (info.preorders > 0 && r.hasArrived) return 3;
  if (r.vipStatus === 'active' || r.vipStatus === 'placed') return 4;
  if (r.vipStatus === 'waiting') return 5;
  return 6;
}
