import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { EventFilter } from '@/components/EventFilter';
import { ChefHat, Camera, Search, CheckCircle, XCircle, Ban, AlertTriangle, ArrowLeft, Clock, Bell } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Scanner } from '@yudiel/react-qr-scanner';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Order } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

import { useLanguage } from '@/contexts/LanguageContext';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { RoleIntroGate } from '@/components/onboarding/RoleIntroGate';
import { OrderPreparationView } from '@/components/OrderPreparationView';
import { useStaffVenue } from '@/hooks/useStaffVenue';
import { BarmanBarSelection } from '@/components/barman/BarmanBarSelection';
import { ShiftStats } from '@/components/barman/ShiftStats';
import { calcStripeFee } from '@/utils/fees';



// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const mainCard: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  padding: 18,
  overflow: 'hidden',
  position: 'relative',
};

const BARMAN_BAR_KEY = 'barman_selected_bar';

/** Normalize DB items (quantity/price) to app format (qty/unitPrice) */
const normalizeOrderItems = (items: any[]): any[] =>
  (items || []).map((item: any) => ({
    ...item,
    qty: item.qty ?? item.quantity ?? 1,
    unitPrice: item.unitPrice ?? item.price ?? 0,
    drinkId: item.drinkId ?? item.id ?? '',
    name: item.name ?? 'Unknown',
  }));

