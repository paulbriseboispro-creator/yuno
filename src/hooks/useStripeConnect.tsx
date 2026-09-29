import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import type { PlanCode } from '@/lib/planFeatures';
import { openPendingTab, stripeConnectErrorMessage } from '@/lib/stripeConnectClient';
import { trackStripeConnectStarted, trackStripeConnectStatus } from '@/lib/stripeConnectTracking';

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
  const { language } = useLanguage();
  // Deux clics rapprochés ouvraient deux comptes Stripe pour le même club.
  const [startingOnboarding, setStartingOnboarding] = useState(false);
  const startingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (!venueId) return;
    try {
      const { data, error } = await invokeEdgeFunction('stripe-connect', { body: { action: 'refresh', venueId } });
      if (error) throw error;
      setStripeStatus({
        connected: data.connected || false,
        chargesEnabled: data.chargesEnabled || false,
        payoutsEnabled: data.payoutsEnabled || false,
        onboardingComplete: data.onboardingComplete || false,
        accountId: data.accountId || null,
      });
      trackStripeConnectStatus('venue', venueId, { accountId: data.accountId || null, ready: !!data.chargesEnabled });
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

  /**
   * Formulaire Stripe dans la page courante : Stripe y ramène l'owner à la fin
   * (`returnUrl`, par défaut la page Paiements qui relit l'état). L'ancien
   * `window.open` posé après l'appel serveur était bloqué par Safari.
   */
  const startOnboarding = async (opts?: { returnUrl?: string; refreshUrl?: string }) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStartingOnboarding(true);
    trackStripeConnectStarted('venue', venueId);
    let redirecting = false;
    try {
      const { data, error } = await invokeEdgeFunction('stripe-connect', {
        body: { action: 'onboard', actor_type: 'owner', venueId, returnUrl: opts?.returnUrl, refreshUrl: opts?.refreshUrl },
      });
      if (!error && data?.url) {
        redirecting = true;
        window.location.href = data.url;
        return;
      }
      toast.error(stripeConnectErrorMessage(
        language,
        data,
        translate(language, "Erreur lors de l'activation des paiements", 'Could not start payment activation', 'No se ha podido activar los pagos'),
      ));
    } finally {
      if (!redirecting) {
        startingRef.current = false;
        setStartingOnboarding(false);
      }
    }
  };

  const openDashboard = async () => {
    const tab = openPendingTab();
    const { data, error } = await invokeEdgeFunction('stripe-connect', { body: { action: 'dashboard', venueId } });
    if (!error && data?.url) {
      tab.go(data.url);
      return;
    }
    tab.close();
    toast.error(stripeConnectErrorMessage(
      language,
      data,
      translate(language, "Erreur d'ouverture du tableau de bord Stripe", 'Could not open the Stripe dashboard', 'No se ha podido abrir el panel de Stripe'),
    ));
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

  return { stripeStatus, subscription, loading, startingOnboarding, refreshStatus, checkSubscription, startOnboarding, openDashboard, startSubscription, manageSubscription };
}
