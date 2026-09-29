import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from './useVenueContext';
import { alreadyRefundedCents, remainingRefundableCents, type SaleAmounts } from '@/lib/saleRefund';

/** Ce que le service VIP sait du remboursement d'une réservation. */
export function vipRefundFields(r: SaleAmounts & { stripe_payment_intent_id?: string | null; stripe_session_id?: string | null }) {
  return {
    refundedAmount: alreadyRefundedCents(r) / 100,
    refundRemaining: remainingRefundableCents('table_reservation', r) / 100,
    hasOnlinePayment: !!(r.stripe_payment_intent_id || r.stripe_session_id),
  };
}

export interface OwnerVipReservation {
  id: string;
  fullName: string;
  userEmail: string;
  phone?: string;
  guestCount: number;
  deposit: number;
  /** Frais de gestion Yuno absorbés par le club (0 sinon) : sortent de sa part de l'acompte. */
  absorbedFee: number;
  /** Déjà rendu au client (remboursements partiels précédents). */
  refundedAmount: number;
  /** Reste remboursable en ligne — même règle que le serveur (`refundCapCents`). */
  refundRemaining: number;
  /** L'acompte a été payé en ligne via Yuno (une table « à régler sur place » n'a rien à rembourser ici). */
  hasOnlinePayment: boolean;
  totalPrice: number;
  minimumSpend: number;
  vipStatus: 'waiting' | 'placed' | 'active' | 'finished' | 'no_show' | 'denied';
  zoneName: string;
  zoneColor: string;
  zoneId: string;
  assignedTableId?: string;
  createdAt: string;
  checkedInAt?: string;
  placedAt?: string;
  finishedAt?: string;
  eventId: string;
  eventTitle?: string;
  placementStatus?: string;
  requestedTableId?: string;
  placementNote?: string;
}

export interface OwnerVipConsumption {
  id: string;
  itemName: string;
  itemType: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  servedAt: string;
  reservationId: string;
}

export interface OwnerVipOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface OwnerVipOrder {
  id: string;
  reservationId: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  confirmedAt?: string;
  servedAt?: string;
  notes?: string | null;
  items: OwnerVipOrderItem[];
}

/** Ligne `table_reservations` telle que les deux services VIP (club, orga) la lisent. */
export interface VipReservationRow extends SaleAmounts {
  id: string;
  full_name: string | null;
  user_email: string | null;
  phone: string | null;
  guest_count: number | null;
  minimum_spend: number | null;
  vip_status: OwnerVipReservation['vipStatus'] | null;
  zone_id: string;
  assigned_table_id: string | null;
  created_at: string;
  checked_in_at: string | null;
  placed_at: string | null;
  finished_at: string | null;
  event_id: string;
  placement_status: string | null;
  requested_table_id: string | null;
  placement_note: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_session_id?: string | null;
  table_zones: { name: string | null; color: string | null } | null;
  events: { title: string | null } | null;
}

export function mapVipReservation(r: VipReservationRow): OwnerVipReservation {
  return {
    id: r.id,
    fullName: r.full_name || 'Guest',
    userEmail: r.user_email || '',
    phone: r.phone ?? undefined,
    guestCount: r.guest_count || 1,
    deposit: Number(r.deposit) || 0,
    absorbedFee: r.fee_absorbed ? Number(r.management_fee || 0) : 0,
    ...vipRefundFields(r),
    totalPrice: Number(r.total_price) || 0,
    minimumSpend: Number(r.minimum_spend) || 0,
    vipStatus: r.vip_status || 'waiting',
    zoneName: r.table_zones?.name || '',
    zoneColor: r.table_zones?.color || '#666',
    zoneId: r.zone_id,
    assignedTableId: r.assigned_table_id ?? undefined,
    createdAt: r.created_at,
    checkedInAt: r.checked_in_at ?? undefined,
    placedAt: r.placed_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    eventId: r.event_id,
    eventTitle: r.events?.title ?? undefined,
    placementStatus: r.placement_status ?? undefined,
    requestedTableId: r.requested_table_id ?? undefined,
    placementNote: r.placement_note ?? undefined,
  };
}

export interface VipConsumptionRow {
  id: string; item_name: string; item_type: string; quantity: number;
  unit_price: number; total_price: number; served_at: string; table_reservation_id: string;
}

export function mapVipConsumption(c: VipConsumptionRow): OwnerVipConsumption {
  return {
    id: c.id, itemName: c.item_name, itemType: c.item_type, quantity: c.quantity,
    unitPrice: c.unit_price, totalPrice: c.total_price, servedAt: c.served_at, reservationId: c.table_reservation_id,
  };
}

export interface VipOrderRow {
  id: string; table_reservation_id: string; status: string; total_amount: number | null;
  created_at: string; confirmed_at: string | null; served_at: string | null; notes: string | null;
}

