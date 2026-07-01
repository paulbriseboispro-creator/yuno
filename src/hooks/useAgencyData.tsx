import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/* Row shapes are loose (tables not yet in generated types) — cast via `as any`. */
export type AgencyPromoter = {
  id: string;
  user_id: string;
  agency_id: string | null;
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
  receivableFromClubs: number;  // Σ gross where club_status = pending
  payableToPromoters: number;   // Σ promoters.pending_amount
  marginRealized: number;       // Σ margin
  grossLifetime: number;        // Σ gross
  rosterCount: number;
  activeClubs: number;
};

export function useAgencyData(agencyId: string | null) {
  const [promoters, setPromoters] = useState<AgencyPromoter[]>([]);
  const [contracts, setContracts] = useState<AgencyContract[]>([]);
  const [conversions, setConversions] = useState<AgencyConversion[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!agencyId) {
      setPromoters([]); setContracts([]); setConversions([]); setLoading(false);
      return;
    }
    setLoading(true);
    const db = supabase as any;
    const [pRes, cRes, convRes] = await Promise.all([
      db.from('promoters').select('*, venues(name)').eq('agency_id', agencyId).order('created_at', { ascending: false }),
      db.from('agency_venue_contracts').select('*, venues(name)').eq('agency_id', agencyId).order('created_at', { ascending: false }),
      db.from('agency_conversions').select('*').eq('agency_id', agencyId),
    ]);
    setPromoters((pRes.data as AgencyPromoter[]) ?? []);
    setContracts((cRes.data as AgencyContract[]) ?? []);
    setConversions((convRes.data as AgencyConversion[]) ?? []);
    setLoading(false);
  }, [agencyId]);

  useEffect(() => { refetch(); }, [refetch]);

  const totals: AgencyTotals = {
    receivableFromClubs: conversions.filter(c => c.club_status === 'pending').reduce((s, c) => s + Number(c.gross_amount || 0), 0),
    payableToPromoters: promoters.reduce((s, p) => s + Number(p.pending_amount || 0), 0),
    marginRealized: conversions.reduce((s, c) => s + Number(c.margin_amount || 0), 0),
    grossLifetime: conversions.reduce((s, c) => s + Number(c.gross_amount || 0), 0),
    rosterCount: promoters.length,
    activeClubs: contracts.filter(c => c.status === 'active').length,
  };

  return { promoters, contracts, conversions, totals, loading, refetch };
}

export function promoterName(p: AgencyPromoter): string {
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return full || p.name || p.promo_code || 'Promoteur';
}

export function contractScopeLabel(c: AgencyContract): string {
  return c.venues?.name || (c.organizer_user_id ? 'Organisateur' : c.venue_id || 'Club');
}
