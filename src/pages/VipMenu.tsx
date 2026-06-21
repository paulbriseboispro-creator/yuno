import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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
  Lock,
  Check,
  ArrowLeft,
  User,
  AlertTriangle,
  Search,
  X,
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
  needs_mixer: boolean;
  max_mixers: number;
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

// Mixer/soft categories — shown only inside the mixer selection step, not the main list.
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
  const [searchQuery, setSearchQuery] = useState('');
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

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      // A search looks across the whole menu, ignoring the active category.
      items = items.filter(i => {
        const catLabel = (CATEGORY_LABELS[i.category]?.label || '').toLowerCase();
        return (
          i.name.toLowerCase().includes(q) ||
          (i.brand?.toLowerCase().includes(q) ?? false) ||
          (i.description?.toLowerCase().includes(q) ?? false) ||
          i.category.toLowerCase().includes(q) ||
          catLabel.includes(q)
        );
      });
    } else if (activeCategory !== 'all') {
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
  }, [displayableItems, activeCategory, includedBudget, searchQuery]);

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

    // Bottles flagged by the owner require the customer to pick a mixer first.
    if (!skipMixerSuggestion && item.needs_mixer && mixerItems.length > 0) {
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

  const handleMixerConfirm = (selected: { id: string; name: string }[]) => {
    const spirit = pendingSpirit;
    if (spirit) {
      setCart(prev => {
        const map = new Map(prev.map(c => [c.menuItem.id, { ...c }]));
        const bump = (mi: VipMenuItem) => {
          const existing = map.get(mi.id);
          if (existing) existing.quantity += 1;
          else map.set(mi.id, { menuItem: mi, quantity: 1 });
        };
        bump(spirit);
        selected.forEach(s => {
          const mixerMenuItem = menuItems.find(m => m.id === s.id);
          if (mixerMenuItem) bump(mixerMenuItem);
        });
        return Array.from(map.values());
      });

      const mixerNames = selected.map(s => s.name).join(' + ');
      toast.success(`${spirit.name}${mixerNames ? ` + ${mixerNames}` : ''} ${t('vipBudget.added')}`);
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#E8192C' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>
      {/* Header — editorial glassmorphe */}
      <header
        className="sticky top-0 z-40"
        style={{
          background: 'rgba(10,10,10,0.90)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ maxWidth: 768, margin: '0 auto' }}>
          <button
            onClick={() => navigate('/')}
            className="shrink-0 flex items-center justify-center transition-transform active:scale-95"
            style={{ width: 36, height: 36, borderRadius: 2, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <h1 className="flex-1 min-w-0 truncate font-display font-bold text-white uppercase" style={{ fontSize: 19, letterSpacing: '-0.02em' }}>
            {t('vipMenu.title')}
          </h1>
          {reservation && (
            <div
              className="flex items-center gap-1.5 shrink-0 font-mono uppercase"
              style={{ fontSize: 10, color: '#9A9A9A', letterSpacing: '0.06em', padding: '6px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <User className="h-3 w-3" />
              <span className="truncate" style={{ maxWidth: 110 }}>{reservation.full_name}</span>
            </div>
          )}
        </div>
      </header>

      {/* Content — reading column */}
      <main className="px-4 py-5 space-y-6" style={{ maxWidth: 768, margin: '0 auto' }}>
        {/* Login prompt */}
        {!authLoading && !user && (
          <div className="yuno-card flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 40, borderRadius: 4, background: 'rgba(232,25,44,0.10)' }}>
                <Lock className="h-5 w-5" style={{ color: '#E8192C' }} />
              </div>
              <div className="min-w-0">
                <p className="font-display font-bold text-white uppercase truncate" style={{ fontSize: 14, letterSpacing: '-0.005em' }}>
                  {t('vipBudget.connectToOrder')}
                </p>
                <p className="font-sans truncate" style={{ fontSize: 13, color: '#9A9A9A', marginTop: 2 }}>
                  {t('vipBudget.menuVisibleAfterLogin')}
                </p>
              </div>
            </div>
            <button onClick={goToLogin} className="btn btn--primary shrink-0" style={{ height: 40 }}>
              {t('auth.login')}
            </button>
          </div>
        )}

        {/* No reservation warning */}
        {!authLoading && user && noReservation && (
          <div className="yuno-card flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#F0A92C' }} />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-white uppercase" style={{ fontSize: 14, letterSpacing: '-0.005em' }}>
                {t('vipBudget.noActiveReservation')}
              </p>
              <p className="font-sans" style={{ fontSize: 13, color: '#9A9A9A', marginTop: 4, lineHeight: 1.5 }}>
                {t('vipBudget.waitForAssignment')}
              </p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => navigate('/my-orders')} className="btn btn--primary" style={{ height: 40 }}>
                  {t('vipBudget.viewMyOrders')}
                </button>
                <button onClick={() => navigate('/')} className="btn btn--ghost" style={{ height: 40 }}>
                  {t('common.backToHome')}
                </button>
              </div>
            </div>
          </div>
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

        {/* Bottles */}
        <section>
          <p className="section-label-ruled mb-4">{t('vipMenu.bottles')}</p>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#5A5A5E' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('vipMenu.searchPlaceholder')}
              className="w-full font-sans text-white outline-none"
              style={{
                height: 42,
                paddingLeft: 38,
                paddingRight: searchQuery ? 38 : 14,
                background: '#1F1F22',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
                fontSize: 14,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label={t('vipMenu.clearSearch')}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center transition-transform active:scale-90"
                style={{ width: 26, height: 26, borderRadius: 999, background: 'rgba(255,255,255,0.06)' }}
              >
                <X className="h-3.5 w-3.5" style={{ color: '#9A9A9A' }} />
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setActiveCategory('all')}
              className="shrink-0 font-mono font-medium uppercase whitespace-nowrap transition-colors"
              style={{
                fontSize: 11, letterSpacing: '0.04em', padding: '6px 13px', borderRadius: 10,
                background: activeCategory === 'all' ? '#E8192C' : 'rgba(255,255,255,0.05)',
                color: activeCategory === 'all' ? '#fff' : '#E5E5E5',
                border: `1px solid ${activeCategory === 'all' ? '#E8192C' : 'rgba(255,255,255,0.10)'}`,
              }}
            >
              {t('vipMenu.allItems')} ({displayableItems.length})
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, { label, icon }]) => {
              const count = categoryCounts[key] || 0;
              if (count === 0) return null;
              const active = activeCategory === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveCategory(key)}
                  className="shrink-0 font-mono font-medium uppercase whitespace-nowrap transition-colors"
                  style={{
                    fontSize: 11, letterSpacing: '0.04em', padding: '6px 13px', borderRadius: 10,
                    background: active ? '#E8192C' : 'rgba(255,255,255,0.05)',
                    color: active ? '#fff' : '#E5E5E5',
                    border: `1px solid ${active ? '#E8192C' : 'rgba(255,255,255,0.10)'}`,
                  }}
                >
                  {icon} {label} ({count})
                </button>
              );
            })}
          </div>
        </section>

        {/* Menu Items */}
        <section className="space-y-3">
          {sortedAndFilteredItems.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-mono uppercase" style={{ fontSize: 11, color: '#5A5A5E', letterSpacing: '0.10em' }}>
                {searchQuery ? t('vipMenu.noSearchResults') : t('vipMenu.noItems')}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="btn btn--ghost mt-4"
                  style={{ height: 38 }}
                >
                  {t('vipMenu.clearSearch')}
                </button>
              )}
            </div>
          ) : (
            sortedAndFilteredItems.map(item => (
              <MenuItemCard
                key={item.id}
                item={item}
                budget={availableBudget}
                cartTotal={cartTotal}
                onAdd={() => addToCart(item)}
                t={t}
              />
            ))
          )}
        </section>
      </main>

      {/* Cart FAB */}
      {canOrder && cart.length > 0 && (
        <div className="fixed-bottom-bar z-50 px-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <div style={{ maxWidth: 768, margin: '0 auto' }}>
            <button onClick={() => setShowCart(true)} className="btn btn--primary w-full" style={{ height: 54 }}>
              <ShoppingCart className="h-5 w-5" />
              <span className="font-mono font-bold uppercase" style={{ fontSize: 12, letterSpacing: '0.08em' }}>
                {t('vipMenu.viewCart')} ({cartItemCount})
              </span>
              <span className="ml-auto font-mono font-bold" style={{ fontSize: 13, letterSpacing: '0.02em' }}>
                {extraAmount > 0 ? `+${extraAmount}€` : t('vipBudget.covered')}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Cart Sheet */}
      <Sheet open={showCart} onOpenChange={setShowCart}>
        <SheetContent
          side="bottom"
          className="h-[82vh] border-0 p-0"
          style={{ background: '#0A0A0A', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="px-4 pt-6 pb-3" style={{ maxWidth: 768, margin: '0 auto' }}>
            <SheetTitle className="sr-only">{t('vipMenu.myOrder')}</SheetTitle>
            <p className="section-label-ruled">{t('vipMenu.myOrder')}</p>
          </div>

          <ScrollArea className="h-[calc(100%-205px)]">
            <div className="px-4 space-y-2.5" style={{ maxWidth: 768, margin: '0 auto' }}>
              {cart.map(item => (
                <div key={item.menuItem.id} className="yuno-card flex items-center gap-3 p-2.5">
                  {item.menuItem.image_url && (
                    <div className="relative w-16 h-16 shrink-0 overflow-hidden bg-gradient-to-b from-white/[0.06] to-black/40 ring-1 ring-white/5" style={{ borderRadius: 4 }}>
                      <img
                        src={item.menuItem.image_url}
                        alt={item.menuItem.name}
                        className="w-full h-full object-contain p-1 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-display font-bold text-white uppercase truncate" style={{ fontSize: 14, letterSpacing: '-0.005em' }}>
                      {item.menuItem.name}
                    </h4>
                    <p className="font-mono mt-0.5" style={{ fontSize: 12, color: '#E8192C', letterSpacing: '0.02em' }}>
                      {(item.menuItem.price * item.quantity).toFixed(0)}€
                      {item.quantity > 1 && <span style={{ color: '#5A5A5E', marginLeft: 6 }}>({item.menuItem.price}€ × {item.quantity})</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => updateCartQuantity(item.menuItem.id, -1)}
                      className="flex items-center justify-center transition-transform active:scale-90"
                      style={{ width: 30, height: 30, borderRadius: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                    >
                      <Minus className="h-3.5 w-3.5 text-white" />
                    </button>
                    <span className="font-mono font-bold text-white text-center" style={{ width: 22, fontSize: 13 }}>{item.quantity}</span>
                    <button
                      onClick={() => updateCartQuantity(item.menuItem.id, 1)}
                      className="flex items-center justify-center transition-transform active:scale-90"
                      style={{ width: 30, height: 30, borderRadius: 3, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)' }}
                    >
                      <Plus className="h-3.5 w-3.5" style={{ color: '#E8192C' }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Cart Footer */}
          <div
            className="absolute bottom-0 left-0 right-0 px-4 pt-4"
            style={{ background: '#0A0A0A', borderTop: '1px solid rgba(255,255,255,0.08)', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            <div style={{ maxWidth: 768, margin: '0 auto' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono uppercase" style={{ fontSize: 10, color: '#9A9A9A', letterSpacing: '0.08em' }}>{t('vipBudget.cart')}</span>
                <span className="font-mono font-bold text-white" style={{ fontSize: 13 }}>{cartTotal}€</span>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono uppercase" style={{ fontSize: 10, color: '#9A9A9A', letterSpacing: '0.08em' }}>{t('vipBudget.extraAmount')}</span>
                <span className="font-display font-bold" style={{ fontSize: 24, color: extraAmount > 0 ? '#E8192C' : '#E5E5E5', letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {extraAmount > 0 ? `+${extraAmount}€` : t('vipBudget.covered')}
                </span>
              </div>
              <button onClick={handleSubmitOrder} disabled={submitting} className="btn btn--primary w-full" style={{ height: 50 }}>
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    <span className="font-mono font-bold uppercase" style={{ fontSize: 12, letterSpacing: '0.08em' }}>{t('vipMenu.sendOrder')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mixer Suggestion Dialog */}
      <MixerSuggestionDialog
        open={mixerDialogOpen}
        onOpenChange={(o) => { setMixerDialogOpen(o); if (!o) setPendingSpirit(null); }}
        spiritName={pendingSpirit?.name || ''}
        mixers={mixerItems}
        maxMixers={pendingSpirit?.max_mixers || 1}
        onConfirm={handleMixerConfirm}
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
    <article onClick={onAdd} className="event-card group flex gap-4 p-3">
      {item.image_url ? (
        <div className="relative w-24 h-32 shrink-0 overflow-hidden bg-gradient-to-b from-white/[0.06] to-black/40 ring-1 ring-white/5" style={{ borderRadius: 4 }}>
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105 drop-shadow-[0_6px_14px_rgba(0,0,0,0.55)]"
          />
        </div>
      ) : (
        <div className="w-24 h-32 shrink-0 flex items-center justify-center bg-gradient-to-b from-white/[0.06] to-black/40 ring-1 ring-white/5" style={{ borderRadius: 4 }}>
          <span className="text-3xl">{categoryInfo.icon}</span>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        {item.brand && (
          <p className="font-mono uppercase truncate" style={{ fontSize: 10, color: '#9A9A9A', letterSpacing: '0.06em' }}>{item.brand}</p>
        )}
        <h3 className="font-display font-bold text-white uppercase leading-tight" style={{ fontSize: 'clamp(15px, 2.5vw, 18px)', letterSpacing: '-0.01em', marginTop: item.brand ? 2 : 0 }}>
          {item.name}
        </h3>
        {item.volume_cl && (
          <p className="font-mono uppercase" style={{ fontSize: 10.5, color: '#5A5A5E', letterSpacing: '0.08em', marginTop: 3 }}>{item.volume_cl} CL</p>
        )}
        {item.description && (
          <p className="font-sans line-clamp-2" style={{ fontSize: 12.5, color: '#9A9A9A', lineHeight: 1.4, marginTop: 6 }}>
            {item.description}
          </p>
        )}
        <div className="mt-auto pt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display font-bold leading-none" style={{ fontSize: 22, color: '#E8192C', letterSpacing: '-0.02em' }}>{item.price}€</p>
            {budget > 0 && wouldExceed && extraForThisItem > 0 && (
              <p className="font-mono uppercase" style={{ fontSize: 9.5, color: '#F0A92C', letterSpacing: '0.08em', marginTop: 4 }}>
                +{Math.round(extraForThisItem)}€ {t('vipBudget.extra')}
              </p>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className="shrink-0 font-mono font-bold uppercase inline-flex items-center gap-1 transition-transform active:scale-95"
            style={{ height: 36, padding: '0 16px', background: '#E8192C', color: '#fff', borderRadius: 3, fontSize: 10.5, letterSpacing: '0.10em' }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('vipBudget.add')}
          </button>
        </div>
      </div>
    </article>
  );
}
