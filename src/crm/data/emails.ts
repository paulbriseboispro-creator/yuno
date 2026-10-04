/**
 * Données de la suite E-mails de la Console CRM : vue d'ensemble, campagnes,
 * résultats d'une campagne, destinataires, analyse, réglages d'envoi.
 * Une seule définition des chiffres : _crm_email_stats (migration
 * 20261004210000_crm_emails.sql) — reçus, ouverts, cliqués, achats attribués
 * (billet acheté dans les 7 jours après un clic), CA.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { ClientFilterDef } from './clients';

/** Une audience de la Console : un segment enregistré ou une définition de filtre. */
export interface CrmAudience { kind: 'crm'; segmentId?: string; def?: ClientFilterDef; label?: string }

export interface EmailStats {
  n: number; received: number; opened: number; clicked: number; ticketing: number;
  purchases: number; revenue: number; bounced: number; complained: number; unsub: number;
}

export type EmailStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed';

export interface EmailCampaignRow {
  id: string;
  name: string | null;
  subject: string | null;
  status: EmailStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  updated_at: string;
  created_at: string;
  audiences: CrmAudience[] | Record<string, unknown>[];
  event_id: string | null;
  template_kind: string | null;
  total_recipients: number | null;
  has_content: boolean;
  paused_reason: string | null;
  theme?: { bg?: string; headerBg?: string; accent?: string; divider?: string; tile?: string } | null;
  stats?: EmailStats;
}

export interface PeriodTotals {
  campaigns: number; sent: number; received: number; opened: number; clicked: number;
  ticketing: number; purchases: number; revenue: number;
}

export interface EmailOverview {
  days: 30 | 90;
  from: string;
  to: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  campaigns: { id: string; name: string | null; sent_at: string; n: number; purchases: number; revenue: number }[];
  upcoming: EmailCampaignRow[];
  last: { id: string; name: string | null; subject: string | null; sent_at: string; n: number; received: number; opened: number; clicked: number; purchases: number; revenue: number }[];
  ever_sent: boolean;
}

export function useEmailOverview(days: 30 | 90) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'overview', days],
    queryFn: () => rpc<EmailOverview>('crm_email_overview', { ...args, p_days: days }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useEmailCampaigns() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'campaigns'],
    queryFn: () => rpc<{ campaigns: EmailCampaignRow[] }>('crm_email_campaigns', args),
    staleTime: 30_000,
  });
}

export interface EmailResult extends EmailCampaignRow {
  error?: 'not_found';
  stats: (EmailStats & { non_openers: number }) | null;
  avg: { campaigns: number; open_rate: number | null; click_rate: number | null; per_k: number | null };
  rank: number | null;
  rank_of: number;
  timeline: { h: number; opens: number; clicks: number }[];
  links: { link: string; clicks: number; people: number }[];
  others: { id: string; name: string | null; sent_at: string }[];
  resend: { enabled: boolean | null; subject: string | null; done_at: string | null; campaign_id: string | null };
  blocks_version: number | null;
}

export function useEmailResult(id: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'result', id],
    queryFn: () => rpc<EmailResult>('crm_email_result', { ...args, p_campaign_id: id }),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export type RecipientFilter = 'all' | 'opened' | 'clicked' | 'bought' | 'unopened' | 'bounced';

export interface EmailRecipients {
  total: number;
  rows: { email: string; first_name: string | null; last_name: string | null; status: string; lifecycle: string | null; opened: boolean; clicked: boolean; revenue: number }[];
  counts: Record<RecipientFilter, number>;
}

export function useEmailRecipients(id: string | null, filter: RecipientFilter, q: string, offset: number, enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'recipients', id, filter, q, offset],
    queryFn: () => rpc<EmailRecipients>('crm_email_recipients', { ...args, p_campaign_id: id, p_filter: filter, p_q: q || null, p_offset: offset }),
    enabled: !!id && enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export interface EmailAnalysis {
  campaigns: { id: string; name: string | null; subject: string | null; sent_at: string; kind: string | null; n: number; received: number; opened: number; clicked: number; purchases: number; revenue: number; bounced: number; complained: number; unsub: number }[];
  grid: { d: number; h: number; n: number; clicked: number }[];
  subjects: { b: number; campaigns: number; received: number; opened: number }[];
  segments: { seg: string; people: number; received: number; opened: number; clicked: number; purchases: number }[];
}

export function useEmailAnalysis() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'analysis'],
    queryFn: () => rpc<EmailAnalysis>('crm_email_analysis', args),
    staleTime: 5 * 60_000,
  });
}

export interface EmailSettings {
  sender_name: string | null;
  reply_to: string | null;
  postal_address: string | null;
  quiet_hours: boolean;
  waves: boolean;
  notify_done: boolean;
  test_emails: string[];
  updated_at: string | null;
  defaults: { sender_name: string | null; reply_to: string | null; city: string | null; address: string | null };
}

export function useEmailSettings() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'settings'],
    queryFn: () => rpc<EmailSettings>('crm_email_settings_get', args),
    staleTime: 5 * 60_000,
  });
}

export function useSaveEmailSettings() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<EmailSettings, 'defaults' | 'updated_at'>>) => rpc<EmailSettings>('crm_email_settings_set', { ...args, p_patch: patch }),
    onSuccess: (d) => { qc.setQueryData(['crm', qk, 'emails', 'settings'], d); },
  });
}

/** Relit toute la suite E-mails (après un envoi, une duplication, une suppression). */
export function useInvalidateEmails() {
  const qc = useQueryClient();
  const { qk } = useCrmScope();
  return () => {
    for (const k of ['emails', 'shell', 'home', 'nights', 'night']) void qc.invalidateQueries({ queryKey: ['crm', qk, k] });
  };
}

/** Taille de l'audience de plusieurs campagnes (règle de l'envoi), par id. */
export function useEmailAudienceSizes(ids: string[]) {
  const { rpc: args, qk } = useCrmScope();
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'sizes', key],
    queryFn: () => rpc<Record<string, number>>('crm_email_audience_sizes', { ...args, p_ids: ids }),
    enabled: ids.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
