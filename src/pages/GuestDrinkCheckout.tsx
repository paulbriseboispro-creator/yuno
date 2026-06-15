import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, User, Phone, Wine, ChevronRight, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/store/useStore';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';
import { TermsAcceptance } from '@/components/TermsAcceptance';
import { AgeGate } from '@/components/AgeGate';
import { useCartRules } from '@/hooks/useCartRules';
import { useEffect } from 'react';

interface VenueInfo {
  id: string;
  name: string;
}

export default function GuestDrinkCheckout() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const cart = useStore((s) => s.cart);
  const getCartTotal = useStore((s) => s.getCartTotal);
  const clearCart = useStore((s) => s.clearCart);
  const selectedEventId = useStore((s) => s.selectedEventId);

  const [guestEmail, setGuestEmail] = useState('');
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [acceptCgv, setAcceptCgv] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [venueInfo, setVenueInfo] = useState<VenueInfo | null>(null);

  const total = getCartTotal();
  const cartItems = useMemo(() => cart.map(i => ({
    drinkId: i.drinkId,
    qty: i.qty,
    collection: i.collection,
    unitPrice: i.unitPrice,
    name: i.name,
  })), [cart]);

  const { totalDiscount, discountedItems } = useCartRules(venueInfo?.id || null, cartItems);
  const discountedTotal = total - totalDiscount;
  const serviceFee = Math.round(discountedTotal * 0.03 * 100) / 100;
  const totalWithFees = discountedTotal + serviceFee;

  // Fetch venue info
  useEffect(() => {
    const fetchVenue = async () => {
      if (cart.length === 0) return;
      const firstItem = cart[0];
      if (!firstItem.eventId) return;
      const { data: ev } = await supabase.from('events').select('venue_id, partner_venue_id').eq('id', firstItem.eventId).single();
      const hostVenueId = ev?.venue_id || ev?.partner_venue_id;
      if (!hostVenueId) return;
      const { data: venue } = await supabase.from('venues').select('id, name').eq('id', hostVenueId).single();
      if (venue) setVenueInfo(venue);
    };
    fetchVenue();
  }, [cart]);

  // Redirect if cart is empty
  useEffect(() => {
    if (cart.length === 0) navigate('/cart', { replace: true });
  }, [cart.length, navigate]);

  const handleCheckout = async () => {
    if (!guestEmail.trim() || !guestFirstName.trim() || !guestLastName.trim()) {
      toast({ title: t('guest.fillRequired'), variant: 'destructive' });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guestEmail.trim())) {
      toast({ title: t('guest.invalidEmail'), variant: 'destructive' });
      return;
    }
    if (!acceptCgv) {
      toast({ title: t('cgv.required'), variant: 'destructive' });
      return;
    }
    if (!ageVerified) {
      toast({ title: t('ageGate.required'), variant: 'destructive' });
      return;
    }

    // A drink order must be attached to an event (same rule as the cart page).
    const hasNoEvent = cart.some(item => !item.eventId);
    if (hasNoEvent) {
      toast({ title: t('cart.eventMissing'), description: t('cart.eventMissingDesc'), variant: 'destructive' });
      return;
    }

    // Anti-double-payment guard (mirrors Cart.tsx): block re-submitting the same
    // cart while a checkout is already in flight, so a double-click / back-button
    // can't open two Stripe sessions and double-charge the guest.
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
      // CGV acceptance is handled by TermsAcceptance component

      const eventId = selectedEventId || cart[0]?.eventId;
      const items = cart.map(item => ({ id: item.drinkId, quantity: item.qty, collection: item.collection }));

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          items,
          eventId,
          venueId: venueInfo?.id,
          cancelUrl: '/guest-checkout',
          guestEmail: guestEmail.trim(),
          guestFullName: `${guestFirstName.trim()} ${guestLastName.trim()}`,
          guestPhone: guestPhone.trim() || undefined,
        },
      });

      if (error) throw error;

      if (data?.code === 'ACCOUNT_EXISTS') {
        toast({
          title: t('guest.accountExists'),
          description: t('guest.accountExistsDesc'),
          variant: 'destructive',
        });
        navigate('/auth?redirect=/cart');
        return;
      }

      if (!data?.success) throw new Error(data?.error || 'Failed to create checkout');

      if (data.testMode && data.redirectUrl) {
        sessionStorage.removeItem(pendingSessionKey);
        clearCart();
        navigate(data.redirectUrl);
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
      toast({ title: t('cart.error'), description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  if (cart.length === 0) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background border-b border-border/30">
        <div className="flex items-center justify-between px-4 h-12">
          <button
            onClick={() => navigate('/cart')}
            className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="text-center flex-1">
            <p className="text-sm font-medium">{t('guest.checkoutTitle')}</p>
          </div>
          <div className="w-8" />
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 pb-32">
        {/* Order Summary */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-primary rounded-full" />
            <h3 className="text-sm font-semibold">{t('cart.summary') || 'Résumé de la commande'}</h3>
          </div>

          <div className="rounded-lg border border-border/30 bg-surface/50 overflow-hidden">
            {cart.map((item) => (
              <div key={`${item.drinkId}-${item.eventId}`} className="flex items-center gap-3 p-3 border-b border-border/10 last:border-b-0">
                <div className="w-12 h-12 rounded-lg bg-surface flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {item.imgUrl ? (
                    <img src={item.imgUrl} alt={getTranslatedDrinkName(item.name, language)} className="h-full w-full object-contain p-1" />
                  ) : (
                    <Wine className="h-5 w-5 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{getTranslatedDrinkName(item.name, language)}</p>
                  <p className="text-xs text-muted-foreground">{item.qty}x {item.unitPrice.toFixed(2)}€</p>
                </div>
                <p className="text-sm font-semibold shrink-0">{(item.unitPrice * item.qty).toFixed(2)}€</p>
              </div>
            ))}

            {/* Price breakdown */}
            <div className="p-3 bg-muted/20 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('cart.subtotal')}</span>
                <span>{discountedTotal.toFixed(2)}€</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm text-emerald-400">
                  <span>{t('cart.discount')}</span>
                  <span>-{totalDiscount.toFixed(2)}€</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('cart.serviceFee')}</span>
                <span>{serviceFee.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between font-bold text-base pt-1.5 border-t border-border/20">
                <span>{t('cart.total')}</span>
                <span>{totalWithFees.toFixed(2)}€</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Guest Info Form */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-primary rounded-full" />
            <h3 className="text-sm font-semibold">{t('guest.yourInfo') || 'Vos informations'}</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('guest.email')} *</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('guest.firstName')} *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('guest.firstNamePlaceholder')}
                    value={guestFirstName}
                    onChange={(e) => setGuestFirstName(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('guest.lastName')} *</Label>
                <Input
                  placeholder={t('guest.lastNamePlaceholder')}
                  value={guestLastName}
                  onChange={(e) => setGuestLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('guest.phone')} ({t('guest.optional')})</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="tel"
                  placeholder="+33 6 12 34 56 78"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          {/* Age verification + CGV — inside scrollable form, NOT in sticky footer */}
          <div className="mt-4 space-y-3">
            <AgeGate onVerified={setAgeVerified} />
            <TermsAcceptance guestEmail={guestEmail} context="drink" onAcceptedChange={setAcceptCgv} />
          </div>

          <p className="text-xs text-muted-foreground mt-3">
            {t('guest.checkoutDesc')}
          </p>

          <div className="mt-3 text-center">
            <button onClick={() => navigate('/auth?redirect=/cart')} className="text-xs text-primary hover:underline">
              {t('guest.hasAccount')}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Sticky Footer — pay button only */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex justify-center px-4 pb-4 bg-background">
          <div className="inline-flex items-center w-full max-w-md gap-4 rounded-full bg-[#E8E8EC] px-5 py-2.5 shadow-[0_4px_30px_rgba(0,0,0,0.5)] justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-black/50 uppercase tracking-wider font-medium">{t('tickets.total')}</span>
              <span className="text-xl font-bold text-black">{totalWithFees.toFixed(2)} €</span>
              <span className="text-[9px] text-black/40 font-medium">{t('tickets.feesIncluded') || 'Frais inclus'}</span>
            </div>
            <Button
              size="lg"
              onClick={handleCheckout}
              disabled={isProcessing}
              className="px-6 h-12 rounded-full font-semibold shrink-0 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
            >
              {isProcessing ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <>
                  {t('cart.checkout')}
                  <ChevronRight className="h-5 w-5 ml-1 transition-transform" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
