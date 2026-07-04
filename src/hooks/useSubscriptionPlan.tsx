import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { hasFeature as checkFeature, requiredPlan as getRequiredPlan, PlanCode, FeatureKey, PLANS, SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { isDemoEmail, getDemoPlan, DEMO_PLAN_EVENT } from '@/lib/demoPlan';

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
      // Comptes démo @womber.fr : plan piloté par un override localStorage (voir
      // demoPlan.ts). Permet de switcher d'abonnement à la volée en démo de vente
      // sans Stripe ni edge function (CORS-lock yunoapp.eu). Défaut = Pro.
      const { data: { user: demoUser } } = await supabase.auth.getUser();
      if (isDemoEmail(demoUser?.email)) {
        setPlan(getDemoPlan());
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

  // Démo : le DemoSwitcher / la page billing changent le plan via un event
  // same-tab → on relit l'override et on met à jour le gate des features en direct.
  useEffect(() => {
    const handler = () => fetchPlan();
    window.addEventListener(DEMO_PLAN_EVENT, handler);
    return () => window.removeEventListener(DEMO_PLAN_EVENT, handler);
  }, [fetchPlan]);

  // Abonnement coupé (lancement) : tout club non-collab est servi comme Pro,
  // actif, sans essai. On garde le fetch ci-dessus uniquement pour détecter le
  // plan `collab` (garde-fous lecture seule + pas d'export CSV inchangés).
  const effectivePlan: PlanCode = SUBSCRIPTIONS_ENABLED || plan === 'collab' ? plan : 'pro';
  const value: SubscriptionPlanState = {
    plan: effectivePlan,
    status: SUBSCRIPTIONS_ENABLED ? status : 'active',
    loading,
    daysRemaining: SUBSCRIPTIONS_ENABLED ? daysRemaining : null,
    isTrial: SUBSCRIPTIONS_ENABLED ? isTrial : false,
    currentPeriodEnd: SUBSCRIPTIONS_ENABLED ? currentPeriodEnd : null,
    isEarlyAdopter: SUBSCRIPTIONS_ENABLED ? isEarlyAdopter : false,
    priceLocked: SUBSCRIPTIONS_ENABLED ? priceLocked : false,
    billingInterval: SUBSCRIPTIONS_ENABLED ? billingInterval : null,
    hasFeature: (feature: FeatureKey) => checkFeature(effectivePlan, feature),
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
