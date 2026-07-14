import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { VipConsumption, VenueFloorPlan } from '@/types';
import { useStaffVenue } from './useStaffVenue';
import {
  ServiceReservation, ServiceOrder, ServiceMenuItem, ServiceQuickItem, ServiceMoment,
  CartLine, TableServiceInfo, buildServiceInfo, cartTotal, cartLinePrice,
  consumptionItemType, reservationPriority,
} from '@/components/vip-service/serviceTypes';

// ─────────────────────────────────────────────────────────────────────────────
// useVipNight — le hook unique de l'outil serveur VIP.
//
// Modèle : Commandes (vip_table_orders) = file du bar ; Consos
// (vip_consumptions) = grand livre servi. Le crédit client ne bouge qu'à
// l'insertion d'une conso ("servi"), jamais à la commande.
//
// Écritures réservation : un pur vip_host n'a le droit qu'aux colonnes de
// service (trigger enforce_vip_host_reservation_columns). Les champs de revue
// de placement font partie de l'allow-list depuis 20260714190000 ; en cas de
// base pas encore migrée on retente sans ces champs (42501) pour ne jamais
// bloquer l'installation d'un client.
// ─────────────────────────────────────────────────────────────────────────────

interface NightData {
  reservations: ServiceReservation[];
  consumptions: Map<string, VipConsumption[]>;
  orders: ServiceOrder[];
  moments: ServiceMoment[];
  floorPlan: VenueFloorPlan | null;
  activeEvent: { id: string; title: string; startAt: string; endAt: string } | null;
  loading: boolean;
}

const EMPTY: NightData = {
  reservations: [],
  consumptions: new Map(),
  orders: [],
  moments: [],
  floorPlan: null,
  activeEvent: null,
  loading: true,
};

