/**
 * Données de l'Admin CRM : un hook par RPC `crm_admin_*`. La démo est incluse ou
 * non par l'interrupteur de portée du super admin (`AdminScope`), passé à
 * chaque lecture : la porte démo vit en SQL.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminScope } from '@/components/admin/AdminScope';
import { rpc } from '@/crm/lib/rpc';
import type { AdminAccount } from '@/crm/lib/admin';

export interface AdminAccounts { at: string; accounts: AdminAccount[] }

export function useAdminAccounts() {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'accounts', includeDemo],
    staleTime: 30_000,
    queryFn: () => rpc<AdminAccounts>('crm_admin_accounts', { p_include_demo: includeDemo }),
  });
}

export interface CockpitFunnelRow { k: 'started' | 'account' | 'console' | 'connected' | 'sent' | 'paid'; n: number }
export interface CockpitSignup {
  at: string; who: string | null; org: string | null; city: string | null; kind: string | null;
  last_step: string | null; steps: Record<string, string>; source: string | null; device: string | null; live: boolean; account: boolean;
}
export interface CockpitBuy { at: string; id: string; yunits: number; eur: number; name: string | null }
export interface Cockpit {
  at: string; days: number;
  kpi: {
    started: number; pstarted: number; created: number; pcreated: number; paying: number; late: number; trial: number; mrr: number;
    buys: number; buys_eur: number; live_signups: number;
  };
  funnel: CockpitFunnelRow[];
  series: { t: string; mrr: number; paying: number }[];
  recent_signups: CockpitSignup[];
  recent_buys: CockpitBuy[];
  accounts: AdminAccount[];
}

export function useAdminCockpit(days: number) {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'cockpit', includeDemo, days],
    staleTime: 30_000,
    queryFn: () => rpc<Cockpit>('crm_admin_cockpit', { p_include_demo: includeDemo, p_days: days }),
  });
}

export interface AdminAccountDetail {
  account: AdminAccount;
  moves: { at: string; delta: number; kind: string; lot_kind: string | null; channel: string | null; label: string | null }[];
  runs: { at: string; trigger: string | null; status: string | null; requests: number | null; tickets: number | null; error: string | null }[];
  sends: { at: string; name: string; status: string; recipients: number | null; bounced: number | null; complained: number | null; channel: string }[];
  note: string;
  audit: { at: string; action: string; meta: Record<string, unknown> }[];
}

export function useAdminAccount(id: string | undefined) {
  return useQuery({
    queryKey: ['crm-admin', 'account', id],
    enabled: !!id,
    staleTime: 15_000,
    queryFn: () => rpc<AdminAccountDetail>('crm_admin_account', { p_scope_key: id }),
  });
}

/** Un geste admin (RPC qui écrit) : rafraîchit toutes les lectures de l'Admin CRM. */
export function useAdminGesture<A extends Record<string, unknown>>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => rpc<unknown>(fn, args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['crm-admin'] }); },
  });
}