export interface VipOrderItemRow {
  order_id: string; quantity: number; unit_price: number; vip_menu_items: { name: string | null } | null;
}

/** Lignes de commande regroupées par commande (bouteilles pré-commandées / commandées). */
export function groupVipOrderItems(items: VipOrderItemRow[]): Map<string, OwnerVipOrderItem[]> {
  const byOrder = new Map<string, OwnerVipOrderItem[]>();
  for (const it of items) {
    const arr = byOrder.get(it.order_id) || [];
    arr.push({ name: it.vip_menu_items?.name || 'Bouteille', quantity: it.quantity, unitPrice: it.unit_price });
    byOrder.set(it.order_id, arr);
  }
  return byOrder;
}

export function mapVipOrder(o: VipOrderRow, itemsByOrder: Map<string, OwnerVipOrderItem[]>): OwnerVipOrder {
  return {
    id: o.id, reservationId: o.table_reservation_id, status: o.status, totalAmount: o.total_amount || 0,
    createdAt: o.created_at, confirmedAt: o.confirmed_at ?? undefined, servedAt: o.served_at ?? undefined,
    notes: o.notes, items: itemsByOrder.get(o.id) || [],
  };
}

export interface VipEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone?: string | null;
  /** Lieu affiché (soirée d'organisateur sans club Yuno). */
  locationName?: string | null;
}

export function useOwnerVipData() {
  const { venueId, loading: venueLoading } = useVenueContext();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<VipEvent[]>([]);
  const [reservations, setReservations] = useState<OwnerVipReservation[]>([]);
  const [consumptions, setConsumptions] = useState<OwnerVipConsumption[]>([]);
  const [orders, setOrders] = useState<OwnerVipOrder[]>([]);

  const fetchData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);

    try {
      // Fetch all events that have table reservations for this venue.
      // Co-soirée org-led : le club est partner_venue_id — inclure ces events
      // sinon le service VIP du club ne voit pas la soirée co-organisée.
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, venue_id')
        .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`)
        .eq('tables_enabled', true)
        .order('start_at', { ascending: false });

      setEvents((eventsData || []).map(e => ({
        id: e.id,
        title: e.title,
        startAt: e.start_at,
        endAt: e.end_at,
      })));

      // Fetch ALL paid reservations for this venue (no limit)
      const { data: resData } = await supabase
        .from('table_reservations')
        .select(`
          id, full_name, user_email, phone, guest_count, deposit, total_price, management_fee, fee_absorbed,
          service_fee, refund_amount, stripe_payment_intent_id, stripe_session_id,
          minimum_spend, vip_status, zone_id, assigned_table_id,
          created_at, checked_in_at, placed_at, finished_at, event_id,
          placement_status, requested_table_id, placement_note,
          table_zones!inner(name, color, venue_id),
          events(title)
        `)
        .eq('status', 'paid')
        .eq('table_zones.venue_id', venueId)
        .order('created_at', { ascending: false });

      const mapped = ((resData ?? []) as unknown as VipReservationRow[]).map(mapVipReservation);

      setReservations(mapped);

      // Fetch all consumptions
      const resIds = mapped.map(r => r.id);
      if (resIds.length > 0) {
        const { data: consData } = await supabase
          .from('vip_consumptions')
          .select('*')
          .in('table_reservation_id', resIds)
          .order('served_at', { ascending: false });

        setConsumptions(((consData ?? []) as unknown as VipConsumptionRow[]).map(mapVipConsumption));
        // Fetch vip_table_orders (+ leurs lignes) : sert au time-analysis ET à l'affichage
        // des bouteilles pré-commandées / commandées dans le détail d'une réservation.
        const { data: ordersData } = await supabase
          .from('vip_table_orders')
          .select('id, table_reservation_id, status, total_amount, created_at, confirmed_at, served_at, notes')
          .in('table_reservation_id', resIds)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true });

        const orderRows = (ordersData ?? []) as unknown as VipOrderRow[];
        const orderIds = orderRows.map((o) => o.id);
        let itemsByOrder = new Map<string, OwnerVipOrderItem[]>();
        if (orderIds.length > 0) {
          const { data: itemsData } = await supabase
            .from('vip_table_order_items')
            .select('order_id, quantity, unit_price, vip_menu_items(name)')
            .in('order_id', orderIds);
          itemsByOrder = groupVipOrderItems((itemsData ?? []) as unknown as VipOrderItemRow[]);
        }

        setOrders(orderRows.map((o) => mapVipOrder(o, itemsByOrder)));
      } else {
        setConsumptions([]);
        setOrders([]);
      }
    } catch (error) {
      console.error('Error fetching VIP data:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) fetchData();
  }, [venueId, fetchData]);

  return {
    venueId,
    loading: loading || venueLoading,
    events,
    reservations,
    consumptions,
    orders,
    refresh: fetchData,
  };
}
