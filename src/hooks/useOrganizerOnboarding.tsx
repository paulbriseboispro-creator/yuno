import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export interface StepState {
  status: StepStatus;
  completed_at: string | null;
  metadata?: Record<string, unknown>;
}

export interface OrganizerOnboardingState {
  id: string;
  user_id: string;
  current_step: number;
  steps: Record<string, StepState>;
  completed_at: string | null;
}

// ─── Fast-path order ────────────────────────────────────────────────────────
// 1 Welcome · 2 Payments (Stripe) · 3 First event · 4 Public profile (optional)
// 5 Team (optional) · 6 Tour. Value first (sell), polish later.
export const TOTAL_STEPS = 6;
export const OPTIONAL_STEPS = ['4', '5'];

const DEFAULT_STEPS: Record<string, StepState> = {
  '1': { status: 'not_started', completed_at: null },
  '2': { status: 'not_started', completed_at: null },
  '3': { status: 'not_started', completed_at: null },
  '4': { status: 'not_started', completed_at: null },
  '5': { status: 'not_started', completed_at: null },
  '6': { status: 'not_started', completed_at: null },
};

/**
 * Detect already-fulfilled steps from real data, so an organizer who
 * has set things up before never has to do them twice.
 */
async function detectCompletedSteps(userId: string): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_name, city, organization_logo_url, stripe_connect_account_id')
    .eq('id', userId)
    .maybeSingle();

  const { data: orgProfile } = await supabase
    .from('organizer_profiles')
    .select('bio, avatar_url, cover_url, instagram_url, website_url')
    .eq('user_id', userId)
    .maybeSingle();

  // Step 1 — Welcome: org name + city.
  result['1'] = !!(profile?.organization_name && profile?.city);

  // Step 2 — Payments: Stripe Connect account exists.
  result['2'] = !!profile?.stripe_connect_account_id;

  // Step 3 — First event created.
  const eventsQuery: any = supabase.from('events').select('id', { count: 'exact', head: true });
  const { count: eventCount } = await eventsQuery.or(
    `organizer_user_id.eq.${userId},partner_organizer_id.eq.${userId}`,
  );
  result['3'] = (eventCount ?? 0) > 0;

  // Step 4 — Public profile (optional): any identity/branding present.
  result['4'] = !!(
    profile?.organization_logo_url ||
    orgProfile?.avatar_url ||
    orgProfile?.cover_url ||
    orgProfile?.bio ||
    orgProfile?.instagram_url ||
    orgProfile?.website_url
  );

  // Step 5 — Team (optional): at least one accepted member.
  const membersQuery: any = supabase.from('org_members').select('id', { count: 'exact', head: true });
  const { count: memberCount } = await membersQuery
    .eq('organizer_user_id', userId)
    .eq('invitation_status', 'accepted');
  result['5'] = (memberCount ?? 0) > 0;

  // Step 6 — Tour: only marked when explicitly finished, never auto-detected.
  result['6'] = false;

  return result;
}

export function useOrganizerOnboarding(userId: string | null) {
  const [state, setState] = useState<OrganizerOnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnboarding = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('organizer_onboarding')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      let steps: Record<string, StepState>;
      let onboardingId: string;
      let currentStep: number;
      let completedAt: string | null;

      if (data) {
        const existing = (data.steps as unknown as Record<string, StepState>) || {};
        steps = { ...DEFAULT_STEPS, ...existing };
        onboardingId = data.id;
        currentStep = data.current_step ?? 1;
        completedAt = data.completed_at;
      } else {
        const { data: created, error: createErr } = await supabase
          .from('organizer_onboarding')
          .insert({
            user_id: userId,
            current_step: 1,
            steps: DEFAULT_STEPS,
          } as any)
          .select()
          .single();
        if (createErr) throw createErr;
        if (!created) return;
        steps = { ...DEFAULT_STEPS };
        onboardingId = created.id;
        currentStep = 1;
        completedAt = null;
      }

      if (completedAt) {
        setState({ id: onboardingId, user_id: userId, current_step: currentStep, steps, completed_at: completedAt });
        return;
      }

      const detected = await detectCompletedSteps(userId);
      let changed = false;
      for (const [key, isDone] of Object.entries(detected)) {
        if (isDone && steps[key]?.status !== 'completed' && steps[key]?.status !== 'skipped') {
          steps[key] = { status: 'completed', completed_at: new Date().toISOString(), metadata: { auto_detected: true } };
          changed = true;
        }
      }

      const allDone = Object.keys(DEFAULT_STEPS).every(
        k => steps[k]?.status === 'completed' || steps[k]?.status === 'skipped',
      );
      if (allDone) {
        completedAt = new Date().toISOString();
        changed = true;
      }

      if (changed) {
        const firstIncomplete = Object.keys(DEFAULT_STEPS)
          .map(Number)
          .sort((a, b) => a - b)
          .find(n => steps[String(n)]?.status !== 'completed' && steps[String(n)]?.status !== 'skipped');
        currentStep = firstIncomplete ?? TOTAL_STEPS;

        const update: any = { steps, current_step: currentStep, updated_at: new Date().toISOString() };
        if (completedAt) update.completed_at = completedAt;

        await supabase.from('organizer_onboarding').update(update).eq('id', onboardingId);
      }

      setState({ id: onboardingId, user_id: userId, current_step: currentStep, steps, completed_at: completedAt });
    } catch (e) {
      console.error('Error loading organizer onboarding:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchOnboarding();
  }, [fetchOnboarding]);

  const updateStep = useCallback(async (
    stepNum: number,
    status: StepStatus,
    metadata?: Record<string, unknown>,
  ) => {
    if (!state) return;
    const newSteps = { ...state.steps };
    newSteps[String(stepNum)] = {
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      ...(metadata ? { metadata } : {}),
    };

    let newCurrentStep = state.current_step;
    if ((status === 'completed' || status === 'skipped') && stepNum === state.current_step) {
      newCurrentStep = Math.min(stepNum + 1, TOTAL_STEPS);
    }

    const isComplete = Object.keys(DEFAULT_STEPS).every(
      k => newSteps[k]?.status === 'completed' || newSteps[k]?.status === 'skipped',
    );

    const update: any = {
      steps: newSteps,
      current_step: newCurrentStep,
      updated_at: new Date().toISOString(),
    };
    if (isComplete) update.completed_at = new Date().toISOString();

    const { error } = await supabase.from('organizer_onboarding').update(update).eq('id', state.id);
    if (error) {
      console.error('Error updating organizer onboarding step:', error);
      return;
    }

    // When all done, also mark profile as onboarded so the route guard releases.
    if (isComplete && userId) {
      await supabase.from('profiles').update({ onboarding_completed: true } as any).eq('id', userId);
    }

    setState(prev => prev ? {
      ...prev,
      steps: newSteps,
      current_step: newCurrentStep,
      completed_at: isComplete ? update.completed_at : prev.completed_at,
    } : null);
  }, [state, userId]);

  const completeStep = useCallback((step: number, metadata?: Record<string, unknown>) =>
    updateStep(step, 'completed', metadata), [updateStep]);

  const skipStep = useCallback((step: number) => updateStep(step, 'skipped'), [updateStep]);

  const goToStep = useCallback(async (step: number) => {
    if (!state) return;
    const { error } = await supabase
      .from('organizer_onboarding')
      .update({ current_step: step, updated_at: new Date().toISOString() } as any)
      .eq('id', state.id);
    if (!error) setState(prev => prev ? { ...prev, current_step: step } : null);
  }, [state]);

  const isComplete = !!state?.completed_at;
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
    totalSteps: TOTAL_STEPS,
  };
}
