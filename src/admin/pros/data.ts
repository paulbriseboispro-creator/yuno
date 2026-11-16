/**
 * Données de la rubrique « Pros » : un hook par RPC (migration 20261218120000).
 * La démo et la période viennent de useAdminFilters ; la porte démo vit en SQL.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useAdminFilters } from '../context/useAdminFilters';
import type { AccountRow, AccountsPayload, AccountType, AccountProduct } from './accounts';

export const PROS_QK = 'admin-pros';

export function useAccounts() {
  const { range, includeDemo } = useAdminFilters();
  return useQuery({
    queryKey: [PROS_QK, 'accounts', includeDemo, range.days],
    staleTime: 30_000,
    queryFn: () => rpc<AccountsPayload>('admin_accounts', { p_include_demo: includeDemo, p_days: range.days }),
  });
}

export interface MonthRow { month: string; tickets: number; tickets_rev: number; tables: number; tables_rev: number; guestlist: number }
export interface EventRow {
  id: string; title: string; start_at: string; end_at: string | null; is_active: boolean; cancelled: boolean; slug: string | null;
  role: 'lead' | 'partner'; tickets: number; tables: number; guestlist: number; revenue: number;
}
export interface TeamRow { id: string | null; name: string | null; email: string | null; role: string; status?: string; mfa: boolean; since: string | null }
export interface GrantRow { id: string; status: string; reason: string | null; initiated_by: string | null; created_at: string; approved_at: string | null; revoked_at: string | null; expires_at: string | null }
export interface SessionRow { id: string; status: string; via: string | null; created_at: string; ended_at: string | null; expires_at: string | null; admin: string | null }
export interface AuditRow { at: string; action: string; entity_type: string | null; meta: Record<string, unknown> | null; admin: string | null }
export interface NoteRow { id: string; body: string; pinned: boolean; at: string; updated_at: string; author: string | null }

export interface CrmAccountRow {
  state: string; health: number; h: [number, number, number, number]; mrr: number; balance: number; trial_left: number | null;
  trial_ends_at: string | null; period_end: string | null; interval: string | null; founder: boolean; paid: boolean; granted: boolean;
  sync: 'none' | 'ok' | 'error'; sync_at: string | null; sync_error: string | null; provider: string | null;
  contacts: number; reach: number; sends30: number; last_send_at: string | null; buys: number; buys_eur: number;
  ob: boolean[]; recipes: number; team: number; frozen_at: string | null; frozen_reason: string | null;
}
export interface CrmCard {
  account: CrmAccountRow;
  owner_id: string | null;
  trial_ext: { used: number; free: number };
  moves: { at: string; delta: number; kind: string; lot_kind: string | null; channel: string | null; label: string | null }[];
  runs: { at: string; trigger: string; status: string; requests: number; tickets: number; error: string | null }[];
  sends: { at: string; name: string; status: string; recipients: number | null; bounced: number | null; complained: number | null }[];
  error?: string;
}

export interface AccountCard {
  key: string;
  kind: 'venue' | 'org' | 'agency';
  ref: string;
  row: AccountRow | null;
  identity: Record<string, unknown> & {
    name?: string; city?: string; slug?: string | null; address?: string | null; created_at?: string; public_url?: string | null;
    is_hidden?: boolean; decommissioned_at?: string | null; purge_at?: string | null; association?: boolean; is_active?: boolean;
    product?: string | null; extra_products?: string[];
    stripe?: { account?: boolean; onboarded?: boolean; charges?: boolean; payouts?: boolean; status?: string | null };
  };
  legal: Record<string, string | null> | null;
  owner: { id: string; email: string | null; name: string | null; phone: string | null; mfa: boolean; suspended: boolean; created_at: string; last_login: string | null } | null;
  team: TeamRow[];
  venue_overview: {
    revenue?: { tickets?: { n: number; gross: number }; tables?: { n: number; gross: number }; guestlist?: number; last_sale_at?: string | null };
    staff?: { id: string; email: string | null; name: string | null; roles: string[] | null; has_pin: boolean }[];
    promoters?: number; customers?: number; followers?: number; newsletter?: number; email_campaigns?: number;
    onboarding?: { current_step: number; completed_at: string | null } | null;
  } | null;
  products_history: { product: string; action: string; via: string | null; email: string | null; at: string }[];
  monthly: MonthRow[] | null;
  events: EventRow[];
  collabs: { event_id: string; title: string; start_at: string; status: string; with: string | null }[];
  cohosts: { event_id: string; title: string; start_at: string; role: string | null; access: string | null }[];
  crm: CrmCard | null;
  sending: { level: number | null; level_since: string | null; reason: string | null; cold_frozen_until: string | null; burst_allowed: boolean; smart_off: boolean;
    incidents: { at: string; kind: string; detail: unknown }[] } | null;
  feedback: { id: string; title: string; category: string | null; status: string | null; priority: string | null; at: string }[];
  requests: { id: string; body: string; status: string; at: string }[];
  nps: { score: number; comment: string | null; at: string }[];
  legal_acceptances: { doc: string; version: string; context: string | null; at: string }[];
  support: { grants: GrantRow[]; sessions: SessionRow[] };
  audit: AuditRow[];
  notes: NoteRow[];
  crm_note: string | null;
  tags: string[];
}

export function useAccount(key: string | undefined) {
  return useQuery({
    queryKey: [PROS_QK, 'account', key],
    enabled: !!key,
    staleTime: 15_000,
    queryFn: () => rpc<AccountCard>('admin_account', { p_key: key }),
  });
}

/** Après un geste : la liste et la fiche se relisent. */
export function useProsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [PROS_QK] });
}

