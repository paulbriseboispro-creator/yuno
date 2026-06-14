import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export interface StepState {
  status: StepStatus;
  completed_at: string | null;
  metadata?: Record<string, unknown>;
}

export interface OnboardingState {
  id: string;
  venue_id: string;
  owner_id: string;
  current_step: number;
  steps: Record<string, StepState>;
  completed_at: string | null;
}

const TOTAL_STEPS = 9;

const DEFAULT_STEPS: Record<string, StepState> = {
  '1': { status: 'not_started', completed_at: null },
  '2': { status: 'not_started', completed_at: null },
  '3': { status: 'not_started', completed_at: null },
  '4': { status: 'not_started', completed_at: null },
  '5': { status: 'not_started', completed_at: null },
  '6': { status: 'not_started', completed_at: null },
  '7': { status: 'not_started', completed_at: null },
  '8': { status: 'not_started', completed_at: null },
  '9': { status: 'not_started', completed_at: null },
};

/**
 * Auto-detect which onboarding steps are already fulfilled
 * by checking actual venue data, regardless of the onboarding wizard.
 */
async function detectCompletedSteps(venueId: string): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};

  // Fetch venue data
  const { data: venue } = await supabase
    .from('venues')
    .select('name, city, address, logo_url, cover_url, instagram_url, facebook_url, tiktok_url, siret, legal_name, stripe_account_id, stripe_charges_enabled')
    .eq('id', venueId)
    .single();

  if (!venue) return result;

  // Step 1 — Basics: name + city + address
  result['1'] = !!(venue.name && venue.city && venue.address);

  // Step 2 — Design & Photos: logo or cover uploaded
  result['2'] = !!(venue.logo_url || venue.cover_url);

  // Step 3 — Branding / Socials / Billing: at least one social link or legal info
  result['3'] = !!(venue.instagram_url || venue.facebook_url || venue.tiktok_url || venue.siret || venue.legal_name);

  // Step 4 — Stripe: account connected
  result['4'] = !!(venue.stripe_account_id);

  // Step 5 — Staff: at least one employee profile linked to this venue
  const { count: staffCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .neq('id', venue.name); // just count — the neq is a no-op trick to avoid owner

  // Better: check user_roles for staff roles linked to this venue
  const { count: staffRoles } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  result['5'] = (staffRoles ?? 0) > 1; // more than just the owner

  // Step 6 — Menu: at least one drink
  const { count: drinkCount } = await supabase
    .from('drinks')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  result['6'] = (drinkCount ?? 0) > 0;

  // Step 7 — Event: at least one event created
  const { count: eventCount } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  result['7'] = (eventCount ?? 0) > 0;

  // Step 8 — Preview: auto-complete if steps 1-7 are done
  const steps1to7Done = ['1', '2', '3', '4', '5', '6', '7'].every(k => result[k]);
  result['8'] = steps1to7Done;

  // Step 9 — Go Live: if venue is not hidden (is live)
  const { data: venueVisibility } = await supabase
    .from('venues')
    .select('is_hidden')
    .eq('id', venueId)
    .single();
  result['9'] = venueVisibility ? !venueVisibility.is_hidden : false;

  return result;
}

