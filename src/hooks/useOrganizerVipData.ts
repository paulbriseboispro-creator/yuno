import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  groupVipOrderItems, mapVipConsumption, mapVipOrder, mapVipReservation,
  type OwnerVipReservation, type OwnerVipConsumption, type OwnerVipOrder, type OwnerVipOrderItem, type VipEvent,
  type VipConsumptionRow, type VipOrderItemRow, type VipOrderRow, type VipReservationRow,
} from './useOwnerVipData';
import { orgEventsOr } from '@/lib/coorg';

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
        .select('id, title, start_at, end_at, timezone, location_name')
        .or(orgEventsOr(organizerUserId))
        .eq('tables_enabled', true)
        .order('start_at', { ascending: false });

      const evs: VipEvent[] = (eventsData || []).map(e => ({ id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at, timezone: e.timezone, locationName: e.location_name }));
      setEvents(evs);
      const eventIds = evs.map(e => e.id);
      if (eventIds.length === 0) { setReservations([]); setConsumptions([]); setOrders([]); return; }

      const { data: resData } = await supabase
        .from('table_reservations')
        .select(`
          id, full_name, user_email, phone, guest_count, deposit, total_price, management_fee, fee_absorbed,
          service_fee, refund_amount, stripe_payment_intent_id, stripe_session_id,
          minimum_spend, vip_status, zone_id, assigned_table_id,
          created_at, checked_in_at, placed_at, finished_at, event_id,
          placement_status, requested_table_id, placement_note,
          table_zones(name, color),
          events(title)
        `)
        .eq('status', 'paid')
        .in('event_id', eventIds)
        .order('created_at', { ascending: false });

      const mapped = ((resData ?? []) as unknown as VipReservationRow[]).map(mapVipReservation);
      setReservations(mapped);

      const resIds = mapped.map(r => r.id);
      if (resIds.length === 0) { setConsumptions([]); setOrders([]); return; }

      // Consommations / commandes : notions de club (bar). Sur une soirée sans
      // club la RLS ne renvoie rien — la liste reste vide, jamais en erreur.
      const [{ data: consData }, { data: ordersData }] = await Promise.all([
        supabase.from('vip_consumptions').select('*').in('table_reservation_id', resIds).order('served_at', { ascending: false }),
        supabase.from('vip_table_orders').select('id, table_reservation_id, status, total_amount, created_at, confirmed_at, served_at, notes').in('table_reservation_id', resIds).neq('status', 'cancelled').order('created_at', { ascending: true }),
      ]);

      setConsumptions(((consData ?? []) as unknown as VipConsumptionRow[]).map(mapVipConsumption));

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
