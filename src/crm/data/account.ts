/**
 * Données du Compte (Console CRM) : l'équipe de l'espace et ses actions, les
 * préférences de notification de la personne. Une seule source pour les
 * rôles : le serveur (crm_team_get, crm_org_role).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type CrmRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: CrmRole;
  you: boolean;
  last_seen_at: string | null;
}

export interface TeamInvite { id: string; email: string; role: CrmRole; created_at: string; expires_at: string | null; expired: boolean }

export interface Team {
  my_role: CrmRole;
  can_manage: boolean;
  kind: 'venue' | 'org';
  members: TeamMember[];
  invites: TeamInvite[];
}

export function useTeam(enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'team'],
    queryFn: () => rpc<Team>('crm_team_get', args),
    enabled,
    staleTime: 60_000,
  });
}

export function useTeamActions() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const org = args.p_organizer_user_id;
  const done = () => { void qc.invalidateQueries({ queryKey: ['crm', qk, 'team'] }); };
  const setRole = useMutation({
    mutationFn: (p: { memberId: string; role: Exclude<CrmRole, 'owner'> }) => rpc('crm_team_set_role', { p_organizer_user_id: org, p_member_id: p.memberId, p_role: p.role }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (memberId: string) => rpc('crm_team_remove', { p_organizer_user_id: org, p_member_id: memberId }),
    onSuccess: done,
  });
  /** Invitation (ou renvoi) par invite-org-member. Rend le code d'erreur du serveur s'il y en a un. */
  const invite = useMutation({
    mutationFn: async (p: { email: string; role: Exclude<CrmRole, 'owner'>; resend?: boolean }): Promise<string | null> => {
      const { data, error } = await supabase.functions.invoke('invite-org-member', {
        body: { email: p.email, role: p.role, organizer_user_id: org, resend: !!p.resend },
      });
      let body = data as { error?: string; code?: string } | null;
      const ctx = (error as { context?: Response } | null)?.context;
      if (ctx && typeof ctx.json === 'function') { try { body = await ctx.clone().json(); } catch { /* corps illisible */ } }
      if (error || body?.error) return body?.code ?? body?.error ?? 'error';
      return null;
    },
    onSuccess: done,
  });
  return { setRole, remove, invite };
}

export type NotifKind = 'rapport' | 'prog' | 'bloque' | 'solde' | 'sync' | 'import' | 'facture' | 'equipe' | 'secu' | 'digest';

export interface NotifPrefs {
  kinds: Record<NotifKind, { m: boolean; a: boolean; lock?: boolean; app?: boolean }>;
  quiet_on: boolean;
  quiet_from: number;
  quiet_to: number;
  low_balance: number;
  updated_at: string | null;
}

export function useNotifPrefs() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'notif-prefs'],
    queryFn: () => rpc<NotifPrefs>('crm_notif_prefs_get', args),
    staleTime: 5 * 60_000,
  });
}

export function useSaveNotifPrefs() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => rpc<NotifPrefs>('crm_notif_prefs_set', { ...args, p_patch: patch }),
    onSuccess: (d) => { qc.setQueryData(['crm', qk, 'notif-prefs'], d); },
  });
}

export interface MyProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  preferred_language: string | null;
  mfa_enabled: boolean | null;
}

/** Le profil de la personne connectée (pas de l'espace) : RLS « son propre profil ». */
export function useMyProfile(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['crm', 'me', 'profile', userId ?? null],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<MyProfile | null> => {
      const { data, error } = await supabase.from('profiles')
        .select('id, email, first_name, last_name, phone, avatar_url, preferred_language, mfa_enabled')
        .eq('id', userId as string).maybeSingle();
      if (error) throw error;
      return (data as MyProfile | null) ?? null;
    },
  });
}

// ── Abonnement et facturation ────────────────────────────────────────────────
// État lu par get_crm_billing (toute l'équipe) ; ce qui vit chez Stripe (carte,
// factures, coordonnées) passe par les actions crm_* de club-subscription,
// réservées au propriétaire de l'espace.

export interface CrmBilling {
  subscription: {
    plan: string; status: string; interval: 'month' | 'year' | null; founder: boolean;
    trial_ends_at: string | null; current_period_end: string | null; cancel_at_period_end: boolean;
    has_stripe: boolean; has_customer: boolean; granted: boolean;
  } | null;
  effective_plan: 'base' | 'paused';
  can_manage: boolean;
  yunits_balance: number;
  pricing: {
    price_month: number; price_year: number; price_month_next: number; monthly_yunits: number;
    annual_bonus_yunits: number; trial_yunits: number; trial_days: number; vat_rate: number;
  };
  usage: { members: number; sync_minutes: number | null; automations_on: number };
}

export function useCrmBilling() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'billing'],
    queryFn: () => rpc<CrmBilling>('get_crm_billing', args),
    staleTime: 30_000,
  });
}

export interface BillingCustomer { name: string; email: string; line1: string; line2: string; postal_code: string; city: string; country: string; siret: string; vat: string }
export interface BillingInvoice { id: string; number: string | null; at: string; total: number; currency: string; status: string | null; kind: 'subscription' | 'recharge' | 'other'; interval: 'month' | 'year' | null; title: string; pdf: string | null; url: string | null }
export interface BillingOverview {
  customer: BillingCustomer | null;
  card: { kind: 'card' | 'sepa'; brand: string; last4: string; exp_month: number | null; exp_year: number | null } | null;
  invoices: BillingInvoice[];
  has_more: boolean;
  upcoming: { amount: number; at: string | null } | null;
  scheduled: { interval: 'month' | 'year'; at: string } | null;
  subscription: {
    status: string; interval: 'month' | 'year'; tier: 'launch' | 'public' | null; unit_amount: number | null;
    cancel_at_period_end: boolean; period_end: string | null; trial_end: string | null;
  } | null;
}

/** Appel d'une action crm_* : rend le corps, ou lève une Error dont le message est le code serveur. */
export async function invokeCrmBilling<T>(action: string, scope: { p_venue_id: string | null; p_organizer_user_id: string | null }, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('club-subscription', {
    body: { action, venue_id: scope.p_venue_id, organizer_user_id: scope.p_organizer_user_id, ...extra },
  });
  let body = data as (T & { success?: boolean; code?: string; error?: string }) | null;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') { try { body = await ctx.clone().json(); } catch { /* corps illisible */ } }
  if (error || !body || body.success === false) throw new Error(body?.code ?? body?.error ?? 'error');
  return body as T;
}

export function useBillingOverview(enabled: boolean, invoicesLimit = 12) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'billing-overview', invoicesLimit],
    queryFn: () => invokeCrmBilling<BillingOverview>('crm_overview', args, { invoices_limit: invoicesLimit }),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

export function useBillingAction() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { action: string; extra?: Record<string, unknown> }) =>
      invokeCrmBilling<{ url?: string; scheduled?: unknown }>(p.action, args, p.extra ?? {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'billing'] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'billing-overview'] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'shell'] });
    },
  });
}