// ── Prospects ──
export interface LinksLead { id: string; at: string; name: string | null; org_name: string | null; org_type: string | null; city: string | null; phone: string | null; email: string | null; message: string | null; lang: string | null; contacted_at: string | null; notes: string | null }
export interface CrmProspect { id: string; at: string; name: string; contact: string | null; phone: string | null; email: string | null; city: string | null; kind: string; source: string | null; stage: string; next_action: string | null; next_at: string | null; note: string | null; opposed: boolean; stage_changed_at: string | null }
export interface SignupPerson {
  key: string; ids: string[]; outcome: string; furthest_step: string | null; first_at: string; last_at: string;
  first_name: string | null; last_name: string | null; email: string | null; phones: string[];
  org_name: string | null; kind: string | null; product: string | null; city: string | null;
  invited: boolean; contacted_at: string | null; admin_notes: string | null;
  account: { user_id: string; venue_id: string | null; created_at: string } | null;
}

export function useProspects() {
  const { includeDemo, range } = useAdminFilters();
  const base = useQuery({
    queryKey: [PROS_QK, 'prospects', includeDemo],
    staleTime: 30_000,
    queryFn: () => rpc<{ links: LinksLead[]; crm: CrmProspect[] }>('admin_prospects', { p_include_demo: includeDemo }),
  });
  const signups = useQuery({
    queryKey: [PROS_QK, 'signups', includeDemo, range.days],
    staleTime: 30_000,
    queryFn: () => rpc<{ people: SignupPerson[] }>('admin_pro_signups', { p_days: Math.max(range.days, 90), p_include_demo: includeDemo }),
  });
  return { base, signups };
}

// ── Invitations ──
export interface PendingInvite {
  id: string; source: 'owner' | 'platform' | 'crm' | 'product'; type: AccountType; product: AccountProduct | 'founder';
  email: string | null; name: string | null; account_key: string | null; created_at: string; expires_at: string | null;
  state: 'pending' | 'accepted' | 'expired' | 'revoked';
}

export function useInvitations() {
  return useQuery({
    queryKey: [PROS_QK, 'invitations'],
    staleTime: 15_000,
    queryFn: () => rpc<PendingInvite[]>('admin_pending_invitations'),
  });
}

// ── Accès assisté ──
export interface SupportGrant extends GrantRow {
  owner_id: string; key: string; name: string; type: AccountType; products: AccountProduct[];
  live_until: string | null; sessions: number; last_session_at: string | null;
}
export interface SupportOverview {
  at: string;
  accounts: { key: string; name: string; type: AccountType; products: AccountProduct[]; owner_id: string; owner_name: string | null; owner_email: string | null }[];
  grants: SupportGrant[];
  log: { at: string; action: string; table: string | null; key: string; name: string; by_admin: boolean }[];
}

export function useSupportOverview() {
  const { includeDemo } = useAdminFilters();
  return useQuery({
    queryKey: [PROS_QK, 'support', includeDemo],
    staleTime: 15_000,
    queryFn: () => rpc<SupportOverview>('admin_support_overview', { p_include_demo: includeDemo }),
  });
}
