import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subDays, subHours, startOfDay } from 'date-fns';
import type { AnalyticsMode, DateRange } from '@/hooks/useAnalyticsData';

/**
 * Promoter ROI — which promoters actually drive revenue, not just clicks.
 * Attribution comes from promoter_conversions (amount = transaction value the
 * promoter is credited with, commission = what the promoter earns). Clicks come
 * from promoter_clicks. ROI = revenue generated per €1 of commission paid.
 */
export interface PromoterRow {
  id: string;
  name: string;
  promoCode: string;
  avatarUrl: string | null;
  revenue: number;      // attributed transaction value
  commission: number;   // owed to the promoter
  conversions: number;
  clicks: number;
  convRate: number;     // 0–100, conversions / clicks
}

export interface PromoterAnalytics {
  promoters: PromoterRow[];
  totalAttributed: number;
  totalCommission: number;
  totalConversions: number;
  totalClicks: number;
  convRate: number;     // 0–100 overall
  roi: number;          // revenue per €1 commission
}

function getStartDate(dateRange: DateRange): Date | null {
  if (dateRange === '24h') return subHours(new Date(), 24);
  if (dateRange === '48h') return subHours(new Date(), 48);
  if (dateRange === '72h') return subHours(new Date(), 72);
  if (dateRange === '7days') return startOfDay(subDays(new Date(), 7));
  if (dateRange === '30days') return startOfDay(subDays(new Date(), 30));
  return null;
}

interface UsePromoterAnalyticsProps {
  venueId?: string | null;
  dateRange: DateRange;
  mode: AnalyticsMode;
  selectedEventId: string | null;
}

export function usePromoterAnalytics({ venueId, dateRange, mode, selectedEventId }: UsePromoterAnalyticsProps) {
  const [data, setData] = useState<PromoterAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const { data: promoters } = await supabase
        .from('promoters')
        .select('id, first_name, last_name, promo_code, profile_image_url')
        .eq('venue_id', venueId);

      const ids = (promoters || []).map(p => p.id);
      if (ids.length === 0) {
        setData({ promoters: [], totalAttributed: 0, totalCommission: 0, totalConversions: 0, totalClicks: 0, convRate: 0, roi: 0 });
        return;
      }

      const startDate = mode === 'event' ? null : getStartDate(dateRange);
      const eventFilter = mode === 'event' && selectedEventId ? selectedEventId : null;

      let cq = supabase.from('promoter_conversions').select('promoter_id, amount, commission, event_id, created_at').in('promoter_id', ids);
      if (eventFilter) cq = cq.eq('event_id', eventFilter);
      else if (startDate) cq = cq.gte('created_at', startDate.toISOString());
      const { data: conversions } = await cq;

      let kq = supabase.from('promoter_clicks').select('promoter_id, event_id, clicked_at').in('promoter_id', ids);
      if (eventFilter) kq = kq.eq('event_id', eventFilter);
      else if (startDate) kq = kq.gte('clicked_at', startDate.toISOString());
      const { data: clicks } = await kq;

      const convByPromoter = new Map<string, { revenue: number; commission: number; count: number }>();
      (conversions || []).forEach((c: any) => {
        const e = convByPromoter.get(c.promoter_id) || { revenue: 0, commission: 0, count: 0 };
        e.revenue += Number(c.amount) || 0;
        e.commission += Number(c.commission) || 0;
        e.count += 1;
        convByPromoter.set(c.promoter_id, e);
      });
      const clicksByPromoter = new Map<string, number>();
      (clicks || []).forEach((c: any) => clicksByPromoter.set(c.promoter_id, (clicksByPromoter.get(c.promoter_id) || 0) + 1));

      const rows: PromoterRow[] = (promoters || []).map(p => {
        const conv = convByPromoter.get(p.id) || { revenue: 0, commission: 0, count: 0 };
        const clk = clicksByPromoter.get(p.id) || 0;
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.promo_code || '—';
        return {
          id: p.id, name, promoCode: p.promo_code, avatarUrl: p.profile_image_url,
          revenue: conv.revenue, commission: conv.commission, conversions: conv.count, clicks: clk,
          convRate: clk > 0 ? Math.min((conv.count / clk) * 100, 100) : 0,
        };
      })
      .filter(r => r.revenue > 0 || r.clicks > 0)
      .sort((a, b) => b.revenue - a.revenue);

      const totalAttributed = rows.reduce((s, r) => s + r.revenue, 0);
      const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
      const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
      const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);

      setData({
        promoters: rows,
        totalAttributed, totalCommission, totalConversions, totalClicks,
        convRate: totalClicks > 0 ? Math.min((totalConversions / totalClicks) * 100, 100) : 0,
        roi: totalCommission > 0 ? totalAttributed / totalCommission : 0,
      });
    } catch (err) {
      console.error('Error fetching promoter analytics:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [venueId, dateRange, mode, selectedEventId]);

  useEffect(() => { if (venueId) fetch(); }, [venueId, fetch]);

  return { promoterAnalytics: data, loading };
}
