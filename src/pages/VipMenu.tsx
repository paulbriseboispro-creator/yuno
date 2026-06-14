import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { CreditBudgetBar } from '@/components/vip/CreditBudgetBar';
import { VipOrderTracking } from '@/components/vip/VipOrderTracking';
import { MixerSuggestionDialog } from '@/components/vip/MixerSuggestionDialog';
import {
  ShoppingCart,
  Plus,
  Minus,
  Loader2,
  Crown,
  Lock,
  Check,
  ArrowLeft,
  User,
  AlertTriangle,
} from 'lucide-react';

interface VipMenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  brand: string | null;
  volume_cl: number | null;
  price: number;
  image_url: string | null;
  is_active: boolean;
}

interface TableReservation {
  id: string;
  full_name: string;
  zone_id: string;
  pack_id: string | null;
  deposit: number;
  total_price: number;
  management_fee: number;
  service_fee: number;
  vip_status: string;
  zone_name: string;
  zone_color: string;
  pack_name: string | null;
  table_name: string | null;
}

interface CartItem {
  menuItem: VipMenuItem;
  quantity: number;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  champagne: { label: 'Champagne', icon: '🍾' },
  vodka: { label: 'Vodka', icon: '🍸' },
  whisky: { label: 'Whisky', icon: '🥃' },
  gin: { label: 'Gin', icon: '🍹' },
  rum: { label: 'Rhum', icon: '🍹' },
  tequila: { label: 'Tequila', icon: '🥃' },
  wine: { label: 'Vin', icon: '🍷' },
  cognac: { label: 'Cognac', icon: '🥃' },
  soft: { label: 'Softs', icon: '🥤' },
  mixer: { label: 'Mixers', icon: '🧊' },
  extra: { label: 'Extras', icon: '✨' },
  other: { label: 'Autres', icon: '📦' },
};

// Categories that should trigger mixer suggestion
const SPIRIT_CATEGORIES = ['vodka', 'whisky', 'gin', 'rum', 'tequila', 'cognac'];
const MIXER_CATEGORIES = ['soft', 'mixer'];

