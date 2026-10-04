/**
 * Données de la coquille (menu, barre du haut) : un appel get_crm_shell par
 * espace, rafraîchi toutes les 2 minutes ; le portefeuille de Yunits quand on
 * ouvre son aperçu ; la recherche ⌘K.
 */
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type SyncState = 'ok' | 'running' | 'broken' | 'paused';

export interface CrmShell {
  profile: { first_name: string | null; last_name: string | null; email: string | null; avatar_url: string | null; language: string | null } | null;
  connection: {
    provider: string; status: string; state: SyncState; external_org_name: string | null;
    last_ok_at: string | null; last_error_at: string | null; last_error: string | null; fail_count: number;
    initial_import_done_at: string | null; running: boolean; broken_since: string | null;
  } | null;
  subscription: {
    status: string; state: 'trial' | 'active' | 'past_due' | 'paused'; trial_ends_at: string | null;
    current_period_end: string | null; cancel_at_period_end: boolean; interval: string | null; has_stripe: boolean;
  } | null;
  wallet: { balance: number; reserved: number; low_balance: number; rates: Record<string, number> };
  badges: { campaigns: number; clients: number };
  notifications_unread: number;
  is_super_admin: boolean;
}

export function useCrmShell() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'shell'],
    queryFn: () => rpc<CrmShell>('get_crm_shell', args),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export interface CrmWallet {
  balance: number;
  lots: { kind: 'trial' | 'monthly' | 'bonus' | 'purchase'; remaining: number; expires_at: string | null }[];
  moves: { at: string; delta: number; kind: 'credit' | 'debit' | 'refund' | 'expire'; lot_kind: string | null; channel: string | null; label: string | null; ref_type: string | null; ref_id: string | null; meta: Record<string, unknown> }[];
  reserved: { id: string; name: string; channel: 'email' | 'sms'; at: string; cost: number }[];
  reserved_total: number;
  spent_month: number;
  low_balance: number;
  rates: Record<string, number>;
  channels_live: Record<string, boolean>;
}

export function useCrmWallet(enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'wallet'],
    queryFn: () => rpc<CrmWallet>('get_crm_wallet', args),
    enabled,
    staleTime: 30_000,
  });
}

export interface CrmSearchResult {
  clients: { email: string; first_name: string | null; last_name: string | null; nights: number; last_at: string | null }[];
  campaigns: { id: string; name: string | null; channel: 'email' | 'sms'; status: string; at: string | null; recipients: number | null }[];
  nights: { id: string; title: string | null; start_at: string; end_at: string | null; sold: number }[];
}

export function useCrmSearch(q: string, enabled: boolean) {
  const { rpc: args, qk } = useCrmScope();
  const term = q.trim();
  return useQuery({
    queryKey: ['crm', qk, 'search', term],
    queryFn: () => rpc<CrmSearchResult>('crm_search', { ...args, p_q: term }),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
