import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { VipReservation, VipConsumption, VenueFloorPlan } from '@/types';
import { useStaffVenue } from './useStaffVenue';

interface VipHostData {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
  floorPlan: VenueFloorPlan | null;
  loading: boolean;
  activeEvent: { id: string; title: string; startAt: string } | null;
}

export function useVipHost() {
  const { venueId, loading: venueLoading } = useStaffVenue();
  const [data, setData] = useState<VipHostData>({
    reservations: [],
    consumptions: new Map(),
    floorPlan: null,
    loading: true,
    activeEvent: null,
  });

  // Realtime health: in a packed club on flaky wifi the websocket can drop while
  // the browser still reports "online". We surface that so the UI can warn the
  // host that data may be stale and block writes until we reconnect.
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const wasConnectedRef = useRef(false);

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

  const fetchData = useCallback(async () => {
    if (!venueId) return;

    try {
      // Find the active event for tonight using timezone-aware logic
      const now = new Date();
      
      // Get current active event (event that is happening now or starting soon)
      // An event is "active" if: it's marked active AND we're within its time window
      const { data: events } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, venue_id')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .lte('start_at', new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString()) // Starting within next 6 hours
        .gte('end_at', now.toISOString()) // Not yet ended
        .order('start_at', { ascending: true })
        .limit(1);

      const activeEvent = events?.[0] ? {
        id: events[0].id,
        title: events[0].title,
        startAt: events[0].start_at,
      } : null;

      // If no active event, still load the floor plan but no reservations
      if (!activeEvent) {
        // Get floor plan even without active event
        const { data: floorPlanData } = await supabase
          .from('venue_floor_plans')
          .select('*')
          .eq('venue_id', venueId)
          .maybeSingle();

      const floorPlan: VenueFloorPlan | null = floorPlanData ? {
          id: floorPlanData.id,
          venueId: floorPlanData.venue_id,
          backgroundImageUrl: floorPlanData.background_image_url,
          layout: floorPlanData.layout as VenueFloorPlan['layout'],
          createdAt: floorPlanData.created_at,
          updatedAt: floorPlanData.updated_at,
        } : null;

        setData({
          reservations: [],
          consumptions: new Map(),
          floorPlan,
          loading: false,
          activeEvent: null,
        });
        return;
      }

      // Get ALL paid reservations for the active event
      // VIP Host needs to see everyone who has a reservation, not just those who arrived
      const { data: reservationsData, error: resError } = await supabase
        .from('table_reservations')
        .select(`
          id, zone_id, event_id, user_id, user_email, full_name, phone,
          guest_count, deposit, total_price, minimum_spend, status, vip_status,
          paid_at, placed_at, placed_by, assigned_table_id, finished_at,
          qr_code, created_at, checked_in_at,
          requested_table_id, placement_status,
          table_zones!inner(name, color, venue_id)
        `)
        .eq('status', 'paid')
        .eq('event_id', activeEvent.id)
        .eq('table_zones.venue_id', venueId);

      if (resError) {
        console.error('Error fetching reservations:', resError);
      }

      // Map all reservations - no filtering!
      // The UI will distinguish between arrived/not arrived using checkedInAt
      const reservations: VipReservation[] = (reservationsData || []).map((r: any) => ({
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
        assignedTableName: undefined, // Will be resolved below
        finishedAt: r.finished_at,
        qrCode: r.qr_code,
        createdAt: r.created_at,
        checkedInAt: r.checked_in_at,
        hasArrived: r.checked_in_at !== null || ['placed', 'active', 'finished'].includes(r.vip_status),
      }));

      // Get consumptions for all reservations
      const reservationIds = reservations.map(r => r.id);
      const consumptionsMap = new Map<string, VipConsumption[]>();

      if (reservationIds.length > 0) {
        const { data: consumptionsData } = await supabase
          .from('vip_consumptions')
          .select('*')
          .in('table_reservation_id', reservationIds)
          .order('served_at', { ascending: false });

        (consumptionsData || []).forEach((c: any) => {
          const consumption: VipConsumption = {
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

          const existing = consumptionsMap.get(c.table_reservation_id) || [];
          consumptionsMap.set(c.table_reservation_id, [...existing, consumption]);
        });
      }

      // Get floor plan
      const { data: floorPlanData } = await supabase
        .from('venue_floor_plans')
        .select('*')
        .eq('venue_id', venueId)
        .maybeSingle();

      const floorPlan: VenueFloorPlan | null = floorPlanData ? {
        id: floorPlanData.id,
        venueId: floorPlanData.venue_id,
        backgroundImageUrl: floorPlanData.background_image_url,
        layout: floorPlanData.layout as VenueFloorPlan['layout'],
        createdAt: floorPlanData.created_at,
        updatedAt: floorPlanData.updated_at,
      } : null;

      // Resolve table names from floor plan
      const tableNameMap = new Map<string, string>();
      if (floorPlan?.layout?.tables) {
        (floorPlan.layout.tables as any[]).forEach((t: any) => {
          tableNameMap.set(t.id, t.name);
        });
      }
      reservations.forEach(r => {
        if (r.assignedTableId && tableNameMap.has(r.assignedTableId)) {
          r.assignedTableName = tableNameMap.get(r.assignedTableId);
        }
      });

      setData({
        reservations,
        consumptions: consumptionsMap,
        floorPlan,
        loading: false,
        activeEvent,
      });
    } catch (error) {
      console.error('Error fetching VIP host data:', error);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [venueId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!venueId) return;

    fetchData();

    // Subscribe to reservation changes. The status callback is the health signal:
    // SUBSCRIBED = live; CHANNEL_ERROR/TIMED_OUT/CLOSED = the socket dropped.
    // supabase-js auto-reconnects, so on a fresh SUBSCRIBED after a drop we refetch
    // to resync any changes we missed while offline.
    const reservationsChannel = supabase
      .channel(uniqueChannel('vip_reservations_changes'))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'table_reservations',
        },
        () => {
          fetchData();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
          if (wasConnectedRef.current === false) {
            wasConnectedRef.current = true;
            fetchData(); // resync after (re)connect
          }
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          wasConnectedRef.current = false;
          setRealtimeConnected(false);
        }
      });

    // Subscribe to consumption changes
    const consumptionsChannel = supabase
      .channel(uniqueChannel('vip_consumptions_changes'))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vip_consumptions',
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      wasConnectedRef.current = false;
      setRealtimeConnected(false);
      supabase.removeChannel(reservationsChannel);
      supabase.removeChannel(consumptionsChannel);
    };
  }, [venueId, fetchData]);

  const updateReservationStatus = async (
    reservationId: string, 
    vipStatus: VipReservation['vipStatus'],
    assignedTableId?: string
  ) => {
    const updates: TablesUpdate<'table_reservations'> = {
      vip_status: vipStatus,
    };

    if (vipStatus === 'placed' && assignedTableId) {
      updates.assigned_table_id = assignedTableId;
      updates.placed_at = new Date().toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) updates.placed_by = user.id;
    }

    if (vipStatus === 'finished') {
      updates.finished_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('table_reservations')
      .update(updates)
      .eq('id', reservationId);

    if (error) throw error;

    // Send VIP confirmation email on meaningful status changes
    const vipEmailTypes: Record<string, string> = {
      placed: 'confirmed',
      modified: 'modified',
      refused: 'refused',
      finished: '',
    };
    const emailType = vipEmailTypes[vipStatus];
    if (emailType) {
      supabase.functions.invoke('send-vip-confirmation', {
        body: { reservation_id: reservationId, type: emailType },
      }).catch(err => console.error('Error sending VIP confirmation email:', err));
    }
    
    await fetchData();
  };

  const addConsumption = async (
    reservationId: string,
    itemName: string,
    itemType: 'bottle' | 'extra' | 'service',
    quantity: number,
    unitPrice: number,
    notes?: string,
    // Métadonnées d'unification (Phase 0) : relient la conso au menu pour l'analytics.
    // Optionnel + rétrocompatible : les anciens appels (saisie 100 % libre) restent valides.
    opts?: {
      menuItemId?: string | null;
      category?: string | null;
      brand?: string | null;
      source?: 'staff' | 'preorder' | 'qr';
      parentConsumptionId?: string | null;
    }
  ): Promise<string | null> => {
    if (!venueId) throw new Error('No venue ID');

    const reservation = data.reservations.find(r => r.id === reservationId);

    const { data: { user } } = await supabase.auth.getUser();

    const { data: inserted, error } = await supabase
      .from('vip_consumptions')
      .insert({
        table_reservation_id: reservationId,
        venue_id: venueId,
        event_id: reservation?.eventId || null,
        item_name: itemName,
        item_type: itemType,
        quantity,
        unit_price: unitPrice,
        total_price: quantity * unitPrice,
        served_by: user?.id || null,
        notes,
        menu_item_id: opts?.menuItemId ?? null,
        category: opts?.category ?? null,
        brand: opts?.brand ?? null,
        source: opts?.source ?? 'staff',
        parent_consumption_id: opts?.parentConsumptionId ?? null,
      })
      .select('id')
      .single();

    if (error) throw error;

    // Auto-update status to active if it was placed
    if (reservation?.vipStatus === 'placed') {
      await updateReservationStatus(reservationId, 'active');
    }

    await fetchData();
    return inserted?.id ?? null;
  };

  // Move an already-placed guest to a different table. Errors propagate verbatim
  // so the UI can show the real reason (e.g. "table already taken" / not on plan).
  const reassignTable = async (reservationId: string, tableId: string) => {
    const { error } = await supabase
      .from('table_reservations')
      .update({ assigned_table_id: tableId })
      .eq('id', reservationId);

    if (error) throw error;
    await fetchData();
  };

  return {
    ...data,
    venueId,
    loading: data.loading || venueLoading,
    updateReservationStatus,
    addConsumption,
    reassignTable,
    refresh: fetchData,
    // True when the realtime socket is down or the device is offline → data may
    // be stale and writes should be blocked.
    connectionStale: !realtimeConnected || !isOnline,
  };
}
