import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Eye, ShoppingCart, CreditCard, TrendingUp, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { subMinutes } from 'date-fns';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';

// ─── Design tokens ────────────────────────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';

interface Props {
  scope: { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
  from?: string;
  to?: string;
  deviceFilter?: string;
  sourceFilter?: string;
}

interface LiveStats {
  total: number;
  browsing: number;
  cart: number;
  checkout: number;
  hourSparkline: number[];
  periodVisits: number;
  periodConversions: number;
  periodRevenueCents: number;
}

const EMPTY: LiveStats = {
  total: 0, browsing: 0, cart: 0, checkout: 0,
  hourSparkline: [], periodVisits: 0, periodConversions: 0, periodRevenueCents: 0,
};

export function LiveActivityHero({ scope, from, to, deviceFilter, sourceFilter }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);
  const [stats, setStats] = useState<LiveStats>(EMPTY);
  const { eventIds, venueIds } = useOrganizerEventIds(scope.kind === 'organizer' ? scope.id : null);

  const buildOrgOrFilter = () => {
    const parts: string[] = [`organizer_user_id.eq.${scope.kind === 'organizer' ? scope.id : ''}`];
    if (eventIds.length) parts.push(`event_id.in.(${eventIds.join(',')})`);
    if (venueIds.length) parts.push(`venue_id.in.(${venueIds.map(v => `"${v}"`).join(',')})`);
    return parts.join(',');
  };

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      const fiveMin = subMinutes(new Date(), 5).toISOString();
      const fromIso = from || subMinutes(new Date(), 60 * 24).toISOString();
      const toIso = to || new Date().toISOString();

      let pingQuery = supabase.from('live_visitor_pings').select('stage').gte('last_seen', fiveMin);
      if (scope.kind === 'venue') pingQuery = pingQuery.eq('venue_id', scope.id);
      else pingQuery = pingQuery.or(buildOrgOrFilter());
      const { data: pings } = await pingQuery;

      const browsing = (pings ?? []).filter((p: any) => p.stage === 'browsing').length;
      const cart = (pings ?? []).filter((p: any) => p.stage === 'cart').length;
      const checkout = (pings ?? []).filter((p: any) => p.stage === 'checkout').length;
      const total = (pings ?? []).length;

      let sessQuery = supabase
        .from('visitor_sessions')
        .select('visited_at, completed_order, device_type, referrer_category')
        .gte('visited_at', fromIso)
        .lte('visited_at', toIso);
      if (scope.kind === 'venue') sessQuery = sessQuery.eq('venue_id', scope.id);
      else sessQuery = sessQuery.or(buildOrgOrFilter());
      if (deviceFilter && deviceFilter !== 'all') sessQuery = sessQuery.eq('device_type', deviceFilter);
      if (sourceFilter && sourceFilter !== 'all') sessQuery = sessQuery.eq('referrer_category', sourceFilter);

      const { data: sessions } = await sessQuery.limit(10000);

      const fromMs = new Date(fromIso).getTime();
      const toMs = new Date(toIso).getTime();
      const bucketMs = Math.max(1, (toMs - fromMs) / 24);
      const bins = Array(24).fill(0);
      (sessions ?? []).forEach((s: any) => {
        const ts = new Date(s.visited_at).getTime();
        const idx = Math.min(23, Math.max(0, Math.floor((ts - fromMs) / bucketMs)));
        bins[idx] += 1;
      });

      const periodVisits = (sessions ?? []).length;
      const periodConversions = (sessions ?? []).filter((s: any) => s.completed_order).length;

