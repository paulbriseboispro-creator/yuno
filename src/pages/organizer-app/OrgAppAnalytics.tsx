import { motion } from 'framer-motion';
import {
  Download, Ticket, Users, RotateCcw,
  Percent, ShoppingCart, CreditCard,
  TrendingUp, Layers, Flame,
  ArrowUpRight, ArrowDownRight, Globe, Calendar, Activity,
  Loader2, ArrowLeft, ChevronDown, Sofa, Clock,
  DoorOpen, UserCheck, Footprints, Megaphone, Target, Repeat, Crown, HeartHandshake,
  ClipboardList, MousePointerClick,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { format, subMinutes, subHours, subDays, startOfDay } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAnalyticsData, type AnalyticsMode, type DateRange, dateRangeToWindow } from '@/hooks/useAnalyticsData';
import { useNightAnalytics } from '@/hooks/useNightAnalytics';
import { usePromoterAnalytics } from '@/hooks/usePromoterAnalytics';
import { useCustomerAnalytics } from '@/hooks/useCustomerAnalytics';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';
import { buildOrganizerScopeOr } from '@/components/analytics/scopeFilter';
import { EventAnalyticsPicker } from '@/components/analytics/EventAnalyticsPicker';
import { AnalyticsAnchorNav, type AnchorSection } from '@/components/analytics/AnalyticsAnchorNav';
import { VipTablesPillar } from '@/components/analytics/VipTablesPillar';
import { EventsPnlLedger } from '@/components/analytics/EventsPnlLedger';
import { GuestListAnalyticsSection } from '@/components/analytics/GuestListAnalyticsSection';
import { TicketAnalyticsOverview } from '@/components/analytics/TicketAnalyticsOverview';
import { TicketPillarInsights } from '@/components/analytics/TicketPillarInsights';
import { TicketAnalyticsLaunch } from '@/components/analytics/TicketAnalyticsLaunch';
import { TicketAnalyticsTypes } from '@/components/analytics/TicketAnalyticsTypes';
import { TicketAnalyticsPhases } from '@/components/analytics/TicketAnalyticsPhases';
import { RefundAnalyticsSection } from '@/components/analytics/RefundAnalyticsSection';
import { AcquisitionDashboard } from '@/components/analytics/AcquisitionDashboard';
import { BehaviorAnalytics } from '@/components/analytics/BehaviorAnalytics';
import { AudienceInsights } from '@/components/analytics/AudienceInsights';
import { EventAudienceDemographics } from '@/components/analytics/EventAudienceDemographics';
import { EventPostAnalysisView } from '@/components/owner/co-event/EventPostAnalysisView';

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
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, ...style }}
    >
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
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
    <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold tabular-nums" style={{ color: up ? POS : NEG }}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(delta).toFixed(1)}%
      {vs && <span className="font-normal ml-1" style={{ color: T3 }}>{vs}</span>}
    </span>
  );
}

// ─── Zone heading (IA section separator) ──────────────────────────────────────
function ZoneHeading({ icon, label, id }: { icon: React.ReactNode; label: string; id?: string }) {
  return (
    <div id={id} className="flex items-center gap-2 px-1" style={id ? { scrollMarginTop: 84 } : undefined}>
      <span style={{ color: T2 }}>{icon}</span>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: T2 }}>{label}</h3>
    </div>
  );
}

