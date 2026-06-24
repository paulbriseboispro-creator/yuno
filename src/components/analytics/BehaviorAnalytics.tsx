import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Activity, TrendingDown, Clock, Target, Smartphone, Monitor, Tablet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';
import { buildOrganizerScopeOr } from './scopeFilter';
import { Heatmap, DeviceBar } from './behaviorPrimitives';

// ─── Design tokens ────────────────────────────────────────────────────────────
const RED = '#E8192C';
const NEG = '#FF5C63';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Promoted to a top-level Yuno card so each section reads as a native page card.
const crd: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  overflow: 'hidden',
};

interface Props {
  scope: { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
  from?: string;
  to?: string;
  deviceFilter?: string;
  sourceFilter?: string;
}

interface BehaviorStats {
  visits: number;
  uniqueVisitors: number;
  carts: number;
  checkouts: number;
  conversions: number;
  avgDuration: number;
  avgScroll: number;
  bounceRate: number;
  abandonedCarts: number;
  abandonedValueCents: number;
  hourMatrix: number[][];
  devices: { mobile: number; tablet: number; desktop: number };
}

const EMPTY: BehaviorStats = {
  visits: 0, uniqueVisitors: 0, carts: 0, checkouts: 0, conversions: 0,
  avgDuration: 0, avgScroll: 0, bounceRate: 0, abandonedCarts: 0, abandonedValueCents: 0,
  hourMatrix: Array(7).fill(0).map(() => Array(24).fill(0)),
  devices: { mobile: 0, tablet: 0, desktop: 0 },
};

export function BehaviorAnalytics({ scope, from, to, deviceFilter, sourceFilter }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [stats, setStats] = useState<BehaviorStats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const { eventIds, venueIds } = useOrganizerEventIds(scope.kind === 'organizer' ? scope.id : null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from('visitor_sessions')
        .select('visited_at, added_to_cart, proceeded_to_checkout, completed_order, duration_seconds, scroll_depth_max, cart_value_cents, device_type, visitor_id, pages_viewed, referrer_category');
      if (scope.kind === 'venue') q = q.eq('venue_id', scope.id);
      else q = q.or(buildOrganizerScopeOr(scope.id, eventIds, venueIds));
      if (from) q = q.gte('visited_at', from);
      if (to) q = q.lte('visited_at', to);
      if (deviceFilter && deviceFilter !== 'all') q = q.eq('device_type', deviceFilter);
      if (sourceFilter && sourceFilter !== 'all') q = q.eq('referrer_category', sourceFilter);

      const { data } = await q.limit(10000);
      if (cancelled) return;
      const rows = data ?? [];

      const matrix: number[][] = Array(7).fill(0).map(() => Array(24).fill(0));
      const visitorIds = new Set<string>();
      let totalDur = 0, durCount = 0;
      let totalScroll = 0, scrollCount = 0;
      let bounced = 0;
      let abandoned = 0, abandonedValue = 0;
      const dev = { mobile: 0, tablet: 0, desktop: 0 };

      rows.forEach((r: any) => {
        const d = new Date(r.visited_at);
        const day = (d.getDay() + 6) % 7;
        matrix[day][d.getHours()] += 1;
        if (r.visitor_id) visitorIds.add(r.visitor_id);
        if (typeof r.duration_seconds === 'number') { totalDur += r.duration_seconds; durCount++; }
        if (typeof r.scroll_depth_max === 'number') { totalScroll += r.scroll_depth_max; scrollCount++; }
        if ((r.duration_seconds ?? 0) < 10 && (r.pages_viewed ?? 1) <= 1) bounced++;
        if (r.added_to_cart && !r.completed_order) {
          abandoned++;
          abandonedValue += Number(r.cart_value_cents || 0);
        }
        if (r.device_type === 'mobile') dev.mobile++;
        else if (r.device_type === 'tablet') dev.tablet++;
        else if (r.device_type === 'desktop') dev.desktop++;
      });

      setStats({
        visits: rows.length,
        uniqueVisitors: visitorIds.size,
        carts: rows.filter((r: any) => r.added_to_cart).length,
        checkouts: rows.filter((r: any) => r.proceeded_to_checkout).length,
        conversions: rows.filter((r: any) => r.completed_order).length,
        avgDuration: durCount ? Math.round(totalDur / durCount) : 0,
        avgScroll: scrollCount ? Math.round(totalScroll / scrollCount) : 0,
        bounceRate: rows.length ? Math.round((bounced / rows.length) * 100) : 0,
        abandonedCarts: abandoned,
        abandonedValueCents: abandonedValue,
        hourMatrix: matrix,
        devices: dev,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope.kind, scope.id, from, to, deviceFilter, sourceFilter, eventIds.join(','), venueIds.join(',')]);

  const totalDev = stats.devices.mobile + stats.devices.tablet + stats.devices.desktop;

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center text-sm" style={{ color: T3 }}>
        {tt('Chargement…', 'Loading…')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Engagement stat tiles — the detailed funnel lives in the page's main
          Conversion Funnel card, so it's intentionally not repeated here. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <StatTile icon={Clock} label={tt('Durée moyenne', 'Avg duration')}
          value={`${Math.floor(stats.avgDuration / 60)}m ${stats.avgDuration % 60}s`} />
        <StatTile icon={Activity} label={tt('Scroll moyen', 'Avg scroll')} value={`${stats.avgScroll}%`} />
        <StatTile icon={TrendingDown} label={tt('Taux de rebond', 'Bounce rate')} value={`${stats.bounceRate}%`} negative />
        <StatTile icon={Target} label={tt('Visiteurs uniques', 'Unique visitors')} value={stats.uniqueVisitors.toLocaleString()} />
      </div>

      {/* Heatmap + Devices */}
      <div className="grid lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2" style={{ ...crd, padding: '18px 20px' }}>
          <h3 className="text-[13.5px] font-semibold mb-3" style={{ color: T1 }}>
            {tt('Heatmap activité (jour × heure)', 'Activity heatmap (day × hour)')}
          </h3>
          <Heatmap matrix={stats.hourMatrix} language={language} />
        </div>

        <div style={{ ...crd, padding: '18px 20px' }}>
          <h3 className="text-[13.5px] font-semibold mb-3" style={{ color: T1 }}>
            {tt('Appareils', 'Devices')}
          </h3>
          <div className="space-y-3">
            <DeviceBar icon={Smartphone} label="Mobile" value={stats.devices.mobile} total={totalDev} color={RED} />
            <DeviceBar icon={Tablet} label="Tablet" value={stats.devices.tablet} total={totalDev} color="rgba(255,255,255,0.45)" />
            <DeviceBar icon={Monitor} label="Desktop" value={stats.devices.desktop} total={totalDev} color="rgba(255,255,255,0.26)" />
          </div>

          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${FAINT_BORDER}` }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: T3 }}>
              {tt('Paniers abandonnés', 'Abandoned carts')}
            </p>
            <div className="text-[22px] font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>
              {stats.abandonedCarts}
            </div>
            <p className="text-xs mt-1 font-medium" style={{ color: RED }}>
              ≈ {(stats.abandonedValueCents / 100).toFixed(0)}€ {tt('à récupérer', 'to recover')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────
function StatTile({
  icon: Icon, label, value, negative,
}: { icon: any; label: string; value: string; negative?: boolean }) {
  return (
    <div
      className="rounded-2xl"
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        boxShadow: CARD_SHADOW,
        padding: '14px 16px',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: T3 }}>{label}</span>
        <Icon className="h-3.5 w-3.5 flex-none" style={{ color: negative ? NEG : RED }} />
      </div>
      <div className="text-xl font-bold tabular-nums" style={{ color: negative ? NEG : T1, letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  );
}

