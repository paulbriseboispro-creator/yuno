import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  TrendingUp, MousePointerClick, Eye, Users, Clock, Repeat2,
  Smartphone, Monitor, Tablet, Globe, Share2, Search, Mail, QrCode,
  Link2, ExternalLink, Zap, BarChart3, ArrowRight, Activity,
  LayoutGrid, Info, FileBarChart, TrendingDown,
} from 'lucide-react';
import { format, subDays, subMinutes, getDay, getHours } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  AffPage, AffHeading, AffCard, AffCardHeader, KpiCard, TabBar, AffSpinner, AffEmpty,
  RED, POS, NEG, WARN, T1, T2, T3, BORDER, F_BORDER, C_HI, C_MID, TILE_BG,
} from '@/components/affiliate/affiliate-ui';

const NEG_C = NEG;

type Period = '7d' | '30d' | '90d' | 'all';
type Pillar = 'overview' | 'audience' | 'events' | 'campaigns' | 'rapport';

interface Identity {
  affiliateId: string;
  memberId: string | null;
  memberSlug: string | null;
  role: 'admin' | 'member';
  linktreeUrl: string;
}

interface KPIs {
  totalViews: number;
  linktreeViews: number;
  uniqueVisitors: number;
  totalClicks: number;
  clickRate: number;
  returningRate: number;
  avgDurationSeconds: number;
  avgScrollDepth: number;
  liveNow: number;
  newVisitors: number;
  returningVisitors: number;
  /** Part des vues arrivées depuis Yuno (marketplace/app) plutôt que des canaux de l'agence. */
  yunoShare: number;
}

interface DailyPoint { date: string; views: number; clicks: number }
interface SourceRow { category: string; views: number; clicks: number }
interface DeviceRow { device: string; views: number }
interface TopEvent { id: string; name: string; event_date: string; views: number; clicks: number; ctr: number; venue_name: string | null }
interface CampaignRow { source: string; medium: string; campaign: string; views: number; clicks: number }

