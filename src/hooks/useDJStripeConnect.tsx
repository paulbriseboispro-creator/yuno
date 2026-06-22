import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: { action: 'status', actor_type: 'dj' },
      });
      if (error) throw error;
      setStripe({
        connected: data.connected || false,
        status: data.status || 'none',
        chargesEnabled: data.chargesEnabled || false,
        payoutsEnabled: data.payoutsEnabled || false,
      });
    } catch (e) {
      console.error('Error fetching DJ Stripe status:', e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const startOnboarding = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: { action: 'onboard', actor_type: 'dj' },
      });
      if (error) throw error;
      // Full redirect — Stripe returns the DJ to /dj/bookings?stripe=success.
      if (data.url) window.location.href = data.url;
    } catch (e) {
      toast.error("Erreur lors de l'activation des paiements Stripe");
    }
  };

  const openDashboard = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: { action: 'dashboard', actor_type: 'dj' },
      });
      if (error) throw error;
      if (data.url) window.open(data.url, '_blank');
    } catch (e) {
      toast.error("Erreur lors de l'ouverture du dashboard Stripe");
    }
  };

  return { stripe, loading, refresh, startOnboarding, openDashboard };
}
