/**
 * Lectures de la rubrique « Communication ». Toutes les RPC existent déjà
 * (migrations 20261127… à 20261129…, 20260908…) : cette page ne fait que les
 * assembler au même endroit.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '../system/data';

export const COMMS_KEY = ['admin', 'comms'] as const;

export interface Sender {
  scope_key: string; name: string; sent: number; bounced: number; complained: number; opened: number;
  gmail_sent: number; gmail_opened: number; burst_allowed: boolean; cold_frozen_until: string | null; reason: string | null;
  level?: number;
  rights?: { daily_cap: number; per_hour: number; cold_daily: number; cold_gmail_daily: number; burst: boolean };
  checks?: Record<string, boolean>;
}
export const useSenders = () => useQuery({ queryKey: [...COMMS_KEY, 'senders'], staleTime: 30_000, queryFn: () => rpc<Sender[]>('admin_email_senders') });

export interface DeliverabilityDay { day: string; gmail_sent: number; gmail_opened: number; other_sent: number; other_opened: number }
export interface Deliverability {
  gmail_recovery: boolean; gmail_engaged_days: number; started_at: string; gmail_engaged_pool: number; gmail_held_30d: number;
  days: DeliverabilityDay[];
}
export const useDeliverability = () => useQuery({ queryKey: [...COMMS_KEY, 'deliv'], staleTime: 30_000, queryFn: () => rpc<Deliverability>('admin_email_deliverability') });

export interface Watch {
  senders: { scope_key: string; name: string; until: string; reason: string }[];
  waves: { id: string; name: string; state: 'testing' | 'done' | 'halted'; released: number | null; total: number | null;
    note: { cold?: number; sent?: number; bounced?: number; opened?: number; reason?: string } | null }[];
}
export const useWatch = () => useQuery({ queryKey: [...COMMS_KEY, 'watch'], staleTime: 30_000, queryFn: () => rpc<Watch>('admin_email_deliverability_watch') });

export interface PostmasterDay { day: string; spam: number | null; delivery_error: number | null; auth: number | null; senders: { key: string; name: string; gmail_sent: number; share: number }[] | null }
export interface PostmasterDomain {
  domain: string; fetched_at: string; last_error: string | null;
  compliance: { complianceData?: { rowData?: { requirement: string; status: { status: string } }[] } } | null;
  days: PostmasterDay[];
}
export interface Postmaster { watch: number; limit: number; connected: boolean; domains: PostmasterDomain[] }
export const usePostmaster = () => useQuery({ queryKey: [...COMMS_KEY, 'postmaster'], staleTime: 120_000, queryFn: () => rpc<Postmaster>('admin_gmail_postmaster', { p_days: 60 }) });

export interface SendingDomain {
  scope_key: string; domain: string; address: string; status: 'pending' | 'verified' | 'active' | 'paused';
  note: string | null; verified_at: string | null; activated_at: string | null; name: string;
}
export const useSendingDomains = () => useQuery({ queryKey: [...COMMS_KEY, 'domains'], staleTime: 30_000, queryFn: () => rpc<SendingDomain[]>('admin_email_sending_domains') });

// ── Campagnes de Yuno ──
export interface MarketingOverview {
  email: { total: number; opted_in: number; opted_out: number; suppressed: number; reachable: number; by_source: Record<string, number> };
  sms: { total: number; reachable: number; unsubscribed: number };
  imports: { id: string; list_name: string | null; filename: string | null; created_at: string; contacts: number }[];
  campaigns: { email_drafts: number; email_sent: number; sms_drafts: number; sms_sent: number };
  quota?: { used: number; free: number; remaining: number; day_used: number; day_cap: number; pool_used: number; pool_cap: number };
}
export const useMarketingOverview = () => useQuery({ queryKey: [...COMMS_KEY, 'mkt'], staleTime: 30_000, queryFn: () => rpc<MarketingOverview>('get_platform_marketing_overview') });

export interface EmailCampaignRow {
  id: string; name: string; subject: string; status: string; total_recipients: number; recipients_count: number;
  opens_count: number; clicks_count: number; scheduled_at: string | null; sent_at: string | null; created_at: string;
}
export const useEmailCampaigns = () => useQuery({
  queryKey: [...COMMS_KEY, 'email-campaigns'], staleTime: 30_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('email_campaigns')
      .select('id,name,subject,status,total_recipients,recipients_count,opens_count,clicks_count,scheduled_at,sent_at,created_at')
      .is('venue_id', null).is('organizer_user_id', null).order('created_at', { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as EmailCampaignRow[];
  },
});

export interface SmsCampaignRow { id: string; name: string | null; status: string; created_at: string; scheduled_at: string | null; sent_at: string | null; total_recipients: number | null; sent_count: number | null; delivered_count: number | null; failed_count: number | null }
export const useSmsCampaigns = () => useQuery({
  queryKey: [...COMMS_KEY, 'sms-campaigns'], staleTime: 30_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('sms_campaigns')
      .select('id,name,status,created_at,scheduled_at,sent_at,total_recipients,sent_count,delivered_count,failed_count')
      .is('venue_id', null).is('organizer_id', null).or('product.is.null,product.neq.crm')
      .order('created_at', { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SmsCampaignRow[];
  },
});

export interface PushCampaignRow { id: string; title: string; segment: string; status: string | null; sent_count: number; targeted_count: number | null; failed_count: number | null; created_at: string; scheduled_at: string | null }
export const usePushCampaigns = () => useQuery({
  queryKey: [...COMMS_KEY, 'push-campaigns'], staleTime: 30_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('push_campaigns' as never)
      .select('id,title,segment,status,sent_count,targeted_count,failed_count,created_at,scheduled_at')
      .is('venue_id', null).is('agency_id', null).neq('source', 'auto').order('created_at', { ascending: false }).limit(60);
    if (error) throw new Error((error as { message: string }).message);
    return (data ?? []) as unknown as PushCampaignRow[];
  },
});

// ── Moteur de notifications ──
export interface RuleStats {
  key: string; enabled: boolean; params: Record<string, number>;
  sent: number; taps: number; buyers: number; revenue: number; queued: number; held: number;
  heldBy: Record<string, number>; lastAt: string | null;
}
export interface EngineOverview {
  ok: true; days: number; settings: Record<string, number>;
  totals: { sent: number; taps: number; buyers: number; revenue: number; held: number; boughtBefore: number };
  queue: { pending: number; dueNow: number; claimed: number; oldestDue: string | null; holds: Record<string, number> };
  rules: RuleStats[];
  series: { day: string; sent: number; taps: number }[];
}
export const useEngine = (days: number) => useQuery({
  queryKey: [...COMMS_KEY, 'engine', days], staleTime: 30_000,
  queryFn: async () => {
    const r = await rpc<EngineOverview | { ok: false }>('admin_push_engine_overview', { p_days: days });
    if (!r.ok) throw new Error('engine_unavailable');
    return r;
  },
});

// ── Règles du moteur : textes par langue, variante et raison ──
export interface RuleTemplate { rule_key: string; variant: string; reason: string; lang: string; title: string; body: string; default_title: string; default_body: string }
export const useRuleTemplates = () => useQuery({
  queryKey: [...COMMS_KEY, 'rule-templates'], staleTime: 30_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('push_rule_templates' as never)
      .select('rule_key, variant, reason, lang, title, body, default_title, default_body')
      .order('rule_key').order('variant').order('reason').order('lang');
    if (error) throw new Error((error as { message: string }).message);
    return (data ?? []) as unknown as RuleTemplate[];
  },
});

// ── Crédits de campagnes des pros ──
export interface CreditAccount {
  scope: string; kind: 'venue' | 'org' | 'agency'; name: string | null;
  allowance: number; defaultAllowance: number; override: boolean; used: number; bonus: number; remaining: number; lastRequestAt: string | null;
}
export const useCreditAccounts = () => useQuery({
  queryKey: [...COMMS_KEY, 'credit-accounts'], staleTime: 30_000,
  queryFn: async () => {
    const r = await rpc<{ ok: boolean; accounts?: CreditAccount[] }>('admin_push_credit_accounts', { p_q: null });
    return r?.ok ? r.accounts ?? [] : [];
  },
});

// ── Page bio (Yuno Links) ──
export const useLinksAnalytics = (from: string, to: string) => useQuery({
  queryKey: [...COMMS_KEY, 'links-analytics', from, to], staleTime: 30_000,
  queryFn: () => rpc<import('@/lib/yunoLinks').LinksAnalytics>('get_links_analytics', { p_from: from, p_to: to }),
});

export interface WaitlistEntry { id: string; email: string; first_name: string | null; last_name: string | null; city: string | null; phone: string | null; source: string | null; lang: string | null; created_at: string; notified_at: string | null }
export const useWaitlist = () => useQuery({
  queryKey: [...COMMS_KEY, 'waitlist'], staleTime: 30_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('launch_waitlist')
      .select('id, email, first_name, last_name, city, phone, source, lang, created_at, notified_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as WaitlistEntry[];
  },
});

// ── Push de Yuno : clics par campagne ──
export const usePushClicks = (ids: string[]) => useQuery({
  queryKey: [...COMMS_KEY, 'push-clicks', ids.join(',')], staleTime: 30_000, enabled: ids.length > 0,
  queryFn: async () => {
    const { data } = await supabase.from('push_campaign_events' as never).select('campaign_id').eq('event_type', 'clicked').in('campaign_id', ids);
    const counts: Record<string, number> = {};
    ((data as { campaign_id: string }[] | null) ?? []).forEach((e) => { counts[e.campaign_id] = (counts[e.campaign_id] || 0) + 1; });
    return counts;
  },
});
