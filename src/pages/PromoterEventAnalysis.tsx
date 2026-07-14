import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import TrackedLinksManager from '@/components/tracking/TrackedLinksManager';
import { shareContent } from '@/lib/share';
import { toast } from 'sonner';
import {
  ArrowLeft, TrendingUp, Ticket, Calendar, Euro, Copy, Share2,
  MousePointerClick, BarChart3, Target, Clock, ArrowRight, Gift, Star
} from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

interface EventInfo {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  venue_id: string;
}

interface Conversion {
  id: string;
  conversion_type: string;
  amount: number;
  commission: number;
  status: string;
  created_at: string;
  ticket_id: string | null;
  ticketTypeName?: string;
  basePrice?: number;
}

interface RewardTier {
  min: number;
  max: number | null;
  reward_type: string;
  reward_config: Record<string, any>;
  ticketValue?: number;
}

interface RewardInfo {
  type: 'money' | 'tiers' | 'flat_advantage';
  tiers?: RewardTier[];
  currentTierIndex?: number;
  totalConversions: number;
  rewardType?: string;
  rewardConfig?: Record<string, any>;
}

/** Format price: show decimals only when needed */
const fmtPrice = (n: number): string => {
  if (n % 1 === 0) return `${n}€`;
  return `${n.toFixed(2)}€`;
};

function getRewardLabel(rewardType: string, rewardConfig: Record<string, any>, t: (k: string) => string): string {
  if (rewardType === 'money') {
    return `${rewardConfig?.value || 0}€ ${t('promoter.analysis.perSale')}`;
  }
  if (rewardType === 'free_drink') {
    return rewardConfig?.drink_name || '1 boisson offerte';
  }
  if (rewardType === 'discount') {
    if (rewardConfig?.discount_type === 'percentage') {
      return `${rewardConfig?.discount_value || 0}%`;
    }
    return `${rewardConfig?.discount_value || 0}€`;
  }
  if (rewardType === 'free_entry') {
    return 'Entrée gratuite';
  }
  if (rewardType === 'vip_access') {
    return 'Accès VIP';
  }
  return rewardType;
}

