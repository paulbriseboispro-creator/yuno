import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  pending: {
    label: 'Demandée',
    icon: Clock,
    color: '#F0A92C',
  },
  confirmed: {
    label: 'Confirmée',
    icon: Clock,
    color: '#E5E5E5',
  },
  preparing: {
    label: 'En préparation',
    icon: ChefHat,
    color: '#E8192C',
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
      <p className="font-mono uppercase" style={{ fontSize: 10, color: '#5A5A5E', letterSpacing: '0.14em', paddingLeft: 2 }}>
        Suivi de commandes
      </p>
      {orders.map(order => {
        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
        const Icon = config.icon;
        return (
          <div key={order.id} className="yuno-card p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
              <span
                className="font-mono font-bold uppercase"
                style={{ fontSize: 10, letterSpacing: '0.08em', color: config.color, padding: '3px 8px', borderRadius: 999, background: `${config.color}1A`, border: `1px solid ${config.color}40` }}
              >
                {config.label}
              </span>
            </div>
            <div className="pl-5 space-y-0.5">
              {order.items.map(item => (
                <p key={item.id} className="font-sans" style={{ fontSize: 13, color: '#9A9A9A' }}>
                  {item.quantity > 1 && `${item.quantity}× `}
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
