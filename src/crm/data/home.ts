/** Données de l'accueil : un appel crm_home par espace et par période. */
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type HomePeriod = '24h' | '48h' | '7d' | '30d' | '90d';

export interface HomeTodo {
  id: string;
  kind: 'relaunch' | 'validate' | 'draft' | 'yunits' | 'contacts' | 'connect' | 'check' | 'first_send';
  tone: 'todo' | 'warn' | 'wait';
  params: Record<string, string | number | null>;
}

export interface CrmHome {
  now: string;
  tz: string;
  connection: { provider: string; status: string; last_ok_at: string | null; last_error_at: string | null; broken: boolean; broken_since: string | null } | null;
  sales: {
    period: HomePeriod; hourly: boolean; n: number; start: string; end: string;
    series: { t: string; cur: number; prev: number; tickets: number }[];
    total: number; prev_total: number; tickets: number; prev_tickets: number;
    sends: { at: string; name: string; channel: 'email' | 'sms'; id: string }[];
    has_any: boolean;
  };
  kpi: {
    clients: { total: number; today: number; spark: number[] };
    regulars: { total: number; month_delta: number; bars: number[]; min_nights: number; window_months: number };
    conversion: { id: string; name: string; sent_at: string; recipients: number; buyers: number; pct: number | null }[] | null;
    reach: { total: number; reachable: number; both: number; email_only: number; sms_only: number; none: number };
  };
  mission: { id: string; name: string; sent_at: string; recipients: number; clickers: number; buyers: number; revenue: number; yunits: number } | null;
  next: {
    id: string; title: string; start_at: string; end_at: string | null; tz: string; city: string | null;
    sold: number; today: number; left: number | null; days_to: number;
    curve: { day: string; jn: number; cur: number; prev: number | null }[];
    prev: { id: string; title: string; start_at: string; final: number } | null;
    buyers: { total: number; regulars: number; occasional: number; new: number };
  } | null;
  todo: HomeTodo[];
  wallet: { balance: number; reserved: number };
}

export function useCrmHome(period: HomePeriod) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'home', period],
    queryFn: () => rpc<CrmHome>('crm_home', { ...args, p_period: period }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
