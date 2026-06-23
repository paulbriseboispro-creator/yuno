import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft, Plus, Minus, Trash2, Calendar, ShoppingBag,
  Wine, Mail, User, Phone, LogIn, UserPlus, ChevronRight, ChevronUp,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useCartRules } from '@/hooks/useCartRules';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';

import { CartSuggestions } from '@/components/upsell/CartSuggestions';
import { CartOffersBanner } from '@/components/upsell/CartOffersBanner';
import { TermsAcceptance } from '@/components/TermsAcceptance';
import { AgeGate } from '@/components/AgeGate';

interface VenueInfo {
  id: string;
  name: string;
}

export default function Cart() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const reduceMotion = useReducedMotion();
  const cart = useStore((state) => state.cart);
  const incrementQty = useStore((state) => state.incrementQty);
  const decrementQty = useStore((state) => state.decrementQty);
  const removeFromCart = useStore((state) => state.removeFromCart);
  const getCartTotal = useStore((state) => state.getCartTotal);
  const clearCart = useStore((state) => state.clearCart);
  const selectedEventId = useStore((state) => state.selectedEventId);
  const [isProcessing, setIsProcessing] = useState(false);
  const [venueInfo, setVenueInfo] = useState<VenueInfo | null>(null);
  const [heroImage, setHeroImage] = useState<string | null>(null);
  const [availableCredits, setAvailableCredits] = useState(0);
  const [pendingCardCheckout, setPendingCardCheckout] = useState(false);
  const cleanExpiredItems = useStore((state) => state.cleanExpiredItems);
  const [acceptCgv, setAcceptCgv] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const { trackCheckout } = useVisitorTracking(venueInfo?.id);

  const [guestEmail, setGuestEmail] = useState('');
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [showGuestForm] = useState(false);
  const [showAuthChoiceDialog, setShowAuthChoiceDialog] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment_cancelled') === 'true') {
      sessionStorage.removeItem('yuno_pending_checkout');
      toast({
        title: t('cart.paymentCancelled') || 'Paiement annulé',
        description: t('cart.paymentCancelledDesc') || 'Votre paiement n\'a pas abouti. Vous pouvez réessayer.',
        variant: 'destructive',
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const cleanCart = async () => {
      const eventIds = [...new Set(cart.filter(i => i.eventId).map(i => i.eventId!))];
      if (eventIds.length === 0) return;
      const { data: events } = await supabase
        .from('events')
        .select('id, end_at')
        .in('id', eventIds);
      if (!events) return;
      const expiredIds = events
        .filter(e => new Date(e.end_at) < new Date())
        .map(e => e.id);
      if (expiredIds.length > 0) {
        const removed = cleanExpiredItems(expiredIds);
        if (removed > 0) {
          toast({ title: t('cart.expiredRemoved'), description: t('cart.expiredRemovedDesc') });
        }
      }
    };
    cleanCart();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingCardCheckout && cart.length > 0) {
      setPendingCardCheckout(false);
      handleCheckout();
    }
  }, [pendingCardCheckout, cart]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = getCartTotal();
  const totalQty = useMemo(() => cart.reduce((sum, i) => sum + i.qty, 0), [cart]);
  const creditsCanCover = Math.min(availableCredits, totalQty);

  const mostExpensiveItem = useMemo(() => {
    if (cart.length === 0) return null;
    return cart.reduce((best, item) => item.unitPrice > best.unitPrice ? item : best, cart[0]);
  }, [cart]);

  const cartItems = useMemo(() => cart.map(i => ({
    drinkId: i.drinkId,
    qty: i.qty,
    collection: i.collection,
    unitPrice: i.unitPrice,
    name: i.name,
  })), [cart]);

  const { rules, totalDiscount, discountedItems } = useCartRules(venueInfo?.id || null, cartItems);

  const discountedTotal = total - totalDiscount;
  const discountedServiceFee = Math.round(discountedTotal * 0.03 * 100) / 100;
  const totalWithFees = discountedTotal + discountedServiceFee;

  const discountByDrink = useMemo(() => {
    const map = new Map<string, { amount: number; percent: number; isFree: boolean }>();
    for (const d of discountedItems) {
      const existing = map.get(d.drinkId);
      if (existing) {
        existing.amount += d.discountAmount;
      } else {
        map.set(d.drinkId, { amount: d.discountAmount, percent: d.discountPercent, isFree: d.isFree });
      }
    }
    return map;
  }, [discountedItems]);

  useEffect(() => {
    if (venueInfo?.id) sessionStorage.setItem('yuno_cart_venue', venueInfo.id);
  }, [venueInfo?.id]);

  const goToMenu = () => {
    const storedVenue = sessionStorage.getItem('yuno_cart_venue');
    const lastContent = sessionStorage.getItem('yuno_last_content_page');
    const exclusiveClub = sessionStorage.getItem('exclusiveClub');
    if (storedVenue) navigate(`/club/${storedVenue}`);
    else if (lastContent && lastContent.startsWith('/club/')) navigate(lastContent);
    else if (exclusiveClub) navigate(`/club/${exclusiveClub}`);
    else if (lastContent && lastContent !== '/') navigate(lastContent);
    else navigate('/');
  };

  useEffect(() => {
    const fetchVenueInfo = async () => {
      if (cart.length === 0) return;
      const firstItem = cart[0];
      if (!firstItem.eventId) return;
      try {
        const { data: eventData, error: eventError } = await supabase
          .from('events').select('venue_id, partner_venue_id, poster_url').eq('id', firstItem.eventId).single();
        const hostVenueId = eventData?.venue_id || eventData?.partner_venue_id;
        if (eventError || !hostVenueId) throw eventError || new Error('No venue');
        const { data: venue, error: venueError } = await supabase
          .from('venues').select('id, name, cover_url').eq('id', hostVenueId).single();
        if (venueError) throw venueError;
        if (venue) setVenueInfo({ id: venue.id, name: venue.name });
        setHeroImage(eventData?.poster_url || venue?.cover_url || null);
      } catch (error) { console.error('Error fetching venue info:', error); }
    };
    fetchVenueInfo();
  }, [cart]);

  const fetchCredits = async () => {
    if (!user || !venueInfo?.id) { setAvailableCredits(0); return; }
    const eventId = cart[0]?.eventId;
    let query = supabase
      .from('order_pack_credits')
      .select('total_credits, used_credits')
      .eq('user_id', user.id)
      .eq('venue_id', venueInfo.id)
      .gt('expires_at', new Date().toISOString());
    if (eventId) query = query.eq('event_id', eventId);
    const { data } = await query;
    if (data) {
      const cr = data.reduce((sum, c) => sum + (c.total_credits - c.used_credits), 0);
      setAvailableCredits(cr);
    } else { setAvailableCredits(0); }
  };

  useEffect(() => { fetchCredits(); }, [user, venueInfo?.id, cart]);

  const handleCreditCheckout = async (partialOnly = false) => {
    if (!user || !venueInfo || !cart[0]?.eventId) return;
    if (!acceptCgv) { toast({ title: t('cgv.required'), variant: 'destructive' }); return; }
    if (!ageVerified) { toast({ title: t('ageGate.required'), variant: 'destructive' }); return; }
    setIsProcessing(true);
    try {
      const items = partialOnly && mostExpensiveItem
        ? [{ drinkId: mostExpensiveItem.drinkId, qty: Math.min(creditsCanCover, mostExpensiveItem.qty) }]
        : cart.map(item => ({ drinkId: item.drinkId, qty: item.qty }));
      const { data, error } = await supabase.functions.invoke('use-drink-credit', {
        body: { items, eventId: cart[0].eventId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed');

      const creditsUsed = data.creditsUsed || items.reduce((s, i) => s + i.qty, 0);
      setAvailableCredits(prev => prev - creditsUsed);

      if (partialOnly && mostExpensiveItem) {
        const creditedQty = Math.min(creditsCanCover, mostExpensiveItem.qty);
        if (creditedQty >= mostExpensiveItem.qty) {
          removeFromCart(mostExpensiveItem.drinkId);
        } else {
          for (let i = 0; i < creditedQty; i++) decrementQty(mostExpensiveItem.drinkId);
        }
        toast({ title: t('cart.success'), description: t('upsell.creditUsedSuccess') });
        setIsProcessing(false);
        setPendingCardCheckout(true);
        return;
      }

      clearCart();
      navigate(`/order-confirmation?type=order&id=${data.orderId}`);
      toast({ title: t('cart.success'), description: t('upsell.creditUsedSuccess') });
    } catch (err: any) {
      console.error('Credit checkout error:', err);
      toast({ title: t('cart.error'), description: err.message, variant: 'destructive' });
    } finally { setIsProcessing(false); }
  };

  const handleCheckout = async () => {
    if (!user && !showGuestForm) {
      setShowAuthChoiceDialog(true);
      return;
    }
    if (!user && showGuestForm) {
      if (!guestEmail.trim() || !guestFirstName.trim() || !guestLastName.trim()) {
        toast({ title: t('guest.fillRequired') || 'Veuillez remplir tous les champs obligatoires', variant: 'destructive' });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(guestEmail.trim())) {
        toast({ title: t('guest.invalidEmail') || 'Email invalide', variant: 'destructive' });
        return;
      }
    }
    if (!acceptCgv) { toast({ title: t('cgv.required'), variant: 'destructive' }); return; }
    if (!ageVerified) { toast({ title: t('ageGate.required'), variant: 'destructive' }); return; }
    trackCheckout();

    const hasNoEvent = cart.some(item => !item.eventId);
    if (hasNoEvent) {
      toast({ title: t('cart.eventMissing'), description: t('cart.eventMissingDesc'), variant: 'destructive' });
      return;
    }

    const cartHash = JSON.stringify(cart.map(i => `${i.drinkId}:${i.qty}`).sort());
    const pendingSessionKey = 'yuno_pending_checkout';
    const existingSession = sessionStorage.getItem(pendingSessionKey);
    if (existingSession) {
      try {
        const parsed = JSON.parse(existingSession);
        if (parsed.hash === cartHash && Date.now() - parsed.ts < 5 * 60 * 1000) {
          toast({ title: t('cart.checkoutInProgress') || 'Paiement en cours', description: t('cart.checkoutInProgressDesc') || 'Un paiement est déjà en cours pour ce panier.', variant: 'destructive' });
          return;
        }
      } catch { /* ignore corrupt data */ }
    }

    setIsProcessing(true);
    try {
      const eventId = selectedEventId || cart[0]?.eventId;
      const { getTrackedLinkForCheckout } = await import('@/hooks/usePurchaseSourceTracking');
      const trackedLinkId = getTrackedLinkForCheckout(eventId);
      const cartItemsPayload = cart.map(item => ({ id: item.drinkId, quantity: item.qty, collection: item.collection }));
      const body: any = { items: cartItemsPayload, eventId, venueId: venueInfo?.id, cancelUrl: '/cart', trackedLinkId };

      if (!user) {
        body.guestEmail = guestEmail.trim();
        body.guestFullName = `${guestFirstName.trim()} ${guestLastName.trim()}`;
        body.guestPhone = guestPhone.trim() || undefined;
      }

      const { data, error } = await invokeEdgeFunction('create-checkout', { body });
      if (error) throw error;

      if (data?.code === 'ACCOUNT_EXISTS') {
        toast({ title: t('guest.accountExists') || 'Compte existant', description: t('guest.accountExistsDesc') || 'Un compte existe déjà avec cet email. Connectez-vous pour continuer.', variant: 'destructive' });
        navigate('/auth?redirect=/cart');
        return;
      }

      if (data?.code === 'PAYMENTS_DISABLED') {
        toast({ title: t('payments.disabledBanner'), variant: 'destructive' });
        setIsProcessing(false);
        return;
      }

      if (!data?.success) throw new Error(data?.error || 'Failed to create checkout');

      if (data.testMode && data.redirectUrl) {
        sessionStorage.removeItem(pendingSessionKey);
        clearCart();
        navigate(data.redirectUrl);
        toast({ title: t('cart.success'), description: t('cart.successDesc') });
        return;
      }

      if (data.url) {
        sessionStorage.setItem(pendingSessionKey, JSON.stringify({ hash: cartHash, ts: Date.now() }));
        window.location.href = data.url;
        return;
      }

      throw new Error('No checkout URL returned');
    } catch (error: any) {
      console.error('Checkout error:', error);
      sessionStorage.removeItem(pendingSessionKey);
      toast({ title: t('cart.error'), description: error.message || t('cart.errorDesc'), variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  // ─── Empty State ────────────────────────────────────────────
  if (cart.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6" style={{ background: '#0A0A0A' }}>
        <motion.div
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center text-center"
        >
          {/* Editorial kicker with red rule */}
          <div className="yuno-rule mb-7">{t('cart.title')}</div>

          {/* Icon — tranchant square */}
          <div
            className="mb-7 flex h-20 w-20 items-center justify-center"
            style={{
              background: 'var(--yuno-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Wine className="h-9 w-9" style={{ color: 'var(--yuno-gray-3)' }} />
          </div>

          <h2
            className="font-display uppercase text-white mb-3"
            style={{ fontSize: 'clamp(30px, 8vw, 44px)', letterSpacing: '-0.03em', lineHeight: 0.92 }}
          >
            {t('cart.empty')}
          </h2>
          <p className="font-sans text-sm mb-9 max-w-[260px]" style={{ color: 'var(--yuno-gray-2)', lineHeight: 1.5 }}>
            {t('cart.emptyDesc')}
          </p>
          <button onClick={goToMenu} className="btn btn--primary">
            <ArrowLeft className="h-4 w-4" />
            {t('cart.backToMenu')}
          </button>
        </motion.div>
      </div>
    );
  }

  // ─── Grouped cart by event ───────────────────────────────────
  const groupedCart = cart.reduce((acc, item) => {
    const key = item.eventId || 'no-event';
    if (!acc[key]) acc[key] = { eventTitle: item.eventTitle || t('cart.noEvent'), items: [] };
    acc[key].items.push(item);
    return acc;
  }, {} as Record<string, { eventTitle: string; items: typeof cart }>);

  const creditsCoverAll = availableCredits >= totalQty;
  const heroTitle = cart[0]?.eventTitle || venueInfo?.name || t('cart.title');

  return (
    <div className="min-h-screen overflow-y-auto" style={{ background: '#0A0A0A' }}>

      {/* ── Cinematic hero ─────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{
          height: 'calc(13.5rem + env(safe-area-inset-top, 0px))',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {/* Background image (or editorial gradient fallback) */}
        {heroImage ? (
          <img
            src={getOptimizedImageUrl(heroImage, { width: 900, quality: 65 })}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: 'scale(1.05)' }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0a0d 0%, #7a1428 100%)' }}
          />
        )}

        {/* Editorial overlay gradient */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(10,10,10,0.98) 0%, rgba(10,10,10,0.55) 42%, rgba(10,10,10,0.30) 68%, rgba(10,10,10,0.55) 100%)',
          }}
        />

        {/* Top controls — back + count */}
        <div
          className="absolute left-0 right-0 z-10 mx-auto flex max-w-2xl items-center justify-between px-4"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <button
            onClick={goToMenu}
            className="flex h-9 w-9 items-center justify-center transition-colors hover:bg-black/60 active:scale-90"
            style={{
              background: 'rgba(0,0,0,0.40)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '2px',
            }}
            aria-label={t('common.back') || 'Retour'}
          >
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>

          <div
            className="font-mono flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold tabular-nums text-white"
            style={{
              background: 'rgba(232,25,44,0.92)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              letterSpacing: '0.02em',
            }}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            {totalQty}
          </div>
        </div>

        {/* Bottom content — kicker + hero title + venue meta */}
        <div className="absolute bottom-5 left-0 right-0 z-10 mx-auto max-w-2xl px-4">
          <div className="yuno-rule animate-hero-label mb-2.5">{t('cart.title')}</div>
          <h1
            className="font-display uppercase text-white animate-hero-h1 line-clamp-2"
            style={{ fontSize: 'clamp(30px, 8vw, 52px)', letterSpacing: '-0.03em', lineHeight: 0.9 }}
          >
            {heroTitle}
          </h1>
          {venueInfo?.name && (
            <p
              className="font-mono uppercase animate-hero-body mt-2.5 truncate"
              style={{ fontSize: '11px', color: 'var(--yuno-gray-1)', letterSpacing: '0.06em' }}
            >
              {venueInfo.name}
            </p>
          )}
        </div>
      </section>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-36 space-y-8">

        {/* ── Cart items grouped by event ──────────────────────── */}
        {Object.entries(groupedCart).map(([eventId, { eventTitle, items }], groupIndex) => (
          <motion.section
            key={eventId}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * 0.07, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Event label — editorial ruled section label */}
            <div className="section-label-ruled mb-4 truncate">
              <Calendar className="h-3 w-3 shrink-0" style={{ color: 'var(--yuno-red)' }} />
              <span className="truncate">{eventTitle}</span>
            </div>

            {/* Items */}
            <motion.div
              className="space-y-2.5"
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
            >
              <AnimatePresence initial={false}>
              {items.map((item) => {
                const discount = discountByDrink.get(item.drinkId);
                const itemTotal = item.unitPrice * item.qty;
                const discountedItemTotal = discount ? itemTotal - discount.amount : itemTotal;

                return (
                  <motion.div
                    key={`${item.drinkId}-${item.eventId}`}
                    layout={!reduceMotion}
                    variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
                  >
                    <div
                      className="flex gap-3.5 p-3 overflow-hidden"
                      style={{
                        background: 'var(--yuno-card)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {/* Drink image */}
                      <div
                        className="relative shrink-0 h-[84px] w-[84px] overflow-hidden flex items-center justify-center"
                        style={{ background: '#0A0A0A', borderRadius: 'var(--radius-sm)' }}
                      >
                        {item.imgUrl ? (
                          <img
                            src={item.imgUrl}
                            alt={getTranslatedDrinkName(item.name, language)}
                            className="h-full w-full object-contain p-2"
                          />
                        ) : (
                          <Wine className="h-8 w-8" style={{ color: 'var(--yuno-gray-4)' }} />
                        )}
                        {/* Discount badge */}
                        {discount && (
                          <span
                            className="font-mono absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 leading-none"
                            style={{
                              background: 'rgba(16,185,129,0.18)',
                              color: '#34d399',
                              borderRadius: '2px',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {discount.isFree ? t('upsell.free') : `-${discount.percent}%`}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        {/* Top row: name + price */}
                        <div className="flex items-start justify-between gap-2">
                          <h3
                            className="font-display font-bold text-[14px] leading-snug text-white line-clamp-2"
                            style={{ letterSpacing: '-0.01em' }}
                          >
                            {getTranslatedDrinkName(item.name, language)}
                          </h3>

                          {/* Price block */}
                          <div className="text-right shrink-0 ml-1">
                            {creditsCoverAll ? (
                              <>
                                <span
                                  className="font-display text-base font-bold tabular-nums"
                                  style={{ color: '#f59e0b' }}
                                >
                                  0 €
                                </span>
                                <div
                                  className="font-mono text-[10px] line-through tabular-nums"
                                  style={{ color: 'var(--yuno-gray-3)' }}
                                >
                                  {itemTotal.toFixed(2)} €
                                </div>
                              </>
                            ) : discount ? (
                              <>
                                <span
                                  className="font-display text-base font-bold tabular-nums"
                                  style={{ color: 'var(--yuno-red)' }}
                                >
                                  {discountedItemTotal.toFixed(2)} €
                                </span>
                                <div className="flex items-center gap-1 justify-end">
                                  <span
                                    className="font-mono text-[10px] line-through tabular-nums"
                                    style={{ color: 'var(--yuno-gray-3)' }}
                                  >
                                    {itemTotal.toFixed(2)} €
                                  </span>
                                  <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color: '#34d399' }}>
                                    -{discount.amount.toFixed(2)} €
                                  </span>
                                </div>
                              </>
                            ) : (
                              <>
                                <span
                                  className="font-display text-base font-bold tabular-nums"
                                  style={{ color: 'var(--yuno-red)' }}
                                >
                                  {itemTotal.toFixed(2)} €
                                </span>
                                {item.originalPrice && item.originalPrice > item.unitPrice && (
                                  <div className="flex items-center gap-1 justify-end">
                                    <span
                                      className="font-mono text-[10px] line-through tabular-nums"
                                      style={{ color: 'var(--yuno-gray-3)' }}
                                    >
                                      {(item.originalPrice * item.qty).toFixed(2)} €
                                    </span>
                                    <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color: '#34d399' }}>
                                      -{Math.round((1 - item.unitPrice / item.originalPrice) * 100)}%
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Unit price */}
                        <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--yuno-gray-3)', letterSpacing: '0.02em' }}>
                          {item.unitPrice.toFixed(2)} € / {t('cart.unit')}
                          {item.originalPrice && item.originalPrice > item.unitPrice && (
                            <span className="ml-1 line-through">{item.originalPrice.toFixed(2)} €</span>
                          )}
                        </p>

                        {/* Bottom row: qty controls + delete */}
                        <div className="flex items-center justify-between mt-2.5">
                          {/* Qty stepper — tranchant */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => decrementQty(item.drinkId)}
                              className="flex h-8 w-8 items-center justify-center transition-all duration-100 hover:bg-white/[0.14] active:scale-90"
                              style={{ background: 'rgba(255,255,255,0.09)', borderRadius: 'var(--radius-sm)' }}
                              aria-label="-"
                            >
                              <Minus className="h-3.5 w-3.5" style={{ color: 'rgba(255,255,255,0.7)' }} />
                            </button>
                            <span
                              className="font-display w-5 text-center text-base font-bold tabular-nums text-white select-none"
                            >
                              {item.qty}
                            </span>
                            <button
                              onClick={() => incrementQty(item.drinkId)}
                              className="flex h-8 w-8 items-center justify-center transition-all duration-100 active:scale-90"
                              style={{ background: 'rgba(232,25,44,0.85)', borderRadius: 'var(--radius-sm)' }}
                              aria-label="+"
                            >
                              <Plus className="h-3.5 w-3.5 text-white" />
                            </button>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => removeFromCart(item.drinkId)}
                            className="flex h-8 w-8 items-center justify-center transition-all duration-100 hover:bg-red-500/10 active:scale-90"
                            style={{ borderRadius: 'var(--radius-sm)' }}
                            aria-label={t('common.delete') || 'Supprimer'}
                          >
                            <Trash2 className="h-4 w-4" style={{ color: 'var(--yuno-gray-3)' }} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              </AnimatePresence>
            </motion.div>
          </motion.section>
        ))}

        {/* ── Offers Banner ────────────────────────────────────── */}
        {rules.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <CartOffersBanner
              rules={rules}
              cart={cartItems}
              venueId={venueInfo?.id || null}
              eventId={cart[0]?.eventId}
              eventTitle={cart[0]?.eventTitle}
            />
          </motion.div>
        )}

        {/* ── Credits Banner ───────────────────────────────────── */}
        {availableCredits > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div
              className="flex items-center gap-3 p-4"
              style={{
                background: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(245,158,11,0.04) 100%)',
                border: '1px solid rgba(245,158,11,0.20)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center"
                style={{ background: 'rgba(245,158,11,0.12)', borderRadius: 'var(--radius-sm)' }}
              >
                <Wine className="h-5 w-5" style={{ color: '#f59e0b' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-bold text-white">
                  {t('upsell.creditsAvailable').replace('{count}', String(availableCredits))}
                </p>
                <p className="font-sans text-[11px] mt-0.5" style={{ color: 'var(--yuno-gray-2)' }}>
                  {creditsCoverAll
                    ? t('upsell.creditsCoverAll')
                    : t('upsell.creditsCoverSome').replace('{count}', String(creditsCanCover))}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Upsell Suggestions ──────────────────────────────── */}
        <CartSuggestions venueId={venueInfo?.id || null} offerRules={rules} />

        {/* ── Guest Checkout Form ──────────────────────────────── */}
        {showGuestForm && !user && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div
              className="p-5"
              style={{
                background: 'var(--yuno-card)',
                border: '1px solid rgba(232,25,44,0.18)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <h3 className="font-display font-bold text-base text-white mb-1">
                {t('guest.checkoutTitle') || "Commander en tant qu'invité"}
              </h3>
              <p className="font-sans text-xs mb-5" style={{ color: 'var(--yuno-gray-2)' }}>
                {t('guest.checkoutDesc') || 'Recevez votre QR code par email. Vous pourrez créer un compte après.'}
              </p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase" style={{ color: 'var(--yuno-gray-2)', letterSpacing: '0.08em' }}>
                    {t('guest.email') || 'Email'} *
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--yuno-gray-3)' }} />
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      className="pl-10"
                      style={{ background: 'var(--yuno-input)' }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="font-mono text-[10px] uppercase" style={{ color: 'var(--yuno-gray-2)', letterSpacing: '0.08em' }}>
                      {t('guest.firstName') || 'Prénom'} *
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--yuno-gray-3)' }} />
                      <Input
                        placeholder={t('guest.firstNamePlaceholder') || 'Prénom'}
                        value={guestFirstName}
                        onChange={(e) => setGuestFirstName(e.target.value)}
                        className="pl-10"
                        style={{ background: 'var(--yuno-input)' }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-mono text-[10px] uppercase" style={{ color: 'var(--yuno-gray-2)', letterSpacing: '0.08em' }}>
                      {t('guest.lastName') || 'Nom'} *
                    </Label>
                    <Input
                      placeholder={t('guest.lastNamePlaceholder') || 'Nom'}
                      value={guestLastName}
                      onChange={(e) => setGuestLastName(e.target.value)}
                      style={{ background: 'var(--yuno-input)' }}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase" style={{ color: 'var(--yuno-gray-2)', letterSpacing: '0.08em' }}>
                    {t('guest.phone') || 'Téléphone'} ({t('guest.optional') || 'optionnel'})
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--yuno-gray-3)' }} />
                    <Input
                      type="tel"
                      placeholder="+33 6 12 34 56 78"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      className="pl-10"
                      style={{ background: 'var(--yuno-input)' }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-4 text-center">
                <button
                  onClick={() => navigate('/auth?redirect=/cart')}
                  className="font-sans text-xs font-medium transition-opacity hover:opacity-70 link-slide"
                  style={{ color: 'var(--yuno-red)' }}
                >
                  {t('guest.hasAccount') || 'Déjà un compte ? Se connecter'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* ── Sticky Footer ────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Backdrop overlay for details panel */}
        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.65)' }}
              onClick={() => setShowDetails(false)}
            />
          )}
        </AnimatePresence>

        {/* Expandable details panel */}
        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed bottom-0 left-0 right-0 z-50"
              style={{
                background: 'var(--yuno-card)',
                borderTop: '1px solid var(--border-subtle)',
                borderTopLeftRadius: 'var(--radius-xl)',
                borderTopRightRadius: 'var(--radius-xl)',
                boxShadow: '0 -12px 48px rgba(0,0,0,0.6)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="h-1 w-10 rounded-full" style={{ background: 'var(--yuno-gray-4)' }} />
              </div>

              <div className="mx-auto max-w-xl px-5 pb-32 max-h-[70vh] overflow-y-auto">
                {/* Section label */}
                <p className="section-label-ruled mb-4">
                  {t('cart.orderDetails') || 'Détails de la commande'}
                </p>

                {/* Event card */}
                {cart[0]?.eventTitle && (
                  <div
                    className="flex items-center gap-3 p-3 mb-4"
                    style={{
                      background: 'var(--yuno-card-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <Calendar className="h-4 w-4 shrink-0" style={{ color: 'var(--yuno-red)' }} />
                    <div className="min-w-0">
                      <p className="font-display font-bold text-sm text-white leading-snug truncate">
                        {cart[0].eventTitle}
                      </p>
                      {venueInfo?.name && (
                        <p className="font-mono uppercase text-[10px] truncate mt-1" style={{ color: 'var(--yuno-gray-2)', letterSpacing: '0.08em' }}>
                          {venueInfo.name}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Order breakdown */}
                <div
                  className="p-4 mb-4"
                  style={{
                    background: 'var(--yuno-card-2)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div className="space-y-2.5 text-sm">
                    {cart.map((item) => {
                      const discount = discountByDrink.get(item.drinkId);
                      const itemTotal = item.unitPrice * item.qty;
                      const discountedItemTotal = discount ? itemTotal - discount.amount : itemTotal;
                      return (
                        <div key={item.drinkId} className="flex items-center justify-between gap-3">
                          <span className="font-sans" style={{ color: 'var(--yuno-gray-2)' }}>
                            {item.qty}× {getTranslatedDrinkName(item.name, language)}
                          </span>
                          <div className="text-right">
                            {discount ? (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="font-mono text-xs line-through tabular-nums"
                                  style={{ color: 'var(--yuno-gray-3)' }}
                                >
                                  {itemTotal.toFixed(2)} €
                                </span>
                                <span className="font-mono font-semibold tabular-nums text-white">
                                  {discountedItemTotal.toFixed(2)} €
                                </span>
                              </div>
                            ) : (
                              <span className="font-mono font-semibold tabular-nums text-white">
                                {itemTotal.toFixed(2)} €
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {totalDiscount > 0 && (
                      <div className="flex items-center justify-between gap-3" style={{ color: '#34d399' }}>
                        <span className="font-sans">{t('cart.discount') || 'Réduction'}</span>
                        <span className="font-mono font-semibold tabular-nums">-{totalDiscount.toFixed(2)} €</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3" style={{ color: 'var(--yuno-gray-2)' }}>
                      <span className="font-sans">{t('cart.serviceFee') || 'Frais de transaction'}</span>
                      <span className="font-mono font-semibold tabular-nums text-white">
                        {creditsCoverAll ? (
                          <>
                            <span className="line-through mr-1.5 text-sm font-normal" style={{ color: 'var(--yuno-gray-3)' }}>
                              {discountedServiceFee.toFixed(2)} €
                            </span>
                            <span style={{ color: '#f59e0b' }}>0 €</span>
                          </>
                        ) : (
                          discountedServiceFee.toFixed(2) + ' €'
                        )}
                      </span>
                    </div>

                    <div
                      className="flex items-center justify-between pt-3 mt-1"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <span className="font-display text-base font-bold text-white">{t('cart.total')}</span>
                      <span className="font-display text-base font-bold tabular-nums text-white">
                        {creditsCoverAll ? (
                          <>
                            <span className="font-mono line-through mr-2 text-sm font-normal" style={{ color: 'var(--yuno-gray-3)' }}>
                              {totalWithFees.toFixed(2)} €
                            </span>
                            <span style={{ color: '#f59e0b' }}>0 €</span>
                          </>
                        ) : (
                          totalWithFees.toFixed(2) + ' €'
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Age Gate & Terms */}
                <div className="space-y-3">
                  <AgeGate userId={user?.id} onVerified={setAgeVerified} />
                  <TermsAcceptance userId={user?.id} context="drink" onAcceptedChange={setAcceptCgv} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Compact footer bar ─────────────────────────────── */}
        <div className="relative z-50 px-4 pb-4">
          <div
            className="mx-auto flex w-full max-w-xl items-center justify-between gap-4 px-5 py-3.5"
            style={{
              background: 'rgba(14, 14, 16, 0.94)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(232,25,44,0.07)',
            }}
          >
            {/* Total + toggle */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex flex-col text-left min-w-0"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="font-mono uppercase"
                  style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'var(--yuno-gray-3)' }}
                >
                  {t('cart.total')}
                </span>
                <ChevronUp
                  className="h-3 w-3 transition-transform duration-200"
                  style={{
                    color: 'rgba(255,255,255,0.25)',
                    transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              </div>

              {creditsCoverAll ? (
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-display text-sm line-through tabular-nums"
                    style={{ color: 'rgba(255,255,255,0.25)' }}
                  >
                    {totalWithFees.toFixed(2)} €
                  </span>
                  <span
                    className="font-display tabular-nums"
                    style={{ fontSize: '23px', fontWeight: 700, letterSpacing: '-0.03em', color: '#f59e0b', lineHeight: 1 }}
                  >
                    0 €
                  </span>
                </div>
              ) : (
                <motion.span
                  key={reduceMotion ? undefined : totalWithFees}
                  initial={reduceMotion ? false : { opacity: 0.45 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="font-display tabular-nums"
                  style={{ fontSize: '23px', fontWeight: 700, letterSpacing: '-0.03em', color: '#FFFFFF', lineHeight: 1 }}
                >
                  {totalWithFees.toFixed(2)} €
                </motion.span>
              )}

              <span
                className="font-mono uppercase"
                style={{ fontSize: '9px', color: 'var(--yuno-gray-3)', marginTop: '3px', letterSpacing: '0.10em' }}
              >
                {t('tickets.feesIncluded') || 'Frais inclus'}
              </span>
            </button>

            {/* CTA button(s) */}
            {creditsCoverAll ? (
              <button
                onClick={() => handleCreditCheckout(false)}
                disabled={isProcessing}
                className="font-sans flex h-12 shrink-0 items-center rounded-full px-6 text-sm font-bold text-black transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
                style={{ background: '#f59e0b', boxShadow: '0 10px 28px rgba(245,158,11,0.35)' }}
              >
                {isProcessing ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                ) : (
                  <>
                    <Wine className="mr-2 h-4 w-4" />
                    {t('cart.checkout')}
                  </>
                )}
              </button>
            ) : availableCredits > 0 && mostExpensiveItem ? (
              <div className="flex flex-col gap-1.5 items-end shrink-0">
                <button
                  onClick={() => handleCreditCheckout(true)}
                  disabled={isProcessing}
                  className="font-sans flex h-8 items-center rounded-full px-3.5 text-xs font-bold text-black transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
                  style={{ background: '#f59e0b' }}
                >
                  <Wine className="mr-1.5 h-3.5 w-3.5" />
                  {isProcessing ? '…' : t('upsell.useCredit')}
                </button>
                <button
                  onClick={handleCheckout}
                  disabled={isProcessing}
                  className="font-sans flex h-12 items-center rounded-full px-6 text-sm font-bold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
                  style={{ background: 'var(--yuno-red)', boxShadow: '0 10px 28px rgba(232,25,44,0.32)' }}
                >
                  {isProcessing ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      {t('cart.checkout')}
                      <ChevronRight className="ml-1.5 h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={handleCheckout}
                disabled={isProcessing}
                className="font-sans flex h-12 shrink-0 items-center rounded-full px-6 text-sm font-bold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
                style={{ background: 'var(--yuno-red)', boxShadow: '0 10px 28px rgba(232,25,44,0.32)' }}
              >
                {isProcessing ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    {t('cart.checkout')}
                    <ChevronRight className="ml-1.5 h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Auth Choice Dialog ────────────────────────────────── */}
      <Dialog open={showAuthChoiceDialog} onOpenChange={setShowAuthChoiceDialog}>
        <DialogContent
          className="sm:max-w-md"
          style={{
            background: 'var(--yuno-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display uppercase text-lg" style={{ letterSpacing: '-0.02em' }}>
              {t('guest.authChoiceTitle')}
            </DialogTitle>
            <DialogDescription className="font-sans" style={{ color: 'var(--yuno-gray-2)' }}>
              {t('guest.authChoiceDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            {/* Login option */}
            <button
              onClick={() => { setShowAuthChoiceDialog(false); navigate('/auth?redirect=/cart'); }}
              className="group w-full flex items-center gap-4 p-4 text-left transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{
                background: 'var(--yuno-red-tint)',
                border: '1px solid var(--yuno-red-dim)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center"
                style={{ background: 'var(--yuno-red-dim)', borderRadius: 'var(--radius-sm)' }}
              >
                <LogIn className="h-5 w-5" style={{ color: 'var(--yuno-red)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-bold text-white">{t('guest.loginOption')}</p>
                <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--yuno-gray-2)' }}>
                  {t('guest.loginOptionDesc')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--yuno-gray-3)' }} />
            </button>

            {/* Guest option */}
            <button
              onClick={() => { setShowAuthChoiceDialog(false); navigate('/guest-checkout'); }}
              className="group w-full flex items-center gap-4 p-4 text-left transition-all duration-150 hover:bg-white/[0.04] active:scale-[0.98]"
              style={{
                background: 'var(--yuno-card-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}
              >
                <UserPlus className="h-5 w-5" style={{ color: 'var(--yuno-gray-2)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-bold text-white">{t('guest.guestOption')}</p>
                <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--yuno-gray-2)' }}>
                  {t('guest.guestOptionDrinkDesc')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--yuno-gray-3)' }} />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
