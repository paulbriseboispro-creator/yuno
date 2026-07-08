import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, UserPlus, Trophy, Heart, Sparkles, AlertTriangle, Moon, UserX,
  Search, ChevronLeft, ChevronRight, Download, Ticket, Wine, Crown, Layers,
  ArrowUpRight, ArrowDownRight, MapPin, CalendarDays, Building2, Copy, Check,
  ExternalLink, Ban, Bell, Mail, Flame, Repeat, type LucideIcon,
} from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Segment / tier / category metadata ──────────────────────────────────────
type SegmentKey = 'champions' | 'loyal' | 'promising' | 'new' | 'at_risk' | 'dormant' | 'lost';
const SEGMENTS: { key: SegmentKey; accent: string; icon: LucideIcon }[] = [
  { key: 'champions', accent: '#FCD34D', icon: Trophy },
  { key: 'loyal',     accent: '#60A5FA', icon: Heart },
  { key: 'promising', accent: '#A78BFA', icon: Sparkles },
  { key: 'new',       accent: POS,       icon: UserPlus },
  { key: 'at_risk',   accent: '#FB923C', icon: AlertTriangle },
  { key: 'dormant',   accent: T2,        icon: Moon },
  { key: 'lost',      accent: '#EF4444', icon: UserX },
];
const SEG_BY_KEY = Object.fromEntries(SEGMENTS.map(s => [s.key, s])) as Record<SegmentKey, typeof SEGMENTS[number]>;

const TIER_COLORS: Record<string, string> = { bronze: '#C08A5A', silver: 'rgba(255,255,255,0.6)', gold: '#FCD34D', platinum: '#818CF8' };
const TIER_ORDER = ['platinum', 'gold', 'silver', 'bronze'];
const CAT_META: Record<string, { color: string; icon: LucideIcon }> = {
  tickets: { color: '#818CF8', icon: Ticket },
  drinks:  { color: RED,       icon: Wine },
  tables:  { color: '#F59E0B', icon: Crown },
  mixed:   { color: 'rgba(255,255,255,0.5)', icon: Layers },
};

// ─── Server payload types ─────────────────────────────────────────────────────
interface Overview {
  totals: {
    customers: number; with_account: number; active_30d: number; new_30d: number;
    multi_venue: number; churn_risk: number; total_ltv: number; avg_ltv: number;
    avg_basket: number; repeat_rate: number;
  };
  segments: { key: string; count: number; revenue: number; avg_ltv: number }[];
  tiers: { key: string; count: number; revenue: number }[];
  categories: { key: string; count: number }[];
  cohorts: { month: string; new_customers: number; revenue: number }[];
  cities: { city: string; count: number; revenue: number }[];
  genders: { gender: string; count: number }[];
  ages: { bucket: string; count: number }[];
}

interface CustomerRow {
  email: string; user_id: string | null; first_name: string | null; last_name: string | null;
  city: string | null; total_spent: number; rev_30d: number; rev_90d: number; trend_pct: number;
  avg_basket: number; visit_nights: number; tx_count: number; ticket_count: number;
  order_count: number; table_count: number; venues_count: number; venue_names: string;
  first_at: string; last_at: string; r: number; f: number; m: number;
  segment: SegmentKey; tier: string; category: string;
}

interface CustomerDetail {
  identity: {
    user_id: string; first_name: string | null; last_name: string | null; phone: string | null;
    city: string | null; gender: string | null; age: number | null; created_at: string;
    preferred_language: string | null; party_persona: string | null; is_suspended: boolean;
    sms_opt_in: boolean; avatar_url: string | null;
  } | null;
  stats: {
    total_spent: number; rev_30d: number; rev_90d: number; avg_basket: number;
    visit_nights: number; tx_count: number; ticket_count: number; order_count: number;
    table_count: number; venues_count: number; first_at: string; last_at: string;
    r: number; f: number; m: number; segment: SegmentKey; tier: string; category: string;
  } | null;
  per_venue: { venue_id: string; venue_name: string; revenue: number; tx_count: number; last_at: string }[];
  recent: { kind: string; amount: number; created_at: string; venue_name: string; event_title: string | null }[];
  incidents: { venue_name: string; type: string; reason: string; created_at: string }[];
  banned_venues: { venue_name: string; reason: string | null; banned_at: string }[];
  newsletter_opt_in: boolean;
}

