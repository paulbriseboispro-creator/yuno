import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId, scopeReady, scopeEventsOr } from '@/lib/promoterScopeHelpers';

type DateRange = '7d' | '30d' | '90d' | 'all';

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
      // Fetch promoters scoped to venue OR organizer
      const { data: promotersData } = await supabase
        .from('promoters').select('id, user_id, promo_code, is_active, profile_image_url, instagram_url, whatsapp_number, pending_amount')
        .eq(scopeColumn, sid).order('created_at', { ascending: false });

      const userIds = (promotersData || []).map(p => p.user_id);
      const { data: profiles } = await supabase
        .from('profiles').select('id, email, first_name, last_name').in('id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const promoterIds = (promotersData || []).map(p => p.id);

      // Clicks
      let clicksQuery = supabase.from('promoter_clicks').select('promoter_id').in('promoter_id', promoterIds);
      if (dateFrom) clicksQuery = clicksQuery.gte('clicked_at', dateFrom);
      if (eventFilter) clicksQuery = clicksQuery.eq('event_id', eventFilter);
      const { data: clicksData } = await clicksQuery;

      // Conversions
      let convsQuery = supabase.from('promoter_conversions').select('promoter_id, amount, commission, status, conversion_type').in('promoter_id', promoterIds);
      if (dateFrom) convsQuery = convsQuery.gte('created_at', dateFrom);
      if (eventFilter) convsQuery = convsQuery.eq('event_id', eventFilter);
      const { data: convsData } = await convsQuery;

      // Build per-promoter stats
      const clickCounts: Record<string, number> = {};
      (clicksData || []).forEach(c => { clickCounts[c.promoter_id] = (clickCounts[c.promoter_id] || 0) + 1; });

      const convStats: Record<string, { conversions: number; revenue: number; commission: number }> = {};
      let totalTickets = 0, totalRevenue = 0, pendingComm = 0, approvedComm = 0, paidComm = 0;

      (convsData || []).forEach(c => {
        if (!convStats[c.promoter_id]) convStats[c.promoter_id] = { conversions: 0, revenue: 0, commission: 0 };
        convStats[c.promoter_id].conversions++;
        convStats[c.promoter_id].revenue += Number(c.amount || 0);
        convStats[c.promoter_id].commission += Number(c.commission || 0);
        if (c.conversion_type === 'ticket' && Number(c.amount || 0) > 0) totalTickets++;
        totalRevenue += Number(c.amount || 0);
        if (c.status === 'pending') pendingComm += Number(c.commission || 0);
        else if (c.status === 'approved') approvedComm += Number(c.commission || 0);
        else if (c.status === 'paid') paidComm += Number(c.commission || 0);
      });

      const totalClicks = Object.values(clickCounts).reduce((a, b) => a + b, 0);
      const totalConversions = (convsData || []).length;

      const mapped: PromoterSummary[] = (promotersData || []).map(p => {
        const profile = profileMap.get(p.user_id);
        const clicks = clickCounts[p.id] || 0;
        const conv = convStats[p.id] || { conversions: 0, revenue: 0, commission: 0 };
        return {
          id: p.id, userId: p.user_id, promoCode: p.promo_code,
          firstName: profile?.first_name || null, lastName: profile?.last_name || null,
          email: profile?.email || '', isActive: p.is_active, profileImageUrl: p.profile_image_url,
          instagramUrl: p.instagram_url, whatsappNumber: p.whatsapp_number,
          clicks, conversions: conv.conversions, revenue: conv.revenue, commission: conv.commission,
          pendingAmount: Number(p.pending_amount || 0),
          conversionRate: clicks > 0 ? (conv.conversions / clicks) * 100 : 0,
        };
      });

      setPromoters(mapped);
      setKpis({
        totalPromoters: mapped.length, ticketsSold: totalTickets, revenue: totalRevenue,
        pendingCommission: pendingComm, approvedCommission: approvedComm, paidCommission: paidComm,
        conversionRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0,
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