export default function Barman() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { venueId: staffVenueId, loading: venueLoading } = useStaffVenue();
  const [clickCollectOrders, setClickCollectOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isRequestingCamera, setIsRequestingCamera] = useState(false);
  const [pinSearch, setPinSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [preparingOrder, setPreparingOrder] = useState<Order | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [clickCollectMode, setClickCollectMode] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);
  const [isClickCollectManager, setIsClickCollectManager] = useState(false);
  const [scanMode, setScanMode] = useState<'serve' | 'cancel'>('serve');
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);
  
  // Bar selection and drink counter
  const [selectedBar, setSelectedBar] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(BARMAN_BAR_KEY);
    }
    return null;
  });

  // New order notification state
  const [newOrderCount, setNewOrderCount] = useState(0);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());

  // B2: Enhanced notification sound for new orders — louder, longer, distinct vibration
  const playNewOrderSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.value = 0.7; // Louder

      // Double beep pattern: beep-pause-beep for distinctiveness
      const playBeep = (startTime: number, freq: number, duration: number) => {
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.frequency.value = freq;
        osc.type = 'square'; // Harsher = more audible in noisy env
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      playBeep(now, 1000, 0.15);         // High beep
      playBeep(now + 0.2, 1200, 0.15);   // Higher beep
      playBeep(now + 0.4, 1000, 0.25);   // Sustained beep

      setTimeout(() => ctx.close(), 800);

      // Long vibration pattern for mobile
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 500]);
    } catch (_) { /* silent */ }
  }, []);

  const handleBarSelect = useCallback((barName: string) => {
    setSelectedBar(barName);
    localStorage.setItem(BARMAN_BAR_KEY, barName);
  }, []);

  useEffect(() => {
    if (!staffVenueId) return;
    
    fetchClickCollectOrders();
    fetchClickCollectMode();
    checkClickCollectManager();

    // Realtime subscription for orders - filtered updates with sound alert
    const ordersChannel = supabase
      .channel(`barman-orders-${staffVenueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `venue_id=eq.${staffVenueId}`,
        },
        (payload) => {
          const newOrder = payload.new as any;
          if (newOrder.prep_requested && newOrder.status === 'paid') {
            playNewOrderSound();
            setNewOrderCount(prev => prev + 1);
          }
          fetchClickCollectOrders();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `venue_id=eq.${staffVenueId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          const old = payload.old as any;
          // Sound when an order is newly prep_requested
          if (updated.prep_requested && !old.prep_requested && updated.status === 'paid') {
            playNewOrderSound();
            setNewOrderCount(prev => prev + 1);
          }
          fetchClickCollectOrders();
        }
      )
      .subscribe();

    // Realtime subscription for venue changes
    const venueChannel = supabase
      .channel(`venue-changes-barman-${staffVenueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'venues',
          filter: `id=eq.${staffVenueId}`,
        },
        () => {
          fetchClickCollectMode();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(venueChannel);
    };
  }, [selectedEventId, user, staffVenueId, selectedBar]);

  const checkClickCollectManager = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_click_collect_manager')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setIsClickCollectManager(data?.is_click_collect_manager || false);
    } catch (error) {
      console.error('Error checking click collect manager status:', error);
    }
  };

  const fetchClickCollectMode = async () => {
    if (!staffVenueId) return;
    try {
      const { data, error } = await supabase
        .from('venues')
        .select('click_collect_mode')
        .eq('id', staffVenueId)
        .single();

      if (error) throw error;
      setClickCollectMode(data?.click_collect_mode || false);
    } catch (error) {
      console.error('Error fetching click collect mode:', error);
    }
  };

  const toggleClickCollectMode = async () => {
    if (!staffVenueId) return;
    setTogglingMode(true);
    try {
      const newMode = !clickCollectMode;
      
      const { error } = await supabase
        .from('venues')
        .update({ click_collect_mode: newMode })
        .eq('id', staffVenueId);

      if (error) throw error;

      // Send push notifications to all users
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            title: newMode ? '🥤 Mode Click & Collect activé' : '✅ Mode normal rétabli',
            body: newMode 
              ? 'Toutes les commandes doivent maintenant être récupérées via le Click & Collect. Demandez la préparation depuis vos commandes.' 
              : 'Vous pouvez à nouveau récupérer vos commandes directement au bar avec le QR code.',
            broadcast: true
          }
        });
      } catch (notifError) {
        console.error('Error sending notifications:', notifError);
      }

      setClickCollectMode(newMode);
      toast.success(newMode ? t('barman.clickCollectModeEnabled') : t('barman.clickCollectModeDisabled'));
    } catch (error) {
      console.error('Error toggling mode:', error);
      toast.error(t('barman.clickCollectModeError'));
    } finally {
      setTogglingMode(false);
    }
  };

  // Fetch only Click & Collect orders for this bar
  const fetchClickCollectOrders = async () => {
    if (!staffVenueId) return;
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          events (
            id,
            title,
            start_at,
            end_at,
            is_active
          )
        `)
        .eq('venue_id', staffVenueId)
        .eq('status', 'paid')
        .eq('prep_requested', true)
        .in('prep_status', ['queue', 'preparing', 'ready'])
        .order('created_at', { ascending: true });

      if (selectedEventId) {
        query = query.eq('event_id', selectedEventId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const now = new Date();
      let filteredData = (data || []).filter((order) => {
        // Exclude orders from ended events
        const isEventActive = !order.events || (new Date(order.events.end_at) > now);
        
        // Filter by selected bar if barman has selected one
        // Only show orders for this bar, or orders without a bar assigned
        let matchesBar = true;
        if (selectedBar) {
          matchesBar = !order.selected_bar || order.selected_bar === selectedBar;
        }
        
        return isEventActive && matchesBar;
      });

      const mappedOrders: Order[] = filteredData.map((order) => ({
        id: order.id,
        userEmail: order.user_email || undefined,
        venueId: order.venue_id,
        items: normalizeOrderItems(order.items as any[]),
        total: Number(order.total),
        status: order.status as 'pending' | 'paid' | 'served',
        createdAt: order.created_at,
        paidAt: order.paid_at || undefined,
        servedAt: order.served_at || undefined,
        token: order.token || undefined,
        tokenUsed: order.token_used || undefined,
        tokenExpiresAt: order.token_expires_at || undefined,
        prepRequested: order.prep_requested || false,
        prepStatus: (order.prep_status as 'queue' | 'preparing' | 'ready' | 'served') || undefined,
        selectedBar: order.selected_bar || undefined,
        assignedBar: order.assigned_bar || undefined,
      }));

      setClickCollectOrders(mappedOrders);
    } catch (error) {
      console.error('Error fetching click collect orders:', error);
      toast.error(t('clickCollect.errorLoading'));
    } finally {
      setLoading(false);
    }
  };


  const requestCameraPermission = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error: any) {
      console.error('Camera permission denied:', error);
      return false;
    }
  };

  const startScanning = async () => {
    setIsRequestingCamera(true);

    try {
      const hasPermission = await requestCameraPermission();

      if (!hasPermission) {
        toast.error(t('barman.cameraPermissionDenied'));
        setIsRequestingCamera(false);
        return;
      }

      setIsScanning(true);
    } catch (error) {
      console.error('Error starting scanner:', error);
      toast.error(t('barman.cameraError'));
    } finally {
      setIsRequestingCamera(false);
    }
  };

  const stopScanning = () => {
    setIsScanning(false);
  };

  const handleScan = async (token: string) => {
    // If in cancel mode, handle cancellation flow
    if (scanMode === 'cancel') {
      await handleCancelScan(token);
      return;
    }

    try {
      // Check for multi-order format: orderId1|indices;orderId2|indices
      // or single order format: orderId|indices
      const hasSemicolon = token.includes(';');
      const pipeIndex = token.indexOf('|');
      
      if (pipeIndex > 0) {
        // Parse all order segments
        const segments = hasSemicolon ? token.split(';') : [token];
        const orderSegments: { orderId: string; indices: number[] }[] = [];
        
        for (const segment of segments) {
          const segPipe = segment.indexOf('|');
          if (segPipe > 0) {
            const orderId = segment.substring(0, segPipe);
            const indicesStr = segment.substring(segPipe + 1);
            const indices = indicesStr.split(',').map(Number).filter(n => !isNaN(n));
            orderSegments.push({ orderId, indices });
          }
        }

        if (orderSegments.length === 0) {
          toast.error(t('barman.qrInvalid'));
          return;
        }

        // Fetch all referenced orders
        const orderIds = orderSegments.map(s => s.orderId);
        const { data: ordersData, error } = await supabase
          .from('orders')
          .select(`*, events (id, title, start_at, end_at, is_active)`)
          .in('id', orderIds);

        if (error || !ordersData || ordersData.length === 0) {
          toast.error(t('barman.qrInvalid'));
          return;
        }

        // Validate event timing on the first order
        const firstOrder = ordersData[0];
        if (firstOrder.events) {
          const now = new Date();
          const eventStart = new Date(firstOrder.events.start_at);
          const eventEnd = new Date(firstOrder.events.end_at);
          if (now < eventStart) { toast.error(t('barman.eventNotStarted')); return; }
          if (now > eventEnd) { toast.error(t('barman.eventEnded')); return; }
        }

        // For Click & Collect, verify all orders are ready
        for (const order of ordersData) {
          if (order.prep_requested === true && order.prep_status !== 'ready') {
            const statusMsg = 
              order.prep_status === 'queue' ? t('barman.orderNotPrepared') :
              order.prep_status === 'preparing' ? t('barman.orderPreparing') :
              t('barman.orderNotReady');
            toast.error(statusMsg);
            return;
          }
        }

        // Vibrate on success
        if (navigator.vibrate) navigator.vibrate(200);

        // Build display items from all orders' selected indices
        const allSelectedItems: { name: string; qty: number; unitPrice: number }[] = [];
        let alreadyServedCount = 0;
        let totalSelectedCount = 0;

        orderSegments.forEach(seg => {
          const order = ordersData.find(o => o.id === seg.orderId);
          if (!order) return;
          const items = normalizeOrderItems(order.items as any[]);
          
          // Build expanded items for this order
          const expandedItems: { name: string; unitPrice: number; expandedIdx: number; served: boolean }[] = [];
          let expandedIdx = 0;
          items.forEach((item: any) => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const servedUnits = Array.isArray(item.servedUnits) ? item.servedUnits : [];
            for (let i = 0; i < qty; i++) {
              expandedItems.push({
                name: item.name,
                unitPrice: Number(item.unitPrice) || 0,
                expandedIdx,
                served: servedUnits[i] === true || item.served === true,
              });
              expandedIdx++;
            }
          });

          const availableExpandedIndices = expandedItems
            .filter((entry) => !entry.served)
            .map((entry) => entry.expandedIdx);

          const validDirectIndices = seg.indices.filter(
            (idx) => Number.isInteger(idx) && idx >= 0 && idx < expandedItems.length
          );

          const validOneBasedIndices = seg.indices
            .map((idx) => idx - 1)
            .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < expandedItems.length);

          const validAvailableIndices = seg.indices
            .map((idx) => availableExpandedIndices[idx])
            .filter((idx): idx is number => Number.isInteger(idx));

          const validAvailableOneBasedIndices = seg.indices
            .map((idx) => availableExpandedIndices[idx - 1])
            .filter((idx): idx is number => Number.isInteger(idx));

          const resolvedIndicesRaw =
            validDirectIndices.length > 0
              ? validDirectIndices
              : validOneBasedIndices.length > 0
                ? validOneBasedIndices
                : validAvailableIndices.length > 0
                  ? validAvailableIndices
                  : validAvailableOneBasedIndices;

          const resolvedIndices = Array.from(new Set(resolvedIndicesRaw));
          totalSelectedCount += resolvedIndices.length;

          resolvedIndices.forEach((idx) => {
            const ei = expandedItems[idx];
            if (!ei) return;
            if (ei.served) {
              alreadyServedCount++;
              return;
            }
            allSelectedItems.push({ name: ei.name, qty: 1, unitPrice: ei.unitPrice });
          });
        });

        if (totalSelectedCount === 0 || (allSelectedItems.length === 0 && alreadyServedCount === 0)) {
          toast.error(t('barman.qrInvalid'));
          return;
        }

        if (alreadyServedCount === totalSelectedCount) {
          toast.error(t('barman.qrUsed'));
          return;
        }

        const mappedOrder: Order = {
          id: orderSegments[0].orderId,
          userEmail: firstOrder.user_email || undefined,
          venueId: firstOrder.venue_id,
          items: allSelectedItems as any,
          total: allSelectedItems.reduce((sum, it) => sum + it.unitPrice * it.qty, 0),
          status: firstOrder.status as 'pending' | 'paid' | 'served',
          createdAt: firstOrder.created_at,
          paidAt: firstOrder.paid_at || undefined,
          servedAt: firstOrder.served_at || undefined,
          token: firstOrder.token || undefined,
          tokenUsed: firstOrder.token_used || undefined,
          tokenExpiresAt: firstOrder.token_expires_at || undefined,
          prepRequested: firstOrder.prep_requested || false,
          prepStatus: (firstOrder.prep_status as 'queue' | 'preparing' | 'ready' | 'served') || undefined,
        };

        // Store multi-order serving info
        (mappedOrder as any)._multiOrderSegments = orderSegments;
        (mappedOrder as any)._allOrdersData = ordersData;

        setSelectedOrder(mappedOrder);
        return;
      }

      // Standard token lookup (fallback for old QR codes without selection)
      const { data: order, error } = await supabase
        .from('orders')
        .select(`
          *,
          events (
            id,
            title,
            start_at,
            end_at,
            is_active
          )
        `)
        .eq('token', token)
        .maybeSingle();

      if (order && !error) {
        // Found an order - handle drink order QR
        if (order.token_used) {
          toast.error(t('barman.qrUsed'));
          return;
        }

        // For Click & Collect orders, verify the order is ready
        if (order.prep_requested === true) {
          if (order.prep_status !== 'ready') {
            const statusMsg = 
              order.prep_status === 'queue' ? t('barman.orderNotPrepared') :
              order.prep_status === 'preparing' ? t('barman.orderPreparing') :
              t('barman.orderNotReady');
            toast.error(statusMsg);
            return;
          }
        }

        // Check validity based on event or token_expires_at
        if (order.events) {
          const now = new Date();
          const eventStart = new Date(order.events.start_at);
          const eventEnd = new Date(order.events.end_at);
          
          if (now < eventStart) {
            toast.error(t('barman.eventNotStarted'));
            return;
          }
          
          if (now > eventEnd) {
            toast.error(t('barman.eventEnded'));
            return;
          }
        } else {
          if (order.token_expires_at) {
            const expiresAt = new Date(order.token_expires_at);
            const now = new Date();
            if (expiresAt < now) {
              toast.error(t('barman.qrExpired'));
              return;
            }
          }
        }

        // Vibrate on success
        if (navigator.vibrate) {
          navigator.vibrate(200);
        }

        const mappedOrder: Order = {
          id: order.id,
          userEmail: order.user_email || undefined,
          venueId: order.venue_id,
          items: normalizeOrderItems(order.items as any[]),
          total: Number(order.total),
          status: order.status as 'pending' | 'paid' | 'served',
          createdAt: order.created_at,
          paidAt: order.paid_at || undefined,
          servedAt: order.served_at || undefined,
          token: order.token || undefined,
          tokenUsed: order.token_used || undefined,
          tokenExpiresAt: order.token_expires_at || undefined,
          prepRequested: order.prep_requested || false,
          prepStatus: (order.prep_status as 'queue' | 'preparing' | 'ready' | 'served') || undefined,
        };

        setSelectedOrder(mappedOrder);
        return;
      }

      // Neither order nor ticket found
      toast.error(t('barman.qrInvalid'));
    } catch (error) {
      console.error('Error scanning QR:', error);
      toast.error(t('barman.scanError'));
    }
  };

  const handleCancelScan = async (token: string) => {
    try {
      // Find order with this token
      const { data: order, error } = await supabase
        .from('orders')
        .select(`
          *,
          events (
            id,
            title,
            start_at,
            end_at,
            is_active
          )
        `)
        .eq('token', token)
        .maybeSingle();

      if (error) throw error;

      if (!order) {
        toast.error(t('barman.qrInvalid'));
        return;
      }

      // Check if order can be cancelled
      if (order.status !== 'paid') {
        toast.error(t('barman.orderNotPaid'));
        return;
      }

      if (order.served_at) {
        toast.error(t('barman.orderAlreadyServed'));
        return;
      }

      // Vibrate on success
      if (navigator.vibrate) {
        navigator.vibrate(200);
      }

      // Map to Order type and show confirmation
      const mappedOrder: Order = {
        id: order.id,
        userEmail: order.user_email || undefined,
        venueId: order.venue_id,
        items: normalizeOrderItems(order.items as any[]),
        total: Number(order.total),
        status: order.status as 'pending' | 'paid' | 'served',
        createdAt: order.created_at,
        paidAt: order.paid_at || undefined,
        servedAt: order.served_at || undefined,
        token: order.token || undefined,
        tokenUsed: order.token_used || undefined,
        tokenExpiresAt: order.token_expires_at || undefined,
        prepRequested: order.prep_requested || false,
        prepStatus: (order.prep_status as 'queue' | 'preparing' | 'ready' | 'served') || undefined,
        serviceFee: Number(order.service_fee) || 0,
      };

      setOrderToCancel(mappedOrder);
    } catch (error) {
      console.error('Error scanning for cancellation:', error);
      toast.error(t('barman.scanError'));
    }
  };

  const handleConfirmCancel = async () => {
    if (!orderToCancel) return;

    setCancelling(true);
    try {
      const response = await supabase.functions.invoke('staff-cancel', {
        body: {
          type: 'order',
          qrCode: orderToCancel.token,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Cancellation failed');
      }

      const result = response.data;

      if (!result.success) {
        throw new Error(result.error || 'Cancellation failed');
      }

      // Vibrate on success
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }

      toast.success(t('barman.cancelSuccess'));
      setOrderToCancel(null);
      fetchClickCollectOrders();
    } catch (error: any) {
      console.error('Error cancelling order:', error);
      toast.error(error.message || t('barman.cancelError'));
    } finally {
      setCancelling(false);
    }
  };

  const handlePinSearch = () => {
    if (pinSearch.length !== 4) return;

    const order = clickCollectOrders.find((o) => o.token?.slice(-4).toUpperCase() === pinSearch.toUpperCase());

    if (order) {
      handleScan(order.token!);
      setPinSearch('');
    } else {
      toast.error(t('barman.pinError'));
    }
  };

  const handleMoveToPrep = async (orderId: string) => {
    try {
      const updateData: any = {
        prep_status: 'preparing',
        prep_claimed_at: new Date().toISOString(),
        prep_claimed_by: user?.id,
      };

      // If barman has a selected bar, assign it to the order
      if (selectedBar) {
        updateData.assigned_bar = selectedBar;
      }

      const { data: claimed, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .or('prep_claimed_by.is.null,prep_status.eq.queue')
        .select();

      if (error) throw error;
      if (!claimed || claimed.length === 0) {
        toast.error(t('clickCollect.alreadyClaimed'));
        fetchClickCollectOrders();
        return;
      }

      // Find and show the order in preparation view
      const order = clickCollectOrders.find(o => o.id === orderId);
      if (order) {
        setPreparingOrder(order);
      }

      toast.success(t('barman.prepRequestSuccess'));
      fetchClickCollectOrders();
    } catch (error) {
      console.error('Error moving to prep:', error);
      toast.error(t('barman.prepRequestError'));
    }
  };

  const handleMarkReady = async () => {
    if (!preparingOrder) return;

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          prep_status: 'ready',
          ready_at: new Date().toISOString(),
          notify_status: 'ready',
        })
        .eq('id', preparingOrder.id)
        .eq('prep_claimed_by', user?.id);

      if (error) throw error;

      // Send push notification to the order owner.
      // send-push-notification requires { user_id, payload } — the previous
      // { orderId, userEmail, type } shape returned 400 and the client was
      // never notified that the order was ready (the error was swallowed below).
      try {
        const { data: orderData } = await supabase
          .from('orders')
          .select('user_id')
          .eq('id', preparingOrder.id)
          .single();

        if (orderData?.user_id) {
          const itemsSummary = ((preparingOrder as any).items as any[])
            ?.map((i: any) => `${i.qty}x ${i.name}`).join(', ') || 'Commande';
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_id: orderData.user_id,
              payload: {
                title: 'Commande prête 🎉',
                body: `${itemsSummary} – Viens récupérer ta commande !`,
                url: '/my-orders',
              },
            },
          });
        }
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }

      // Close preparation view
      setPreparingOrder(null);
      
      toast.success(t('clickCollect.readySuccess'));
      fetchClickCollectOrders();
    } catch (error) {
      console.error('Error marking order as ready:', error);
      toast.error(t('clickCollect.errorReady'));
    }
  };

  const handleServeOrder = async () => {
    if (!selectedOrder) return;

    try {
      const multiSegments = (selectedOrder as any)._multiOrderSegments as { orderId: string; indices: number[] }[] | undefined;
      const allOrdersData = (selectedOrder as any)._allOrdersData as any[] | undefined;

      if (multiSegments && allOrdersData) {
        // Multi-order serving: update each order separately
        for (const seg of multiSegments) {
          const orderData = allOrdersData.find((o: any) => o.id === seg.orderId);
          if (!orderData) continue;

          const items = normalizeOrderItems(orderData.items as any[]);
          const updatedItems = items.map((item: any) => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const existingServedUnits = Array.isArray(item.servedUnits) ? item.servedUnits : [];
            return {
              ...item,
              servedUnits: Array.from({ length: qty }, (_, i) => existingServedUnits[i] === true || item.served === true),
            };
          });

          let expandedIdx = 0;
          updatedItems.forEach((item: any) => {
            for (let i = 0; i < item.qty; i++) {
              if (seg.indices.includes(expandedIdx)) {
                item.servedUnits[i] = true;
              }
              expandedIdx++;
            }
          });

          const allServed = updatedItems.every((item: any) => 
            item.servedUnits.every((s: boolean) => s)
          );

          if (allServed) {
            // Guard against double-serve: only the first scan that finds the
            // token unused may close the order (matches the legacy path below).
            await supabase
              .from('orders')
              .update({
                items: updatedItems,
                status: 'served',
                token_used: true,
                served_at: new Date().toISOString(),
                prep_status: 'served',
                archived: true,
              })
              .eq('id', seg.orderId)
              .eq('token_used', false);
          } else {
            await supabase
              .from('orders')
              .update({ items: updatedItems })
              .eq('id', seg.orderId);
          }
        }
      } else {
        // Legacy full-order serving (old QR codes without selection)
        const { data: servedData, error } = await supabase
          .from('orders')
          .update({
            status: 'served',
            token_used: true,
            served_at: new Date().toISOString(),
            prep_status: 'served',
          })
          .eq('id', selectedOrder.id)
          .eq('token_used', false)
          .select();

        if (error) throw error;
        if (!servedData || servedData.length === 0) {
          toast.error(t('barman.alreadyServed'));
          setSelectedOrder(null);
          fetchClickCollectOrders();
          return;
        }
      }

      toast.success(t('barman.serveSuccess'));
      setSelectedOrder(null);
      fetchClickCollectOrders();
    } catch (error) {
      console.error('Error serving order:', error);
      toast.error(t('barman.serveError'));
    }
  };


  if (venueLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div
          className="h-12 w-12 animate-spin rounded-full border-2"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <RoleIntroGate role="barman" />
      {/* Vignette ambiante */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />

      {/* Header */}
      <header
        className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.72)', borderBottom: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <Link to="/profile">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-none"
              style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
            >
              <ChefHat className="h-4 w-4" style={{ color: RED }} />
            </div>
            <h1 className="truncate" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('barman.title')}</h1>
            {/* New order badge */}
            {newOrderCount > 0 && (
              <button
                onClick={() => setNewOrderCount(0)}
                className="relative ml-1 cursor-pointer"
                title={t('barman.newOrders')}
              >
                <Bell className="h-5 w-5 animate-pulse" style={{ color: RED }} />
                <span
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold tabular-nums"
                  style={{ background: RED, color: '#fff' }}
                >
                  {newOrderCount > 9 ? '9+' : newOrderCount}
                </span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {staffVenueId && (
              <BarmanBarSelection
                venueId={staffVenueId}
                currentBar={selectedBar}
                onBarSelect={handleBarSelect}
              />
            )}
            <div className="hidden sm:block">
              <EventFilter
                selectedEventId={selectedEventId}
                onEventSelect={setSelectedEventId}
                venueId={staffVenueId || ''}
              />
            </div>
            
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-7xl p-3 sm:p-4">
        {/* Shift Stats */}
        <ShiftStats venueId={staffVenueId || ''} />
        {/* Mobile Event Filter */}
        <div className="sm:hidden mb-3">
          <EventFilter
            selectedEventId={selectedEventId}
            onEventSelect={setSelectedEventId}
            venueId={staffVenueId || ''}
          />
        </div>

        {/* Mode Click & Collect Toggle - Only for Managers */}
        {isClickCollectManager && (
          <div style={{ ...mainCard, marginBottom: 16 }}>
            <div className="flex items-center justify-between">
              <div>
                <h3 style={{ color: T1, fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{t('barman.clickCollectModeTitle')}</h3>
                <p style={{ color: T3, fontSize: 12 }}>
                  {clickCollectMode ? t('barman.clickCollectModeActiveDesc') : t('barman.clickCollectModeInactiveDesc')}
                </p>
              </div>
              <Button
                onClick={toggleClickCollectMode}
                disabled={togglingMode}
                variant={clickCollectMode ? 'default' : 'outline'}
                size="sm"
              >
                {togglingMode ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                ) : null}
                {clickCollectMode ? t('barman.deactivateMode') : t('barman.activateMode')}
              </Button>
            </div>
          </div>
        )}

        {/* Click & Collect Access Button - only when mode is active */}
        {clickCollectMode && (
          <Button
            asChild
            className="mb-4 sm:mb-6 w-full bg-accent text-accent-foreground shadow-soft hover:shadow-primary h-12 sm:h-auto text-sm sm:text-base"
          >
            <Link to="/click-collect">
              <ChefHat className="mr-2 h-5 w-5" />
              {t('barman.accessClickCollect')}
            </Link>
          </Button>
        )}

        {/* Scanner Section */}
        <div style={{ ...mainCard, marginBottom: 16 }}>
          <h2 className="mb-3" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('barman.scanQR')}</h2>

          {/* Mode Tabs */}
          <Tabs value={scanMode} onValueChange={(v) => setScanMode(v as 'serve' | 'cancel')} className="mb-4">
            <TabsList className="owner-tabs grid w-full grid-cols-2">
              <TabsTrigger value="serve" className="flex items-center gap-1.5 text-xs">
                <CheckCircle className="h-3.5 w-3.5" />
                {t('barman.serveTab')}
              </TabsTrigger>
              <TabsTrigger value="cancel" className="flex items-center gap-1.5 text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">
                <Ban className="h-3.5 w-3.5" />
                {t('barman.cancelTab')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Cancel mode warning */}
          {scanMode === 'cancel' && (
            <div className="mb-4" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 12, padding: 16 }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
                <div>
                  <p style={{ color: RED, fontSize: 14, fontWeight: 600 }}>{t('barman.cancelModeTitle')}</p>
                  <p style={{ color: T3, fontSize: 13 }}>{t('barman.cancelModeDesc')}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 sm:mb-4 space-y-3">
            {isScanning && (
              <div
                className={`mx-auto max-w-md overflow-hidden rounded-lg border-2 bg-black ${
                  scanMode === 'cancel' ? 'border-destructive' : 'border-primary/50'
                }`}
                style={{ minHeight: '280px' }}
              >
                <Scanner
                  onScan={(result) => {
                    if (!result) return;

                    let value: string | undefined;
                    if (typeof result === 'string') {
                      value = result;
                    } else if (Array.isArray(result) && result[0]) {
                      value = (result[0] as any).rawValue ?? String(result[0]);
                    } else if (typeof (result as any).rawValue === 'string') {
                      value = (result as any).rawValue;
                    }

                    if (value) {
                      handleScan(value);
                      stopScanning();
                    }
                  }}
                  onError={(error) => {
                    console.error('Scanner error', error);
                  }}
                  formats={['qr_code']}
                  scanDelay={50}
                  styles={{
                    container: { width: '100%', height: '100%' },
                    video: { width: '100%', height: '100%', objectFit: 'cover' },
                  }}
                  components={{
                    finder: true,
                    torch: true,
                  }}
                  constraints={{
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                  }}
                />
              </div>
            )}

            <div className="mb-3 sm:mb-4">
              <Button
                onClick={isScanning ? stopScanning : startScanning}
                className={`w-full h-11 sm:h-10 text-sm sm:text-base ${
                  scanMode === 'cancel' 
                    ? 'bg-destructive text-destructive-foreground' 
                    : 'bg-primary shadow-primary'
                }`}
                variant={isScanning ? 'destructive' : 'default'}
                disabled={isRequestingCamera}
              >
                {isRequestingCamera ? (
                  <>
                    <div className="mr-2 h-4 w-4 sm:h-5 sm:w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t('barman.requestingCamera')}
                  </>
                ) : (
                  <>
                    <Camera className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                    {isScanning ? t('barman.stop') : t('barman.enableCamera')}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* PIN Search */}
          <div className="flex gap-2">
            <Input
              placeholder={t('barman.pinCode')}
              value={pinSearch}
              onChange={(e) => setPinSearch(e.target.value.slice(0, 4))}
              maxLength={4}
              className="bg-background h-11 sm:h-10 text-sm sm:text-base"
            />
            <Button
              onClick={handlePinSearch}
              disabled={pinSearch.length !== 4}
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-10 sm:w-10 flex-shrink-0"
            >
              <Search className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Click & Collect Orders Only - hidden when mode is disabled */}
        {clickCollectMode && (
          <>
            <div className="mb-3 sm:mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
                <Clock className="h-5 w-5" style={{ color: RED }} />
                <span className="line-clamp-1">{t('barman.clickCollectRequests')}</span>
                <span
                  className="flex-shrink-0 tabular-nums"
                  style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 999 }}
                >
                  {clickCollectOrders.length}
                </span>
              </h2>
            </div>

            <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {clickCollectOrders.map((order, index) => {
                const ready = order.prepStatus === 'ready';
                const preparing = order.prepStatus === 'preparing';
                const statusStyle = ready
                  ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }
                  : preparing
                  ? { background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)', color: '#FCD34D' }
                  : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 };
                return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                >
                  <div style={{ ...mainCard }}>
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <p className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                          {format(new Date(order.createdAt), 'HH:mm', { locale: fr })}
                        </p>
                        <p className="tabular-nums" style={{ color: T1, fontSize: 17, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 2 }}>
                          {order.total.toFixed(2)}€
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                          style={{ border: '1px solid rgba(232,25,44,0.3)', background: 'rgba(232,25,44,0.08)', color: RED }}
                        >
                          {t('barman.clickCollectBadge')}
                        </span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={statusStyle}>
                          {ready ? t('clickCollect.statusReady') :
                           preparing ? t('clickCollect.statusPreparing') :
                           t('clickCollect.statusQueue')}
                        </span>
                      </div>
                    </div>

                    {/* Bar info */}
                    {(order.selectedBar || order.assignedBar) && (
                      <div
                        className="mb-2 px-2 py-1 rounded text-xs flex items-center gap-1"
                        style={{ background: 'rgba(232,25,44,0.1)' }}
                      >
                        <ChefHat className="h-3 w-3" style={{ color: RED }} />
                        <span style={{ color: RED, fontWeight: 500 }}>{order.selectedBar || order.assignedBar}</span>
                      </div>
                    )}

                    <div className="space-y-1 mb-3">
                      {(() => {
                        const grouped: { name: string; qty: number }[] = [];
                        order.items.forEach((item) => {
                          const prepCount = Array.isArray((item as any).prepUnits)
                            ? (item as any).prepUnits.filter((p: boolean) => p).length
                            : item.qty;
                          if (prepCount <= 0) return;
                          const existing = grouped.find(g => g.name === item.name);
                          if (existing) existing.qty += prepCount;
                          else grouped.push({ name: item.name, qty: prepCount });
                        });
                        return grouped.map((g, i) => (
                          <p key={i} style={{ color: T2, fontSize: 13 }}>
                            <span className="tabular-nums">{g.qty}x</span> {g.name}
                          </p>
                        ));
                      })()}
                    </div>

                    {order.prepStatus === 'queue' && (
                      <Button
                        onClick={() => handleMoveToPrep(order.id)}
                        variant="default"
                        size="sm"
                        className="w-full"
                      >
                        <ChefHat className="mr-2 h-4 w-4" />
                        {t('barman.moveToPrep')}
                      </Button>
                    )}
                  </div>
                </motion.div>
                );
              })}
            </div>

            {clickCollectOrders.length === 0 && (
              <div style={{ ...mainCard, padding: 48 }} className="text-center" >
                <Clock className="h-12 w-12 mx-auto mb-4" style={{ color: 'rgba(255,255,255,0.14)' }} />
                <p style={{ color: T3, fontSize: 13 }}>{t('barman.noClickCollectRequests')}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Order Detail Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="border-0 bg-surface">
          <DialogHeader>
            <DialogTitle>{t('barman.orderDetails')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('barman.orderDetails')}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                <div className="mb-2 flex items-center justify-between">
                  <span style={{ color: T3, fontSize: 13 }}>{t('cart.total')}</span>
                  <span className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
                    {selectedOrder.total.toFixed(2)}€
                  </span>
                </div>
                <div className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                  {format(new Date(selectedOrder.createdAt), 'dd/MM/yyyy HH:mm', {
                    locale: fr,
                  })}
                </div>
              </div>

              <div className="space-y-2">
                {(() => {
                  const grouped: { name: string; qty: number; unitPrice: number }[] = [];
                  selectedOrder.items.forEach((item) => {
                    const existing = grouped.find(g => g.name === item.name && g.unitPrice === item.unitPrice);
                    if (existing) existing.qty += item.qty;
                    else grouped.push({ name: item.name, qty: item.qty, unitPrice: item.unitPrice });
                  });

                  if (grouped.length === 0) {
                    return (
                      <p style={{ color: T3, fontSize: 13 }}>{t('orders.noDrinks')}</p>
                    );
                  }

                  return grouped.map((g, i) => (
                    <div key={i} className="flex justify-between" style={{ fontSize: 13 }}>
                      <span style={{ color: T2 }}><span className="tabular-nums">{g.qty}x</span> {g.name}</span>
                      <span className="tabular-nums" style={{ color: T1, fontWeight: 620 }}>{(g.unitPrice * g.qty).toFixed(2)}€</span>
                    </div>
                  ));
                })()}
              </div>

              {selectedOrder.status === 'paid' && (
                <Button
                  onClick={handleServeOrder}
                  className="w-full bg-primary shadow-primary"
                >
                  <CheckCircle className="mr-2 h-5 w-5" />
                  {t('barman.markServed')}
                </Button>
              )}

              {selectedOrder.status === 'served' && (
                <div
                  className="flex items-center justify-center gap-2 rounded-lg p-4"
                  style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}
                >
                  <CheckCircle className="h-5 w-5" />
                  <span style={{ fontWeight: 600 }}>{t('orders.status.served')}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* Order Preparation Full Screen View */}
      {preparingOrder && (
        <OrderPreparationView
          order={preparingOrder}
          onComplete={handleMarkReady}
          onCancel={() => setPreparingOrder(null)}
        />
      )}

      {/* Order Cancellation Confirmation Dialog */}
      <Dialog open={!!orderToCancel} onOpenChange={() => setOrderToCancel(null)}>
        <DialogContent className="border-0 bg-surface">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('barman.cancelOrderTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('barman.cancelOrderDesc')}
            </DialogDescription>
          </DialogHeader>

          {orderToCancel && (
            <div className="space-y-4">
              {/* Order details */}
              <div className="space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                <div className="flex items-center justify-between">
                  <span style={{ color: T3, fontSize: 13 }}>{t('barman.orderValue')}</span>
                  <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 620 }}>{orderToCancel.total.toFixed(2)}€</span>
                </div>
                <div className="space-y-1">
                  {orderToCancel.items.map((item) => (
                    <p key={item.drinkId} style={{ color: T2, fontSize: 13 }}>
                      <span className="tabular-nums">{item.qty}x</span> {item.name}
                    </p>
                  ))}
                </div>
              </div>

              {/* Refund breakdown */}
              {(() => {
                const total = orderToCancel.total;
                const yunoFee = orderToCancel.serviceFee || 0;
                const stripeFee = calcStripeFee(total);
                const netRefund = Math.max(0, Math.round((total - yunoFee - stripeFee) * 100) / 100);
                return (
                  <div className="space-y-2" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 12, padding: 16 }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: T3, fontSize: 13 }}>Frais de service Yuno</span>
                      <span className="tabular-nums" style={{ color: RED, fontSize: 14, fontWeight: 620 }}>-{yunoFee.toFixed(2)}€</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ color: T3, fontSize: 13 }}>Frais Stripe</span>
                      <span className="tabular-nums" style={{ color: RED, fontSize: 14, fontWeight: 620 }}>-{stripeFee.toFixed(2)}€</span>
                    </div>
                    <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid rgba(232,25,44,0.2)' }}>
                      <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{t('barman.refundAmount')}</span>
                      <span className="tabular-nums" style={{ color: POS, fontSize: 14, fontWeight: 700 }}>{netRefund.toFixed(2)}€</span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-3">
                <Button
                  onClick={() => setOrderToCancel(null)}
                  variant="outline"
                  className="flex-1"
                  disabled={cancelling}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleConfirmCancel}
                  variant="destructive"
                  className="flex-1"
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                  ) : (
                    <Ban className="mr-2 h-4 w-4" />
                  )}
                  {t('barman.confirmCancel')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
