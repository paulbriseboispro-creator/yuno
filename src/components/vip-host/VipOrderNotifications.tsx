import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { fr, es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Bell,
  Check,
  X,
  Clock,
  Wine,
  ChevronRight,
  Loader2,
  ShoppingBag,
  CheckCircle2,
} from 'lucide-react';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG = 'rgba(255,255,255,0.025)';

interface VipTableOrder {
  id: string;
  table_reservation_id: string;
  status: string;
  total_amount: number;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  served_at?: string | null;
  reservation_name: string;
  zone_name: string;
  zone_color: string;
  items: VipOrderItem[];
}

interface VipOrderItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  is_included: boolean;
  item_name: string;
  item_category: string;
  item_image_url: string | null;
  item_brand: string | null;
  item_volume_cl: number | null;
}

interface VipOrderNotificationsProps {
  venueId: string;
  onOrderConfirmed?: () => void;
  onPendingCountChange?: (count: number) => void;
}

export function VipOrderNotifications({ venueId, onOrderConfirmed, onPendingCountChange }: VipOrderNotificationsProps) {
  const { language, t } = useLanguage();
  const [orders, setOrders] = useState<VipTableOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<VipTableOrder | null>(null);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('new');

  const locale = language === 'fr' ? fr : language === 'es' ? es : undefined;

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel(uniqueChannel('vip_orders_changes'))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vip_table_orders',
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId]);

  const fetchOrders = async () => {
    try {
      // Fetch orders including served (last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { data: ordersData, error } = await supabase
        .from('vip_table_orders')
        .select(`
          id, table_reservation_id, status, total_amount, notes, created_at, confirmed_at, served_at,
          table_reservations!inner(
            full_name,
            table_zones!inner(name, color)
          )
        `)
        .eq('venue_id', venueId)
        .or(`status.in.(pending,confirmed,preparing),and(status.eq.served,served_at.gte.${oneHourAgo})`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch order items
      const orderIds = (ordersData || []).map(o => o.id);
      let itemsMap: Record<string, VipOrderItem[]> = {};

      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('vip_table_order_items')
          .select(`
            id, order_id, menu_item_id, quantity, unit_price, is_included,
            vip_menu_items(name, category, image_url, brand, volume_cl)
          `)
          .in('order_id', orderIds);

        (itemsData || []).forEach((item: any) => {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push({
            id: item.id,
            menu_item_id: item.menu_item_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            is_included: item.is_included,
            item_name: item.vip_menu_items?.name || 'Unknown',
            item_category: item.vip_menu_items?.category || 'other',
            item_image_url: item.vip_menu_items?.image_url || null,
            item_brand: item.vip_menu_items?.brand || null,
            item_volume_cl: item.vip_menu_items?.volume_cl || null,
          });
        });
      }

      const mapped: VipTableOrder[] = (ordersData || []).map((o: any) => ({
        id: o.id,
        table_reservation_id: o.table_reservation_id,
        status: o.status,
        total_amount: o.total_amount,
        notes: o.notes,
        created_at: o.created_at,
        confirmed_at: o.confirmed_at,
        served_at: o.served_at,
        reservation_name: o.table_reservations?.full_name || 'Client',
        zone_name: o.table_reservations?.table_zones?.name || '',
        zone_color: o.table_reservations?.table_zones?.color || '#666',
        items: itemsMap[o.id] || [],
      }));

      setOrders(mapped);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmOrder = async (orderId: string) => {
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('vip_table_orders')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: user?.id,
        })
        .eq('id', orderId);

      if (error) throw error;
      toast.success(t('vipOrders.confirmed'));
      setSelectedOrder(null);
      onOrderConfirmed?.();
      fetchOrders();
    } catch (error) {
      console.error('Error confirming order:', error);
      toast.error(t('vip.error'));
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm(t('vipOrders.cancelConfirm'))) return;
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('vip_table_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);

      if (error) throw error;
      toast.success(t('vipOrders.cancelled'));
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error cancelling order:', error);
      toast.error(t('vip.error'));
    } finally {
      setProcessing(false);
    }
  };

  const handleMarkServed = async (orderId: string) => {
    setProcessing(true);
    try {
      // Conditional update guards against double-serve: only an order that is
      // not yet served/cancelled may transition. If two VIP hosts click at the
      // same time, only the first wins — the second updates 0 rows and we skip
      // the consumption insert, preventing double-billing the table.
      const { data: served, error } = await supabase
        .from('vip_table_orders')
        .update({
          status: 'served',
          served_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .in('status', ['pending', 'confirmed', 'preparing'])
        .select();

      if (error) throw error;

      if (!served || served.length === 0) {
        toast.error(t('vipOrders.alreadyServed') || t('vip.error'));
        setSelectedOrder(null);
        fetchOrders();
        return;
      }

      // Add items to vip_consumptions
      const order = orders.find(o => o.id === orderId);
      if (order) {
        const { data: { user } } = await supabase.auth.getUser();
        
        const { error: consErr } = await supabase.from('vip_consumptions').insert(
          order.items.map(item => ({
            table_reservation_id: order.table_reservation_id,
            venue_id: venueId,
            item_name: item.item_name,
            item_type: item.item_category === 'soft' || item.item_category === 'mixer' ? 'extra' : 'bottle',
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * item.unit_price,
            served_by: user?.id,
          }))
        );
        if (consErr) throw consErr;
      }

      toast.success(t('vipOrders.served'));
      setSelectedOrder(null);
      onOrderConfirmed?.();
      fetchOrders();
    } catch (error) {
      console.error('Error marking served:', error);
      toast.error(t('vip.error'));
    } finally {
      setProcessing(false);
    }
  };

  const pendingOrders = orders.filter(o => o.status === 'pending');
  const activeOrders = orders.filter(o => ['confirmed', 'preparing'].includes(o.status));
  const servedOrders = orders.filter(o => o.status === 'served');

  // Notify parent of pending count changes
  useEffect(() => {
    onPendingCountChange?.(pendingOrders.length);
  }, [pendingOrders.length, onPendingCountChange]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{t('vipOrders.statusPending')}</Badge>;
      case 'confirmed':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">{t('vipOrders.statusConfirmed')}</Badge>;
      case 'preparing':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">{t('vipOrders.statusPreparing')}</Badge>;
      case 'served':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{t('vipOrders.statusServed')}</Badge>;
      default:
        return null;
    }
  };

  const getTabOrders = () => {
    switch (activeTab) {
      case 'new': return pendingOrders;
      case 'active': return activeOrders;
      case 'served': return servedOrders;
      default: return orders;
    }
  };

  const renderOrderCard = (order: VipTableOrder) => (
    <div
      key={order.id}
      className="p-4 cursor-pointer transition-all"
      style={{
        background: INNER_BG,
        borderRadius: 14,
        border: order.status === 'pending' ? '1px solid rgba(234,179,8,0.5)' : `1px solid ${BORDER}`,
      }}
      onClick={() => setSelectedOrder(order)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: order.zone_color + '20' }}
          >
            <Wine className="h-5 w-5" style={{ color: order.zone_color }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span style={{ color: T1, fontWeight: 600 }}>{order.reservation_name}</span>
              {getStatusBadge(order.status)}
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: T3 }}>
              <Badge variant="outline" style={{ borderColor: order.zone_color, color: order.zone_color }}>
                {order.zone_name}
              </Badge>
              <span>•</span>
              <Clock className="h-3 w-3" />
              <span>
                {formatDistanceToNow(new Date(order.created_at), { locale, addSuffix: true })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="tabular-nums" style={{ color: T1, fontWeight: 700 }}>{order.total_amount}€</p>
            <p className="text-xs tabular-nums" style={{ color: T3 }}>{order.items.length} {t('vipOrders.articles')}</p>
          </div>
          <ChevronRight className="h-5 w-5" style={{ color: T3 }} />
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  const tabOrders = getTabOrders();

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="new" className="flex-1 gap-1 text-xs">
            {t('vipOrders.newTab')}
            {pendingOrders.length > 0 && (
              <Badge className="ml-1 h-5 min-w-5 p-0 flex items-center justify-center text-[10px] bg-amber-500 text-black">
                {pendingOrders.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="active" className="flex-1 gap-1 text-xs">
            {t('vipOrders.activeTab')}
            {activeOrders.length > 0 && (
              <Badge className="ml-1 h-5 min-w-5 p-0 flex items-center justify-center text-[10px] bg-blue-500 text-white">
                {activeOrders.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="served" className="flex-1 gap-1 text-xs">
            {t('vipOrders.servedTab')}
            {servedOrders.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 p-0 flex items-center justify-center text-[10px]">
                {servedOrders.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Orders List */}
      {tabOrders.length === 0 ? (
        <div className="text-center py-8" style={{ color: T3 }}>
          <ShoppingBag className="h-12 w-12 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
          <p>
            {activeTab === 'new' && t('vipOrders.noNew')}
            {activeTab === 'active' && t('vipOrders.noActive')}
            {activeTab === 'served' && t('vipOrders.noServed')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tabOrders.map(renderOrderCard)}
        </div>
      )}

      {/* Order Detail Sheet */}
      <Sheet open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl">
          {selectedOrder && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <SheetTitle>{t('vipOrders.orderFrom')} {selectedOrder.reservation_name}</SheetTitle>
                  {getStatusBadge(selectedOrder.status)}
                </div>
                <div className="flex items-center gap-2 text-sm" style={{ color: T3 }}>
                  <Badge variant="outline" style={{ borderColor: selectedOrder.zone_color, color: selectedOrder.zone_color }}>
                    {selectedOrder.zone_name}
                  </Badge>
                  <span>•</span>
                  <span className="tabular-nums">{format(new Date(selectedOrder.created_at), 'HH:mm', { locale })}</span>
                </div>
              </SheetHeader>

              <ScrollArea className="h-[calc(100%-200px)]">
                <div className="space-y-3">
                  {selectedOrder.items.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg"
                      style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-black overflow-hidden flex items-center justify-center shrink-0">
                          {item.item_image_url ? (
                            <img
                              src={item.item_image_url}
                              alt={item.item_name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <Wine className="h-5 w-5" style={{ color: T3 }} />
                          )}
                        </div>
                        <div>
                          <p style={{ color: T1, fontWeight: 500 }}>
                            {item.quantity > 1 && `${item.quantity}x `}
                            {item.item_name}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.item_brand && (
                              <span className="text-xs" style={{ color: T3 }}>{item.item_brand}</span>
                            )}
                            {item.item_volume_cl && (
                              <span className="text-xs tabular-nums" style={{ color: T3 }}>{item.item_volume_cl}cl</span>
                            )}
                             {item.is_included && (
                              <Badge variant="secondary" className="text-xs text-emerald-400">
                                {t('vipOrders.included')}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>
                        {item.is_included ? t('vipOrders.included') : `${item.quantity * item.unit_price}€`}
                      </span>
                    </div>
                  ))}
                </div>

                {selectedOrder.notes && (
                  <div className="mt-4 p-3 rounded-lg" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
                    <p className="text-xs mb-1" style={{ color: T3 }}>Notes:</p>
                    <p className="text-sm" style={{ color: T1 }}>{selectedOrder.notes}</p>
                  </div>
                )}

                <div className="mt-4 p-3 rounded-lg" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center justify-between">
                    <span style={{ color: T3 }}>{t('vipOrders.totalToPay')}</span>
                    <span className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>{selectedOrder.total_amount}€</span>
                  </div>
                </div>
              </ScrollArea>

              {/* Actions */}
              <div className="absolute bottom-0 left-0 right-0 p-4 backdrop-blur space-y-2" style={{ background: 'rgba(10,10,12,0.92)', borderTop: `1px solid ${BORDER}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
                {selectedOrder.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleCancelOrder(selectedOrder.id)}
                      disabled={processing}
                    >
                      <X className="h-4 w-4 mr-2" />
                       {t('vipOrders.refuse')}
                    </Button>
                    <Button
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                      onClick={() => handleConfirmOrder(selectedOrder.id)}
                      disabled={processing}
                    >
                      {processing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          {t('vipOrders.confirm')}
                        </>
                      )}
                    </Button>
                  </div>
                )}
                {(selectedOrder.status === 'confirmed' || selectedOrder.status === 'preparing') && (
                  <Button
                    className="w-full bg-amber-500 hover:bg-amber-600 text-black"
                    onClick={() => handleMarkServed(selectedOrder.id)}
                    disabled={processing}
                  >
                    {processing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        {t('vipOrders.markServed')}
                      </>
                    )}
                  </Button>
                )}
                {selectedOrder.status === 'served' && (
                  <div className="text-center text-sm text-emerald-400 flex items-center justify-center gap-2 py-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('vipOrders.orderServedAt')}
                    {selectedOrder.served_at && (
                      <span className="tabular-nums" style={{ color: T3 }}>
                        {t('vipOrders.at')} {format(new Date(selectedOrder.served_at), 'HH:mm', { locale })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
