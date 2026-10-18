/**
 * Données d'Admin CRM › Inviter, Démo et Accès assisté (migration
 * 20261019420000) : un hook par RPC, et l'appel des actions e-mail de l'edge
 * admin-account-recovery avec leur code d'erreur lisible.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdminScope } from '@/components/admin/AdminScope';
import { rpc } from '@/crm/lib/rpc';
import type { DemoStatus, InviteLang, InviteStatus } from '@/crm/lib/crmInvites';

export interface DemoAccess {
  id: string; url: string; label: string; password: string | null; managed: boolean;
  contact_name: string | null; email: string | null; phone: string | null; lang: InviteLang; note: string | null;
  status: DemoStatus; expires_at: string | null; created_at: string; used_count: number; last_used_at: string | null;
  sessions: number; emailed_at: string | null; email_count: number; shared_at: string | null;
  invite: { id: string; org_name: string; offer: 'founder' | 'standard'; status: InviteStatus } | null;
}

export interface CrmInvite {
  id: string; url: string; offer: 'founder' | 'standard'; kind: 'club' | 'organizer' | null;
  org_name: string; contact_name: string | null; email: string | null; phone: string | null; city: string | null;
  lang: InviteLang; note: string | null; free_months: number; yunits: number; status: InviteStatus;
  support_offer: boolean; expires_at: string; created_at: string; emailed_at: string | null; email_count: number;
  shared_at: string | null; opened_at: string | null; claimed_at: string | null; scope_key: string | null;
  revoked_at: string | null; revoked_reason: string | null;
  journey: { started_at: string | null; updated_at: string | null; last_step: string | null; email: string | null } | null;
  demo: DemoAccess | null;
  support: { id: string; status: 'pending' | 'active' | 'revoked' | 'expired'; approved_at: string | null } | null;
  account: { name: string | null; offer_until: string | null; status: string; trial_ends_at: string | null; has_stripe: boolean; yunits_balance: number } | null;
}

export interface InvitesData {
  config: { seats: number; free_months: number; yunits: number; link_days: number };
  price_month: number;
  trial: { days: number; yunits: number };
  seats: { total: number; claimed: number; pending: number; left: number };
  invites: CrmInvite[];
}

export function useAdminInvites() {
  return useQuery({ queryKey: ['crm-admin', 'invites'], staleTime: 15_000, queryFn: () => rpc<InvitesData>('crm_admin_invites') });
}

export interface DemoData {
  links: DemoAccess[];
  invites: { id: string; org_name: string; offer: 'founder' | 'standard'; contact_name: string | null; email: string | null; phone: string | null; lang: InviteLang }[];
}

export function useAdminDemoLinks() {
  return useQuery({ queryKey: ['crm-admin', 'demo-links'], staleTime: 15_000, queryFn: () => rpc<DemoData>('crm_admin_demo_links') });
}

export type GrantStatus = 'pending' | 'active';
export interface SupportAccount {
  id: string; name: string; city: string | null; type: 'club' | 'organizer' | 'association'; contact: string | null;
  email: string | null; state: string; owner_id: string | null;
  grant: { id: string; status: GrantStatus; reason: string | null; initiated_by: 'admin' | 'client'; created_at: string; approved_at: string | null } | null;
  sessions_90: number; last_session_at: string | null; live_until: string | null;
}
export interface SupportData {
  at: string;
  accounts: SupportAccount[];
  log: { at: string; action: string; table: string | null; account: string | null; account_id: string | null; by_admin: boolean }[];
}

export function useAdminSupport() {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'support', includeDemo],
    staleTime: 15_000,
    queryFn: () => rpc<SupportData>('crm_admin_support', { p_include_demo: includeDemo }),
  });
}

/**
 * Une action de l'edge admin-account-recovery. supabase-js ne lit pas le corps
 * d'une réponse non 2xx : on le relit pour rendre le code d'erreur métier.
 */
export async function invokeAdminAction<T = Record<string, unknown>>(action: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: T; code: string | null }> {
  const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action, ...body } });
  let payload = data as (T & { error?: string; code?: string }) | null;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try { payload = await ctx.clone().json(); } catch { /* corps illisible */ }
  }
  if (error || payload?.error) return { ok: false, data: {} as T, code: String(payload?.code ?? payload?.error ?? 'x') };
  return { ok: true, data: (payload ?? {}) as T, code: null };
}

const ERR = ['offer_full', 'org_name_required', 'bad_email', 'not_pending', 'no_email', 'email_failed', 'email_not_configured', 'reason_required', 'label_required', 'invite_not_found'];

/** Un code d'erreur des RPC / de l'edge en phrase (`adm.crm.iv.err.*`). */
export function inviteErr(t: (k: string) => string, code: string | undefined | null): string {
  return t(`adm.crm.iv.err.${ERR.includes(code ?? '') ? code : 'x'}`);
}
