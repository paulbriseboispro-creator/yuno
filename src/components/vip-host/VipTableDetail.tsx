import { useState, useMemo } from 'react';
import { VipReservation, VipConsumption } from '@/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, Clock, MapPin, Wine, Plus, CheckCircle2, 
  Sparkles, Package, Loader2, History, TrendingUp, 
  Camera, User, Target, Minus, Trash2, Send, X, ShoppingBag
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr, es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MinimumSpendBar } from './MinimumSpendBar';
import { VipTableOrders } from './VipTableOrders';
import { VipGuestBlackBook } from './VipGuestBlackBook';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const TILE_BG  = 'rgba(255,255,255,0.025)';

const tile: React.CSSProperties = {
  background: TILE_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
};

interface QuickItem {
  id: string;
  name: string;
  item_type: 'bottle' | 'extra' | 'service';
  default_price: number;
  category?: string;
}

interface CartItem {
  item: QuickItem;
  quantity: number;
}

interface VipTableDetailProps {
  reservation: VipReservation | null;
  consumptions: VipConsumption[];
  quickItems: QuickItem[];
  open: boolean;
  onClose: () => void;
  onAddConsumption: (
    reservationId: string,
    itemName: string,
    itemType: 'bottle' | 'extra' | 'service',
    quantity: number,
    unitPrice: number,
    notes?: string
  ) => Promise<void>;
  onUpdateStatus: (
    reservationId: string,
    status: VipReservation['vipStatus'],
    tableId?: string
  ) => Promise<void>;
  onReassign?: (reservation: VipReservation) => void;
  canReassign?: boolean;
  actionsDisabled?: boolean;
  venueId?: string;
}

// Default items when none configured
const defaultQuickItems: QuickItem[] = [
  { id: 'd1', name: 'Champagne', item_type: 'bottle', default_price: 150, category: 'champagne' },
  { id: 'd2', name: 'Vodka', item_type: 'bottle', default_price: 120, category: 'vodka' },
  { id: 'd3', name: 'Whisky', item_type: 'bottle', default_price: 130, category: 'whisky' },
  { id: 'd4', name: 'Gin', item_type: 'bottle', default_price: 110, category: 'gin' },
  { id: 'd5', name: 'Soft', item_type: 'extra', default_price: 8, category: 'soft' },
  { id: 'd6', name: 'Red Bull', item_type: 'extra', default_price: 10, category: 'energy' },
  { id: 'd7', name: 'Ice Bucket', item_type: 'service', default_price: 0, category: 'service' },
];

