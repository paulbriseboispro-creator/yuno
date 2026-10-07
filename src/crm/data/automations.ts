/**
 * Données de l'écran Automatisations (migration 20261005110000) : une
 * lecture (`crm_automations`) rafraîchie chaque minute pour le fil des
 * derniers envois, une écriture (`crm_automation_save`) pour allumer, couper
 * ou régler une recette, et la création du modèle CRM d'une recette qui n'en
 * a pas encore (sans modèle, rien ne part).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import { buildCrmTemplate } from '@/crm/lib/emailTemplates';
import { stripEventBindings, templateContentToRow } from '@/lib/email/templates';
import { CRM_AUTO_META, type CrmAutoKind } from '@/crm/lib/automations';
import type { CrmLang } from '@/crm/i18n';

export type AutoPeriod = '30d' | '90d';

export interface AutoPreview {
  eligible: number;
  base: number;
  next_event_id: string | null;
  next_event_title: string | null;
  next_due_at: string | null;
}

export interface AutoRecipe {
  kind: CrmAutoKind;
  id: string | null;
  enabled: boolean;
  enabled_at: string | null;
  updated_at: string | null;
  delay_hours: number | null;
  subject: string | null;
  template_id: string | null;
  template_name: string | null;
  template_subject: string | null;
  contacted: number;
  sent: number;
  clicked: number;
  purchases: number;
  /** Null pour un rôle sans accès au chiffre d'affaires. */
  revenue: number | null;
  all: { contacted: number; purchases: number; revenue: number | null };
  /** Envois des 13 dernières semaines, la plus ancienne d'abord. */
  weekly: number[];
  /** Envois par semaine, moyenne des 4 dernières. */
  week_avg: number;
  last_sent_at: string | null;
  pending: number;
  skipped: number;
  preview: AutoPreview;
  /** « 1re soirée » : délai en jours, calé sur le délai médian de retour du compte. */
  auto_delay_days?: number | null;
  /** « 1re soirée » : l'étape SMS qui suit l'e-mail. */
  sms?: AutoSms | null;
}

export interface AutoSms { enabled: boolean; body: string | null; delay_days: number; sent: number; identity_ok: boolean }

export interface AutoWeek { start: string; revenue: number | null; purchases: number; sent: number; contacted: number }
export interface AutoTotals { sent: number; contacted?: number; clicked: number; purchases: number; revenue: number | null; recipes?: number }
export interface AutoFeedRow { first_name: string | null; last_initial: string | null; kind: CrmAutoKind; subject: string | null; at: string }
export interface AutoSuggestion { kind: CrmAutoKind; reason_key: string; reason_vars: Record<string, string | number>; reach: number }

export interface Automations {
  period: AutoPeriod;
  weeks_n: number;
  from: string;
  now: string;
  recipes: AutoRecipe[];
  weeks: AutoWeek[];
  totals: AutoTotals;
  prev: AutoTotals;
  feed: AutoFeedRow[];
  suggestions: AutoSuggestion[];
  /** Plafond de l'offre ; null = sans limite. */
  limit: number | null;
  active: number;
  base: number;
  has_connection: boolean;
}

export function useAutomations(period: AutoPeriod) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'automations', period],
    queryFn: () => rpc<Automations>('crm_automations', { ...a, p_period: period }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export interface SaveAutomation {
  kind: CrmAutoKind;
  enabled?: boolean;
  delayHours?: number;
  /** '' efface l'objet propre à la recette (l'objet du modèle reprend). */
  subject?: string;
  templateId?: string;
}

export function useSaveAutomation() {
  const { rpc: a, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: SaveAutomation) => rpc<{ id: string; enabled: boolean }>('crm_automation_save', {
      ...a,
      p_kind: p.kind,
      p_enabled: p.enabled ?? null,
      p_delay_hours: p.delayHours ?? null,
      p_subject: p.subject ?? null,
      p_template_id: p.templateId ?? null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', qk, 'automations'] }); },
  });
}

export function useSaveAutomationSms() {
  const { rpc: a, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { kind: CrmAutoKind; enabled: boolean; body: string; delayDays: number }) =>
      rpc('crm_automation_sms_save', { ...a, p_kind: p.kind, p_enabled: p.enabled, p_body: p.body, p_delay_days: p.delayDays }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', qk, 'automations'] }); },
  });
}

/**
 * Crée le modèle CRM d'une recette (constructeur de l'écran Modèles, sans
 * soirée figée : le moteur relie la soirée à chaque envoi). Rend son id.
 */
export async function createAutomationTemplate(p: {
  kind: CrmAutoKind; venueId: string | null; organizerUserId: string | null; venueName: string; lang: CrmLang;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<string> {
  const content = buildCrmTemplate(CRM_AUTO_META[p.kind].tpl, { venueName: p.venueName, lang: p.lang, t: p.t, night: null });
  const { data: auth } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    ...templateContentToRow({ ...content, blocks: stripEventBindings(content.blocks) }),
    name: p.t(`yc.au.r.${p.kind}.name`).slice(0, 80),
    description: p.t(`yc.au.r.${p.kind}.desc`).slice(0, 240),
    created_by: auth.user?.id ?? null,
  };
  if (p.venueId) row.venue_id = p.venueId; else row.organizer_user_id = p.organizerUserId;
  const { data, error } = await supabase.from('email_campaign_templates').insert(row as never).select('id').single();
  if (error || !data) throw error ?? new Error('template');
  return (data as { id: string }).id;
}
