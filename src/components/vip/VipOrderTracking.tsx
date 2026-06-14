import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, ChefHat } from 'lucide-react';

interface OrderItem {
  id: string;
  item_name: string;
  quantity: number;
}

interface TrackedOrder {
  id: string;
  status: string;
  created_at: string;
  items: OrderItem[];
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  pending: {
    label: 'Demandée',
    icon: Clock,
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  confirmed: {
    label: 'Confirmée',
    icon: Clock,
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  preparing: {
    label: 'En préparation',
    icon: ChefHat,
    className: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
};

interface VipOrderTrackingProps {
  reservationId: string;
  onOrderServed?: () => void;
}

export function VipOrderTracking({ reservationId, onOrderServed }: VipOrderTrackingProps) {
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const prevOrderIdsRef = useState<Set<string>>(new Set())[0];

  const fetchOrders = async () => {
    try {
      // Only fetch non-served, non-cancelled orders
      const { data: ordersData } = await supabase
        .from('vip_table_orders')
        .select('id, status, created_at')
        .eq('table_reservation_id', reservationId)
        .in('status', ['pending', 'confirmed', 'preparing'])
        .order('created_at', { ascending: false });

      if (!ordersData || ordersData.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      const orderIds = ordersData.map(o => o.id);
      const { data: itemsData } = await supabase
        .from('vip_table_order_items')
        .select('id, order_id, quantity, vip_menu_items(name)')
        .in('order_id', orderIds);

      const itemsMap: Record<string, OrderItem[]> = {};
      (itemsData || []).forEach((item: any) => {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push({
          id: item.id,
          item_name: item.vip_menu_items?.name || 'Article',
          quantity: item.quantity,
        });
      });

      setOrders(
        ordersData.map(o => ({
          ...o,
          items: itemsMap[o.id] || [],
        }))
      );
    } catch (err) {
      console.error('Error fetching tracked orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel(`vip_order_tracking_${reservationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vip_table_orders',
          filter: `table_reservation_id=eq.${reservationId}`,
        },
        (payload) => {
          // If an order changed to 'served', notify parent to refresh consumptions
          if (payload.new && (payload.new as any).status === 'served') {
            onOrderServed?.();
          }
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reservationId]);

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orders.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium px-1">
        Suivi de commandes
      </h3>
      {orders.map(order => {
        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
        const Icon = config.icon;
        return (
          <div
            key={order.id}
            className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <Badge className={config.className}>{config.label}</Badge>
            </div>
            <div className="pl-5 space-y-0.5">
              {order.items.map(item => (
                <p key={item.id} className="text-sm text-muted-foreground">
                  {item.quantity > 1 && `${item.quantity}x `}
                  {item.item_name}
                </p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
