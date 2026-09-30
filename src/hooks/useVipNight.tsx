import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import type { Tables, TablesUpdate } from '@/integrations/supabase/types';
import { VipConsumption, VenueFloorPlan } from '@/types';
import { useStaffVenue } from './useStaffVenue';
import {
  ServiceReservation, ServiceOrder, ServiceMenuItem, ServiceQuickItem, ServiceMoment,
  CartLine, TableServiceInfo, VipEventOption, buildServiceInfo, reservationPriority,
} from '@/components/vip-service/serviceTypes';

// ─────────────────────────────────────────────────────────────────────────────
// useVipNight — le hook unique de l'outil serveur VIP.
//
// Modèle : Commandes (vip_table_orders) = file du bar ; Consos
// (vip_consumptions) = grand livre servi. Le crédit client ne bouge qu'à
// l'insertion d'une conso ("servi"), jamais à la commande.
//
// Plusieurs hôtes travaillent la même soirée sur plusieurs téléphones. Règle :
// chaque écriture de réservation est CONDITIONNELLE à l'état que l'hôte avait
// sous les yeux (UPDATE … WHERE vip_status = attendu). Si un collègue est
// passé avant, 0 ligne → AlreadyHandledError, l'écran le dit et se remet à
// jour, rien n'est écrasé. Une table n'accueille qu'un groupe installé à la
// fois (index unique + trigger enforce_assigned_table_exists, 23505).
//
// Commandes et grand livre passent par des RPC atomiques
// (20260929233000) : vip_create_table_order, vip_serve_table_order,
// vip_serve_items — prix lus dans la carte, tout ou rien, idempotentes par
// requestId (un renvoi après une réponse perdue ne débite pas deux fois).
//
// Un pur vip_host n'a le droit qu'aux colonnes de service (trigger
// enforce_vip_host_reservation_columns).
// ─────────────────────────────────────────────────────────────────────────────

/** Un collègue a déjà traité cette réservation / commande. */
export class AlreadyHandledError extends Error {
  constructor() {
    super('already_handled');
    this.name = 'AlreadyHandledError';
  }
}

export const isAlreadyHandled = (error: unknown): boolean =>
  error instanceof AlreadyHandledError || (error as Error | null)?.message === 'already_handled';

/** Ligne envoyée aux RPC de service : bouteille / bouton rapide / mixer relié. */
interface ServiceItemPayload {
  menu_item_id?: string;
  quick_item_id?: string;
  quantity: number;
  parent_menu_item_id?: string;
}

const cartToPayload = (lines: CartLine[], withQuick: boolean): ServiceItemPayload[] => {
  const out: ServiceItemPayload[] = [];
  for (const line of lines) {
    if (line.menuItem) {
      out.push({ menu_item_id: line.menuItem.id, quantity: line.quantity });
      for (const mixer of line.mixers) {
        out.push({ menu_item_id: mixer.item.id, quantity: mixer.quantity, parent_menu_item_id: line.menuItem.id });
      }
    } else if (line.quickItem && withQuick) {
      out.push({ quick_item_id: line.quickItem.id, quantity: line.quantity });
    }
  }
  return out;
};

interface NightData {
  reservations: ServiceReservation[];
  consumptions: Map<string, VipConsumption[]>;
  orders: ServiceOrder[];
  moments: ServiceMoment[];
  floorPlan: VenueFloorPlan | null;
  /** La soirée affichée : sélection de l'hôte, sinon celle en cours, sinon la prochaine. */
  activeEvent: VipEventOption | null;
  /** Toutes les soirées préparables (en cours + à venir), chronologiques. */
  events: VipEventOption[];
  loading: boolean;
}

const EMPTY: NightData = {
  reservations: [],
  consumptions: new Map(),
  orders: [],
  moments: [],
  floorPlan: null,
  activeEvent: null,
  events: [],
  loading: true,
};

