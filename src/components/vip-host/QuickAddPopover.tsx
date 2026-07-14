import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Plus, Minus, Loader2, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface QuickItem {
  id: string;
  name: string;
  price: number;
  type: 'bottle' | 'extra' | 'service';
}

interface CartEntry {
  item: QuickItem;
  quantity: number;
}

interface QuickAddPopoverProps {
  items: QuickItem[];
  reservationId: string;
  venueId: string;
  onOrderSent?: () => void;
  children: React.ReactNode;
}

export function QuickAddPopover({ items, reservationId, venueId, onOrderSent, children }: QuickAddPopoverProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [sending, setSending] = useState(false);

  const addToCart = (item: QuickItem) => {
    setCart(prev => {
      const existing = prev.find(e => e.item.id === item.id);
      if (existing) {
        return prev.map(e => e.item.id === item.id ? { ...e, quantity: e.quantity + 1 } : e);
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(e => e.item.id === itemId ? { ...e, quantity: e.quantity + delta } : e)
        .filter(e => e.quantity > 0)
    );
  };

  const cartTotal = cart.reduce((sum, e) => sum + e.item.price * e.quantity, 0);
  const cartCount = cart.reduce((sum, e) => sum + e.quantity, 0);

  const sendOrder = async () => {
    if (cart.length === 0) return;
    setSending(true);

    try {
      const { data: order, error: orderError } = await supabase
        .from('vip_table_orders')
        .insert({
          venue_id: venueId,
          table_reservation_id: reservationId,
          status: 'preparing',
          total_amount: cartTotal,
        })
        .select('id')
        .single();

      if (orderError) throw orderError;

      const orderItems = cart.map(e => ({
        order_id: order.id,
        menu_item_id: e.item.id,
        quantity: e.quantity,
        unit_price: e.item.price,
        is_included: e.item.price === 0,
      }));

      const { error: itemsError } = await supabase
        .from('vip_table_order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      toast.success(`${t('vipOrders.orderSent')} (${cartCount} ${t('vipOrders.articles')})`);
      setCart([]);
      setOpen(false);
      onOrderSent?.();
    } catch (error) {
      console.error('Error sending order:', error);
      toast.error(t('vipOrders.sendError'));
    } finally {
      setSending(false);
    }
  };

  const bottles = items.filter(i => i.type === 'bottle');
  const extras = items.filter(i => i.type !== 'bottle');

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setCart([]); }}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      {/* w-80 fixe déborderait sur un petit téléphone (360px) : plafonné à la largeur écran. */}
      <PopoverContent
        className="w-80 max-w-[calc(100vw-1.5rem)] p-0"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-h-[400px] overflow-y-auto p-2">
          {bottles.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wide px-2 py-1 font-medium" style={{ color: 'rgba(255,255,255,0.36)' }}>
                {t('quickAdd.bottles')}
              </div>
              <div className="space-y-0.5">
                {bottles.map((item) => {
                  const inCart = cart.find(e => e.item.id === item.id);
                  return (
                    <div key={item.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5">
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="text-sm font-medium truncate" style={{ color: 'rgba(255,255,255,0.96)' }}>{item.name}</div>
                        <div className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.36)' }}>{item.price}€</div>
                      </div>
                      {inCart ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => updateQuantity(item.id, -1)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.96)' }}>{inCart.quantity}</span>
                          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => updateQuantity(item.id, 1)}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => addToCart(item)}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {extras.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide px-2 py-1 font-medium" style={{ color: 'rgba(255,255,255,0.36)' }}>
                {t('quickAdd.extras')}
              </div>
              <div className="space-y-0.5">
                {extras.map((item) => {
                  const inCart = cart.find(e => e.item.id === item.id);
                  return (
                    <div key={item.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5">
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="text-sm font-medium truncate" style={{ color: 'rgba(255,255,255,0.96)' }}>{item.name}</div>
                        <div className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.36)' }}>{item.price}€</div>
                      </div>
                      {inCart ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => updateQuantity(item.id, -1)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.96)' }}>{inCart.quantity}</span>
                          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => updateQuantity(item.id, 1)}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => addToCart(item)}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="text-center py-4 text-sm" style={{ color: 'rgba(255,255,255,0.36)' }}>
              {t('quickAdd.noItems')}
            </div>
          )}
        </div>

        {/* Cart Footer */}
        {cart.length > 0 && (
          <div className="p-2" style={{ borderTop: '1px solid rgba(255,255,255,0.085)', background: 'rgba(255,255,255,0.025)' }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.36)' }}>{cartCount} article{cartCount > 1 ? 's' : ''}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.96)' }}>{cartTotal}€</span>
            </div>
            <Button
              className="w-full h-11 font-semibold gap-2"
              onClick={sendOrder}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {t('quickAdd.sendOrder')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
