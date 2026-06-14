import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Megaphone, Ticket, Euro, Percent, MousePointerClick, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface PromoterEventStats {
  promoterId: string;
  userId: string;
  promoCode: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profileImageUrl: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  commission: number;
  conversionRate: number;
}

interface Props {
  eventId: string;
}

/**
 * Reusable promoter performance module strictly scoped to a single event.
 * Used by both the standard Owner Promoters page (for upcoming events) and
 * the Co-event Dashboard.
 */
export function EventPromotersModule({ eventId }: Props) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [promoters, setPromoters] = useState<PromoterEventStats[]>([]);
  const [totals, setTotals] = useState({
    clicks: 0,
    conversions: 0,
    revenue: 0,
    commission: 0,
    ticketsSold: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Get all clicks for this event
        const { data: clicks } = await supabase
          .from('promoter_clicks')
          .select('promoter_id')
          .eq('event_id', eventId);

        // 2. Get all conversions for this event
        const { data: conversions } = await supabase
          .from('promoter_conversions')
          .select('promoter_id, amount, commission, status, conversion_type')
          .eq('event_id', eventId);

        const promoterIds = new Set<string>();
        (clicks || []).forEach(c => promoterIds.add(c.promoter_id));
        (conversions || []).forEach(c => promoterIds.add(c.promoter_id));

        if (promoterIds.size === 0) {
          if (!cancelled) {
            setPromoters([]);
            setTotals({ clicks: 0, conversions: 0, revenue: 0, commission: 0, ticketsSold: 0 });
          }
          return;
        }

        // 3. Fetch promoter profiles
        const { data: promoterRows } = await supabase
          .from('promoters')
          .select('id, user_id, promo_code, profile_image_url')
          .in('id', Array.from(promoterIds));

        const userIds = (promoterRows || []).map(p => p.user_id);
        const { data: profiles } = await supabase
          .from('profiles').select('id, email, first_name, last_name').in('id', userIds);
        const profileMap = new Map((profiles || []).map(p => [p.id, p]));

        // 4. Aggregate per promoter
        const clickCounts: Record<string, number> = {};
        (clicks || []).forEach(c => { clickCounts[c.promoter_id] = (clickCounts[c.promoter_id] || 0) + 1; });

        const convStats: Record<string, { conversions: number; revenue: number; commission: number; tickets: number }> = {};
        let totRevenue = 0, totCommission = 0, totTickets = 0;
        (conversions || []).forEach(c => {
          if (!convStats[c.promoter_id]) convStats[c.promoter_id] = { conversions: 0, revenue: 0, commission: 0, tickets: 0 };
          const amt = Number(c.amount || 0);
          const com = Number(c.commission || 0);
          convStats[c.promoter_id].conversions++;
          convStats[c.promoter_id].revenue += amt;
          convStats[c.promoter_id].commission += com;
          if (c.conversion_type === 'ticket' && amt > 0) convStats[c.promoter_id].tickets++;
          totRevenue += amt;
          totCommission += com;
          if (c.conversion_type === 'ticket' && amt > 0) totTickets++;
        });

        const mapped: PromoterEventStats[] = (promoterRows || []).map(p => {
          const prof = profileMap.get(p.user_id);
          const clk = clickCounts[p.id] || 0;
          const conv = convStats[p.id] || { conversions: 0, revenue: 0, commission: 0, tickets: 0 };
          return {
            promoterId: p.id,
            userId: p.user_id,
            promoCode: p.promo_code,
            firstName: prof?.first_name || null,
            lastName: prof?.last_name || null,
            email: prof?.email || '',
            profileImageUrl: p.profile_image_url,
            clicks: clk,
            conversions: conv.conversions,
            revenue: conv.revenue,
            commission: conv.commission,
            conversionRate: clk > 0 ? (conv.conversions / clk) * 100 : 0,
          };
        }).sort((a, b) => b.revenue - a.revenue);

        if (!cancelled) {
          setPromoters(mapped);
          setTotals({
            clicks: (clicks || []).length,
            conversions: (conversions || []).length,
            revenue: totRevenue,
            commission: totCommission,
            ticketsSold: totTickets,
          });
        }
      } catch (err) {
        console.error('EventPromotersModule fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (promoters.length === 0) {
    return (
      <Card className="owner-card border-0">
        <CardContent className="p-8 text-center text-muted-foreground text-sm">
          <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
          {t('coEvent.noPromoters')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={MousePointerClick} label={t('coEvent.kpiClicks')} value={totals.clicks.toString()} />
        <KpiCard icon={Ticket} label={t('coEvent.kpiTicketsSold')} value={totals.ticketsSold.toString()} />
        <KpiCard icon={Euro} label={t('coEvent.kpiRevenue')} value={`${totals.revenue.toFixed(0)}€`} />
        <KpiCard icon={Percent} label={t('coEvent.kpiCommission')} value={`${totals.commission.toFixed(0)}€`} accent />
      </div>

      {/* Per-promoter table */}
      <Card className="owner-card border-0">
        <CardHeader><CardTitle className="text-base">{t('coEvent.perfByPromoter')}</CardTitle></CardHeader>
        <CardContent className="space-y-2 px-3">
          {promoters.map((p, i) => (
            <div key={p.promoterId} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/30 transition-colors">
              <span className="text-sm font-bold text-muted-foreground w-5 text-center">{i + 1}</span>
              <Avatar className="h-9 w-9">
                <AvatarImage src={p.profileImageUrl || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {p.firstName?.[0] || p.promoCode[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : p.email}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono">@{p.promoCode}</p>
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs text-muted-foreground">Clics</p>
                <p className="text-sm font-semibold">{p.clicks}</p>
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs text-muted-foreground">Ventes</p>
                <p className="text-sm font-semibold">{p.conversions}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">CA</p>
                <p className="text-sm font-bold">{p.revenue.toFixed(0)}€</p>
              </div>
              <Badge variant="outline" className="hidden md:flex text-xs">
                <TrendingUp className="h-3 w-3 mr-1" />
                {p.conversionRate.toFixed(0)}%
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: boolean }) {
  return (
    <Card className="owner-stat border-0">
      <CardContent className="p-3 text-center">
        <Icon className={`h-5 w-5 mx-auto mb-1 ${accent ? 'text-primary' : 'text-muted-foreground'}`} />
        <p className={`text-2xl font-bold ${accent ? 'text-primary' : ''}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
