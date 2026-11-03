/**
 * Plans de soirée (migration 20261122100000) : lancer les envois acceptés de
 * « Qui cibler », suivre un plan, la page qui les liste. Tout chiffre vient du
 * serveur ; les brouillons sont les modèles de la Console (aucune IA).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { NightPlanRules } from '@/crm/lib/nightPlan';
import type { TemplateContent } from '@/lib/email/templates';

export type PlanStatus = 'setup' | 'active' | 'paused' | 'done' | 'stopped';

export interface PlanGroup { n: number; buyers: number; revenue?: number | null }
export interface PlanMeasure { z: number | null; extra: number | null }

export interface PlanCampaign {
  id: string; name: string; audience: string; status: string; paused_reason: string | null; subject: string | null;
  scheduled_at: string | null; sent_at: string | null;
  sent: number; pending: number; holdout: number; protected: Record<string, number>;
  opened: number; clicked: number; buyers: number;
  /** Étape 2 : retouché (Studio ou IA) ou gardé tel quel par le pro. */
  reviewed: boolean; edited_by: 'ai' | 'hand' | null; ai_author: string | null; updated_at: string;
}

export interface PlanEvent { id: string; title: string; start_at: string; cover_url: string | null }

export interface NightPlanState {
  ok: boolean;
  rules?: NightPlanRules;
  holdout_pct?: number;
  event?: PlanEvent;
  plan: null | {
    id: string; status: PlanStatus; stop_reason: string | null; cap: number;
    config: { audiences?: string[]; relance?: boolean; demo?: boolean; days_left?: number; cost?: number; reviewed?: string[] };
    created_at: string; updated_at: string;
    campaigns: PlanCampaign[];
    contacted: PlanGroup; control: PlanGroup; measure: PlanMeasure;
  };
}

export function useNightPlanState(eventId: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-plan-state', eventId],
    queryFn: () => rpc<NightPlanState>('crm_night_plan_get', { ...args, p_event_id: eventId }),
    enabled: !!eventId,
    staleTime: 4_000,
    // En préparation, les retouches du Studio ou de l'IA doivent apparaître seules.
    refetchInterval: (q) => (q.state.data?.plan?.status === 'setup' ? 5_000 : 60_000),
  });
}

export interface PlansListRow {
  event: PlanEvent; plan_id?: string; status?: PlanStatus; next_at?: string | null;
  contacted?: PlanGroup; control?: PlanGroup; campaigns?: number; sent?: number; days_left?: number;
}
export interface PlansList { ok: boolean; live: PlansListRow[]; todo: PlansListRow[]; past: PlansListRow[] }

export function useNightPlans() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-plans'],
    queryFn: () => rpc<PlansList>('crm_night_plans_list', { ...args }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Le contenu d'un brouillon tel que crm_night_plan_launch le reçoit. */
export function launchContent(c: TemplateContent, name: string, label: string, templateKind: string) {
  return {
    name, label, templateKind,
    subject: c.subject, preheader: c.preheader,
    blocks: c.blocks, theme: c.theme, socialLinks: c.socialLinks, logoUrl: c.logoUrl,
  };
}

export interface LaunchResult {
  ok: boolean; error?: string; missing?: string[]; needed?: number; balance?: number; plan_id?: string;
  campaigns?: { id: string; audience: string; moment: string; scheduled_at: string }[]; too_late?: string[]; demo?: boolean;
}

function useInvalidate() {
  const { qk } = useCrmScope();
  const qc = useQueryClient();
  return () => {
    for (const k of ['night-plan-state', 'night-plans', 'night-plan', 'night-targets', 'emails']) {
      qc.invalidateQueries({ queryKey: ['crm', qk, k] });
    }
  };
}

export function useReviewPlanCampaign() {
  const { rpc: args } = useCrmScope();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { planId: string; campaignId: string; reviewed: boolean }) =>
      rpc<{ ok: boolean }>('crm_night_plan_review', { ...args, p_plan_id: p.planId, p_campaign_id: p.campaignId, p_reviewed: p.reviewed }),
    onSuccess: invalidate,
  });
}

export interface ScheduleResult { ok: boolean; error?: string; missing?: string[]; needed?: number; balance?: number; scheduled?: number; too_late?: string[]; demo?: boolean }

export function useScheduleNightPlan() {
  const { rpc: args } = useCrmScope();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { planId: string }) => rpc<ScheduleResult>('crm_night_plan_schedule', { ...args, p_plan_id: p.planId }),
    onSuccess: invalidate,
  });
}

/** Étape 1 → 2 : Yuno crée les brouillons (rien n'est programmé). */
export function useLaunchNightPlan() {
  const { rpc: args } = useCrmScope();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { eventId: string; audiences: string[]; contents: Record<string, unknown> }) =>
      rpc<LaunchResult>('crm_night_plan_launch', {
        ...args, p_event_id: p.eventId, p_audiences: p.audiences, p_contents: p.contents, p_config: {},
      }, { timeoutMs: 60_000 }),
    onSuccess: invalidate,
  });
}

export function useSetNightPlanStatus() {
  const { rpc: args } = useCrmScope();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { planId: string; status: 'paused' | 'active' | 'stopped' }) =>
      rpc<{ ok: boolean; error?: string }>('crm_night_plan_set_status', { ...args, p_plan_id: p.planId, p_status: p.status }),
    onSuccess: invalidate,
  });
}

/** Décaler un e-mail du plan (il reste programmé), ou le retenir (brouillon). */
export function usePlanCampaignEdit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (p: { id: string; at?: string; hold?: boolean }) => {
      const patch = p.hold ? { status: 'draft' } : { scheduled_at: p.at, status: 'scheduled' };
      const q = supabase.from('email_campaigns').update(patch as never).eq('id', p.id);
      const { data, error } = await (p.hold ? q.eq('status', 'scheduled') : q.in('status', ['scheduled', 'draft'])).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('too_late');
    },
    onSuccess: invalidate,
  });
}
