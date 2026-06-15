import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { EventFilter } from '@/components/EventFilter';
import { 
  Clock, 
  CheckCircle, 
  Lock, 
  Unlock, 
  AlertCircle,
  ChefHat,
  ListOrdered
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Order, NotifyStatus, PrepStatus } from '@/types';

// Represents a group of orders from the same user+event merged into one card
interface MergedOrder extends Order {
  sourceOrderIds: string[];
}

import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { LanguageSelector } from '@/components/LanguageSelector';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { OrderPreparationView } from '@/components/OrderPreparationView';
import { useStaffVenue } from '@/hooks/useStaffVenue';

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export default function ClickCollect() {
  const { language, t } = useLanguage();
  const { venueId: staffVenueId, loading: venueLoading } = useStaffVenue();
  const [orders, setOrders] = useState<MergedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [preparingOrder, setPreparingOrder] = useState<Order | null>(null);
  const [barmanProfiles, setBarmanProfiles] = useState<Record<string, { first_name?: string; last_name?: string }>>({});
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  // Get selected bar from localStorage (synced with Barman page)
  const BARMAN_BAR_KEY = 'barman_selected_bar';
  const [selectedBar] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(BARMAN_BAR_KEY);
    }
    return null;
  });

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  useEffect(() => {
    if (!staffVenueId) return;
    
    fetchCurrentUser();
    fetchOrders();

    // Realtime subscription with venue filter
    const channel = supabase
      .channel(uniqueChannel('click-collect-orders-realtime'))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `venue_id=eq.${staffVenueId}`,
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedEventId, staffVenueId, selectedBar]);

  const fetchCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
    }
  };

  const fetchOrders = async () => {
    if (!staffVenueId) return;
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          events (
            id,
            title,
            end_at
          )
        `)
        .eq('venue_id', staffVenueId)
        .eq('status', 'paid')
        .eq('prep_requested', true)
        .order('created_at', { ascending: false });

      if (selectedEventId) {
        query = query.eq('event_id', selectedEventId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Filter out orders from ended events and by selected bar
      const now = new Date();
      const activeOrders = (data || []).filter((order) => {
        const isEventActive = !order.events || (new Date(order.events.end_at) > now);
        // Filter by selected bar if barman has selected one
        let matchesBar = true;
        if (selectedBar) {
          matchesBar = !order.selected_bar || order.selected_bar === selectedBar;
        }
        return isEventActive && matchesBar;
      });

      const mappedOrders: Order[] = activeOrders.map((order) => ({
        id: order.id,
        userEmail: order.user_email || undefined,
        venueId: order.venue_id,
        items: order.items as any,
        total: Number(order.total),
        status: order.status as 'pending' | 'paid' | 'served',
        createdAt: order.created_at,
        paidAt: order.paid_at || undefined,
        servedAt: order.served_at || undefined,
        token: order.token || undefined,
        tokenUsed: order.token_used || undefined,
        tokenExpiresAt: order.token_expires_at || undefined,
        prepRequested: order.prep_requested || false,
        prepStatus: (order.prep_status || 'queue') as PrepStatus,
        prepClaimedBy: order.prep_claimed_by || undefined,
        prepClaimedAt: order.prep_claimed_at || undefined,
        readyAt: order.ready_at || undefined,
        notifyStatus: (order.notify_status || 'none') as NotifyStatus,
        eventId: order.event_id || undefined,
      }));

      // Group orders by user_email + event_id so same client = single card
      const groupMap = new Map<string, MergedOrder>();
      mappedOrders.forEach(order => {
        const key = `${order.userEmail || order.id}__${(order as any).eventId || 'no-event'}`;
        const existing = groupMap.get(key);
        if (existing) {
          // Merge items and totals
          existing.items = [...(existing.items as any[]), ...(order.items as any[])];
          existing.total += order.total;
          existing.sourceOrderIds.push(order.id);
          // Use earliest createdAt
          if (order.createdAt < existing.createdAt) {
            existing.createdAt = order.createdAt;
          }
          // Use the most "advanced" prep status
          const statusPriority: Record<string, number> = { queue: 0, preparing: 1, ready: 2, served: 3 };
          if ((statusPriority[order.prepStatus || 'queue'] || 0) > (statusPriority[existing.prepStatus || 'queue'] || 0)) {
            existing.prepStatus = order.prepStatus;
            existing.prepClaimedBy = order.prepClaimedBy;
            existing.prepClaimedAt = order.prepClaimedAt;
            existing.readyAt = order.readyAt;
          }
        } else {
          groupMap.set(key, {
            ...order,
            sourceOrderIds: [order.id],
          });
        }
      });

      const mergedOrders = Array.from(groupMap.values());
      setOrders(mergedOrders);

      // Fetch barman profiles for claimed orders
      const claimedByIds = [...new Set(mappedOrders.map(o => o.prepClaimedBy).filter(Boolean))];
      if (claimedByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', claimedByIds);

        if (profiles) {
          const profileMap: Record<string, { first_name?: string; last_name?: string }> = {};
          profiles.forEach(p => {
            profileMap[p.id] = { first_name: p.first_name || undefined, last_name: p.last_name || undefined };
          });
          setBarmanProfiles(profileMap);
        }
      }

      return mappedOrders;
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error(t('clickCollect.errorLoading'));
      return [];
    } finally {
      setLoading(false);
    }
  };

  const handleClaimOrder = async (orderId: string) => {
    try {
      const merged = orders.find(o => o.id === orderId);
      const ids = merged?.sourceOrderIds || [orderId];

      for (const id of ids) {
        const { error } = await supabase
          .from('orders')
          .update({
            prep_status: 'preparing',
            prep_claimed_by: currentUserId,
            prep_claimed_at: new Date().toISOString(),
          })
          .eq('id', id)
          .or('prep_claimed_by.is.null,prep_status.eq.queue');

        if (error) throw error;
      }

      const updatedOrders = await fetchOrders();
      const updatedOrder = updatedOrders?.find((o: any) => o.id === orderId);
      if (updatedOrder?.prepClaimedBy !== currentUserId) {
        const barmanName = getBarmanName(updatedOrder?.prepClaimedBy || '');
        toast.error(`${t('clickCollect.alreadyClaimed')} ${barmanName}`);
      } else if (updatedOrder) {
        setPreparingOrder(updatedOrder);
        toast.success(t('clickCollect.claimSuccess'));
      }
    } catch (error) {
      console.error('Error claiming order:', error);
      toast.error(t('clickCollect.errorClaim'));
    }
  };

  const handleReleaseOrder = async (orderId: string) => {
    try {
      const merged = orders.find(o => o.id === orderId);
      const ids = merged?.sourceOrderIds || [orderId];

      for (const id of ids) {
        await supabase
          .from('orders')
          .update({
            prep_status: 'queue',
            prep_claimed_by: null,
            prep_claimed_at: null,
          })
          .eq('id', id)
          .eq('prep_claimed_by', currentUserId);
      }

      toast.success(t('clickCollect.releaseSuccess'));
      fetchOrders();
    } catch (error) {
      console.error('Error releasing order:', error);
      toast.error(t('clickCollect.errorRelease'));
    }
  };

  const handleMarkReady = async (orderId: string) => {
    try {
      const merged = orders.find(o => o.id === orderId);
      const ids = merged?.sourceOrderIds || [orderId];

      for (const id of ids) {
        await supabase
          .from('orders')
          .update({
            prep_status: 'ready',
            ready_at: new Date().toISOString(),
            notify_status: 'ready',
          })
          .eq('id', id)
          .eq('prep_claimed_by', currentUserId);
      }

      // Send push notification to the order owner
      try {
        const { data: orderData } = await supabase
          .from('orders')
          .select('user_id')
          .eq('id', ids[0])
          .single();

        if (orderData?.user_id) {
          const itemsSummary = (merged?.items as any[])?.map((i: any) => `${i.qty}x ${i.name}`).join(', ') || 'Commande';
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_id: orderData.user_id,
              payload: {
                title: 'Commande prête 🎉',
                body: `${itemsSummary} – Viens récupérer ta commande !`,
                url: '/my-orders'
              }
            },
          });
        }
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }

      setPreparingOrder(null);
      toast.success(t('clickCollect.readySuccess'));
      fetchOrders();
    } catch (error) {
      console.error('Error marking order as ready:', error);
      toast.error(t('clickCollect.errorReady'));
    }
  };

  const handleMarkServed = async (orderId: string) => {
    try {
      const merged = orders.find(o => o.id === orderId);
      const ids = merged?.sourceOrderIds || [orderId];

      for (const id of ids) {
        await supabase
          .from('orders')
          .update({
            status: 'served',
            prep_status: 'served',
            served_at: new Date().toISOString(),
          })
          .eq('id', id);
      }

      toast.success(t('clickCollect.servedSuccess'));
      fetchOrders();
    } catch (error) {
      console.error('Error marking order as served:', error);
      toast.error(t('clickCollect.errorServed'));
    }
  };

  const isTimedOut = (order: Order): boolean => {
    if (!order.prepClaimedAt || order.prepStatus !== 'preparing') return false;
    const claimedTime = new Date(order.prepClaimedAt).getTime();
    return Date.now() - claimedTime > TIMEOUT_MS;
  };

  const getBarmanName = (userId: string): string => {
    const profile = barmanProfiles[userId];
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name} ${profile.last_name}`;
    }
    return userId === currentUserId ? t('clickCollect.you') : t('clickCollect.anotherBarman');
  };

  const queueOrders = orders.filter(o => o.prepStatus === 'queue');
  const preparingOrders = orders.filter(o => o.prepStatus === 'preparing');
  const readyOrders = orders.filter(o => o.prepStatus === 'ready');

  const renderOrderCard = (order: Order) => {
    const timedOut = isTimedOut(order);
    const isOwnedByCurrentUser = order.prepClaimedBy === currentUserId;

    return (
      <motion.div
        key={order.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        onClick={() => setSelectedOrder(order)}
        className="cursor-pointer"
      >
        <Card className="border-0 bg-surface p-3 sm:p-4 shadow-soft hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between mb-2 sm:mb-3">
            <div className="min-w-0">
              <p className="font-semibold text-sm sm:text-base text-foreground truncate">
                {t('clickCollect.order')} #{order.id.slice(0, 8)}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {format(new Date(order.createdAt), 'PPp', { locale: getLocale() })}
              </p>
            </div>
            <Badge className={`${getStatusBadgeColor(order.prepStatus || 'queue')} text-xs flex-shrink-0 ml-2`}>
              {getStatusLabel(order.prepStatus || 'queue')}
            </Badge>
          </div>

          {order.prepStatus === 'preparing' && order.prepClaimedBy && (
            <div className="flex items-center gap-2 mb-2 text-xs sm:text-sm">
              <ChefHat className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className={`${isOwnedByCurrentUser ? 'text-primary font-medium' : 'text-muted-foreground'} truncate`}>
                {getBarmanName(order.prepClaimedBy)}
              </span>
              {timedOut && (
                <Badge variant="destructive" className="ml-auto text-xs flex-shrink-0">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {t('clickCollect.timeout')}
                </Badge>
              )}
            </div>
          )}

          <div className="space-y-1 mb-2 sm:mb-3">
            {(order.items as any[]).map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between text-xs sm:text-sm gap-2">
                <span className="text-muted-foreground truncate">
                  {item.qty}x {item.name}
                </span>
                <span className="font-medium flex-shrink-0">{(item.unitPrice * item.qty).toFixed(2)}€</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 sm:pt-3 border-t border-border gap-2">
            <span className="font-bold text-base sm:text-lg flex-shrink-0">{order.total.toFixed(2)}€</span>
            {order.prepStatus === 'queue' && (
              <Button size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={(e) => { e.stopPropagation(); handleClaimOrder(order.id); }}>
                <Lock className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('clickCollect.prepare')}</span>
              </Button>
            )}
            {order.prepStatus === 'preparing' && isOwnedByCurrentUser && (
              <div className="flex gap-1 sm:gap-2">
                <Button size="sm" variant="outline" className="text-xs sm:text-sm h-8 sm:h-9" onClick={(e) => { e.stopPropagation(); handleReleaseOrder(order.id); }}>
                  <Unlock className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t('clickCollect.release')}</span>
                </Button>
                <Button size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={(e) => { e.stopPropagation(); handleMarkReady(order.id); }}>
                  <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t('clickCollect.markReady')}</span>
                </Button>
              </div>
            )}
            {order.prepStatus === 'ready' && (
              <Button size="sm" variant="default" className="text-xs sm:text-sm h-8 sm:h-9 bg-green-600 hover:bg-green-700" onClick={(e) => { e.stopPropagation(); handleMarkServed(order.id); }}>
                <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('clickCollect.markServed')}</span>
              </Button>
            )}
            {order.prepStatus === 'preparing' && (timedOut || !isOwnedByCurrentUser) && (
              <Button size="sm" variant="secondary" className="text-xs sm:text-sm h-8 sm:h-9" onClick={(e) => { e.stopPropagation(); handleClaimOrder(order.id); }}>
                {t('clickCollect.takeover')}
              </Button>
            )}
          </div>
        </Card>
      </motion.div>
    );
  };

  const getStatusBadgeColor = (status: PrepStatus): string => {
    switch (status) {
      case 'queue': return 'bg-yellow-500';
      case 'preparing': return 'bg-blue-500';
      case 'ready': return 'bg-green-500';
      case 'served': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  const getStatusLabel = (status: PrepStatus): string => {
    switch (status) {
      case 'queue': return t('clickCollect.statusQueue');
      case 'preparing': return t('clickCollect.statusPreparing');
      case 'ready': return t('clickCollect.statusReady');
      case 'served': return t('clickCollect.statusServed');
      default: return status;
    }
  };

  if (loading || venueLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <ListOrdered className="h-5 w-5 sm:h-6 sm:w-6 text-primary flex-shrink-0" />
            <h1 className="text-base sm:text-xl font-bold truncate">{t('clickCollect.title')}</h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="hidden sm:block">
              <EventFilter selectedEventId={selectedEventId} onEventSelect={setSelectedEventId} venueId={staffVenueId || ''} />
            </div>
            <LanguageSelector />
            
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-3 sm:p-4">
        {/* Mobile Event Filter */}
        <div className="sm:hidden mb-3">
          <EventFilter selectedEventId={selectedEventId} onEventSelect={setSelectedEventId} venueId={staffVenueId || ''} />
        </div>

        {/* Back to Barman Button */}
        <Button
          asChild
          variant="outline"
          className="mb-4 sm:mb-6 w-full sm:w-auto border-primary/30 hover:bg-primary/10"
        >
          <Link to="/barman">
            <ChefHat className="mr-2 h-4 w-4" />
            {t('barman.title')}
          </Link>
        </Button>

        <Tabs defaultValue="queue" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4 sm:mb-6 h-auto">
            <TabsTrigger value="queue" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2 sm:py-2.5">
              <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">{t('clickCollect.tabQueue')}</span>
              <span className="inline xs:hidden">Queue</span>
              <span className="text-xs">({queueOrders.length})</span>
            </TabsTrigger>
            <TabsTrigger value="preparing" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2 sm:py-2.5">
              <ChefHat className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">{t('clickCollect.tabPreparing')}</span>
              <span className="inline xs:hidden">Prep</span>
              <span className="text-xs">({preparingOrders.length})</span>
            </TabsTrigger>
            <TabsTrigger value="ready" className="gap-1 sm:gap-2 text-xs sm:text-sm py-2 sm:py-2.5">
              <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">{t('clickCollect.tabReady')}</span>
              <span className="inline xs:hidden">Ready</span>
              <span className="text-xs">({readyOrders.length})</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-3 sm:space-y-4">
            {queueOrders.length === 0 ? (
              <div className="text-center py-8 sm:py-12 text-sm sm:text-base text-muted-foreground">
                {t('clickCollect.noQueue')}
              </div>
            ) : (
              queueOrders.map(renderOrderCard)
            )}
          </TabsContent>

          <TabsContent value="preparing" className="space-y-3 sm:space-y-4">
            {preparingOrders.length === 0 ? (
              <div className="text-center py-8 sm:py-12 text-sm sm:text-base text-muted-foreground">
                {t('clickCollect.noPreparing')}
              </div>
            ) : (
              preparingOrders.map(renderOrderCard)
            )}
          </TabsContent>

          <TabsContent value="ready" className="space-y-3 sm:space-y-4">
            {readyOrders.length === 0 ? (
              <div className="text-center py-8 sm:py-12 text-sm sm:text-base text-muted-foreground">
                {t('clickCollect.noReady')}
              </div>
            ) : (
              readyOrders.map(renderOrderCard)
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Order Detail Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('clickCollect.order')} #{selectedOrder?.id.slice(0, 8)}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('clickCollect.order')} #{selectedOrder?.id.slice(0, 8)}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  {format(new Date(selectedOrder.createdAt), 'PPp', { locale: getLocale() })}
                </p>
                <Badge className={getStatusBadgeColor(selectedOrder.prepStatus || 'queue')}>
                  {getStatusLabel(selectedOrder.prepStatus || 'queue')}
                </Badge>
              </div>

              {selectedOrder.prepStatus === 'preparing' && selectedOrder.prepClaimedBy && (
                <div className="p-3 bg-surface rounded-lg">
                  <p className="text-sm font-medium mb-1">{t('clickCollect.preparedBy')}</p>
                  <p className="text-sm text-muted-foreground">{getBarmanName(selectedOrder.prepClaimedBy)}</p>
                  {selectedOrder.prepClaimedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('clickCollect.since')} {format(new Date(selectedOrder.prepClaimedAt), 'PPp', { locale: getLocale() })}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="font-medium">{t('clickCollect.items')}</p>
                {(selectedOrder.items as any[]).map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>{item.qty}x {item.name}</span>
                    <span className="font-medium">{(item.unitPrice * item.qty).toFixed(2)}€</span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-border flex justify-between items-center">
                <span className="font-bold text-lg">Total</span>
                <span className="font-bold text-lg">{selectedOrder.total.toFixed(2)}€</span>
              </div>

              <div className="flex gap-2">
                {selectedOrder.prepStatus === 'queue' && (
                  <Button className="w-full" onClick={() => { handleClaimOrder(selectedOrder.id); setSelectedOrder(null); }}>
                    <Lock className="h-4 w-4 mr-2" />
                    {t('clickCollect.prepare')}
                  </Button>
                )}
                {selectedOrder.prepStatus === 'preparing' && selectedOrder.prepClaimedBy === currentUserId && (
                  <>
                    <Button variant="outline" onClick={() => { handleReleaseOrder(selectedOrder.id); setSelectedOrder(null); }}>
                      <Unlock className="h-4 w-4 mr-2" />
                      {t('clickCollect.release')}
                    </Button>
                    <Button onClick={() => { handleMarkReady(selectedOrder.id); setSelectedOrder(null); }}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {t('clickCollect.markReady')}
                    </Button>
                  </>
                )}
                {selectedOrder.prepStatus === 'preparing' && (isTimedOut(selectedOrder) || selectedOrder.prepClaimedBy !== currentUserId) && (
                  <Button className="w-full" variant="secondary" onClick={() => { handleClaimOrder(selectedOrder.id); setSelectedOrder(null); }}>
                    {t('clickCollect.takeover')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Order Preparation Full Screen View */}
      {preparingOrder && (
        <OrderPreparationView
          order={preparingOrder}
          onComplete={() => handleMarkReady(preparingOrder.id)}
          onCancel={() => setPreparingOrder(null)}
        />
      )}
    </div>
  );
}

function getStatusBadgeColor(status: PrepStatus): string {
  switch (status) {
    case 'queue': return 'bg-yellow-500';
    case 'preparing': return 'bg-blue-500';
    case 'ready': return 'bg-green-500';
    case 'served': return 'bg-gray-500';
    default: return 'bg-gray-400';
  }
}

function getStatusLabel(status: PrepStatus): string {
  return status;
}
