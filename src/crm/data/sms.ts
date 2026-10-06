/**
 * Données de la suite SMS de la Console CRM : vue d'ensemble, campagnes,
 * résultats d'un SMS, analyse, audience, brouillons, réglages d'envoi.
 * Une seule définition des chiffres : _crm_sms_stats (migration
 * 20261005120000_crm_sms.sql) — remis, clics du lien suivi, achats dans les
 * 7 jours après le SMS, STOP.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { CrmAudience } from './emails';

export interface SmsStats {
  n: number; delivered: number; failed: number; clicked: number;
  purchases: number; buyers: number; revenue: number | null; stop: number; parts: number;
}

export type SmsStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed' | 'cancelled';

export interface SmsCampaignRow {
  id: string;
  name: string | null;
  body: string | null;
  sender_name: string | null;
  status: SmsStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  updated_at: string;
  created_at: string;
  event_id: string | null;
  event_title: string | null;
  audiences: CrmAudience[];
  /** Le modèle d'origine (lastcall, rappel…), s'il y en a un. */
  tpl: string | null;
  exclude_buyers: boolean;
  recent_days: number | null;
  waves: boolean;
  quiet_hours: boolean;
  estimated: number;
  parts: number;
  paused_reason: string | null;
  /** Envoi en cours : SMS partis sur le total de la file. */
  sent_count?: number;
  total_recipients?: number;
  /** Motif d'une pause ou d'un refus, en clair (send-sms-campaign). */
  error_message?: string | null;
  stats?: SmsStats;
}

export interface SmsPeriod {
  campaigns: number; sent: number; delivered: number; clicked: number;
  purchases: number; revenue: number | null; stop: number; units: number;
}

export interface SmsOverview {
  days: 30 | 90;
  from: string;
  to: string;
  current: SmsPeriod;
  previous: SmsPeriod;
  campaigns: { id: string; name: string | null; sent_at: string; n: number; purchases: number; revenue: number | null }[];
  upcoming: SmsCampaignRow[];
  last: { id: string; name: string | null; body: string | null; sender_name: string | null; event_title: string | null; sent_at: string; n: number; delivered: number; clicked: number; purchases: number; revenue: number | null }[];
  ever_sent: boolean;
}

export function useSmsOverview(days: 30 | 90) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'overview', days],
    queryFn: () => rpc<SmsOverview>('crm_sms_overview', { ...args, p_days: days }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSmsCampaigns() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'campaigns'],
    queryFn: () => rpc<{ campaigns: SmsCampaignRow[] }>('crm_sms_campaigns', args),
    staleTime: 30_000,
  });
}

/** Taille vivante de l'audience de brouillons (après exclusions et plafond). */
export function useSmsDraftSizes(ids: string[]) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'sizes', ids],
    queryFn: () => rpc<Record<string, number>>('crm_sms_draft_sizes', { ...args, p_ids: ids }),
    enabled: ids.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export interface SmsResult extends SmsCampaignRow {
  error?: 'not_found';
  stats: (SmsStats & { non_buyers: number }) | null;
  /** Sommes des AUTRES SMS partis : l'écran en tire les moyennes. */
  avg: { campaigns: number; n: number; delivered: number; clicked: number; purchases: number; revenue: number | null };
  /** Clics par tranche de temps après le départ (0 : 0-5 min … 6 : 1-7 jours). */
  timeline: { b: number; clicks: number }[];
  others: { id: string; name: string | null; sent_at: string }[];
}

export function useSmsResult(id: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'result', id],
    queryFn: () => rpc<SmsResult>('crm_sms_result', { ...args, p_campaign_id: id }),
    enabled: !!id,
    staleTime: 60_000,
    // Envoi en cours : la progression se relit toutes les 4 s.
    refetchInterval: (q) => (q.state.data?.status === 'sending' ? 4000 : false),
  });
}

export interface SmsAnalysisRow {
  id: string; name: string | null; sent_at: string; audiences: CrmAudience[];
  /** Jour (1 = lundi) et heure d'envoi, à Paris. */
  dow: number; hour: number;
  n: number; delivered: number; failed: number; clicked: number; purchases: number; revenue: number | null; stop: number; parts: number;
}

export function useSmsAnalysis() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'analysis'],
    queryFn: () => rpc<{ campaigns: SmsAnalysisRow[] }>('crm_sms_analysis', args),
    staleTime: 5 * 60_000,
  });
}

export interface SmsSendOptions {
  auto: { key: 'hab' | 'occ' | 'nou' | 'end' | 'none'; people: number; reach: number; phone_pct: number | null }[];
  saved: { id: string; name: string; description: string | null; people: number; reach: number; phone_pct: number | null }[];
  people: number;
  reach: number;
  rules: Record<string, number | null>;
}

export function useSmsSendOptions() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'options'],
    queryFn: () => rpc<SmsSendOptions>('crm_sms_send_options', args),
    staleTime: 60_000,
  });
}

export interface SmsAudiencePreview { reach: number; x_buyers: number; x_recent: number; x_cap: number; net: number }

export function useSmsAudiencePreview(p: { audiences: CrmAudience[]; eventId: string | null; recentDays: number | null; excludeBuyers: boolean; campaignId: string | null }) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'preview', p],
    queryFn: () => rpc<SmsAudiencePreview>('crm_sms_audience_preview', {
      ...args, p_audiences: p.audiences, p_event_id: p.eventId, p_recent_days: p.recentDays,
      p_exclude_buyers: p.excludeBuyers, p_campaign_id: p.campaignId,
    }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export interface SmsSettings {
  sender_name: string | null;
  quiet_from: number;
  quiet_to: number;
  no_sunday: boolean;
  weekly_cap: number;
  test_phone: string | null;
  updated_at: string | null;
  people: number;
  sms_ok: number;
}

export function useSmsSettings() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'settings'],
    queryFn: () => rpc<SmsSettings>('crm_sms_settings_get', args),
    staleTime: 5 * 60_000,
  });
}

