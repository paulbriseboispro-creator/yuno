import { useState, useEffect, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  DollarSign, Zap, Activity, TrendingUp, Ticket, Crown, ShoppingBag, CreditCard,
  BarChart3, Building2, Users, Clock, Gauge, TrendingDown, Smartphone, Tablet,
  Monitor, Repeat, MapPin, Share2, Percent, CalendarClock, Trophy, Sparkles,
  UserPlus, RotateCcw, CalendarDays, Globe, type LucideIcon,
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Heatmap, DeviceBar } from '@/components/analytics/behaviorPrimitives';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const C_HI       = 'rgba(255,255,255,0.92)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Donut / multi-series palette: lead with RED, then muted secondaries
const PIE_PALETTE = [RED, '#F59E0B', '#818CF8'] as const;
const AXIS_TICK = { fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 } as const;

interface Venue { id: string; name: string; }

interface AudienceStats {
  funnel: { visitors: number; carts: number; checkouts: number; conversions: number };
  engagement: { unique_visitors: number; avg_duration_s: number; avg_scroll: number; bounce_count: number; returning_count: number; abandoned_carts: number; abandoned_value_cents: number };
  devices: { mobile: number; tablet: number; desktop: number; mobile_conv: number; tablet_conv: number; desktop_conv: number };
  sources: { referrer_category: string; visits: number; conversions: number }[];
  top_campaigns: { utm_campaign: string; utm_source: string | null; visits: number; conversions: number }[];
  entry_pages: { entry_page_type: string; visits: number; conversions: number }[];
  new_vs_returning: { new_visits: number; new_conv: number; returning_visits: number; returning_conv: number };
  trend: { day: string; visits: number; conversions: number }[];
  heatmap: { dow: number; hour: number; count: number }[];
}

// admin_platform_analytics payload — server-side aggregation, no PostgREST row cap
interface PlatformStats {
  totals: {
    gmv: number; club_revenue: number; yuno_revenue: number; refunds_total: number;
    refunds_count: number; tx_count: number; tickets_qty: number; ticket_sales: number;
    tables_booked: number; drink_orders: number; avg_order: number; take_rate: number;
  };
  by_day: { d: string; drinks: number; tickets: number; tables: number; total: number; yuno: number; refunds: number; drink_n: number; ticket_n: number; table_n: number }[];
  top_venues: { id: string; name: string; city: string | null; revenue: number; yuno: number; tx: number }[];
  top_events: { id: string; title: string; venue_name: string | null; start_at: string | null; revenue: number; tickets: number; tables: number }[];
  top_organizers: { user_id: string; name: string; revenue: number; events_count: number }[];
  growth: { new_users_by_day: { d: string; n: number }[]; new_users: number; total_users: number; new_venues: number; new_events: number };
  venue_cities: { city: string; revenue: number; tx: number }[];
  subscriptions: number;
}

// ─── Card primitives ──────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}
    >
      {children}
    </div>
  );
}

function CardTitle({ icon: Icon, children, sub }: { icon: LucideIcon; children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{children}</h3>
        {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</p>}
      </div>
    </div>
  );
}

