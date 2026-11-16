/**
 * Lectures et gestes de la rubrique « Argent ». Une RPC par bloc ; les
 * montants viennent des RPC, le front ne recompte rien.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PeriodRange } from '../context/period';
import { rpc } from '../pilotage/data';

export interface PlatformTotals {
  gmv: number; club_revenue: number; yuno_revenue: number; refunds_total: number; refunds_count: number;
  tx_count: number; tickets_qty: number; ticket_sales: number; tables_booked: number; avg_order: number; take_rate: number;
}
export interface PlatformAnalytics {
  totals: PlatformTotals;
  by_day: Array<{ d: string; tickets: number; tables: number; yuno: number; refunds: number; ticket_n: number; table_n: number }>;
  top_venues: Array<{ id: string; name: string; city: string | null; revenue: number; yuno: number; tx: number }>;
  top_events: Array<{ id: string; title: string; venue_name: string | null; start_at: string | null; revenue: number; tickets: number; tables: number }>;
  top_organizers: Array<{ user_id: string; name: string; revenue: number; events_count: number }>;
  venue_cities: Array<{ city: string; revenue: number; tx: number }>;
}

/** Ventes et commissions : la période et la précédente (admin_platform_analytics). */
export function usePlatformAnalytics(range: PeriodRange) {
  return useQuery({
    queryKey: ['admin', 'money', 'analytics', range.days, range.from.toISOString().slice(0, 16)],
    queryFn: async () => {
      const [cur, prev] = await Promise.all([
        rpc<PlatformAnalytics>('admin_platform_analytics', { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
        rpc<PlatformAnalytics>('admin_platform_analytics', { p_from: range.prevFrom.toISOString(), p_to: range.prevTo.toISOString() }),
      ]);
      return { cur, prev };
    },
    staleTime: 60_000,
  });
}

/** Guest list de la période : inscriptions, un nombre à part (aucun euro). */
export function useGuestlistCount(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'money', 'gl', includeDemo],
    queryFn: () => rpc<{ total: number; entered?: number; signups?: number }>('admin_orders_list', {
      p_kind: 'guestlist', p_search: null, p_status: null, p_limit: 1, p_offset: 0, p_include_demo: includeDemo,
    }),
    staleTime: 60_000,
  });
}

export type OrderKind = 'tickets' | 'tables' | 'guestlist';
export interface OrderRow {
  id: string; user_email: string | null; full_name: string | null; venue_id: string | null; venue_name: string | null;
  event_title: string | null; zone_name: string | null; amount: number | null; club_gross: number | null;
  status: string; created_at: string; host_name?: string | null; part_label?: string | null; holder_type?: string | null;
  entry_type?: string | null; event_start_at?: string | null; scanned_at?: string | null;
}
export interface OrdersPage { total: number; revenue: number; refunds: number; entered?: number; signups?: number; rows: OrderRow[] }

export const ORDERS_PAGE_SIZE = 25;

export function useOrders(kind: OrderKind, search: string, status: string, page: number, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'money', 'orders', kind, search, status, page, includeDemo],
    queryFn: () => rpc<OrdersPage>('admin_orders_list', {
      p_kind: kind, p_search: search || null, p_status: status === 'all' ? null : status,
      p_limit: ORDERS_PAGE_SIZE, p_offset: page * ORDERS_PAGE_SIZE, p_include_demo: includeDemo,
    }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

/** Remboursement par la fonction `owner-refund` (super admin autorisé, journal d'audit). */
export async function refundSale(kind: 'tickets' | 'tables', id: string, amount: number, reason: string): Promise<number> {
  const type = kind === 'tickets' ? 'ticket' : 'table_reservation';
  const { data, error } = await supabase.functions.invoke('owner-refund', {
    body: { items: [{ type, id, amount }], reason },
  });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string; amount?: number } | null;
  if (r && r.success === false) throw new Error(r.error || 'refund_failed');
  return r?.amount ?? amount;
}

