import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { hasFeature as checkFeature, requiredPlan as getRequiredPlan, PlanCode, FeatureKey, PLANS } from '@/lib/planFeatures';

type BillingInterval = 'monthly' | 'annual';

interface SubscriptionPlanState {
  plan: PlanCode;
  status: string;
  loading: boolean;
  daysRemaining: number | null;
  isTrial: boolean;
  currentPeriodEnd: string | null;
  isEarlyAdopter: boolean;
  priceLocked: boolean;
  billingInterval: BillingInterval | null;
  hasFeature: (feature: FeatureKey) => boolean;
  requiredPlan: (feature: FeatureKey) => PlanCode;
  refreshPlan: () => Promise<void>;
}

const defaultState: SubscriptionPlanState = {
  plan: 'core',
  status: 'inactive',
  loading: true,
  daysRemaining: null,
  isTrial: false,
  currentPeriodEnd: null,
  isEarlyAdopter: false,
  priceLocked: false,
  billingInterval: null,
  hasFeature: () => false,
  requiredPlan: () => 'elite',
  refreshPlan: async () => {},
};

const SubscriptionPlanContext = createContext<SubscriptionPlanState>(defaultState);

export function SubscriptionPlanProvider({ venueId, children }: { venueId: string | null; children: ReactNode }) {
  const [plan, setPlan] = useState<PlanCode>('core');
  const [status, setStatus] = useState('inactive');
  const [loading, setLoading] = useState(true);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [isEarlyAdopter, setIsEarlyAdopter] = useState(false);
  const [priceLocked, setPriceLocked] = useState(false);
  const [billingInterval, setBillingInterval] = useState<BillingInterval | null>(null);

  const fetchPlan = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    try {
      // Comptes démo @womber.fr : plan Elite forcé, indépendant de Stripe / edge function
      // (l'edge function check-club-subscription est CORS-lock yunoapp.eu donc KO en local).
      const { data: { user: demoUser } } = await supabase.auth.getUser();
      if (demoUser?.email?.toLowerCase().endsWith('@womber.fr')) {
        setPlan('elite');
        setStatus('active');
        setIsTrial(false);
        setDaysRemaining(null);
        setCurrentPeriodEnd(null);
        setIsEarlyAdopter(false);
        setPriceLocked(false);
        setBillingInterval('monthly');
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke('club-subscription', {
        body: { action: 'check', venueId },
      });
      if (error) throw error;

      setPlan((data?.subscriptionPlan as PlanCode) || 'core');
      setStatus(data?.status || 'inactive');
      setIsTrial(data?.isTrial || false);
      setDaysRemaining(data?.daysRemaining ?? null);
      setCurrentPeriodEnd(data?.currentPeriodEnd || null);
      setIsEarlyAdopter(data?.isEarlyAdopter || false);
      setPriceLocked(data?.priceLocked || false);
      setBillingInterval((data?.billingInterval as BillingInterval) ?? null);
    } catch (e) {
      console.error('Error fetching subscription plan:', e);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const value: SubscriptionPlanState = {
    plan,
    status,
    loading,
    daysRemaining,
    isTrial,
    currentPeriodEnd,
    isEarlyAdopter,
    priceLocked,
    billingInterval,
    hasFeature: (feature: FeatureKey) => checkFeature(plan, feature),
    requiredPlan: getRequiredPlan,
    refreshPlan: fetchPlan,
  };

  return (
    <SubscriptionPlanContext.Provider value={value}>
      {children}
    </SubscriptionPlanContext.Provider>
  );
}

export function useSubscriptionPlan() {
  return useContext(SubscriptionPlanContext);
}
