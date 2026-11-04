import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PromoterScope } from '@/hooks/usePromoterScope';
import { promoterConversionRate } from '@/lib/promoterMetrics';
import { getScopeFilter, scopeId, scopeReady, scopeEventsOr } from '@/lib/promoterScopeHelpers';
import type { DateRange } from '@/components/promoter/DateRangeFilter';

interface PromoterSummary {
  id: string;
  userId: string;
  promoCode: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  isActive: boolean;
  profileImageUrl: string | null;
  instagramUrl: string | null;
  whatsappNumber: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  commission: number;
  pendingAmount: number;
  conversionRate: number;
}

interface OverviewKPIs {
  totalPromoters: number;
  ticketsSold: number;
  revenue: number;
  pendingCommission: number;
  approvedCommission: number;
  paidCommission: number;
  conversionRate: number;
}

/**
 * Unified promoter overview data for owner / organizer / manager dashboards.
 * Scoping (venue vs organizer) is resolved by the PromoterScope, so a single
 * hook backs every dashboard mode. Pass the result of usePromoterScope().
 */
export function usePromoterOwnerData(scope: PromoterScope) {
  const sid = scopeId(scope);
  const ready = scopeReady(scope);
  const { column: scopeColumn } = getScopeFilter(scope);
  const eventsOr = scopeEventsOr(scope);

  const [promoters, setPromoters] = useState<PromoterSummary[]>([]);
  const [kpis, setKpis] = useState<OverviewKPIs>({
    totalPromoters: 0, ticketsSold: 0, revenue: 0,
    pendingCommission: 0, approvedCommission: 0, paidCommission: 0, conversionRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; title: string }>>([]);

  const dateFrom = useMemo(() => {
    if (dateRange === 'all') return null;
    const d = new Date();
    if (dateRange === '7d') d.setDate(d.getDate() - 7);
    else if (dateRange === '30d') d.setDate(d.getDate() - 30);
    else if (dateRange === '90d') d.setDate(d.getDate() - 90);
    return d.toISOString();
  }, [dateRange]);

  const fetchData = useCallback(async () => {
    if (!ready || !sid) return;
    setLoading(true);
    try {
      // Fetch promoters scoped to venue OR organizer. Agency-managed promoters
      // (agency_id set) are excluded here — the club sees them aggregated under
      // "Partner agencies" (OwnerAgencies), not mixed into its own direct roster.
      const { data: promotersData } = await supabase
        .from('promoters').select('id, user_id, promo_code, is_active, profile_image_url, instagram_url, whatsapp_number, pending_amount')
        .eq(scopeColumn, sid).is('agency_id', null).order('created_at', { ascending: false });

      const userIds = (promotersData || []).map(p => p.user_id);
      const { data: profiles } = await supabase
        .from('profiles').select('id, email, first_name, last_name').in('id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const promoterIds = (promotersData || []).map(p => p.id);

      // Clics, ventes attribuées et commissions comptés EN SQL, par promoteur
      // (get_promoter_overview_stats, sous la RLS de l'appelant). Les lire en
      // lignes plafonnait à 1 000 clics / conversions (PostgREST) : ventes et
      // taux de conversion devenaient faux sans rien dire. Règles inchangées :
      // ventes remboursées ('cancelled') exclues, lignes 'override' (part du
      // chef d'équipe) comptées dans l'argent mais pas comme des ventes,
      // billets et tables PAYANTS seuls dans le taux de conversion.
      const { data: statsData, error: statsError } = promoterIds.length
        ? await supabase.rpc('get_promoter_overview_stats', {
            p_promoter_ids: promoterIds,
            p_from: dateFrom,
            p_event_id: eventFilter,
          })
        : { data: [], error: null };
      if (statsError) throw statsError;

      type Stat = { clicks: number; conversions: number; revenue: number; commission: number; tickets: number; tables: number };
      const emptyStat: Stat = { clicks: 0, conversions: 0, revenue: 0, commission: 0, tickets: 0, tables: 0 };
      const statsById = new Map<string, Stat>();
      let totalClicks = 0, totalTickets = 0, totalTables = 0, totalRevenue = 0, pendingComm = 0, approvedComm = 0, paidComm = 0;
      (statsData || []).forEach(s => {
        const stat: Stat = {
          clicks: Number(s.clicks) || 0,
          conversions: Number(s.conversions) || 0,
          revenue: Number(s.revenue) || 0,
          commission: Number(s.commission) || 0,
          tickets: Number(s.tickets) || 0,
          tables: Number(s.tables) || 0,
        };
        statsById.set(s.promoter_id, stat);
        totalClicks += stat.clicks;
        totalTickets += stat.tickets;
        totalTables += stat.tables;
        totalRevenue += stat.revenue;
        pendingComm += Number(s.pending_commission) || 0;
        approvedComm += Number(s.approved_commission) || 0;
        paidComm += Number(s.paid_commission) || 0;
      });

      const mapped: PromoterSummary[] = (promotersData || []).map(p => {
        const profile = profileMap.get(p.user_id);
        const conv = statsById.get(p.id) || emptyStat;
        const clicks = conv.clicks;
        return {
          id: p.id, userId: p.user_id, promoCode: p.promo_code,
          firstName: profile?.first_name || null, lastName: profile?.last_name || null,
          email: profile?.email || '', isActive: p.is_active, profileImageUrl: p.profile_image_url,
          instagramUrl: p.instagram_url, whatsappNumber: p.whatsapp_number,
          clicks, conversions: conv.conversions, revenue: conv.revenue, commission: conv.commission,
          pendingAmount: Number(p.pending_amount || 0),
          conversionRate: promoterConversionRate(conv.tickets + conv.tables, clicks),
        };
      });

      setPromoters(mapped);
      setKpis({
        totalPromoters: mapped.length, ticketsSold: totalTickets, revenue: totalRevenue,
        pendingCommission: pendingComm, approvedCommission: approvedComm, paidCommission: paidComm,
        conversionRate: promoterConversionRate(totalTickets + totalTables, totalClicks),
      });
    } catch (err) {
      console.error('Error fetching promoter data:', err);
    } finally {
      setLoading(false);
    }
  }, [ready, sid, scopeColumn, dateFrom, eventFilter]);

  useEffect(() => {
    if (!ready || !sid) return;
    // Event filter options: venue events, or organizer lead/partner events
    let q = supabase.from('events').select('id, title');
    q = eventsOr ? q.or(eventsOr) : q.eq(scopeColumn, sid);
    q.order('start_at', { ascending: false }).limit(50).then(({ data }) => setEvents(data || []));
  }, [ready, sid, scopeColumn, eventsOr]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { promoters, kpis, loading, dateRange, setDateRange, eventFilter, setEventFilter, events, refetch: fetchData };
}