export interface MoneyAlert {
  id: string; type: string; title: string | null; message: string | null; priority: string | null; at: string;
  reference_type: string | null; reference_id: string | null; event_id: string | null; metadata: Record<string, unknown> | null;
}
export interface TransferIssue {
  id: string; source: string; event_id: string; event_title: string | null; event_date: string | null;
  from: string; to: string; from_name: string | null; to_name: string | null; amount: number; reference: string;
  status: 'pending' | 'disputed'; due_at: string | null; sent_at: string | null; disputed_at: string | null;
  dispute_reason: string | null; reminder_count: number; days_late: number | null;
}
export interface PayoutIssue {
  id: string; status: string; amount: number; period: string | null; created_at: string; confirm_due_at: string | null;
  disputed_at: string | null; dispute_reason: string | null; reference: string | null; promoter: string | null;
  payer: string | null; payer_key: string; reason: 'disputed' | 'unconfirmed' | 'not_sent';
}
export interface MoneyIssues { alerts: MoneyAlert[]; transfers: TransferIssue[]; payouts: PayoutIssue[] }

export const ISSUES_KEY = ['admin', 'money', 'issues'] as const;

export function useMoneyIssues(includeDemo: boolean) {
  return useQuery({
    queryKey: [...ISSUES_KEY, includeDemo],
    queryFn: () => rpc<MoneyIssues>('admin_money_issues', { p_include_demo: includeDemo }),
    staleTime: 30_000,
  });
}

export function useIssueActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ISSUES_KEY });
  return {
    markDone: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => rpc('admin_money_issue_done', { p_notification_id: id, p_reason: reason }),
      onSuccess: done,
    }),
    resolveTransfer: useMutation({
      mutationFn: ({ id, outcome, reason }: { id: string; outcome: 'received' | 'cancelled'; reason: string }) =>
        rpc('admin_resolve_coorg_transfer', { p_transfer_id: id, p_outcome: outcome, p_note: reason }),
      onSuccess: done,
    }),
  };
}

/** Argent de Yuno CRM (crm_admin_money, recopie de l'ex-page Argent CRM). */
export interface CrmMoney {
  cfg: { price_month: number; price_month_next: number; price_year: number; price_switch_at?: number; vat_rate?: number };
  kpi: { mrr: number; paying: number; lost90: number; active_start: number; new_per_month: number; late: number };
  months: Array<{ m: string; new: number; newN: number; lost: number; lostN: number; mrr: number }>;
  subs: Array<{ id: string; name: string | null; interval: string | null; since: string; next: string | null; late: boolean; price: number }>;
  weeks: Array<{ w: string; eur: number; n: number }>;
  buys: Array<{ at: string; id: string; name: string | null; yunits: number; eur: number }>;
  buyers: Array<{ id: string; name: string | null; n: number; eur: number; yunits: number }>;
  margin: Array<{ id: string; name: string | null; state: string; sub: number; recharge: number; cost: number; revenue: number; margin: number }>;
}

export function useCrmMoney(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'money', 'crm', includeDemo],
    queryFn: () => rpc<CrmMoney>('crm_admin_money', { p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export interface CostsMonth {
  m: string; ai_auto: number;
  lines: Array<{ id: string; item: string; amount: number; note: string | null; by: string | null; at: string }>;
}
export const COSTS_KEY = ['admin', 'money', 'costs'] as const;

export function useCosts() {
  return useQuery({
    queryKey: COSTS_KEY,
    queryFn: () => rpc<{ usd_eur: number; months: CostsMonth[] }>('admin_costs_list', { p_months: 12, p_usd_eur: 0.92 }),
    staleTime: 60_000,
  });
}

export function useCostActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: COSTS_KEY });
  return {
    set: useMutation({
      mutationFn: (v: { month: string; item: string; amount: number; note: string; reason: string }) =>
        rpc('admin_cost_set', { p_month: `${v.month}-01`, p_item: v.item, p_amount: v.amount, p_note: v.note, p_reason: v.reason }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (v: { id: string; reason: string }) => rpc('admin_cost_delete', { p_id: v.id, p_reason: v.reason }),
      onSuccess: done,
    }),
  };
}

export interface InvoiceRow {
  id: string; number: string; seller_kind: string; seller: string | null; seller_key: string;
  sale_type: 'ticket' | 'table' | 'order'; sale_id: string; amount: number | null; at: string;
}
export const INVOICES_PAGE_SIZE = 50;

export function useInvoices(page: number, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'money', 'invoices', page, includeDemo],
    queryFn: () => rpc<{ total: number; rows: InvoiceRow[] }>('admin_invoices_list', {
      p_limit: INVOICES_PAGE_SIZE, p_offset: page * INVOICES_PAGE_SIZE, p_include_demo: includeDemo,
    }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
