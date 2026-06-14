import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Customer base health (RFM) — does the club build a loyal crowd or churn it?
 * Built on the get_venue_customer_segments RPC (Recency/Frequency/Monetary per
 * customer). This is lifetime/rolling data about the customer base, so it is
 * intentionally NOT filtered by the page's period selector.
 */
export interface CustomerSegment { key: 'new' | 'active' | 'atRisk' | 'lapsed'; count: number; }

export interface CustomerAnalytics {
  totalCustomers: number;
  repeatRate: number;       // 0–100, share with > 1 visit night
  avgClv: number;           // average lifetime spend
  revenue90: number;
  revenuePrev90: number;
  growth90: number | null;  // % change, null when no prior base
  segments: CustomerSegment[];
  topCustomers: { name: string; totalSpent: number; visitNights: number; lastActivityAt: string | null }[];
}

const DAY = 86_400_000;

export function useCustomerAnalytics({ venueId }: { venueId?: string | null }) {
  const [data, setData] = useState<CustomerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase.rpc('get_venue_customer_segments', { p_venue_id: venueId });
      if (error) throw error;

      const customers = (rows || []) as any[];
      const total = customers.length;
      if (total === 0) {
        setData({ totalCustomers: 0, repeatRate: 0, avgClv: 0, revenue90: 0, revenuePrev90: 0, growth90: null, segments: [], topCustomers: [] });
        return;
      }

      const now = Date.now();
      let repeat = 0, spendSum = 0, rev90 = 0, revPrev90 = 0;
      const seg = { new: 0, active: 0, atRisk: 0, lapsed: 0 };

      customers.forEach(c => {
        const nights = Number(c.visit_nights) || 0;
        if (nights > 1) repeat += 1;
        spendSum += Number(c.total_spent) || 0;
        rev90 += Number(c.revenue_90d) || 0;
        revPrev90 += Number(c.revenue_prev_90d) || 0;

        const lastTs = c.last_activity_at || c.last_visit_at;
        const daysSince = lastTs ? (now - new Date(lastTs).getTime()) / DAY : Infinity;
        const firstTs = c.first_visit_at ? (now - new Date(c.first_visit_at).getTime()) / DAY : Infinity;
        if (daysSince > 90) seg.lapsed += 1;
        else if (daysSince > 30) seg.atRisk += 1;
        else if (firstTs <= 30 && nights <= 1) seg.new += 1;
        else seg.active += 1;
      });

      const topCustomers = [...customers]
        .sort((a, b) => (Number(b.total_spent) || 0) - (Number(a.total_spent) || 0))
        .slice(0, 8)
        .map(c => ({
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '—',
          totalSpent: Number(c.total_spent) || 0,
          visitNights: Number(c.visit_nights) || 0,
          lastActivityAt: c.last_activity_at || c.last_visit_at || null,
        }));

      setData({
        totalCustomers: total,
        repeatRate: (repeat / total) * 100,
        avgClv: spendSum / total,
        revenue90: rev90,
        revenuePrev90: revPrev90,
        growth90: revPrev90 > 0 ? ((rev90 - revPrev90) / revPrev90) * 100 : null,
        segments: [
          { key: 'new', count: seg.new },
          { key: 'active', count: seg.active },
          { key: 'atRisk', count: seg.atRisk },
          { key: 'lapsed', count: seg.lapsed },
        ],
        topCustomers,
      });
    } catch (err) {
      console.error('Error fetching customer analytics:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { if (venueId) fetch(); }, [venueId, fetch]);

  return { customerAnalytics: data, loading };
}
