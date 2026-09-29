import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { openPendingTab, stripeConnectErrorMessage } from '@/lib/stripeConnectClient';
import { trackStripeConnectStarted, trackStripeConnectStatus } from '@/lib/stripeConnectTracking';

/**
 * DJ-side Stripe Connect status + onboarding. Mirrors useStripeConnect (owner) and
 * useOrganizerStripe, but a DJ's connected account is PER PERSON (keyed on user_id,
 * stored in dj_stripe_accounts) — a DJ playing N venues still has ONE payout account.
 * Routes through the shared `stripe-connect` edge dispatcher with actor_type 'dj'.
 */

export interface DJStripeStatus {
  connected: boolean;
  status: 'none' | 'pending' | 'active' | 'restricted';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

export function useDJStripeConnect() {
  const [stripe, setStripe] = useState<DJStripeStatus>({
    connected: false, status: 'none', chargesEnabled: false, payoutsEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { language } = useLanguage();
  const userId = user?.id ?? null;
  const startingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await invokeEdgeFunction('stripe-connect', {
        body: { action: 'status', actor_type: 'dj' },
      });
      if (error) throw error;
      setStripe({
        connected: data.connected || false,
        status: data.status || 'none',
        chargesEnabled: data.chargesEnabled || false,
        payoutsEnabled: data.payoutsEnabled || false,
      });
      trackStripeConnectStatus('dj', userId, { accountId: data.connected ? userId : null, ready: !!data.chargesEnabled });
    } catch (e) {
      console.error('Error fetching DJ Stripe status:', e);
    }
  }, [userId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const startOnboarding = async () => {
    // Un second clic pendant l'appel ouvrirait un second compte Stripe.
    if (startingRef.current) return;
    startingRef.current = true;
    trackStripeConnectStarted('dj', userId);
    const { data, error } = await invokeEdgeFunction('stripe-connect', {
      body: { action: 'onboard', actor_type: 'dj' },
    });
    if (!error && data?.url) {
      // Full redirect — Stripe returns the DJ to /dj/bookings?stripe=success.
      window.location.href = data.url;
      return;
    }
    startingRef.current = false;
    toast.error(stripeConnectErrorMessage(
      language,
      data,
      translate(language, "Erreur lors de l'activation des paiements Stripe", 'Could not start Stripe payment activation', 'No se ha podido activar los pagos de Stripe'),
    ));
  };

  const openDashboard = async () => {
    const tab = openPendingTab();
    const { data, error } = await invokeEdgeFunction('stripe-connect', {
      body: { action: 'dashboard', actor_type: 'dj' },
    });
    if (!error && data?.url) {
      tab.go(data.url);
      return;
    }
    tab.close();
    toast.error(stripeConnectErrorMessage(
      language,
      data,
      translate(language, "Erreur lors de l'ouverture du dashboard Stripe", 'Could not open the Stripe dashboard', 'No se ha podido abrir el panel de Stripe'),
    ));
  };

  return { stripe, loading, refresh, startOnboarding, openDashboard };
}
