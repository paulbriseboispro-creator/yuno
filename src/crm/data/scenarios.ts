/**
 * Données des Scénarios (migrations 20261016100000 → 140000) : la liste, un
 * scénario (brouillon + version en ligne), l'enregistrement du brouillon, la
 * publication, la pause, les effectifs en direct d'une condition (la MÊME
 * compilation que l'envoi), « Avant de publier », le rapport, et les tests
 * gratuits d'un message (send-campaign / send-sms-campaign lisent le
 * brouillon ENREGISTRÉ : on enregistre avant de tester).
 */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import { buildCrmTemplate, type CrmTemplateKind } from '@/crm/lib/emailTemplates';
import { stripEventBindings, templateContentToRow } from '@/lib/email/templates';
import type { GraphStats, ScenarioGraph } from '@/crm/lib/scenarioGraph';
import type { CondContext } from '@/crm/lib/scenarioConditions';
import type { CrmLang } from '@/crm/i18n';
import { invokeSms } from './sms';

export type ScnStatus = 'draft' | 'active' | 'paused' | 'archived';
/** L'état affiché : un scénario actif d'un compte gelé ou en pause est EN PAUSE, jamais en erreur. */
export type ScnState = ScnStatus | 'frozen' | 'plan_paused';

/** Une erreur ou un avertissement de validation (forme, ou contenu lu en base). */
export interface ScnIssue { code: string; node: string | null; field: string | null }

export interface ScnHoldout {
  done: boolean;
  contacted: { n: number; buyers: number };
  control: { n: number; buyers: number };
  extra: number | null;
  z: number | null;
  /** Compte démo : rien n'est parti, pas de comparaison (écart et z restent vides). */
  demo?: boolean;
}

export interface ScnRow {
  id: string; name: string; status: ScnStatus; state: ScnState; trigger: string | null;
  source_kind: string | null; template: string | null; version: number; has_changes: boolean;
  published_at: string | null; updated_at: string;
  /** L'IA connectée qui a préparé ce brouillon (MCP), sinon null. */
  ai_author?: string | null;
  entered: number; active: number; goal: number; holdout: number; goal_holdout: number;
  measure: ScnHoldout;
}

export interface ScnList { can_edit: boolean; can_publish: boolean; scenarios: ScnRow[] }

export interface ScnDetail {
  id: string; name: string; status: ScnStatus; state: ScnState;
  draft: ScenarioGraph; draft_updated_at: string; version: number;
  source_kind: string | null; template: string | null;
  ai_author?: string | null; ai_updated_at?: string | null;
  live: { id: string; version: number; graph: ScenarioGraph; published_at: string } | null;
  has_changes: boolean; published_at: string | null; paused_at: string | null; archived_at: string | null;
  errors: ScnIssue[]; warnings: ScnIssue[]; stats: GraphStats;
  rates: { email: number; sms: { fr: number; intl: number } };
  can_edit: boolean; can_publish: boolean;
}

export interface ScnCounts { total: number; groups: Record<string, number | null>; errors: { code: string; path: string }[] }

export interface ScnPreview {
  errors: ScnIssue[]; warnings: ScnIssue[]; stats: GraphStats;
  now: { candidates: number; entered: number; holdout_pct?: number } | null;
  week: { estimate: number | null; basis: 'events' | 'signups' | 'absence' | 'clicks' | null };
  cost: { email: number; sms_fr: number; sms_intl: number; sms_segments: number; max_emails: number; max_sms: number; max_fr: number; max_intl: number };
  holdout_pct: number;
  can_publish: boolean;
}

export interface ScnNodeStats {
  entered: number; passed: number; sent: number; would_send: number; holdout: number; goal: number; held: number;
  opened: number; clicked: number; reasons: Record<string, number>;
}

export interface ScnReport {
  id: string; state: ScnState;
  nodes: Record<string, ScnNodeStats>;
  holdout: ScnHoldout;
  exits: Record<string, number>;
  /** Null sans l'accès à l'argent (le CA). */
  attributed: { purchases: number; revenue: number | null } | null;
  holdout_pct: number;
}

export function useScenarios() {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'scenarios'],
    queryFn: () => rpc<ScnList>('crm_scenarios', a),
    staleTime: 30_000,
  });
}

export function useScenario(id: string | null) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'scenario', id],
    enabled: !!id,
    queryFn: () => rpc<ScnDetail>('crm_scenario', { ...a, p_id: id }),
    staleTime: 0,
    // L'éditeur tient son brouillon en mémoire : pas de relecture au retour sur l'onglet.
    refetchOnWindowFocus: false,
  });
}

/** Effectif en direct de chaque groupe d'une condition (null : « au lancement »). */
export function useScenarioCounts(tree: unknown, eventId: string | null, ctx: CondContext, enabled: boolean) {
  const { rpc: a, qk } = useCrmScope();
  const key = JSON.stringify(tree ?? null);
  return useQuery({
    queryKey: ['crm', qk, 'scenario-counts', key, eventId, ctx],
    enabled: enabled && !!tree,
    queryFn: () => rpc<ScnCounts>('crm_scenario_counts', { ...a, p_tree: tree, p_event: eventId, p_ctx: ctx }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useScenarioPreview(id: string | null, enabled: boolean) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'scenario', id, 'preview'],
    enabled: enabled && !!id,
    queryFn: () => rpc<ScnPreview>('crm_scenario_preview', { ...a, p_id: id }),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useScenarioReport(id: string | null, enabled: boolean) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'scenario', id, 'report'],
    enabled: enabled && !!id,
    queryFn: () => rpc<ScnReport>('crm_scenario_report', { ...a, p_id: id }),
    staleTime: 30_000,
  });
}