      let revCents = 0;
      if (scope.kind === 'venue') {
        const { data: orders } = await supabase
          .from('orders').select('total')
          .eq('venue_id', scope.id).eq('status', 'paid')
          .gte('created_at', fromIso).lte('created_at', toIso);
        revCents += (orders ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0) * 100, 0);
        const { data: vEvts } = await supabase.from('events').select('id').or(`venue_id.eq.${scope.id},partner_venue_id.eq.${scope.id}`);
        const ids = (vEvts ?? []).map((e: any) => e.id);
        if (ids.length) {
          const { data: tix } = await supabase
            .from('tickets').select('total_price')
            .in('event_id', ids).eq('status', 'paid')
            .gte('created_at', fromIso).lte('created_at', toIso);
          revCents += (tix ?? []).reduce((s: number, t: any) => s + (Number(t.total_price) || 0) * 100, 0);
        }
      } else if (eventIds.length > 0) {
        const { data: tix } = await supabase
          .from('tickets').select('total_price')
          .in('event_id', eventIds).eq('status', 'paid')
          .gte('created_at', fromIso).lte('created_at', toIso);
        revCents = (tix ?? []).reduce((s: number, t: any) => s + (Number(t.total_price) || 0) * 100, 0);
      }

      if (!cancelled) {
        setStats({ total, browsing, cart, checkout, hourSparkline: bins, periodVisits, periodConversions, periodRevenueCents: revCents });
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    const channel = supabase
      .channel(`hero_pings_${scope.kind}_${scope.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_visitor_pings' }, () => fetchStats())
      .subscribe();
    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [scope.kind, scope.id, from, to, deviceFilter, sourceFilter, eventIds.join(','), venueIds.join(',')]);

  const max = Math.max(...stats.hourSparkline, 1);
  const conversionRate = stats.periodVisits > 0
    ? ((stats.periodConversions / stats.periodVisits) * 100).toFixed(1)
    : '0';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden"
      style={{
        background: `radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.08) 0%, transparent 65%),
          linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
      }}
    >
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-14 -right-14 w-52 h-52 rounded-full"
        style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(56px)' }} />
      <div className="pointer-events-none absolute -bottom-20 left-6 w-44 h-44 rounded-full"
        style={{ background: 'rgba(232,25,44,0.06)', filter: 'blur(56px)' }} />

      <div className="relative p-5">
        {/* LIVE header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="relative flex-none">
              <div className="absolute inset-0 rounded-full animate-pulse"
                style={{ background: 'rgba(52,211,153,0.35)', filter: 'blur(5px)' }} />
              <div className="relative h-2.5 w-2.5 rounded-full" style={{ background: POS }} />
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.2em] font-semibold" style={{ color: POS }}>
                {tt('LIVE — En ce moment', 'LIVE — Right now')}
              </p>
              <h2 className="text-[clamp(28px,4vw,40px)] font-bold leading-none tabular-nums"
                style={{ color: T1, letterSpacing: '-0.03em' }}>
                {stats.total}
                <span className="text-base font-normal ml-1.5" style={{ color: T3 }}>
                  {tt('visiteurs', 'visitors')}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Pill icon={Eye} value={stats.browsing} label={tt('Naviguent', 'Browsing')} />
            <Pill icon={ShoppingCart} value={stats.cart} label={tt('Panier', 'Cart')} accent />
            <Pill icon={CreditCard} value={stats.checkout} label="Checkout" hot />
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
          <KpiTile label={tt('Visites période', 'Period visits')} value={stats.periodVisits.toLocaleString()} icon={Activity} />
          <KpiTile label={tt('Conversions', 'Conversions')} value={stats.periodConversions.toLocaleString()} icon={TrendingUp} />
          <KpiTile label={tt('Taux de conv.', 'Conv. rate')} value={`${conversionRate}%`} icon={Zap} />
          <KpiTile
            label={tt('CA période', 'Period rev.')}
            value={`${(stats.periodRevenueCents / 100).toFixed(0)} €`}
            icon={CreditCard}
            highlight
          />
        </div>

        {/* Activity sparkline */}
        <div className="mt-4">
          <div className="flex items-end gap-[2px] h-10">
            {stats.hourSparkline.map((v, i) => {
              const isLast = i === stats.hourSparkline.length - 1;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t transition-all"
                  style={{
                    height: `${(v / max) * 100}%`,
                    minHeight: 2,
                    background: isLast
                      ? RED
                      : `linear-gradient(to top, rgba(232,25,44,0.5), rgba(232,25,44,0.15))`,
                  }}
                  title={`${v} ${tt('visites', 'visits')}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-1.5 text-[10px]" style={{ color: T3 }}>
            <span>{tt('Début période', 'Period start')}</span>
            <span>{tt('Maintenant', 'Now')}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Pill badge ───────────────────────────────────────────────────────────────
function Pill({
  icon: Icon, value, label, accent, hot,
}: { icon: any; value: number; label: string; accent?: boolean; hot?: boolean }) {
  const style = hot
    ? { border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.1)', color: RED }
    : accent
    ? { border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.06)', color: '#FCD34D' }
    : { border: `1px solid ${BORDER}`, background: C_FAINT, color: T1 };
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={style}>
      <Icon className="h-3.5 w-3.5" />
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wider hidden sm:inline" style={{ opacity: 0.65 }}>{label}</span>
    </div>
  );
}

// ─── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, icon: Icon, highlight,
}: { label: string; value: string; icon: any; highlight?: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={highlight
        ? {
            background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))',
            border: '1px solid rgba(232,25,44,0.22)',
            padding: '10px 12px',
          }
        : {
            background: C_FAINT,
            border: `1px solid ${BORDER}`,
            padding: '10px 12px',
          }
      }
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: T3 }}>{label}</span>
        <Icon className="h-3.5 w-3.5 flex-none" style={{ color: highlight ? RED : T3 }} />
      </div>
      <div
        className="text-xl font-bold tabular-nums leading-tight"
        style={{ color: highlight ? RED : T1, letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
    </div>
  );
}
