/** Types et lectures de la rubrique Clients (RPC existantes + admin_clients_period / admin_person). */
import { supabase } from '@/integrations/supabase/client';

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc(name as any, args as any);
  if (error) throw new Error(error.message);
  return data as T;
}

export type SegmentKey = 'champions' | 'loyal' | 'promising' | 'new' | 'at_risk' | 'dormant' | 'lost';
export const SEGMENT_KEYS: SegmentKey[] = ['champions', 'loyal', 'promising', 'new', 'at_risk', 'dormant', 'lost'];
export const TIER_KEYS = ['platinum', 'gold', 'silver', 'bronze'] as const;
/** Piliers : les boissons sont en pause (aucune trace dans l'admin). */
export const PILLAR_KEYS = ['tickets', 'tables', 'mixed', 'guestlist'] as const;

export interface Overview {
  totals: {
    customers: number; with_account: number; active_30d: number; new_30d: number;
    repeat_rate: number; with_app: number; reach_email: number; reach_sms: number; unreachable: number;
    paying: number; guestlist_only: number;
  };
  segments: { key: string; count: number; revenue: number; avg_ltv: number }[];
  cohorts: { month: string; new_customers: number; revenue: number }[];
}

export interface Period {
  days: number;
  clients: { current: number; previous: number };
  new: { current: number; previous: number };
  active: { current: number; previous: number };
  returning: { current: number | null; previous: number | null };
  daily: { day: string; new: number; prev: number }[];
}

export interface CustomerRow {
  email: string; user_id: string | null; first_name: string | null; last_name: string | null;
  city: string | null; total_spent: number; rev_90d: number; visit_nights: number;
  ticket_count: number; table_count: number; guestlist_count: number; venues_count: number;
  venue_names: string; first_at: string; last_at: string;
  segment: SegmentKey; tier: string; category: string;
  has_account: boolean; has_app: boolean; push_on: boolean;
  email_opt_in: boolean; sms_opt_in: boolean; email_suppressed: boolean;
  is_suspended: boolean; tags: string[];
}

export interface CustomerList { total: number; rows: CustomerRow[] }

export interface Purchase {
  kind: 'ticket' | 'table' | 'guestlist'; id: string; ref: string | null;
  event_id: string | null; event_title: string | null; event_at: string | null;
  venue_id: string | null; venue_name: string | null; organizer_name: string | null;
  amount: number; status: string | null; at: string; qty: number | null;
}

export interface PersonDetail {
  identity: {
    user_id: string | null; first_name: string | null; last_name: string | null; phone: string | null;
    city: string | null; gender: string | null; age: number | null; created_at: string | null;
    is_suspended: boolean; has_account: boolean; has_app: boolean; app_platforms: string[];
    email_opt_in: boolean; sms_opt_in: boolean; email_suppressed: boolean;
  } | null;
  stats: {
    total_spent: number; rev_90d: number; avg_basket: number; visit_nights: number;
    ticket_count: number; table_count: number; venues_count: number;
    first_at: string; last_at: string; segment: SegmentKey; tier: string; category: string;
  } | null;
  tags: string[];
  notes: { id: string; body: string; created_at: string }[];
  incidents: { venue_name: string; type: string; reason: string; created_at: string }[];
  banned_venues: { venue_name: string; reason: string | null; banned_at: string }[];
}

export interface Person {
  found: boolean; email: string; user_id: string | null;
  detail: PersonDetail | null;
  purchases: Purchase[];
  consents: {
    subscriptions: { scope_kind: 'venue' | 'organizer' | 'platform'; scope_name: string | null; product: string | null; opted_in: boolean; opted_out_at: string | null; source: string | null; consent_source: string | null; recorded_at: string }[];
    opt_outs: { scope_name: string | null; reason: string; product: string | null; at: string }[];
    suppressions: { reason: string; source: string | null; at: string }[];
  };
  messages: {
    emails: { subject: string; campaign: string; at: string; product: string | null; sender: string | null }[];
    push: { title: string; event_type: string; at: string; sender: string | null }[];
  };
  account: {
    profile: { id: string; email: string; first_name: string | null; last_name: string | null; city: string | null; venue_id: string | null; created_at: string; mfa_enabled: boolean; is_suspended: boolean; suspension_reason: string | null; alive: boolean };
    roles: { role: string; created_at: string }[];
    owned_venues: { id: string; name: string }[];
  } | null;
}

export function personName(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ''} ${last ?? ''}`.trim();
}