export function useSaveSmsSettings() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<SmsSettings, 'sender_name' | 'quiet_from' | 'quiet_to' | 'no_sunday' | 'weekly_cap' | 'test_phone'>>) =>
      rpc<{ ok: boolean }>('crm_sms_settings_set', { ...args, p_patch: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', qk, 'sms'] }),
  });
}

/** Ce que l'écran enregistre sur un brouillon. */
export interface SmsDraftPatch {
  name?: string; body?: string; tpl?: string | null; event_id?: string | null; sender_name?: string | null;
  audiences?: CrmAudience[]; exclude_buyers?: boolean; recent_days?: number | null; waves?: boolean;
  quiet_hours?: boolean; scheduled_at?: string | null; estimated?: number; parts?: number;
}

export function useSmsActions() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['crm', qk, 'sms'] });
  return {
    /** Crée (id null) ou modifie un brouillon ; rend son id. */
    save: async (id: string | null, patch: SmsDraftPatch) => {
      const r = await rpc<{ id: string }>('crm_sms_save', { ...args, p_id: id, p_patch: patch });
      void refresh();
      return r.id;
    },
    remove: async (ids: string[]) => {
      const r = await rpc<{ deleted: number }>('crm_sms_delete', { ...args, p_ids: ids });
      void refresh();
      return r.deleted;
    },
    duplicate: async (id: string, name?: string) => {
      const r = await rpc<{ id: string }>('crm_sms_duplicate', { ...args, p_id: id, p_name: name ?? null });
      void refresh();
      return r.id;
    },
    /** Programme un brouillon prêt : le cron l'envoie à l'heure dite (crm_sms_schedule vérifie l'identité). */
    schedule: async (id: string, at: Date) => {
      await rpc('crm_sms_schedule', { ...args, p_id: id, p_at: at.toISOString() });
      void refresh();
    },
    /** Un SMS programmé redevient un brouillon. */
    unschedule: async (id: string) => {
      await rpc('crm_sms_unschedule', { ...args, p_id: id });
      void refresh();
    },
    /** Envoie maintenant : mise en file, débit des Yunits, première tranche (send-sms-campaign). */
    sendNow: async (id: string) => {
      const r = await invokeSms({ campaign_id: id, mode: 'send' });
      void refresh();
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'shell'] });
      return r;
    },
    /** Reprend un SMS en pause (Yunits rechargés, erreur réglée). */
    resume: async (id: string) => {
      const r = await invokeSms({ campaign_id: id, mode: 'resume' });
      void refresh();
      return r;
    },
    /** Test gratuit : le SMS exact, au numéro de test des Réglages (ou celui donné). */
    test: async (id: string, phone?: string | null) => invokeSms({ campaign_id: id, mode: 'test', test_phone: phone ?? null }),
    refresh,
  };
}

/** Réponse de send-sms-campaign ; une erreur devient `SmsSendError` avec le code serveur. */
export class SmsSendError extends Error {
  code: string;
  data: Record<string, unknown>;
  constructor(code: string, data: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

async function invokeSms(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('send-sms-campaign', { body });
  let out = (data as Record<string, unknown> | null) ?? null;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') { try { out = await ctx.clone().json(); } catch { /* corps illisible : code générique */ } }
  if (error || !out || out.error) {
    const raw = String(out?.code ?? out?.error ?? (error as Error | null)?.message ?? 'error');
    throw new SmsSendError(raw, out ?? {});
  }
  return out;
}

/** Clé de message d'une erreur d'envoi (textes `yc.sm.err.*`). */
export function smsErrorKey(e: unknown): string {
  const code = e instanceof SmsSendError ? e.code : String((e as Error | null)?.message ?? '');
  if (code.includes('SMS_IDENTITY_REQUIRED') || code.includes('sms_identity_required')) return 'yc.sm.err.identity';
  if (code.includes('yunits_insufficient')) return 'yc.sm.err.yunits';
  if (code.includes('crm_paused')) return 'yc.sm.err.paused';
  if (code.includes('crm_send_frozen')) return 'yc.sm.err.frozen';
  if (code.includes('demo_no_send')) return 'yc.sm.err.demo';
  if (code.includes('NO_RECIPIENTS')) return 'yc.sm.err.none';
  if (code.includes('SENDER_INVALID')) return 'yc.sm.err.sender';
  if (code.includes('SMS_NOT_CONFIGURED')) return 'yc.sm.err.notConfigured';
  if (code.includes('TEST_PHONE_INVALID')) return 'yc.sm.err.testPhone';
  if (code.includes('TEST_LIMIT')) return 'yc.sm.err.testLimit';
  if (code.includes('PROVIDER_ERROR')) return 'yc.sm.err.provider';
  if (code.includes('bad_date')) return 'yc.sm.err.date';
  return 'yc.sm.err.generic';
}

/** Identité de l'annonceur : exigée par les opérateurs avant tout envoi. */
export interface SmsReadiness { identity_ok: boolean; missing: ('legal_name' | 'registration')[]; last_sender_id: string | null }

export function useSmsReadiness() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'sms', 'readiness'],
    queryFn: () => rpc<SmsReadiness>('get_sms_sender_readiness', args),
    staleTime: 60_000,
  });
}

/** Enregistre la raison sociale et le SIRET / RNA / TVA (titulaire du compte seul). */
export function useSaveSmsIdentity() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { legalName: string; registration: string }) =>
      rpc<SmsReadiness>('set_sms_sender_identity', { ...args, p_legal_name: v.legalName, p_registration: v.registration }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', qk, 'sms'] }),
  });
}