interface RawSession {
  visited_at: string;
  visitor_id: string | null;
  is_returning: boolean;
  duration_seconds: number | null;
  scroll_depth_max: number | null;
  referrer_category: string | null;
  device_type: string | null;
  affiliate_event_id: string | null;
  entry_page_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

interface RawClick {
  clicked_at: string;
  affiliate_event_id: string | null;
  referrer_category: string | null;
  device_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

const PERIOD_DAYS: Record<Period, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };
const PERIOD_LABELS: Record<Period, string> = { '7d': 'aff.ana.period7d', '30d': 'aff.ana.period30d', '90d': 'aff.ana.period90d', all: 'aff.ana.periodAll' };

const SOURCE_META: Record<string, { label: string; icon: any }> = {
  direct:       { label: 'aff.ana.srcDirect',     icon: Link2 },
  social:       { label: 'aff.ana.srcSocial',     icon: Share2 },
  paid_social:  { label: 'aff.ana.srcPaidSocial', icon: Share2 },
  search:       { label: 'aff.ana.srcSearch',     icon: Search },
  paid_search:  { label: 'aff.ana.srcPaidSearch', icon: Search },
  qr:           { label: 'aff.ana.srcQr',         icon: QrCode },
  email:        { label: 'aff.ana.srcEmail',      icon: Mail },
  referral:     { label: 'aff.ana.srcReferral',   icon: ExternalLink },
  internal:     { label: 'aff.ana.srcInternal',   icon: Link2 },
};

const DEVICE_META: Record<string, { label: string; icon: any }> = {
  mobile:  { label: 'aff.ana.devMobile',  icon: Smartphone },
  desktop: { label: 'aff.ana.devDesktop', icon: Monitor },
  tablet:  { label: 'aff.ana.devTablet',  icon: Tablet },
};

const DAY_KEYS = ['aff.ana.daySun', 'aff.ana.dayMon', 'aff.ana.dayTue', 'aff.ana.dayWed', 'aff.ana.dayThu', 'aff.ana.dayFri', 'aff.ana.daySat'];

function periodFrom(p: Period): string | null {
  const days = PERIOD_DAYS[p];
  if (!days) return null;
  return subDays(new Date(), days).toISOString();
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }

// ── Sub-components ────────────────────────────────────────────────────────────

function DualChart({ data }: { data: DailyPoint[] }) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const maxViews  = Math.max(...data.map(d => d.views), 1);
  const maxClicks = Math.max(...data.map(d => d.clicks), 1);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-none" style={{ background: RED }} />
          <span style={{ color: T3, fontSize: 11 }}>{t('aff.ana.pageViews')}</span>
          <span className="ml-auto tabular-nums" style={{ color: T2, fontSize: 11, fontWeight: 600 }}>{data.reduce((s, d) => s + d.views, 0).toLocaleString()}</span>
        </div>
        <div className="flex items-end gap-0.5 h-16">
          {data.map(({ date, views, clicks }) => (
            <div key={date} className="flex-1 flex items-end group relative">
              <div className="w-full rounded-sm" style={{ height: `${(views / maxViews) * 100}%`, minHeight: views > 0 ? '3px' : '1px', background: RED, opacity: 0.85 }} />
              <div className="absolute bottom-full mb-1.5 hidden group-hover:block text-xs px-2 py-1 rounded whitespace-nowrap z-10 pointer-events-none"
                style={{ background: '#1a1a1d', border: `1px solid ${BORDER}`, color: T1 }}>
                {format(new Date(date), 'd MMM', { locale: dateLocale })}
                <br /><span style={{ color: RED }}>{t('aff.ana.tooltipViews')} {views}</span>
                <br /><span style={{ color: C_HI }}>{t('aff.ana.tooltipClicks')} {clicks}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-none" style={{ background: C_HI }} />
          <span style={{ color: T3, fontSize: 11 }}>{t('aff.ana.ticketClicks')}</span>
          <span className="ml-auto tabular-nums" style={{ color: T2, fontSize: 11, fontWeight: 600 }}>{data.reduce((s, d) => s + d.clicks, 0).toLocaleString()}</span>
        </div>
        <div className="flex items-end gap-0.5 h-10">
          {data.map(({ date, clicks }) => (
            <div key={date} className="flex-1 flex items-end">
              <div className="w-full rounded-sm" style={{ height: `${(clicks / maxClicks) * 100}%`, minHeight: clicks > 0 ? '3px' : '1px', background: C_HI }} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between">
        <span style={{ color: T3, fontSize: 10.5 }}>{data.length > 0 ? format(new Date(data[0].date), 'd MMM', { locale: dateLocale }) : ''}</span>
        <span style={{ color: T3, fontSize: 10.5 }}>{t('aff.ana.today')}</span>
      </div>
    </div>
  );
}

function HeatmapChart({ matrix }: { matrix: number[][] }) {
  const { t } = useLanguage();
  const flat = matrix.flat();
  const maxVal = Math.max(...flat, 1);
  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div>
      <div className="flex gap-0.5 mb-1">
        <div className="w-8 shrink-0" />
        {HOURS.map(h => (
          <div key={h} className="flex-1 text-center" style={{ fontSize: '8px', color: h % 6 === 0 ? T3 : 'transparent' }}>
            {h === 0 ? '0h' : h === 6 ? '6h' : h === 12 ? '12h' : h === 18 ? '18h' : h === 23 ? '23h' : ''}
          </div>
        ))}
      </div>
      {matrix.map((row, dayIdx) => (
        <div key={dayIdx} className="flex items-center gap-0.5 mb-0.5">
          <div className="w-8 shrink-0 text-right pr-1" style={{ fontSize: '9px', color: T3 }}>{t(DAY_KEYS[dayIdx])}</div>
          {row.map((val, hour) => {
            const intensity = maxVal > 0 ? val / maxVal : 0;
            return (
              <div key={hour} className="flex-1 rounded-[2px]"
                style={{ height: '14px', background: intensity > 0 ? `rgba(232,25,44,${0.10 + intensity * 0.68})` : 'rgba(255,255,255,0.03)' }}
                title={`${t(DAY_KEYS[dayIdx])} ${hour}h : ${val} ${t('aff.ana.visits')}`} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DurationHistogram({ sessions }: { sessions: RawSession[] }) {
  const buckets = [
    { label: '< 10s', min: 0, max: 10 },
    { label: '10–30s', min: 10, max: 30 },
    { label: '30s–1m', min: 30, max: 60 },
    { label: '1–3m', min: 60, max: 180 },
    { label: '3–10m', min: 180, max: 600 },
    { label: '> 10m', min: 600, max: Infinity },
  ];
  const counts = buckets.map(b => sessions.filter(s => {
    const d = s.duration_seconds ?? 0;
    return d >= b.min && d < b.max;
  }).length);
  const maxCount = Math.max(...counts, 1);

  return (
    <div className="space-y-2">
      {buckets.map((b, i) => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="flex-none text-right" style={{ color: T3, fontSize: 11, width: 56 }}>{b.label}</span>
          <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded transition-all" style={{ width: `${(counts[i] / maxCount) * 100}%`, background: `linear-gradient(90deg,${RED}88,${RED})` }} />
          </div>
          <span className="flex-none text-right tabular-nums" style={{ color: T2, fontSize: 11, fontWeight: 500, width: 32 }}>{counts[i]}</span>
        </div>
      ))}
    </div>
  );
}

function ScrollDepthGauge({ avg }: { avg: number }) {
  const pct = Math.min(avg, 100);
  const color = pct >= 70 ? POS : pct >= 40 ? WARN : RED;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg,${color},${color}88)` }} />
      </div>
      <span className="flex-none tabular-nums" style={{ color, fontSize: 14, fontWeight: 700 }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function LinktreeScore({ kpis }: { kpis: KPIs }) {
  const { t } = useLanguage();
  const ctrScore    = Math.min(kpis.clickRate / 15, 1) * 40;
  const returnScore = Math.min(kpis.returningRate / 25, 1) * 30;
  const engScore    = Math.min(kpis.avgScrollDepth / 60, 1) * 30;
  const total       = Math.round(ctrScore + returnScore + engScore);
  const color       = total >= 70 ? POS : total >= 40 ? WARN : RED;
  const label       = total >= 70 ? t('aff.ana.scoreExcellent') : total >= 40 ? t('aff.ana.scoreOk') : t('aff.ana.scoreImprove');

  const circumference = 2 * Math.PI * 28;
  const offset = circumference * (1 - total / 100);

  const bar = (label2: string, val: number) => (
    <div className="flex items-center gap-2">
      <span style={{ width: 64 }}>{label2}</span>
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)', width: 80 }}>
        <div className="h-full rounded-full" style={{ width: `${val * 100}%`, background: C_MID }} />
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-16 h-16 shrink-0">
        <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle cx="32" cy="32" r="28" fill="none" stroke={color} strokeWidth="6" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tabular-nums" style={{ color, fontSize: 14, fontWeight: 800 }}>{total}</span>
        </div>
      </div>
      <div>
        <p style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{label}</p>
        <div className="mt-1 space-y-0.5" style={{ color: T3, fontSize: 11 }}>
          {bar(t('aff.ana.scoreCtr'), Math.min(kpis.clickRate / 15, 1))}
          {bar(t('aff.ana.scoreLoyalty'), Math.min(kpis.returningRate / 25, 1))}
          {bar(t('aff.ana.scoreEngagement'), Math.min(kpis.avgScrollDepth / 60, 1))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AffiliateAnalytics() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  const [period, setPeriod]  = useState<Period>('30d');
  const [pillar, setPillar]  = useState<Pillar>('overview');

  const [kpis, setKpis]               = useState<KPIs>({ totalViews: 0, linktreeViews: 0, uniqueVisitors: 0, totalClicks: 0, clickRate: 0, returningRate: 0, avgDurationSeconds: 0, avgScrollDepth: 0, liveNow: 0, newVisitors: 0, returningVisitors: 0, yunoShare: 0 });
  const [daily, setDaily]             = useState<DailyPoint[]>([]);
  const [sources, setSources]         = useState<SourceRow[]>([]);
  const [devices, setDevices]         = useState<DeviceRow[]>([]);
  const [topEvents, setTopEvents]     = useState<TopEvent[]>([]);
  const [campaigns, setCampaigns]     = useState<CampaignRow[]>([]);
  const [heatmap, setHeatmap]         = useState<number[][]>(Array.from({ length: 7 }, () => Array(24).fill(0)));
  const [allSessions, setAllSessions] = useState<RawSession[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  type MonthKpis = { views: number; unique: number; clicks: number };
  const [thisMonth, setThisMonth] = useState<MonthKpis>({ views: 0, unique: 0, clicks: 0 });
  const [prevMonth, setPrevMonth] = useState<MonthKpis>({ views: 0, unique: 0, clicks: 0 });
  const [rapportLoading, setRapportLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setIdentityLoading(true);

      const { data: aff } = await supabase
        .from('affiliates')
        .select('id, linktree_slug')
        .eq('user_id', user.id)
        .maybeSingle();

      if (aff) {
        setIdentity({ affiliateId: aff.id, memberId: null, memberSlug: null, role: 'admin', linktreeUrl: `/p/${(aff as any).linktree_slug ?? ''}` });
        setIdentityLoading(false);
        return;
      }

      const { data: mem } = await supabase
        .from('affiliate_members')
        .select('id, affiliate_id, linktree_slug')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (mem) {
        setIdentity({ affiliateId: (mem as any).affiliate_id, memberId: mem.id, memberSlug: (mem as any).linktree_slug ?? null, role: 'member', linktreeUrl: `/promo/${(mem as any).linktree_slug ?? ''}` });
      }

      setIdentityLoading(false);
    })();
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!identity) return;
    setDataLoading(true);

    const from = periodFrom(period);
    const fiveMinAgo = subMinutes(new Date(), 5).toISOString();

    try {
      let sessQuery = supabase
        .from('affiliate_visitor_sessions')
        .select('visited_at, visitor_id, is_returning, duration_seconds, scroll_depth_max, referrer_category, device_type, affiliate_event_id, entry_page_type, utm_source, utm_medium, utm_campaign')
        .eq('affiliate_id', identity.affiliateId)
        .eq('is_internal', false)
        .gte('visited_at', from || '2000-01-01')
        .limit(10000);

      if (identity.role === 'member' && identity.memberId) {
        sessQuery = sessQuery.eq('affiliate_member_id', identity.memberId);
      }

      let clickQuery = supabase
        .from('affiliate_clicks')
        .select('clicked_at, affiliate_event_id, referrer_category, device_type, utm_source, utm_medium, utm_campaign')
        .eq('affiliate_id', identity.affiliateId)
        .eq('is_internal', false)
        .gte('clicked_at', from || '2000-01-01')
        .limit(10000);

      if (identity.role === 'member' && identity.memberId) {
        clickQuery = clickQuery.eq('affiliate_member_id', identity.memberId);
      }

      const [
        { data: sessions },
        { data: clicks },
        { data: livePings },
        { data: eventsRaw },
      ] = await Promise.all([
        sessQuery,
        clickQuery,
        (identity.role === 'member' && identity.memberId
          ? supabase.from('affiliate_live_pings').select('session_id').eq('affiliate_id', identity.affiliateId).eq('affiliate_member_id', identity.memberId).gte('last_seen', fiveMinAgo)
          : supabase.from('affiliate_live_pings').select('session_id').eq('affiliate_id', identity.affiliateId).gte('last_seen', fiveMinAgo)),
        supabase.from('affiliate_events').select('id, name, event_date, affiliate_venues(name)').eq('affiliate_id', identity.affiliateId).limit(200),
      ]);

      const rows: RawSession[]      = (sessions ?? []) as RawSession[];
      const clickRows: RawClick[]   = (clicks ?? []) as RawClick[];
      const evts                    = eventsRaw ?? [];

      setAllSessions(rows);

      const uniqueVids        = new Set(rows.filter(r => r.visitor_id).map(r => r.visitor_id));
      const returningCount    = rows.filter(r => r.is_returning).length;
      const durRows           = rows.filter(r => typeof r.duration_seconds === 'number' && (r.duration_seconds ?? 0) > 0);
      const avgDur            = durRows.length > 0 ? Math.round(durRows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0) / durRows.length) : 0;
      const scrollRows        = rows.filter(r => typeof r.scroll_depth_max === 'number' && (r.scroll_depth_max ?? 0) > 0);
      const avgScroll         = scrollRows.length > 0 ? Math.round(scrollRows.reduce((s, r) => s + (r.scroll_depth_max ?? 0), 0) / scrollRows.length) : 0;
      const linktreeViews     = rows.filter(r => r.entry_page_type === 'linktree' || r.entry_page_type === 'member_linktree').length;
      // Comptages réels par visiteur (et non une estimation à partir du taux
      // par session) : un visiteur est « fidèle » si au moins une de ses
      // sessions est un retour.
      const returningVids     = new Set(rows.filter(r => r.is_returning && r.visitor_id).map(r => r.visitor_id));
      const returningVisitors = [...uniqueVids].filter(v => returningVids.has(v)).length;
      const newVisitors       = uniqueVids.size - returningVisitors;
      // Trafic apporté par Yuno : sessions arrivées depuis yunoapp.eu
      // (marketplace, app, pages Yuno) — l'argument « revenu passif ».
      const yunoViews         = rows.filter(r => r.referrer_category === 'internal').length;

      setKpis({
        totalViews: rows.length,
        linktreeViews,
        uniqueVisitors: uniqueVids.size,
        totalClicks: clickRows.length,
        clickRate: rows.length > 0 ? (clickRows.length / rows.length) * 100 : 0,
        returningRate: rows.length > 0 ? (returningCount / rows.length) * 100 : 0,
        avgDurationSeconds: avgDur,
        avgScrollDepth: avgScroll,
        liveNow: (livePings ?? []).length,
        newVisitors,
        returningVisitors,
        yunoShare: rows.length > 0 ? (yunoViews / rows.length) * 100 : 0,
      });

      const days       = Math.min(PERIOD_DAYS[period] ?? 90, 90);
      const viewBuckets: Record<string, number> = {};
      const clickBuckets: Record<string, number> = {};
      for (let i = days - 1; i >= 0; i--) {
        const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
        viewBuckets[d] = 0;
        clickBuckets[d] = 0;
      }
      rows.forEach(r => { const d = r.visited_at.split('T')[0]; if (viewBuckets[d] !== undefined) viewBuckets[d]++; });
      clickRows.forEach(r => { const d = r.clicked_at.split('T')[0]; if (clickBuckets[d] !== undefined) clickBuckets[d]++; });
      setDaily(Object.keys(viewBuckets).map(date => ({ date, views: viewBuckets[date], clicks: clickBuckets[date] })));

      const srcMap: Record<string, { views: number; clicks: number }> = {};
      rows.forEach(r => { const cat = r.referrer_category || 'direct'; srcMap[cat] = srcMap[cat] ?? { views: 0, clicks: 0 }; srcMap[cat].views++; });
      clickRows.forEach(r => { const cat = r.referrer_category || 'direct'; srcMap[cat] = srcMap[cat] ?? { views: 0, clicks: 0 }; srcMap[cat].clicks++; });
      setSources(Object.entries(srcMap).map(([category, v]) => ({ category, ...v })).sort((a, b) => b.views - a.views));

      const devMap: Record<string, number> = {};
      rows.forEach(r => { const dev = r.device_type || 'unknown'; devMap[dev] = (devMap[dev] ?? 0) + 1; });
      setDevices(Object.entries(devMap).map(([device, views]) => ({ device, views })).sort((a, b) => b.views - a.views));

      const mat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
      rows.forEach(r => { const d = new Date(r.visited_at); mat[getDay(d)][getHours(d)]++; });
      setHeatmap(mat);

      const evtViewMap: Record<string, number>  = {};
      const evtClickMap: Record<string, number> = {};
      rows.forEach(r => { if (r.affiliate_event_id) evtViewMap[r.affiliate_event_id] = (evtViewMap[r.affiliate_event_id] ?? 0) + 1; });
      clickRows.forEach(r => { if (r.affiliate_event_id) evtClickMap[r.affiliate_event_id] = (evtClickMap[r.affiliate_event_id] ?? 0) + 1; });
      const top = evts
        .map((e: any) => {
          const views = evtViewMap[e.id] ?? 0;
          const clicks = evtClickMap[e.id] ?? 0;
          return { id: e.id, name: e.name, event_date: e.event_date, views, clicks, ctr: views > 0 ? (clicks / views) * 100 : 0, venue_name: e.affiliate_venues?.name ?? null };
        })
        .filter((e: any) => e.views > 0 || e.clicks > 0)
        .sort((a: any, b: any) => b.views - a.views)
        .slice(0, 10);
      setTopEvents(top);

      const campMap: Record<string, CampaignRow> = {};
      rows.forEach(r => {
        if (!r.utm_source && !r.utm_medium && !r.utm_campaign) return;
        const key = `${r.utm_source ?? ''}|${r.utm_medium ?? ''}|${r.utm_campaign ?? ''}`;
        campMap[key] = campMap[key] ?? { source: r.utm_source ?? '—', medium: r.utm_medium ?? '—', campaign: r.utm_campaign ?? '—', views: 0, clicks: 0 };
        campMap[key].views++;
      });
      clickRows.forEach(r => {
        if (!r.utm_source && !r.utm_medium && !r.utm_campaign) return;
        const key = `${r.utm_source ?? ''}|${r.utm_medium ?? ''}|${r.utm_campaign ?? ''}`;
        campMap[key] = campMap[key] ?? { source: r.utm_source ?? '—', medium: r.utm_medium ?? '—', campaign: r.utm_campaign ?? '—', views: 0, clicks: 0 };
        campMap[key].clicks++;
      });
      setCampaigns(Object.values(campMap).sort((a, b) => (b.views + b.clicks) - (a.views + a.clicks)).slice(0, 10));

    } finally {
      setDataLoading(false);
    }
  }, [identity, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (pillar !== 'rapport' || !identity) return;
    (async () => {
      setRapportLoading(true);
      const now = new Date();
      const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const prevEnd   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [
        { data: thisS }, { data: prevS },
        { data: thisC }, { data: prevC },
      ] = await Promise.all([
        supabase.from('affiliate_visitor_sessions').select('visitor_id').eq('affiliate_id', identity.affiliateId).eq('is_internal', false).gte('visited_at', thisStart).limit(5000),
        supabase.from('affiliate_visitor_sessions').select('visitor_id').eq('affiliate_id', identity.affiliateId).eq('is_internal', false).gte('visited_at', prevStart).lt('visited_at', prevEnd).limit(5000),
        supabase.from('affiliate_clicks').select('id', { count: 'exact', head: true }).eq('affiliate_id', identity.affiliateId).eq('is_internal', false).gte('clicked_at', thisStart),
        supabase.from('affiliate_clicks').select('id', { count: 'exact', head: true }).eq('affiliate_id', identity.affiliateId).eq('is_internal', false).gte('clicked_at', prevStart).lt('clicked_at', prevEnd),
      ]);
      setThisMonth({ views: thisS?.length ?? 0, unique: new Set((thisS ?? []).map((r: any) => r.visitor_id).filter(Boolean)).size, clicks: (thisC as any) ?? 0 });
      setPrevMonth({ views: prevS?.length ?? 0, unique: new Set((prevS ?? []).map((r: any) => r.visitor_id).filter(Boolean)).size, clicks: (prevC as any) ?? 0 });
      setRapportLoading(false);
    })();
  }, [pillar, identity]);

  useEffect(() => {
    if (!identity) return;
    const interval = setInterval(async () => {
      const fiveMinAgo = subMinutes(new Date(), 5).toISOString();
      let pingQuery = supabase.from('affiliate_live_pings').select('session_id').eq('affiliate_id', identity.affiliateId).gte('last_seen', fiveMinAgo);
      if (identity.role === 'member' && identity.memberId) {
        pingQuery = pingQuery.eq('affiliate_member_id', identity.memberId);
      }
      const { data } = await pingQuery;
      setKpis(prev => ({ ...prev, liveNow: (data ?? []).length }));
    }, 30000);
    return () => clearInterval(interval);
  }, [identity]);

  if (identityLoading) return <AffSpinner />;

  if (!identity) {
    return (
      <AffPage>
        <AffEmpty icon={BarChart3} title={t('aff.ana.noAccountTitle')} description={t('aff.ana.noAccountDesc')} />
      </AffPage>
    );
  }

  const PERIODS: Period[]    = ['7d', '30d', '90d', 'all'];
  const maxSourceViews       = Math.max(...sources.map(s => s.views), 1);
  const totalDeviceViews     = devices.reduce((s, d) => s + d.views, 0);

  const PILLARS: { id: Pillar; label: string; icon: any }[] = [
    { id: 'overview',  label: t('aff.ana.pillarOverview'),  icon: LayoutGrid },
    { id: 'audience',  label: t('aff.ana.pillarAudience'),  icon: Users },
    { id: 'events',    label: t('aff.ana.pillarEvents'),    icon: TrendingUp },
    { id: 'campaigns', label: t('aff.ana.pillarCampaigns'), icon: Zap },
    { id: 'rapport',   label: t('aff.ana.pillarReport'),    icon: FileBarChart },
  ];

  const sectionLabel = (txt: string) => (
    <span style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{txt}</span>
  );

  return (
    <AffPage>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title="Analytics"
          subtitle={identity.role === 'member' ? t('aff.ana.subtitleMember') : t('aff.ana.subtitleAdmin')}
          right={
            <div className="flex items-center gap-2 rounded-full px-3 py-2" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <div className="relative">
                <div className="h-2 w-2 rounded-full" style={{ background: POS }} />
                <div className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-70" style={{ background: POS }} />
              </div>
              <span className="tabular-nums" style={{ color: POS, fontSize: 13.5, fontWeight: 600 }}>{kpis.liveNow}</span>
              <span className="hidden sm:inline" style={{ color: POS, opacity: 0.7, fontSize: 11.5 }}>{t('aff.ana.online')}</span>
            </div>
          }
        />
      </motion.div>

      {/* Member no-slug notice */}
      {identity.role === 'member' && !identity.memberSlug && (
        <div className="rounded-2xl px-4 py-3.5" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)' }}>
          <p style={{ color: WARN, fontSize: 13 }}><strong>{t('aff.ana.noSlugStrong')}</strong> {t('aff.ana.noSlugRest')}</p>
        </div>
      )}

      {/* Period filter */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
        {PERIODS.map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
            style={period === p ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` } : { color: T3 }}>
            {t(PERIOD_LABELS[p])}
          </button>
        ))}
      </div>

      {dataLoading ? (
        <AffSpinner />
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard icon={Eye} label={t('aff.ana.totalViews')} value={kpis.totalViews.toLocaleString()} tone="red" />
            <KpiCard icon={Users} label={t('aff.ana.uniqueVisitors')} value={kpis.uniqueVisitors.toLocaleString()} />
            <KpiCard icon={MousePointerClick} label={t('aff.ana.ticketClicks')} value={kpis.totalClicks.toLocaleString()} />
            <KpiCard icon={TrendingUp} label={t('aff.ana.clickRate')} value={fmtPct(kpis.clickRate)} tone="pos" />
            <KpiCard icon={Repeat2} label={t('aff.ana.returningVisitors')} value={fmtPct(kpis.returningRate)} />
            <KpiCard icon={Clock} label={t('aff.ana.avgDuration')} value={fmtDuration(kpis.avgDurationSeconds)} />
            <KpiCard icon={Activity} label={t('aff.ana.avgScroll')} value={`${kpis.avgScrollDepth}%`} />
            <KpiCard icon={Link2} label={t('aff.ana.linktreeViews')} value={kpis.linktreeViews.toLocaleString()} />
          </div>

          {/* Trafic apporté par Yuno — l'app amène des visiteurs sans action de l'agence */}
          {kpis.totalViews > 0 && (
            <AffCard padding={16}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <img src="/yuno-icon-192.png" alt="Yuno" className="w-8 h-8 rounded-lg flex-none" />
                  <div className="min-w-0">
                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('aff.ana.yunoTrafficTitle')}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                      {t('aff.ana.yunoTrafficDesc')}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-none">
                  <span className="tabular-nums" style={{ color: RED, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    {fmtPct(kpis.yunoShare)}
                  </span>
                  <p style={{ color: T3, fontSize: 10.5 }}>{t('aff.ana.yunoTrafficShare')}</p>
                </div>
              </div>
            </AffCard>
          )}

          {/* Linktree score + funnel */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AffCard padding={20}>
              <div className="flex items-center gap-2 mb-4">
                {sectionLabel(t('aff.ana.linktreeScore'))}
                <div className="group relative">
                  <Info className="h-3.5 w-3.5 cursor-help" style={{ color: T3 }} />
                  <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block text-xs px-2 py-1.5 rounded z-10"
                    style={{ background: '#1a1a1d', border: `1px solid ${BORDER}`, color: T2, width: 208 }}>
                    {t('aff.ana.scoreTooltip')}
                  </div>
                </div>
              </div>
              <LinktreeScore kpis={kpis} />
            </AffCard>

            <AffCard padding={20}>
              <div className="mb-4">{sectionLabel(t('aff.ana.funnel'))}</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Eye className="h-4 w-4" style={{ color: RED }} />
                    <span style={{ color: T3, fontSize: 11 }}>{t('aff.ana.views')}</span>
                  </div>
                  <div className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640 }}>{kpis.totalViews.toLocaleString()}</div>
                  <div style={{ color: T3, fontSize: 11, marginTop: 1 }}>100%</div>
                </div>
                <ArrowRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
                <div className="flex-1 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <MousePointerClick className="h-4 w-4" style={{ color: C_HI }} />
                    <span style={{ color: T3, fontSize: 11 }}>{t('aff.ana.clicks')}</span>
                  </div>
                  <div className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640 }}>{kpis.totalClicks.toLocaleString()}</div>
                  <div className="tabular-nums" style={{ color: POS, fontSize: 11, marginTop: 1, fontWeight: 600 }}>{fmtPct(kpis.clickRate)}</div>
                </div>
              </div>
            </AffCard>
          </div>

          {/* Trend chart */}
          <AffCard padding={20}>
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('aff.ana.dailyChartTitle')}</h2>
              <span style={{ color: T3, fontSize: 11 }}>{t('aff.ana.independentScales')}</span>
            </div>
            {daily.every(d => d.views === 0 && d.clicks === 0) ? (
              <div className="text-center py-8" style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noDataPeriod')}</div>
            ) : <DualChart data={daily} />}
          </AffCard>

          {/* Pillar tabs */}
          <div className="overflow-x-auto">
            <TabBar<Pillar> tabs={PILLARS} active={pillar} onChange={setPillar} />
          </div>

          {/* ── Overview ── */}
          {pillar === 'overview' && (
            <div className="space-y-4">
              <AffCard padding={0}>
                <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.acquisitionSources')}</h2>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('aff.ana.acquisitionSubtitle')}</p>
                </div>
                {sources.length === 0 ? (
                  <div className="text-center py-8" style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noDataYet')}</div>
                ) : (
                  <div className="px-5 divide-y" style={{ borderColor: F_BORDER }}>
                    {sources.map(row => {
                      const meta = SOURCE_META[row.category];
                      const Icon = meta?.icon ?? Globe;
                      const label = meta ? t(meta.label) : row.category;
                      return (
                        <div key={row.category} className="flex items-center gap-3 py-2.5">
                          <div className="flex items-center gap-2 flex-none" style={{ width: 144 }}>
                            <Icon className="h-3.5 w-3.5 flex-none" style={{ color: T2 }} />
                            <span className="truncate" style={{ color: T2, fontSize: 11.5 }}>{label}</span>
                          </div>
                          <div className="flex-1">
                            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${(row.views / maxSourceViews) * 100}%`, background: RED, opacity: 0.85 }} />
                            </div>
                          </div>
                          <div className="text-right tabular-nums" style={{ color: T1, fontSize: 11.5, fontWeight: 600, width: 32 }}>{row.views}</div>
                          <div className="text-right flex items-center justify-end gap-0.5 tabular-nums" style={{ color: T3, fontSize: 11.5, width: 48 }}>
                            <MousePointerClick className="h-3 w-3" />{row.clicks}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </AffCard>

              <AffCard padding={0}>
                <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.devicesTitle')}</h2>
                </div>
                {devices.length === 0 ? (
                  <div className="text-center py-8" style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noDataYet')}</div>
                ) : (
                  <div className="divide-y" style={{ borderColor: F_BORDER }}>
                    {devices.map(({ device, views }) => {
                      const meta = DEVICE_META[device];
                      const Icon = meta?.icon ?? Monitor;
                      const label = meta ? t(meta.label) : device;
                      const pct = totalDeviceViews > 0 ? (views / totalDeviceViews) * 100 : 0;
                      return (
                        <div key={device} className="flex items-center gap-4 px-5 py-3.5">
                          <Icon className="h-4 w-4 flex-none" style={{ color: T2 }} />
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1.5">
                              <span style={{ color: T1, fontSize: 13 }}>{label}</span>
                              <span className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{views.toLocaleString()}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C_HI }} />
                            </div>
                          </div>
                          <span className="text-right tabular-nums" style={{ color: T3, fontSize: 11, width: 40 }}>{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </AffCard>

              <AffCard padding={20}>
                <div className="flex items-center justify-between mb-4">
                  <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.peakHours')}</h2>
                  <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
                    <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(232,25,44,0.18)' }} />
                    <span>{t('aff.ana.low')}</span>
                    <div className="w-3 h-3 rounded-sm" style={{ background: RED }} />
                    <span>{t('aff.ana.high')}</span>
                  </div>
                </div>
                {heatmap.every(row => row.every(v => v === 0)) ? (
                  <div className="text-center py-4" style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noDataYet')}</div>
                ) : <HeatmapChart matrix={heatmap} />}
                <p style={{ color: T3, fontSize: 11, marginTop: 12 }}>{t('aff.ana.heatmapNote')}</p>
              </AffCard>
            </div>
          )}

          {/* ── Audience ── */}
          {pillar === 'audience' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <KpiCard icon={Users} label={t('aff.ana.newVisitors')} value={kpis.newVisitors.toLocaleString()} />
                <KpiCard icon={Repeat2} label={t('aff.ana.returningVisitors')} value={kpis.returningVisitors.toLocaleString()} tone="red" />
              </div>

              <AffCard padding={20}>
                <h2 style={{ color: T1, fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{t('aff.ana.scrollDepthTitle')}</h2>
                <p style={{ color: T3, fontSize: 11.5, marginBottom: 16 }}>{t('aff.ana.scrollDepthSubtitle')}</p>
                <ScrollDepthGauge avg={kpis.avgScrollDepth} />
                <p style={{ color: T3, fontSize: 11, marginTop: 12 }}>
                  {kpis.avgScrollDepth >= 70 ? t('aff.ana.scrollAdviceHigh') :
                   kpis.avgScrollDepth >= 40 ? t('aff.ana.scrollAdviceMid') :
                   t('aff.ana.scrollAdviceLow')}
                </p>
              </AffCard>

              <AffCard padding={20}>
                <h2 style={{ color: T1, fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{t('aff.ana.sessionDuration')}</h2>
                <p style={{ color: T3, fontSize: 11.5, marginBottom: 16 }}>{t('aff.ana.sessionDurationSubtitle')}</p>
                {allSessions.length === 0 ? (
                  <div className="text-center py-4" style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noDataYet')}</div>
                ) : <DurationHistogram sessions={allSessions} />}
              </AffCard>

              <AffCard padding={0}>
                <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.pagesVisited')}</h2>
                </div>
                <div className="divide-y" style={{ borderColor: F_BORDER }}>
                  {(['linktree', 'member_linktree', 'event_page', 'venue_page'] as const).map(type => {
                    const count = allSessions.filter(s => s.entry_page_type === type).length;
                    if (count === 0) return null;
                    const labels: Record<string, string> = {
                      linktree: 'aff.ana.pageTypeLinktree',
                      member_linktree: 'aff.ana.pageTypeMemberLinktree',
                      event_page: 'aff.ana.pageTypeEvent',
                      venue_page: 'aff.ana.pageTypeVenue',
                    };
                    const pct = allSessions.length > 0 ? (count / allSessions.length) * 100 : 0;
                    return (
                      <div key={type} className="flex items-center gap-4 px-5 py-3.5">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1.5">
                            <span style={{ color: T2, fontSize: 13 }}>{t(labels[type])}</span>
                            <span className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{count.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: RED, opacity: 0.7 }} />
                          </div>
                        </div>
                        <span className="text-right tabular-nums" style={{ color: T3, fontSize: 11, width: 40 }}>{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </AffCard>
            </div>
          )}

          {/* ── Events ── */}
          {pillar === 'events' && (
            <div className="space-y-4">
              <AffCard padding={0}>
                <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.eventPerfTitle')}</h2>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('aff.ana.eventPerfSubtitle')}</p>
                </div>
                {topEvents.length === 0 ? (
                  <div className="text-center py-8" style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noDataYet')}</div>
                ) : (
                  <div className="divide-y" style={{ borderColor: F_BORDER }}>
                    {topEvents.map((e, i) => (
                      <div key={e.id} className="flex items-center gap-4 px-5 py-3.5">
                        <span className="flex-none tabular-nums" style={{ color: T3, fontSize: 13, fontWeight: 700, width: 20 }}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{e.name}</p>
                          <p style={{ color: T3, fontSize: 11 }}>{e.venue_name ?? '—'} · {e.event_date}</p>
                          <div className="mt-1.5 h-1 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(e.ctr, 50) / 50 * 100}%`, background: `linear-gradient(90deg,${C_MID},${POS})` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-none">
                          <div className="flex items-center gap-1 tabular-nums" style={{ fontSize: 11.5 }}>
                            <Eye className="h-3 w-3" style={{ color: RED }} /><span style={{ color: T1, fontWeight: 600 }}>{e.views}</span>
                          </div>
                          <div className="flex items-center gap-1 tabular-nums" style={{ fontSize: 11.5 }}>
                            <MousePointerClick className="h-3 w-3" style={{ color: C_HI }} /><span style={{ color: T1, fontWeight: 600 }}>{e.clicks}</span>
                          </div>
                          <span className="tabular-nums" style={{ color: POS, fontSize: 11.5, fontWeight: 600 }}>{fmtPct(e.ctr)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AffCard>

              {identity.role === 'admin' && topEvents.length > 0 && (
                <div className="rounded-2xl p-4" style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.2)' }}>
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 flex-none mt-0.5" style={{ color: WARN }} />
                    <div>
                      <p style={{ color: WARN, fontSize: 13, fontWeight: 600 }}>{t('aff.ana.noTrafficTitle')}</p>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                        {t('aff.ana.noTrafficBody')} <strong style={{ color: T2 }}>{t('aff.ana.noTrafficPath')}</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Campaigns ── */}
          {pillar === 'campaigns' && (
            <div className="space-y-4">
              <AffCard padding={16}>
                <div className="mb-2">{sectionLabel(t('aff.ana.howToUse'))}</div>
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('aff.ana.utmIntro')}</p>
                <div className="mt-2 rounded-lg px-3 py-2 break-all" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, fontFamily: 'monospace', fontSize: 11.5, color: T2 }}>
                  {`${window.location.origin}/p/${t('aff.ana.exampleSlug')}`}<span style={{ color: RED }}>?utm_source=instagram&utm_medium=bio&utm_campaign=noel2025</span>
                </div>
              </AffCard>

              <AffCard padding={0}>
                <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.utmTableTitle')}</h2>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('aff.ana.utmTableSubtitle')}</p>
                </div>
                {campaigns.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Zap className="h-8 w-8 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.14)' }} />
                    <p style={{ color: T3, fontSize: 13 }}>{t('aff.ana.noUtm')}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                          <th className="text-left px-5 py-3 font-medium" style={{ color: T3 }}>{t('aff.ana.thSource')}</th>
                          <th className="text-left px-3 py-3 font-medium" style={{ color: T3 }}>{t('aff.ana.thMedium')}</th>
                          <th className="text-left px-3 py-3 font-medium hidden sm:table-cell" style={{ color: T3 }}>{t('aff.ana.thCampaign')}</th>
                          <th className="text-right px-3 py-3 font-medium" style={{ color: T3 }}>{t('aff.ana.views')}</th>
                          <th className="text-right px-5 py-3 font-medium" style={{ color: T3 }}>{t('aff.ana.clicks')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map((c, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                            <td className="px-5 py-3 font-medium" style={{ color: T1 }}>{c.source}</td>
                            <td className="px-3 py-3" style={{ color: T2 }}>{c.medium}</td>
                            <td className="px-3 py-3 max-w-[120px] truncate hidden sm:table-cell" style={{ color: T2 }}>{c.campaign}</td>
                            <td className="px-3 py-3 text-right">
                              <span className="inline-flex items-center gap-1 tabular-nums" style={{ color: T1, fontWeight: 600 }}><Eye className="h-3 w-3" style={{ color: RED }} />{c.views}</span>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <span className="inline-flex items-center gap-1 tabular-nums" style={{ color: T1, fontWeight: 600 }}><MousePointerClick className="h-3 w-3" style={{ color: C_HI }} />{c.clicks}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </AffCard>

              <AffCard padding={16}>
                <div className="mb-2">{sectionLabel(t('aff.ana.trackQr'))}</div>
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                  {t('aff.ana.qrTipBefore')} <code style={{ color: RED }}>?utm_medium=qr&utm_source=flyer</code> {t('aff.ana.qrTipAfter')}
                </p>
              </AffCard>
            </div>
          )}

          {/* ── Rapport ── */}
          {pillar === 'rapport' && (() => {
            const now = new Date();
            const thisMonthLabel = format(now, 'MMMM yyyy', { locale: dateLocale });
            const prevMonthLabel = format(new Date(now.getFullYear(), now.getMonth() - 1, 1), 'MMMM yyyy', { locale: dateLocale });

            const thisCTR = thisMonth.views > 0 ? ((thisMonth.clicks / thisMonth.views) * 100).toFixed(1) : '0';
            const prevCTR = prevMonth.views > 0 ? ((prevMonth.clicks / prevMonth.views) * 100).toFixed(1) : '0';

            const delta = (curr: number, prev: number) => {
              if (prev === 0) return curr > 0 ? '+∞%' : '—';
              const pct = ((curr - prev) / prev * 100).toFixed(0);
              return `${+pct > 0 ? '+' : ''}${pct}%`;
            };

            const rows = [
              { label: t('aff.ana.totalViews'), curr: thisMonth.views, prev: prevMonth.views },
              { label: t('aff.ana.uniqueVisitors'), curr: thisMonth.unique, prev: prevMonth.unique },
              { label: t('aff.ana.clicksTotal'), curr: thisMonth.clicks, prev: prevMonth.clicks },
            ];

            if (rapportLoading) return <AffSpinner />;

            const deltaRow = (label: string, curr: number, prev: number, currLabel: string, prevLabel: string, up: boolean) => (
              <div className="flex items-center justify-between py-3">
                <span style={{ color: T2, fontSize: 13 }}>{label}</span>
                <div className="flex items-center gap-4">
                  <span className="text-right tabular-nums" style={{ color: T3, fontSize: 11, width: 56 }}>{prevLabel}</span>
                  <span className="text-right tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 700, width: 48 }}>{currLabel}</span>
                  <span className="flex items-center justify-end gap-0.5 tabular-nums" style={{ color: up ? POS : NEG_C, fontSize: 11, fontWeight: 600, width: 56 }}>
                    {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {delta(curr, prev)}
                  </span>
                </div>
              </div>
            );

            return (
              <div className="space-y-4">
                <AffCard padding={20}>
                  <h2 className="capitalize" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{thisMonthLabel}</h2>
                  <p style={{ color: T3, fontSize: 11.5 }}>vs {prevMonthLabel}</p>
                  <div className="mt-4 divide-y" style={{ borderColor: F_BORDER }}>
                    {rows.map(r => deltaRow(r.label, r.curr, r.prev, String(r.curr), `${r.prev} ${t('aff.ana.prevAbbrev')}`, r.curr >= r.prev))}
                    {deltaRow('CTR', Math.round(parseFloat(thisCTR) * 10), Math.round(parseFloat(prevCTR) * 10), `${thisCTR}%`, `${prevCTR}% ${t('aff.ana.prevAbbrev')}`, parseFloat(thisCTR) >= parseFloat(prevCTR))}
                  </div>
                </AffCard>

                {topEvents.length > 0 && (
                  <AffCard padding={0}>
                    <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('aff.ana.topEvents')}</h2>
                    </div>
                    <div className="divide-y" style={{ borderColor: F_BORDER }}>
                      {topEvents.slice(0, 3).map((ev, i) => (
                        <div key={ev.id} className="flex items-center gap-3 px-5 py-3">
                          <span className="flex-none tabular-nums" style={{ color: T3, fontSize: 11, width: 16 }}>#{i + 1}</span>
                          <p className="flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{ev.name}</p>
                          <div className="flex items-center gap-3 flex-none tabular-nums" style={{ fontSize: 11.5 }}>
                            <span className="flex items-center gap-1" style={{ color: T2 }}><Eye className="h-3 w-3" />{ev.views}</span>
                            <span className="flex items-center gap-1" style={{ color: T2 }}><MousePointerClick className="h-3 w-3" />{ev.clicks}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AffCard>
                )}

                {thisMonth.views === 0 && (
                  <AffEmpty icon={FileBarChart} title={t('aff.ana.noDataMonth')} />
                )}
              </div>
            );
          })()}
        </>
      )}
    </AffPage>
  );
}
