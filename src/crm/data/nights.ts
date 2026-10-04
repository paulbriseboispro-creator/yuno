/**
 * Données de l'écran Soirées : les deux onglets en un appel (crm_nights) et le
 * tiroir d'une soirée (crm_night_detail). Règles de lecture dans la migration
 * 20261004190000_crm_nights.sql.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type NightMsgState = 'draft' | 'plan' | 'sent';

export interface NightMsg {
  id: string;
  channel: 'email' | 'sms';
  name: string | null;
  state: NightMsgState;
  at: string | null;
  /** Taux d'ouverture (0-100) d'un e-mail parti ; tiroir seulement. */
  open_pct?: number | null;
}

export interface NightTier { name: string; price: number | null; cap: number | null; sold: number }

export interface NightRow {
  id: string;
  title: string;
  series: string;
  start_at: string;
  end_at: string;
  tz: string;
  url: string | null;
  cover_url: string | null;
  street: string | null;
  city: string | null;
  lineup: string[];
  upcoming: boolean;
  sale_opens_at: string | null;
  sold: number;
  cap: number | null;
  sold_out: boolean;
  revenue: number;
  buyers: number;
  new_buyers: number;
  today: number;
  /** Soirées à venir seulement. */
  tiers: NightTier[] | null;
  msgs: NightMsg[] | null;
}

export interface NightsData { now: string; past_total: number; nights: NightRow[] }

export function useNights() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'nights'],
    queryFn: () => rpc<NightsData>('crm_nights', args),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export interface NightDetail {
  error?: 'not_found';
  id: string;
  title: string;
  series: string;
  start_at: string;
  end_at: string;
  tz: string;
  upcoming: boolean;
  url: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  lineup: string[];
  sale_opens_at: string | null;
  opened_at: string | null;
  sold: number;
  cap: number | null;
  sold_out: boolean;
  revenue: number;
  today: number;
  series_avg_fill: number | null;
  tiers: NightTier[];
  /** Un point par jour, du plus loin au plus près ; d = jours avant la soirée. */
  curve: { d: number; v: number; pv: number | null }[];
  prev: { id: string; title: string; start_at: string; same_series: boolean; total: number } | null;
  buyers: { total: number; new: number; occasional: number; regular: number };
  msgs: NightMsg[];
  synced_at: string | null;
}

export function useNightDetail(id: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night', id],
    queryFn: () => rpc<NightDetail>('crm_night_detail', { ...args, p_event_id: id }),
    enabled: !!id,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
