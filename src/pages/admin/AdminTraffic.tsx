import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  Users, Eye, Clock, TrendingDown, TrendingUp, Smartphone, Tablet, Monitor,
  Globe, Share2, MapPin, LogOut, FileText, LayoutGrid, Radar, Compass,
  ShoppingBag, Ticket, Crown, Wine, Languages, AppWindow, Activity,
  type LucideIcon,
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const C_FAINT     = 'rgba(255,255,255,0.06)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const AXIS_TICK   = { fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 } as const;

// ─── Payloads serveur (get_platform_traffic / get_platform_traffic_live) ─────
interface TrafficStats {
  granularity: 'hour' | 'day';
  totals: {
    visitors: number; sessions: number; pageviews: number;
    avg_session_seconds: number; bounce_rate: number;
    native_sessions: number; authed_sessions: number;
  };
  series: { t: string; visitors: number; sessions: number; pageviews: number }[];
  channels: { channel: string; sessions: number; visitors: number }[];
  referrers: { host: string; sessions: number }[];
  campaigns: { campaign: string; source: string | null; sessions: number }[];
  pages: { path: string; views: number; sessions: number; avg_seconds: number | null }[];
  groups: { grp: string; views: number; sessions: number }[];
  entries: { path: string; sessions: number }[];
  exits: { path: string; sessions: number }[];
  devices: { k: string; n: number }[];
  browsers: { k: string; n: number }[];
  os: { k: string; n: number }[];
  countries: { k: string; n: number }[];
  languages: { k: string; n: number }[];
  funnel: { sessions: number; event_views: number; checkouts: number; purchases: number };
  sales: {
    tickets: { n: number; revenue: number };
    tables: { n: number; revenue: number };
    drinks: { n: number; revenue: number };
  };
}

interface LiveStats {
  count: number;
  native: number;
  last30m: number;
  pages: { path: string | null; device: string | null; country: string | null; is_native: boolean; seconds_ago: number }[];
}

// ─── Card primitives (style admin partagé) ────────────────────────────────────
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

function StatCard({ label, value, sub, icon: Icon, highlight, tone }: { label: string; value: string | number; sub?: string; icon: LucideIcon; highlight?: boolean; tone?: 'pos' | 'neg' }) {
  const valueColor = tone === 'pos' ? POS : highlight ? RED : T1;
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

interface TooltipEntry { name?: string | number; value?: string | number; color?: string; stroke?: string; fill?: string }
interface ChartTooltipProps { active?: boolean; payload?: TooltipEntry[]; label?: string | number }

function CountTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.stroke || p.fill, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {Number(p.value).toLocaleString()}
        </p>
      ))}
    </div>
  );
}

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