const PAGE_SIZE = 25;
const eur = (v: number) => `${(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€`;
const eur2 = (v: number) => `${(v ?? 0).toFixed(2)}€`;

// ─── Small primitives ─────────────────────────────────────────────────────────
function PCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden', position: 'relative', ...style }}>
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, title, sub, right, accent }: { icon: LucideIcon; title: string; sub?: string; right?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
          style={accent
            ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }
            : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
        >
          <Icon className="w-4 h-4" style={accent ? { color: RED } : undefined} />
        </div>
        <div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{title}</h3>
          {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

function KpiTile({ label, value, sub, icon: Icon, highlight }: { label: string; value: string; sub?: string; icon: LucideIcon; highlight?: boolean }) {
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
        <div className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
          style={{ background: highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${highlight ? 'rgba(232,25,44,0.2)' : F_BORDER}` }}>
          <Icon className="h-3.5 w-3.5" style={{ color: highlight ? RED : T2 }} />
        </div>
      </div>
      <p className="tabular-nums leading-none" style={{ color: highlight ? RED : T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.025em' }}>{value}</p>
      {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function SegmentBadge({ segment, t }: { segment: SegmentKey; t: (k: string) => string }) {
  const meta = SEG_BY_KEY[segment] ?? SEG_BY_KEY.lost;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-none"
      style={{ background: `${meta.accent}14`, border: `1px solid ${meta.accent}3D`, color: meta.accent }}>
      <Icon className="w-3 h-3" />
      {t(`adminSeg.seg.${segment}`)}
    </span>
  );
}

function TierBadge({ tier, t }: { tier: string; t: (k: string) => string }) {
  const color = TIER_COLORS[tier] ?? T2;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold flex-none uppercase tracking-wide"
      style={{ background: `${color === T2 ? 'rgba(255,255,255,0.06)' : color + '14'}`, border: `1px solid ${color === T2 ? BORDER : color + '38'}`, color }}>
      {t(`adminSeg.tier.${tier}`)}
    </span>
  );
}

function Trend({ pct }: { pct: number }) {
  if (!pct) return <span style={{ color: T3, fontSize: 12 }}>—</span>;
  const up = pct > 0;
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold tabular-nums" style={{ color: up ? POS : NEG }}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function HBar({ label, value, max, color, right }: { label: string; value: number; max: number; color?: string; right?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
        <span className="truncate pr-2" style={{ color: T2 }}>{label}</span>
        <span className="tabular-nums flex-none" style={{ color: T1 }}>
          {value.toLocaleString()}{right && <span style={{ color: T3 }}> · {right}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color ?? 'linear-gradient(90deg, rgba(232,25,44,0.8), rgba(232,25,44,0.4))' }} />
      </div>
    </div>
  );
}

function RfmDots({ label, score, accent }: { label: string; score: number; accent: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', width: 72 }}>{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <span key={i} className="w-2 h-2 rounded-full" style={{ background: i <= score ? accent : 'rgba(255,255,255,0.09)' }} />
        ))}
      </div>
      <span className="tabular-nums" style={{ color: T1, fontSize: 12.5, fontWeight: 620 }}>{score}/5</span>
    </div>
  );
}

// ─── Dark chart tooltip ───────────────────────────────────────────────────────
function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; fill?: string }[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.fill, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function AdminSegmentation() {
  const { t } = useLanguage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // List state
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [segment, setSegment] = useState<SegmentKey | null>(null);
  const [tier, setTier] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [activity, setActivity] = useState<string>('');
  const [multiVenue, setMultiVenue] = useState(false);
  const [sort, setSort] = useState('total_spent');
  const [exporting, setExporting] = useState(false);

  // Drawer state
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => { setPage(0); }, [debouncedSearch, segment, tier, category, activity, multiVenue, sort]);

  useEffect(() => {
    (async () => {
      setLoadingOverview(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('admin_segmentation_overview' as any);
      if (error) console.error('[AdminSegmentation] overview error', error);
      setOverview((data as unknown as Overview | null) ?? null);
      setLoadingOverview(false);
    })();
  }, []);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc('admin_segmentation_customers' as any, {
      p_segment: segment ?? null,
      p_tier: tier || null,
      p_category: category || null,
      p_activity: activity || null,
      p_search: debouncedSearch || null,
      p_multi_venue: multiVenue ? true : null,
      p_sort: sort,
      p_dir: sort === 'first_at' ? 'asc' : 'desc',
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (error) console.error('[AdminSegmentation] list error', error);
    const payload = data as unknown as { total: number; rows: CustomerRow[] } | null;
    setRows(payload?.rows ?? []);
    setTotal(payload?.total ?? 0);
    setLoadingRows(false);
  }, [segment, tier, category, activity, debouncedSearch, multiVenue, sort, page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const openDetail = async (row: CustomerRow) => {
    setSelected(row);
    setDetail(null);
    setLoadingDetail(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc('admin_customer_detail' as any, { p_email: row.email });
    if (error) console.error('[AdminSegmentation] detail error', error);
    setDetail((data as unknown as CustomerDetail | null) ?? null);
    setLoadingDetail(false);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: CustomerRow[] = [];
      const CHUNK = 500;
      for (let offset = 0; offset < 4000; offset += CHUNK) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await supabase.rpc('admin_segmentation_customers' as any, {
          p_segment: segment ?? null, p_tier: tier || null, p_category: category || null,
          p_activity: activity || null, p_search: debouncedSearch || null,
          p_multi_venue: multiVenue ? true : null,
          p_sort: sort, p_dir: 'desc', p_limit: CHUNK, p_offset: offset,
        });
        const payload = data as unknown as { total: number; rows: CustomerRow[] } | null;
        if (!payload?.rows?.length) break;
        all.push(...payload.rows);
        if (all.length >= (payload.total ?? 0)) break;
      }
      const header = ['email', 'first_name', 'last_name', 'city', 'segment', 'tier', 'category',
        'total_spent', 'rev_30d', 'rev_90d', 'avg_basket', 'visit_nights', 'tx_count',
        'ticket_count', 'order_count', 'table_count', 'venues_count', 'venue_names',
        'first_at', 'last_at', 'r', 'f', 'm'];
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [header.join(';'), ...all.map(r => header.map(h => esc((r as unknown as Record<string, unknown>)[h])).join(';'))].join('\n');
      // BOM UTF-8 pour qu'Excel ouvre les accents correctement
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yuno-customers-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // ─── Derived overview data ────────────────────────────────────────────────
  const segCards = useMemo(() => {
    const byKey = new Map((overview?.segments ?? []).map(s => [s.key, s]));
    const totalCustomers = overview?.totals.customers || 0;
    return SEGMENTS.map(meta => {
      const d = byKey.get(meta.key);
      return {
        ...meta,
        count: d?.count ?? 0,
        revenue: d?.revenue ?? 0,
        avgLtv: d?.avg_ltv ?? 0,
        pct: totalCustomers > 0 ? ((d?.count ?? 0) / totalCustomers) * 100 : 0,
      };
    });
  }, [overview]);

  const cohortData = useMemo(() => (overview?.cohorts ?? []).map(c => ({
    month: c.month.slice(5) + '/' + c.month.slice(2, 4),
    n: c.new_customers,
  })), [overview]);

  const tierData = useMemo(() => TIER_ORDER
    .map(k => ({ name: t(`adminSeg.tier.${k}`), key: k, value: (overview?.tiers ?? []).find(x => x.key === k)?.count ?? 0 }))
    .filter(d => d.value > 0), [overview, t]);

  const catData = useMemo(() => ['tickets', 'drinks', 'tables', 'mixed']
    .map(k => ({ name: t(`adminSeg.cat.${k}`), key: k, value: (overview?.categories ?? []).find(x => x.key === k)?.count ?? 0 }))
    .filter(d => d.value > 0), [overview, t]);

  const genderMax = Math.max(1, ...(overview?.genders ?? []).map(g => g.count));
  const AGE_ORDER = ['<18', '18-20', '21-24', '25-29', '30-34', '35+'];
  const ages = AGE_ORDER.map(b => ({ bucket: b, count: (overview?.ages ?? []).find(a => a.bucket === b)?.count ?? 0 }));
  const ageMax = Math.max(1, ...ages.map(a => a.count));
  const cityMax = Math.max(1, ...(overview?.cities ?? []).map(c => c.count));

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const inputStyle: React.CSSProperties = {
    background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
    color: T1, fontSize: 13, padding: '9px 12px', outline: 'none',
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' };
  const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

  const detailName = selected
    ? (`${selected.first_name || ''} ${selected.last_name || ''}`.trim() || selected.email)
    : '';

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminSeg.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminSeg.subtitle')}</p>
          </div>
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:cursor-wait"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88`, opacity: exporting ? 0.6 : 1 }}
          >
            <Download className="w-4 h-4" />
            {exporting ? t('adminSeg.exporting') : t('adminSeg.exportCsv')}
          </button>
        </div>

        {loadingOverview ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : overview && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: t('adminSeg.kpi.customers'), value: overview.totals.customers.toLocaleString(), sub: `${overview.totals.with_account.toLocaleString()} ${t('adminSeg.kpi.withAccount')}`, icon: Users },
                { label: t('adminSeg.kpi.active30'), value: overview.totals.active_30d.toLocaleString(), icon: Flame },
                { label: t('adminSeg.kpi.new30'), value: `+${overview.totals.new_30d.toLocaleString()}`, icon: UserPlus },
                { label: t('adminSeg.kpi.avgLtv'), value: eur2(overview.totals.avg_ltv), sub: `${t('adminSeg.kpi.totalLtv')} ${eur(overview.totals.total_ltv)}`, icon: Crown },
                { label: t('adminSeg.kpi.repeatRate'), value: `${overview.totals.repeat_rate}%`, sub: `${overview.totals.multi_venue.toLocaleString()} ${t('adminSeg.kpi.multiVenue')}`, icon: Repeat },
                { label: t('adminSeg.kpi.churnRisk'), value: overview.totals.churn_risk.toLocaleString(), icon: AlertTriangle, highlight: true },
              ].map((k, i) => (
                <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <KpiTile {...k} />
                </motion.div>
              ))}
            </div>

            {/* Segment cards */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <PCard>
                <CardHeader icon={Layers} title={t('adminSeg.segments.title')} sub={t('adminSeg.segments.sub')} accent
                  right={segment && (
                    <button onClick={() => setSegment(null)} className="text-[12px] font-medium cursor-pointer px-3 py-1.5 rounded-lg transition-all duration-150"
                      style={{ color: T2, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}` }}>
                      {t('adminSeg.segments.clear')}
                    </button>
                  )}
                />
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
                  {segCards.map((s, i) => {
                    const Icon = s.icon;
                    const active = segment === s.key;
                    return (
                      <motion.button
                        key={s.key}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.03 }}
                        onClick={() => setSegment(active ? null : s.key)}
                        className="text-left rounded-xl p-3 cursor-pointer transition-all duration-150"
                        style={{
                          background: active ? `${s.accent}14` : 'rgba(255,255,255,0.025)',
                          border: `1px solid ${active ? `${s.accent}55` : BORDER}`,
                          boxShadow: active ? `0 0 20px -8px ${s.accent}66` : undefined,
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          <Icon className="w-3.5 h-3.5" style={{ color: s.accent }} />
                          <span style={{ color: active ? T1 : T2, fontSize: 12, fontWeight: 600 }}>{t(`adminSeg.seg.${s.key}`)}</span>
                        </div>
                        <div className="tabular-nums leading-none" style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em' }}>
                          {s.count.toLocaleString()}
                        </div>
                        <div className="tabular-nums mt-1.5" style={{ color: T3, fontSize: 11 }}>
                          {s.pct.toFixed(0)}% · {eur(s.revenue)}
                        </div>
                        <div className="h-1 rounded-full mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, s.pct)}%`, background: s.accent }} />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </PCard>
            </motion.div>

            {/* Cohorts + tiers + categories */}
            <div className="grid gap-4 lg:grid-cols-3">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lg:col-span-1">
                <PCard style={{ height: '100%' }}>
                  <CardHeader icon={CalendarDays} title={t('adminSeg.cohorts.title')} sub={t('adminSeg.cohorts.sub')} />
                  <div style={{ width: '100%', height: 190 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cohortData} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" vertical={false} />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={8} tick={{ fill: 'rgba(255,255,255,0.36)', fontSize: 9.5 }} interval={1} />
                        <YAxis hide />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                        <Bar dataKey="n" name={t('adminSeg.cohorts.newCustomers')} fill={RED} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </PCard>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
                <PCard style={{ height: '100%' }}>
                  <CardHeader icon={Crown} title={t('adminSeg.tiers.title')} sub={t('adminSeg.tiers.sub')} />
                  {tierData.length === 0 ? (
                    <p className="text-center py-8 text-xs" style={{ color: T3 }}>{t('adminSeg.table.empty')}</p>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div style={{ width: 130, height: 130, flexShrink: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={tierData} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={4} cornerRadius={3} dataKey="value" strokeWidth={2} stroke="#000">
                              {tierData.map(d => <Cell key={d.key} fill={TIER_COLORS[d.key]} />)}
                            </Pie>
                            <Tooltip content={<DarkTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-2">
                        {tierData.map(d => (
                          <button key={d.key} onClick={() => setTier(tier === d.key ? '' : d.key)}
                            className="flex w-full items-center justify-between cursor-pointer rounded-lg px-2 py-1 transition-all duration-150"
                            style={{ background: tier === d.key ? 'rgba(255,255,255,0.05)' : 'transparent', border: `1px solid ${tier === d.key ? BORDER : 'transparent'}` }}>
                            <span className="inline-flex items-center gap-2" style={{ color: T2, fontSize: 12.5 }}>
                              <span className="w-2 h-2 rounded-full" style={{ background: TIER_COLORS[d.key] }} />
                              {d.name}
                            </span>
                            <span className="tabular-nums" style={{ color: T1, fontSize: 12.5, fontWeight: 620 }}>{d.value.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </PCard>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.21 }}>
                <PCard style={{ height: '100%' }}>
                  <CardHeader icon={Wine} title={t('adminSeg.cats.title')} sub={t('adminSeg.cats.sub')} />
                  {catData.length === 0 ? (
                    <p className="text-center py-8 text-xs" style={{ color: T3 }}>{t('adminSeg.table.empty')}</p>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div style={{ width: 130, height: 130, flexShrink: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={catData} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={4} cornerRadius={3} dataKey="value" strokeWidth={2} stroke="#000">
                              {catData.map(d => <Cell key={d.key} fill={CAT_META[d.key].color} />)}
                            </Pie>
                            <Tooltip content={<DarkTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-2">
                        {catData.map(d => {
                          const Icon = CAT_META[d.key].icon;
                          return (
                            <button key={d.key} onClick={() => setCategory(category === d.key ? '' : d.key)}
                              className="flex w-full items-center justify-between cursor-pointer rounded-lg px-2 py-1 transition-all duration-150"
                              style={{ background: category === d.key ? 'rgba(255,255,255,0.05)' : 'transparent', border: `1px solid ${category === d.key ? BORDER : 'transparent'}` }}>
                              <span className="inline-flex items-center gap-2" style={{ color: T2, fontSize: 12.5 }}>
                                <Icon className="w-3.5 h-3.5" style={{ color: CAT_META[d.key].color }} />
                                {d.name}
                              </span>
                              <span className="tabular-nums" style={{ color: T1, fontSize: 12.5, fontWeight: 620 }}>{d.value.toLocaleString()}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </PCard>
              </motion.div>
            </div>

            {/* Demographics */}
            <div className="grid gap-4 lg:grid-cols-3">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
                <PCard style={{ height: '100%' }}>
                  <CardHeader icon={Users} title={t('adminSeg.demo.gender')} sub={t('adminSeg.demo.sub')} />
                  <div className="space-y-3">
                    {(overview.genders ?? []).sort((a, b) => b.count - a.count).map(g => (
                      <HBar key={g.gender}
                        label={t(`adminSeg.gender.${['male', 'female', 'other', 'unknown'].includes(g.gender) ? g.gender : 'other'}`)}
                        value={g.count} max={genderMax}
                        color={g.gender === 'unknown' ? 'rgba(255,255,255,0.22)' : undefined} />
                    ))}
                  </div>
                </PCard>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.27 }}>
                <PCard style={{ height: '100%' }}>
                  <CardHeader icon={CalendarDays} title={t('adminSeg.demo.age')} sub={t('adminSeg.demo.sub')} />
                  <div className="space-y-3">
                    {ages.map(a => (
                      <HBar key={a.bucket} label={a.bucket} value={a.count} max={ageMax}
                        color="linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.75))" />
                    ))}
                  </div>
                </PCard>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <PCard style={{ height: '100%' }}>
                  <CardHeader icon={MapPin} title={t('adminSeg.demo.cities')} sub={t('adminSeg.demo.citiesSub')} />
                  {(overview.cities ?? []).length === 0 ? (
                    <p className="text-center py-8 text-xs" style={{ color: T3 }}>{t('adminSeg.table.empty')}</p>
                  ) : (
                    <div className="space-y-3">
                      {(overview.cities ?? []).slice(0, 6).map(c => (
                        <HBar key={c.city} label={c.city} value={c.count} max={cityMax} right={eur(c.revenue)} />
                      ))}
                    </div>
                  )}
                </PCard>
              </motion.div>
            </div>
          </>
        )}

        {/* ───── Customers table ───── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
          <PCard style={{ padding: 0 }}>
            <div style={{ padding: '20px 22px 0' }}>
              <CardHeader icon={Users} title={t('adminSeg.table.title')}
                sub={`${total.toLocaleString()} ${t('adminSeg.table.results')}${segment ? ` · ${t(`adminSeg.seg.${segment}`)}` : ''}`} />

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2 pb-4">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
                  <input
                    placeholder={t('adminSeg.filters.search')}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ ...inputStyle, paddingLeft: 36, width: '100%' }}
                  />
                </div>
                <select value={activity} onChange={e => setActivity(e.target.value)} style={selectStyle}>
                  <option value="">{t('adminSeg.filters.activityAll')}</option>
                  <option value="active_30d">{t('adminSeg.filters.active')}</option>
                  <option value="cooling">{t('adminSeg.filters.cooling')}</option>
                  <option value="lapsed">{t('adminSeg.filters.lapsed')}</option>
                </select>
                <select value={tier} onChange={e => setTier(e.target.value)} style={selectStyle}>
                  <option value="">{t('adminSeg.filters.tierAll')}</option>
                  {TIER_ORDER.map(k => <option key={k} value={k}>{t(`adminSeg.tier.${k}`)}</option>)}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
                  <option value="">{t('adminSeg.filters.catAll')}</option>
                  {['tickets', 'drinks', 'tables', 'mixed'].map(k => <option key={k} value={k}>{t(`adminSeg.cat.${k}`)}</option>)}
                </select>
                <select value={sort} onChange={e => setSort(e.target.value)} style={selectStyle}>
                  <option value="total_spent">{t('adminSeg.sort.ltv')}</option>
                  <option value="last_at">{t('adminSeg.sort.recent')}</option>
                  <option value="rev_90d">{t('adminSeg.sort.rev90')}</option>
                  <option value="visit_nights">{t('adminSeg.sort.visits')}</option>
                  <option value="first_at">{t('adminSeg.sort.oldest')}</option>
                </select>
                <button
                  onClick={() => setMultiVenue(v => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                  style={multiVenue
                    ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88`, border: '1px solid transparent' }
                    : { color: T3, background: INNER_BG, border: `1px solid ${BORDER}` }}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  {t('adminSeg.filters.multiVenue')}
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 940 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.015)' }}>
                    <th className="px-4 py-2.5 text-left" style={thStyle}>{t('adminSeg.table.customer')}</th>
                    <th className="px-3 py-2.5 text-left" style={thStyle}>{t('adminSeg.table.segment')}</th>
                    <th className="px-3 py-2.5 text-right" style={thStyle}>LTV</th>
                    <th className="px-3 py-2.5 text-right" style={thStyle}>{t('adminSeg.table.trend')}</th>
                    <th className="px-3 py-2.5 text-right" style={thStyle}>{t('adminSeg.table.visits')}</th>
                    <th className="px-3 py-2.5 text-left" style={thStyle}>{t('adminSeg.table.venues')}</th>
                    <th className="px-3 py-2.5 text-right" style={thStyle}>{t('adminSeg.table.lastActivity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingRows ? (
                    <tr><td colSpan={7} className="text-center py-10" style={{ color: T3, fontSize: 12.5 }}>{t('adminSeg.table.loading')}</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10" style={{ color: T3, fontSize: 12.5 }}>{t('adminSeg.table.empty')}</td></tr>
                  ) : rows.map((r, i) => {
                    const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
                    return (
                      <tr
                        key={r.email}
                        onClick={() => openDetail(r)}
                        className="cursor-pointer transition-colors duration-150 hover:bg-white/[0.03]"
                        style={{ borderBottom: i < rows.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                      >
                        <td className="px-4 py-3 max-w-[240px]">
                          <div className="font-medium truncate" style={{ color: T1 }}>{name || r.email}</div>
                          {name && <div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{r.email}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <SegmentBadge segment={r.segment} t={t} />
                            <TierBadge tier={r.tier} t={t} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold" style={{ color: T1 }}>{eur2(r.total_spent)}</td>
                        <td className="px-3 py-3 text-right"><Trend pct={r.trend_pct} /></td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{r.visit_nights}</td>
                        <td className="px-3 py-3 max-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            {r.venues_count >= 2 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums flex-none"
                                style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }}>
                                ×{r.venues_count}
                              </span>
                            )}
                            <span className="truncate" style={{ color: T3, fontSize: 12 }}>{r.venue_names || '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>
                          {r.last_at ? format(new Date(r.last_at), 'dd/MM/yyyy') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg cursor-pointer transition-all duration-150 disabled:cursor-not-allowed"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: page === 0 ? 0.4 : 1 }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="tabular-nums px-2" style={{ color: T3, fontSize: 12.5 }}>{page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg cursor-pointer transition-all duration-150 disabled:cursor-not-allowed"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: page >= totalPages - 1 ? 0.4 : 1 }}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </PCard>
        </motion.div>
      </div>

      {/* ───── Customer 360 drawer ───── */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); setDetail(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col border-0 overflow-y-auto"
          style={{ background: 'linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c', borderLeft: `1px solid ${BORDER}` }}>
          {selected && (
            <>
              <SheetHeader className="p-5 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <SheetTitle className="text-left truncate" style={{ color: T1, fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' }}>
                      {detailName}
                    </SheetTitle>
                    <button
                      onClick={() => { navigator.clipboard.writeText(selected.email); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                      className="inline-flex items-center gap-1.5 mt-1 cursor-pointer"
                      style={{ color: T3, fontSize: 12 }}
                    >
                      {copied ? <Check className="w-3 h-3" style={{ color: POS }} /> : <Copy className="w-3 h-3" />}
                      <span className="truncate">{selected.email}</span>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <SegmentBadge segment={selected.segment} t={t} />
                  <TierBadge tier={selected.tier} t={t} />
                  {detail?.identity?.is_suspended && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
                      style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', color: RED }}>
                      <Ban className="w-3 h-3" />{t('adminSeg.drawer.suspended')}
                    </span>
                  )}
                </div>
              </SheetHeader>

              <div className="flex-1 p-5 space-y-5">
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-9 w-9 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                  </div>
                ) : (
                  <>
                    {/* RFM scores */}
                    <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px' }}>
                      <div className="space-y-2.5">
                        <RfmDots label={t('adminSeg.rfm.r')} score={selected.r} accent={SEG_BY_KEY[selected.segment]?.accent ?? RED} />
                        <RfmDots label={t('adminSeg.rfm.f')} score={selected.f} accent={SEG_BY_KEY[selected.segment]?.accent ?? RED} />
                        <RfmDots label={t('adminSeg.rfm.m')} score={selected.m} accent={SEG_BY_KEY[selected.segment]?.accent ?? RED} />
                      </div>
                    </div>

                    {/* Key stats */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'LTV', value: eur2(selected.total_spent) },
                        { label: t('adminSeg.drawer.visits'), value: String(selected.visit_nights) },
                        { label: t('adminSeg.drawer.avgBasket'), value: eur2(selected.avg_basket) },
                      ].map(s => (
                        <div key={s.label} style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}>
                          <p style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</p>
                          <p className="tabular-nums mt-1" style={{ color: T1, fontSize: 16, fontWeight: 640, letterSpacing: '-0.01em' }}>{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Identity */}
                    <div>
                      <p className="mb-2" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('adminSeg.drawer.profile')}</p>
                      <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '4px 16px' }}>
                        {detail?.identity ? (
                          <>
                            {[
                              [t('adminSeg.drawer.city'), detail.identity.city],
                              [t('adminSeg.drawer.age'), detail.identity.age ? `${detail.identity.age} ${t('adminSeg.drawer.yearsOld')}` : null],
                              [t('adminSeg.drawer.gender'), detail.identity.gender ? t(`adminSeg.gender.${['male', 'female'].includes(detail.identity.gender) ? detail.identity.gender : 'other'}`) : null],
                              [t('adminSeg.drawer.phone'), detail.identity.phone],
                              [t('adminSeg.drawer.memberSince'), format(new Date(detail.identity.created_at), 'dd/MM/yyyy')],
                            ].filter(([, v]) => v).map(([k, v]) => (
                              <div key={k as string} className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                                <span style={{ color: T3, fontSize: 12 }}>{k}</span>
                                <span style={{ color: T1, fontSize: 12.5, fontWeight: 500 }}>{v}</span>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 py-2.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                                style={{
                                  background: detail.newsletter_opt_in ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
                                  border: `1px solid ${detail.newsletter_opt_in ? 'rgba(52,211,153,0.25)' : BORDER}`,
                                  color: detail.newsletter_opt_in ? POS : T3,
                                }}>
                                <Mail className="w-3 h-3" />{t('adminSeg.drawer.newsletter')}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                                style={{
                                  background: detail.identity.sms_opt_in ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
                                  border: `1px solid ${detail.identity.sms_opt_in ? 'rgba(52,211,153,0.25)' : BORDER}`,
                                  color: detail.identity.sms_opt_in ? POS : T3,
                                }}>
                                <Bell className="w-3 h-3" />SMS
                              </span>
                            </div>
                          </>
                        ) : (
                          <p className="py-3" style={{ color: T3, fontSize: 12.5 }}>{t('adminSeg.drawer.guest')}</p>
                        )}
                      </div>
                    </div>

                    {/* Per venue */}
                    {(detail?.per_venue ?? []).length > 0 && (
                      <div>
                        <p className="mb-2" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('adminSeg.drawer.perVenue')}</p>
                        <div className="space-y-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px' }}>
                          {(detail!.per_venue).map(v => (
                            <HBar key={v.venue_id} label={v.venue_name} value={Math.round(v.revenue)}
                              max={Math.max(1, ...detail!.per_venue.map(x => x.revenue))}
                              right={`${v.tx_count} tx`} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recent transactions */}
                    {(detail?.recent ?? []).length > 0 && (
                      <div>
                        <p className="mb-2" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('adminSeg.drawer.recent')}</p>
                        <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '4px 16px' }}>
                          {(detail!.recent).slice(0, 10).map((r, i, arr) => {
                            const Icon = CAT_META[r.kind]?.icon ?? Layers;
                            return (
                              <div key={i} className="flex items-center gap-3 py-2.5" style={{ borderBottom: i < arr.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                                <div className="w-7 h-7 flex items-center justify-center rounded-lg flex-none"
                                  style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                                  <Icon className="w-3.5 h-3.5" style={{ color: CAT_META[r.kind]?.color ?? T2 }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 500 }}>
                                    {r.event_title || r.venue_name}
                                  </div>
                                  <div style={{ color: T3, fontSize: 11 }}>
                                    {r.venue_name} · {format(new Date(r.created_at), 'dd/MM/yy')}
                                  </div>
                                </div>
                                <span className="tabular-nums flex-none" style={{ color: T1, fontSize: 12.5, fontWeight: 620 }}>{eur2(r.amount)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Incidents + bans */}
                    {((detail?.incidents ?? []).length > 0 || (detail?.banned_venues ?? []).length > 0) && (
                      <div>
                        <p className="mb-2" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('adminSeg.drawer.incidents')}</p>
                        <div className="space-y-2">
                          {(detail?.banned_venues ?? []).map((b, i) => (
                            <div key={`b${i}`} className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
                              style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.22)' }}>
                              <Ban className="w-3.5 h-3.5 flex-none mt-0.5" style={{ color: RED }} />
                              <div className="min-w-0">
                                <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('adminSeg.drawer.bannedAt')} {b.venue_name}</p>
                                {b.reason && <p style={{ color: T2, fontSize: 11.5 }}>{b.reason}</p>}
                              </div>
                            </div>
                          ))}
                          {(detail?.incidents ?? []).slice(0, 6).map((inc, i) => (
                            <div key={`i${i}`} className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
                              style={{ background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.2)' }}>
                              <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" style={{ color: '#FB923C' }} />
                              <div className="min-w-0">
                                <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                                  {inc.type} · {inc.venue_name}
                                  <span style={{ color: T3, fontWeight: 400 }}> · {format(new Date(inc.created_at), 'dd/MM/yy')}</span>
                                </p>
                                <p style={{ color: T2, fontSize: 11.5 }}>{inc.reason}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Open full profile */}
                    {(detail?.identity?.user_id || selected.user_id) && (
                      <Link
                        to={`/admin/directory/user/${detail?.identity?.user_id || selected.user_id}`}
                        className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150"
                        style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88`, textDecoration: 'none' }}
                      >
                        <ExternalLink className="w-4 h-4" />
                        {t('adminSeg.drawer.openProfile')}
                      </Link>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