export function useOwnerOnboarding(venueId: string | null) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnboarding = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('venue_onboarding')
        .select('*')
        .eq('venue_id', venueId)
        .maybeSingle();

      if (error) throw error;

      let steps: Record<string, StepState>;
      let onboardingId: string;
      let ownerId: string;
      let currentStep: number;
      let completedAt: string | null;

      if (data) {
        const existingSteps = (data.steps as unknown as Record<string, StepState>) || {};
        steps = { ...DEFAULT_STEPS, ...existingSteps };
        onboardingId = data.id;
        ownerId = data.owner_id;
        currentStep = data.current_step ?? 1;
        completedAt = data.completed_at;
      } else {
        // Auto-create onboarding row
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: created, error: createErr } = await supabase
          .from('venue_onboarding')
          .insert({
            venue_id: venueId,
            owner_id: user.id,
            current_step: 1,
            steps: DEFAULT_STEPS,
          } as any)
          .select()
          .single();

        if (createErr) throw createErr;
        if (!created) return;

        steps = { ...DEFAULT_STEPS };
        onboardingId = created.id;
        ownerId = created.owner_id;
        currentStep = 1;
        completedAt = null;
      }

      // If already marked complete, skip detection
      if (completedAt) {
        setState({ id: onboardingId, venue_id: venueId, owner_id: ownerId, current_step: currentStep, steps, completed_at: completedAt });
        return;
      }

      // Auto-detect completed steps from actual data
      const detected = await detectCompletedSteps(venueId);
      let changed = false;

      for (const [stepKey, isDone] of Object.entries(detected)) {
        if (isDone && steps[stepKey]?.status !== 'completed' && steps[stepKey]?.status !== 'skipped') {
          steps[stepKey] = { status: 'completed', completed_at: new Date().toISOString(), metadata: { auto_detected: true } };
          changed = true;
        }
      }

      // Check if all steps are now complete
      const allDone = Object.keys(DEFAULT_STEPS).every(
        k => steps[k]?.status === 'completed' || steps[k]?.status === 'skipped'
      );

      if (allDone) {
        completedAt = new Date().toISOString();
        changed = true;
      }

      // Advance current_step to first incomplete step
      if (changed) {
        const firstIncomplete = Object.keys(DEFAULT_STEPS)
          .map(Number)
          .sort((a, b) => a - b)
          .find(n => steps[String(n)]?.status !== 'completed' && steps[String(n)]?.status !== 'skipped');
        currentStep = firstIncomplete ?? TOTAL_STEPS;

        // Persist the auto-detected changes
        const update: any = {
          steps,
          current_step: currentStep,
          updated_at: new Date().toISOString(),
        };
        if (completedAt) update.completed_at = completedAt;

        await supabase
          .from('venue_onboarding')
          .update(update)
          .eq('id', onboardingId);
      }

      setState({
        id: onboardingId,
        venue_id: venueId,
        owner_id: ownerId,
        current_step: currentStep,
        steps,
        completed_at: completedAt,
      });
    } catch (e) {
      console.error('Error loading onboarding:', e);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchOnboarding();
  }, [fetchOnboarding]);

  const updateStep = useCallback(async (
    stepNum: number,
    status: StepStatus,
    metadata?: Record<string, unknown>
  ) => {
    if (!state) return;
    const newSteps = { ...state.steps };
    newSteps[String(stepNum)] = {
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      ...(metadata ? { metadata } : {}),
    };

    // Determine next step
    let newCurrentStep = state.current_step;
    if ((status === 'completed' || status === 'skipped') && stepNum === state.current_step) {
      newCurrentStep = Math.min(stepNum + 1, TOTAL_STEPS);
    }

    // Check if all done
    const isComplete = Object.keys(DEFAULT_STEPS).every(
      k => newSteps[k]?.status === 'completed' || newSteps[k]?.status === 'skipped'
    );

    const update: any = {
      steps: newSteps,
      current_step: newCurrentStep,
      updated_at: new Date().toISOString(),
    };
    if (isComplete) update.completed_at = new Date().toISOString();

    const { error } = await supabase
      .from('venue_onboarding')
      .update(update)
      .eq('id', state.id);

    if (error) {
      console.error('Error updating onboarding step:', error);
      return;
    }

    setState(prev => prev ? {
      ...prev,
      steps: newSteps,
      current_step: newCurrentStep,
      completed_at: isComplete ? update.completed_at : prev.completed_at,
    } : null);
  }, [state]);

  const completeStep = useCallback((step: number, metadata?: Record<string, unknown>) => {
    return updateStep(step, 'completed', metadata);
  }, [updateStep]);

  const skipStep = useCallback((step: number) => {
    return updateStep(step, 'skipped');
  }, [updateStep]);

  const goToStep = useCallback(async (step: number) => {
    if (!state) return;
    const { error } = await supabase
      .from('venue_onboarding')
      .update({ current_step: step, updated_at: new Date().toISOString() } as any)
      .eq('id', state.id);
    if (!error) {
      setState(prev => prev ? { ...prev, current_step: step } : null);
    }
  }, [state]);

  const isComplete = state?.completed_at !== null && state?.completed_at !== undefined;
  const currentStep = state?.current_step ?? 1;
  const stepStatuses = state?.steps ?? DEFAULT_STEPS;

  return {
    state,
    loading,
    currentStep,
    stepStatuses,
    isComplete,
    completeStep,
    skipStep,
    goToStep,
    refetch: fetchOnboarding,
  };
}
