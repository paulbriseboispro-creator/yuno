import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { hasFeature as checkFeature, requiredPlan as getRequiredPlan, priceIdToPlan, PlanCode, FeatureKey, PLANS } from '@/lib/planFeatures';

interface SubscriptionPlanState {
  plan: PlanCode;
  status: string;
  loading: boolean;
  daysRemaining: number | null;
  isTrial: boolean;
  currentPeriodEnd: string | null;
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

  const fetchPlan = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('check-club-subscription', {
        body: { venueId },
      });
      if (error) throw error;
      
      setPlan((data?.subscriptionPlan as PlanCode) || 'core');
      setStatus(data?.status || 'inactive');
      setIsTrial(data?.isTrial || false);
      setDaysRemaining(data?.daysRemaining ?? null);
      setCurrentPeriodEnd(data?.currentPeriodEnd || null);
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