export interface ScnSaved { id: string; draft_updated_at: string; status: ScnStatus }

export function useScenarioActions() {
  const { rpc: a, qk } = useCrmScope();
  const qc = useQueryClient();
  const refreshList = () => qc.invalidateQueries({ queryKey: ['crm', qk, 'scenarios'] });
  return {
    /** Crée (id null) ou enregistre le brouillon. `expected` = draft_updated_at lu (sinon `draft_changed`). */
    save: async (p: { id: string | null; name: string; graph: ScenarioGraph; expected?: string | null; sourceKind?: string | null; template?: string | null }) => {
      const r = await rpc<ScnSaved>('crm_scenario_save', {
        ...a, p_id: p.id, p_name: p.name, p_graph: p.graph, p_expected: p.expected ?? null,
        p_source_kind: p.sourceKind ?? null, p_template: p.template ?? null,
      });
      void refreshList();
      return r;
    },
    publish: async (id: string, expected: string | null) => {
      const r = await rpc<{ ok: boolean; errors?: ScnIssue[]; warnings?: ScnIssue[]; version?: number }>('crm_scenario_publish', { ...a, p_id: id, p_expected: expected });
      void refreshList();
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'scenario', id] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'automations'] });
      return r;
    },
    setStatus: async (id: string, status: 'active' | 'paused' | 'archived') => {
      const r = await rpc<{ id: string; status: ScnStatus }>('crm_scenario_set_status', { ...a, p_id: id, p_status: status });
      void refreshList();
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'scenario', id] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'automations'] });
      return r;
    },
    remove: async (id: string) => {
      await rpc('crm_scenario_delete', { ...a, p_id: id });
      void refreshList();
    },
    duplicate: async (id: string, name?: string) => {
      const r = await rpc<{ id: string }>('crm_scenario_duplicate', { ...a, p_id: id, p_name: name ?? null });
      void refreshList();
      return r.id;
    },
  };
}

/** Un modèle d'e-mail CRM pour une étape de scénario (sans soirée figée : le moteur la relie à l'envoi). */
export async function createScenarioEmail(p: {
  kind: CrmTemplateKind; name: string; venueId: string | null; organizerUserId: string | null; venueName: string; lang: CrmLang;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<string> {
  const content = buildCrmTemplate(p.kind, { venueName: p.venueName, lang: p.lang, t: p.t, night: null });
  const { data: auth } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    ...templateContentToRow({ ...content, blocks: stripEventBindings(content.blocks) }),
    name: p.name.slice(0, 80),
    created_by: auth.user?.id ?? null,
  };
  if (p.venueId) row.venue_id = p.venueId; else row.organizer_user_id = p.organizerUserId;
  const { data, error } = await supabase.from('email_campaign_templates').insert(row as never).select('id').single();
  if (error || !data) throw error ?? new Error('template');
  return (data as { id: string }).id;
}

/** Les modèles d'e-mail du compte (choix de l'e-mail d'une étape). */
export function useScenarioEmailTemplates() {
  const { space, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'scenario-email-templates'],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from('email_campaign_templates').select('id, name, subject, updated_at').order('updated_at', { ascending: false }).limit(200);
      q = space.venueId ? q.eq('venue_id', space.venueId) : q.is('venue_id', null).eq('organizer_user_id', space.organizerUserId as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; subject: string | null; updated_at: string }[];
    },
  });
}

/** `code` quand le test n'est pas parti : 'demo' (compte de démonstration) ou 'failed'. */
export interface ScnTestResult { ok: boolean; code?: 'demo' | 'failed' }

/** Test gratuit d'un e-mail de scénario (au titulaire et aux adresses de test). */
export async function testScenarioEmail(scenarioId: string, nodeId: string, eventId: string | null): Promise<ScnTestResult> {
  const { data, error } = await supabase.functions.invoke('send-campaign', {
    body: { send_test: true, scenario_id: scenarioId, node_id: nodeId, event_id: eventId },
  });
  const code = (data as { code?: string } | null)?.code;
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (code === 'demo_no_send' || status === 409) return { ok: false, code: 'demo' };
  if (error) return { ok: false, code: 'failed' };
  return { ok: true };
}

/** Test gratuit d'un SMS de scénario (numéro de test des Réglages SMS, sinon celui du compte). */
export async function testScenarioSms(scenarioId: string, nodeId: string, eventId: string | null): Promise<Record<string, unknown>> {
  return invokeSms({ mode: 'test', scenario_id: scenarioId, node_id: nodeId, event_id: eventId });
}

/** Le code d'erreur d'une écriture de scénario (`draft_changed`, `support_session`, `scenario_covers_recipe`…). */
export function scnErrorCode(e: unknown): string {
  const m = String((e as Error | null)?.message ?? e ?? '');
  for (const c of ['draft_changed', 'support_session', 'never_published', 'archived', 'published', 'graph_too_large', 'bad_name', 'forbidden', 'timeout', 'scenario_covers_recipe']) {
    if (m.includes(c)) return c;
  }
  return 'generic';
}