function BarRow({ label, value, max, sub, accent }: { label: string; value: number; max: number; sub?: string; accent?: boolean }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
        <span className="truncate pr-2" style={{ color: T2 }}>{label}</span>
        <span className="tabular-nums flex-none" style={{ color: T1 }}>
          {value.toLocaleString()}
          {sub !== undefined && <span style={{ color: T3 }}> · {sub}</span>}
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

// ─── Tunnel avec fuite étape-à-étape (visite → event → checkout → achat) ─────
function TrafficFunnel({ funnel, t }: { funnel: TrafficStats['funnel']; t: (k: string) => string }) {
  const steps = [
    { label: t('adminTraffic.stepSessions'), value: funnel.sessions },
    { label: t('adminTraffic.stepEvent'), value: funnel.event_views },
    { label: t('adminTraffic.stepCheckout'), value: funnel.checkouts },
    { label: t('adminTraffic.stepPurchase'), value: funnel.purchases },
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
            {t('adminTraffic.biggestLeak')}:{' '}
            <span style={{ color: T1, fontWeight: 600 }}>{worst.from} → {worst.to}</span>
          </span>
          <span className="tabular-nums ml-auto" style={{ color: RED, fontWeight: 700, fontSize: 14 }}>
            −{worst.dropPct.toFixed(0)}%
          </span>
        </div>
      )}
      {steps.map((step, i) => {
        const widthPct = ((step.value / top) * 100).toFixed(0);
        const ofTop = ((step.value / top) * 100).toFixed(0);
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
                    title={t('adminTraffic.vsPrevStep')}
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
                  {step.value.toLocaleString()} <span style={{ color: T3, fontWeight: 400 }}>({ofTop}%)</span>
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

// ─── Helpers d'affichage ─────────────────────────────────────────────────────
const CHANNEL_KEYS = new Set(['direct', 'search', 'social', 'paid', 'push', 'affiliate', 'email', 'campaign', 'referral']);
const GROUP_KEYS = new Set(['home', 'explore', 'event', 'venue', 'browse', 'checkout', 'purchase', 'dj', 'other']);
const DEVICE_ICONS: Record<string, LucideIcon> = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return code.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export default function AdminTraffic() {
  const { t } = useLanguage();
  const uid = useId().replace(/:/g, '');
  const [period, setPeriod] = useState<string>('7');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TrafficStats | null>(null);
  const [live, setLive] = useState<LiveStats | null>(null);

  const fetchLive = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc('get_platform_traffic_live' as any);
    if (!error && data) setLive(data as unknown as LiveStats);
  }, []);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const from = period === '1'
        ? startOfDay(now).toISOString()
        : startOfDay(subDays(now, parseInt(period))).toISOString();
      const to = endOfDay(now).toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_platform_traffic' as any, { p_from: from, p_to: to });
      if (error) {
        console.error('[AdminTraffic] stats error', error);
        setStats(null);
      } else {
        setStats(data as unknown as TrafficStats);
      }
    } catch (e) {
      console.error('[AdminTraffic] fetch error', e);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    fetchLive();
    const id = window.setInterval(fetchLive, 30_000);
    return () => clearInterval(id);
  }, [fetchLive]);

  const periodOptions = [
    { value: '1', label: t('adminTraffic.periodToday') },
    { value: '7', label: t('adminTraffic.days7') },
    { value: '28', label: t('adminTraffic.days28') },
    { value: '90', label: t('adminTraffic.days90') },
  ];

  const selectStyle: React.CSSProperties = {
    background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
    color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer',
    appearance: 'none', WebkitAppearance: 'none', minWidth: 140,
  };

  const totals = stats?.totals;
  const hasData = !!totals && totals.sessions > 0;
  const isHourly = stats?.granularity === 'hour';

  const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  const eur = (v: number) => `${(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€`;
  const pctOf = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');

  const seriesData = (stats?.series ?? []).map(p => ({
    t: format(new Date(p.t), isHourly ? 'HH:mm' : 'dd/MM'),
    visitors: p.visitors,
    sessions: p.sessions,
    pageviews: p.pageviews,
  }));
  const xInterval = isHourly ? 3 : period === '90' ? 6 : period === '28' ? 2 : 0;

  const channelLabel = (c: string) => (CHANNEL_KEYS.has(c) ? t(`adminTraffic.ch_${c}`) : c);
  const groupLabel = (g: string) => {
    const key = g === 'promo-link' ? 'promo' : g;
    return GROUP_KEYS.has(g) || g === 'promo-link' ? t(`adminTraffic.sec_${key}`) : g;
  };
  const deviceLabel = (d: string) =>
    d === 'mobile' || d === 'tablet' || d === 'desktop' ? t(`adminTraffic.dev_${d}`) : t('adminTraffic.dev_unknown');

  const channelMax = Math.max(1, ...(stats?.channels ?? []).map(c => c.sessions));
  const refMax = Math.max(1, ...(stats?.referrers ?? []).map(r => r.sessions));
  const groupMax = Math.max(1, ...(stats?.groups ?? []).map(g => g.views));
  const entryMax = Math.max(1, ...(stats?.entries ?? []).map(e => e.sessions));
  const exitMax = Math.max(1, ...(stats?.exits ?? []).map(e => e.sessions));
  const countryMax = Math.max(1, ...(stats?.countries ?? []).map(c => c.n));
  const browserMax = Math.max(1, ...(stats?.browsers ?? []).map(b => b.n));
  const deviceTotal = (stats?.devices ?? []).reduce((s, d) => s + d.n, 0);

  const salesTotalN = stats ? stats.sales.tickets.n + stats.sales.tables.n + stats.sales.drinks.n : 0;
  const salesTotalRev = stats ? stats.sales.tickets.revenue + stats.sales.tables.revenue + stats.sales.drinks.revenue : 0;

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminTraffic.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminTraffic.subtitle')}</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            {/* Badge « en direct » */}
            <div
              className="flex items-center justify-center gap-2 rounded-xl px-3.5"
              style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)', height: 38 }}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: POS }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: POS }} />
              </span>
              <span className="tabular-nums" style={{ color: POS, fontSize: 13, fontWeight: 650 }}>{live?.count ?? 0}</span>
              <span style={{ color: T2, fontSize: 12.5 }}>{t('adminTraffic.liveNow')}</span>
            </div>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ ...selectStyle, width: '100%' }} className="sm:!w-[170px]">
              {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : !hasData ? (
          <Card>
            <div className="text-center py-12 max-w-md mx-auto">
              <Radar className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.16)' }} />
              <h3 style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{t('adminTraffic.emptyTitle')}</h3>
              <p className="mt-2" style={{ color: T3, fontSize: 13, lineHeight: 1.6 }}>{t('adminTraffic.emptyBody')}</p>
            </div>
          </Card>
        ) : (
          <>
            {/* KPI — audience */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                <StatCard label={t('adminTraffic.visitors')} value={totals!.visitors.toLocaleString()} icon={Users} highlight />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <StatCard label={t('adminTraffic.sessions')} value={totals!.sessions.toLocaleString()} icon={Activity} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <StatCard label={t('adminTraffic.pageviews')} value={totals!.pageviews.toLocaleString()} icon={Eye} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <StatCard label={t('adminTraffic.avgSession')} value={fmtDur(totals!.avg_session_seconds)} icon={Clock} />
              </motion.div>
            </div>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <StatCard label={t('adminTraffic.bounceRate')} value={`${totals!.bounce_rate}%`} sub={t('adminTraffic.bounceSub')} icon={TrendingDown} />
              <StatCard label={t('adminTraffic.appSessions')} value={pctOf(totals!.native_sessions, totals!.sessions)} sub={`${totals!.native_sessions.toLocaleString()} / ${totals!.sessions.toLocaleString()}`} icon={AppWindow} />
              <StatCard label={t('adminTraffic.loggedSessions')} value={pctOf(totals!.authed_sessions, totals!.sessions)} sub={`${totals!.authed_sessions.toLocaleString()} / ${totals!.sessions.toLocaleString()}`} icon={Users} />
              <StatCard label={t('adminTraffic.purchases')} value={salesTotalN.toLocaleString()} sub={eur(salesTotalRev)} icon={ShoppingBag} tone="pos" />
            </div>

            {/* Courbe de trafic */}
            <Card>
              <CardTitle icon={TrendingUp} sub={t('adminTraffic.chartSub')}>{t('adminTraffic.chartTitle')}</CardTitle>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={seriesData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`tv-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={RED} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={RED} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`ts-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.5)" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="rgba(255,255,255,0.5)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                    <XAxis dataKey="t" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} interval={xInterval} />
                    <YAxis hide />
                    <Tooltip content={<CountTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="sessions" name={t('adminTraffic.sessions')} stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} fill={`url(#ts-${uid})`} dot={false} />
                    <Area type="monotone" dataKey="visitors" name={t('adminTraffic.visitors')} stroke={RED} strokeWidth={2.5} fill={`url(#tv-${uid})`} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend items={[
                { name: t('adminTraffic.visitors'), color: RED },
                { name: t('adminTraffic.sessions'), color: 'rgba(255,255,255,0.45)' },
              ]} />
            </Card>

            {/* Tunnel + temps réel */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardTitle icon={Compass} sub={t('adminTraffic.funnelSub')}>{t('adminTraffic.funnelTitle')}</CardTitle>
                <TrafficFunnel funnel={stats!.funnel} t={t} />
                <div className="mt-5 pt-4 grid grid-cols-3 gap-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <div>
                    <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Ticket className="h-3 w-3" /> {t('adminTraffic.salesTickets')}
                    </p>
                    <p className="tabular-nums mt-1" style={{ color: T1, fontSize: 17, fontWeight: 640 }}>{stats!.sales.tickets.n.toLocaleString()}</p>
                    <p className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{eur(stats!.sales.tickets.revenue)}</p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Crown className="h-3 w-3" /> {t('adminTraffic.salesTables')}
                    </p>
                    <p className="tabular-nums mt-1" style={{ color: T1, fontSize: 17, fontWeight: 640 }}>{stats!.sales.tables.n.toLocaleString()}</p>
                    <p className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{eur(stats!.sales.tables.revenue)}</p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <Wine className="h-3 w-3" /> {t('adminTraffic.salesDrinks')}
                    </p>
                    <p className="tabular-nums mt-1" style={{ color: T1, fontSize: 17, fontWeight: 640 }}>{stats!.sales.drinks.n.toLocaleString()}</p>
                    <p className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{eur(stats!.sales.drinks.revenue)}</p>
                  </div>
                </div>
              </Card>

              {/* Temps réel */}
              <Card>
                <CardTitle icon={Radar} sub={t('adminTraffic.liveSub')}>{t('adminTraffic.liveTitle')}</CardTitle>
                {(live?.pages ?? []).length === 0 ? (
                  <p className="text-center py-8 text-xs" style={{ color: T3 }}>{t('adminTraffic.liveEmpty')}</p>
                ) : (
                  <>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {live!.pages.map((p, i) => {
                        const DevIcon = DEVICE_ICONS[p.device ?? ''] ?? Monitor;
                        return (
                          <div key={i} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                            <DevIcon className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
                            <span className="truncate flex-1" style={{ color: T2, fontSize: 12 }}>{p.path || '/'}</span>
                            {p.country && <span style={{ fontSize: 12 }}>{flagEmoji(p.country)}</span>}
                            {p.is_native && <span className="rounded px-1 py-0.5" style={{ color: RED, fontSize: 9.5, fontWeight: 700, background: 'rgba(232,25,44,0.12)' }}>APP</span>}
                            <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 10.5 }}>{p.seconds_ago < 60 ? `${p.seconds_ago}s` : `${Math.floor(p.seconds_ago / 60)}m`}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-center" style={{ color: T3, fontSize: 11 }}>
                      {t('adminTraffic.livePv30').replace('{n}', String(live!.last30m))}
                      {live!.native > 0 && ` · ${live!.native} ${t('adminTraffic.liveInApp')}`}
                    </p>
                  </>
                )}
              </Card>
            </div>

            {/* ───── Acquisition ───── */}
            <ZoneHeading icon={Share2}>{t('adminTraffic.acquisition')}</ZoneHeading>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle icon={Share2} sub={t('adminTraffic.channelsSub')}>{t('adminTraffic.channelsTitle')}</CardTitle>
                <div className="space-y-3">
                  {stats!.channels.map(c => (
                    <BarRow
                      key={c.channel}
                      label={channelLabel(c.channel)}
                      value={c.sessions}
                      max={channelMax}
                      sub={pctOf(c.sessions, totals!.sessions)}
                      accent
                    />
                  ))}
                </div>
              </Card>

              <Card>
                <CardTitle icon={Globe}>{t('adminTraffic.referrersTitle')}</CardTitle>
                {stats!.referrers.length === 0 ? (
                  <p className="text-center py-8 text-xs" style={{ color: T3 }}>{t('adminTraffic.noReferrers')}</p>
                ) : (
                  <div className="space-y-3">
                    {stats!.referrers.map(r => (
                      <BarRow key={r.host} label={r.host} value={r.sessions} max={refMax} />
                    ))}
                  </div>
                )}
                {stats!.campaigns.length > 0 && (
                  <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                    <p className="text-[10px] uppercase tracking-wider mb-2.5" style={{ color: T3 }}>{t('adminTraffic.campaignsTitle')}</p>
                    <div className="space-y-2">
                      {stats!.campaigns.map((c, i) => (
                        <div key={i} className="flex items-center justify-between" style={{ fontSize: 12 }}>
                          <span className="truncate pr-2" style={{ color: T2 }}>
                            {c.campaign}
                            {c.source ? <span style={{ color: T3 }}> · {c.source}</span> : null}
                          </span>
                          <span className="tabular-nums flex-none" style={{ color: T1 }}>{c.sessions.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* ───── Comportement ───── */}
            <ZoneHeading icon={FileText}>{t('adminTraffic.behavior')}</ZoneHeading>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle icon={FileText} sub={t('adminTraffic.topPagesSub')}>{t('adminTraffic.topPagesTitle')}</CardTitle>
                <RankedList items={stats!.pages.map(p => ({
                  name: p.path,
                  sub: `${p.sessions.toLocaleString()} ${t('adminTraffic.sessions').toLowerCase()}${p.avg_seconds ? ` · ${fmtDur(p.avg_seconds)}` : ''}`,
                  value: `${p.views.toLocaleString()} ${t('adminTraffic.views')}`,
                }))} />
              </Card>

              <Card>
                <CardTitle icon={LayoutGrid} sub={t('adminTraffic.sectionsSub')}>{t('adminTraffic.sectionsTitle')}</CardTitle>
                <div className="space-y-3">
                  {stats!.groups.map(g => (
                    <BarRow
                      key={g.grp}
                      label={groupLabel(g.grp)}
                      value={g.views}
                      max={groupMax}
                      sub={pctOf(g.views, totals!.pageviews)}
                      accent
                    />
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle icon={MapPin} sub={t('adminTraffic.entrySub')}>{t('adminTraffic.entryTitle')}</CardTitle>
                <div className="space-y-3">
                  {stats!.entries.map(e => (
                    <BarRow key={e.path} label={e.path} value={e.sessions} max={entryMax} accent />
                  ))}
                </div>
              </Card>

              <Card>
                <CardTitle icon={LogOut} sub={t('adminTraffic.exitSub')}>{t('adminTraffic.exitTitle')}</CardTitle>
                <div className="space-y-3">
                  {stats!.exits.map(e => (
                    <BarRow key={e.path} label={e.path} value={e.sessions} max={exitMax} />
                  ))}
                </div>
              </Card>
            </div>

            {/* ───── Audience ───── */}
            <ZoneHeading icon={Users}>{t('adminTraffic.audience')}</ZoneHeading>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle icon={Smartphone}>{t('adminTraffic.devicesTitle')}</CardTitle>
                <div className="space-y-3">
                  {stats!.devices.map(d => (
                    <BarRow
                      key={d.k}
                      label={deviceLabel(d.k)}
                      value={d.n}
                      max={Math.max(1, deviceTotal)}
                      sub={pctOf(d.n, deviceTotal)}
                      accent={d.k === 'mobile'}
                    />
                  ))}
                </div>
                <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <p className="text-[10px] uppercase tracking-wider mb-2.5" style={{ color: T3 }}>{t('adminTraffic.browsersTitle')}</p>
                  <div className="space-y-2.5">
                    {stats!.browsers.slice(0, 6).map(b => (
                      <BarRow key={b.k} label={b.k === 'app' ? t('adminTraffic.app') : b.k} value={b.n} max={browserMax} />
                    ))}
                  </div>
                </div>
              </Card>

              <Card>
                <CardTitle icon={Globe}>{t('adminTraffic.countriesTitle')}</CardTitle>
                <div className="space-y-3">
                  {stats!.countries.map(c => (
                    <BarRow
                      key={c.k}
                      label={c.k === '—' ? '—' : `${flagEmoji(c.k)} ${c.k}`}
                      value={c.n}
                      max={countryMax}
                      sub={pctOf(c.n, totals!.sessions)}
                      accent
                    />
                  ))}
                </div>
                <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider mb-2.5" style={{ color: T3 }}>
                    <Languages className="h-3 w-3" /> {t('adminTraffic.languagesTitle')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {stats!.languages.map(l => (
                      <span key={l.k} className="rounded-lg px-2.5 py-1.5 tabular-nums" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 12 }}>
                        <span style={{ color: T1, fontWeight: 600, textTransform: 'uppercase' }}>{l.k}</span> · {l.n.toLocaleString()}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
