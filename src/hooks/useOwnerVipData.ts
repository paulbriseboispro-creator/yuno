import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from './useVenueContext';

export interface OwnerVipReservation {
  id: string;
  fullName: string;
  userEmail: string;
  phone?: string;
  guestCount: number;
  deposit: number;
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

export interface VipEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
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
      // Fetch all events that have table reservations for this venue
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, venue_id')
        .eq('venue_id', venueId)
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
          id, full_name, user_email, phone, guest_count, deposit, total_price,
          minimum_spend, vip_status, zone_id, assigned_table_id,
          created_at, checked_in_at, placed_at, finished_at, event_id,
          placement_status, requested_table_id, placement_note,
          table_zones!inner(name, color, venue_id),
          events(title)
        `)
        .eq('status', 'paid')
        .eq('table_zones.venue_id', venueId)
        .order('created_at', { ascending: false });

      const mapped: OwnerVipReservation[] = (resData || []).map((r: any) => ({
        id: r.id,
        fullName: r.full_name || 'Guest',
        userEmail: r.user_email || '',
        phone: r.phone,
        guestCount: r.guest_count || 1,
        deposit: r.deposit || 0,
        totalPrice: r.total_price || 0,
        minimumSpend: r.minimum_spend || 0,
        vipStatus: r.vip_status || 'waiting',
        zoneName: r.table_zones?.name || '',
        zoneColor: r.table_zones?.color || '#666',
        zoneId: r.zone_id,
        assignedTableId: r.assigned_table_id,
        createdAt: r.created_at,
        checkedInAt: r.checked_in_at,
        placedAt: r.placed_at,
        finishedAt: r.finished_at,
        eventId: r.event_id,
        eventTitle: r.events?.title,
        placementStatus: r.placement_status,
        requestedTableId: r.requested_table_id,
        placementNote: r.placement_note,
      }));

      setReservations(mapped);

      // Fetch all consumptions
      const resIds = mapped.map(r => r.id);
      if (resIds.length > 0) {
        const { data: consData } = await supabase
          .from('vip_consumptions')
          .select('*')
          .in('table_reservation_id', resIds)
          .order('served_at', { ascending: false });

        setConsumptions((consData || []).map((c: any) => ({
          id: c.id,
          itemName: c.item_name,
          itemType: c.item_type,
          quantity: c.quantity,
          unitPrice: c.unit_price,
          totalPrice: c.total_price,
          servedAt: c.served_at,
          reservationId: c.table_reservation_id,
        })));
        // Fetch vip_table_orders (+ leurs lignes) : sert au time-analysis ET à l'affichage
        // des bouteilles pré-commandées / commandées dans le détail d'une réservation.
        const { data: ordersData } = await supabase
          .from('vip_table_orders')
          .select('id, table_reservation_id, status, total_amount, created_at, confirmed_at, served_at, notes')
          .in('table_reservation_id', resIds)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true });

        const orderIds = (ordersData || []).map((o: any) => o.id);
        const itemsByOrder = new Map<string, OwnerVipOrderItem[]>();
        if (orderIds.length > 0) {
          const { data: itemsData } = await supabase
            .from('vip_table_order_items')
            .select('order_id, quantity, unit_price, vip_menu_items(name)')
            .in('order_id', orderIds);
          (itemsData || []).forEach((it: any) => {
            const arr = itemsByOrder.get(it.order_id) || [];
            arr.push({
              name: it.vip_menu_items?.name || 'Bouteille',
              quantity: it.quantity,
              unitPrice: it.unit_price,
            });
            itemsByOrder.set(it.order_id, arr);
          });
        }

        setOrders((ordersData || []).map((o: any) => ({
          id: o.id,
          reservationId: o.table_reservation_id,
          status: o.status,
          totalAmount: o.total_amount || 0,
          createdAt: o.created_at,
          confirmedAt: o.confirmed_at,
          servedAt: o.served_at,
          notes: o.notes,
          items: itemsByOrder.get(o.id) || [],
        })));
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
