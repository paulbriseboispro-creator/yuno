import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const TILE_BG = 'rgba(255,255,255,0.025)';
import { supabase } from '@/integrations/supabase/client';
import { Clock, CheckCircle2, Loader2, Package, Wine } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr, es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';

interface OrderItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
}

interface TableOrder {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  confirmed_at: string | null;
  served_at: string | null;
  items: OrderItem[];
}

interface VipTableOrdersProps {
  reservationId: string;
  venueId: string;
}

export function VipTableOrders({ reservationId, venueId }: VipTableOrdersProps) {
  const { language, t } = useLanguage();
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const locale = language === 'fr' ? fr : language === 'es' ? es : undefined;

  const statusConfig: Record<string, { labelKey: string; className: string }> = {
    pending: { labelKey: 'vipHost.orderStatusPending', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    confirmed: { labelKey: 'vipHost.orderStatusConfirmed', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    preparing: { labelKey: 'vipHost.orderStatusPreparing', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
    served: { labelKey: 'vipHost.orderStatusServed', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    cancelled: { labelKey: 'vipHost.orderStatusCancelled', className: 'bg-destructive/20 text-destructive border-destructive/30' },
  };

  const fetchOrders = async () => {
    try {
      const { data: ordersData, error } = await supabase
        .from('vip_table_orders')
        .select('id, status, total_amount, created_at, confirmed_at, served_at')
        .eq('table_reservation_id', reservationId)
        .eq('venue_id', venueId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const orderIds = (ordersData || []).map(o => o.id);
      let itemsMap: Record<string, OrderItem[]> = {};

      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('vip_table_order_items')
          .select('id, order_id, quantity, unit_price, vip_menu_items(name)')
          .in('order_id', orderIds);

        (itemsData || []).forEach((item: any) => {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push({
            id: item.id,
            item_name: item.vip_menu_items?.name || 'Article',
            quantity: item.quantity,
            unit_price: item.unit_price,
          });
        });
      }

      setOrders((ordersData || []).map(o => ({
        ...o,
        items: itemsMap[o.id] || [],
      })));
    } catch (error) {
      console.error('Error fetching table orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel(`table_orders_${reservationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'vip_table_orders',
        filter: `table_reservation_id=eq.${reservationId}`,
      }, () => fetchOrders())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [reservationId, venueId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  const activeOrders = orders.filter(o => ['pending', 'confirmed', 'preparing'].includes(o.status));
  const completedOrders = orders.filter(o => o.status === 'served');

  if (orders.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: T3 }}>
        <Package className="w-10 h-10 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.14)' }} />
        <p className="text-sm">{t('vipHost.noOrders')}</p>
      </div>
    );
  }

  const renderOrderCard = (order: TableOrder) => {
    const config = statusConfig[order.status] || statusConfig.pending;
    return (
      <div key={order.id} className="p-3" style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge className={config.className}>{t(config.labelKey)}</Badge>
            <span className="text-xs" style={{ color: T3 }}>
              {formatDistanceToNow(new Date(order.created_at), { locale, addSuffix: true })}
            </span>
          </div>
          <span className="font-bold text-sm tabular-nums" style={{ color: T1 }}>{order.total_amount}€</span>
        </div>
        <div className="space-y-1">
          {order.items.map(item => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span style={{ color: T3 }}>
                {item.quantity > 1 && `${item.quantity}x `}{item.item_name}
              </span>
              <span className="text-xs tabular-nums" style={{ color: T1 }}>{(item.quantity * item.unit_price).toFixed(0)}€</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {activeOrders.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: T3 }}>{t('vipHost.inProgress')}</h4>
          <div className="space-y-2">
            {activeOrders.map(renderOrderCard)}
          </div>
        </div>
      )}

      {completedOrders.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: T3 }}>{t('vipHost.delivered')}</h4>
          <div className="space-y-2">
            {completedOrders.map(renderOrderCard)}
          </div>
        </div>
      )}
    </div>
  );
}