const mapFloorPlan = (row: any): VenueFloorPlan | null =>
  row
    ? {
        id: row.id,
        venueId: row.venue_id,
        backgroundImageUrl: row.background_image_url,
        layout: row.layout as VenueFloorPlan['layout'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

const isColumnGuardError = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === '42501';

export function useVipNight() {
  const { venueId, loading: venueLoading } = useStaffVenue();
  const [data, setData] = useState<NightData>(EMPTY);
  const [menuItems, setMenuItems] = useState<ServiceMenuItem[]>([]);
  const [quickItems, setQuickItems] = useState<ServiceQuickItem[]>([]);

  // Santé temps réel : socket down ou device offline → données potentiellement
  // périmées, écritures bloquées par l'UI.
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const wasConnectedRef = useRef(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ─── Lecture ────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!venueId) return;
    try {
      const now = new Date();
      // Soirée active : démarre dans les 6 h ou en cours. Co-soirée menée par un
      // organisateur : le club est partner_venue_id (venue_id peut être NULL).
      const { data: events } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, venue_id')
        .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`)
        .eq('is_active', true)
        .lte('start_at', new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString())
        .gte('end_at', now.toISOString())
        .order('start_at', { ascending: true })
        .limit(1);

      const ev = events?.[0];
      if (!ev) {
        // Pas de soirée : on charge quand même le plan venue-level (filtre
        // event_id IS NULL — un club avec co-events possède aussi des plans
        // event-scoped et maybeSingle() 406 sinon).
        const { data: planRow } = await supabase
          .from('venue_floor_plans')
          .select('*')
          .eq('venue_id', venueId)
          .is('event_id', null)
          .maybeSingle();
        setData({ ...EMPTY, floorPlan: mapFloorPlan(planRow), loading: false });
        return;
      }

      const activeEvent = { id: ev.id, title: ev.title, startAt: ev.start_at, endAt: ev.end_at };

      const [resQ, planEventQ, ordersQ, momentsQ] = await Promise.all([
        supabase
          .from('table_reservations')
          .select(
            `id, zone_id, event_id, user_id, user_email, full_name, phone,
             guest_count, deposit, total_price, minimum_spend, status, vip_status,
             paid_at, placed_at, placed_by, assigned_table_id, finished_at,
             qr_code, created_at, checked_in_at, requested_table_id, placement_status,
             table_zones!inner(name, color, venue_id)`
          )
          .eq('status', 'paid')
          .eq('event_id', ev.id)
          .eq('table_zones.venue_id', venueId),
        supabase.from('venue_floor_plans').select('*').eq('event_id', ev.id).maybeSingle(),
        supabase
          .from('vip_table_orders')
          .select(
            `id, table_reservation_id, user_id, status, total_amount, notes,
             created_at, confirmed_at, served_at,
             vip_table_order_items(id, menu_item_id, quantity, unit_price, is_included, parent_order_item_id,
               vip_menu_items(name, category)),
             table_reservations!inner(event_id)`
          )
          .eq('venue_id', venueId)
          .eq('table_reservations.event_id', ev.id)
          .in('status', ['preorder', 'pending', 'confirmed', 'preparing', 'served'])
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('vip_service_moments')
          .select('id, table_reservation_id, kind, label, scheduled_at, status')
          .eq('venue_id', venueId)
          .eq('event_id', ev.id)
          .neq('status', 'cancelled')
          .order('scheduled_at', { ascending: true }),
      ]);

      // Plan : event-scoped d'abord, venue-level en fallback — même résolution
      // que la page de réservation publique (le host place sur la salle que le
      // client a réservée).
      let planRow = planEventQ.data;
      if (!planRow) {
        planRow = (
          await supabase
            .from('venue_floor_plans')
            .select('*')
            .eq('venue_id', venueId)
            .is('event_id', null)
            .maybeSingle()
        ).data;
      }
      const floorPlan = mapFloorPlan(planRow);

      const tableNames = new Map<string, string>();
      (floorPlan?.layout?.tables || []).forEach((t: any) => tableNames.set(t.id, t.name));

      const reservations: ServiceReservation[] = (resQ.data || []).map((r: any) => ({
        id: r.id,
        zoneId: r.zone_id,
        zoneName: r.table_zones?.name || '',
        zoneColor: r.table_zones?.color || '#666',
        eventId: r.event_id,
        userId: r.user_id,
        userEmail: r.user_email,
        fullName: r.full_name || r.user_email?.split('@')[0] || 'Guest',
        phone: r.phone,
        guestCount: r.guest_count || 1,
        deposit: r.deposit || 0,
        totalPrice: r.total_price || 0,
        minimumSpend: r.minimum_spend || 0,
        status: r.status,
        vipStatus: r.vip_status || 'waiting',
        paidAt: r.paid_at,
        placedAt: r.placed_at,
        placedBy: r.placed_by,
        assignedTableId: r.assigned_table_id,
        assignedTableName: r.assigned_table_id ? tableNames.get(r.assigned_table_id) : undefined,
        finishedAt: r.finished_at,
        qrCode: r.qr_code,
        createdAt: r.created_at,
        checkedInAt: r.checked_in_at,
        hasArrived: r.checked_in_at !== null || ['placed', 'active', 'finished'].includes(r.vip_status),
        placementStatus: r.placement_status || 'none',
        requestedTableId: r.requested_table_id,
        requestedTableName: r.requested_table_id ? tableNames.get(r.requested_table_id) : undefined,
      }));

      // Grand livre de la soirée. Filtré par résa (les colonnes venue/event sont
      // aussi présentes, mais le filtre par résa reste exact même pour les rares
      // lignes historiques sans event_id).
      const consumptionsMap = new Map<string, VipConsumption[]>();
      const ids = reservations.map(r => r.id);
      if (ids.length > 0) {
        const { data: consRows } = await supabase
          .from('vip_consumptions')
          .select('*')
          .in('table_reservation_id', ids)
          .order('served_at', { ascending: false });
        (consRows || []).forEach((c: any) => {
          const mapped: VipConsumption = {
            id: c.id,
            tableReservationId: c.table_reservation_id,
            venueId: c.venue_id,
            eventId: c.event_id,
            itemName: c.item_name,
            itemType: c.item_type,
            quantity: c.quantity,
            unitPrice: c.unit_price,
            totalPrice: c.total_price,
            servedBy: c.served_by,
            staffId: c.staff_id,
            servedAt: c.served_at,
            notes: c.notes,
            createdAt: c.created_at,
          };
          const arr = consumptionsMap.get(c.table_reservation_id) || [];
          consumptionsMap.set(c.table_reservation_id, [...arr, mapped]);
        });
      }

      const orders: ServiceOrder[] = (ordersQ.data || []).map((o: any) => ({
        id: o.id,
        reservationId: o.table_reservation_id,
        userId: o.user_id,
        status: o.status,
        totalAmount: o.total_amount || 0,
        notes: o.notes,
        createdAt: o.created_at,
        confirmedAt: o.confirmed_at,
        servedAt: o.served_at,
        items: (o.vip_table_order_items || []).map((it: any) => ({
          id: it.id,
          menuItemId: it.menu_item_id,
          name: it.vip_menu_items?.name || '—',
          category: it.vip_menu_items?.category || null,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          isIncluded: it.is_included,
          parentOrderItemId: it.parent_order_item_id,
        })),
      }));

      const moments: ServiceMoment[] = ((momentsQ.data as any[]) || []).map(m => ({
        id: m.id,
        reservationId: m.table_reservation_id,
        kind: m.kind,
        label: m.label,
        scheduledAt: m.scheduled_at,
        status: m.status,
      }));

      setData({ reservations, consumptions: consumptionsMap, orders, moments, floorPlan, activeEvent, loading: false });
    } catch (error) {
      console.error('Error fetching VIP night data:', error);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [venueId]);

  // Refetch débouncé : une rafale d'événements realtime → un seul fetch.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => fetchData(), 300);
  }, [fetchData]);

  // Carte + boutons rapides : par venue, indépendants du cycle realtime.
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      const [menuQ, quickQ] = await Promise.all([
        supabase
          .from('vip_menu_items')
          .select('id, name, category, brand, volume_cl, price, image_url, needs_mixer, max_mixers, position')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .order('position', { ascending: true }),
        supabase
          .from('vip_quick_items')
          .select('id, name, item_type, default_price, position')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .order('position', { ascending: true }),
      ]);
      if (cancelled) return;
      setMenuItems(
        (menuQ.data || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          brand: m.brand,
          volumeCl: m.volume_cl,
          price: m.price,
          imageUrl: m.image_url,
          needsMixer: !!m.needs_mixer,
          maxMixers: m.max_mixers || 1,
          position: m.position || 0,
        }))
      );
      setQuickItems(
        (quickQ.data || []).map((q: any) => ({
          id: q.id,
          name: q.name,
          itemType: q.item_type,
          defaultPrice: q.default_price || 0,
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  // Hôte sans club rattaché : rien à charger, on le dit au lieu de spinner.
  useEffect(() => {
    if (venueLoading || venueId) return;
    setData(prev => (prev.loading ? { ...prev, loading: false } : prev));
  }, [venueLoading, venueId]);

  // ─── Realtime ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!venueId) return;
    fetchData();

    // Réservations : pas de colonne venue_id → canal non filtré, mais refetch
    // débouncé. Le callback de statut est le signal de santé de la socket.
    const reservationsChannel = supabase
      .channel(uniqueChannel('vip_night_reservations'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_reservations' }, scheduleRefetch)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
          if (!wasConnectedRef.current) {
            wasConnectedRef.current = true;
            fetchData(); // resync après (re)connexion
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasConnectedRef.current = false;
          setRealtimeConnected(false);
        }
      });

    const ordersChannel = supabase
      .channel(uniqueChannel('vip_night_orders'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vip_table_orders', filter: `venue_id=eq.${venueId}` },
        scheduleRefetch
      )
      .subscribe();

    const consumptionsChannel = supabase
      .channel(uniqueChannel('vip_night_consumptions'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vip_consumptions', filter: `venue_id=eq.${venueId}` },
        scheduleRefetch
      )
      .subscribe();

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      wasConnectedRef.current = false;
      setRealtimeConnected(false);
      supabase.removeChannel(reservationsChannel);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(consumptionsChannel);
    };
  }, [venueId, fetchData, scheduleRefetch]);

  // Sans soirée active, aucun changement de résa ne nous concerne : on sonde
  // toutes les 60 s pour attraper le début de la fenêtre d'un event.
  useEffect(() => {
    if (!venueId || data.activeEvent || data.loading) return;
    const id = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(id);
  }, [venueId, data.activeEvent, data.loading, fetchData]);

  // ─── Dérivés ────────────────────────────────────────────────────────────────

  const ordersByReservation = useMemo(() => {
    const map = new Map<string, ServiceOrder[]>();
    data.orders.forEach(o => {
      const arr = map.get(o.reservationId) || [];
      arr.push(o);
      map.set(o.reservationId, arr);
    });
    return map;
  }, [data.orders]);

  const serviceInfo = useMemo(() => {
    const map = new Map<string, TableServiceInfo>();
    data.reservations.forEach(r => {
      map.set(r.id, buildServiceInfo(r, data.consumptions.get(r.id) || [], ordersByReservation.get(r.id) || []));
    });
    return map;
  }, [data.reservations, data.consumptions, ordersByReservation]);

  /** Arrivés (scan porte ou arrivée manuelle) pas encore installés. */
  const doorQueue = useMemo(
    () =>
      data.reservations
        .filter(r => r.hasArrived && r.vipStatus === 'waiting')
        .sort((a, b) => new Date(a.checkedInAt || a.createdAt).getTime() - new Date(b.checkedInAt || b.createdAt).getTime()),
    [data.reservations]
  );

  const sortedReservations = useMemo(
    () =>
      [...data.reservations].sort((a, b) => {
        const pa = reservationPriority(a, serviceInfo.get(a.id)!);
        const pb = reservationPriority(b, serviceInfo.get(b.id)!);
        if (pa !== pb) return pa - pb;
        return new Date(b.placedAt || b.checkedInAt || b.createdAt).getTime() -
          new Date(a.placedAt || a.checkedInAt || a.createdAt).getTime();
      }),
    [data.reservations, serviceInfo]
  );

  // ─── Écritures réservation ─────────────────────────────────────────────────

  const updateReservation = useCallback(
    async (reservationId: string, updates: TablesUpdate<'table_reservations'>) => {
      const { error } = await supabase.from('table_reservations').update(updates).eq('id', reservationId);
      if (error) throw error;
      await fetchData();
    },
    [fetchData]
  );

  const seatGuest = useCallback(
    async (reservationId: string, tableId: string) => {
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      const { data: auth } = await supabase.auth.getUser();
      const base: TablesUpdate<'table_reservations'> = {
        vip_status: 'placed',
        assigned_table_id: tableId,
        placed_at: new Date().toISOString(),
        placed_by: auth?.user?.id ?? null,
      };
      // Revue de la demande de table du client : approved si on l'installe à la
      // table demandée, modified sinon. Nécessite l'allow-list 20260714190000 —
      // fallback sans ces champs si la base ne l'a pas encore (42501).
      const withReview: TablesUpdate<'table_reservations'> =
        r && r.placementStatus === 'requested'
          ? {
              ...base,
              placement_status: r.requestedTableId === tableId ? 'approved' : 'modified',
              placement_reviewed_by: auth?.user?.id ?? null,
              placement_reviewed_at: new Date().toISOString(),
            }
          : base;
      try {
        await updateReservation(reservationId, withReview);
      } catch (error) {
        if (withReview !== base && isColumnGuardError(error)) {
          await updateReservation(reservationId, base);
        } else {
          throw error;
        }
      }
      // Email de confirmation de placement (l'edge attend `reservationId`).
      supabase.functions
        .invoke('send-vip-confirmation', { body: { reservationId, type: 'confirmed' } })
        .catch(err => console.error('send-vip-confirmation failed:', err));
    },
    [updateReservation]
  );

  const moveGuest = useCallback(
    (reservationId: string, tableId: string) => updateReservation(reservationId, { assigned_table_id: tableId }),
    [updateReservation]
  );

  const markArrived = useCallback(
    (reservationId: string) => updateReservation(reservationId, { checked_in_at: new Date().toISOString() }),
    [updateReservation]
  );

  const markAbsent = useCallback(
    (reservationId: string, status: 'no_show' | 'denied') => updateReservation(reservationId, { vip_status: status }),
    [updateReservation]
  );

  const finishService = useCallback(
    (reservationId: string) =>
      updateReservation(reservationId, { vip_status: 'finished', finished_at: new Date().toISOString() }),
    [updateReservation]
  );

  const reopenService = useCallback(
    (reservationId: string) => updateReservation(reservationId, { vip_status: 'active', finished_at: null }),
    [updateReservation]
  );

  // ─── Grand livre (consos) ──────────────────────────────────────────────────

  /** Passe la table en service à la première conso. */
  const activateIfPlaced = useCallback(
    async (reservationId: string) => {
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      if (r?.vipStatus === 'placed') {
        await supabase.from('table_reservations').update({ vip_status: 'active' }).eq('id', reservationId);
      }
    },
    []
  );

  const insertConsumption = useCallback(
    async (
      reservationId: string,
      row: {
        itemName: string;
        itemType: 'bottle' | 'extra' | 'service';
        quantity: number;
        unitPrice: number;
        menuItemId?: string | null;
        category?: string | null;
        brand?: string | null;
        source: 'staff' | 'preorder' | 'qr';
        parentConsumptionId?: string | null;
        notes?: string | null;
      }
    ): Promise<string | null> => {
      if (!venueId) throw new Error('No venue');
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      const { data: auth } = await supabase.auth.getUser();
      const { data: inserted, error } = await supabase
        .from('vip_consumptions')
        .insert({
          table_reservation_id: reservationId,
          venue_id: venueId,
          event_id: r?.eventId || null,
          item_name: row.itemName,
          item_type: row.itemType,
          quantity: row.quantity,
          unit_price: row.unitPrice,
          total_price: row.quantity * row.unitPrice,
          served_by: auth?.user?.id || null,
          notes: row.notes ?? null,
          menu_item_id: row.menuItemId ?? null,
          category: row.category ?? null,
          brand: row.brand ?? null,
          source: row.source,
          parent_consumption_id: row.parentConsumptionId ?? null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return inserted?.id ?? null;
    },
    [venueId]
  );

  const undoConsumption = useCallback(
    async (consumptionId: string) => {
      const { data: deleted, error } = await supabase
        .from('vip_consumptions')
        .delete()
        .eq('id', consumptionId)
        .select('id');
      if (error) throw error;
      // RLS (fenêtre 15 min / autre auteur) → 0 ligne supprimée, sans erreur.
      if (!deleted || deleted.length === 0) throw new Error('undo_window_expired');
      await fetchData();
    },
    [fetchData]
  );

  // ─── Panier → commande bar OU service direct ──────────────────────────────

  const submitCart = useCallback(
    async (reservationId: string, lines: CartLine[], opts: { directServe: boolean; note?: string }) => {
      if (!venueId || lines.length === 0) return;

      if (opts.directServe) {
        // Déjà servi : on écrit directement le grand livre (bouteille puis ses
        // mixers liés), et la table passe en service.
        for (const line of lines) {
          const parentId = await insertConsumption(reservationId, {
            itemName: line.menuItem?.name || line.quickItem?.name || '',
            itemType: line.menuItem
              ? consumptionItemType(line.menuItem.category)
              : line.quickItem?.itemType || 'service',
            quantity: line.quantity,
            unitPrice: cartLinePrice(line),
            menuItemId: line.menuItem?.id ?? null,
            category: line.menuItem?.category ?? null,
            brand: line.menuItem?.brand ?? null,
            source: 'staff',
            notes: opts.note || null,
          });
          for (const mixer of line.mixers) {
            await insertConsumption(reservationId, {
              itemName: mixer.item.name,
              itemType: 'extra',
              quantity: mixer.quantity,
              unitPrice: mixer.item.price,
              menuItemId: mixer.item.id,
              category: mixer.item.category,
              brand: mixer.item.brand,
              source: 'staff',
              parentConsumptionId: parentId,
            });
          }
        }
        await activateIfPlaced(reservationId);
        await fetchData();
        return;
      }

      // Commande initiée par l'hôte : elle part directement au bar en
      // `confirmed` (l'hôte EST la validation). Une commande client arrive en
      // `pending` et se confirme dans l'onglet Service.
      const { data: auth } = await supabase.auth.getUser();
      const { data: order, error: orderError } = await supabase
        .from('vip_table_orders')
        .insert({
          table_reservation_id: reservationId,
          venue_id: venueId,
          status: 'confirmed',
          total_amount: cartTotal(lines),
          notes: opts.note || null,
          confirmed_at: new Date().toISOString(),
          confirmed_by: auth?.user?.id || null,
        })
        .select('id')
        .single();
      if (orderError) throw orderError;

      for (const line of lines) {
        if (!line.menuItem) continue; // les boutons rapides n'existent pas au bar
        const { data: parentRow, error: itemError } = await supabase
          .from('vip_table_order_items')
          .insert({
            order_id: order.id,
            menu_item_id: line.menuItem.id,
            quantity: line.quantity,
            unit_price: line.menuItem.price,
            is_included: line.menuItem.price === 0,
          })
          .select('id')
          .single();
        if (itemError) throw itemError;
        if (line.mixers.length > 0) {
          const { error: mixerError } = await supabase.from('vip_table_order_items').insert(
            line.mixers.map(m => ({
              order_id: order.id,
              menu_item_id: m.item.id,
              quantity: m.quantity,
              unit_price: m.item.price,
              is_included: m.item.price === 0,
              parent_order_item_id: parentRow?.id ?? null,
            }))
          );
          if (mixerError) throw mixerError;
        }
      }
      await fetchData();
    },
    [venueId, insertConsumption, activateIfPlaced, fetchData]
  );

  // ─── Pipeline des commandes ────────────────────────────────────────────────

  /** preorder/pending → confirmed. Retourne false si déjà traité ailleurs. */
  const confirmOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      const { data: auth } = await supabase.auth.getUser();
      const { data: updated, error } = await supabase
        .from('vip_table_orders')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: auth?.user?.id || null })
        .eq('id', orderId)
        .in('status', ['preorder', 'pending'])
        .select('id');
      if (error) throw error;
      await fetchData();
      return (updated || []).length > 0;
    },
    [fetchData]
  );

  /**
   * confirmed/preparing → served + copie des lignes dans le grand livre.
   * Verrou optimiste : si un autre appareil a déjà servi, 0 ligne mise à jour
   * et on ne double-compte rien.
   */
  const serveOrder = useCallback(
    async (order: ServiceOrder): Promise<boolean> => {
      const { data: updated, error } = await supabase
        .from('vip_table_orders')
        .update({ status: 'served', served_at: new Date().toISOString() })
        .eq('id', order.id)
        .in('status', ['pending', 'confirmed', 'preparing'])
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) return false;

      const source: 'staff' | 'preorder' | 'qr' = order.notes?.startsWith('Pré-commande')
        ? 'preorder'
        : order.userId
          ? 'qr'
          : 'staff';

      // Parents d'abord (bouteilles), puis mixers liés à leur conso parente.
      const idMap = new Map<string, string>();
      for (const item of order.items.filter(i => !i.parentOrderItemId)) {
        const consumptionId = await insertConsumption(order.reservationId, {
          itemName: item.name,
          itemType: consumptionItemType(item.category),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          menuItemId: item.menuItemId,
          category: item.category,
          source,
        });
        if (consumptionId) idMap.set(item.id, consumptionId);
      }
      for (const item of order.items.filter(i => i.parentOrderItemId)) {
        await insertConsumption(order.reservationId, {
          itemName: item.name,
          itemType: consumptionItemType(item.category),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          menuItemId: item.menuItemId,
          category: item.category,
          source,
          parentConsumptionId: idMap.get(item.parentOrderItemId!) ?? null,
        });
      }

      await activateIfPlaced(order.reservationId);
      await fetchData();
      return true;
    },
    [insertConsumption, activateIfPlaced, fetchData]
  );

  const cancelOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      const { data: updated, error } = await supabase
        .from('vip_table_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId)
        .in('status', ['preorder', 'pending', 'confirmed', 'preparing'])
        .select('id');
      if (error) throw error;
      await fetchData();
      return (updated || []).length > 0;
    },
    [fetchData]
  );

  // ─── Moments de service ────────────────────────────────────────────────────

  const scheduleMoment = useCallback(
    async (reservationId: string, kind: string, label: string | null, scheduledAt: string) => {
      if (!venueId) return;
      const { data: auth } = await supabase.auth.getUser();
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      const { error } = await (supabase as any).from('vip_service_moments').insert({
        venue_id: venueId,
        event_id: r?.eventId || null,
        table_reservation_id: reservationId,
        kind,
        label,
        scheduled_at: scheduledAt,
        status: 'scheduled',
        created_by: auth?.user?.id || null,
      });
      if (error) throw error;
      await fetchData();
    },
    [venueId, fetchData]
  );

  const completeMoment = useCallback(
    async (momentId: string) => {
      const { error } = await (supabase as any)
        .from('vip_service_moments')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .eq('id', momentId);
      if (error) throw error;
      await fetchData();
    },
    [fetchData]
  );

  return {
    venueId,
    loading: data.loading || venueLoading,
    noVenue: !venueLoading && !venueId,
    connectionStale: !realtimeConnected || !isOnline,
    activeEvent: data.activeEvent,
    reservations: sortedReservations,
    consumptions: data.consumptions,
    orders: data.orders,
    ordersByReservation,
    moments: data.moments,
    floorPlan: data.floorPlan,
    menuItems,
    quickItems,
    serviceInfo,
    doorQueue,
    refresh: fetchData,
    seatGuest,
    moveGuest,
    markArrived,
    markAbsent,
    finishService,
    reopenService,
    submitCart,
    confirmOrder,
    serveOrder,
    cancelOrder,
    undoConsumption,
    insertConsumption,
    scheduleMoment,
    completeMoment,
  };
}

export type VipNight = ReturnType<typeof useVipNight>;