export default function PromoterEventAnalysis() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const ownerViewPromoterId = searchParams.get('promoter');
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoterId, setPromoterId] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState<string>('');
  const [promoterName, setPromoterName] = useState<string>('');
  const [clicks, setClicks] = useState(0);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [goalTarget, setGoalTarget] = useState<number | null>(null);
  const [clicksByDay, setClicksByDay] = useState<Array<{ date: string; clicks: number; conversions: number }>>([]);
  const [rewardInfo, setRewardInfo] = useState<RewardInfo | null>(null);

  const locale = language === 'fr' ? fr : enUS;
  const isOwnerView = !!ownerViewPromoterId;

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const { data: ev } = await supabase.from('events')
        .select('id, title, start_at, end_at, poster_url, venue_id')
        .eq('id', eventId).single();
      if (!ev) { setLoading(false); return; }
      setEvent(ev);

      let resolvedPromoterId: string | null = null;
      let resolvedPromoCode = '';
      let templateId: string | null = null;

      if (ownerViewPromoterId) {
        const { data: promo } = await supabase.from('promoters')
          .select('id, promo_code, user_id, default_commission_template_id')
          .eq('id', ownerViewPromoterId)
          .single();
        if (!promo) { setLoading(false); return; }
        resolvedPromoterId = promo.id;
        resolvedPromoCode = promo.promo_code;
        templateId = promo.default_commission_template_id;
        const { data: profile } = await supabase.from('profiles')
          .select('first_name, last_name')
          .eq('id', promo.user_id).single();
        if (profile) {
          setPromoterName(`${profile.first_name || ''} ${profile.last_name || ''}`.trim());
        }
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }
        const { data: promo } = await supabase.from('promoters')
          .select('id, promo_code, default_commission_template_id')
          .eq('user_id', user.id)
          .eq('venue_id', ev.venue_id)
          .eq('is_active', true)
          .maybeSingle();
        if (!promo) { setLoading(false); return; }
        resolvedPromoterId = promo.id;
        resolvedPromoCode = promo.promo_code;
        templateId = promo.default_commission_template_id;
      }

      setPromoterId(resolvedPromoterId);
      setPromoCode(resolvedPromoCode);

      const [clicksRes, convsRes, assignRes, clicksDetailRes, templateRes, allConvsCountRes] = await Promise.all([
        supabase.from('promoter_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('promoter_id', resolvedPromoterId)
          .eq('event_id', eventId),
        supabase.from('promoter_conversions')
          .select('id, conversion_type, amount, commission, status, created_at, ticket_id')
          .eq('promoter_id', resolvedPromoterId)
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        supabase.from('promoter_event_assignments')
          .select('goal_target')
          .eq('promoter_id', resolvedPromoterId)
          .eq('event_id', eventId)
          .maybeSingle(),
        supabase.from('promoter_clicks')
          .select('clicked_at')
          .eq('promoter_id', resolvedPromoterId)
          .eq('event_id', eventId)
          .order('clicked_at', { ascending: true }),
        templateId
          ? supabase.from('commission_templates').select('rules').eq('id', templateId).single()
          : Promise.resolve({ data: null }),
        supabase.from('promoter_conversions')
          .select('id', { count: 'exact', head: true })
          .eq('promoter_id', resolvedPromoterId)
          .eq('event_id', eventId)
          .gt('amount', 0),
      ]);

      setClicks(clicksRes.count || 0);

      // Parse reward info from template
      const rules = templateRes.data?.rules as Record<string, any> | null;
      const totalAllConversions = allConvsCountRes.count || 0;
      
      if (rules) {
        const tiers = rules.tiers as any[] | undefined;
        if (tiers && tiers.length > 0) {
          const parsedTiers: RewardTier[] = tiers.map(t => ({
            min: t.min,
            max: t.max ?? null,
            reward_type: t.reward_type || 'money',
            reward_config: t.reward_config || {},
            ticketValue: t.ticketValue ? Number(t.ticketValue) : undefined,
          }));
          
          let currentIdx = 0;
          for (let i = 0; i < parsedTiers.length; i++) {
            const tier = parsedTiers[i];
            const max = tier.max ?? Infinity;
            if (totalAllConversions >= tier.min && totalAllConversions <= max) {
              currentIdx = i;
              break;
            }
            if (totalAllConversions > (tier.max ?? Infinity)) {
              currentIdx = i + 1;
            }
          }
          currentIdx = Math.min(currentIdx, parsedTiers.length - 1);

          setRewardInfo({
            type: 'tiers',
            tiers: parsedTiers,
            currentTierIndex: currentIdx,
            totalConversions: totalAllConversions,
          });
        } else {
          const rewardType = rules.reward_type || 'money';
          if (rewardType !== 'money') {
            setRewardInfo({
              type: 'flat_advantage',
              totalConversions: totalAllConversions,
              rewardType,
              rewardConfig: rules.reward_config || {},
            });
          } else {
            setRewardInfo({ type: 'money', totalConversions: totalAllConversions });
          }
        }
      } else {
        setRewardInfo({ type: 'money', totalConversions: totalAllConversions });
      }
      
      // Fetch ticket details for base price and type name
      const ticketIds = (convsRes.data || []).filter(c => c.ticket_id).map(c => c.ticket_id!);
      let ticketMap: Record<string, { unitPrice: number; quantity: number; roundName: string }> = {};
      if (ticketIds.length > 0) {
        const { data: ticketDetails } = await supabase
          .from('tickets')
          .select('id, unit_price, quantity, ticket_round_id, ticket_type')
          .in('id', ticketIds);
        
        if (ticketDetails && ticketDetails.length > 0) {
          const roundIds = [...new Set(ticketDetails.map(t => t.ticket_round_id).filter(Boolean))];
          let roundMap = new Map<string, string>();
          if (roundIds.length > 0) {
            const { data: rounds } = await supabase
              .from('ticket_rounds')
              .select('id, name')
              .in('id', roundIds);
            roundMap = new Map((rounds || []).map(r => [r.id, r.name]));
          }
          
          ticketDetails.forEach(t => {
            const roundName = roundMap.get(t.ticket_round_id) || t.ticket_type || 'Ticket';
            ticketMap[t.id] = {
              unitPrice: t.unit_price,
              quantity: t.quantity,
              roundName,
            };
          });
        }
      }
      
      const convData: Conversion[] = (convsRes.data || []).map(c => {
        const ticketInfo = c.ticket_id ? ticketMap[c.ticket_id] : null;
        return {
          id: c.id, conversion_type: c.conversion_type, amount: c.amount,
          commission: c.commission, status: c.status, created_at: c.created_at,
          ticket_id: c.ticket_id,
          ticketTypeName: ticketInfo?.roundName,
          basePrice: ticketInfo ? ticketInfo.unitPrice * ticketInfo.quantity : c.amount,
        };
      });
      setConversions(convData);
      setGoalTarget(assignRes.data?.goal_target || null);

      // Build daily clicks + conversions chart
      const dayMap: Record<string, { clicks: number; conversions: number }> = {};
      (clicksDetailRes.data || []).forEach(c => {
        const day = c.clicked_at.substring(0, 10);
        if (!dayMap[day]) dayMap[day] = { clicks: 0, conversions: 0 };
        dayMap[day].clicks++;
      });
      convData.forEach(c => {
        const day = c.created_at.substring(0, 10);
        if (!dayMap[day]) dayMap[day] = { clicks: 0, conversions: 0 };
        dayMap[day].conversions++;
      });
      const sorted = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({
        date: date.substring(5), clicks: v.clicks, conversions: v.conversions,
      }));
      setClicksByDay(sorted);
      setLoading(false);
    })();
  }, [eventId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!event || !promoterId) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> {t('promoter.analysis.back')}
        </Button>
        <p className="text-center text-muted-foreground mt-8">{t('promoter.analysis.eventNotFound')}</p>
      </div>
    );
  }

  const tickets = conversions.filter(c => c.conversion_type === 'ticket' && (c.amount || 0) > 0);
  const tables = conversions.filter(c => c.conversion_type === 'table' && (c.amount || 0) > 0);
  const totalRevenue = conversions.reduce((s, c) => s + (c.basePrice ?? c.amount), 0);
  const totalCommission = conversions.reduce((s, c) => s + c.commission, 0);
  const pendingCommission = conversions.filter(c => c.status === 'pending').reduce((s, c) => s + c.commission, 0);
  const conversionRate = clicks > 0 ? ((conversions.length / clicks) * 100) : 0;
  const eventLink = `https://yunoapp.eu/club/${event.venue_id}?ref=${promoCode}&event=${event.id}`;

  const now = new Date();
  const isLive = new Date(event.start_at) <= now && new Date(event.end_at) >= now;
  const isPast = new Date(event.end_at) < now;

  const isMoneyReward = rewardInfo?.type === 'money' || (rewardInfo?.type === 'tiers' && rewardInfo.tiers?.every(tier => tier.reward_type === 'money'));

  // Ticket type breakdown by round name
  const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
  const typeCountMap: Record<string, number> = {};
  tickets.forEach(tk => {
    const name = tk.ticketTypeName || 'Ticket';
    typeCountMap[name] = (typeCountMap[name] || 0) + 1;
  });
  const typeBreakdown = Object.entries(typeCountMap).map(([name, value], i) => ({
    name, value, fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  // Build reward tier progress
  const renderRewardProgress = () => {
    if (!rewardInfo || rewardInfo.type === 'money') return null;
    
    if (rewardInfo.type === 'flat_advantage' && rewardInfo.rewardType) {
      return (
        <Card className="border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Gift className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 truncate text-sm font-semibold">{t('promoter.analysis.reward')}</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10">
              <Star className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 break-words text-sm font-medium">{getRewardLabel(rewardInfo.rewardType, rewardInfo.rewardConfig || {}, t)}</span>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (rewardInfo.type === 'tiers' && rewardInfo.tiers) {
      const totalConvs = rewardInfo.totalConversions;
      const currentIdx = rewardInfo.currentTierIndex ?? 0;
      const currentTier = rewardInfo.tiers[currentIdx];
      const nextTier = currentIdx < rewardInfo.tiers.length - 1 ? rewardInfo.tiers[currentIdx + 1] : null;
      const salesLabel = totalConvs > 1 ? t('promoter.analysis.sales') : t('promoter.analysis.sale');
      
      return (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 truncate text-sm font-semibold">{t('promoter.analysis.rewardProgression')}</span>
            </div>

            {/* Current tier */}
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="min-w-0 truncate text-xs text-muted-foreground">{t('promoter.analysis.currentTier')}</span>
                <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[10px]">
                  {totalConvs} {salesLabel}
                </Badge>
              </div>
              <p className="break-words text-sm font-medium">
                {currentTier.reward_type === 'money'
                  ? `${currentTier.ticketValue || 0}€ ${t('promoter.analysis.perSale')}`
                  : getRewardLabel(currentTier.reward_type, currentTier.reward_config, t)}
              </p>
            </div>

            {/* Progress to next tier */}
            {nextTier && (
              <div>
                <div className="flex justify-between gap-2 text-xs mb-1.5">
                  <span className="min-w-0 truncate text-muted-foreground">{t('promoter.analysis.nextTierAt')} {nextTier.min} {t('promoter.analysis.sales')}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{Math.min(100, (totalConvs / nextTier.min) * 100).toFixed(0)}%</span>
                </div>
                <Progress value={Math.min(100, (totalConvs / nextTier.min) * 100)} className="h-2" />
                <p className="break-words text-xs text-muted-foreground mt-1.5">
                  → {nextTier.reward_type === 'money'
                    ? `${nextTier.ticketValue || 0}€ ${t('promoter.analysis.perSale')}`
                    : getRewardLabel(nextTier.reward_type, nextTier.reward_config, t)}
                </p>
              </div>
            )}

            {/* All tiers overview */}
            <div className="space-y-1.5 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground font-medium mb-2">{t('promoter.analysis.allTiers')}</p>
              {rewardInfo.tiers.map((tier, i) => {
                const isActive = i === currentIdx;
                const isCompleted = totalConvs >= (tier.max ?? Infinity);
                return (
                  <div key={i} className={`flex items-center gap-2 text-xs p-2 rounded ${isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-primary' : isCompleted ? 'bg-primary/50' : 'bg-muted-foreground/30'}`} />
                    <span className="min-w-0 flex-1 truncate">
                      {tier.min}{tier.max ? `-${tier.max}` : '+'} {t('promoter.analysis.sales')}
                    </span>
                    <span className={`shrink-0 whitespace-nowrap font-medium ${isActive ? 'text-primary' : ''}`}>
                      {tier.reward_type === 'money'
                        ? `${tier.ticketValue || 0}€`
                        : getRewardLabel(tier.reward_type, tier.reward_config, t)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      );
    }
    return null;
  };

  return (
    <div
      className="min-h-screen bg-background"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 3rem)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 pb-3 pt-4 flex items-center gap-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold truncate">
            {isOwnerView && promoterName ? `${promoterName} — ${event.title}` : event.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEEE d MMMM yyyy', { locale })}
          </p>
        </div>
        {isLive && <Badge className="bg-primary animate-pulse shrink-0">{t('promoter.analysis.live')}</Badge>}
        {isPast && <Badge variant="outline" className="shrink-0">{t('promoter.analysis.ended')}</Badge>}
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="min-w-0 p-4 text-center">
              <MousePointerClick className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="truncate text-2xl font-bold tabular-nums">{clicks}</p>
              <p className="truncate text-xs text-muted-foreground">{t('promoter.analysis.clicks')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="min-w-0 p-4 text-center">
              <BarChart3 className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="truncate text-2xl font-bold tabular-nums">{conversionRate.toFixed(1)}%</p>
              <p className="truncate text-xs text-muted-foreground">{t('promoter.analysis.conversionRate')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="min-w-0 p-4 text-center">
              <Ticket className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="truncate text-2xl font-bold tabular-nums">{tickets.length}</p>
              <p className="truncate text-xs text-muted-foreground">{t('promoter.analysis.ticketsSold')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="min-w-0 p-4 text-center">
              <Calendar className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="truncate text-2xl font-bold tabular-nums">{tables.length}</p>
              <p className="truncate text-xs text-muted-foreground">{t('promoter.analysis.tablesReserved')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tracked links — per-channel links for this promoter (attributed to their commission) */}
        {!isOwnerView && promoterId && eventId && (
          <Card>
            <CardContent className="min-w-0 p-4">
              <TrackedLinksManager
                ownerKind="promoter"
                promoterId={promoterId}
                targetKind="event"
                eventId={eventId}
              />
            </CardContent>
          </Card>
        )}

        {/* Revenue + Commission */}
        <div className={`grid ${isMoneyReward ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
          <Card>
            <CardContent className="min-w-0 p-4 text-center">
              <Euro className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="truncate text-xl font-bold tabular-nums sm:text-2xl">{fmtPrice(totalRevenue)}</p>
              <p className="truncate text-xs text-muted-foreground">{t('promoter.analysis.revenueGenerated')}</p>
            </CardContent>
          </Card>
          {isMoneyReward && (
            <Card className="border-primary/30">
              <CardContent className="min-w-0 p-4 text-center">
                <TrendingUp className="h-5 w-5 mx-auto text-primary mb-1" />
                <p className="truncate text-xl font-bold tabular-nums text-primary sm:text-2xl">{fmtPrice(totalCommission)}</p>
                <p className="truncate text-xs text-muted-foreground">{t('promoter.analysis.totalCommission')}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Reward Progress (for non-money rewards) */}
        {renderRewardProgress()}

        {/* Conversion Funnel */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-4">{t('promoter.analysis.conversionFunnel')}</h3>
            <div className="space-y-3">
              {[
                { label: t('promoter.analysis.clicks'), value: clicks, icon: MousePointerClick, pct: 100 },
                { label: t('promoter.analysis.conversions'), value: conversions.length, icon: Ticket, pct: clicks > 0 ? (conversions.length / clicks) * 100 : 0 },
                { label: t('promoter.analysis.revenueLabel'), value: fmtPrice(totalRevenue), icon: Euro, pct: clicks > 0 ? (conversions.length / clicks) * 100 : 0 },
                ...(isMoneyReward ? [{ label: t('promoter.analysis.commission'), value: fmtPrice(totalCommission), icon: TrendingUp, pct: totalRevenue > 0 ? (totalCommission / totalRevenue) * 100 : 0 }] : []),
              ].map((step, i, arr) => (
                <div key={step.label}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <step.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="min-w-0 truncate text-sm font-medium">{step.label}</span>
                        <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums">{step.value}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(step.pct, 100)}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{step.pct.toFixed(1)}%</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex justify-center my-1">
                      <ArrowRight className="h-3 w-3 text-muted-foreground rotate-90" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {isMoneyReward && pendingCommission > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-muted-foreground">{t('promoter.analysis.pendingCommission')}</span>
              <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-primary">{fmtPrice(pendingCommission)}</span>
            </CardContent>
          </Card>
        )}

        {/* Goal Progress */}
        {goalTarget && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-sm font-medium">{t('promoter.analysis.goal')}</span>
              </div>
              <div className="flex justify-between gap-3 text-sm mb-2">
                <span className="min-w-0 truncate text-muted-foreground">{tickets.length} / {goalTarget} {t('promoter.analysis.tickets')}</span>
                <span className="shrink-0 font-semibold tabular-nums">{Math.min(100, (tickets.length / goalTarget) * 100).toFixed(0)}%</span>
              </div>
              <Progress value={Math.min(100, (tickets.length / goalTarget) * 100)} className="h-2" />
            </CardContent>
          </Card>
        )}

        {/* Clicks vs Conversions over time */}
        {clicksByDay.length > 1 && (
          <Card className="overflow-hidden">
            <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t('promoter.analysis.clicksVsConversions')}</span>
              </CardTitle>
            </CardHeader>
            {/* Le graphe doit pouvoir rétrécir sous ~350px : min-w-0 + padding réduit sur mobile. */}
            <CardContent className="min-w-0 px-2 pb-4 sm:px-6 sm:pb-6">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={clicksByDay} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={{ fontSize: 10 }} width={34} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="clicks" name={t('promoter.analysis.clicks')} fill="hsl(var(--muted-foreground))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="conversions" name={t('promoter.analysis.conversions')} fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Type breakdown */}
        {typeBreakdown.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm flex items-center gap-2">
                <Ticket className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t('promoter.analysis.ticketTypeBreakdown')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-3 px-4 pb-4 sm:gap-4 sm:px-6 sm:pb-6">
              <ResponsiveContainer width={100} height={100} className="shrink-0">
                <PieChart>
                  <Pie data={typeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={40} innerRadius={20}>
                    {typeBreakdown.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Légende : les noms de type de billet sont saisis par le club → truncate obligatoire. */}
              <div className="min-w-0 flex-1 space-y-1">
                {typeBreakdown.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 shrink-0 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="min-w-0 truncate">{d.name}: <strong>{d.value}</strong></span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Event Link - only for promoter's own view */}
        {!isOwnerView && <Card>
          <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
            <CardTitle className="text-sm">{t('promoter.analysis.directEventLink')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="flex gap-2">
              {/* min-w-0 : sans ça l'input garde sa largeur intrinsèque et pousse le bouton hors carte. */}
              <Input value={eventLink} readOnly className="min-w-0 flex-1 text-xs font-mono" />
              <Button size="icon" variant="outline" className="shrink-0" onClick={() => { navigator.clipboard.writeText(eventLink); toast.success(t('promoter.analysis.linkCopied')); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" className="w-full" onClick={async () => {
              const outcome = await shareContent({ title: event.title, url: eventLink });
              if (outcome === 'copied') toast.success(t('promoter.analysis.linkCopied'));
            }}>
              <Share2 className="h-4 w-4 mr-2" /> {t('promoter.analysis.share')}
            </Button>
          </CardContent>
        </Card>}

        {/* Conversion Timeline */}
        {conversions.length > 0 && (
          <Card>
            <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t('promoter.analysis.conversionHistory')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-72 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
              {conversions.slice(0, 20).map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                  {/* Le nom du type de billet vient du club : il doit tronquer, pas pousser le montant. */}
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Badge variant={c.conversion_type === 'ticket' ? 'default' : 'secondary'} className="min-w-0 max-w-[9rem] text-[10px]">
                      <span className="truncate">{c.ticketTypeName || (c.conversion_type === 'ticket' ? 'Ticket' : 'Table')}</span>
                    </Badge>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {formatInTimeZone(new Date(c.created_at), PARIS_TIMEZONE, 'dd/MM HH:mm', { locale })}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="whitespace-nowrap text-xs font-medium tabular-nums">{fmtPrice(c.basePrice ?? c.amount)}</p>
                    {c.commission > 0 && (
                      <p className="whitespace-nowrap text-[10px] text-primary tabular-nums">+{fmtPrice(c.commission)}</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