const mapFloorPlan = (row: Tables<'venue_floor_plans'> | null): VenueFloorPlan | null =>
  row
    ? {
        id: row.id,
        venueId: row.venue_id,
        backgroundImageUrl: row.background_image_url,
        layout: row.layout as unknown as VenueFloorPlan['layout'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

// RPC et table de service pas encore présentes dans les types générés
// (migration 20260929233000) : client non typé pour ces seuls appels.
const untyped = supabase as unknown as SupabaseClient;

/** Id de l'hôte connecté, lu dans la session locale (pas d'aller-retour réseau). */
const currentUserId = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
};

export function useVipNight() {
  const { venueId, loading: venueLoading } = useStaffVenue();
  const [data, setData] = useState<NightData>(EMPTY);
  const [menuItems, setMenuItems] = useState<ServiceMenuItem[]>([]);
  const [quickItems, setQuickItems] = useState<ServiceQuickItem[]>([]);
  // Zones du club (pour créer un walk-in dans une zone précise).
  const [zones, setZones] = useState<{ id: string; name: string; color: string }[]>([]);

  // Soirée choisie par l'hôte. Un ref double l'état pour que les refetch
  // realtime (sans argument) conservent la sélection au lieu de retomber sur
  // le défaut « en cours / prochaine ».
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const selectedEventIdRef = useRef<string | null>(null);
  selectedEventIdRef.current = selectedEventId;

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

  // Deux lectures peuvent se croiser (realtime + poll + changement de soirée) :
  // seule la PLUS RÉCENTE a le droit d'écrire l'état, sinon une réponse lente
  // réaffiche une table qu'un collègue vient d'installer, ou l'ancienne soirée.
  const fetchSeq = useRef(0);

  const fetchData = useCallback(async (preferEventId?: string) => {
    if (!venueId) return;
    const seq = ++fetchSeq.current;
    const stale = () => seq !== fetchSeq.current;
    try {
      const now = new Date();
      // Toutes les soirées que l'hôte peut préparer : en cours OU à venir (pas
      // encore terminées), que le club soit lead ou hôte d'une co-soirée
      // (partner_venue_id ; venue_id peut être NULL). On ne borne plus à 6 h —
      // l'hôte VIP place ses tables et lit les pré-commandes des jours à
      // l'avance. Tri chronologique, la plus proche d'abord.
      const { data: eventRows } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, venue_id')
        .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`)
        .eq('is_active', true)
        .gte('end_at', now.toISOString())
        .order('start_at', { ascending: true })
        .limit(30);

      const events: VipEventOption[] = (eventRows || []).map(e => ({
        id: e.id,
        title: e.title,
        startAt: e.start_at,
        endAt: e.end_at,
      }));

      if (stale()) return;
      if (events.length === 0) {
        // Vraiment aucune soirée à venir : on charge quand même le plan
        // venue-level (filtre event_id IS NULL — un club avec co-events possède
        // aussi des plans event-scoped et maybeSingle() 406 sinon).
        const { data: planRow } = await supabase
          .from('venue_floor_plans')
          .select('*')
          .eq('venue_id', venueId)
          .is('event_id', null)
          .maybeSingle();
        if (stale()) return;
        setData({ ...EMPTY, events: [], floorPlan: mapFloorPlan(planRow), loading: false });
        return;
      }

      // Sélection : le choix explicite de l'hôte prime tant qu'il pointe une
      // soirée encore listée ; sinon la soirée en cours ; sinon la prochaine.
      const wanted = preferEventId ?? selectedEventIdRef.current;
      const live = events.find(e => new Date(e.startAt) <= now && new Date(e.endAt) >= now);
      const selectedId =
        wanted && events.some(e => e.id === wanted) ? wanted : live?.id ?? events[0].id;
      if (stale()) return;
      if (selectedId !== selectedEventIdRef.current) {
        selectedEventIdRef.current = selectedId;
        setSelectedEventId(selectedId);
      }
      const ev = events.find(e => e.id === selectedId)!;
      const activeEvent: VipEventOption = ev;

      const [resQ, planEventQ, ordersQ, momentsQ] = await Promise.all([
        supabase
          .from('table_reservations')
          .select(
            `id, zone_id, event_id, user_id, user_email, full_name, phone,
             guest_count, deposit, total_price, minimum_spend, status, vip_status,
             paid_at, placed_at, placed_by, assigned_table_id, finished_at,
             qr_code, created_at, checked_in_at, requested_table_id, placement_status,
             purchase_source, pack_id,
             table_zones!inner(name, color, venue_id),
             table_packs(arrival_deadline)`
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
        untyped
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
      (floorPlan?.layout?.tables || []).forEach(t => tableNames.set(t.id, t.name));

      const reservations: ServiceReservation[] = (resQ.data || []).map(r => ({
        id: r.id,
        zoneId: r.zone_id,
        zoneName: r.table_zones?.name || '',
        zoneColor: r.table_zones?.color || '#666',
        eventId: r.event_id,
        userId: r.user_id,
        userEmail: r.user_email,
        purchaseSource: r.purchase_source,
        fullName: r.full_name || r.user_email?.split('@')[0] || 'Guest',
        phone: r.phone,
        guestCount: r.guest_count || 1,
        deposit: r.deposit || 0,
        totalPrice: r.total_price || 0,
        minimumSpend: r.minimum_spend || 0,
        arrivalDeadline: r.table_packs?.arrival_deadline || null,
        status: r.status,
        vipStatus: (r.vip_status || 'waiting') as ServiceReservation['vipStatus'],
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
        (consRows || []).forEach(c => {
          const mapped: VipConsumption = {
            id: c.id,
            tableReservationId: c.table_reservation_id,
            venueId: c.venue_id,
            eventId: c.event_id,
            itemName: c.item_name,
            itemType: c.item_type as VipConsumption['itemType'],
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

      const orders: ServiceOrder[] = (ordersQ.data || []).map(o => ({
        id: o.id,
        reservationId: o.table_reservation_id,
        userId: o.user_id,
        status: o.status as ServiceOrder['status'],
        totalAmount: o.total_amount || 0,
        notes: o.notes,
        createdAt: o.created_at,
        confirmedAt: o.confirmed_at,
        servedAt: o.served_at,
        items: (o.vip_table_order_items || []).map(it => ({
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

      const moments: ServiceMoment[] = (momentsQ.data || []).map(m => ({
        id: m.id,
        reservationId: m.table_reservation_id,
        kind: m.kind,
        label: m.label,
        scheduledAt: m.scheduled_at,
        status: m.status as ServiceMoment['status'],
      }));

      if (stale()) return;
      setData({ reservations, consumptions: consumptionsMap, orders, moments, floorPlan, activeEvent, events, loading: false });
    } catch (error) {
      console.error('Error fetching VIP night data:', error);
      if (!stale()) setData(prev => ({ ...prev, loading: false }));
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
      const [menuQ, quickQ, zonesQ] = await Promise.all([
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
        supabase
          .from('table_zones')
          .select('id, name, color')
          .eq('venue_id', venueId)
          .order('name', { ascending: true }),
      ]);
      if (cancelled) return;
      setZones((zonesQ.data || []).map((z: { id: string; name: string; color: string | null }) => ({ id: z.id, name: z.name, color: z.color || '#666' })));
      setMenuItems(
        (menuQ.data || []).map(m => ({
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
        (quickQ.data || []).map(q => ({
          id: q.id,
          name: q.name,
          itemType: q.item_type as ServiceQuickItem['itemType'],
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

    // Commandes du club : le canal de référence pour la SANTÉ de la socket
    // (filtré par club, stable d'une soirée à l'autre). À chaque (re)connexion
    // on relit tout : ce qu'un collègue a fait pendant la coupure (écran
    // verrouillé, sous-sol sans réseau) arrive d'un coup.
    const ordersChannel = supabase
      .channel(uniqueChannel('vip_night_orders'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vip_table_orders', filter: `venue_id=eq.${venueId}` },
        scheduleRefetch
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
          if (!wasConnectedRef.current) {
            wasConnectedRef.current = true;
            fetchData();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasConnectedRef.current = false;
          setRealtimeConnected(false);
        }
      });

    const consumptionsChannel = supabase
      .channel(uniqueChannel('vip_night_consumptions'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vip_consumptions', filter: `venue_id=eq.${venueId}` },
        scheduleRefetch
      )
      .subscribe();

    // Moments de service (bottle parade, anniversaire) posés par un collègue.
    const momentsChannel = supabase
      .channel(uniqueChannel('vip_night_moments'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vip_service_moments', filter: `venue_id=eq.${venueId}` },
        scheduleRefetch
      )
      .subscribe();

    // Retour au premier plan : iOS coupe la socket écran verrouillé, on relit.
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      wasConnectedRef.current = false;
      setRealtimeConnected(false);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(consumptionsChannel);
      supabase.removeChannel(momentsChannel);
    };
  }, [venueId, fetchData, scheduleRefetch]);

  // Réservations : filtrées sur la SOIRÉE affichée (la table n'a pas de colonne
  // club) — un achat pour une autre date ne relance plus la lecture de tous les
  // téléphones. Le canal suit le changement de soirée.
  const activeEventId = data.activeEvent?.id ?? null;
  useEffect(() => {
    if (!venueId || !activeEventId) return;
    const reservationsChannel = supabase
      .channel(uniqueChannel('vip_night_reservations'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_reservations', filter: `event_id=eq.${activeEventId}` },
        scheduleRefetch
      )
      .subscribe();
    return () => {
      supabase.removeChannel(reservationsChannel);
    };
  }, [venueId, activeEventId, scheduleRefetch]);

  // Poll doux : attrape les transitions (planning → en cours), l'arrivée d'une
  // nouvelle soirée et l'expiration de la sélection (soirée terminée). Le
  // realtime couvre déjà les changements de résa pendant la nuit.
  useEffect(() => {
    if (!venueId) return;
    const id = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(id);
  }, [venueId, fetchData]);

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

  /**
   * UPDATE conditionnel : ne touche la réservation que si elle est encore dans
   * l'état attendu. 0 ligne = un collègue est passé avant → AlreadyHandledError
   * (et on relit pour montrer le nouvel état).
   */
  const guardedUpdate = useCallback(
    async (
      reservationId: string,
      updates: TablesUpdate<'table_reservations'>,
      expect: { vipStatus?: string[]; notArrived?: boolean }
    ) => {
      let q = supabase.from('table_reservations').update(updates).eq('id', reservationId);
      if (expect.vipStatus) q = q.in('vip_status', expect.vipStatus);
      if (expect.notArrived) q = q.is('checked_in_at', null);
      const { data: rows, error } = await q.select('id');
      if (error) throw error;
      await fetchData();
      if (!rows || rows.length === 0) throw new AlreadyHandledError();
    },
    [fetchData]
  );

  /**
   * Installe le client à une table. Avant la soirée (client pas encore arrivé),
   * c'est un PRÉ-PLACEMENT : la table lui est promise, il reste « en attente »
   * — il n'est pas compté arrivé, et à la porte il n'y a plus qu'à confirmer.
   * Rend 'seated' ou 'preassigned'.
   */
  const seatGuest = useCallback(
    async (reservationId: string, tableId: string): Promise<'seated' | 'preassigned'> => {
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      const ev = dataRef.current.activeEvent;
      const planning = !!ev && new Date(ev.startAt).getTime() > Date.now() && !r?.hasArrived;
      const uid = await currentUserId();
      const now = new Date().toISOString();
      // Revue de la demande de table du client : approved si on l'installe à la
      // table demandée, modified sinon.
      const review: TablesUpdate<'table_reservations'> =
        r && r.placementStatus === 'requested'
          ? {
              placement_status: r.requestedTableId === tableId ? 'approved' : 'modified',
              placement_reviewed_by: uid,
              placement_reviewed_at: now,
            }
          : r && !r.assignedTableId && planning
            ? { placement_status: 'approved', placement_reviewed_by: uid, placement_reviewed_at: now }
            : {};

      if (planning) {
        await guardedUpdate(reservationId, { assigned_table_id: tableId, ...review }, { vipStatus: ['waiting'] });
        return 'preassigned';
      }

      await guardedUpdate(
        reservationId,
        { vip_status: 'placed', assigned_table_id: tableId, placed_at: now, placed_by: uid, ...review },
        { vipStatus: ['waiting'] }
      );
      // Email de confirmation de placement (l'edge attend `reservationId`).
      supabase.functions
        .invoke('send-vip-confirmation', { body: { reservationId, type: 'confirmed' } })
        .catch(err => console.error('send-vip-confirmation failed:', err));
      return 'seated';
    },
    [guardedUpdate]
  );

  /** Change de table un client installé (ou la table promise d'un pré-placé). */
  const moveGuest = useCallback(
    (reservationId: string, tableId: string) =>
      guardedUpdate(reservationId, { assigned_table_id: tableId }, { vipStatus: ['placed', 'active', 'waiting'] }),
    [guardedUpdate]
  );

  const markArrived = useCallback(
    (reservationId: string) =>
      guardedUpdate(
        reservationId,
        { checked_in_at: new Date().toISOString() },
        { vipStatus: ['waiting'], notArrived: true }
      ),
    [guardedUpdate]
  );

  const markAbsent = useCallback(
    (reservationId: string, status: 'no_show' | 'denied') =>
      guardedUpdate(reservationId, { vip_status: status }, { vipStatus: ['waiting'] }),
    [guardedUpdate]
  );

  const finishService = useCallback(
    (reservationId: string) =>
      guardedUpdate(
        reservationId,
        { vip_status: 'finished', finished_at: new Date().toISOString() },
        { vipStatus: ['placed', 'active'] }
      ),
    [guardedUpdate]
  );

  /**
   * Rouvre : une table terminée repart en service sur sa table (refusé 23505
   * si un autre groupe l'occupe désormais) ; un no-show / refus revient « en
   * attente » — il n'a pas de table, le rouvrir « en service » créait une
   * table fantôme.
   */
  const reopenService = useCallback(
    (reservationId: string) => {
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      const from = r?.vipStatus || 'finished';
      const updates: TablesUpdate<'table_reservations'> =
        from === 'finished' && r?.assignedTableId
          ? { vip_status: 'active', finished_at: null }
          : { vip_status: 'waiting', finished_at: null };
      return guardedUpdate(reservationId, updates, { vipStatus: [from] });
    },
    [guardedUpdate]
  );

  // ─── Grand livre (consos) ──────────────────────────────────────────────────

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

  /**
   * Service direct (« déjà servi ») → grand livre en une écriture ; sinon la
   * commande part au bar en `confirmed` (l'hôte EST la validation). Une
   * commande client arrive en `pending` et se confirme dans l'onglet Service.
   * `requestId` : le même pour tous les renvois d'un même panier.
   */
  const submitCart = useCallback(
    async (
      reservationId: string,
      lines: CartLine[],
      opts: { directServe: boolean; note?: string; requestId?: string }
    ) => {
      if (!venueId || lines.length === 0) return;
      const requestId = opts.requestId ?? crypto.randomUUID();
      if (opts.directServe) {
        const { error } = await untyped.rpc('vip_serve_items', {
          p_reservation_id: reservationId,
          p_items: cartToPayload(lines, true),
          p_note: opts.note || null,
          p_request_id: requestId,
        });
        if (error) throw error;
      } else {
        // Les boutons rapides n'existent pas au bar : servis en direct seulement.
        const items = cartToPayload(lines, false);
        if (items.length === 0) return;
        const { error } = await untyped.rpc('vip_create_table_order', {
          p_reservation_id: reservationId,
          p_items: items,
          p_note: opts.note || null,
          p_request_id: requestId,
        });
        if (error) throw error;
      }
      await fetchData();
    },
    [venueId, fetchData]
  );

  // ─── Pipeline des commandes ────────────────────────────────────────────────

  /** preorder/pending → confirmed. Retourne false si déjà traité ailleurs. */
  const confirmOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      const uid = await currentUserId();
      const { data: updated, error } = await supabase
        .from('vip_table_orders')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: uid })
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
   * → served + copie dans le grand livre, en UNE transaction serveur qui relit
   * les articles en base (jamais la mémoire du téléphone, qui peut ne pas avoir
   * encore reçu les lignes d'une commande client). false = un collègue l'a déjà
   * servie ou annulée : rien n'est compté deux fois.
   */
  const serveOrder = useCallback(
    async (order: ServiceOrder): Promise<boolean> => {
      const { data: result, error } = await untyped.rpc('vip_serve_table_order', { p_order_id: order.id });
      if (error) throw error;
      await fetchData();
      return !!(result as { served?: boolean } | null)?.served;
    },
    [fetchData]
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
      const uid = await currentUserId();
      const r = dataRef.current.reservations.find(x => x.id === reservationId);
      const { error } = await untyped.from('vip_service_moments').insert({
        venue_id: venueId,
        event_id: r?.eventId || null,
        table_reservation_id: reservationId,
        kind,
        label,
        scheduled_at: scheduledAt,
        status: 'scheduled',
        created_by: uid,
      });
      if (error) throw error;
      await fetchData();
    },
    [venueId, fetchData]
  );

  /** Un seul hôte clôt un moment : false si un collègue l'a déjà fait. */
  const completeMoment = useCallback(
    async (momentId: string): Promise<boolean> => {
      const { data: rows, error } = await untyped
        .from('vip_service_moments')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .eq('id', momentId)
        .eq('status', 'scheduled')
        .select('id');
      if (error) throw error;
      await fetchData();
      return (rows || []).length > 0;
    },
    [fetchData]
  );

  // Crée une réservation « à la main » (walk-in) via la RPC gardée, puis
  // rafraîchit. Enregistrement seul (payé au club) : frais Yuno à 0, la ligne
  // entre dans le CA/analytics comme une réservation payée. Retourne l'id.
  const createWalkin = useCallback(
    async (input: {
      zoneId: string;
      fullName: string | null;
      guestCount: number;
      totalPrice: number;
      assignedTableId?: string | null;
      /** true = addition ouverte (placé à l'entrée) : le CA suit les consos. */
      openTab?: boolean;
      /** CRM/marketing : email (déclenche l'abonnement newsletter du club) + tél. */
      email?: string | null;
      phone?: string | null;
    }): Promise<string> => {
      const ev = dataRef.current.activeEvent;
      if (!ev) throw new Error('no_event');
      const { data: newId, error } = await untyped.rpc('create_manual_table_reservation', {
        p_event_id: ev.id,
        p_zone_id: input.zoneId,
        p_full_name: input.fullName,
        p_phone: input.phone ?? null,
        p_email: input.email ?? null,
        p_guest_count: Math.max(1, input.guestCount || 1),
        p_total_price: Math.max(0, input.totalPrice || 0),
        p_minimum_spend: 0,
        p_assigned_table_id: input.assignedTableId ?? null,
        p_remarks: null,
        p_open_tab: input.openTab ?? false,
      });
      if (error) throw error;
      await fetchData();
      return newId as string;
    },
    [fetchData]
  );

  // Bascule vers une autre soirée listée (chips du sélecteur). Le ref est mis à
  // jour tout de suite pour que le fetch qui suit vise la bonne soirée.
  const selectEvent = useCallback(
    (eventId: string) => {
      selectedEventIdRef.current = eventId;
      setSelectedEventId(eventId);
      fetchData(eventId);
    },
    [fetchData]
  );

  return {
    venueId,
    loading: data.loading || venueLoading,
    noVenue: !venueLoading && !venueId,
    connectionStale: !realtimeConnected || !isOnline,
    activeEvent: data.activeEvent,
    events: data.events,
    selectedEventId: data.activeEvent?.id ?? null,
    selectEvent,
    // Planning : la soirée affichée n'a pas encore commencé (préparation en
    // amont). En cours ou passée dans la nuit → service en direct.
    isPlanning: !!data.activeEvent && new Date(data.activeEvent.startAt).getTime() > Date.now(),
    reservations: sortedReservations,
    consumptions: data.consumptions,
    orders: data.orders,
    ordersByReservation,
    moments: data.moments,
    floorPlan: data.floorPlan,
    menuItems,
    quickItems,
    zones,
    serviceInfo,
    doorQueue,
    refresh: fetchData,
    createWalkin,
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
    scheduleMoment,
    completeMoment,
  };
}

export type VipNight = ReturnType<typeof useVipNight>;