export function VipTableDetail({ 
  reservation, 
  consumptions,
  quickItems: providedQuickItems,
  open, 
  onClose,
  onAddConsumption,
  onUpdateStatus,
  onReassign,
  canReassign = false,
  actionsDisabled = false,
  venueId,
}: VipTableDetailProps) {
  const { language, t } = useLanguage();
  const [showAddItem, setShowAddItem] = useState(false);
  const [customItem, setCustomItem] = useState({ name: '', price: '', quantity: '1' });
  const [loading, setLoading] = useState(false);
  const [orderCart, setOrderCart] = useState<CartItem[]>([]);
  const [sendingOrder, setSendingOrder] = useState(false);
  
  // Use provided quick items or fall back to defaults
  const items = providedQuickItems.length > 0 ? providedQuickItems : defaultQuickItems;

  const locale = language === 'fr' ? fr : language === 'es' ? es : undefined;
  
  const totalConsumed = reservation ? consumptions.reduce((sum, c) => sum + c.totalPrice, 0) : 0;
  const remainingCredit = reservation ? reservation.totalPrice - totalConsumed : 0;
  
  const timeActive = reservation?.placedAt 
    ? formatDistanceToNow(new Date(reservation.placedAt), { locale })
    : null;

  // Cart helpers
  const cartTotal = orderCart.reduce((sum, ci) => sum + ci.item.default_price * ci.quantity, 0);
  const cartItemCount = orderCart.reduce((sum, ci) => sum + ci.quantity, 0);

  const addToCart = (item: QuickItem) => {
    setOrderCart(prev => {
      const existing = prev.find(ci => ci.item.id === item.id);
      if (existing) {
        return prev.map(ci => ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateCartQuantity = (itemId: string, delta: number) => {
    setOrderCart(prev => {
      return prev
        .map(ci => ci.item.id === itemId ? { ...ci, quantity: ci.quantity + delta } : ci)
        .filter(ci => ci.quantity > 0);
    });
  };

  const clearCart = () => setOrderCart([]);

  const sendOrder = async () => {
    if (!reservation || orderCart.length === 0 || !venueId) return;
    
    setSendingOrder(true);
    try {
      // Create order
      const { data: order, error: orderError } = await supabase
        .from('vip_table_orders')
        .insert({
          venue_id: venueId,
          table_reservation_id: reservation.id,
          status: 'pending',
          total_amount: cartTotal,
          notes: null,
        })
        .select('id')
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = orderCart.map(ci => ({
        order_id: order.id,
        menu_item_id: ci.item.id,
        quantity: ci.quantity,
        unit_price: ci.item.default_price,
        is_included: ci.item.default_price === 0,
      }));

      const { error: itemsError } = await supabase
        .from('vip_table_order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      toast.success(t('vipOrders.orderSent'));
      setOrderCart([]);
    } catch (error) {
      console.error('Error sending order:', error);
      toast.error(t('vipOrders.sendError'));
    } finally {
      setSendingOrder(false);
    }
  };

  // Calculate statistics
  const stats = useMemo(() => {
    if (!reservation || consumptions.length === 0) return null;

    const times = consumptions
      .filter((_, i) => i < consumptions.length - 1)
      .map((c, i) => {
        const current = new Date(c.servedAt).getTime();
        const next = new Date(consumptions[i + 1].servedAt).getTime();
        return (current - next) / (1000 * 60);
      });

    const avgTimeBetween = times.length > 0 
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;

    const byType = consumptions.reduce((acc, c) => {
      const type = c.itemType || 'other';
      acc[type] = (acc[type] || 0) + c.totalPrice;
      return acc;
    }, {} as Record<string, number>);

    return {
      avgTimeBetween,
      totalItems: consumptions.reduce((sum, c) => sum + c.quantity, 0),
      byType,
    };
  }, [reservation, consumptions]);

  if (!reservation) return null;

  const handleCustomAddToCart = () => {
    if (!customItem.name || !customItem.price) return;
    const price = parseFloat(customItem.price);
    const qty = parseInt(customItem.quantity) || 1;
    const fakeItem: QuickItem = {
      id: `custom-${Date.now()}`,
      name: customItem.name,
      item_type: 'extra',
      default_price: price,
      category: 'custom',
    };
    for (let i = 0; i < qty; i++) {
      addToCart(fakeItem);
    }
    toast.success(t('vipHost.addedToCart').replace('{name}', customItem.name));
    setCustomItem({ name: '', price: '', quantity: '1' });
    setShowAddItem(false);
  };

  const handleMarkFinished = async () => {
    setLoading(true);
    try {
      await onUpdateStatus(reservation.id, 'finished');
      toast.success(t('vipOrders.tableFinished'));
      onClose();
    } catch (error) {
      toast.error(t('vip.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl">
        <SheetHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${reservation.zoneColor}20` }}
              >
                <User className="w-5 h-5" style={{ color: reservation.zoneColor }} />
              </div>
              <div>
                <SheetTitle className="text-xl text-left" style={{ color: T1 }}>{reservation.fullName}</SheetTitle>
                <div className="flex items-center gap-2 text-sm" style={{ color: T3 }}>
                  <span>{reservation.zoneName}</span>
                  {(reservation.assignedTableName || reservation.assignedTableId) && (
                    <>
                      <span>•</span>
                      <span>{reservation.assignedTableName || reservation.assignedTableId}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <Badge 
              variant="outline"
              className="text-xs"
              style={{
                borderColor: ['finished', 'no_show', 'denied'].includes(reservation.vipStatus) ? 'hsl(var(--muted-foreground))' : reservation.zoneColor,
                color: ['finished', 'no_show', 'denied'].includes(reservation.vipStatus) ? 'hsl(var(--muted-foreground))' : reservation.zoneColor
              }}
            >
              {reservation.vipStatus === 'waiting' ? t('vipHost.statusWaiting')
                : reservation.vipStatus === 'finished' ? t('vipHost.statusFinished')
                : reservation.vipStatus === 'no_show' ? t('vipHost.statusNoShow')
                : reservation.vipStatus === 'denied' ? t('vipHost.statusDenied')
                : t('vipHost.statusInside')}
            </Badge>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100%-100px)]">
          <div className="space-y-5 pb-24 pt-2">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 text-center" style={tile}>
                <Users className="w-4 h-4 mx-auto mb-1" style={{ color: T3 }} />
                <div className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>{reservation.guestCount}</div>
                <div className="text-[10px]" style={{ color: T3 }}>{t('vipHost.guests')}</div>
              </div>

              {timeActive && (
                <div className="p-3 text-center" style={tile}>
                  <Clock className="w-4 h-4 mx-auto mb-1" style={{ color: T3 }} />
                  <div className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>{timeActive.split(' ')[0]}</div>
                  <div className="text-[10px]" style={{ color: T3 }}>{timeActive.split(' ').slice(1).join(' ')}</div>
                </div>
              )}

              <div
                className="p-3 text-center"
                style={totalConsumed > 0 ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 12 } : tile}
              >
                <Sparkles className="w-4 h-4 mx-auto mb-1" style={{ color: totalConsumed > 0 ? POS : T3 }} />
                <div className="tabular-nums" style={{ color: totalConsumed > 0 ? POS : T3, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
                  {totalConsumed.toFixed(0)}€
                </div>
                <div className="text-[10px]" style={{ color: T3 }}>{t('vipHost.consumedLabel')}</div>
              </div>
            </div>

            {/* Carnet VIP — reconnaissance client (dépense vie, bouteilles préférées, notes) */}
            {venueId && (reservation.userId || reservation.userEmail) && (
              <VipGuestBlackBook venueId={venueId} userId={reservation.userId} email={reservation.userEmail} />
            )}

            <Tabs defaultValue="add" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="add" className="flex-1 gap-1">
                  <Wine className="w-3.5 h-3.5" />
                  {t('vipHost.addTab')}
                  {cartItemCount > 0 && (
                    <Badge className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-primary text-primary-foreground">
                      {cartItemCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex-1 gap-1">
                  <ShoppingBag className="w-3.5 h-3.5" />
                  {t('vipHost.ordersTab')}
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1 gap-1">
                  <History className="w-3.5 h-3.5" />
                  {t('vipHost.consoTab')}
                </TabsTrigger>
                <TabsTrigger value="stats" className="flex-1 gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Stats
                </TabsTrigger>
              </TabsList>

              {/* Add Tab - Cart System */}
              <TabsContent value="add" className="mt-4">
                <div className="grid grid-cols-4 gap-2">
                  {items.map((item) => (
                    <Button
                      key={item.id}
                      variant="outline"
                      size="sm"
                      className="h-auto py-2 flex-col gap-0.5 relative"
                      onClick={() => addToCart(item)}
                    >
                      <span className="text-xs truncate w-full">{item.name}</span>
                      {item.default_price > 0 && (
                        <span className="text-[10px] tabular-nums" style={{ color: T3 }}>{item.default_price}€</span>
                      )}
                      {/* Quantity badge on item button */}
                      {orderCart.find(ci => ci.item.id === item.id) && (
                        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                          {orderCart.find(ci => ci.item.id === item.id)!.quantity}
                        </span>
                      )}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto py-2 flex-col gap-0.5"
                    onClick={() => setShowAddItem(!showAddItem)}
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-[10px]">{t('vipHost.other')}</span>
                  </Button>
                </div>

                {/* Custom item form */}
                {showAddItem && (
                  <div className="p-4 mt-4" style={{ background: TILE_BG, border: `1px dashed ${BORDER}`, borderRadius: 14 }}>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="col-span-2">
                        <Label className="text-xs" style={{ color: T3 }}>{t('vipHost.itemLabel')}</Label>
                        <Input 
                          placeholder="Nom" 
                          value={customItem.name}
                          onChange={(e) => setCustomItem(prev => ({ ...prev, name: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label className="text-xs" style={{ color: T3 }}>{t('vipHost.priceLabel')}</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={customItem.price}
                          onChange={(e) => setCustomItem(prev => ({ ...prev, price: e.target.value }))}
                        />
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleCustomAddToCart}
                      disabled={!customItem.name || !customItem.price}
                    >
                      {t('vipHost.addToCart')}
                    </Button>
                  </div>
                )}

                {/* Cart Summary */}
                {orderCart.length > 0 && (
                  <div className="mt-4 p-4" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 14 }}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('vipHost.cart').replace('{count}', String(cartItemCount))}</h4>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" style={{ color: T3 }} onClick={clearCart}>
                        <Trash2 className="w-3 h-3 mr-1" />
                        {t('vipHost.clear')}
                      </Button>
                    </div>
                    <div className="space-y-2 mb-4">
                      {orderCart.map(ci => (
                        <div key={ci.item.id} className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm truncate" style={{ color: T1 }}>{ci.item.name}</span>
                            {ci.item.default_price > 0 && (
                              <span className="text-xs ml-1 tabular-nums" style={{ color: T3 }}>({ci.item.default_price}€)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => updateCartQuantity(ci.item.id, -1)}
                            >
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className="w-6 text-center text-sm font-medium tabular-nums" style={{ color: T1 }}>{ci.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => updateCartQuantity(ci.item.id, 1)}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                            <span className="w-14 text-right text-sm font-semibold tabular-nums" style={{ color: T1 }}>
                              {(ci.item.default_price * ci.quantity).toFixed(0)}€
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                      <span style={{ color: T1, fontWeight: 600 }}>Total</span>
                      <span className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{cartTotal.toFixed(0)}€</span>
                    </div>
                    <Button
                      className="w-full mt-3 h-11 font-semibold"
                      onClick={sendOrder}
                      disabled={sendingOrder}
                    >
                      {sendingOrder ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      {t('vipHost.sendOrder')}
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Orders Tab - Preparation & Delivery tracking */}
              <TabsContent value="orders" className="mt-4">
                {venueId ? (
                  <VipTableOrders reservationId={reservation.id} venueId={venueId} />
                ) : (
                  <div className="text-center py-8 text-sm" style={{ color: T3 }}>
                    {t('vipHost.missingConfig')}
                  </div>
                )}
              </TabsContent>

              {/* History Tab - Timeline view */}
              <TabsContent value="history" className="mt-4">
                {consumptions.length === 0 ? (
                  <div className="text-center py-8" style={{ color: T3 }}>
                    <Package className="w-10 h-10 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.14)' }} />
                    <p className="text-sm">{t('vipHost.noConsumptions')}</p>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute left-[22px] top-2 bottom-2 w-px" style={{ background: BORDER }} />
                    <div className="space-y-3">
                      {consumptions.map((c, index) => (
                        <div key={c.id} className="flex gap-3 relative">
                          <div
                            className="w-[10px] h-[10px] rounded-full mt-1.5 z-10"
                            style={{ marginLeft: '18px', background: index === 0 ? RED : 'rgba(255,255,255,0.2)' }}
                          />
                          <div className="flex-1 p-3" style={tile}>
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="text-sm" style={{ color: T1, fontWeight: 500 }}>
                                  {c.quantity > 1 && `${c.quantity}x `}{c.itemName}
                                </div>
                                <div className="text-xs mt-0.5 flex items-center" style={{ color: T3 }}>
                                  <span className="tabular-nums">{format(new Date(c.servedAt), 'HH:mm', { locale })}</span>
                                  {c.itemType && (
                                    <span className="ml-2 text-[10px] px-1.5 rounded-full" style={{ border: `1px solid ${BORDER}`, color: T3 }}>
                                      {c.itemType}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm tabular-nums" style={{ color: T1, fontWeight: 600 }}>{c.totalPrice.toFixed(0)}€</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Stats Tab */}
              <TabsContent value="stats" className="mt-4">
                <div className="space-y-4">
                  {(reservation.minimumSpend || 0) > 0 && (
                    <div className="p-4" style={tile}>
                      <MinimumSpendBar
                        minimumSpend={reservation.minimumSpend || 0}
                        totalConsumed={totalConsumed}
                        deposit={reservation.totalPrice}
                      />
                    </div>
                  )}

                  <div className="p-4" style={tile}>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm" style={{ color: T3 }}>{t('vipHost.totalConsumed')}</div>
                        <div className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>{totalConsumed.toFixed(0)}€</div>
                      </div>
                      <div>
                        <div className="text-sm" style={{ color: T3 }}>{t('vipHost.totalBudget')}</div>
                        <div className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>{reservation.totalPrice}€</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${Math.min(100, (totalConsumed / reservation.totalPrice) * 100)}%`, background: POS }}
                        />
                      </div>
                      <div className="flex justify-between text-xs mt-1" style={{ color: T3 }}>
                        <span>{t('vipHost.percentConsumed').replace('{pct}', ((totalConsumed / reservation.totalPrice) * 100).toFixed(0))}</span>
                        <span style={{ color: POS }}>
                          {totalConsumed > reservation.totalPrice
                            ? t('vipHost.beyondBudget').replace('{amount}', (totalConsumed - reservation.totalPrice).toFixed(0))
                            : t('vipHost.remainingBudget').replace('{amount}', remainingCredit.toFixed(0))
                          }
                        </span>
                      </div>
                    </div>
                  </div>

                  {stats && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 text-center" style={tile}>
                          <div className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{stats.totalItems}</div>
                          <div className="text-xs" style={{ color: T3 }}>{t('vipHost.itemsServed')}</div>
                        </div>
                        {stats.avgTimeBetween && (
                          <div className="p-3 text-center" style={tile}>
                            <div className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em' }}>{stats.avgTimeBetween}min</div>
                            <div className="text-xs" style={{ color: T3 }}>{t('vipHost.betweenOrders')}</div>
                          </div>
                        )}
                      </div>

                      {Object.keys(stats.byType).length > 0 && (
                        <div className="p-4" style={tile}>
                          <div className="text-sm mb-3" style={{ color: T3 }}>{t('vipHost.byCategory')}</div>
                          <div className="space-y-2">
                            {Object.entries(stats.byType).map(([type, amount]) => (
                              <div key={type} className="flex items-center justify-between">
                                <span className="text-sm capitalize" style={{ color: T1 }}>{type}</span>
                                <span className="tabular-nums" style={{ color: T1, fontWeight: 500 }}>{(amount as number).toFixed(0)}€</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>

        {/* Fixed footer — actions only for seated guests (placed/active) */}
        {['placed', 'active'].includes(reservation.vipStatus) && (
          <div className="absolute bottom-0 left-0 right-0 p-4 backdrop-blur" style={{ background: 'rgba(10,10,12,0.92)', borderTop: `1px solid ${BORDER}`, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex gap-2">
              {canReassign && onReassign && (
                <Button
                  className="flex-1 h-12"
                  variant="outline"
                  onClick={() => onReassign(reservation)}
                  disabled={loading || actionsDisabled}
                >
                  <MapPin className="w-5 h-5 mr-2" />
                  {t('vipHost.reassignTable')}
                </Button>
              )}
              <Button
                className="flex-1 h-12"
                variant="secondary"
                onClick={handleMarkFinished}
                disabled={loading || actionsDisabled}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    {t('vipHost.markFinished')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
