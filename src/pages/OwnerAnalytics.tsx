import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
  Download, Ticket, Wine, Users, RotateCcw,
  Lock as LockIcon, Percent, Eye, ShoppingCart, CreditCard,
  MousePointerClick, TrendingUp, Layers, Flame, Clock,
  ArrowUpRight, ArrowDownRight, Sparkles, Globe, Calendar,
  DoorOpen, UserCheck, Footprints, Megaphone, Target, Repeat, Crown, HeartHandshake,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { format, subMinutes, subHours } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useState, useEffect } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { useAnalyticsData, type AnalyticsMode, type DateRange } from '@/hooks/useAnalyticsData';
import { useNightAnalytics } from '@/hooks/useNightAnalytics';
import { usePromoterAnalytics } from '@/hooks/usePromoterAnalytics';
import { useCustomerAnalytics } from '@/hooks/useCustomerAnalytics';
import { AnalyticsEssentialView } from '@/components/analytics/AnalyticsEssentialView';
import { DrinkAnalyticsSection } from '@/components/analytics/DrinkAnalyticsSection';
import { TableAnalyticsSection } from '@/components/analytics/TableAnalyticsSection';
import { TicketAnalyticsOverview } from '@/components/analytics/TicketAnalyticsOverview';
import { TicketAnalyticsLaunch } from '@/components/analytics/TicketAnalyticsLaunch';
import { TicketAnalyticsTypes } from '@/components/analytics/TicketAnalyticsTypes';
import { TicketAnalyticsPhases } from '@/components/analytics/TicketAnalyticsPhases';
import { RefundAnalyticsSection } from '@/components/analytics/RefundAnalyticsSection';
import { AnalyticsHubLayout, type AnalyticsPillar } from '@/components/analytics/AnalyticsHubLayout';
import { LiveActivityHero } from '@/components/analytics/LiveActivityHero';
import { AcquisitionDashboard } from '@/components/analytics/AcquisitionDashboard';
import { BehaviorAnalytics } from '@/components/analytics/BehaviorAnalytics';
import { AudienceInsights } from '@/components/analytics/AudienceInsights';
import { AnalyticsPeriodFilter, type AnalyticsRange, rangeToDates } from '@/components/analytics/AnalyticsPeriodFilter';
import { STRIPE_FEE_LABEL } from '@/utils/fees';

// ─── Design tokens ────────────────────────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
const NEG = '#FF5C63';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_HI = 'rgba(255,255,255,0.92)';
const C_MID = 'rgba(255,255,255,0.40)';
const C_LO = 'rgba(255,255,255,0.14)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Premium card wrapper ─────────────────────────────────────────────────────
function PCard({
  children, className = '', style = {},
  icon, title, sub, right,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  icon?: React.ReactNode;
  title?: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden relative ${className}`}
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding: 22,
        ...style,
      }}
    >
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {icon}
              </div>
            )}
            <div>
              {title && <h3 className="m-0 text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{title}</h3>}
              {sub && <p className="m-0 mt-0.5 text-xs" style={{ color: T3 }}>{sub}</p>}
            </div>
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Delta badge ──────────────────────────────────────────────────────────────
function Delta({ delta, vs }: { delta: number | null; vs?: string }) {
  // Real period-over-period delta. Null when there's no comparable prior period
  // (all-time, single-event, or no prior activity) — we render nothing rather than a fake number.
  if (delta === null || !isFinite(delta)) return null;
  const up = delta >= 0;
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold tabular-nums"
      style={{ color: up ? POS : NEG }}>
      {up
        ? <ArrowUpRight className="w-3 h-3" />
        : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(delta).toFixed(1)}%
      {vs && <span className="font-normal ml-1" style={{ color: T3 }}>{vs}</span>}
    </span>
  );
}

// ─── Zone heading (IA section separator) ──────────────────────────────────────
function ZoneHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span style={{ color: T2 }}>{icon}</span>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: T2 }}>{label}</h3>
    </div>
  );
}

// ─── Catmull-Rom smooth path ──────────────────────────────────────────────────
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ pts, accent = false }: { pts: number[]; accent?: boolean }) {
  const W = 96, H = 34, pad = 3;
  if (!pts.length) return <svg width={W} height={H} />;
  const max = Math.max(...pts), min = Math.min(...pts), rng = max - min || 1;
  const xs = pts.map((_, i) => pad + (i / Math.max(pts.length - 1, 1)) * (W - pad * 2));
  const ys = pts.map(v => H - pad - ((v - min) / rng) * (H - pad * 2));
  const linePts: [number, number][] = xs.map((x, i) => [x, ys[i]]);
  const line = smooth(linePts);
  const area = `${line} L ${xs[xs.length - 1]} ${H} L ${xs[0]} ${H} Z`;
  const stroke = accent ? RED : C_HI;
  const uid = `sg${pts.length}${Math.round((pts[0] ?? 0) * 10)}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="1" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.2} fill={stroke} />
    </svg>
  );
}