function ZoneHeading({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <Icon className="h-4 w-4" style={{ color: T2 }} />
      <h2 style={{ color: T1, fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em' }}>{children}</h2>
      <div className="flex-1 h-px" style={{ background: BORDER }} />
    </div>
  );
}

// ─── KPI stat card ──────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, highlight, tone }: { label: string; value: string | number; sub?: string; icon: LucideIcon; highlight?: boolean; tone?: 'pos' | 'neg' }) {
  const valueColor = tone === 'pos' ? POS : tone === 'neg' ? NEG : highlight ? RED : T1;
  return (
    <div
      style={{
        background: highlight ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.035)),#0a0a0c' : CARD_BG,
        border: `1px solid ${highlight ? 'rgba(232,25,44,0.24)' : BORDER}`,
        borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px', height: '100%',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
          style={{ background: highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${highlight ? 'rgba(232,25,44,0.2)' : F_BORDER}` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: highlight ? RED : T2 }} />
        </div>
      </div>
      <p className="tabular-nums" style={{ color: valueColor, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

// ─── Dark chart tooltips ──────────────────────────────────────────────────────
interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  stroke?: string;
  fill?: string;
}
interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function MoneyTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.stroke || p.fill, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {Number(p.value).toFixed(2)}€
        </p>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.fill, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {p.value}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: T2, fontSize: 12, marginBottom: 2 }}>{payload[0].name}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{Number(payload[0].value).toFixed(2)}€</p>
    </div>
  );
}

// ─── Chart legend (shared dark style) ─────────────────────────────────────────
function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-3 mt-3">
      {items.map(item => (
        <span key={item.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T2, fontSize: 11.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0, display: 'inline-block' }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

// ─── Funnel with step-to-step drop-off ────────────────────────────────────────
function FunnelView({ funnel, t }: { funnel: AudienceStats['funnel']; t: (k: string) => string }) {
  const steps = [
    { label: t('adminAnalytics.visitors'), value: funnel.visitors },
    { label: t('adminAnalytics.addToCart'), value: funnel.carts },
    { label: t('adminAnalytics.checkout'), value: funnel.checkouts },
    { label: t('adminAnalytics.ordered'), value: funnel.conversions },
  ];
  const top = steps[0].value || 1;
  const transitions = steps.slice(1).map((s, i) => {
    const prev = steps[i].value;
    const dropPct = prev > 0 ? ((prev - s.value) / prev) * 100 : 0;
    return { idx: i + 1, from: steps[i].label, to: s.label, dropPct };
  });
  const worst = transitions.length
    ? transitions.reduce((a, b) => (b.dropPct > a.dropPct ? b : a))
    : null;

  return (
    <div className="space-y-4">
      {worst && worst.dropPct > 0 && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
          style={{ background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.24)' }}
        >
          <TrendingDown className="h-4 w-4 flex-none" style={{ color: RED }} />
          <span style={{ color: T2, fontSize: 12.5 }}>
            {t('adminAnalytics.biggestLeak')}:{' '}
            <span style={{ color: T1, fontWeight: 600 }}>{worst.from} → {worst.to}</span>
          </span>
          <span className="tabular-nums ml-auto" style={{ color: RED, fontWeight: 700, fontSize: 14 }}>
            −{worst.dropPct.toFixed(0)}%
          </span>
        </div>
      )}
      {steps.map((step, i) => {
        const widthPct = ((step.value / top) * 100).toFixed(0);
        const ofVisitors = top > 0 ? ((step.value / top) * 100).toFixed(0) : '0';
        const tr = i > 0 ? transitions[i - 1] : null;
        const isWorst = worst && tr && tr.idx === worst.idx;
        return (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
              <span style={{ color: T2 }}>{step.label}</span>
              <span className="flex items-center gap-2">
                {tr && tr.dropPct > 0 && (
                  <span
                    className="tabular-nums rounded-md px-1.5 py-0.5"
                    title={t('adminAnalytics.vsPrevStep')}
                    style={{
                      fontSize: 10.5, fontWeight: 600,
                      color: isWorst ? RED : T3,
                      background: isWorst ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    −{tr.dropPct.toFixed(0)}%
                  </span>
                )}
                <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>
                  {step.value.toLocaleString()} <span style={{ color: T3, fontWeight: 400 }}>({ofVisitors}%)</span>
                </span>
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${widthPct}%`, background: 'linear-gradient(90deg, rgba(232,25,44,0.75), rgba(232,25,44,0.35))' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Horizontal labeled bar (sources / entry pages / cities) ──────────────────
function BarRow({ label, value, max, conv, accent, money }: { label: string; value: number; max: number; conv?: string; accent?: boolean; money?: boolean }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
        <span className="truncate pr-2" style={{ color: T2 }}>{label}</span>
        <span className="tabular-nums flex-none" style={{ color: T1 }}>
          {money ? `${value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€` : value.toLocaleString()}
          {conv !== undefined && <span style={{ color: T3 }}> · {conv}</span>}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: accent ? 'linear-gradient(90deg, rgba(232,25,44,0.8), rgba(232,25,44,0.4))' : 'rgba(255,255,255,0.28)' }}
        />
      </div>
    </div>
  );
}

// ─── Ranked list (top events / organizers) ───────────────────────────────────
function RankedList({ items }: { items: { name: string; sub?: string; value: string }[] }) {
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="grid items-center gap-3 py-2.5" style={{ gridTemplateColumns: '22px 1fr auto', borderBottom: i < items.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
          <span className="text-[12.5px] tabular-nums" style={{ color: i === 0 ? RED : T3, fontWeight: i === 0 ? 700 : 400 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-[560] truncate" style={{ color: T1 }}>{it.name}</div>
            {it.sub && <div className="text-[11.5px] truncate mt-0.5" style={{ color: T3 }}>{it.sub}</div>}
          </div>
          <div className="text-sm font-[620] tabular-nums text-right" style={{ color: T1 }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalytics() {
  const { t, language } = useLanguage();
  const uid = useId().replace(/:/g, '');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<string>('all');
  const [period, setPeriod] = useState<string>('30');
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<PlatformStats | null>(null);
  const [audience, setAudience] = useState<AudienceStats | null>(null);

  useEffect(() => { fetchVenues(); }, []);
  useEffect(() => { fetchAnalytics(); }, [selectedVenue, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchVenues = async () => {
    const { data } = await supabase.from('venues').select('id, name').order('name');
    setVenues(data || []);
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const days = parseInt(period);
      const startDate = startOfDay(subDays(new Date(), days)).toISOString();
      const endDate = endOfDay(new Date()).toISOString();
      const venueParam = selectedVenue === 'all' ? null : selectedVenue;

      // Both aggregations run server-side (SECURITY DEFINER, super-admin gated):
      // no PostgREST 1000-row cap, no N client queries.
      const [platformRes, audienceRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.rpc('admin_platform_analytics' as any, { p_from: startDate, p_to: endDate, p_venue_id: venueParam }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.rpc('get_platform_audience_stats' as any, { p_from: startDate, p_to: endDate, p_venue_id: venueParam }),
      ]);

      if (platformRes.error) console.error('[AdminAnalytics] platform stats error', platformRes.error);
      if (audienceRes.error) console.warn('[AdminAnalytics] audience stats error', audienceRes.error);

      setPlatform((platformRes.data as unknown as PlatformStats | null) ?? null);
      setAudience((audienceRes.data as unknown as AudienceStats | null) ?? null);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const venueOptions = [{ value: 'all', label: t('adminAnalytics.allClubs') }, ...venues.map(v => ({ value: v.id, label: v.name }))];
  const periodOptions = [
    { value: '7', label: t('adminAnalytics.days7') },
    { value: '30', label: t('adminAnalytics.days30') },
    { value: '90', label: t('adminAnalytics.days90') },
  ];

  const selectStyle: React.CSSProperties = {
    background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
    color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer',
    appearance: 'none', WebkitAppearance: 'none', minWidth: 140,
  };

  // Line/bar series definitions (single-accent: RED lead, muted secondaries)
  const drinksColor = RED;
  const ticketsColor = '#818CF8';
  const tablesColor = '#F59E0B';
  const totalColor = C_HI;

  // ─── Platform-derived values ─────────────────────────────────────────────────
  const totals = platform?.totals;
  const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const dailyData = (platform?.by_day ?? []).map(d => ({
    date: fmtDay(d.d),
    drinks: d.drinks, tickets: d.tickets, tables: d.tables, total: d.total,
    drinkOrders: d.drink_n, ticketOrders: d.ticket_n, tableOrders: d.table_n,
  }));
  const newUsersData = (platform?.growth.new_users_by_day ?? []).map(d => ({ date: fmtDay(d.d), n: d.n }));
  const pieData = [
    { name: t('adminAnalytics.drinks'), value: (platform?.by_day ?? []).reduce((s, d) => s + d.drinks, 0) },
    { name: t('adminAnalytics.tickets'), value: (platform?.by_day ?? []).reduce((s, d) => s + d.tickets, 0) },
    { name: t('adminAnalytics.tables'), value: (platform?.by_day ?? []).reduce((s, d) => s + d.tables, 0) },
  ].filter(d => d.value > 0);
  const conversionRate = audience && audience.funnel.visitors > 0
    ? ((audience.funnel.conversions / audience.funnel.visitors) * 100).toFixed(1)
    : '0';
  const cityMax = Math.max(1, ...(platform?.venue_cities ?? []).map(c => c.revenue));

  // ─── Audience-derived values ─────────────────────────────────────────────────
  const hasAudience = !!audience && audience.funnel.visitors > 0;
  const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;
  const convPct = (conv: number, v: number) => (v > 0 ? `${((conv / v) * 100).toFixed(1)}%` : '0%');
  const SRC_KEYS = new Set(['direct', 'social', 'search', 'qr', 'email', 'paid', 'affiliate', 'referral', 'unknown']);
  const srcLabel = (c: string) => (SRC_KEYS.has(c) ? t(`adminAnalytics.src_${c}`) : c);
  const entryLabel = (c: string) => (c === 'unknown' ? t('adminAnalytics.other') : c.charAt(0).toUpperCase() + c.slice(1));
  const bounceRate = audience && audience.funnel.visitors > 0
    ? Math.round((audience.engagement.bounce_count / audience.funnel.visitors) * 100)
    : 0;
  const devTotal = audience ? audience.devices.mobile + audience.devices.tablet + audience.devices.desktop : 0;
  const srcMax = Math.max(1, ...(audience?.sources ?? []).map(s => s.visits));
  const entryMax = Math.max(1, ...(audience?.entry_pages ?? []).map(s => s.visits));
  const trendData = (audience?.trend ?? []).map(p => ({
    date: fmtDay(p.day),
    rate: p.visits > 0 ? Number(((p.conversions / p.visits) * 100).toFixed(2)) : 0,
  }));
  const heatMatrix: number[][] = Array(7).fill(0).map(() => Array(24).fill(0));
  (audience?.heatmap ?? []).forEach(h => {
    const d = (h.dow + 6) % 7;
    if (heatMatrix[d] && h.hour >= 0 && h.hour < 24) heatMatrix[d][h.hour] = h.count;
  });

  const eur = (v: number) => `${(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€`;

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminAnalytics.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminAnalytics.subtitle')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <select value={selectedVenue} onChange={(e) => setSelectedVenue(e.target.value)} style={{ ...selectStyle, width: '100%' }} className="sm:!w-[180px]">
              {venueOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ ...selectStyle, width: '100%' }} className="sm:!w-[140px]">
              {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="text-center">
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
            </div>
          </div>
        ) : (
          <>
            {/* KPI row 1 — money */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                <StatCard label={t('adminAnalytics.gmv')} value={eur(totals?.gmv ?? 0)} icon={DollarSign} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <StatCard label={t('adminAnalytics.yunoRevenue')} value={eur(totals?.yuno_revenue ?? 0)} sub={`${t('adminAnalytics.takeRate')} ${totals?.take_rate ?? 0}%`} icon={Zap} highlight />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <StatCard label={t('adminAnalytics.clubRevenue')} value={eur(totals?.club_revenue ?? 0)} icon={Building2} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <StatCard label={t('adminAnalytics.refunds')} value={eur(totals?.refunds_total ?? 0)} sub={`${totals?.refunds_count ?? 0} ${t('adminAnalytics.refundsCount')}`} icon={RotateCcw} tone={totals?.refunds_total ? 'neg' : undefined} />
              </motion.div>
            </div>

            {/* KPI row 2 — volume */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                <StatCard label={t('adminAnalytics.totalTransactions')} value={(totals?.tx_count ?? 0).toLocaleString()} sub={`${t('adminAnalytics.avgOrder')} ${(totals?.avg_order ?? 0).toFixed(2)}€`} icon={Activity} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <StatCard label={t('adminAnalytics.ticketsSold')} value={(totals?.tickets_qty ?? 0).toLocaleString()} icon={Ticket} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <StatCard label={t('adminAnalytics.tablesBooked')} value={(totals?.tables_booked ?? 0).toLocaleString()} icon={Crown} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <StatCard label={t('adminAnalytics.conversionRate')} value={`${conversionRate}%`} sub={`${(totals?.drink_orders ?? 0).toLocaleString()} ${t('adminAnalytics.drinkOrders')}`} icon={TrendingUp} tone="pos" />
              </motion.div>
            </div>

            {/* Revenue chart - multi-line */}
            <Card>
              <CardTitle icon={TrendingUp} sub={t('adminAnalytics.revenueSub')}>{t('adminAnalytics.revenue')}</CardTitle>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                    <YAxis hide />
                    <Tooltip content={<MoneyTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
                    <Line type="monotone" dataKey="drinks" name={t('adminAnalytics.drinks')} stroke={drinksColor} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="tickets" name={t('adminAnalytics.tickets')} stroke={ticketsColor} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="tables" name={t('adminAnalytics.tables')} stroke={tablesColor} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name="Total" stroke={totalColor} strokeWidth={2.5} dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend items={[
                { name: t('adminAnalytics.drinks'), color: drinksColor },
                { name: t('adminAnalytics.tickets'), color: ticketsColor },
                { name: t('adminAnalytics.tables'), color: tablesColor },
                { name: 'Total', color: totalColor },
              ]} />
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Stacked bar chart */}
              <Card>
                <CardTitle icon={BarChart3}>{t('adminAnalytics.ordersPerDay')}</CardTitle>
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                      <YAxis hide />
                      <Tooltip content={<CountTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="drinkOrders" name={t('adminAnalytics.drinks')} stackId="a" fill={drinksColor} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="ticketOrders" name={t('adminAnalytics.tickets')} stackId="a" fill={ticketsColor} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="tableOrders" name={t('adminAnalytics.tables')} stackId="a" fill={tablesColor} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ChartLegend items={[
                  { name: t('adminAnalytics.drinks'), color: drinksColor },
                  { name: t('adminAnalytics.tickets'), color: ticketsColor },
                  { name: t('adminAnalytics.tables'), color: tablesColor },
                ]} />
              </Card>

              {/* Pie chart */}
              <Card>
                <CardTitle icon={DollarSign}>{t('adminAnalytics.revenueByType')}</CardTitle>
                {pieData.length === 0 ? (
                  <div className="text-center py-8">
                    <DollarSign className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <p className="text-xs" style={{ color: T3 }}>{t('adminDashboard.noData')}</p>
                  </div>
                ) : (
                  <>
                    <div style={{ width: '100%', height: 250 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} cornerRadius={3} dataKey="value" strokeWidth={3} stroke="#000">
                            {pieData.map((_, i) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ChartLegend items={pieData.map((d, i) => ({ name: d.name, color: PIE_PALETTE[i % PIE_PALETTE.length] }))} />
                  </>
                )}
              </Card>
            </div>

            {/* ───── Leaderboards ───── */}
            <ZoneHeading icon={Trophy}>{t('adminAnalytics.leaderboards')}</ZoneHeading>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Top venues */}
              {selectedVenue === 'all' && (platform?.top_venues ?? []).length > 0 && (
                <Card>
                  <CardTitle icon={Building2} sub={t('adminAnalytics.topVenuesSub')}>{t('adminAnalytics.topVenues')}</CardTitle>
                  <div style={{ width: '100%', height: Math.max(180, (platform?.top_venues.length ?? 0) * 34) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={platform!.top_venues.map(v => ({ name: v.name, revenue: v.revenue }))} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                        <defs>
                          <linearGradient id={`venue-bar-${uid}`} x1="0" x2="1" y1="0" y2="0">
                            <stop offset="0%" stopColor={RED} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={RED} stopOpacity={0.95} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                        <XAxis type="number" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={100} tick={{ fill: 'rgba(255,255,255,0.58)', fontSize: 11 }} />
                        <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                        <Bar dataKey="revenue" name={t('adminAnalytics.revenue')} fill={`url(#venue-bar-${uid})`} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}

              {/* Top events */}
              <Card>
                <CardTitle icon={Sparkles} sub={t('adminAnalytics.topEventsSub')}>{t('adminAnalytics.topEvents')}</CardTitle>
                {(platform?.top_events ?? []).length === 0 ? (
                  <p className="text-center py-8 text-xs" style={{ color: T3 }}>{t('adminDashboard.noData')}</p>
                ) : (
                  <RankedList items={platform!.top_events.slice(0, 8).map(e => ({
                    name: e.title,
                    sub: [e.venue_name, e.start_at ? format(new Date(e.start_at), 'dd/MM/yy') : null].filter(Boolean).join(' · '),
                    value: eur(e.revenue),
                  }))} />
                )}
              </Card>

              {/* Top organizers */}
              {(platform?.top_organizers ?? []).length > 0 && (
                <Card>
                  <CardTitle icon={Users} sub={t('adminAnalytics.topOrganizersSub')}>{t('adminAnalytics.topOrganizers')}</CardTitle>
                  <RankedList items={platform!.top_organizers.map(o => ({
                    name: o.name,
                    sub: `${o.events_count} ${t('adminAnalytics.eventsWord')}`,
                    value: eur(o.revenue),
                  }))} />
                </Card>
              )}

              {/* Geo — venue cities */}
              {(platform?.venue_cities ?? []).length > 0 && (
                <Card>
                  <CardTitle icon={Globe} sub={t('adminAnalytics.geoSub')}>{t('adminAnalytics.geo')}</CardTitle>
                  <div className="space-y-3">
                    {(platform!.venue_cities).map(c => (
                      <BarRow key={c.city} label={c.city} value={c.revenue} max={cityMax} conv={`${c.tx.toLocaleString()} tx`} accent money />
                    ))}
                  </div>
                </Card>
              )}
            </div>

            {/* ───── Growth ───── */}
            <ZoneHeading icon={TrendingUp}>{t('adminAnalytics.growth')}</ZoneHeading>

            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <StatCard label={t('adminAnalytics.newUsers')} value={`+${(platform?.growth.new_users ?? 0).toLocaleString()}`} icon={UserPlus} tone="pos" />
              <StatCard label={t('adminAnalytics.totalUsers')} value={(platform?.growth.total_users ?? 0).toLocaleString()} icon={Users} />
              <StatCard label={t('adminAnalytics.newVenues')} value={`+${(platform?.growth.new_venues ?? 0).toLocaleString()}`} icon={Building2} />
              <StatCard label={t('adminAnalytics.newEvents')} value={`+${(platform?.growth.new_events ?? 0).toLocaleString()}`} icon={CalendarDays} />
            </div>

            <Card>
              <CardTitle icon={UserPlus} sub={t('adminAnalytics.newUsersSub')}>{t('adminAnalytics.newUsersChart')}</CardTitle>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={newUsersData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`nu-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={POS} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={POS} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                    <YAxis hide />
                    <Tooltip content={<CountTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="n" name={t('adminAnalytics.newUsers')} stroke={POS} strokeWidth={2} fill={`url(#nu-${uid})`} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* ───── Audience & behavior ───── */}
            <ZoneHeading icon={Users}>{t('adminAnalytics.audience')}</ZoneHeading>

            {!hasAudience ? (
              <Card>
                <div className="text-center py-8">
                  <Activity className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                  <p className="text-xs" style={{ color: T3 }}>{t('adminAnalytics.noVisitorData')}</p>
                </div>
              </Card>
            ) : (
              <>
                {/* Conversion funnel with step-to-step drop-off */}
                <Card>
                  <CardTitle icon={Activity} sub={t('adminAnalytics.funnelSub')}>{t('adminAnalytics.conversionFunnel')}</CardTitle>
                  <FunnelView funnel={audience!.funnel} t={t} />
                </Card>

                {/* Engagement tiles */}
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                  <StatCard label={t('adminAnalytics.uniqueVisitors')} value={audience!.engagement.unique_visitors.toLocaleString()} icon={Users} />
                  <StatCard label={t('adminAnalytics.avgDuration')} value={fmtDur(audience!.engagement.avg_duration_s)} icon={Clock} />
                  <StatCard label={t('adminAnalytics.avgScroll')} value={`${audience!.engagement.avg_scroll}%`} icon={Gauge} />
                  <StatCard label={t('adminAnalytics.bounceRate')} value={`${bounceRate}%`} icon={TrendingDown} />
                </div>

                {/* Conversion rate over time */}
                <Card>
                  <CardTitle icon={Percent}>{t('adminAnalytics.conversionTrend')}</CardTitle>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                        <YAxis hide domain={[0, 'auto']} />
                        <Tooltip content={<CountTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
                        <Line type="monotone" dataKey="rate" name={t('adminAnalytics.conversionRate')} stroke={RED} strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Traffic sources */}
                  <Card>
                    <CardTitle icon={Share2}>{t('adminAnalytics.trafficSources')}</CardTitle>
                    <div className="space-y-3">
                      {audience!.sources.map(s => (
                        <BarRow
                          key={s.referrer_category}
                          label={srcLabel(s.referrer_category)}
                          value={s.visits}
                          max={srcMax}
                          conv={`${convPct(s.conversions, s.visits)} ${t('adminAnalytics.convShort')}`}
                          accent
                        />
                      ))}
                    </div>
                    {audience!.top_campaigns.length > 0 && (
                      <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                        <p className="text-[10px] uppercase tracking-wider mb-2.5" style={{ color: T3 }}>{t('adminAnalytics.topCampaigns')}</p>
                        <div className="space-y-2">
                          {audience!.top_campaigns.map(c => (
                            <div key={c.utm_campaign} className="flex items-center justify-between" style={{ fontSize: 12 }}>
                              <span className="truncate pr-2" style={{ color: T2 }}>{c.utm_campaign}{c.utm_source ? <span style={{ color: T3 }}> · {c.utm_source}</span> : null}</span>
                              <span className="tabular-nums flex-none" style={{ color: T1 }}>{c.visits.toLocaleString()} <span style={{ color: T3 }}>· {convPct(c.conversions, c.visits)}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>

                  {/* Entry pages */}
                  <Card>
                    <CardTitle icon={MapPin} sub={t('adminAnalytics.entryPagesSub')}>{t('adminAnalytics.entryPages')}</CardTitle>
                    <div className="space-y-3">
                      {audience!.entry_pages.map(e => (
                        <BarRow
                          key={e.entry_page_type}
                          label={entryLabel(e.entry_page_type)}
                          value={e.visits}
                          max={entryMax}
                          conv={`${convPct(e.conversions, e.visits)} ${t('adminAnalytics.convShort')}`}
                        />
                      ))}
                    </div>
                  </Card>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Devices + abandoned carts */}
                  <Card>
                    <CardTitle icon={Smartphone}>{t('adminAnalytics.devices')}</CardTitle>
                    <div className="space-y-3">
                      <DeviceBar icon={Smartphone} label="Mobile" value={audience!.devices.mobile} total={devTotal} color={RED} sub={convPct(audience!.devices.mobile_conv, audience!.devices.mobile)} />
                      <DeviceBar icon={Tablet} label="Tablet" value={audience!.devices.tablet} total={devTotal} color="rgba(255,255,255,0.45)" sub={convPct(audience!.devices.tablet_conv, audience!.devices.tablet)} />
                      <DeviceBar icon={Monitor} label="Desktop" value={audience!.devices.desktop} total={devTotal} color="rgba(255,255,255,0.26)" sub={convPct(audience!.devices.desktop_conv, audience!.devices.desktop)} />
                    </div>
                    <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: T3 }}>{t('adminAnalytics.abandonedCarts')}</p>
                      <div className="text-[22px] font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>{audience!.engagement.abandoned_carts.toLocaleString()}</div>
                      <p className="text-xs mt-1 font-medium" style={{ color: RED }}>≈ {(audience!.engagement.abandoned_value_cents / 100).toFixed(0)}€ {t('adminAnalytics.toRecover')}</p>
                    </div>
                  </Card>

                  {/* New vs returning */}
                  <Card>
                    <CardTitle icon={Repeat}>{t('adminAnalytics.newVsReturning')}</CardTitle>
                    <div className="space-y-3">
                      <BarRow
                        label={t('adminAnalytics.newVisitors')}
                        value={audience!.new_vs_returning.new_visits}
                        max={Math.max(1, audience!.new_vs_returning.new_visits, audience!.new_vs_returning.returning_visits)}
                        conv={`${convPct(audience!.new_vs_returning.new_conv, audience!.new_vs_returning.new_visits)} ${t('adminAnalytics.convShort')}`}
                        accent
                      />
                      <BarRow
                        label={t('adminAnalytics.returningVisitors')}
                        value={audience!.new_vs_returning.returning_visits}
                        max={Math.max(1, audience!.new_vs_returning.new_visits, audience!.new_vs_returning.returning_visits)}
                        conv={`${convPct(audience!.new_vs_returning.returning_conv, audience!.new_vs_returning.returning_visits)} ${t('adminAnalytics.convShort')}`}
                      />
                    </div>
                  </Card>
                </div>

                {/* Activity heatmap (day × hour) */}
                <Card>
                  <CardTitle icon={CalendarClock} sub={t('adminAnalytics.heatmapSub')}>{t('adminAnalytics.activityHeatmap')}</CardTitle>
                  <Heatmap matrix={heatMatrix} language={language} />
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
