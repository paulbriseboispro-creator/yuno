import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { uniqueChannel } from '@/lib/realtime';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Bell } from 'lucide-react';
import { ArrowLeft, Clock, CheckCircle2, QrCode, Trash2, CreditCard, Archive, Ticket, ChevronDown, ChevronUp, Wine, Calendar, Shield, X, Users, Sparkles, Gift, LogIn, ShoppingBag, ArrowRight, MapPin, Info, Wallet } from 'lucide-react';
import { DrinkOrderDetailModal } from '@/components/DrinkOrderDetailModal';
import { FreeDrinkRewardModal } from '@/components/FreeDrinkRewardModal';
import { BottomNav } from '@/components/BottomNav';
import { EmptyState } from '@/components/EmptyState';
import { PageFade } from '@/components/PageFade';
import { OrdersSkeleton } from '@/components/skeletons/OrdersSkeleton';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { format, addHours } from 'date-fns';
import { enUS, es, fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { loadStripe } from '@stripe/stripe-js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import QRCode from 'qrcode';
import { GroupedTicketsView } from '@/components/orders/GroupedTicketsView';
import { GroupedDrinksView } from '@/components/orders/GroupedDrinksView';
import { BarSelectionDialog } from '@/components/orders/BarSelectionDialog';
import { DrinkCreditsCard } from '@/components/upsell/DrinkCreditsCard';
import { TicketQROverlay } from '@/components/orders/TicketQROverlay';
import {
  SegControl, PendingCard, UpcomingCard, PastCard, OrderQROverlay,
  type UnifiedOrderEntry, type OrderBucket, type QRAction,
} from '@/components/orders/TemporalOrders';
import { buildVenueMapsUrl, addToCalendar, venueLocationText } from '@/lib/ticketActions';
import type {
  LoyaltyTransaction, PendingReward, Order, OrderItem,
  TicketWithDetails, VipReservationWithDetails, GuestListEntryWithDetails,
} from '@/components/orders/myorders-types';
import { EditOrderDialog } from '@/components/orders/EditOrderDialog';
import { CancelTicketDialog } from '@/components/orders/CancelTicketDialog';
import { getGuestTickets, removeGuestTicket, type GuestTicket } from '@/lib/guestTickets';
import { addToWallet } from '@/lib/wallet';
import { haptics } from '@/lib/haptics';
import { useWalletDetection } from '@/hooks/useWalletDetection';
import { publishNextEventFromTickets } from '@/lib/widgetData';

export default function MyOrders() {
  const { user, loading: authLoading } = useAuth();
  const { language, t } = useLanguage();
  const { isAppleDevice } = useWalletDetection();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<TicketWithDetails[]>([]);
  const [vipReservations, setVipReservations] = useState<VipReservationWithDetails[]>([]);
  const [guestListEntries, setGuestListEntries] = useState<GuestListEntryWithDetails[]>([]);
  const [drinkImages, setDrinkImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [showArchivedTickets, setShowArchivedTickets] = useState(false);
  const [showArchivedDrinks, setShowArchivedDrinks] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketWithDetails | null>(null);
  const [selectedVipReservation, setSelectedVipReservation] = useState<VipReservationWithDetails | null>(null);
  const [selectedDrinkOrder, setSelectedDrinkOrder] = useState<Order | null>(null);
  const [collectMode, setCollectMode] = useState(false);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [ticketToCancel, setTicketToCancel] = useState<TicketWithDetails | null>(null);
  const [cancellingTicket, setCancellingTicket] = useState(false);
  const [loyaltyPoints, setLoyaltyPoints] = useState<Record<string, number>>({});
  const [pendingRewards, setPendingRewards] = useState<PendingReward[]>([]);
  const [selectedReward, setSelectedReward] = useState<PendingReward | null>(null);
  const [barSelectionOrder, setBarSelectionOrder] = useState<Order | null>(null);
  const [prepWithItemsBarOrder, setPrepWithItemsBarOrder] = useState<{ order: Order; indices: number[] } | null>(null);
  const [venueBarCounts, setVenueBarCounts] = useState<Record<string, number>>({});
  const [selectedGuestEntry, setSelectedGuestEntry] = useState<GuestListEntryWithDetails | null>(null);
  // When we land here from a "View event" round-trip (Back), an opaque cover
  // hides the list until the restored overlay is on screen — no list flash,
  // no fade-in revealing the list behind. Seeded synchronously from the URL.
  const [restoring, setRestoring] = useState(
    () => ['ticket_id', 'reservation_id', 'guest_id', 'reward_id'].some(k => searchParams.get(k))
      && searchParams.get('success') !== 'true',
  );
  const [waitlistEntries, setWaitlistEntries] = useState<{ id: string; eventId: string; eventTitle: string; eventStartAt: string; eventPosterUrl?: string; venueName: string; venueSlug: string; createdAt: string; presaleStartAt?: string; publicSaleStartAt?: string }[]>([]);
  const [seg, setSeg] = useState<OrderBucket>('pending');
  // Guest purchases claimed via /claim and saved to this device's local cache.
  const [guestTickets, setGuestTickets] = useState<GuestTicket[]>([]);
  const [guestQR, setGuestQR] = useState<GuestTicket | null>(null);
  const [guestQRImages, setGuestQRImages] = useState<Record<string, string>>({});

  // Handle URL params for tab selection and success messages
  const tabFromUrl = searchParams.get('tab');
  const success = searchParams.get('success') === 'true';
  const ticketIdFromUrl = searchParams.get('ticket_id');
  const reservationIdFromUrl = searchParams.get('reservation_id');

  useEffect(() => {
    if (success && (ticketIdFromUrl || reservationIdFromUrl)) {
      toast.success(t('tickets.purchaseSuccess'));
      // Clear URL params
      window.history.replaceState({}, '', '/my-orders');
    }
  }, [success, ticketIdFromUrl, reservationIdFromUrl, t]);

  // Reopen a QR overlay when the browser Back button lands here with a restore
  // param (set by the "View event" action before it navigated away). Without
  // this, tapping EVENT from an open ticket then pressing Back would remount
  // this page fresh and drop the user on the list instead of the open ticket.
  const restoredOverlayRef = useRef(false);
  useEffect(() => {
    if (loading || success || restoredOverlayRef.current) return;
    const tid = searchParams.get('ticket_id');
    const rid = searchParams.get('reservation_id');
    const gid = searchParams.get('guest_id');
    const rwid = searchParams.get('reward_id');
    if (!tid && !rid && !gid && !rwid) return;
    let matched = false;
    if (tid) {
      const tk = tickets.find(t => t.id === tid);
      if (tk) { setSelectedTicket(tk); matched = true; }
    } else if (rid) {
      const r = vipReservations.find(v => v.id === rid);
      if (r) { setSelectedVipReservation(r); matched = true; }
    } else if (gid) {
      const g = guestListEntries.find(x => x.id === gid);
      if (g) { setSelectedGuestEntry(g); matched = true; }
    } else if (rwid) {
      const rw = pendingRewards.find(x => x.id === rwid);
      if (rw) { setSelectedReward(rw); matched = true; }
    }
    if (matched) {
      restoredOverlayRef.current = true;
      // Consume the restore params so closing the overlay leaves a clean URL
      // and a re-render can't reopen it. Keep `restoring` true for now — the
      // effect below drops the cover once the (opaque) overlay is mounted.
      const sp = new URLSearchParams(searchParams);
      ['ticket_id', 'reservation_id', 'guest_id', 'reward_id'].forEach(k => sp.delete(k));
      setSearchParams(sp, { replace: true });
    } else {
      // Param present but the order isn't in our data — reveal the list.
      setRestoring(false);
    }
  }, [loading, success, tickets, vipReservations, guestListEntries, pendingRewards, searchParams, setSearchParams]);

  // Drop the restore cover once the overlay is actually on screen: it's opaque
  // and covers the list, so there's nothing left to hide. Deriving the overlay's
  // `instant` (no fade-in) flag from `restoring` keeps normal card taps animated.
  useEffect(() => {
    if (restoring && (selectedTicket || selectedVipReservation || selectedGuestEntry || selectedReward)) {
      setRestoring(false);
    }
  }, [restoring, selectedTicket, selectedVipReservation, selectedGuestEntry, selectedReward]);

  // Safety valve: logged out (auth resolved, no user) → account orders never
  // load, so drop the cover and show the unauthenticated state instead of a
  // permanent dark screen.
  useEffect(() => {
    if (restoring && !authLoading && !user) setRestoring(false);
  }, [restoring, authLoading, user]);

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  // Don't redirect — show inline unauthenticated state instead

  // Load guest-claimed purchases from the local cache (works without an account)
  // and pre-generate their QR images.
  useEffect(() => {
    const gts = getGuestTickets();
    setGuestTickets(gts);
    (async () => {
      const imgs: Record<string, string> = {};
      for (const g of gts) {
        if (g.qrCode) {
          try {
            imgs[g.reference] = await QRCode.toDataURL(g.qrCode, {
              width: 220, margin: 2, color: { dark: '#000000', light: '#ffffff' },
            });
          } catch { /* ignore */ }
        }
      }
      setGuestQRImages(imgs);
    })();
  }, []);

  const handleRemoveGuestTicket = (g: GuestTicket) => {
    removeGuestTicket(g.reference, g.type);
    setGuestTickets((prev) => prev.filter((x) => !(x.reference === g.reference && x.type === g.type)));
  };

  const [clickCollectModeByVenue, setClickCollectModeByVenue] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (user) {
      fetchOrders();
      fetchTickets();
      fetchVipReservations();
      fetchGuestListEntries();
      fetchLoyaltyPoints();
      fetchPendingRewards();
      fetchWaitlistEntries();

      // Subscribe to real-time order updates
      const ordersChannel = supabase
        .channel(uniqueChannel('user-orders-changes'))
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchOrders();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(ordersChannel);
      };
    }
  }, [user]);

  // Fetch click collect mode and bar count for venues from orders
  const fetchVenueInfoForOrders = async (venueIds: string[]) => {
    if (venueIds.length === 0) return;
    
    try {
      const { data } = await supabase
        .from('venues')
        .select('id, click_collect_mode, bar_count')
        .in('id', venueIds);
      
      if (data) {
        const modeMap: Record<string, boolean> = {};
        const barCountMap: Record<string, number> = {};
        data.forEach(v => {
          modeMap[v.id] = v.click_collect_mode || false;
          barCountMap[v.id] = v.bar_count || 1;
        });
        setClickCollectModeByVenue(modeMap);
        setVenueBarCounts(barCountMap);
      }
    } catch (error) {
      console.error('Error fetching venue info:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      // C4: Pagination — limit to 50 most recent orders
      const { data, error } = await supabase
        .from('orders')
        .select('*, events(title, start_at, end_at, poster_url, venue_id, partner_venue_id)')
        .eq('user_id', user?.id)
        .in('status', ['paid', 'served', 'refunded', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Fetch venue info for all venues in orders
      const venueIds = [...new Set((data || []).map(o => o.venue_id))];
      fetchVenueInfoForOrders(venueIds);

      // Fetch venue names for all orders
      let venueNameMap: Map<string, string> = new Map();
      if (venueIds.length > 0) {
        const { data: venuesData } = await supabase
          .from('venues')
          .select('id, name')
          .in('id', venueIds);
        
        if (venuesData) {
          venueNameMap = new Map(venuesData.map(v => [v.id, v.name]));
        }
      }

      // Add venue name to each order and normalize item format
      const ordersWithVenue = (data || []).map(order => {
        // Normalize items: some orders use price/quantity (from Stripe checkout), others use unitPrice/qty
        const normalizedItems = Array.isArray(order.items) 
          ? (order.items as any[]).map((item: any) => ({
              ...item,
              qty: item.qty || item.quantity || 1,
              unitPrice: item.unitPrice ?? item.price ?? 0,
              drinkId: item.drinkId || item.id,
            }))
          : order.items;
        return {
          ...order,
          items: normalizedItems,
          venueName: venueNameMap.get(order.venue_id) || ''
        };
      });

      setOrders(ordersWithVenue);

      // Collect all drink IDs from orders that don't have imgUrl
      const drinkIdsToFetch = new Set<string>();
      (ordersWithVenue || []).forEach(order => {
        const items = Array.isArray(order.items) ? order.items as any[] : [];
        items.forEach(item => {
          if (!item.imgUrl && (item.drinkId || item.id)) {
            drinkIdsToFetch.add(item.drinkId || item.id);
          }
        });
      });

      // Fetch drink images for items without imgUrl
      if (drinkIdsToFetch.size > 0) {
        const { data: drinksData } = await supabase
          .from('drinks')
          .select('id, img_url')
          .in('id', Array.from(drinkIdsToFetch));

        if (drinksData) {
          const imageMap: Record<string, string> = {};
          drinksData.forEach(drink => {
            imageMap[drink.id] = drink.img_url;
          });
          setDrinkImages(imageMap);
        }
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTickets = async () => {
    try {
      const { data: ticketsData, error } = await supabase
        .from('tickets')
        .select(`
          id,
          event_id,
          quantity,
          total_price,
          service_fee,
          status,
          paid_at,
          qr_code,
          used,
          drink_redeemed,
          has_insurance,
          insurance_fee,
          entry_scanned,
          entry_scanned_at,
          refund_amount,
          refund_reason,
          ticket_rounds!inner (name, includes_drink, drink_deadline_type, drink_deadline_hours, drink_cutoff_time),
          events!inner (title, start_at, end_at, venue_id, partner_venue_id, poster_url)
        `)
        .eq('user_id', user?.id)
        .in('status', ['paid', 'refunded'])
        .order('paid_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Fetch venue info (fallback to partner_venue_id for organizer-led co-events)
      const venueIds = [...new Set(ticketsData?.map(t => (t.events as any).venue_id ?? (t.events as any).partner_venue_id).filter(Boolean) || [])];
      const { data: venuesData } = await supabase
        .from('venues')
        .select('id, name, address, city, latitude, longitude')
        .in('id', venueIds);

      const venueMap = new Map(venuesData?.map(v => [v.id, v]) || []);

      const formattedTickets: TicketWithDetails[] = (ticketsData || []).map(t => {
        const v = venueMap.get((t.events as any).venue_id ?? (t.events as any).partner_venue_id);
        return ({
        id: t.id,
        eventId: t.event_id,
        eventTitle: (t.events as any).title,
        eventStartAt: (t.events as any).start_at,
        eventEndAt: (t.events as any).end_at,
        eventPosterUrl: (t.events as any).poster_url,
        venueName: v?.name || '',
        venueAddress: v?.address ?? null,
        venueCity: v?.city ?? null,
        venueLat: v?.latitude ?? null,
        venueLng: v?.longitude ?? null,
        roundName: (t.ticket_rounds as any).name,
        quantity: t.quantity,
        totalPrice: Number(t.total_price),
        serviceFee: Number(t.service_fee),
        status: t.status,
        qrCode: t.qr_code || '',
        used: t.used,
        paidAt: t.paid_at || undefined,
        includesDrink: (t.ticket_rounds as any).includes_drink,
        drinkRedeemed: t.drink_redeemed,
        hasInsurance: t.has_insurance,
        insuranceFee: Number(t.insurance_fee || 0),
        drinkDeadlineType: (t.ticket_rounds as any).drink_deadline_type,
        drinkDeadlineHours: (t.ticket_rounds as any).drink_deadline_hours,
        drinkCutoffTime: (t.ticket_rounds as any).drink_cutoff_time,
        entryScanned: t.entry_scanned,
        entryScannedAt: t.entry_scanned_at || undefined,
        refundAmount: t.refund_amount ? Number(t.refund_amount) : undefined,
        refundReason: t.refund_reason || undefined,
      });
      });

      // Fetch upsell selections for cloakroom badges
      const ticketIds = formattedTickets.map(t => t.id);
      if (ticketIds.length > 0) {
        const { data: upsellSels } = await supabase
          .from('ticket_upsell_selections')
          .select('ticket_id, offer_type')
          .in('ticket_id', ticketIds)
          .eq('offer_type', 'cloakroom');
        
        if (upsellSels && upsellSels.length > 0) {
          const cloakroomTicketIds = new Set(upsellSels.map(u => u.ticket_id));
          formattedTickets.forEach(t => {
            if (cloakroomTicketIds.has(t.id)) {
              t.hasCloakroom = true;
            }
          });
        }
      }

      setTickets(formattedTickets);

      // Widget « Prochaine soirée » (natif) : publie le prochain billet à
      // venir dans le App Group — fire-and-forget, no-op web/Pro.
      publishNextEventFromTickets(formattedTickets);

      // Generate QR code images
      for (const ticket of formattedTickets) {
        if (ticket.qrCode) {
          try {
            const qrDataUrl = await QRCode.toDataURL(ticket.qrCode, {
              width: 200,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            setQrImages(prev => ({ ...prev, [ticket.id]: qrDataUrl }));
          } catch (err) {
            console.error('Error generating QR:', err);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
    }
  };

  const fetchVipReservations = async () => {
    try {
      const { data: reservationsData, error } = await supabase
        .from('table_reservations')
        .select(`
          id,
          event_id,
          guest_count,
          total_price,
          deposit,
          management_fee,
          service_fee,
          status,
          paid_at,
          qr_code,
          full_name,
          zone_id,
          pack_id,
          entry_scanned,
          entry_scanned_at,
          refund_amount,
          refund_reason,
          placement_status,
          requested_table_id,
          assigned_table_id,
          placement_note,
          table_packs (name),
          table_zones (name),
          events!inner (title, start_at, end_at, venue_id, partner_venue_id, poster_url)
        `)
        .eq('user_id', user?.id)
        .in('status', ['paid', 'refunded'])
        .order('paid_at', { ascending: false });

      if (error) throw error;

      // Fetch venue info (fallback to partner_venue_id for organizer-led co-events)
      const venueIds = [...new Set(reservationsData?.map(r => (r.events as any).venue_id ?? (r.events as any).partner_venue_id).filter(Boolean) || [])];
      const { data: venuesData } = await supabase
        .from('venues')
        .select('id, name, address, city, latitude, longitude')
        .in('id', venueIds);

      const venueMap = new Map(venuesData?.map(v => [v.id, v]) || []);

      const formattedReservations: VipReservationWithDetails[] = (reservationsData || []).map(r => {
        const v = venueMap.get((r.events as any).venue_id ?? (r.events as any).partner_venue_id);
        return ({
        id: r.id,
        eventId: r.event_id,
        eventTitle: (r.events as any).title,
        eventStartAt: (r.events as any).start_at,
        eventEndAt: (r.events as any).end_at,
        eventPosterUrl: (r.events as any).poster_url,
        venueName: v?.name || '',
        venueAddress: v?.address ?? null,
        venueCity: v?.city ?? null,
        venueLat: v?.latitude ?? null,
        venueLng: v?.longitude ?? null,
        zoneName: (r.table_zones as any)?.name || '',
        packName: (r.table_packs as any)?.name || '',
        guestCount: r.guest_count || 1,
        totalPrice: Number(r.total_price),
        deposit: Number(r.deposit || 0),
        managementFee: Number(r.management_fee || 0),
        serviceFee: Number(r.service_fee || 0),
        status: r.status,
        qrCode: r.qr_code || '',
        paidAt: r.paid_at || undefined,
        fullName: r.full_name || '',
        entryScanned: r.entry_scanned || false,
        entryScannedAt: r.entry_scanned_at || undefined,
        refundAmount: r.refund_amount ? Number(r.refund_amount) : undefined,
        refundReason: r.refund_reason || undefined,
        placementStatus: (r as any).placement_status || undefined,
        requestedTableName: undefined, // Would need floor plan to resolve
        assignedTableName: undefined,
        placementNote: (r as any).placement_note || undefined,
      });
      });

      setVipReservations(formattedReservations);

      // Generate QR code images for VIP reservations
      for (const reservation of formattedReservations) {
        if (reservation.qrCode) {
          try {
            const qrDataUrl = await QRCode.toDataURL(reservation.qrCode, {
              width: 200,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            setQrImages(prev => ({ ...prev, [reservation.id]: qrDataUrl }));
          } catch (err) {
            console.error('Error generating VIP QR:', err);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching VIP reservations:', error);
    }
  };

  const fetchGuestListEntries = async () => {
    try {
      const { data: entries, error } = await supabase
        .from('guest_list_entries')
        .select(`
          id,
          full_name,
          qr_code,
          status,
          entry_scanned,
          entry_scanned_at,
          created_at,
          entry_type,
          guest_lists!inner (
            free_before_time,
            includes_drink,
            events!inner (id, title, start_at, end_at, venue_id, partner_venue_id, poster_url)
          )
        `)
        .eq('user_id', user?.id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch venue info (fallback to partner_venue_id)
      const venueIds = [...new Set(entries?.map(e => (e.guest_lists as any).events.venue_id ?? (e.guest_lists as any).events.partner_venue_id).filter(Boolean) || [])];
      const { data: venuesData } = await supabase
        .from('venues')
        .select('id, name, address, city, latitude, longitude')
        .in('id', venueIds);
      const venueMap = new Map(venuesData?.map(v => [v.id, v]) || []);

      const formatted: GuestListEntryWithDetails[] = (entries || []).map(e => {
        const ev = (e.guest_lists as any).events;
        const v = venueMap.get(ev.venue_id ?? ev.partner_venue_id);
        return ({
        id: e.id,
        eventId: ev.id,
        eventTitle: ev.title,
        eventStartAt: ev.start_at,
        eventEndAt: ev.end_at,
        eventPosterUrl: ev.poster_url || undefined,
        venueName: v?.name || '',
        venueAddress: v?.address ?? null,
        venueCity: v?.city ?? null,
        venueLat: v?.latitude ?? null,
        venueLng: v?.longitude ?? null,
        freeBeforeTime: (e.guest_lists as any).free_before_time?.substring(0, 5) || '02:00',
        includesDrink: (e.guest_lists as any).includes_drink || (e as any).entry_type === 'drink',
        qrCode: e.qr_code || '',
        status: e.status,
        fullName: e.full_name,
        entryScanned: e.entry_scanned,
        entryScannedAt: e.entry_scanned_at || undefined,
        createdAt: e.created_at,
        entryType: (e as any).entry_type || 'normal',
      });
      });

      setGuestListEntries(formatted);

      // Generate QR codes
      for (const entry of formatted) {
        if (entry.qrCode) {
          try {
            const qrDataUrl = await QRCode.toDataURL(entry.qrCode, {
              width: 200,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            setQrImages(prev => ({ ...prev, [`gl-${entry.id}`]: qrDataUrl }));
          } catch (err) {
            console.error('Error generating GL QR:', err);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching guest list entries:', error);
    }
  };

  const fetchWaitlistEntries = async () => {
    if (!user) return;
    try {
      const normalizedEmail = user.email?.toLowerCase().trim();
      const filters = [`user_id.eq.${user.id}`];
      if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);

      const { data: entries, error } = await supabase
        .from('event_waitlist')
        .select('id, event_id, created_at, show_in_orders, events!inner(title, start_at, venue_id, poster_url, presale_start_at, public_sale_start_at, waitlist_enabled)')
        .or(filters.join(','))
        .eq('show_in_orders', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!entries || entries.length === 0) { setWaitlistEntries([]); return; }

      // Check if user already has paid tickets for these events
      const eventIds = [...new Set(entries.map((e: any) => e.event_id))];
      const { data: userTickets } = await supabase
        .from('tickets')
        .select('event_id')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .in('event_id', eventIds);
      const ticketedEventIds = new Set(userTickets?.map(t => t.event_id) || []);

      const now = Date.now();
      const entriesToHide: string[] = [];

      const filtered = entries.filter((e: any) => {
        // Hide if user already bought a ticket
        if (ticketedEventIds.has(e.event_id)) { entriesToHide.push(e.id); return false; }
        // Hide if event is now in public sale
        const publicStart = e.events.public_sale_start_at ? new Date(e.events.public_sale_start_at).getTime() : null;
        if (publicStart && now >= publicStart) { entriesToHide.push(e.id); return false; }
        // Hide if waitlist was disabled by owner
        if (e.events.waitlist_enabled === false && !e.events.presale_start_at && !e.events.public_sale_start_at) { entriesToHide.push(e.id); return false; }
        return true;
      });

      // Clean up hidden entries in DB so they don't return next time.
      // Best-effort: swallow failures so a transient error never surfaces an
      // unhandled promise rejection (the entries simply re-filter next load).
      if (entriesToHide.length > 0) {
        supabase.from('event_waitlist').update({ show_in_orders: false }).in('id', entriesToHide)
          .then(undefined, () => { /* best-effort cleanup */ });
      }

      const venueIds = [...new Set(filtered.map((e: any) => e.events.venue_id))];
      const { data: venuesData } = await supabase.from('venues').select('id, name').in('id', venueIds.length > 0 ? venueIds : ['_']);
      const venueMap = new Map(venuesData?.map(v => [v.id, v.name]) || []);

      setWaitlistEntries(filtered.map((e: any) => ({
        id: e.id,
        eventId: e.event_id,
        eventTitle: e.events.title,
        eventStartAt: e.events.start_at,
        eventPosterUrl: e.events.poster_url || undefined,
        venueName: venueMap.get(e.events.venue_id) || '',
        venueSlug: e.events.venue_id || '',
        createdAt: e.created_at,
        presaleStartAt: e.events.presale_start_at || undefined,
        publicSaleStartAt: e.events.public_sale_start_at || undefined,
      })));
    } catch (error) {
      console.error('Error fetching waitlist entries:', error);
    }
  };

  const fetchLoyaltyPoints = async () => {
    if (!user) return;
    
    try {
      // Fetch all loyalty transactions for this user to map points to orders/tickets/tables
      const { data: loyaltyData } = await supabase
        .from('customer_loyalty')
        .select('id')
        .eq('user_id', user.id);
      
      if (!loyaltyData || loyaltyData.length === 0) return;
      
      const loyaltyIds = loyaltyData.map(l => l.id);
      
      const { data: transactions } = await supabase
        .from('loyalty_transactions')
        .select('reference_type, reference_id, points')
        .in('customer_loyalty_id', loyaltyIds)
        .eq('transaction_type', 'earn');
      
      if (transactions) {
        const pointsMap: Record<string, number> = {};
        transactions.forEach((tx: LoyaltyTransaction) => {
          if (tx.reference_id) {
            pointsMap[tx.reference_id] = tx.points;
          }
        });
        setLoyaltyPoints(pointsMap);
      }
    } catch (error) {
      console.error('Error fetching loyalty points:', error);
    }
  };

  const fetchPendingRewards = async () => {
    if (!user) return;
    
    try {
      const { data: redemptions } = await supabase
        .from('reward_redemptions')
        .select(`
          id,
          points_spent,
          qr_code,
          expires_at,
          created_at,
          status,
          metadata,
          venue_id,
          loyalty_rewards (name, reward_type, reward_value),
          venues:venue_id (name, address, city, latitude, longitude)
        `)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (redemptions) {
        // Collect venue IDs to fetch the next active event for each venue
        const venueIds = [...new Set(redemptions.map((r: any) => r.venue_id))];
        
        // Fetch the next active event for each venue (for free_ticket rewards)
        const venueEventsMap: Record<string, { id: string; title: string; startAt: string; endAt: string; posterUrl: string | null }> = {};

        if (venueIds.length > 0) {
          const { data: eventsData } = await supabase
            .from('events')
            .select('id, title, start_at, end_at, poster_url, venue_id')
            .in('venue_id', venueIds)
            .eq('is_active', true)
            .gte('start_at', new Date().toISOString())
            .order('start_at', { ascending: true });

          if (eventsData) {
            // For each venue, take the first (next) event
            eventsData.forEach(e => {
              if (!venueEventsMap[e.venue_id]) {
                venueEventsMap[e.venue_id] = {
                  id: e.id,
                  title: e.title,
                  startAt: e.start_at,
                  endAt: e.end_at,
                  posterUrl: e.poster_url
                };
              }
            });
          }
        }
        
        const formattedRewards: PendingReward[] = redemptions.map((r: any) => {
          const rewardType = r.loyalty_rewards?.reward_type || 'free_drink';
          
          // For free tickets, use the next event of the venue
          // For free drinks, we also show event info if available
          const eventDetails = venueEventsMap[r.venue_id];
          
          return {
            id: r.id,
            rewardName: r.loyalty_rewards?.name || 'Reward',
            rewardType,
            pointsSpent: r.points_spent,
            qrCode: r.qr_code,
            expiresAt: r.expires_at,
            createdAt: r.created_at,
            venueName: r.venues?.name || '',
            venueId: r.venue_id,
            venueAddress: r.venues?.address ?? null,
            venueCity: r.venues?.city ?? null,
            venueLat: r.venues?.latitude ?? null,
            venueLng: r.venues?.longitude ?? null,
            metadata: r.metadata as PendingReward['metadata'],
            eventDetails: eventDetails ? { id: eventDetails.id, ...eventDetails } : undefined,
          };
        });
        setPendingRewards(formattedRewards);
        
        // Generate QR codes for pending rewards
        for (const reward of formattedRewards) {
          if (reward.qrCode && !qrImages[`reward-${reward.id}`]) {
            try {
              const qrDataUrl = await QRCode.toDataURL(reward.qrCode, {
                width: 200,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
              });
              setQrImages(prev => ({ ...prev, [`reward-${reward.id}`]: qrDataUrl }));
            } catch (err) {
              console.error('Error generating reward QR:', err);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching pending rewards:', error);
    }
  };

  const formatDrinkDeadline = (ticket: TicketWithDetails): string | null => {
    if (!ticket.includesDrink) return null;
    
    if (ticket.drinkDeadlineType === 'fixed_time' && ticket.drinkCutoffTime) {
      return ticket.drinkCutoffTime.slice(0, 5); // "HH:MM"
    }
    
    if (ticket.drinkDeadlineType === 'hours_after_start' && ticket.drinkDeadlineHours) {
      const eventStart = new Date(ticket.eventStartAt);
      const deadline = addHours(eventStart, ticket.drinkDeadlineHours);
      return format(deadline, 'HH:mm');
    }
    
    return null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500';
      case 'paid':
        return 'bg-blue-500';
      case 'served':
        return 'bg-green-500';
      case 'refunded':
      case 'cancelled':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusLabel = (status: string) => {
    return t(`orders.status.${status}`) || status;
  };

  const getPrepStatusColor = (status: string) => {
    switch (status) {
      case 'queue': return 'bg-yellow-500';
      case 'preparing': return 'bg-blue-500';
      case 'ready': return 'bg-green-500';
      case 'served': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  const getPrepStatusLabel = (status: string) => {
    return t(`clickCollect.status${status.charAt(0).toUpperCase() + status.slice(1)}`) || status;
  };

  const handleRequestPreparation = async (orderId: string, selectedBar?: string) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      if (order.events) {
        const now = new Date();
        const eventStart = new Date(order.events.start_at);
        const allowedTime = new Date(eventStart.getTime() - 5 * 60 * 1000);
        if (now < allowedTime) {
          toast.error(t('clickCollect.eventNotStarted'));
          return;
        }
      }

      const barCount = venueBarCounts[order.venue_id] || 1;
      if (barCount > 1 && !selectedBar) {
        setBarSelectionOrder(order);
        return;
      }

      const { error } = await supabase
        .from('orders')
        .update({ 
          prep_requested: true,
          prep_status: 'queue',
          selected_bar: selectedBar || null
        })
        .eq('id', orderId);

      if (error) throw error;

      toast.success(t('clickCollect.prepRequestSuccess'));
      fetchOrders();
    } catch (error) {
      console.error('Error requesting preparation:', error);
      toast.error(t('clickCollect.prepRequestError'));
    }
  };

  const handleRequestPrepWithItems = async (order: Order, expandedIndices: number[], selectedBar?: string) => {
    // Check bar selection first
    const barCount = venueBarCounts[order.venue_id] || 1;
    if (barCount > 1 && !selectedBar) {
      setPrepWithItemsBarOrder({ order, indices: expandedIndices });
      return;
    }

    try {
      const sourceOrders = (order as any)._sourceOrders as any[] | undefined;
      
      if (sourceOrders && sourceOrders.length > 1) {
        const expandedMap: { sourceOrderId: string; sourceIdx: number; localExpandedIdx: number }[] = [];
        sourceOrders.forEach(so => {
          let localIdx = 0;
          so.items.forEach((item: any) => {
            for (let i = 0; i < item.qty; i++) {
              expandedMap.push({ sourceOrderId: so.id, sourceIdx: localIdx, localExpandedIdx: localIdx });
              localIdx++;
            }
          });
        });

        const perOrder: Record<string, number[]> = {};
        expandedIndices.forEach(idx => {
          const mapping = expandedMap[idx];
          if (mapping) {
            if (!perOrder[mapping.sourceOrderId]) perOrder[mapping.sourceOrderId] = [];
            perOrder[mapping.sourceOrderId].push(mapping.localExpandedIdx);
          }
        });

        for (const [orderId, indices] of Object.entries(perOrder)) {
          const so = sourceOrders.find(s => s.id === orderId);
          if (!so) continue;
          
          const updatedItems = so.items.map((item: any) => ({
            ...item,
            prepUnits: item.prepUnits || Array(item.qty).fill(false),
          }));

          let expandedIdx = 0;
          updatedItems.forEach((item: any) => {
            for (let i = 0; i < item.qty; i++) {
              if (indices.includes(expandedIdx)) {
                item.prepUnits[i] = true;
              }
              expandedIdx++;
            }
          });

          await supabase
            .from('orders')
            .update({ items: updatedItems, prep_requested: true, prep_status: 'queue', selected_bar: selectedBar || null })
            .eq('id', orderId);
        }
      } else {
        const items = Array.isArray(order.items) ? (order.items as any[]) : [];
        const updatedItems = items.map((item: any) => ({
          ...item,
          prepUnits: item.prepUnits || Array(item.qty).fill(false),
        }));

        let expandedIdx = 0;
        updatedItems.forEach((item: any) => {
          for (let i = 0; i < item.qty; i++) {
            if (expandedIndices.includes(expandedIdx)) {
              item.prepUnits[i] = true;
            }
            expandedIdx++;
          }
        });

        await supabase
          .from('orders')
          .update({ items: updatedItems, prep_requested: true, prep_status: 'queue', selected_bar: selectedBar || null })
          .eq('id', order.id);
      }

      toast.success(t('clickCollect.prepRequestSuccess'));
      fetchOrders();
    } catch (error) {
      console.error('Error requesting preparation with items:', error);
      toast.error(t('clickCollect.prepRequestError'));
    }
  };

  const handleBarSelected = (barName: string) => {
    if (barSelectionOrder) {
      handleRequestPreparation(barSelectionOrder.id, barName);
      setBarSelectionOrder(null);
    }
  };

  const handlePrepWithItemsBarSelected = (barName: string) => {
    if (prepWithItemsBarOrder) {
      handleRequestPrepWithItems(prepWithItemsBarOrder.order, prepWithItemsBarOrder.indices, barName);
      setPrepWithItemsBarOrder(null);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm(t('owner.confirmDelete'))) return;

    try {
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId)
        .eq('user_id', user?.id);

      if (error) throw error;

      toast.success(t('owner.employeeDeleted'));
      fetchOrders();
    } catch (error) {
      console.error('Error deleting order:', error);
      toast.error(t('owner.errorDeleting'));
    }
  };

  const handleEditOrder = (order: Order) => {
    setEditingOrder(order);
    const items = Array.isArray(order.items) ? order.items as any[] : [];
    setEditItems(items.map((item: any) => ({
      id: item.id || '',
      name: item.name || '',
      qty: item.qty || 1,
      unitPrice: item.unitPrice || 0
    })));
  };

  const updateItemQty = (itemId: string, delta: number) => {
    setEditItems(prev => 
      prev.map(item => 
        item.id === itemId 
          ? { ...item, qty: Math.max(1, item.qty + delta) }
          : item
      )
    );
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;

    const newTotal = editItems.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);

    try {
      const { error } = await supabase
        .from('orders')
        .update({ 
          items: editItems as any,
          total: newTotal
        })
        .eq('id', editingOrder.id)
        .eq('status', 'pending');

      if (error) throw error;

      toast.success('Commande mise à jour');
      setEditingOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error updating order:', error);
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const handlePayOrder = async (order: Order) => {
    try {
      const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (!stripeKey) {
        toast.error('Configuration de paiement manquante');
        return;
      }

      const stripe = await loadStripe(stripeKey);
      if (!stripe) {
        toast.error('Erreur de chargement Stripe');
        return;
      }

      const response = await invokeEdgeFunction('create-checkout', {
        body: { orderId: order.id },
      });

      if (response.error) throw response.error;

      if (response.data?.code === 'PAYMENTS_DISABLED') {
        toast.error(t('payments.disabledBanner'));
        return;
      }

      const { sessionId } = response.data;
      window.location.href = `/verify-payment?session_id=${sessionId}`;
    } catch (error) {
      console.error('Error initiating payment:', error);
      toast.error('Erreur lors du paiement');
    }
  };

  const handleCancelTicket = async () => {
    if (!ticketToCancel) return;
    
    setCancellingTicket(true);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-ticket', {
        body: { ticketId: ticketToCancel.id },
      });

      if (error) throw error;

      toast.success(t('tickets.cancelSuccess'));
      setTicketToCancel(null);
      fetchTickets();
    } catch (error: any) {
      console.error('Error cancelling ticket:', error);
      toast.error(error.message || t('tickets.cancelError'));
    } finally {
      setCancellingTicket(false);
    }
  };

  const calculateRefundAmount = (ticket: TicketWithDetails): number => {
    return ticket.totalPrice - ticket.serviceFee - (ticket.insuranceFee || 0);
  };

  const canCancelTicket = (ticket: TicketWithDetails): boolean => {
    if (!ticket.hasInsurance) return false;
    const eventStart = new Date(ticket.eventStartAt);
    const now = new Date();
    const hoursUntilEvent = (eventStart.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntilEvent >= 24;
  };

  const now = new Date();

  const isEndedEvent = (o: Order) => {
    if (!o.events) return false;
    // Add 2h grace period after event end for drink collection
    const graceEnd = new Date(o.events.end_at);
    graceEnd.setHours(graceEnd.getHours() + 2);
    return graceEnd < now;
  };

  const paidOrders = orders.filter(o =>
    o.status === 'paid' &&
    !o.served_at &&
    o.prep_status !== 'served' &&
    !o.archived &&
    !isEndedEvent(o)
  );

  const pendingOrders = orders.filter(o =>
    o.status === 'pending' &&
    !o.archived &&
    !isEndedEvent(o)
  );

  const archivedOrders = orders.filter(o =>
    o.archived ||
    o.status === 'served' ||
    o.status === 'refunded' ||
    o.status === 'cancelled' ||
    !!o.served_at ||
    o.prep_status === 'served' ||
    isEndedEvent(o)
  );

  // Filter active and past tickets
  // Scanned tickets remain active until the event ends (needed for cloakroom access)
  const activeTickets = tickets.filter(t => {
    const eventEnd = new Date(t.eventEndAt);
    if (t.status === 'refunded' || t.status === 'cancelled') return false;
    return eventEnd >= now;
  });

  const pastTickets = tickets.filter(t => {
    const eventEnd = new Date(t.eventEndAt);
    if (t.status === 'refunded' || t.status === 'cancelled') return true;
    return eventEnd < now;
  });

  // Filter active and past VIP reservations
  const activeVipReservations = vipReservations.filter(r => {
    const eventEnd = new Date(r.eventEndAt);
    // Refunded reservations should go to archived, not active
    if (r.status === 'refunded' || r.status === 'cancelled') return false;
    return eventEnd >= now;
  });

  const pastVipReservations = vipReservations.filter(r => {
    const eventEnd = new Date(r.eventEndAt);
    // Refunded/cancelled reservations always go to past
    if (r.status === 'refunded' || r.status === 'cancelled') return true;
    return eventEnd < now;
  });

  // Filter active and past guest list entries
  // Scanned entries remain active until event ends (needed for cloakroom access)
  const activeGuestListEntries = guestListEntries.filter(e => {
    const eventEnd = new Date(e.eventEndAt);
    if (e.status === 'cancelled') return false;
    return eventEnd >= now;
  });

  const pastGuestListEntries = guestListEntries.filter(e => {
    const eventEnd = new Date(e.eventEndAt);
    if (e.status === 'cancelled') return true;
    return eventEnd < now;
  });

  if (authLoading || (loading && user)) {
    return <OrdersSkeleton />;
  }

  // Guest with locally-saved purchases — render them as real ticket cards.
  if (!user && guestTickets.length > 0) {
    const guestLabels = {
      scanThisQR: t('orders.scanThisQR'),
      shareThisQR: t('orders.shareThisQR'),
      valid: t('orders.valid'),
      scanned: t('orders.scannedLabel'),
    };
    const fmtGuest = (iso?: string) => {
      if (!iso) return '';
      try { return format(new Date(iso), 'EEE d MMM · HH:mm', { locale: getLocale() }); } catch { return ''; }
    };
    const typeFallback = (g: GuestTicket) =>
      g.type === 'table' ? t('claim.tabTables') : g.type === 'order' ? t('claim.tabDrinks') : t('claim.tabTickets');

    return (
      <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }}>
        <header
          className="sticky top-0 z-40"
          style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4">
            <button
              onClick={() => navigate('/')}
              className="grid place-items-center cursor-pointer"
              style={{ width: 36, height: 36, borderRadius: 2, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="font-mono uppercase" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', color: '#9A9A9A' }}>{t('orders.myOrders')}</span>
          </div>
        </header>

        <div className="mx-auto max-w-md px-4 py-4 space-y-4">
          <div className="px-1">
            <h2 className="font-display uppercase" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1, color: '#FFFFFF' }}>
              {t('orders.myOrders')}
            </h2>
            <p className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: '.08em', color: '#9A9A9A', marginTop: 7 }}>
              {guestTickets.length} · {t('guest.savedOnDevice')}
            </p>
          </div>

          {/* Save-to-account nudge */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('guest.saveToAccountHint')}</p>
            <button onClick={() => navigate('/auth?redirect=/my-orders')} className="text-xs font-semibold text-primary whitespace-nowrap">
              {t('guest.loginOption')}
            </button>
          </div>

          {/* Ticket cards */}
          <div className="flex flex-col gap-3">
            {guestTickets.map((g) => (
              <div key={`${g.type}-${g.reference}`} className="overflow-hidden rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#141414' }}>
                {g.eventPoster && <img src={g.eventPoster} alt={g.eventTitle || ''} className="w-full h-28 object-cover" />}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{g.eventTitle || typeFallback(g)}</p>
                      {g.venueName && <p className="text-sm text-muted-foreground truncate">{g.venueName}</p>}
                      {g.eventStartAt && <p className="text-xs text-muted-foreground mt-0.5">{fmtGuest(g.eventStartAt)}</p>}
                      {(g.roundName || g.zoneName) && (
                        <p className="text-xs text-muted-foreground mt-0.5">{g.roundName || [g.zoneName, g.packName].filter(Boolean).join(' — ')}</p>
                      )}
                    </div>
                    <button onClick={() => handleRemoveGuestTicket(g)} className="shrink-0 p-1 text-muted-foreground/60 hover:text-muted-foreground" aria-label="Remove">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">{g.reference}</p>
                  <button
                    onClick={() => setGuestQR(g)}
                    disabled={!g.qrCode}
                    className="mt-3 w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50"
                  >
                    <QrCode className="h-4 w-4" />{t('orders.openMyQR')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate('/claim')}
            className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono font-bold uppercase"
            style={{ height: 48, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#E5E5E5', fontSize: 11.5, letterSpacing: '.1em' }}
          >
            <QrCode className="h-4 w-4" />
            {t('guest.findOrder')}
          </button>
        </div>

        {guestQR && (
          <OrderQROverlay
            kind={guestQR.type === 'table' ? 'vip' : guestQR.type === 'order' ? 'drink' : 'ticket'}
            title={guestQR.eventTitle || typeFallback(guestQR)}
            venueName={guestQR.venueName || ''}
            idLabel={guestQR.type === 'table'
              ? [guestQR.zoneName, guestQR.packName].filter(Boolean).join(' — ')
              : `${guestQR.quantity || 1}× ${guestQR.roundName || ''}`}
            slides={[{ qrImage: guestQRImages[guestQR.reference] }]}
            labels={guestLabels}
            onClose={() => setGuestQR(null)}
            posterUrl={guestQR.eventPoster}
            posterThumb={guestQR.eventPoster}
            kindLabel={guestQR.type === 'table' ? t('orders.kindVip') : guestQR.type === 'order' ? t('orders.kindDrink') : t('orders.kindTicket')}
          />
        )}

        <BottomNav />
      </div>
    );
  }

  // Unauthenticated state — show claim order + login options
  if (!user) {
    return (
      <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }}>
        <header
          className="sticky top-0 z-40"
          style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4">
            <button
              onClick={() => navigate('/')}
              className="grid place-items-center cursor-pointer"
              style={{ width: 36, height: 36, borderRadius: 2, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="font-mono uppercase" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', color: '#9A9A9A' }}>{t('orders.title')}</span>
          </div>
        </header>

        <div className="mx-auto max-w-md px-5 py-14">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center text-center">
            {/* Icon tile with halo */}
            <div className="relative flex items-center justify-center" style={{ marginBottom: 24 }}>
              <div style={{ position: 'absolute', width: 170, height: 170, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,25,44,0.14) 0%, transparent 70%)' }} />
              <div
                className="grid place-items-center"
                style={{ width: 68, height: 68, borderRadius: 14, position: 'relative', background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.28)' }}
              >
                <CreditCard style={{ width: 28, height: 28, color: '#E8192C' }} strokeWidth={1.8} />
              </div>
            </div>

            <h2 className="font-display uppercase" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1, marginBottom: 10, color: '#FFFFFF' }}>
              {t('guest.ordersNotConnected')}
            </h2>
            <p className="font-mono" style={{ fontSize: 11.5, lineHeight: 1.6, color: '#9A9A9A', maxWidth: 280, marginBottom: 28 }}>
              {t('guest.ordersNotConnectedDesc')}
            </p>

            <div className="w-full flex flex-col gap-3">
              <button
                onClick={() => navigate('/auth?redirect=/my-orders')}
                className="w-full flex items-center justify-center gap-2 cursor-pointer border-0 font-mono font-bold uppercase"
                style={{ height: 48, borderRadius: 999, background: '#E8192C', color: '#fff', fontSize: 11.5, letterSpacing: '.1em', boxShadow: '0 10px 28px -10px rgba(232,25,44,0.7)' }}
              >
                <LogIn className="h-4 w-4" />
                {t('guest.loginOption')}
              </button>

              <button
                onClick={() => navigate('/claim')}
                className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono font-bold uppercase"
                style={{ height: 48, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#E5E5E5', fontSize: 11.5, letterSpacing: '.1em' }}
              >
                <QrCode className="h-4 w-4" />
                {t('guest.findOrder')}
              </button>
            </div>

            <p className="font-mono" style={{ fontSize: 10.5, lineHeight: 1.6, color: '#5A5A5E', marginTop: 18, maxWidth: 280 }}>
              {t('guest.findOrderHint')}
            </p>
          </motion.div>
        </div>

        <BottomNav />
      </div>
    );
  }

  // Filter pending rewards by type - only show free_ticket rewards in tickets tab
  // Free drink rewards are shown as orders in the drinks tab
  const pendingTicketRewards = pendingRewards.filter(r => r.rewardType === 'free_ticket');
  
  // Filter free drink orders (loyalty rewards with total = 0 or isLoyaltyReward flag)
  const rewardOrders = paidOrders.filter(o => 
    (Array.isArray(o.items) && o.items.some((item: any) => item.isLoyaltyReward === true)) || Number(o.total) === 0
  );
  
  // Filter regular paid orders (excluding rewards)
  const regularPaidOrders = paidOrders.filter(o => 
    !(Array.isArray(o.items) && o.items.some((item: any) => item.isLoyaltyReward === true)) && Number(o.total) > 0
  );
  
  const hasDrinkContent = paidOrders.length > 0 || pendingOrders.length > 0 || archivedOrders.length > 0;
  const hasTicketContent = tickets.length > 0 || vipReservations.length > 0 || pendingTicketRewards.length > 0 || guestListEntries.length > 0 || waitlistEntries.length > 0;

  /* ============================================================
     Unified temporal model — bucket every order into
     En attente (ce soir) / À venir / Passés.
     ============================================================ */
  // Nightlife "tonight" window: anything starting before the next 6 AM.
  const tonightCutoff = new Date(now);
  tonightCutoff.setHours(6, 0, 0, 0);
  if (now.getHours() >= 6) tonightCutoff.setDate(tonightCutoff.getDate() + 1);
  const startsTonight = (iso?: string) => (!iso ? true : new Date(iso) <= tonightCutoff);
  const fmtDate = (iso?: string) => (iso ? format(new Date(iso), 'dd MMM', { locale: getLocale() }).toUpperCase() : undefined);
  const fmtTime = (iso?: string) => (iso ? format(new Date(iso), 'HH:mm') : undefined);

  const entries: UnifiedOrderEntry[] = [];

  // Active tickets
  activeTickets.forEach(tk => {
    const tonight = startsTonight(tk.eventStartAt);
    entries.push({
      id: `tk-${tk.id}`, kind: 'ticket', bucket: tonight ? 'pending' : 'upcoming',
      title: tk.eventTitle, venueName: tk.venueName, sortAt: new Date(tk.eventStartAt).getTime(),
      dateLabel: fmtDate(tk.eventStartAt), time: fmtTime(tk.eventStartAt),
      subtitle: `${tk.quantity}× ${tk.roundName}`,
      price: Math.round(tk.totalPrice), free: tk.totalPrice === 0, scanned: tk.entryScanned,
      ctaLabel: t('orders.openMyQR'), ctaIcon: 'qr',
      onAction: () => setSelectedTicket(tk),
    });
  });
  // Active VIP reservations
  activeVipReservations.forEach(r => {
    const tonight = startsTonight(r.eventStartAt);
    entries.push({
      id: `vip-${r.id}`, kind: 'vip', bucket: tonight ? 'pending' : 'upcoming',
      title: r.eventTitle, venueName: r.venueName, sortAt: new Date(r.eventStartAt).getTime(),
      dateLabel: fmtDate(r.eventStartAt), time: fmtTime(r.eventStartAt),
      subtitle: `${r.zoneName || r.packName} · ${r.guestCount} ${t('vipTable.guests') || 'pers.'}`,
      price: Math.round(r.deposit || r.totalPrice), free: false, scanned: r.entryScanned,
      ctaLabel: t('orders.openMyQR'), ctaIcon: 'qr',
      onAction: () => setSelectedVipReservation(r),
    });
  });
  // Active guest list entries
  activeGuestListEntries.forEach(g => {
    const tonight = startsTonight(g.eventStartAt);
    entries.push({
      id: `gl-${g.id}`, kind: 'guestlist', bucket: tonight ? 'pending' : 'upcoming',
      title: g.eventTitle, venueName: g.venueName, sortAt: new Date(g.eventStartAt).getTime(),
      dateLabel: fmtDate(g.eventStartAt), time: fmtTime(g.eventStartAt),
      subtitle: `Guest List${g.includesDrink ? ' + boisson' : ''} · ${t('guestList.freeBefore') || ''} ${g.freeBeforeTime}`.trim(),
      price: 0, free: true, scanned: g.entryScanned,
      ctaLabel: t('orders.openMyQR'), ctaIcon: 'qr',
      onAction: () => setSelectedGuestEntry(g),
    });
  });
  // Pending free-ticket rewards (loyalty)
  pendingTicketRewards.forEach(rw => {
    const startAt = rw.eventDetails?.startAt;
    const tonight = startsTonight(startAt);
    entries.push({
      id: `rw-${rw.id}`, kind: 'reward', bucket: tonight ? 'pending' : 'upcoming',
      title: rw.eventDetails?.title || rw.metadata?.eventTitle || rw.rewardName, venueName: rw.venueName,
      sortAt: startAt ? new Date(startAt).getTime() : now.getTime(),
      dateLabel: fmtDate(startAt), time: fmtTime(startAt),
      subtitle: rw.metadata?.roundName || t('loyalty.freeTicket'),
      price: 0, free: true,
      ctaLabel: t('orders.openMyQR'), ctaIcon: 'qr',
      onAction: () => setSelectedReward(rw),
    });
  });
  // Drinks — paid (collect) + reward drinks
  [...rewardOrders, ...regularPaidOrders].forEach(o => {
    const startAt = o.events?.start_at;
    const tonight = startsTonight(startAt);
    const items = Array.isArray(o.items) ? (o.items as any[]) : [];
    const itemNames = items.map(i => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`);
    entries.push({
      id: `dr-${o.id}`, kind: 'drink', bucket: tonight ? 'pending' : 'upcoming',
      title: o.events?.title || o.venueName || t('orders.drinkOrder'), venueName: o.venueName || '',
      sortAt: startAt ? new Date(startAt).getTime() : new Date(o.created_at).getTime(),
      dateLabel: fmtDate(startAt), time: fmtTime(startAt),
      subtitle: itemNames.slice(0, 3).join(' · ') || `${items.length} ${t('orders.items')}`,
      price: Math.round(Number(o.total)), free: Number(o.total) === 0,
      ctaLabel: t('orders.viewOrder'), ctaIcon: 'qr',
      onAction: () => { setCollectMode(false); setSelectedDrinkOrder(o); },
    });
  });
  // Drinks — pending payment (always tonight bucket, CTA = pay)
  pendingOrders.forEach(o => {
    const items = Array.isArray(o.items) ? (o.items as any[]) : [];
    const itemNames = items.map(i => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`);
    entries.push({
      id: `drp-${o.id}`, kind: 'drink', bucket: 'pending',
      title: o.events?.title || o.venueName || t('orders.drinkOrder'), venueName: o.venueName || '',
      sortAt: new Date(o.created_at).getTime(),
      dateLabel: fmtDate(o.events?.start_at), time: fmtTime(o.events?.start_at),
      subtitle: itemNames.slice(0, 3).join(' · ') || `${items.length} ${t('orders.items')}`,
      price: Math.round(Number(o.total)), free: false,
      ctaLabel: t('orders.payNow'), ctaIcon: 'pay',
      onAction: () => handlePayOrder(o),
    });
  });
  // Waitlist — future notifications
  waitlistEntries.forEach(w => {
    entries.push({
      id: `wl-${w.id}`, kind: 'waitlist', bucket: 'upcoming',
      title: w.eventTitle, venueName: w.venueName, sortAt: new Date(w.eventStartAt).getTime(),
      dateLabel: fmtDate(w.eventStartAt), time: fmtTime(w.eventStartAt),
      subtitle: t('waitlist.myWaitlists'),
      price: 0, free: false,
      onAction: () => navigate(`/club/${w.venueSlug}/event/${w.eventId}`),
    });
  });

  // Past — tickets, VIP, guest list, drinks
  pastTickets.forEach(tk => entries.push({
    id: `tk-${tk.id}`, kind: 'ticket', bucket: 'past', title: tk.eventTitle, venueName: tk.venueName,
    sortAt: new Date(tk.eventStartAt).getTime(), dateLabel: fmtDate(tk.eventStartAt),
    price: Math.round(tk.totalPrice + tk.serviceFee), free: false,
    pastStatus: tk.status === 'refunded' ? 'refunded' : tk.used ? 'used' : 'scanned',
  }));
  pastVipReservations.forEach(r => entries.push({
    id: `vip-${r.id}`, kind: 'vip', bucket: 'past', title: r.eventTitle, venueName: r.venueName,
    sortAt: new Date(r.eventStartAt).getTime(), dateLabel: fmtDate(r.eventStartAt),
    price: Math.round(r.deposit + r.managementFee), free: false,
    pastStatus: r.status === 'refunded' ? 'refunded' : r.entryScanned ? 'used' : 'scanned',
  }));
  pastGuestListEntries.forEach(g => entries.push({
    id: `gl-${g.id}`, kind: 'guestlist', bucket: 'past', title: g.eventTitle, venueName: g.venueName,
    sortAt: new Date(g.eventStartAt).getTime(), dateLabel: fmtDate(g.eventStartAt),
    price: 0, free: true, pastStatus: g.entryScanned ? 'used' : 'scanned',
  }));
  archivedOrders.forEach(o => entries.push({
    id: `dr-${o.id}`, kind: 'drink', bucket: 'past',
    title: o.events?.title || o.venueName || t('orders.drinkOrder'), venueName: o.venueName || '',
    sortAt: new Date(o.created_at).getTime(), dateLabel: fmtDate(o.events?.start_at),
    price: Math.round(Number(o.total)), free: Number(o.total) === 0,
    pastStatus: o.status === 'refunded' ? 'refunded' : 'used',
  }));

  const pendingEntries = entries.filter(e => e.bucket === 'pending').sort((a, b) => a.sortAt - b.sortAt);
  const upcomingEntries = entries.filter(e => e.bucket === 'upcoming').sort((a, b) => a.sortAt - b.sortAt);
  const pastEntries = entries.filter(e => e.bucket === 'past').sort((a, b) => b.sortAt - a.sortAt);

  const bucketCounts: Record<OrderBucket, number> = {
    pending: pendingEntries.length, upcoming: upcomingEntries.length, past: pastEntries.length,
  };
  const segLabels: Record<OrderBucket, string> = {
    pending: t('orders.segPending'), upcoming: t('orders.segUpcoming'), past: t('orders.segPast'),
  };
  const pastStatusLabels = {
    scanned: t('orders.scannedLabel'), used: t('orders.usedLabel'), refunded: t('orders.refundedLabel'),
  };
  const totalActive = pendingEntries.length + upcomingEntries.length;
  const activeEntries = seg === 'pending' ? pendingEntries : seg === 'upcoming' ? upcomingEntries : pastEntries;
  const kickerLabel = seg === 'pending'
    ? `${t('orders.tonight').toUpperCase()} · ${format(now, 'dd MMM', { locale: getLocale() }).toUpperCase()}`
    : seg === 'upcoming' ? t('orders.upcomingEvents') : t('orders.history');

  const qrOverlayLabels = {
    scanThisQR: t('orders.scanThisQR'),
    shareThisQR: t('orders.shareThisQR'),
    valid: t('orders.valid'),
    scanned: t('orders.scannedLabel'),
  };

  // Libellés de type localisés — chips « Billet / Boisson / VIP… » sur les
  // cartes et les overlays QR, pour qu'une boisson ne ressemble jamais à un billet.
  const kindLabels = {
    ticket: t('orders.kindTicket'),
    vip: t('orders.kindVip'),
    guestlist: t('orders.kindGuestlist'),
    reward: t('orders.kindReward'),
    drink: t('orders.kindDrink'),
    waitlist: t('orders.kindWaitlist'),
  } as const;

  // "SAT 14 JUN · 23:00" — shown inside the QR overlay info card
  const fmtWhen = (iso?: string) =>
    (iso ? format(new Date(iso), 'EEE d MMM · HH:mm', { locale: getLocale() }).toUpperCase() : undefined);

  // Interactive quick actions for an open QR overlay: itinéraire (Maps),
  // la soirée (event page), agenda (Google Calendar), partage.
  const buildQRActions = (opts: {
    eventId?: string | null;
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    venue: { name?: string | null; address?: string | null; city?: string | null; lat?: number | null; lng?: number | null };
    restoreParam?: string;
    restoreId?: string | null;
    /** Pass Apple Wallet (billets + tables VIP) — visible sur appareil Apple. */
    wallet?: { type: 'ticket' | 'table'; id: string };
  }): QRAction[] => {
    const acts: QRAction[] = [];
    if (opts.wallet && isAppleDevice) {
      const w = opts.wallet;
      acts.push({ icon: Wallet, label: t('orders.addToWallet'), accent: true, onClick: () => {
        haptics.medium();
        addToWallet(w.type, w.id).catch(() => toast.error(t('confirmation.walletError')));
      } });
    }
    const mapsUrl = buildVenueMapsUrl(opts.venue);
    if (mapsUrl) {
      acts.push({ icon: MapPin, label: t('orders.directions'), accent: true, onClick: () => window.open(mapsUrl, '_blank', 'noopener,noreferrer') });
    }
    if (opts.eventId) {
      acts.push({ icon: Info, label: t('orders.viewEvent'), onClick: () => {
        // Stash the open overlay in the URL so pressing Back from the event
        // page reopens this ticket (see the restore effect) instead of the list.
        if (opts.restoreParam && opts.restoreId) {
          const sp = new URLSearchParams(searchParams);
          sp.set(opts.restoreParam, opts.restoreId);
          window.history.replaceState(window.history.state, '', `${location.pathname}?${sp.toString()}`);
        }
        navigate(`/event/${opts.eventId}`);
      } });
    }
    if (opts.startAt) {
      // Natif : feuille Apple Calendar pré-remplie (EventKit). Web : Google Agenda.
      acts.push({ icon: Calendar, label: t('orders.addToCal'), onClick: () => {
        void addToCalendar({ title: opts.title, startAt: opts.startAt, endAt: opts.endAt, location: venueLocationText(opts.venue) });
      } });
    }
    return acts;
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: '#0A0A0A' }}>
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4">
          <button
            onClick={() => {
              const exclusiveClub = sessionStorage.getItem('exclusiveClub');
              const lastExternalPage = sessionStorage.getItem('lastExternalPage');
              if (exclusiveClub) {
                navigate(`/club/${exclusiveClub}`);
              } else if (lastExternalPage) {
                navigate(lastExternalPage);
              } else {
                navigate('/');
              }
            }}
            className="grid place-items-center cursor-pointer"
            style={{ width: 36, height: 36, borderRadius: 2, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="font-mono uppercase" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', color: '#9A9A9A' }}>{t('orders.myOrders')}</span>
        </div>
      </header>

      <PageFade className="mx-auto max-w-md px-4 py-4">
        {(() => {
          const totallyEmpty = totalActive === 0 && pastEntries.length === 0;
          return (
          <div className="space-y-4">
            {/* Title block */}
            <div className="px-1">
              <h2 className="font-display uppercase" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1, color: '#FFFFFF' }}>
                {t('orders.myOrders')}
              </h2>
              <p className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: '.08em', color: '#9A9A9A', marginTop: 7 }}>
                {totalActive} {t('orders.active')} · {pastEntries.length} {t('orders.passed')}
              </p>
            </div>

            {/* Segmented control */}
            <SegControl active={seg} setActive={setSeg} counts={bucketCounts} labels={segLabels} />

            {/* Kicker — label de section à filet rouge */}
            <div className="flex items-center gap-3 px-1" style={{ marginTop: 4 }}>
              <span style={{ width: 28, height: 1, background: '#E8192C', flexShrink: 0 }} />
              <span className="font-mono uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', color: '#9A9A9A' }}>{kickerLabel}</span>
              <span className="flex-1" style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span className="font-mono" style={{ fontSize: 10.5, color: '#5A5A5E' }}>{activeEntries.length}</span>
            </div>

            {/* Cards */}
            {activeEntries.length === 0 ? (
              totallyEmpty ? (
                <EmptyState
                  icon={Ticket}
                  title={t('empty.orders.title')}
                  body={t('empty.orders.body')}
                  ctaLabel={t('empty.orders.cta')}
                  onCta={() => navigate('/events')}
                />
              ) : (
                <div className="text-center font-mono uppercase" style={{ padding: '40px 22px', fontSize: 11, letterSpacing: '.06em', color: '#5A5A5E' }}>
                  {t('orders.noneInCategory')}
                </div>
              )
            ) : (
              <div className="flex flex-col gap-3">
                {seg === 'pending' && pendingEntries.map((o, i) => (
                  <PendingCard key={o.id} o={o} index={i} tonightLabel={t('orders.tonight').toUpperCase()} kindLabels={kindLabels} />
                ))}
                {seg === 'upcoming' && upcomingEntries.map((o, i) => (
                  <UpcomingCard key={o.id} o={o} index={i} kindLabels={kindLabels} />
                ))}
                {seg === 'past' && pastEntries.map((o, i) => (
                  <PastCard key={o.id} o={o} index={i} statusLabels={pastStatusLabels} kindLabels={kindLabels} />
                ))}
              </div>
            )}

            {/* Drink credits */}
            {seg === 'pending' && (
              <div className="pt-2">
                <DrinkCreditsCard />
              </div>
            )}
          </div>
          );
        })()}
      </PageFade>

      {/* Edit Order Dialog */}
      <EditOrderDialog
        open={!!editingOrder}
        items={editItems}
        onClose={() => setEditingOrder(null)}
        onUpdateQty={updateItemQty}
        onSave={handleSaveEdit}
      />

      {/* Cancel Ticket Confirmation Dialog */}
      <CancelTicketDialog
        open={!!ticketToCancel}
        refundAmount={ticketToCancel ? calculateRefundAmount(ticketToCancel) : null}
        cancelling={cancellingTicket}
        onClose={() => setTicketToCancel(null)}
        onConfirm={handleCancelTicket}
      />

      {/* Opaque cover during a Back-restore so the list never flashes before
          the overlay reopens (removed as soon as the overlay is mounted).
          Shows the orders silhouette instead of a plain black wall. */}
      {restoring && (
        <div className="fixed inset-0 z-[95] overflow-hidden" style={{ background: '#0A0A0A' }} aria-hidden>
          <OrdersSkeleton />
        </div>
      )}

      {/* QR Code Modal for Tickets - Per-attendee carousel (shared premium design) */}
      {selectedTicket && (
        <TicketQROverlay
          instant={restoring}
          ticketId={selectedTicket.id}
          ticketQrCode={selectedTicket.qrCode}
          quantity={selectedTicket.quantity}
          roundName={selectedTicket.roundName}
          eventTitle={selectedTicket.eventTitle}
          venueName={selectedTicket.venueName}
          entryScanned={selectedTicket.entryScanned}
          labels={qrOverlayLabels}
          onClose={() => setSelectedTicket(null)}
          whenLabel={fmtWhen(selectedTicket.eventStartAt)}
          posterUrl={selectedTicket.eventPosterUrl}
          posterThumb={selectedTicket.eventPosterUrl}
          kindLabel={kindLabels.ticket}
          actions={buildQRActions({
            eventId: selectedTicket.eventId,
            title: selectedTicket.eventTitle,
            startAt: selectedTicket.eventStartAt,
            endAt: selectedTicket.eventEndAt,
            venue: {
              name: selectedTicket.venueName,
              address: selectedTicket.venueAddress,
              city: selectedTicket.venueCity,
              lat: selectedTicket.venueLat,
              lng: selectedTicket.venueLng,
            },
            restoreParam: 'ticket_id',
            restoreId: selectedTicket.id,
            wallet: { type: 'ticket', id: selectedTicket.id },
          })}
        />
      )}

      {/* QR Code Modal for VIP Reservations */}
      {selectedVipReservation && (
        <OrderQROverlay
          instant={restoring}
          kind="vip"
          title={selectedVipReservation.eventTitle}
          venueName={`${selectedVipReservation.venueName} · ${selectedVipReservation.zoneName || selectedVipReservation.packName}`}
          qrImage={qrImages[selectedVipReservation.id]}
          idLabel={selectedVipReservation.id.slice(0, 8).toUpperCase()}
          scanned={selectedVipReservation.entryScanned}
          labels={qrOverlayLabels}
          onClose={() => setSelectedVipReservation(null)}
          whenLabel={fmtWhen(selectedVipReservation.eventStartAt)}
          posterUrl={selectedVipReservation.eventPosterUrl}
          posterThumb={selectedVipReservation.eventPosterUrl}
          kindLabel={kindLabels.vip}
          actions={buildQRActions({
            eventId: selectedVipReservation.eventId,
            title: selectedVipReservation.eventTitle,
            startAt: selectedVipReservation.eventStartAt,
            endAt: selectedVipReservation.eventEndAt,
            venue: {
              name: selectedVipReservation.venueName,
              address: selectedVipReservation.venueAddress,
              city: selectedVipReservation.venueCity,
              lat: selectedVipReservation.venueLat,
              lng: selectedVipReservation.venueLng,
            },
            restoreParam: 'reservation_id',
            restoreId: selectedVipReservation.id,
            wallet: { type: 'table', id: selectedVipReservation.id },
          })}
          footer={
            <div
              className="text-left"
              style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '11px 13px' }}
            >
              <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: '#9A9A9A' }}>{t('tickets.reservedFor')}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#FFFFFF' }}>{selectedVipReservation.fullName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: '#9A9A9A' }}>{t('tickets.remainingOnSite')}</span>
                <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: '#E8192C' }}>
                  {(selectedVipReservation.totalPrice - selectedVipReservation.deposit).toFixed(2)}€
                </span>
              </div>
            </div>
          }
        />
      )}

      {/* QR Code Modal for Guest List Entries */}
      {selectedGuestEntry && (
        <OrderQROverlay
          instant={restoring}
          kind="guestlist"
          title={selectedGuestEntry.eventTitle}
          venueName={selectedGuestEntry.venueName}
          qrImage={qrImages[`gl-${selectedGuestEntry.id}`]}
          idLabel={`${t('guestList.freeBefore')} ${selectedGuestEntry.freeBeforeTime}`}
          scanned={selectedGuestEntry.entryScanned}
          labels={qrOverlayLabels}
          onClose={() => setSelectedGuestEntry(null)}
          whenLabel={fmtWhen(selectedGuestEntry.eventStartAt)}
          posterUrl={selectedGuestEntry.eventPosterUrl}
          posterThumb={selectedGuestEntry.eventPosterUrl}
          kindLabel={kindLabels.guestlist}
          actions={buildQRActions({
            eventId: selectedGuestEntry.eventId,
            title: selectedGuestEntry.eventTitle,
            startAt: selectedGuestEntry.eventStartAt,
            endAt: selectedGuestEntry.eventEndAt,
            venue: {
              name: selectedGuestEntry.venueName,
              address: selectedGuestEntry.venueAddress,
              city: selectedGuestEntry.venueCity,
              lat: selectedGuestEntry.venueLat,
              lng: selectedGuestEntry.venueLng,
            },
            restoreParam: 'guest_id',
            restoreId: selectedGuestEntry.id,
          })}
        />
      )}

      {/* Drink Order Detail Modal */}
      {selectedDrinkOrder && (
        <DrinkOrderDetailModal
          order={{
            id: selectedDrinkOrder.id,
            token: selectedDrinkOrder.token || undefined,
            token_used: selectedDrinkOrder.token_used || undefined,
            total: Number(selectedDrinkOrder.total),
            status: selectedDrinkOrder.status,
            prep_requested: selectedDrinkOrder.prep_requested || undefined,
            prep_status: selectedDrinkOrder.prep_status || undefined,
            items: Array.isArray(selectedDrinkOrder.items) ? (selectedDrinkOrder.items as any[]).map((item: any) => ({
              id: item.id,
              drinkId: item.drinkId,
              name: item.name,
              qty: item.qty,
              unitPrice: item.unitPrice,
              imgUrl: item.imgUrl,
              served: item.served,
              servedUnits: item.servedUnits,
              prepUnits: item.prepUnits,
            })) : [],
            events: selectedDrinkOrder.events || null,
            venue_id: selectedDrinkOrder.venue_id,
            _sourceOrders: (selectedDrinkOrder as any)._sourceOrders || undefined,
          }}
          clickCollectMode={clickCollectModeByVenue[selectedDrinkOrder.venue_id] || false}
          onClose={() => { setSelectedDrinkOrder(null); setCollectMode(false); }}
          onOrderUpdate={fetchOrders}
          collectMode={collectMode}
          venueName={selectedDrinkOrder.venueName}
          posterUrl={selectedDrinkOrder.events?.poster_url}
        />
      )}

      {/* QR Code Modal for Free Drink Rewards - Uses dedicated modal with DrinkOrderDetailModal design */}
      {selectedReward && selectedReward.rewardType === 'free_drink' && (
        <FreeDrinkRewardModal
          reward={{
            id: selectedReward.id,
            rewardName: selectedReward.rewardName,
            pointsSpent: selectedReward.pointsSpent,
            qrCode: selectedReward.qrCode,
            venueName: selectedReward.venueName,
            venueId: selectedReward.venueId,
            eventDetails: selectedReward.eventDetails ? {
              title: selectedReward.eventDetails.title,
              startAt: selectedReward.eventDetails.startAt,
              endAt: selectedReward.eventDetails.endAt,
            } : null,
          }}
          onClose={() => setSelectedReward(null)}
          posterUrl={selectedReward.eventDetails?.posterUrl || undefined}
        />
      )}

      {/* QR Code Modal for Free Ticket Rewards */}
      {selectedReward && selectedReward.rewardType === 'free_ticket' && (
        <OrderQROverlay
          instant={restoring}
          kind="reward"
          title={selectedReward.eventDetails?.title || selectedReward.metadata?.eventTitle || selectedReward.rewardName}
          venueName={selectedReward.venueName}
          qrImage={qrImages[`reward-${selectedReward.id}`]}
          idLabel={`1× ${selectedReward.metadata?.roundName || t('loyalty.freeTicket')}`}
          labels={qrOverlayLabels}
          onClose={() => setSelectedReward(null)}
          whenLabel={fmtWhen(selectedReward.eventDetails?.startAt)}
          posterUrl={selectedReward.eventDetails?.posterUrl || undefined}
          posterThumb={selectedReward.eventDetails?.posterUrl || undefined}
          kindLabel={kindLabels.reward}
          actions={buildQRActions({
            eventId: selectedReward.eventDetails?.id || selectedReward.metadata?.eventId,
            title: selectedReward.eventDetails?.title || selectedReward.metadata?.eventTitle || selectedReward.rewardName,
            startAt: selectedReward.eventDetails?.startAt,
            endAt: selectedReward.eventDetails?.endAt,
            venue: {
              name: selectedReward.venueName,
              address: selectedReward.venueAddress,
              city: selectedReward.venueCity,
              lat: selectedReward.venueLat,
              lng: selectedReward.venueLng,
            },
            restoreParam: 'reward_id',
            restoreId: selectedReward.id,
          })}
        />
      )}

      {/* Bar Selection Dialog */}
      {barSelectionOrder && (
        <BarSelectionDialog
          open={!!barSelectionOrder}
          onOpenChange={(open) => !open && setBarSelectionOrder(null)}
          venueId={barSelectionOrder.venue_id}
          onConfirm={handleBarSelected}
        />
      )}

      {/* Bar Selection Dialog for Prep With Items */}
      {prepWithItemsBarOrder && (
        <BarSelectionDialog
          open={!!prepWithItemsBarOrder}
          onOpenChange={(open) => !open && setPrepWithItemsBarOrder(null)}
          venueId={prepWithItemsBarOrder.order.venue_id}
          onConfirm={handlePrepWithItemsBarSelected}
        />
      )}

      <BottomNav />
    </div>
  );
}