// ─── Revenue hourly bars ──────────────────────────────────────────────────────
function RevenueBars({ data }: { data: { hour: string; revenue: number }[] }) {
  if (!data.length) return null;
  const bw = 18, gap = 8, step = bw + gap;
  const W = data.length * step;
  const plotH = 180, labelH = 20, H = plotH + labelH;
  const maxVal = Math.max(...data.map(d => d.revenue), 1) * 1.1;
  const peakIdx = data.reduce((m, d, i) => d.revenue > data[m].revenue ? i : m, 0);
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: 'auto' }}>
        {[0.25, 0.5, 0.75].map((g, i) => (
          <line key={i} x1={0} x2={W} y1={plotH - plotH * g} y2={plotH - plotH * g} stroke={C_FAINT} strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const x = i * step + gap / 2;
          const bh = Math.max(2, (d.revenue / maxVal) * plotH);
          const y = plotH - bh;
          const r = Math.min(5, bw / 2);
          const isPeak = i === peakIdx;
          const showLabel = i % 3 === 0;
          return (
            <g key={i}>
              <path
                d={`M${x} ${y + r} a${r} ${r} 0 0 1 ${r} ${-r} h${bw - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} V${plotH} H${x} Z`}
                fill={isPeak ? RED : C_MID}
                opacity={isPeak ? 0.85 : 1}
              />
              {showLabel && (
                <text x={x + bw / 2} y={H - 4} fill={T3} fontSize={9} textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {d.hour}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Conversion funnel ribbon ─────────────────────────────────────────────────
function FunnelRibbon({ stages }: { stages: { label: string; n: number; pct: string }[] }) {
  if (!stages.length) return null;
  const W = 900, H = 260, cy = H / 2;
  const colW = W / stages.length;
  const vmax = stages[0].n || 1;
  const maxBand = 200;
  const hAt = (i: number, scale: number) => Math.max(6, (stages[i].n / vmax) * maxBand) * scale;
  const centers = stages.map((_, i) => (i + 0.5) * colW);
  const ax = [0, ...centers, W];

  const layers = [
    { scale: 1.0, fill: C_LO, op: 1 },
    { scale: 0.66, fill: C_MID, op: 0.9 },
    { scale: 0.36, fill: RED, op: 0.75 },
  ];

  const ribbons = layers.map((L, li) => {
    const hs = [hAt(0, L.scale), ...stages.map((_, i) => hAt(i, L.scale)), hAt(stages.length - 1, L.scale)];
    const top: [number, number][] = ax.map((x, i): [number, number] => [x, cy - hs[i] / 2]);
    const bot: [number, number][] = ax.map((x, i): [number, number] => [x, cy + hs[i] / 2]).reverse();
    const topPath = smooth(top);
    const botRev = smooth(bot);
    const d = `${topPath} L ${bot[0][0]} ${bot[0][1]} ${botRev.replace(/^M[^C]*/, '')} Z`;
    return <path key={li} d={d} fill={L.fill} opacity={L.op} />;
  });

  const pills = stages.map((s, i) => {
    const x = centers[i], pw = 58, ph = 28;
    return (
      <g key={i}>
        <rect x={x - pw / 2} y={cy - ph / 2} width={pw} height={ph} rx={14} fill="rgba(255,255,255,0.94)" />
        <text x={x} y={cy + 1} fill="#000" fontSize={13} fontWeight={700} textAnchor="middle" dominantBaseline="middle">{s.pct}</text>
      </g>
    );
  });

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 220 }}>
        {ribbons}
        {stages.map((_, i) => i === 0 ? null : (
          <line key={i} x1={i * colW} x2={i * colW} y1={18} y2={H - 18} stroke={BORDER} strokeWidth={1} />
        ))}
        {pills}
      </svg>
    </div>
  );
}

// ─── Donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ data }: { data: { name: string; val: number; pct: number }[] }) {
  const S = 160, c = S / 2, r = 56, sw = 18;
  const circ = 2 * Math.PI * r;
  const gapDeg = 4;
  const shades = [RED, C_HI, C_MID, C_LO];
  let acc = 0;
  const total = data.reduce((s, d) => s + d.pct, 0) || 100;
  const segs = data.map((d, i) => {
    const frac = d.pct / total;
    const len = circ * frac - (circ * gapDeg / 360);
    const off = circ * (acc / total) + (circ * gapDeg / 720);
    acc += d.pct;
    return (
      <circle
        key={i} cx={c} cy={c} r={r}
        fill="none" stroke={shades[i % shades.length]} strokeWidth={sw}
        strokeDasharray={`${Math.max(0, len)} ${circ - Math.max(0, len)}`}
        strokeDashoffset={-off}
        transform={`rotate(-90 ${c} ${c})`}
        strokeLinecap="butt"
      />
    );
  });
  // Center label shows the dominant category, not data[0] (which made an empty
  // first category like "Boissons" read "0%" while real revenue sat in others).
  const hasData = data.some(d => d.val > 0);
  const top = data.reduce((m, d) => (d.val > m.val ? d : m), data[0] ?? { name: '', val: 0, pct: 0 });
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke={C_FAINT} strokeWidth={sw} />
      {segs}
      <text x={c} y={c - 5} fill={T1} fontSize={21} fontWeight={650} textAnchor="middle"
        style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {hasData ? top.pct : 0}%
      </text>
      <text x={c} y={c + 14} fill={T3} fontSize={10} textAnchor="middle"
        style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {hasData ? top.name.split(' ')[0] : ''}
      </text>
    </svg>
  );
}

// ─── Segment control ──────────────────────────────────────────────────────────
function Seg({ value, options, onChange }: {
  value: string;
  options: { key: string; label: string; icon?: React.ReactNode }[];
  onChange: (k: string) => void;
}) {
  return (
    <div
      className="inline-flex gap-0.5 p-1 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}
    >
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150"
          style={value === o.key
            ? { color: T1, background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000' }
            : { color: T3 }
          }
        >
          {o.icon && <span style={{ opacity: 0.7 }}>{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function OwnerAnalytics() {
  const { t, language } = useLanguage();
  const { venueId } = useVenueContext();
  const { hasFeature } = useSubscriptionPlan();
  const hasAdvancedAnalytics = hasFeature('analytics_advanced');
  const hasExport = hasFeature('exports_csv');
  const hasVipTables = hasFeature('vip_tables');

  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const [mode, setMode] = useState<AnalyticsMode>('global');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [liveVisitors, setLiveVisitors] = useState(0);
  const [recentActivity, setRecentActivity] = useState(0);
  const [activeTab, setActiveTab] = useState<'drinks' | 'tickets' | 'tables' | 'refunds'>('drinks');
  const [ticketSubTab, setTicketSubTab] = useState<'overview' | 'launch' | 'types' | 'phases'>('overview');
  const [pillar, setPillar] = useState<AnalyticsPillar>('pulse');
  const [hubRange, setHubRange] = useState<AnalyticsRange>('7d');
  const [hubDevice, setHubDevice] = useState<string>('all');
  const [hubSource, setHubSource] = useState<string>('all');
  const hubDates = rangeToDates(hubRange);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const {
    drinkAnalytics, ticketAnalytics, tableAnalytics, refundAnalytics, events,
    currentTotals, previousTotals, uniqueGuestsTotal, loading,
  } = useAnalyticsData({
    venueId, dateRange, mode, selectedEventId,
  });
  const { nightAnalytics } = useNightAnalytics({ venueId, dateRange, mode, selectedEventId });
  const { promoterAnalytics } = usePromoterAnalytics({ venueId, dateRange, mode, selectedEventId });
  const { customerAnalytics } = useCustomerAnalytics({ venueId });

  useEffect(() => {
    if (!venueId) return;
    const fetchLive = async () => {
      const fiveMinutesAgo = subMinutes(new Date(), 5);
      const oneHourAgo = subHours(new Date(), 1);
      const { data: liveData } = await supabase.from('visitor_sessions').select('id').eq('venue_id', venueId).gte('visited_at', fiveMinutesAgo.toISOString());
      setLiveVisitors(liveData?.length || 0);
      const { data: recentData } = await supabase.from('visitor_sessions').select('id').eq('venue_id', venueId).gte('visited_at', oneHourAgo.toISOString());
      setRecentActivity(recentData?.length || 0);
    };
    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    const channel = supabase
      .channel(`visitor_sessions_changes_${venueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visitor_sessions', filter: `venue_id=eq.${venueId}` }, () => fetchLive())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [venueId]);

  const handleExportData = async () => {
    if (!drinkAnalytics || !ticketAnalytics || !tableAnalytics) return;
    setExporting(true);
    try {
      const rows: string[] = [];
      rows.push('Yuno Analytics Export');
      rows.push(`Date: ${format(new Date(), 'PPP', { locale: dateLocale })}`);
      rows.push(`Period: ${dateRange}`);
      rows.push('');
      rows.push('=== DRINKS ===');
      rows.push(`Total Revenue,${drinkAnalytics.totalRevenue.toFixed(2)}€`);
      rows.push(`Net Revenue,${drinkAnalytics.netRevenue.toFixed(2)}€`);
      rows.push(`Total Orders,${drinkAnalytics.totalOrders}`);
      rows.push('');
      rows.push('=== TICKETS ===');
      rows.push(`Total Revenue,${ticketAnalytics.totalRevenue.toFixed(2)}€`);
      rows.push(`Net Revenue,${ticketAnalytics.netRevenue.toFixed(2)}€`);
      rows.push(`Total Tickets,${ticketAnalytics.totalTickets}`);
      rows.push('');
      rows.push('=== TABLES VIP ===');
      rows.push(`Total Revenue,${tableAnalytics.totalRevenue.toFixed(2)}€`);
      rows.push(`Net Revenue,${tableAnalytics.netRevenue.toFixed(2)}€`);
      rows.push(`Total Reservations,${tableAnalytics.totalReservations}`);
      if (refundAnalytics && refundAnalytics.totalRefundCount > 0) {
        rows.push('');
        rows.push('=== REFUNDS ===');
        rows.push(`Total Refunded,${refundAnalytics.totalRefunded.toFixed(2)}€`);
        rows.push(`Refund Count,${refundAnalytics.totalRefundCount}`);
        rows.push(`Refund Rate,${refundAnalytics.refundRate.toFixed(1)}%`);
        rows.push(`Average Refund,${refundAnalytics.avgRefundAmount.toFixed(2)}€`);
        rows.push('');
        rows.push('Type,Count,Amount');
        refundAnalytics.refundsByType.forEach(r => rows.push(`${r.type},${r.count},${r.amount.toFixed(2)}€`));
      }
      const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yuno-analytics-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error', e);
    } finally {
      setExporting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading || !drinkAnalytics || !ticketAnalytics || !tableAnalytics) return <OwnerPageSkeleton />;

  // ── Essential plan ───────────────────────────────────────────────────────────
  if (!hasAdvancedAnalytics) {
    return (
      <div className="min-h-screen pb-24" style={{ background: '#000' }}>
        <OwnerHeader
          title={t('owner.analytics')}
          rightContent={
            <div className="flex items-center gap-2 px-3 py-2 rounded-full"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: POS }} />
              <span className="text-sm font-semibold" style={{ color: POS }}>
                {liveVisitors} <span className="font-normal opacity-70 hidden xs:inline">{t('owner.online')}</span>
              </span>
            </div>
          }
        />
        <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
          <div className="flex gap-2 flex-wrap p-1.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
            {(['24h', '48h', '72h', '7days', '30days', 'alltime'] as DateRange[]).map(range => (
              <Button key={range} variant="ghost" onClick={() => setDateRange(range)} size="sm"
                className="text-xs h-8 rounded-lg transition-all duration-150 cursor-pointer"
                style={dateRange === range
                  ? { background: RED, color: '#fff', boxShadow: `0 0 15px -3px ${RED}55` }
                  : { color: T3 }}>
                {range === '7days' ? `7 ${t('owner.days')}` : range === '30days' ? `30 ${t('owner.days')}` : range === 'alltime' ? t('owner.allTime') : t(`owner.${range}`)}
              </Button>
            ))}
          </div>
          <AnalyticsEssentialView drinkAnalytics={drinkAnalytics} ticketAnalytics={ticketAnalytics} tableAnalytics={tableAnalytics} refundAnalytics={refundAnalytics} />
          <PCard>
            <div className="text-center py-2">
              <LockIcon className="h-8 w-8 mx-auto mb-3" style={{ color: RED }} />
              <p className="font-semibold mb-1" style={{ color: T1 }}>{t('analytics.advancedAvailable')}</p>
              <p className="text-sm mb-4" style={{ color: T3 }}>{t('analytics.advancedDesc')}</p>
              <Button asChild style={{ background: RED, color: '#fff' }}>
                <Link to="/owner/billing">{t('plan.upgradeTo')} Pro</Link>
              </Button>
            </div>
          </PCard>
        </div>
      </div>
    );
  }

  // ── Pro / Elite ──────────────────────────────────────────────────────────────

  // Aggregate KPI data — all on the same club-revenue base (Yuno fees excluded).
  const totalRevenue = drinkAnalytics.totalRevenue + ticketAnalytics.totalRevenue + tableAnalytics.totalRevenue;
  const totalOrders = drinkAnalytics.totalOrders + ticketAnalytics.totalTickets + tableAnalytics.totalReservations;
  const totalStripeFee = drinkAnalytics.stripeFee + ticketAnalytics.stripeFee + tableAnalytics.stripeFee;
  // Refunds line = fully-refunded bookings + partial refunds on still-paid rows (both club-side).
  const partialRefunded = drinkAnalytics.partialRefunded + ticketAnalytics.partialRefunded + tableAnalytics.partialRefunded;
  const totalRefunded = (refundAnalytics?.totalRefunded || 0) + partialRefunded;
  // Net payout foots exactly: Gross − Stripe − Refunds.
  const totalNetRevenue = totalRevenue - totalStripeFee - totalRefunded;
  const totalGuests = uniqueGuestsTotal;

  // Unified day series across all categories (not just drinks) for the KPI sparklines.
  const dayKeys = Array.from(new Set([
    ...drinkAnalytics.revenueByDay.map(d => d.date),
    ...ticketAnalytics.revenueByDay.map(d => d.date),
    ...tableAnalytics.revenueByDay.map(d => d.date),
  ])).sort();
  const revAt = (date: string) =>
    (drinkAnalytics.revenueByDay.find(d => d.date === date)?.revenue || 0) +
    (ticketAnalytics.revenueByDay.find(d => d.date === date)?.revenue || 0) +
    (tableAnalytics.revenueByDay.find(d => d.date === date)?.revenue || 0);
  const ordAt = (date: string) =>
    (drinkAnalytics.revenueByDay.find(d => d.date === date)?.orders || 0) +
    (ticketAnalytics.revenueByDay.find(d => d.date === date)?.tickets || 0) +
    (tableAnalytics.revenueByDay.find(d => d.date === date)?.reservations || 0);
  const grossSparkPts = dayKeys.map(revAt);
  const ordersSparkPts = dayKeys.map(ordAt);
  const aovSparkPts = grossSparkPts.map((r, i) => ordersSparkPts[i] ? r / ordersSparkPts[i] : 0);

  // Combined hourly revenue across all categories for the main "Gross Revenue / hour" chart.
  const combinedHourly = (() => {
    const byHour = new Map<string, number>();
    [drinkAnalytics.hourlyData, ticketAnalytics.hourlyData, tableAnalytics.hourlyData].forEach(arr =>
      arr.forEach((d: any) => byHour.set(d.hour, (byHour.get(d.hour) || 0) + d.revenue)));
    return Array.from(byHour.entries())
      .map(([hour, revenue]) => ({ hour, revenue }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  })();

  const fmt = (n: number) => n >= 1000 ? `€${(n / 1000).toFixed(1)}k` : `€${n.toFixed(0)}`;

  // Real "vs previous period" deltas computed from the prior equal-length window.
  const pctDelta = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
  const revDelta = previousTotals && currentTotals ? pctDelta(currentTotals.revenue, previousTotals.revenue) : null;
  const ordDelta = previousTotals && currentTotals ? pctDelta(currentTotals.orders, previousTotals.orders) : null;
  const guestDelta = previousTotals && currentTotals ? pctDelta(currentTotals.guests, previousTotals.guests) : null;
  const aovCur = currentTotals && currentTotals.orders > 0 ? currentTotals.revenue / currentTotals.orders : 0;
  const aovPrev = previousTotals && previousTotals.orders > 0 ? previousTotals.revenue / previousTotals.orders : 0;
  const aovDelta = previousTotals ? pctDelta(aovCur, aovPrev) : null;

  const kpis = [
    { label: t('owner.an.grossRevenue'), val: fmt(totalRevenue), spark: grossSparkPts, icon: <TrendingUp className="w-4 h-4" />, delta: revDelta },
    { label: t('owner.an.totalOrders'), val: totalOrders.toLocaleString(), spark: ordersSparkPts, icon: <ShoppingCart className="w-4 h-4" />, delta: ordDelta },
    { label: t('owner.an.avgOrderValue'), val: totalOrders > 0 ? fmt(totalRevenue / totalOrders) : '€0', spark: aovSparkPts, icon: <CreditCard className="w-4 h-4" />, delta: aovDelta },
    { label: t('owner.an.uniqueGuests'), val: totalGuests.toLocaleString(), spark: [], icon: <Users className="w-4 h-4" />, delta: guestDelta },
  ];

  // Funnel steps (drinks funnel data)
  const funnelSteps = [
    { label: t('owner.visitors'), n: drinkAnalytics.visitors, pct: drinkAnalytics.visitors > 0 ? '100%' : '0%' },
    { label: t('owner.addedToCart'), n: drinkAnalytics.addedToCart, pct: drinkAnalytics.visitors > 0 ? ((drinkAnalytics.addedToCart / drinkAnalytics.visitors) * 100).toFixed(0) + '%' : '0%' },
    { label: t('owner.proceededToCheckout'), n: drinkAnalytics.proceededToCheckout, pct: drinkAnalytics.visitors > 0 ? ((drinkAnalytics.proceededToCheckout / drinkAnalytics.visitors) * 100).toFixed(0) + '%' : '0%' },
    { label: t('owner.paidOrders'), n: drinkAnalytics.totalOrders, pct: drinkAnalytics.visitors > 0 ? drinkAnalytics.conversionRate.toFixed(1) + '%' : '0%' },
  ];

  // Donut: revenue mix by category
  const categories = [
    { name: t('owner.an.drinks'), val: drinkAnalytics.totalRevenue, pct: totalRevenue > 0 ? Math.round(drinkAnalytics.totalRevenue / totalRevenue * 100) : 0 },
    { name: t('owner.an.tickets'), val: ticketAnalytics.totalRevenue, pct: totalRevenue > 0 ? Math.round(ticketAnalytics.totalRevenue / totalRevenue * 100) : 0 },
    { name: t('owner.an.vipTables'), val: tableAnalytics.totalRevenue, pct: totalRevenue > 0 ? Math.round(tableAnalytics.totalRevenue / totalRevenue * 100) : 0 },
  ];

  // Finance strip — Gross − Stripe − Refunds = Net Payout (now foots exactly).
  const financeData = [
    { label: t('owner.an.grossVolume'), val: `€${totalRevenue.toFixed(0)}`, desc: `${totalOrders} ${t('owner.an.transactions')}` },
    { label: 'Stripe fees', val: `−€${totalStripeFee.toFixed(0)}`, desc: STRIPE_FEE_LABEL },
    { label: t('owner.an.refunds'), val: `−€${totalRefunded.toFixed(0)}`, desc: `${refundAnalytics?.totalRefundCount || 0} ${t('owner.an.refundsLower')}` },
    { label: t('owner.an.netPayout'), val: `€${totalNetRevenue.toFixed(0)}`, desc: t('owner.an.settles2days') },
  ];

  // Period options
  const periodOptions = [
    { key: '24h' as DateRange, label: '24h' },
    { key: '48h' as DateRange, label: '48h' },
    { key: '72h' as DateRange, label: '72h' },
    { key: '7days' as DateRange, label: `7 ${t('owner.days')}` },
    { key: '30days' as DateRange, label: `30 ${t('owner.days')}` },
    { key: 'alltime' as DateRange, label: t('owner.allTime') },
  ];

  const tabs = [
    { id: 'drinks' as const, label: t('owner.drinksTab'), icon: Wine },
    { id: 'tickets' as const, label: t('owner.ticketsTab'), icon: Ticket },
    { id: 'tables' as const, label: t('owner.tablesVIP'), icon: Users },
    { id: 'refunds' as const, label: t('owner.refundsTab'), icon: RotateCcw },
  ];

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      {/* Top ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader
        title={t('owner.analytics')}
        rightContent={
          <div className="flex items-center gap-2 px-3 py-2 rounded-full"
            style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
            <div className="relative">
              <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
              <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75" style={{ background: POS }} />
            </div>
            <span className="text-sm font-semibold tabular-nums" style={{ color: POS }}>
              {liveVisitors} <span className="font-normal opacity-70 hidden xs:inline">{t('owner.online')}</span>
            </span>
          </div>
        }
      />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">

        {/* ── Controls row ──────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              value={mode}
              options={[
                { key: 'global', label: t('owner.an.global'), icon: <Globe className="w-3.5 h-3.5" /> },
                { key: 'event', label: t('owner.an.event'), icon: <Calendar className="w-3.5 h-3.5" /> },
              ]}
              onChange={(k) => { setMode(k as AnalyticsMode); if (k === 'global') setSelectedEventId(null); }}
            />
            {mode === 'event' && events.length > 0 && (
              <select
                value={selectedEventId || ''}
                onChange={(e) => setSelectedEventId(e.target.value || null)}
                className="h-9 px-3 rounded-xl text-[13px] cursor-pointer outline-none"
                style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, color: T1 }}
              >
                <option value="" style={{ background: '#0a0a0c' }}>
                  {t('owner.an.selectEvent')}
                </option>
                {events.map(event => (
                  <option key={event.id} value={event.id} style={{ background: '#0a0a0c' }}>
                    {event.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
            {mode === 'global' && (
              <div className="flex gap-1 flex-wrap p-1 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
                {periodOptions.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setDateRange(opt.key)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                    style={dateRange === opt.key
                      ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` }
                      : { color: T3 }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleExportData}
              disabled={exporting || !hasExport}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}>
              {hasExport
                ? <><Download className="w-4 h-4" /><span className="hidden sm:inline">{exporting ? t('owner.exporting') : t('owner.exportData')}</span><span className="sm:hidden">Export</span></>
                : <><LockIcon className="w-4 h-4" /><span className="text-xs">Pro</span></>}
            </button>
          </div>
        </motion.div>

        {/* ── Zone 1 · Overview ─────────────────────────────────────────── */}
        <ZoneHeading icon={<Layers className="w-4 h-4" />} label={t('owner.an.zoneOverview')} />

        {/* ── KPI row ───────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi, i) => (
            <PCard key={i}>
              <div className="flex flex-col min-h-[120px]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>
                    {kpi.label}
                  </span>
                  <span style={{ color: T3 }}>{kpi.icon}</span>
                </div>
                <div className="mt-3 text-[clamp(26px,3vw,36px)] font-[640] leading-none tabular-nums"
                  style={{ color: T1, letterSpacing: '-0.025em' }}>
                  {kpi.val}
                </div>
                <div className="mt-auto pt-3 flex items-end justify-between gap-2">
                  <Delta delta={kpi.delta} vs="vs prev" />
                  <Sparkline pts={kpi.spark} accent={i === 0} />
                </div>
              </div>
            </PCard>
          ))}
        </motion.div>

        {/* ── Revenue bars ──────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <PCard
            icon={<TrendingUp className="w-4 h-4" />}
            title={t('owner.an.grossRevenueHourly')}
            sub={t('owner.an.distributionOverPeriod')}
            right={
              <div className="text-right">
                <div className="text-[clamp(22px,2.5vw,30px)] font-[640] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.025em' }}>
                  {fmt(totalRevenue)}
                </div>
                <div className="text-xs mt-1" style={{ color: T3 }}>
                  {t('owner.an.totalPeriod')}
                </div>
              </div>
            }
          >
            {combinedHourly.length > 0
              ? <RevenueBars data={combinedHourly} />
              : <div className="h-40 flex items-center justify-center text-sm" style={{ color: T3 }}>
                  {t('owner.an.noDataPeriod')}
                </div>
            }
          </PCard>
        </motion.div>

        {/* ── Funnel + Donut ────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="grid lg:grid-cols-[3fr,2fr] gap-3">
          {/* Conversion funnel */}
          <PCard
            icon={<Percent className="w-4 h-4" />}
            title={t('owner.conversionFunnel')}
            sub={t('owner.an.drinksFunnel')}
            right={
              <div className="text-right px-4 py-2 rounded-xl" style={{ background: 'rgba(232,25,44,0.08)', border: `1px solid rgba(232,25,44,0.2)` }}>
                <div className="text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: T3 }}>{t('owner.globalRate')}</div>
                <div className="text-2xl font-[660] tabular-nums" style={{ color: RED, letterSpacing: '-0.03em' }}>
                  {drinkAnalytics.visitors > 0 ? `${drinkAnalytics.conversionRate.toFixed(1)}%` : '—'}
                </div>
              </div>
            }
          >
            {drinkAnalytics.visitors > 0 ? (
              <>
                <FunnelRibbon stages={funnelSteps} />
                <div className="grid mt-3" style={{ gridTemplateColumns: `repeat(${funnelSteps.length}, 1fr)` }}>
                  {funnelSteps.map((s, i) => (
                    <div key={i} className="text-center px-1" style={{ borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                      <div className="text-base font-[640] tabular-nums leading-tight" style={{ color: T1, letterSpacing: '-0.02em' }}>
                        {s.n.toLocaleString()}
                      </div>
                      <div className="text-[11.5px] mt-1" style={{ color: T3 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center text-sm" style={{ height: 248, color: T3 }}>
                {t('owner.an.noDataPeriod')}
              </div>
            )}
          </PCard>

          {/* Revenue mix donut */}
          <PCard
            icon={<Layers className="w-4 h-4" />}
            title={t('owner.an.revenueMix')}
            sub={t('owner.an.shareByCategory')}
          >
            <div className="flex items-center gap-4 flex-wrap">
              <DonutChart data={categories} />
              <div className="flex flex-col gap-3 flex-1 min-w-[140px]">
                {categories.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-none"
                      style={{ background: i === 0 ? RED : i === 1 ? C_HI : C_MID }} />
                    <span className="text-sm flex-1" style={{ color: T2 }}>{c.name}</span>
                    <span className="text-[13.5px] font-[620] tabular-nums" style={{ color: T1 }}>
                      {fmt(c.val)}
                    </span>
                    <span className="text-[11.5px] w-9 text-right tabular-nums" style={{ color: T3 }}>
                      {c.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </PCard>
        </motion.div>

        {/* ── Top sellers ───────────────────────────────────────────────── */}
        {drinkAnalytics.topProducts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <PCard
              icon={<Flame className="w-4 h-4" />}
              title={t('owner.an.topSellers')}
              sub={t('owner.an.byRevenuePeriod')}
            >
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {drinkAnalytics.topProducts.slice(0, 6).map((p, i) => {
                  const maxRev = drinkAnalytics.topProducts[0]?.revenue || 1;
                  const barPct = (p.revenue / maxRev) * 100;
                  return (
                    <div key={i} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '20px 1fr auto' }}>
                      <span className="text-[12.5px] tabular-nums" style={{ color: T3 }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-[560] truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{p.name}</div>
                        <div className="text-[11.5px] mt-1" style={{ color: T3 }}>
                          {p.quantity} {t('owner.an.sold')}
                        </div>
                        <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div
                            className="h-full rounded transition-all"
                            style={{
                              width: `${barPct}%`,
                              background: i === 0
                                ? `linear-gradient(90deg,${RED}88,${RED})`
                                : `linear-gradient(90deg,${C_MID},${C_HI})`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-[620] tabular-nums" style={{ color: T1, letterSpacing: '-0.01em' }}>
                          {fmt(p.revenue)}
                        </div>
                        <div className="text-[11px] mt-1" style={{ color: T3 }}>
                          {t('owner.an.revenue')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </PCard>
          </motion.div>
        )}

        {/* ── The Night: attendance / no-show / arrivals ─────────────────── */}
        {nightAnalytics && (nightAnalytics.ticketsSold > 0 || nightAnalytics.tablesBooked > 0 || nightAnalytics.guestlistSize > 0) && (() => {
          const revenuePerHead = nightAnalytics.attendance > 0 ? totalRevenue / nightAnalytics.attendance : 0;
          const nightTiles = [
            { label: t('owner.an.attendance'), val: nightAnalytics.attendance.toLocaleString(), sub: t('owner.an.headsThroughDoor'), icon: <Footprints className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.ticketNoShow'), val: `${nightAnalytics.ticketNoShowRate.toFixed(0)}%`, sub: `${nightAnalytics.ticketsScanned}/${nightAnalytics.ticketsSold} ${t('owner.an.scanned')}`, icon: <UserCheck className="w-4 h-4" />, tone: nightAnalytics.ticketNoShowRate > 25 ? NEG : POS },
            { label: t('owner.an.revenuePerHead'), val: fmt(revenuePerHead), sub: t('owner.an.clubRevenueDivided'), icon: <CreditCard className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.guestlistFill'), val: nightAnalytics.guestlistSize > 0 ? `${nightAnalytics.guestlistFillRate.toFixed(0)}%` : '—', sub: nightAnalytics.guestlistSize > 0 ? `${nightAnalytics.guestlistArrived}/${nightAnalytics.guestlistSize}` : t('owner.an.noGuestlist'), icon: <DoorOpen className="w-4 h-4" />, tone: T1 },
          ];
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="space-y-3">
              <ZoneHeading icon={<DoorOpen className="w-4 h-4" />} label={t('owner.an.theNight')} />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {nightTiles.map((tile, i) => (
                  <PCard key={i}>
                    <div className="flex flex-col min-h-[104px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{tile.label}</span>
                        <span style={{ color: T3 }}>{tile.icon}</span>
                      </div>
                      <div className="mt-2 text-[clamp(22px,2.6vw,30px)] font-[640] leading-none tabular-nums" style={{ color: tile.tone, letterSpacing: '-0.025em' }}>
                        {tile.val}
                      </div>
                      <div className="mt-auto pt-2 text-[11.5px]" style={{ color: T3 }}>{tile.sub}</div>
                    </div>
                  </PCard>
                ))}
              </div>
              {nightAnalytics.arrivalsByHour.length > 0 && (
                <PCard
                  icon={<Clock className="w-4 h-4" />}
                  title={t('owner.an.arrivalsByHour')}
                  sub={t('owner.an.realDoorPeak')}
                >
                  <RevenueBars data={nightAnalytics.arrivalsByHour.map(a => ({ hour: a.hour, revenue: a.arrivals }))} />
                </PCard>
              )}
            </motion.div>
          );
        })()}

        {/* ── Promoter ROI ───────────────────────────────────────────────── */}
        {promoterAnalytics && promoterAnalytics.promoters.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
            <ZoneHeading icon={<Megaphone className="w-4 h-4" />} label={t('owner.an.promoterRoi')} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: t('owner.an.attributedRevenue'), val: fmt(promoterAnalytics.totalAttributed), sub: `${promoterAnalytics.totalConversions} ${t('owner.an.conversions')}`, icon: <TrendingUp className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.commissions'), val: `−${fmt(promoterAnalytics.totalCommission)}`, sub: t('owner.an.owedToPromoters'), icon: <CreditCard className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.clickToSale'), val: `${promoterAnalytics.convRate.toFixed(0)}%`, sub: `${promoterAnalytics.totalClicks} ${t('owner.an.clicks')}`, icon: <MousePointerClick className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.promoterRoiShort'), val: promoterAnalytics.totalCommission > 0 ? `${promoterAnalytics.roi.toFixed(1)}x` : '—', sub: t('owner.an.revenuePerEuro'), icon: <Target className="w-4 h-4" />, tone: promoterAnalytics.roi >= 1 ? POS : T1 },
              ].map((tile, i) => (
                <PCard key={i}>
                  <div className="flex flex-col min-h-[104px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{tile.label}</span>
                      <span style={{ color: T3 }}>{tile.icon}</span>
                    </div>
                    <div className="mt-2 text-[clamp(22px,2.6vw,30px)] font-[640] leading-none tabular-nums" style={{ color: tile.tone, letterSpacing: '-0.025em' }}>{tile.val}</div>
                    <div className="mt-auto pt-2 text-[11.5px]" style={{ color: T3 }}>{tile.sub}</div>
                  </div>
                </PCard>
              ))}
            </div>
            <PCard icon={<Megaphone className="w-4 h-4" />} title={t('owner.an.topPromoters')} sub={t('owner.an.byAttributedRevenue')}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {promoterAnalytics.promoters.slice(0, 8).map((p, i) => {
                  const maxRev = promoterAnalytics.promoters[0]?.revenue || 1;
                  const barPct = maxRev > 0 ? (p.revenue / maxRev) * 100 : 0;
                  return (
                    <div key={p.id} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '20px 1fr auto' }}>
                      <span className="text-[12.5px] tabular-nums" style={{ color: T3 }}>{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-[560] truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{p.name}</div>
                        <div className="text-[11.5px] mt-1" style={{ color: T3 }}>
                          {p.conversions} {t('owner.an.conversions')} · {p.clicks} {t('owner.an.clicks')} · {p.convRate.toFixed(0)}%
                        </div>
                        <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded transition-all" style={{ width: `${barPct}%`, background: i === 0 ? `linear-gradient(90deg,${RED}88,${RED})` : `linear-gradient(90deg,${C_MID},${C_HI})` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-[620] tabular-nums" style={{ color: T1, letterSpacing: '-0.01em' }}>{fmt(p.revenue)}</div>
                        <div className="text-[11px] mt-1" style={{ color: T3 }}>−{fmt(p.commission)} {t('owner.an.commissionLower')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </PCard>
          </motion.div>
        )}

        {/* ── Customer loyalty / RFM ─────────────────────────────────────── */}
        {customerAnalytics && customerAnalytics.totalCustomers > 0 && (() => {
          const segMeta: Record<string, { label: string; color: string }> = {
            new: { label: t('owner.an.segNew'), color: '#38BDF8' },
            active: { label: t('owner.an.segActive'), color: POS },
            atRisk: { label: t('owner.an.segAtRisk'), color: '#F59E0B' },
            lapsed: { label: t('owner.an.segLapsed'), color: T3 },
          };
          const segTotal = customerAnalytics.segments.reduce((s, x) => s + x.count, 0) || 1;
          const g = customerAnalytics.growth90;
          const tiles = [
            { label: t('owner.an.customers'), val: customerAnalytics.totalCustomers.toLocaleString(), sub: t('owner.an.lifetimeBase'), icon: <Users className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.repeatRate'), val: `${customerAnalytics.repeatRate.toFixed(0)}%`, sub: t('owner.an.cameMoreThanOnce'), icon: <Repeat className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.avgClv'), val: fmt(customerAnalytics.avgClv), sub: t('owner.an.lifetimeSpend'), icon: <Crown className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.growth90'), val: g === null ? '—' : `${g >= 0 ? '+' : ''}${g.toFixed(0)}%`, sub: t('owner.an.vsPrev90'), icon: <TrendingUp className="w-4 h-4" />, tone: g === null ? T1 : (g >= 0 ? POS : NEG) },
          ];
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }} className="space-y-3">
              <ZoneHeading icon={<HeartHandshake className="w-4 h-4" />} label={t('owner.an.loyalty')} />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {tiles.map((tile, i) => (
                  <PCard key={i}>
                    <div className="flex flex-col min-h-[104px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{tile.label}</span>
                        <span style={{ color: T3 }}>{tile.icon}</span>
                      </div>
                      <div className="mt-2 text-[clamp(22px,2.6vw,30px)] font-[640] leading-none tabular-nums" style={{ color: tile.tone, letterSpacing: '-0.025em' }}>{tile.val}</div>
                      <div className="mt-auto pt-2 text-[11.5px]" style={{ color: T3 }}>{tile.sub}</div>
                    </div>
                  </PCard>
                ))}
              </div>
              <div className="grid lg:grid-cols-2 gap-3">
                <PCard icon={<HeartHandshake className="w-4 h-4" />} title={t('owner.an.lifecycle')} sub={t('owner.an.byRecency')}>
                  <div className="flex h-2.5 rounded-full overflow-hidden mt-1" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    {customerAnalytics.segments.map(s => s.count > 0 && (
                      <div key={s.key} style={{ width: `${(s.count / segTotal) * 100}%`, background: segMeta[s.key].color }} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {customerAnalytics.segments.map(s => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: segMeta[s.key].color }} />
                        <span className="text-[12.5px]" style={{ color: T2 }}>{segMeta[s.key].label}</span>
                        <span className="text-[12.5px] tabular-nums ml-auto" style={{ color: T1 }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                </PCard>
                <PCard icon={<Crown className="w-4 h-4" />} title={t('owner.an.topCustomers')} sub={t('owner.an.byLifetimeSpend')}>
                  <div className="divide-y" style={{ borderColor: BORDER }}>
                    {customerAnalytics.topCustomers.slice(0, 5).map((c, i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5">
                        <span className="text-[12.5px] tabular-nums w-5" style={{ color: T3 }}>{String(i + 1).padStart(2, '0')}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-[560] truncate" style={{ color: T1 }}>{c.name}</div>
                          <div className="text-[11.5px]" style={{ color: T3 }}>{c.visitNights} {t('owner.an.nights')}</div>
                        </div>
                        <div className="text-sm font-[620] tabular-nums" style={{ color: T1 }}>{fmt(c.totalSpent)}</div>
                      </div>
                    ))}
                  </div>
                </PCard>
              </div>
            </motion.div>
          );
        })()}

        {/* ── Zone · Deep-dive ──────────────────────────────────────────── */}
        <div className="pt-2"><ZoneHeading icon={<Layers className="w-4 h-4" />} label={t('owner.an.zoneDetails')} /></div>

        {/* ── Premium Analytics Hub ─────────────────────────────────────── */}
        {venueId && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
            <PCard style={{ padding: 18 }}>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 flex items-center justify-center rounded-xl"
                  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                  <Sparkles className="w-4 h-4" style={{ color: RED }} />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold" style={{ color: T1, letterSpacing: '-0.01em' }}>
                    {t('owner.an.premiumHub')}
                  </h2>
                  <p className="text-[11.5px]" style={{ color: T3 }}>
                    Pulse · Acquisition · {t('owner.an.behavior')} · Audience
                  </p>
                </div>
              </div>

              <AnalyticsPeriodFilter
                range={hubRange} onChange={setHubRange}
                device={hubDevice} onDeviceChange={setHubDevice}
                source={hubSource} onSourceChange={setHubSource}
              />

              <div className="mt-4">
                <AnalyticsHubLayout active={pillar} onChange={setPillar}>
                  {pillar === 'pulse' && <LiveActivityHero scope={{ kind: 'venue', id: venueId }} from={hubDates.from} to={hubDates.to} deviceFilter={hubDevice} sourceFilter={hubSource} />}
                  {pillar === 'acquisition' && <AcquisitionDashboard scope={{ kind: 'venue', id: venueId }} from={hubDates.from} to={hubDates.to} deviceFilter={hubDevice} sourceFilter={hubSource} />}
                  {pillar === 'behavior' && <BehaviorAnalytics scope={{ kind: 'venue', id: venueId }} from={hubDates.from} to={hubDates.to} deviceFilter={hubDevice} sourceFilter={hubSource} />}
                  {pillar === 'audience' && <AudienceInsights scope={{ kind: 'venue', id: venueId }} from={hubDates.from} to={hubDates.to} />}
                </AnalyticsHubLayout>
              </div>
            </PCard>
          </motion.div>
        )}

        {/* ── Category tabs ─────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          {/* Tab bar */}
          <div className="flex gap-0.5 mb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
                  style={{ color: isActive ? T1 : T3 }}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {isActive && (
                    <span
                      className="absolute left-3 right-3 rounded-full"
                      style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="space-y-4">
            {activeTab === 'drinks' && (
              <DrinkAnalyticsSection data={drinkAnalytics} hasAdvancedAnalytics={hasAdvancedAnalytics} />
            )}
            {activeTab === 'tickets' && (
              <>
                <div className="flex gap-1 p-1 rounded-xl w-fit"
                  style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
                  {(['overview', 'launch', 'types', 'phases'] as const).map(tab => (
                    <button key={tab} onClick={() => setTicketSubTab(tab)}
                      className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                      style={ticketSubTab === tab
                        ? { color: '#fff', background: RED }
                        : { color: T3 }}>
                      {t(`analytics.tab.${tab}`)}
                    </button>
                  ))}
                </div>
                {ticketSubTab === 'overview' && <TicketAnalyticsOverview data={ticketAnalytics} />}
                {ticketSubTab === 'launch' && <TicketAnalyticsLaunch data={ticketAnalytics} />}
                {ticketSubTab === 'types' && <TicketAnalyticsTypes data={ticketAnalytics} />}
                {ticketSubTab === 'phases' && <TicketAnalyticsPhases data={ticketAnalytics} />}
              </>
            )}
            {activeTab === 'tables' && (
              <TableAnalyticsSection data={tableAnalytics} hasVipTables={hasVipTables} />
            )}
            {activeTab === 'refunds' && (
              refundAnalytics
                ? <RefundAnalyticsSection data={refundAnalytics} />
                : <div className="flex flex-col items-center justify-center py-16" style={{ color: T3 }}>
                    <RotateCcw className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm">{t('refund.noItems')}</p>
                  </div>
            )}
          </div>
        </motion.div>

        {/* ── Finance strip ─────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
          <PCard
            icon={<CreditCard className="w-4 h-4" />}
            title={t('owner.an.settlement')}
            sub={t('owner.an.payoutsViaStripe')}
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {financeData.map((f, i) => (
                <div key={i} className={i > 0 ? 'sm:border-l pl-0 sm:pl-4' : ''} style={{ borderColor: BORDER }}>
                  <div className="text-[11px] uppercase tracking-[0.07em]" style={{ color: T3 }}>{f.label}</div>
                  <div className="text-2xl font-[640] tabular-nums mt-2"
                    style={{ color: f.val.startsWith('−') ? T2 : i === 3 ? T1 : T1, letterSpacing: '-0.02em' }}>
                    {f.val}
                  </div>
                  <div className="text-[11.5px] mt-1.5" style={{ color: T3 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </PCard>
        </motion.div>

      </div>
    </div>
  );
}
