import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OrganizerStripeStatus {
  accountId: string | null;
  status: 'none' | 'pending' | 'active' | 'restricted';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardedAt: string | null;
  canSell: boolean;
}

export function useOrganizerStripe(userId: string | null | undefined) {
  const [data, setData] = useState<OrganizerStripeStatus>({
    accountId: null,
    status: 'none',
    chargesEnabled: false,
    payoutsEnabled: false,
    onboardedAt: null,
    canSell: false,
  });
  const [loading, setLoading] = useState(true);

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
          status: (profile.stripe_connect_status as any) ?? 'none',
          chargesEnabled: !!profile.stripe_connect_charges_enabled,
          payoutsEnabled: !!profile.stripe_connect_payouts_enabled,
          onboardedAt: profile.stripe_connect_onboarded_at ?? null,
          canSell: !!profile.stripe_connect_charges_enabled,
        });
      }

      // If account exists, refresh from Stripe in background
      if (profile?.stripe_connect_account_id) {
        const { data: fresh } = await supabase.functions.invoke(
          'organizer-stripe-connect-status',
        );
        if (fresh && !fresh.error) {
          setData({
            accountId: fresh.accountId ?? null,
            status: fresh.status ?? 'none',
            chargesEnabled: !!fresh.chargesEnabled,
            payoutsEnabled: !!fresh.payoutsEnabled,
            onboardedAt: fresh.onboardedAt ?? null,
            canSell: !!fresh.chargesEnabled,
          });
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

  const startOnboarding = async () => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'organizer-stripe-connect-onboard',
      );
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch (e: any) {
      toast.error(e?.message || "Erreur lors de l'onboarding Stripe");
    }
  };

  const openDashboard = async () => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-connect-dashboard',
        { body: { actor_type: 'organizer' } },
      );
      if (error) throw error;
      if (data?.url) window.open(data.url, '_blank');
      else if (data?.error) toast.error(data.error);
    } catch (e: any) {
      toast.error(e?.message || "Erreur d'ouverture du dashboard");
    }
  };

  return { ...data, loading, refresh, startOnboarding, openDashboard };
}
