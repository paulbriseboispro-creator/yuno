import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { OwnerVipReservation, OwnerVipConsumption, OwnerVipOrder, OwnerVipOrderItem, VipEvent } from './useOwnerVipData';

/**
 * Données du service VIP vues par un ORGANISATEUR : les soirées qu'il mène (ou
 * co-organise) avec tables activées, leurs réservations payées, consommations
 * et commandes. Miroir de useOwnerVipData, scopé par l'organisateur au lieu du
 * club — un organisateur seul n'a pas de venue, le périmètre est l'ensemble
 * de ses soirées (RLS « Organizers can view their event reservations »).
 */
export function useOrganizerVipData(organizerUserId: string | null | undefined) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<VipEvent[]>([]);
  const [reservations, setReservations] = useState<OwnerVipReservation[]>([]);
  const [consumptions, setConsumptions] = useState<OwnerVipConsumption[]>([]);
  const [orders, setOrders] = useState<OwnerVipOrder[]>([]);

  const fetchData = useCallback(async () => {
    if (!organizerUserId) return;
    setLoading(true);
    try {
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, start_at, end_at')
        .or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`)
        .eq('tables_enabled', true)
        .order('start_at', { ascending: false });

      const evs: VipEvent[] = (eventsData || []).map(e => ({ id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at }));
      setEvents(evs);
      const eventIds = evs.map(e => e.id);
      if (eventIds.length === 0) { setReservations([]); setConsumptions([]); setOrders([]); return; }

      const { data: resData } = await supabase
        .from('table_reservations')
        .select(`
          id, full_name, user_email, phone, guest_count, deposit, total_price,
          minimum_spend, vip_status, zone_id, assigned_table_id,
          created_at, checked_in_at, placed_at, finished_at, event_id,
          placement_status, requested_table_id, placement_note,
          table_zones(name, color),
          events(title)
        `)
        .eq('status', 'paid')
        .in('event_id', eventIds)
        .order('created_at', { ascending: false });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      const resIds = mapped.map(r => r.id);
      if (resIds.length === 0) { setConsumptions([]); setOrders([]); return; }

      // Consommations / commandes : notions de club (bar). Sur une soirée sans
      // club la RLS ne renvoie rien — la liste reste vide, jamais en erreur.
      const [{ data: consData }, { data: ordersData }] = await Promise.all([
        supabase.from('vip_consumptions').select('*').in('table_reservation_id', resIds).order('served_at', { ascending: false }),
        supabase.from('vip_table_orders').select('id, table_reservation_id, status, total_amount, created_at, confirmed_at, served_at, notes').in('table_reservation_id', resIds).neq('status', 'cancelled').order('created_at', { ascending: true }),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setConsumptions((consData || []).map((c: any) => ({
        id: c.id, itemName: c.item_name, itemType: c.item_type, quantity: c.quantity,
        unitPrice: c.unit_price, totalPrice: c.total_price, servedAt: c.served_at, reservationId: c.table_reservation_id,
      })));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderIds = (ordersData || []).map((o: any) => o.id);
      const itemsByOrder = new Map<string, OwnerVipOrderItem[]>();
      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('vip_table_order_items')
          .select('order_id, quantity, unit_price, vip_menu_items(name)')
          .in('order_id', orderIds);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (itemsData || []).forEach((it: any) => {
          const arr = itemsByOrder.get(it.order_id) || [];
          arr.push({ name: it.vip_menu_items?.name || 'Bouteille', quantity: it.quantity, unitPrice: it.unit_price });
          itemsByOrder.set(it.order_id, arr);
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setOrders((ordersData || []).map((o: any) => ({
        id: o.id, reservationId: o.table_reservation_id, status: o.status, totalAmount: o.total_amount || 0,
        createdAt: o.created_at, confirmedAt: o.confirmed_at, servedAt: o.served_at, notes: o.notes,
        items: itemsByOrder.get(o.id) || [],
      })));
    } catch (error) {
      console.error('Error fetching organizer VIP data:', error);
    } finally {
      setLoading(false);
    }
  }, [organizerUserId]);

  useEffect(() => {
    if (organizerUserId) fetchData();
  }, [organizerUserId, fetchData]);

  return { loading, events, reservations, consumptions, orders, refresh: fetchData };
}
