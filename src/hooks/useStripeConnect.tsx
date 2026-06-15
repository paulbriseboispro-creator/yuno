import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { PlanCode } from '@/lib/planFeatures';

interface StripeConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingComplete: boolean;
  accountId: string | null;
}

interface SubscriptionStatus {
  subscribed: boolean;
  status: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  daysRemaining: number | null;
  isTrial: boolean;
}

export function useStripeConnect(venueId: string | null) {
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatus>({
    connected: false, chargesEnabled: false, payoutsEnabled: false, onboardingComplete: false, accountId: null
  });
  const [subscription, setSubscription] = useState<SubscriptionStatus>({
    subscribed: false, status: 'inactive', currentPeriodEnd: null, trialEnd: null, daysRemaining: null, isTrial: false
  });
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', { body: { action: 'refresh', venueId } });
      if (error) throw error;
      setStripeStatus({
        connected: data.connected || false,
        chargesEnabled: data.chargesEnabled || false,
        payoutsEnabled: data.payoutsEnabled || false,
        onboardingComplete: data.onboardingComplete || false,
        accountId: data.accountId || null,
      });
    } catch (e) { console.error('Error refreshing Stripe status:', e); }
  }, [venueId]);

  const checkSubscription = useCallback(async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.functions.invoke('club-subscription', { body: { action: 'check', venueId } });
      if (error) throw error;
      setSubscription({
        subscribed: data.subscribed || false,
        status: data.status || 'inactive',
        currentPeriodEnd: data.currentPeriodEnd || null,
        trialEnd: data.trialEnd || null,
        daysRemaining: data.daysRemaining ?? null,
        isTrial: data.isTrial || false,
      });
    } catch (e) { console.error('Error checking subscription:', e); }
  }, [venueId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([refreshStatus(), checkSubscription()]);
      setLoading(false);
    };
    if (venueId) init();
  }, [venueId, refreshStatus, checkSubscription]);

  const startOnboarding = async (opts?: { returnUrl?: string; refreshUrl?: string }) => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: { action: 'onboard', actor_type: 'owner', venueId, returnUrl: opts?.returnUrl, refreshUrl: opts?.refreshUrl },
      });
      if (error) throw error;
      if (data.url) window.open(data.url, '_blank');
    } catch (e) {
      toast.error("Erreur lors de l'onboarding Stripe");
    }
  };

  const openDashboard = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', { body: { action: 'dashboard', venueId } });
      if (error) throw error;
      if (data.url) window.open(data.url, '_blank');
    } catch (e) {
      toast.error("Erreur lors de l'ouverture du dashboard");
    }
  };

  const startSubscription = async (planCode?: PlanCode) => {
    // Check directly with Stripe via edge function to prevent duplicates
    try {
      const { data: checkData } = await supabase.functions.invoke('club-subscription', { body: { action: 'check', venueId } });
      if (checkData?.subscribed) {
        setSubscription({
          subscribed: checkData.subscribed,
          status: checkData.status || 'active',
          currentPeriodEnd: checkData.currentPeriodEnd || null,
          trialEnd: checkData.trialEnd || null,
          daysRemaining: checkData.daysRemaining ?? null,
          isTrial: checkData.isTrial || false,
        });
        toast.info("Vous avez déjà un abonnement actif");
        return;
      }
    } catch (e) {
      console.error('Error checking subscription before creation:', e);
    }

    try {
      const { data, error } = await supabase.functions.invoke('club-subscription', {
        body: { action: 'create', venueId, ...(planCode ? { planCode } : {}) },
      });
      if (error) throw error;
      if (data.url) window.open(data.url, '_blank');
      else if (data.error) toast.error(data.error);
    } catch (e) {
      toast.error("Erreur lors de la création de l'abonnement");
    }
  };

  const manageSubscription = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('club-subscription', { body: { action: 'manage' } });
      if (error) throw error;
      if (data.url) window.open(data.url, '_blank');
    } catch (e) {
      toast.error("Erreur lors de l'ouverture du portail");
    }
  };

  return { stripeStatus, subscription, loading, refreshStatus, checkSubscription, startOnboarding, openDashboard, startSubscription, manageSubscription };
}
