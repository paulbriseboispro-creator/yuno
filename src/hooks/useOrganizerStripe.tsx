import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { openPendingTab, stripeConnectErrorMessage } from '@/lib/stripeConnectClient';
import { trackStripeConnectStarted, trackStripeConnectStatus } from '@/lib/stripeConnectTracking';

export type OrganizerStripeState = 'none' | 'pending' | 'active' | 'restricted';

export interface OrganizerStripeStatus {
  accountId: string | null;
  status: OrganizerStripeState;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardedAt: string | null;
  /** Encaissement ouvert chez Stripe : la vente de billets et de tables peut s'allumer. */
  canSell: boolean;
}

const STATES: readonly OrganizerStripeState[] = ['none', 'pending', 'active', 'restricted'];
const asState = (v: unknown): OrganizerStripeState =>
  STATES.includes(v as OrganizerStripeState) ? (v as OrganizerStripeState) : 'none';

export function useOrganizerStripe(userId: string | null | undefined) {
  const { language } = useLanguage();
  const [data, setData] = useState<OrganizerStripeStatus>({
    accountId: null,
    status: 'none',
    chargesEnabled: false,
    payoutsEnabled: false,
    onboardedAt: null,
    canSell: false,
  });
  const [loading, setLoading] = useState(true);
  // Deux clics rapprochés sur « Activer les paiements » ouvraient deux comptes
  // Stripe : le serveur ne voyait encore aucun compte enregistré pour le second.
  const [startingOnboarding, setStartingOnboarding] = useState(false);
  const startingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      // Read cached status from profile first for instant UI
      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_onboarded_at',
        )
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        setData({
          accountId: profile.stripe_connect_account_id ?? null,
          status: asState(profile.stripe_connect_status),
          chargesEnabled: !!profile.stripe_connect_charges_enabled,
          payoutsEnabled: !!profile.stripe_connect_payouts_enabled,
          onboardedAt: profile.stripe_connect_onboarded_at ?? null,
          canSell: !!profile.stripe_connect_charges_enabled,
        });
      }

      // If account exists, refresh from Stripe in background
      if (profile?.stripe_connect_account_id) {
        const { data: fresh, error } = await invokeEdgeFunction('stripe-connect', { body: { action: 'status' } });
        if (!error && fresh && !fresh.error) {
          setData({
            accountId: fresh.accountId ?? profile.stripe_connect_account_id,
            status: asState(fresh.status),
            chargesEnabled: !!fresh.chargesEnabled,
            payoutsEnabled: !!fresh.payoutsEnabled,
            onboardedAt: fresh.onboardedAt ?? null,
            canSell: !!fresh.chargesEnabled,
          });
          trackStripeConnectStatus('organizer', userId, { accountId: fresh.accountId ?? null, ready: !!fresh.chargesEnabled });
        }
      }
    } catch (e) {
      console.error('useOrganizerStripe.refresh', e);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [userId, refresh]);

  /**
   * Ouvre (ou reprend) le formulaire Stripe dans la page courante : Stripe y
   * ramène le pro à la fin (`returnUrl`, par défaut la page Paiements).
   */
  const startOnboarding = async (opts?: { returnUrl?: string; refreshUrl?: string }) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStartingOnboarding(true);
    trackStripeConnectStarted('organizer', userId);
    let redirecting = false;
    try {
      const { data: res, error } = await invokeEdgeFunction('stripe-connect', {
        body: { action: 'onboard', returnUrl: opts?.returnUrl, refreshUrl: opts?.refreshUrl },
      });
      if (!error && res?.url) {
        redirecting = true;
        window.location.href = res.url;
        return;
      }
      toast.error(stripeConnectErrorMessage(
        language,
        res,
        translate(language, "Erreur lors de l'activation des paiements", 'Could not start payment activation', 'No se ha podido activar los pagos'),
      ));
    } finally {
      // Pendant la redirection le bouton reste inactif : un second clic
      // relancerait une requête inutile.
      if (!redirecting) {
        startingRef.current = false;
        setStartingOnboarding(false);
      }
    }
  };

  const openDashboard = async () => {
    const tab = openPendingTab();
    const { data: res, error } = await invokeEdgeFunction('stripe-connect', {
      body: { action: 'dashboard', actor_type: 'organizer' },
    });
    if (!error && res?.url) {
      tab.go(res.url);
      return;
    }
    tab.close();
    toast.error(stripeConnectErrorMessage(
      language,
      res,
      translate(language, "Erreur d'ouverture du tableau de bord Stripe", 'Could not open the Stripe dashboard', 'No se ha podido abrir el panel de Stripe'),
    ));
  };

  return { ...data, loading, startingOnboarding, refresh, startOnboarding, openDashboard };
}