export default function VipMenu() {
  const { venueId } = useParams<{ venueId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [menuLoading, setMenuLoading] = useState(true);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [reservation, setReservation] = useState<TableReservation | null>(null);
  const [menuItems, setMenuItems] = useState<VipMenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [noReservation, setNoReservation] = useState(false);
  
  // Mixer suggestion dialog state
  const [mixerDialogOpen, setMixerDialogOpen] = useState(false);
  const [pendingSpirit, setPendingSpirit] = useState<VipMenuItem | null>(null);

  const goToLogin = useCallback(() => {
    const redirect = venueId ? `/vip-menu/${venueId}` : '/vip-menu';
    navigate(`/auth?redirect=${encodeURIComponent(redirect)}`);
  }, [navigate, venueId]);

  const canOrder = !!user && !!reservation && !noReservation;

  // Track existing consumptions for budget calculations
  const [existingConsumptions, setExistingConsumptions] = useState(0);

  // Budget calculations
  const includedBudget = reservation ? (reservation.total_price || 0) : 0;
  
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  }, [cart]);

  // Remaining budget = total_price - already consumed - current cart
  const availableBudget = Math.max(0, includedBudget - existingConsumptions);

  const extraAmount = useMemo(() => {
    return Math.max(0, cartTotal - availableBudget);
  }, [cartTotal, availableBudget]);

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Get mixers for suggestion dialog
  const mixerItems = useMemo(() => {
    return menuItems
      .filter(item => MIXER_CATEGORIES.includes(item.category))
      .map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        image_url: item.image_url,
      }));
  }, [menuItems]);

  // Sort items by relevance to budget
  // Items visible in the main menu (exclude softs/mixers — they're only in the mixer dialog)
  const displayableItems = useMemo(() => {
    return menuItems.filter(item => !MIXER_CATEGORIES.includes(item.category));
  }, [menuItems]);

  const sortedAndFilteredItems = useMemo(() => {
    const budget = includedBudget;
    const optimalMin = budget * 0.5;
    const optimalMax = budget;

    let items = [...displayableItems];

    // Filter by category
    if (activeCategory !== 'all') {
      items = items.filter(i => i.category === activeCategory);
    }

    // Sort by relevance
    return items.sort((a, b) => {
      const priceA = a.price;
      const priceB = b.price;

      const isOptimalA = priceA >= optimalMin && priceA <= optimalMax;
      const isOptimalB = priceB >= optimalMin && priceB <= optimalMax;

      // Optimal range first
      if (isOptimalA && !isOptimalB) return -1;
      if (!isOptimalA && isOptimalB) return 1;

      // Within same category, sort by price ascending
      return priceA - priceB;
    });
  }, [displayableItems, activeCategory, includedBudget]);

  // Category counts for filters
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    displayableItems.forEach(item => {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    return counts;
  }, [displayableItems]);

  useEffect(() => {
    if (!venueId) {
      setMenuLoading(false);
      return;
    }

    const fetchMenu = async () => {
      setMenuLoading(true);
      try {
        const { data, error } = await supabase
          .from('vip_menu_items')
          .select('*')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .order('category')
          .order('position');

        if (error) throw error;
        setMenuItems(data || []);
      } catch (e) {
        console.error('Error fetching VIP menu items:', e);
        toast.error(t('vipMenu.loadError'));
        setMenuItems([]);
      } finally {
        setMenuLoading(false);
      }
    };

    fetchMenu();
  }, [venueId]);

  useEffect(() => {
    if (!venueId) return;
    if (authLoading) return;

    if (!user) {
      setReservation(null);
      setNoReservation(false);
      return;
    }

    fetchReservation();
  }, [user, authLoading, venueId]);

  // Fetch existing consumptions and subscribe to real-time updates
  const fetchConsumptions = useCallback(async () => {
    if (!reservation) return;
    const { data } = await supabase
      .from('vip_consumptions')
      .select('total_price')
      .eq('table_reservation_id', reservation.id);
    
    const total = (data || []).reduce((sum, c) => sum + (c.total_price || 0), 0);
    setExistingConsumptions(total);
  }, [reservation?.id]);

  useEffect(() => {
    if (!reservation) {
      setExistingConsumptions(0);
      return;
    }

    fetchConsumptions();

    // Subscribe to real-time consumption changes
    const channel = supabase
      .channel(`vip_consumptions_client_${reservation.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vip_consumptions',
          filter: `table_reservation_id=eq.${reservation.id}`,
        },
        () => fetchConsumptions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reservation?.id, fetchConsumptions]);

  const fetchReservation = async () => {
    if (!venueId || !user) return;
    setReservationLoading(true);
    setNoReservation(false);

    try {
      const { data: venueZones } = await supabase
        .from('table_zones')
        .select('id')
        .eq('venue_id', venueId);

      if (!venueZones || venueZones.length === 0) {
        setNoReservation(true);
        return;
      }

      const zoneIds = venueZones.map(z => z.id);

      const { data: resData, error: resError } = await supabase
        .from('table_reservations')
        .select('id, full_name, zone_id, pack_id, deposit, total_price, vip_status, assigned_table_id, management_fee, service_fee')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .in('zone_id', zoneIds)
        .in('vip_status', ['waiting', 'placed', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (resError) {
        console.error('Error fetching reservation:', resError);
        toast.error(t('vipMenu.loadError'));
        setNoReservation(true);
        return;
      }

      if (!resData) {
        setNoReservation(true);
        return;
      }

      const { data: zoneData } = await supabase
        .from('table_zones')
        .select('name, color')
        .eq('id', resData.zone_id)
        .single();

      let packData = null;
      if (resData.pack_id) {
        const { data } = await supabase
          .from('table_packs')
          .select('name')
          .eq('id', resData.pack_id)
          .single();
        packData = data;
      }

      setReservation({
        id: resData.id,
        full_name: resData.full_name || 'Client VIP',
        zone_id: resData.zone_id,
        pack_id: resData.pack_id,
        deposit: resData.deposit,
        total_price: resData.total_price || resData.deposit,
        management_fee: resData.management_fee || 0,
        service_fee: resData.service_fee || 0,
        vip_status: resData.vip_status,
        zone_name: zoneData?.name || 'Zone VIP',
        zone_color: zoneData?.color || 'hsl(var(--primary))',
        pack_name: packData?.name || null,
        table_name: resData.assigned_table_id ? t('vipMenu.tableAssigned') : null,
      });
    } catch (error) {
      console.error('Error fetching VIP menu:', error);
      toast.error(t('vipMenu.loadError'));
      setNoReservation(true);
    } finally {
      setReservationLoading(false);
    }
  };

  const addToCart = (item: VipMenuItem, skipMixerSuggestion = false) => {
    if (!user) {
      toast.info(t('vipBudget.connectToOrder'));
      goToLogin();
      return;
    }
    if (!reservation || noReservation) {
      toast.info(t('vipBudget.noActiveReservation'));
      return;
    }

    // Check if it's a spirit and we should suggest mixers
    if (!skipMixerSuggestion && SPIRIT_CATEGORIES.includes(item.category) && mixerItems.length > 0) {
      setPendingSpirit(item);
      setMixerDialogOpen(true);
      return;
    }

    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id);
      if (existing) {
        return prev.map(c =>
          c.menuItem.id === item.id
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [...prev, { menuItem: item, quantity: 1 }];
    });
    toast.success(`${item.name} ${t('vipBudget.added')}`);
  };

  const handleMixerSelection = (mixer: { id: string; name: string; price: number }) => {
    if (pendingSpirit) {
      // Add the spirit
      setCart(prev => {
        const existing = prev.find(c => c.menuItem.id === pendingSpirit.id);
        if (existing) {
          return prev.map(c =>
            c.menuItem.id === pendingSpirit.id
              ? { ...c, quantity: c.quantity + 1 }
              : c
          );
        }
        return [...prev, { menuItem: pendingSpirit, quantity: 1 }];
      });

      // Add the mixer
      const mixerMenuItem = menuItems.find(m => m.id === mixer.id);
      if (mixerMenuItem) {
        setCart(prev => {
          const existing = prev.find(c => c.menuItem.id === mixer.id);
          if (existing) {
            return prev.map(c =>
              c.menuItem.id === mixer.id
                ? { ...c, quantity: c.quantity + 1 }
                : c
            );
          }
          return [...prev, { menuItem: mixerMenuItem, quantity: 1 }];
        });
      }

      toast.success(`${pendingSpirit.name} + ${mixer.name} ${t('vipBudget.added')}`);
    }
    setPendingSpirit(null);
    setMixerDialogOpen(false);
  };

  const handleSkipMixer = () => {
    if (pendingSpirit) {
      addToCart(pendingSpirit, true);
    }
    setPendingSpirit(null);
    setMixerDialogOpen(false);
  };

  const updateCartQuantity = (itemId: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(c => {
          if (c.menuItem.id === itemId) {
            const newQty = c.quantity + delta;
            if (newQty <= 0) return null as any;
            return { ...c, quantity: newQty };
          }
          return c;
        })
        .filter(Boolean);
    });
  };

  const handleSubmitOrder = async () => {
    if (!reservation || !venueId || cart.length === 0) return;

    setSubmitting(true);
    try {
      const { data: order, error: orderError } = await supabase
        .from('vip_table_orders')
        .insert({
          table_reservation_id: reservation.id,
          venue_id: venueId,
          user_id: user?.id,
          status: 'pending',
          total_amount: cartTotal,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = cart.map(item => ({
        order_id: order.id,
        menu_item_id: item.menuItem.id,
        quantity: item.quantity,
        unit_price: item.menuItem.price,
        is_included: false, // With budget system, nothing is "included" in the old sense
      }));

      const { error: itemsError } = await supabase
        .from('vip_table_order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      toast.success(t('vipMenu.orderSent'));
      toast.info(t('vipMenu.orderSentDesc'));
      setCart([]);
      setShowCart(false);
    } catch (error) {
      console.error('Error submitting order:', error);
      toast.error(t('vipMenu.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (menuLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gradient-to-b from-background via-background to-background/95 backdrop-blur-xl border-b border-border/30">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold tracking-tight">{t('vipMenu.title')}</h1>
            </div>
            {reservation && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-full px-3 py-1.5">
                <User className="h-3 w-3" />
                <span className="truncate max-w-[100px] font-medium">{reservation.full_name}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-4 space-y-4">
        {/* Login prompt */}
        {!authLoading && !user && (
          <Card className="p-4 bg-surface border-0 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-muted/30 flex items-center justify-center flex-shrink-0">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate">{t('vipBudget.connectToOrder')}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {t('vipBudget.menuVisibleAfterLogin')}
                </p>
              </div>
            </div>
            <Button onClick={goToLogin} className="flex-shrink-0">
              {t('auth.login')}
            </Button>
          </Card>
        )}

        {/* No reservation warning */}
        {!authLoading && user && noReservation && (
          <Card className="p-4 bg-surface border-0 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">{t('vipBudget.noActiveReservation')}</p>
              <p className="text-sm text-muted-foreground">
                {t('vipBudget.waitForAssignment')}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => navigate('/my-orders')}>
                  {t('vipBudget.viewMyOrders')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate('/')}>
                  {t('common.backToHome')}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Credit Budget Bar - only show when reservation exists */}
        {reservation && (
          <>
            <CreditBudgetBar
              includedBudget={includedBudget}
              cartTotal={cartTotal + existingConsumptions}
              packName={reservation.pack_name}
              zoneName={reservation.zone_name}
              zoneColor={reservation.zone_color}
            />
            <VipOrderTracking reservationId={reservation.id} onOrderServed={fetchConsumptions} />
          </>
        )}

        {/* Category Filters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Crown className="h-4 w-4 text-amber-400" />
            <h2 className="font-semibold">{t('vipMenu.bottles')}</h2>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <Button
                variant={activeCategory === 'all' ? 'default' : 'outline'}
                size="sm"
                className="shrink-0"
                onClick={() => setActiveCategory('all')}
              >
                {t('vipMenu.allItems')} ({displayableItems.length})
              </Button>
              {Object.entries(CATEGORY_LABELS).map(([key, { label, icon }]) => {
                const count = categoryCounts[key] || 0;
                if (count === 0) return null;
                return (
                  <Button
                    key={key}
                    variant={activeCategory === key ? 'default' : 'outline'}
                    size="sm"
                    className="shrink-0"
                    onClick={() => setActiveCategory(key)}
                  >
                    {icon} {label} ({count})
                  </Button>
                );
              })}
          </div>
        </section>

        {/* Menu Items */}
        <section className="space-y-3">
          {sortedAndFilteredItems.map(item => (
            <MenuItemCard
              key={item.id}
              item={item}
              budget={availableBudget}
              cartTotal={cartTotal}
              onAdd={() => addToCart(item)}
              t={t}
            />
          ))}
        </section>
      </main>

      {/* Cart FAB */}
      {canOrder && cart.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <Button
            className="w-full h-14 text-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            onClick={() => setShowCart(true)}
          >
            <ShoppingCart className="h-5 w-5 mr-2" />
            {t('vipMenu.viewCart')} ({cartItemCount})
            <span className="ml-auto">
              {extraAmount > 0 ? (
                <span>+{extraAmount}€ {t('vipBudget.extra')}</span>
              ) : (
                <span>{t('vipBudget.covered')}</span>
              )}
            </span>
          </Button>
        </div>
      )}

      {/* Cart Sheet */}
      <Sheet open={showCart} onOpenChange={setShowCart}>
        <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl">
          <SheetHeader className="pb-4">
            <SheetTitle>{t('vipMenu.myOrder')}</SheetTitle>
          </SheetHeader>

          <ScrollArea className="h-[calc(100%-150px)]">
            <div className="space-y-3">
              {cart.map(item => (
                <Card key={item.menuItem.id} className="p-3 bg-surface border-0">
                  <div className="flex items-center gap-3">
                    {item.menuItem.image_url && (
                      <img
                        src={item.menuItem.image_url}
                        alt={item.menuItem.name}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{item.menuItem.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {(item.menuItem.price * item.quantity).toFixed(0)}€
                        {item.quantity > 1 && <span className="text-xs ml-1">({item.menuItem.price}€ × {item.quantity})</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCartQuantity(item.menuItem.id, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center font-medium">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCartQuantity(item.menuItem.id, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>

          {/* Cart Footer */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-background">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{t('vipBudget.cart')}</span>
              <span className="font-medium">{cartTotal}€</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold">{t('vipBudget.extraAmount')}</span>
              <span className="text-xl font-bold text-amber-400">
                {extraAmount > 0 ? `+${extraAmount}€` : t('vipBudget.covered')}
              </span>
            </div>
            <Button
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
              onClick={handleSubmitOrder}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  {t('vipMenu.sendOrder')}
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mixer Suggestion Dialog */}
      <MixerSuggestionDialog
        open={mixerDialogOpen}
        onOpenChange={setMixerDialogOpen}
        spiritName={pendingSpirit?.name || ''}
        mixers={mixerItems}
        onSelectMixer={handleMixerSelection}
        onSkip={handleSkipMixer}
      />
    </div>
  );
}

// Menu Item Card Component
interface MenuItemCardProps {
  item: VipMenuItem;
  budget: number;
  cartTotal: number;
  onAdd: () => void;
  t: (key: string) => string;
}

function MenuItemCard({ item, budget, cartTotal, onAdd, t }: MenuItemCardProps) {
  const categoryInfo = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.other;

  // Calculate if this item would exceed budget
  const remainingBudget = Math.max(0, budget - cartTotal);
  const wouldExceed = item.price > remainingBudget;
  const extraForThisItem = wouldExceed ? item.price - remainingBudget : 0;

  return (
    <Card className="p-3 bg-surface border-0 transition-all duration-200 hover:bg-primary/5 hover:ring-1 hover:ring-primary/20 hover:shadow-[0_0_20px_hsla(0,85%,50%,0.08)] cursor-pointer group">
      <div className="flex gap-3">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-20 h-20 object-cover rounded-lg flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="w-20 h-20 rounded-lg bg-muted/30 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">{categoryInfo.icon}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-medium leading-tight">{item.name}</h3>
              {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
              {item.volume_cl && (
                <p className="text-xs text-muted-foreground">{item.volume_cl}cl</p>
              )}
            </div>
            <div className="text-right">
              <span className="font-bold text-primary text-lg">{item.price}€</span>
              {budget > 0 && wouldExceed && extraForThisItem > 0 && (
                <p className="text-xs text-amber-400/80">
                  +{Math.round(extraForThisItem)}€ {t('vipBudget.extra')}
                </p>
              )}
            </div>
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {item.description}
            </p>
          )}
          <Button size="sm" className="mt-2 h-8" onClick={onAdd}>
            <Plus className="h-3 w-3 mr-1" />
            {t('vipBudget.add')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
