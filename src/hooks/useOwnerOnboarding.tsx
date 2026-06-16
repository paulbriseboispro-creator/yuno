import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';
export type Pillar = 'tickets' | 'tables' | 'drinks';

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

// ─── New funnel (7 steps) ───────────────────────────────────────────────────
// 1 Welcome & pillars · 2 Basics · 3 Payments · 4 Offer (inline)
// 5 Polish (optional) · 6 Team (optional) · 7 Go live
export const TOTAL_STEPS = 7;
// Steps that must be completed to go live (5 & 6 are optional polish).
export const REQUIRED_STEPS = ['1', '2', '3', '4'];
export const OPTIONAL_STEPS = ['5', '6'];

const DEFAULT_STEPS: Record<string, StepState> = {
  '1': { status: 'not_started', completed_at: null },
  '2': { status: 'not_started', completed_at: null },
  '3': { status: 'not_started', completed_at: null },
  '4': { status: 'not_started', completed_at: null },
  '5': { status: 'not_started', completed_at: null },
  '6': { status: 'not_started', completed_at: null },
  '7': { status: 'not_started', completed_at: null },
};

export function readPillars(steps: Record<string, StepState> | undefined): Pillar[] {
  const raw = steps?.['1']?.metadata?.pillars;
  if (Array.isArray(raw)) return raw.filter((p): p is Pillar => p === 'tickets' || p === 'tables' || p === 'drinks');
  return [];
}

/**
 * Auto-detect which onboarding steps are already fulfilled from real venue
 * data, so a partly-configured venue never re-does work it already did.
 */
async function detectCompletedSteps(
  venueId: string,
  existingSteps: Record<string, StepState>,
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};

  const { data: venue } = await supabase
    .from('venues')
    .select(
      'name, city, address, cover_url, description, gallery_images, instagram_url, facebook_url, tiktok_url, siret, legal_name, stripe_account_id, is_hidden',
    )
    .eq('id', venueId)
    .single();

  if (!venue) return result;

  // Pillars come only from an explicit choice in step 1 — never inferred from
  // venue flags (menu_enabled defaults to true, which is not a real choice).
  const pillars = readPillars(existingSteps);

  // Step 1 — Welcome & pillars: at least one pillar explicitly chosen.
  result['1'] = pillars.length > 0;

  // Step 2 — Basics: name + city + address.
  result['2'] = !!(venue.name && venue.city && venue.address);

  // Step 3 — Payments: Stripe account connected.
  result['3'] = !!venue.stripe_account_id;

  // Step 4 — Offer: each chosen pillar has its minimal content.
  const [{ count: drinkCount }, { count: eventCount }] = await Promise.all([
    supabase.from('drinks').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
  ]);
  const drinksOk = !pillars.includes('drinks') || (drinkCount ?? 0) > 0;
  const eventOk = !(pillars.includes('tickets') || pillars.includes('tables')) || (eventCount ?? 0) > 0;
  result['4'] = pillars.length > 0 && drinksOk && eventOk;

  // Step 5 — Polish (optional): any branding/media present.
  const gallery = (venue.gallery_images as string[] | null) ?? [];
  result['5'] = !!(
    venue.cover_url ||
    venue.description ||
    gallery.length > 0 ||
    venue.instagram_url ||
    venue.facebook_url ||
    venue.tiktok_url ||
    venue.legal_name ||
    venue.siret
  );

  // Step 6 — Team (optional): at least one staff member with a PIN.
  const { count: staffCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .not('employee_pin', 'is', null);
  result['6'] = (staffCount ?? 0) > 0;

  // Step 7 — Go live: venue is visible.
  result['7'] = !venue.is_hidden;

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

      // If already complete, don't re-derive.
      if (completedAt) {
        setState({ id: onboardingId, venue_id: venueId, owner_id: ownerId, current_step: currentStep, steps, completed_at: completedAt });
        return;
      }

      const detected = await detectCompletedSteps(venueId, steps);
      let changed = false;

      for (const [stepKey, isDone] of Object.entries(detected)) {
        if (isDone && steps[stepKey]?.status !== 'completed' && steps[stepKey]?.status !== 'skipped') {
          steps[stepKey] = {
            status: 'completed',
            completed_at: new Date().toISOString(),
            metadata: { ...(steps[stepKey]?.metadata ?? {}), auto_detected: true },
          };
          changed = true;
        }
      }

      // Onboarding is "done" when every required step is completed AND go live happened.
      const allDone = [...REQUIRED_STEPS, '7'].every(
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

        const update: any = {
          steps,
          current_step: currentStep,
          updated_at: new Date().toISOString(),
        };
        if (completedAt) update.completed_at = completedAt;

        await supabase.from('venue_onboarding').update(update).eq('id', onboardingId);
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
    metadata?: Record<string, unknown>,
  ) => {
    if (!state) return;
    const newSteps = { ...state.steps };
    newSteps[String(stepNum)] = {
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      metadata: { ...(state.steps[String(stepNum)]?.metadata ?? {}), ...(metadata ?? {}) },
    };

    let newCurrentStep = state.current_step;
    if ((status === 'completed' || status === 'skipped') && stepNum === state.current_step) {
      newCurrentStep = Math.min(stepNum + 1, TOTAL_STEPS);
    }

    const isComplete = [...REQUIRED_STEPS, '7'].every(
      k => newSteps[k]?.status === 'completed' || newSteps[k]?.status === 'skipped',
    );

    const update: any = {
      steps: newSteps,
      current_step: newCurrentStep,
      updated_at: new Date().toISOString(),
    };
    if (isComplete) update.completed_at = new Date().toISOString();

    const { error } = await supabase.from('venue_onboarding').update(update).eq('id', state.id);
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
  const pillars = readPillars(stepStatuses);

  return {
    state,
    loading,
    currentStep,
    stepStatuses,
    pillars,
    isComplete,
    completeStep,
    skipStep,
    goToStep,
    refetch: fetchOnboarding,
  };
}