// ─── Small KPI tile (night / promoter / loyalty zones) ────────────────────────
function Tile({ label, val, sub, icon, tone }: { label: string; val: string; sub: string; icon: React.ReactNode; tone: string }) {
  return (
    <PCard>
      <div className="flex flex-col min-h-[104px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{label}</span>
          <span style={{ color: T3 }}>{icon}</span>
        </div>
        <div className="mt-2 text-[clamp(22px,2.6vw,30px)] font-[640] leading-none tabular-nums" style={{ color: tone, letterSpacing: '-0.025em' }}>{val}</div>
        <div className="mt-auto pt-2 text-[11.5px]" style={{ color: T3 }}>{sub}</div>
      </div>
    </PCard>
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
// Turn a sparse list of active hours into a continuous min→max hour range,
// inserting revenue:0 for the gaps so the chart reads as a real timeline.
function fillHourGaps(rows: { hour: string; revenue: number }[]): { hour: string; revenue: number }[] {
  const byHour = new Map<number, number>();
  rows.forEach(d => { const h = parseInt(d.hour); if (!Number.isNaN(h)) byHour.set(h, (byHour.get(h) || 0) + d.revenue); });
  if (byHour.size === 0) return rows;
  const hours = Array.from(byHour.keys());
  const min = Math.min(...hours), max = Math.max(...hours);
  const out: { hour: string; revenue: number }[] = [];
  for (let h = min; h <= max; h++) out.push({ hour: `${h}h`, revenue: byHour.get(h) || 0 });
  return out;
}

function RevenueBars({ data: raw }: { data: { hour: string; revenue: number }[] }) {
  if (!raw.length) return null;
  const data = fillHourGaps(raw);
  // Fixed wide viewBox (≈3.8:1) so the chart height stays sane regardless of bar
  // count — bars are distributed across W instead of W growing per bar (which made
  // the rendered height explode at width:100%).
  const W = 640, plotH = 150, labelH = 20, H = plotH + labelH;
  const slot = W / data.length;
  const bw = Math.min(28, slot * 0.6);
  const maxVal = Math.max(...data.map(d => d.revenue), 1) * 1.1;
  const peakIdx = data.reduce((m, d, i) => d.revenue > data[m].revenue ? i : m, 0);
  // Thin out hour labels so they never collide; aim for ~8 labels max.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: 'auto' }}>
        {[0.25, 0.5, 0.75].map((g, i) => (
          <line key={i} x1={0} x2={W} y1={plotH - plotH * g} y2={plotH - plotH * g} stroke={C_FAINT} strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const isEmpty = d.revenue <= 0;
          // Empty hours render as a faint baseline tick, not a rounded sliver.
          const bh = isEmpty ? 3 : Math.max(6, (d.revenue / maxVal) * plotH);
          const y = plotH - bh;
          // Clamp the corner radius to the bar's own height so short bars don't
          // produce a malformed path (the little "U"/tab shapes at the baseline).
          const r = Math.min(4, bw / 2, bh / 2);
          const isPeak = i === peakIdx;
          const showLabel = i % labelEvery === 0;
          const x = i * slot + (slot - bw) / 2;
          return (
            <g key={i}>
              {/* Animate the rect's own height/y so the bar grows from the
                  baseline — robust across browsers (no transform-origin quirks). */}
              <motion.rect
                x={x} width={bw} rx={r}
                fill={isPeak ? RED : C_MID}
                initial={{ height: 0, y: plotH, opacity: 0 }}
                animate={{ height: bh, y, opacity: isEmpty ? 0.25 : (isPeak ? 0.92 : 0.82) }}
                transition={{ delay: i * 0.035, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
              {showLabel && (
                <text x={x + bw / 2} y={H - 4} fill={T3} fontSize={9} textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>{d.hour}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Conversion funnel ribbon ─────────────────────────────────────────────────
// Band edges use horizontal-handle cubics: both control points sit on the x
// midpoint, flat at each end. Catmull-Rom overshot on the uneven column spacing
// (edge anchors sit half a column apart, inner ones a full column), which drew
// phantom waves through stages that are actually flat — a funnel of 1 visitor
// then zeros rippled instead of collapsing cleanly.
function ribbonEdge(pts: [number, number][], move: boolean): string {
  let d = `${move ? 'M' : 'L'} ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    if (y1 === y2) { d += ` L ${x2} ${y2}`; continue; }
    const mx = (x1 + x2) / 2;
    d += ` C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  }
  return d;
}

// Every pill in the ribbon reads the same way: a whole percent, with one decimal
// only when a real but tiny share would otherwise round away to 0%.
function funnelPct(n: number, total: number): string {
  if (!total) return '0%';
  const v = (n / total) * 100;
  return v > 0 && v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

function FunnelRibbon({ stages }: { stages: { label: string; n: number; pct: string }[] }) {
  if (!stages.length) return null;
  const W = 900, H = 260, cy = H / 2;
  const colW = W / stages.length;
  const vmax = stages[0].n || 1;
  const maxBand = 200;
  // Floor applied after scaling: flooring before it gave each layer its own
  // minimum, stacking three visible stripes across an empty funnel.
  const HAIR = 2;
  const hAt = (i: number, scale: number) => Math.max(HAIR, (stages[i].n / vmax) * maxBand * scale);
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
    const d = `${ribbonEdge(top, true)} ${ribbonEdge(bot, false)} Z`;
    return <path key={li} d={d} fill={L.fill} opacity={L.op} />;
  });

  // Pills render as HTML on top of the ribbon: the SVG is stretched to fill the
  // card (preserveAspectRatio="none"), which squashed the percentages inside it.
  return (
    <div className="relative" style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 220 }}>
        {ribbons}
        {stages.map((_, i) => i === 0 ? null : (
          <line key={i} x1={i * colW} x2={i * colW} y1={18} y2={H - 18} stroke={BORDER} strokeWidth={1} />
        ))}
      </svg>
      <div className="absolute inset-0 flex items-center pointer-events-none select-none">
        {stages.map((s, i) => (
          <div key={i} className="flex-1 flex justify-center">
            <span
              className="px-3 py-[5px] rounded-full text-[13px] font-bold leading-none tabular-nums"
              style={{ background: 'rgba(255,255,255,0.94)', color: '#000' }}
            >
              {s.pct}
            </span>
          </div>
        ))}
      </div>
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
      <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={shades[i % shades.length]} strokeWidth={sw}
        strokeDasharray={`${Math.max(0, len)} ${circ - Math.max(0, len)}`} strokeDashoffset={-off}
        transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt" />
    );
  });
  // Center label shows the dominant category, not data[0] (which made an empty
  // first category read "0%" while real revenue sat in others).
  const hasData = data.some(d => d.val > 0);
  const top = data.reduce((m, d) => (d.val > m.val ? d : m), data[0] ?? { name: '', val: 0, pct: 0 });
  // Both lines are baseline-centred on their own y, and the pair is offset so the
  // block sits on the ring's centre. Without a caption the value takes the centre
  // outright — it used to keep the two-line offset and float above the middle.
  const label = hasData ? top.name.split(' ')[0] : '';
  const valueY = label ? c - 6 : c;
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke={C_FAINT} strokeWidth={sw} />
      {segs}
      <text x={c} y={valueY} fill={T1} fontSize={21} fontWeight={650} textAnchor="middle" dominantBaseline="central" style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{hasData ? top.pct : 0}%</text>
      {label && (
        <text x={c} y={c + 13} fill={T3} fontSize={10} textAnchor="middle" dominantBaseline="central" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</text>
      )}
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
    <div className="inline-flex gap-0.5 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150"
          style={value === o.key
            ? { color: T1, background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000' }
            : { color: T3 }}>
          {o.icon && <span style={{ opacity: 0.7 }}>{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function rangeStart(dateRange: DateRange): Date | null {
  if (dateRange === '24h') return subHours(new Date(), 24);
  if (dateRange === '48h') return subHours(new Date(), 48);
  if (dateRange === '72h') return subHours(new Date(), 72);
  if (dateRange === '7days') return startOfDay(subDays(new Date(), 7));
  if (dateRange === '30days') return startOfDay(subDays(new Date(), 30));
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────
// Same analytical depth as the club page (OwnerAnalytics), organizer-scoped:
// overview KPIs with real period deltas, per-night ledger, the night (door),
// guest list, promoter ROI, loyalty (RFM), audience, web traffic, then the
// Tickets / VIP tables / Refunds pillars. Organizers don't sell drinks, so the
// drinks pillar and bar-side metrics are the only things missing on purpose.
export default function OrgAppAnalytics() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const tt = (fr2: string, en: string, es2?: string) => translate(language, fr2, en, es2);
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const organizerId = user?.id ?? null;

  const [searchParams] = useSearchParams();
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const [mode, setMode] = useState<AnalyticsMode>('global');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Deep-link: /organizer-app/analytics?event=<id> jumps straight to that night's
  // verdict (e.g. from the event page's "Analyse" tile).
  useEffect(() => {
    const ev = searchParams.get('event');
    if (ev) { setMode('event'); setSelectedEventId(ev); }
  }, [searchParams]);
  const [exporting, setExporting] = useState(false);
  const [liveVisitors, setLiveVisitors] = useState(0);
  const [funnel, setFunnel] = useState({ visitors: 0, addedToCart: 0, proceededToCheckout: 0, completed: 0, conversionRate: 0 });
  const [primaryView, setPrimaryView] = useState<'overview' | 'tickets' | 'tables' | 'refunds'>('overview');
  // In event mode the chaptered verdict leads; the raw zone stack is opt-in detail.
  const [showAdvancedZones, setShowAdvancedZones] = useState(false);
  const [ticketSubTab, setTicketSubTab] = useState<'overview' | 'launch' | 'types' | 'phases'>('overview');

  // Web-traffic zones share the page's main period selector (no separate filter).
  const webWindow = dateRangeToWindow(dateRange);

  const { eventIds, venueIds } = useOrganizerEventIds(organizerId);
  const {
    ticketAnalytics, tableAnalytics, refundAnalytics,
    currentTotals, previousTotals, uniqueGuestsTotal, loading,
  } = useAnalyticsData({
    organizerUserId: organizerId,
    scope: 'organizer',
    dateRange,
    mode,
    selectedEventId,
  });
  const { nightAnalytics } = useNightAnalytics({ organizerUserId: organizerId, dateRange, mode, selectedEventId });
  const { promoterAnalytics } = usePromoterAnalytics({ organizerUserId: organizerId, dateRange, mode, selectedEventId });
  const { customerAnalytics } = useCustomerAnalytics({ organizerUserId: organizerId });

  // Net gain (organizer's actual share after Stripe + Yuno fees AND partnership split)
  const [netGain, setNetGain] = useState<number | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const since = rangeStart(dateRange) ?? new Date('2000-01-01');
        let eventQuery = supabase
          .from('events')
          .select('id, revenue_split_rules, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
          .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`);
        if (mode === 'event' && selectedEventId) eventQuery = eventQuery.eq('id', selectedEventId);
        const { data: scopedEvents } = await eventQuery;
        const ids = (scopedEvents ?? []).map(e => e.id);
        if (cancelled || ids.length === 0) { if (!cancelled) setNetGain(0); return; }

        const { data: distros } = await supabase
          .from('revenue_distributions')
          .select('event_id, primary_recipient_organizer_id, secondary_recipient_organizer_id, primary_amount_cents, secondary_amount_cents, created_at')
          .in('event_id', ids)
          .gte('created_at', since.toISOString());

        const distroByEvent = new Map<string, number>();
        let distroTotal = 0;
        (distros ?? []).forEach((d: any) => {
          let amt = 0;
          if (d.primary_recipient_organizer_id === user.id) amt += Number(d.primary_amount_cents || 0);
          if (d.secondary_recipient_organizer_id === user.id) amt += Number(d.secondary_amount_cents || 0);
          if (amt > 0) { distroByEvent.set(d.event_id, (distroByEvent.get(d.event_id) ?? 0) + amt); distroTotal += amt; }
        });

        const eventsWithoutDistro = (scopedEvents ?? []).filter(e => !distroByEvent.has(e.id));
        let fallbackTotal = 0;
        if (eventsWithoutDistro.length > 0) {
          const idsNoDistro = eventsWithoutDistro.map(e => e.id);
          const { data: tix } = await supabase
            .from('tickets')
            .select('total_price, event_id, created_at')
            .in('event_id', idsNoDistro)
            .eq('status', 'paid')
            .gte('created_at', since.toISOString());
          const splitMap = new Map<string, number>();
          for (const e of eventsWithoutDistro) {
            const rules: any = e.revenue_split_rules || null;
            let pct = 100;
            if (rules?.tickets?.organizer_pct != null) pct = Number(rules.tickets.organizer_pct);
            else {
              const hostVenueId = e.venue_id || e.partner_venue_id;
              const orgId = e.organizer_user_id || e.partner_organizer_id;
              if (hostVenueId && orgId) {
                const { data: partnership } = await supabase
                  .from('venue_organizer_partnerships')
                  .select('default_split_rules')
                  .eq('venue_id', hostVenueId).eq('organizer_user_id', orgId).eq('status', 'active').maybeSingle();
                const dRules: any = partnership?.default_split_rules;
                if (dRules?.tickets?.organizer_pct != null) pct = Number(dRules.tickets.organizer_pct);
              }
            }
            splitMap.set(e.id, pct);
          }
          (tix ?? []).forEach((tk: any) => {
            const total = Number(tk.total_price || 0);
            const yunoFee = Math.max(0.99, total * 0.04);
            const stripeFee = total * 0.015 + 0.25;
            const netPerTicket = Math.max(0, total - yunoFee - stripeFee);
            const pct = splitMap.get(tk.event_id) ?? 100;
            fallbackTotal += netPerTicket * (pct / 100);
          });
        }
        if (!cancelled) setNetGain((distroTotal / 100) + fallbackTotal);
      } catch {
        if (!cancelled) setNetGain(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user, dateRange, mode, selectedEventId]);

  // Visitor funnel (organizer scope) + live count
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const orFilter = buildOrganizerScopeOr(user.id, eventIds, venueIds);

    const fetchFunnel = async () => {
      const since = rangeStart(dateRange);
      let q: any = supabase.from('visitor_sessions').select('id, added_to_cart, proceeded_to_checkout, completed_order');
      if (mode === 'event' && selectedEventId) q = q.eq('event_id', selectedEventId);
      else q = q.or(orFilter);
      if (since) q = q.gte('visited_at', since.toISOString());
      const { data } = await q.limit(10000);
      if (cancelled) return;
      const visitors = data?.length ?? 0;
      const addedToCart = (data ?? []).filter((r: any) => r.added_to_cart).length;
      const proceededToCheckout = (data ?? []).filter((r: any) => r.proceeded_to_checkout).length;
      const completed = (data ?? []).filter((r: any) => r.completed_order).length;
      setFunnel({ visitors, addedToCart, proceededToCheckout, completed, conversionRate: visitors > 0 ? (completed / visitors) * 100 : 0 });
    };

    const fetchLive = async () => {
      const fiveMinutesAgo = subMinutes(new Date(), 5);
      let q: any = supabase.from('visitor_sessions').select('id').or(orFilter).gte('visited_at', fiveMinutesAgo.toISOString());
      if (mode === 'event' && selectedEventId) q = supabase.from('visitor_sessions').select('id').eq('event_id', selectedEventId).gte('visited_at', fiveMinutesAgo.toISOString());
      const { data } = await q;
      if (!cancelled) setLiveVisitors(data?.length ?? 0);
    };

    fetchFunnel();
    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.id, eventIds.join(','), venueIds.join(','), dateRange, mode, selectedEventId]);

  const handleExportData = async () => {
    if (!ticketAnalytics || !tableAnalytics) return;
    setExporting(true);
    try {
      const rows: string[] = [];
      rows.push('Yuno Organizer Analytics');
      rows.push(`Date: ${format(new Date(), 'PPP', { locale: dateLocale })}`);
      rows.push(`Period: ${dateRange}`);
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
      rows.push('');
      rows.push(`Net gain (after split),${netGain != null ? netGain.toFixed(2) : 'N/A'}€`);
      if (nightAnalytics && (nightAnalytics.ticketsSold > 0 || nightAnalytics.guestlistSize > 0 || nightAnalytics.tablesBooked > 0)) {
        rows.push('');
        rows.push('=== THE NIGHT ===');
        rows.push(`Attendance,${nightAnalytics.attendance}`);
        rows.push(`Tickets scanned,${nightAnalytics.ticketsScanned}/${nightAnalytics.ticketsSold}`);
        rows.push(`Ticket no-show rate,${nightAnalytics.ticketNoShowRate.toFixed(1)}%`);
        rows.push(`Tables arrived,${nightAnalytics.tablesArrived}/${nightAnalytics.tablesBooked}`);
        rows.push(`Guest list arrived,${nightAnalytics.guestlistArrived}/${nightAnalytics.guestlistSize}`);
      }
      if (promoterAnalytics && promoterAnalytics.promoters.length > 0) {
        rows.push('');
        rows.push('=== PROMOTERS ===');
        rows.push(`Attributed Revenue,${promoterAnalytics.totalAttributed.toFixed(2)}€`);
        rows.push(`Commissions,${promoterAnalytics.totalCommission.toFixed(2)}€`);
        rows.push('Promoter,Revenue,Commission,Conversions,Clicks');
        promoterAnalytics.promoters.forEach(p => rows.push(`${p.name},${p.revenue.toFixed(2)}€,${p.commission.toFixed(2)}€,${p.conversions},${p.clicks}`));
      }
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
      a.download = `yuno-org-analytics-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (loading || !ticketAnalytics || !tableAnalytics || !organizerId) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin" style={{ color: T3 }} /></div>;
  }

  // ── Aggregates (tickets + tables — organizers don't sell drinks directly) ──
  // All on the same organizer-revenue base (Yuno fees excluded), like the club page.
  const totalRevenue = ticketAnalytics.totalRevenue + tableAnalytics.totalRevenue;
  const totalOrders = ticketAnalytics.totalTickets + tableAnalytics.totalReservations;
  const totalStripeFee = ticketAnalytics.stripeFee + tableAnalytics.stripeFee;
  // Refunds line = fully-refunded bookings + partial refunds on still-paid rows.
  const partialRefunded = ticketAnalytics.partialRefunded + tableAnalytics.partialRefunded;
  const totalRefunded = (refundAnalytics?.totalRefunded || 0) + partialRefunded;
  // A guest who bought a ticket AND a table counts once.
  const totalGuests = uniqueGuestsTotal;

  // Unified day series across both pillars for the KPI sparklines.
  const dayKeys = Array.from(new Set([
    ...ticketAnalytics.revenueByDay.map(d => d.date),
    ...tableAnalytics.revenueByDay.map(d => d.date),
  ])).sort();
  const revAt = (date: string) =>
    (ticketAnalytics.revenueByDay.find(d => d.date === date)?.revenue || 0) +
    (tableAnalytics.revenueByDay.find(d => d.date === date)?.revenue || 0);
  const ordAt = (date: string) =>
    (ticketAnalytics.revenueByDay.find(d => d.date === date)?.tickets || 0) +
    (tableAnalytics.revenueByDay.find(d => d.date === date)?.reservations || 0);
  const grossSparkPts = dayKeys.map(revAt);
  const ordersSparkPts = dayKeys.map(ordAt);
  const aovSparkPts = grossSparkPts.map((r, i) => ordersSparkPts[i] ? r / ordersSparkPts[i] : 0);

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

  // Merge hourly bars from tickets + tables (RevenueBars fills the hour gaps).
  const hourMap = new Map<string, number>();
  ticketAnalytics.hourlyData.forEach(h => hourMap.set(h.hour, (hourMap.get(h.hour) || 0) + h.revenue));
  tableAnalytics.hourlyData.forEach(h => hourMap.set(h.hour, (hourMap.get(h.hour) || 0) + h.revenue));
  const hourlyData = [...hourMap.entries()]
    .map(([hour, revenue]) => ({ hour, revenue }))
    .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  // Funnel stages (organizer visitor funnel)
  const funnelSteps = [
    { label: t('owner.visitors'), n: funnel.visitors, pct: funnelPct(funnel.visitors, funnel.visitors) },
    { label: t('owner.addedToCart'), n: funnel.addedToCart, pct: funnelPct(funnel.addedToCart, funnel.visitors) },
    { label: t('owner.proceededToCheckout'), n: funnel.proceededToCheckout, pct: funnelPct(funnel.proceededToCheckout, funnel.visitors) },
    { label: tt('Conversions', 'Conversions', 'Conversiones'), n: funnel.completed, pct: funnelPct(funnel.completed, funnel.visitors) },
  ];

  // Donut: revenue mix by category (tickets + tables)
  const categories = [
    { name: t('owner.an.tickets'), val: ticketAnalytics.totalRevenue, pct: totalRevenue > 0 ? Math.round(ticketAnalytics.totalRevenue / totalRevenue * 100) : 0 },
    { name: t('owner.an.vipTables'), val: tableAnalytics.totalRevenue, pct: totalRevenue > 0 ? Math.round(tableAnalytics.totalRevenue / totalRevenue * 100) : 0 },
  ];

  // Top events by revenue
  const topEvents = [...ticketAnalytics.ticketsByEvent].sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  // Finance strip — Gross − Stripe − Refunds, then the organizer's net gain after partnership split.
  const financeData = [
    { label: t('owner.an.grossVolume'), val: `€${totalRevenue.toFixed(0)}`, desc: `${totalOrders} ${t('owner.an.transactions')}` },
    { label: 'Stripe', val: `−€${totalStripeFee.toFixed(0)}`, desc: '1.5% + €0.25 / txn' },
    { label: t('owner.an.refunds'), val: `−€${totalRefunded.toFixed(0)}`, desc: `${refundAnalytics?.totalRefundCount || 0} ${t('owner.an.refundsLower')}` },
    { label: tt('Gain net', 'Net gain', 'Ganancia neta'), val: netGain == null ? '—' : `€${netGain.toFixed(0)}`, desc: tt('Après frais & part partenaire', 'After fees & partner split', 'Tras comisiones y parte del socio'), accent: true },
  ];

  const periodOptions = [
    { key: '24h' as DateRange, label: '24h' },
    { key: '48h' as DateRange, label: '48h' },
    { key: '72h' as DateRange, label: '72h' },
    { key: '7days' as DateRange, label: `7 ${t('owner.days')}` },
    { key: '30days' as DateRange, label: `30 ${t('owner.days')}` },
    { key: 'alltime' as DateRange, label: t('owner.allTime') },
  ];

  // Primary pillar navigation — Tickets / VIP Tables promoted to first-class
  // destinations (each tab shows its own revenue). Organizers don't sell drinks.
  const pillarTabs = [
    { id: 'overview' as const, label: t('owner.an.zoneOverview'), icon: Layers, value: fmt(totalRevenue) },
    { id: 'tickets' as const, label: t('owner.ticketsTab'), icon: Ticket, value: fmt(ticketAnalytics.totalRevenue) },
    { id: 'tables' as const, label: t('owner.tablesVIP'), icon: Sofa, value: fmt(tableAnalytics.totalRevenue) },
    { id: 'refunds' as const, label: t('owner.refundsTab'), icon: RotateCcw, value: (refundAnalytics && refundAnalytics.totalRefunded > 0) ? `−${fmt(refundAnalytics.totalRefunded)}` : '—' },
  ];

  // Event mode with no night chosen yet → show the calendar-style card picker
  // instead of the full zone stack.
  const showEventPicker = mode === 'event' && !selectedEventId;

  // Global-mode spine: only the zones that actually render get an anchor pill.
  const hasNight = !!nightAnalytics && (nightAnalytics.ticketsSold > 0 || nightAnalytics.tablesBooked > 0 || nightAnalytics.guestlistSize > 0);
  const hasPromoter = !!promoterAnalytics && promoterAnalytics.promoters.length > 0;
  const hasLoyalty = !!customerAnalytics && customerAnalytics.totalCustomers > 0;
  const navSections: AnchorSection[] = [
    { id: 'an-overview', label: t('owner.an.zoneOverview'), icon: Layers },
    ...(hasNight ? [{ id: 'an-night', label: t('owner.an.theNight'), icon: DoorOpen }] : []),
    { id: 'an-guestlist', label: t('owner.an.guestList'), icon: ClipboardList },
    ...(hasPromoter ? [{ id: 'an-promoter', label: t('owner.an.promoterRoi'), icon: Megaphone }] : []),
    ...(hasLoyalty ? [{ id: 'an-loyalty', label: t('owner.an.loyalty'), icon: HeartHandshake }] : []),
    { id: 'an-audience', label: t('owner.an.audience'), icon: Users },
    { id: 'an-web', label: t('owner.an.zoneTraffic'), icon: Globe },
  ];

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">

        {/* Title + live pill */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <div>
            <h1 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{tt('Analytique', 'Analytics', 'Analítica')}</h1>
            <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{tt('Performances détaillées de toutes vos soirées.', 'Detailed performance across all your events.', 'Rendimiento detallado de todas tus noches.')}</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
            <div className="relative">
              <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
              <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75" style={{ background: POS }} />
            </div>
            <span className="text-sm font-semibold tabular-nums" style={{ color: POS }}>
              {liveVisitors} <span className="font-normal opacity-70 hidden xs:inline">{t('owner.online')}</span>
            </span>
          </div>
        </div>

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
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
            {mode === 'global' && (
              <div className="flex gap-1 flex-wrap p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
                {periodOptions.map(opt => (
                  <button key={opt.key} onClick={() => setDateRange(opt.key)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                    style={dateRange === opt.key ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` } : { color: T3 }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <button onClick={handleExportData} disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}>
              <Download className="w-4 h-4" /><span className="hidden sm:inline">{exporting ? t('owner.exporting') : t('owner.exportData')}</span><span className="sm:hidden">CSV</span>
            </button>
          </div>
        </motion.div>

        {showEventPicker ? (
          <EventAnalyticsPicker
            organizerUserId={organizerId}
            onSelect={(id) => {
              setSelectedEventId(id);
              if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ) : (
        <>

        {/* Back to the night picker */}
        {mode === 'event' && selectedEventId && (
          <button
            type="button"
            onClick={() => setSelectedEventId(null)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium cursor-pointer transition-colors hover:text-white"
            style={{ color: T3 }}
          >
            <ArrowLeft className="w-4 h-4" /> {t('owner.an.backToEvents')}
          </button>
        )}

        {/* ── Verdict first — "did this night work?" (event mode only) ───── */}
        {mode === 'event' && selectedEventId && (
          <EventPostAnalysisView key={selectedEventId} eventId={selectedEventId} venueId={null} organizerUserId={organizerId} />
        )}

        {/* ── Per-night audience: age & gender of who actually came ──────── */}
        {mode === 'event' && selectedEventId && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="space-y-3">
            <ZoneHeading icon={<Users className="w-4 h-4" />} label={t('owner.an.audience')} />
            <EventAudienceDemographics scope={{ kind: 'organizer', id: organizerId }} eventId={selectedEventId} />
          </motion.div>
        )}

        {/* In event mode the raw zone stack is collapsed behind an opt-in toggle. */}
        {mode === 'event' && selectedEventId && (
          <button
            type="button"
            onClick={() => setShowAdvancedZones((v) => !v)}
            className="w-full flex items-center justify-between rounded-xl px-4 h-12 cursor-pointer transition-colors hover:bg-white/[0.03]"
            style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}
          >
            <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: T1 }}>
              <Layers className="w-4 h-4" style={{ color: T3 }} />
              {t('owner.an.advancedDetail')}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedZones ? 'rotate-180' : ''}`} style={{ color: T3 }} />
          </button>
        )}

        {(mode === 'global' || showAdvancedZones) && (
        <>

        {/* ── Primary pillar navigation — tickets / VIP tables promoted ── */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {pillarTabs.map(pt => {
            const Icon = pt.icon;
            const active = primaryView === pt.id;
            return (
              <button
                key={pt.id}
                onClick={() => { setPrimaryView(pt.id); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="text-left rounded-2xl px-4 py-3 cursor-pointer transition-all duration-150"
                style={active
                  ? { background: 'linear-gradient(180deg,rgba(232,25,44,.16),rgba(232,25,44,.05)),#0a0a0c', border: `1px solid rgba(232,25,44,0.5)`, boxShadow: `0 0 22px -8px ${RED}` }
                  : { background: CARD_BG, border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4 flex-none" style={{ color: active ? RED : T3 }} />
                  <span className="text-[12.5px] font-[560] truncate" style={{ color: active ? T1 : T2 }}>{pt.label}</span>
                </div>
                <div className="text-[19px] font-[680] tabular-nums leading-none" style={{ color: active ? T1 : T2, letterSpacing: '-0.02em' }}>{pt.value}</div>
              </button>
            );
          })}
        </motion.div>

        {primaryView === 'overview' && (
        <>

        {/* Anchor-nav spine — global mode only (event mode has its own in the verdict view) */}
        {mode === 'global' && <AnalyticsAnchorNav sections={navSections} />}

        {/* ── Zone 1 · Overview ─────────────────────────────────────────── */}
        <ZoneHeading id="an-overview" icon={<Layers className="w-4 h-4" />} label={t('owner.an.zoneOverview')} />

        {/* ── KPI row ───────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi, i) => (
            <PCard key={i}>
              <div className="flex flex-col min-h-[120px]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{kpi.label}</span>
                  <span style={{ color: T3 }}>{kpi.icon}</span>
                </div>
                <div className="mt-3 text-[clamp(26px,3vw,36px)] font-[640] leading-none tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>{kpi.val}</div>
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
                <div className="text-[clamp(22px,2.5vw,30px)] font-[640] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.025em' }}>{fmt(totalRevenue)}</div>
                <div className="text-xs mt-1" style={{ color: T3 }}>{t('owner.an.totalPeriod')}</div>
              </div>
            }
          >
            {hourlyData.length > 0
              ? <RevenueBars data={hourlyData} />
              : <div className="h-40 flex items-center justify-center text-sm" style={{ color: T3 }}>{t('owner.an.noDataPeriod')}</div>}
          </PCard>
        </motion.div>

        {/* ── Bilan par soirée (cross-pillar P&L per night) ──────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <EventsPnlLedger organizerUserId={organizerId} from={webWindow.from} to={webWindow.to} />
        </motion.div>

        {/* ── Funnel + Donut ────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="grid lg:grid-cols-[3fr,2fr] gap-3">
          <PCard
            icon={<Percent className="w-4 h-4" />}
            title={t('owner.conversionFunnel')}
            sub={tt('Visiteurs → billets', 'Visitors → tickets', 'Visitantes → entradas')}
            right={
              <div className="text-right px-4 py-2 rounded-xl" style={{ background: 'rgba(232,25,44,0.08)', border: `1px solid rgba(232,25,44,0.2)` }}>
                <div className="text-[10px] uppercase tracking-[0.07em] mb-1" style={{ color: T3 }}>{t('owner.globalRate')}</div>
                <div className="text-2xl font-[660] tabular-nums" style={{ color: RED, letterSpacing: '-0.03em' }}>{funnel.visitors > 0 ? `${funnel.conversionRate.toFixed(1)}%` : '—'}</div>
              </div>
            }
          >
            {funnel.visitors > 0 ? (
              <>
                <FunnelRibbon stages={funnelSteps} />
                <div className="grid mt-3" style={{ gridTemplateColumns: `repeat(${funnelSteps.length}, 1fr)` }}>
                  {funnelSteps.map((s, i) => (
                    <div key={i} className="text-center px-1" style={{ borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                      <div className="text-base font-[640] tabular-nums leading-tight" style={{ color: T1, letterSpacing: '-0.02em' }}>{s.n.toLocaleString()}</div>
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

          <PCard icon={<Layers className="w-4 h-4" />} title={t('owner.an.revenueMix')} sub={t('owner.an.shareByCategory')}>
            <div className="flex items-center gap-4 flex-wrap">
              <DonutChart data={categories} />
              <div className="flex flex-col gap-3 flex-1 min-w-[140px]">
                {categories.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-none" style={{ background: i === 0 ? RED : C_HI }} />
                    <span className="text-sm flex-1" style={{ color: T2 }}>{c.name}</span>
                    <span className="text-[13.5px] font-[620] tabular-nums" style={{ color: T1 }}>{fmt(c.val)}</span>
                    <span className="text-[11.5px] w-9 text-right tabular-nums" style={{ color: T3 }}>{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </PCard>
        </motion.div>

        {/* ── Top events ────────────────────────────────────────────────── */}
        {topEvents.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <PCard icon={<Flame className="w-4 h-4" />} title={tt('Top soirées', 'Top events', 'Mejores noches')} sub={t('owner.an.byRevenuePeriod')}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {topEvents.map((p, i) => {
                  const maxRev = topEvents[0]?.revenue || 1;
                  const barPct = (p.revenue / maxRev) * 100;
                  return (
                    <div key={i} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '20px 1fr auto' }}>
                      <span className="text-[12.5px] tabular-nums" style={{ color: T3 }}>{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-[560] truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{p.eventTitle}</div>
                        <div className="text-[11.5px] mt-1" style={{ color: T3 }}>{p.quantity} {tt('billets', 'tickets', 'entradas')}</div>
                        <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded transition-all" style={{ width: `${barPct}%`, background: i === 0 ? `linear-gradient(90deg,${RED}88,${RED})` : `linear-gradient(90deg,${C_MID},${C_HI})` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-[620] tabular-nums" style={{ color: T1, letterSpacing: '-0.01em' }}>{fmt(p.revenue)}</div>
                        <div className="text-[11px] mt-1" style={{ color: T3 }}>{t('owner.an.revenue')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </PCard>
          </motion.div>
        )}

        {/* ── The Night: attendance / no-show / arrivals ─────────────────── */}
        {nightAnalytics && hasNight && (() => {
          const revenuePerHead = nightAnalytics.attendance > 0 ? totalRevenue / nightAnalytics.attendance : 0;
          const nightTiles = [
            { label: t('owner.an.attendance'), val: nightAnalytics.attendance.toLocaleString(), sub: t('owner.an.headsThroughDoor'), icon: <Footprints className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.ticketNoShow'), val: `${nightAnalytics.ticketNoShowRate.toFixed(0)}%`, sub: `${nightAnalytics.ticketsScanned}/${nightAnalytics.ticketsSold} ${t('owner.an.scanned')}`, icon: <UserCheck className="w-4 h-4" />, tone: nightAnalytics.ticketNoShowRate > 25 ? NEG : POS },
            { label: t('owner.an.revenuePerHead'), val: fmt(revenuePerHead), sub: tt('Revenu divisé par les entrées', 'Revenue divided by entries', 'Ingresos divididos por entradas'), icon: <CreditCard className="w-4 h-4" />, tone: T1 },
            { label: t('owner.an.guestlistFill'), val: nightAnalytics.guestlistSize > 0 ? `${nightAnalytics.guestlistFillRate.toFixed(0)}%` : '—', sub: nightAnalytics.guestlistSize > 0 ? `${nightAnalytics.guestlistArrived}/${nightAnalytics.guestlistSize}` : t('owner.an.noGuestlist'), icon: <DoorOpen className="w-4 h-4" />, tone: T1 },
          ];
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="space-y-3">
              <ZoneHeading id="an-night" icon={<DoorOpen className="w-4 h-4" />} label={t('owner.an.theNight')} />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {nightTiles.map((tile, i) => <Tile key={i} {...tile} />)}
              </div>
              {nightAnalytics.tablesBooked > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Tile
                    label={tt('Tables arrivées', 'Tables arrived', 'Mesas llegadas')}
                    val={`${nightAnalytics.tablesArrived}/${nightAnalytics.tablesBooked}`}
                    sub={`${nightAnalytics.tableNoShowRate.toFixed(0)}% ${tt('no-show table', 'table no-show', 'no-show de mesa')}`}
                    icon={<Sofa className="w-4 h-4" />}
                    tone={nightAnalytics.tableNoShowRate > 25 ? NEG : T1}
                  />
                </div>
              )}
              {nightAnalytics.arrivalsByHour.length > 0 && (
                <PCard icon={<Clock className="w-4 h-4" />} title={t('owner.an.arrivalsByHour')} sub={t('owner.an.realDoorPeak')}>
                  <RevenueBars data={nightAnalytics.arrivalsByHour.map(a => ({ hour: a.hour, revenue: a.arrivals }))} />
                </PCard>
              )}
            </motion.div>
          );
        })()}

        {/* ── Guest list : volume, no-show, peak time, valeur réelle ─────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.23 }} className="space-y-3">
          <ZoneHeading id="an-guestlist" icon={<ClipboardList className="w-4 h-4" />} label={t('owner.an.guestList')} />
          <GuestListAnalyticsSection
            organizerUserId={organizerId}
            eventId={mode === 'event' ? selectedEventId : null}
            from={webWindow.from}
            to={webWindow.to}
          />
        </motion.div>

        {/* ── Promoter ROI ───────────────────────────────────────────────── */}
        {promoterAnalytics && hasPromoter && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
            <ZoneHeading id="an-promoter" icon={<Megaphone className="w-4 h-4" />} label={t('owner.an.promoterRoi')} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: t('owner.an.attributedRevenue'), val: fmt(promoterAnalytics.totalAttributed), sub: `${promoterAnalytics.totalConversions} ${t('owner.an.conversions')}`, icon: <TrendingUp className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.commissions'), val: `−${fmt(promoterAnalytics.totalCommission)}`, sub: t('owner.an.owedToPromoters'), icon: <CreditCard className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.clickToSale'), val: `${promoterAnalytics.convRate.toFixed(0)}%`, sub: `${promoterAnalytics.totalClicks} ${t('owner.an.clicks')}`, icon: <MousePointerClick className="w-4 h-4" />, tone: T1 },
                { label: t('owner.an.promoterRoiShort'), val: promoterAnalytics.totalCommission > 0 ? `${promoterAnalytics.roi.toFixed(1)}x` : '—', sub: t('owner.an.revenuePerEuro'), icon: <Target className="w-4 h-4" />, tone: promoterAnalytics.roi >= 1 ? POS : T1 },
              ].map((tile, i) => <Tile key={i} {...tile} />)}
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
        {customerAnalytics && hasLoyalty && (() => {
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
              <ZoneHeading id="an-loyalty" icon={<HeartHandshake className="w-4 h-4" />} label={t('owner.an.loyalty')} />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {tiles.map((tile, i) => <Tile key={i} {...tile} />)}
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

        {/* ── Zone · Audience (age & gender + follower insights) ─────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
          <ZoneHeading id="an-audience" icon={<Users className="w-4 h-4" />} label={t('owner.an.audience')} />
          {mode === 'global' && (
            <EventAudienceDemographics scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
          )}
          <AudienceInsights scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
        </motion.div>

        {/* ── Zone · Web traffic ────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="space-y-3">
          <ZoneHeading id="an-web" icon={<Globe className="w-4 h-4" />} label={t('owner.an.zoneTraffic')} />
          <AcquisitionDashboard scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
        </motion.div>

        {/* ── Zone · Web engagement ─────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="space-y-3">
          <ZoneHeading icon={<Activity className="w-4 h-4" />} label={t('owner.an.zoneEngagement')} />
          <BehaviorAnalytics scope={{ kind: 'organizer', id: organizerId }} from={webWindow.from} to={webWindow.to} />
        </motion.div>

        {/* ── Finance strip — cross-pillar settlement (Overview) ────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
          <PCard icon={<CreditCard className="w-4 h-4" />} title={t('owner.an.settlement')} sub={t('owner.an.payoutsViaStripe')}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {financeData.map((f, i) => (
                <div key={i} className={i > 0 ? 'sm:border-l pl-0 sm:pl-4' : ''} style={{ borderColor: BORDER }}>
                  <div className="text-[11px] uppercase tracking-[0.07em]" style={{ color: f.accent ? RED : T3 }}>{f.label}</div>
                  <div className="text-2xl font-[640] tabular-nums mt-2" style={{ color: f.accent ? RED : f.val.startsWith('−') ? T2 : T1, letterSpacing: '-0.02em' }}>{f.val}</div>
                  <div className="text-[11.5px] mt-1.5" style={{ color: T3 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </PCard>
        </motion.div>

        </>
        )}

        {/* ═══ Billetterie pillar ═══════════════════════════════════════════ */}
        {primaryView === 'tickets' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <TicketPillarInsights data={ticketAnalytics} />
            <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
              {(['overview', 'launch', 'types', 'phases'] as const).map(tab => (
                <button key={tab} onClick={() => setTicketSubTab(tab)}
                  className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                  style={ticketSubTab === tab ? { color: '#fff', background: RED } : { color: T3 }}>
                  {t(`analytics.tab.${tab}`)}
                </button>
              ))}
            </div>
            {ticketSubTab === 'overview' && <TicketAnalyticsOverview data={ticketAnalytics} />}
            {ticketSubTab === 'launch' && <TicketAnalyticsLaunch data={ticketAnalytics} />}
            {ticketSubTab === 'types' && <TicketAnalyticsTypes data={ticketAnalytics} />}
            {ticketSubTab === 'phases' && <TicketAnalyticsPhases data={ticketAnalytics} />}
          </motion.div>
        )}

        {/* ═══ Tables VIP pillar — same depth as the club (reservations, party
             size, lead time, rotation, consumption). No host leaderboard: an
             organizer has no VIP hosts. ═══════════════════════════════════ */}
        {primaryView === 'tables' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <VipTablesPillar
              organizerUserId={organizerId}
              eventId={mode === 'event' ? selectedEventId : null}
              from={webWindow.from}
              to={webWindow.to}
              tableAnalytics={tableAnalytics}
              hasVipTables
            />
          </motion.div>
        )}

        {/* ═══ Remboursements pillar ════════════════════════════════════════ */}
        {primaryView === 'refunds' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {refundAnalytics && refundAnalytics.totalRefundCount > 0
              ? <RefundAnalyticsSection data={refundAnalytics} />
              : <div className="flex flex-col items-center justify-center py-16" style={{ color: T3 }}>
                  <RotateCcw className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">{t('refund.noItems')}</p>
                </div>}
          </motion.div>
        )}

        </>
        )}

        </>
        )}

      </div>
    </div>
  );
}
