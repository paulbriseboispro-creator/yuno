import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type AgencyPromoterGroup = {
  id: string;
  agency_id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type AgencyPromoter = {
  id: string;
  user_id: string;
  agency_id: string | null;
  agency_group_id: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  promo_code: string | null;
  is_active: boolean;
  pending_amount: number;
  total_paid: number;
  ticket_commission_type: string;
  ticket_commission_value: number;
  table_commission_type: string;
  table_commission_value: number;
  agency_can_sell_tickets: boolean;
  agency_can_sell_tables: boolean;
  agency_ticket_cap: number | null;
  agency_table_cap: number | null;
  profile_image_url: string | null;
  venues?: { name: string } | null;
};

export type AgencyContract = {
  id: string;
  agency_id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  status: string;
  override_type: string | null;
  override_value: number;
  agency_signed_at: string | null;
  club_signed_at: string | null;
  created_at: string;
  venues?: { name: string } | null;
};

export type AgencyConversion = {
  id: string;
  agency_id: string;
  promoter_id: string | null;
  event_id: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  gross_amount: number;
  margin_amount: number;
  net_amount: number;
  club_status: string;
  created_at: string;
};

export type AgencyTotals = {
  receivableFromClubs: number;
  payableToPromoters: number;
  marginRealized: number;
  grossLifetime: number;
  rosterCount: number;
  activeClubs: number;
};

export function useAgencyData(agencyId: string | null) {
  const [promoters, setPromoters] = useState<AgencyPromoter[]>([]);
  const [contracts, setContracts] = useState<AgencyContract[]>([]);
  const [conversions, setConversions] = useState<AgencyConversion[]>([]);
  const [groups, setGroups] = useState<AgencyPromoterGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!agencyId) {
      setPromoters([]); setContracts([]); setConversions([]); setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const db = supabase as any;
    const [pRes, cRes, convRes, gRes] = await Promise.all([
      db.from('promoters')
        .select('*, venues(name)')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false }),
      db.from('agency_venue_contracts')
        .select('*, venues(name)')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false }),
      db.from('agency_conversions')
        .select('*')
        .eq('agency_id', agencyId),
      db.from('agency_promoter_groups')
        .select('*')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: true }),
    ]);
    setPromoters((pRes.data as AgencyPromoter[]) ?? []);
    setContracts((cRes.data as AgencyContract[]) ?? []);
    setConversions((convRes.data as AgencyConversion[]) ?? []);
    setGroups((gRes.data as AgencyPromoterGroup[]) ?? []);
    setLoading(false);
  }, [agencyId]);

  useEffect(() => { refetch(); }, [refetch]);

  const totals: AgencyTotals = {
    receivableFromClubs: conversions
      .filter(c => c.club_status === 'pending')
      .reduce((s, c) => s + Number(c.gross_amount || 0), 0),
    payableToPromoters: promoters
      .reduce((s, p) => s + Number(p.pending_amount || 0), 0),
    marginRealized: conversions
      .reduce((s, c) => s + Number(c.margin_amount || 0), 0),
    grossLifetime: conversions
      .reduce((s, c) => s + Number(c.gross_amount || 0), 0),
    rosterCount: promoters.length,
    activeClubs: contracts.filter(c => c.status === 'active').length,
  };

  return { promoters, contracts, conversions, groups, totals, loading, refetch };
}

export function promoterName(
  p: Pick<AgencyPromoter, 'first_name' | 'last_name' | 'name' | 'promo_code'>
): string {
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return full || p.name || p.promo_code || 'Promoteur';
}

export function contractScopeLabel(c: AgencyContract): string {
  return c.venues?.name || (c.organizer_user_id ? 'Organisateur' : c.venue_id || 'Club');
}
