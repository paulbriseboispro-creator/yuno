import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Users, Eye, Clock, TrendingDown, TrendingUp, Smartphone, Tablet, Monitor, Globe, Share2, MapPin, LogOut, FileText,
  LayoutGrid, Radar, Compass, ShoppingBag, Ticket, Crown, Wine, Languages, AppWindow, Activity, UserPlus, Bell, RefreshCw, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  AdminPage, Card, Stat, SectionHeading, PeriodFilter, Btn, Pill, LiveBadge, DistRow, RankRow, ProgressBar, EmptyState,
  ErrorState, PageSkeleton, Reveal, Dot, INNER_BG, RED, POS, WARN, T1, T2, T3, F_BORDER, C_MID, CHART, RECHARTS_TOOLTIP,
} from '@/components/admin/ui';
import { fmtNum, fmtEur, fmtPct, fmtAxisDay, deltaPct, fmtDate } from '@/lib/adminFormat';

// ─── Payloads serveur ────────────────────────────────────────────────────────
interface TrafficStats {
  granularity: 'hour' | 'day';
  totals: { visitors: number; sessions: number; pageviews: number; avg_session_seconds: number; bounce_rate: number; native_sessions: number; authed_sessions: number };
  series: { t: string; visitors: number; sessions: number; pageviews: number }[];
  channels: { channel: string; sessions: number; visitors: number }[];
  referrers: { host: string; sessions: number }[];
  campaigns: { campaign: string; source: string | null; sessions: number }[];
  pages: { path: string; views: number; sessions: number; avg_seconds: number | null }[];
  groups: { grp: string; views: number; sessions: number }[];
  entries: { path: string; sessions: number }[];
  exits: { path: string; sessions: number }[];
  devices: { k: string; n: number }[]; browsers: { k: string; n: number }[]; os: { k: string; n: number }[];
  countries: { k: string; n: number }[]; languages: { k: string; n: number }[];
  funnel: { sessions: number; event_views: number; checkouts: number; purchases: number };
  sales: { tickets: { n: number; revenue: number }; tables: { n: number; revenue: number }; drinks: { n: number; revenue: number } };
}
interface LiveStats { count: number; native: number; last30m: number; pages: { path: string | null; device: string | null; country: string | null; is_native: boolean; seconds_ago: number }[] }
interface SignupStats { total: number; total_client: number; total_pro: number; new_7d: number; new_30d: number; prev_30d: number; first_signup_at: string | null; by_day: { d: string; n: number; client: number; pro: number }[]; by_month: { m: string; n: number }[] }
interface CockpitLite { since_launch: { installs_client: number; installs_pro: number; active_devices_7d: number; push_subscriptions: number }; series: { d: string; installs: number; sessions: number }[]; ota: { app_id: string; latest: string | null; devices: number; on_latest: number; adoption_pct: number; active_7d: number }[] }

type Period = '1' | '7' | '28' | '90';
const CHANNEL_KEYS = new Set(['direct', 'search', 'social', 'paid', 'push', 'affiliate', 'email', 'campaign', 'referral']);
const GROUP_KEYS = new Set(['home', 'explore', 'event', 'venue', 'browse', 'checkout', 'purchase', 'dj', 'other']);
const DEVICE_ICONS: Record<string, LucideIcon> = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

function Funnel({ funnel, t }: { funnel: TrafficStats['funnel']; t: (k: string) => string }) {
  const steps = [
    { label: t('adminTraffic.stepSessions'), value: funnel.sessions },
    { label: t('adminTraffic.stepEvent'), value: funnel.event_views },
    { label: t('adminTraffic.stepCheckout'), value: funnel.checkouts },
    { label: t('adminTraffic.stepPurchase'), value: funnel.purchases },
  ];
  const top = steps[0].value || 1;
  const transitions = steps.slice(1).map((s, i) => ({ idx: i + 1, from: steps[i].label, to: s.label, dropPct: steps[i].value > 0 ? ((steps[i].value - s.value) / steps[i].value) * 100 : 0 }));
  const worst = transitions.length ? transitions.reduce((a, b) => (b.dropPct > a.dropPct ? b : a)) : null;
  return (
    <div className="space-y-4">
      {worst && worst.dropPct > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.24)' }}>
          <TrendingDown className="h-4 w-4 flex-none" style={{ color: RED }} />
          <span style={{ color: T2, fontSize: 12.5 }}>{t('adminTraffic.biggestLeak')}: <span className="inline-flex items-center gap-1" style={{ color: T1, fontWeight: 600 }}>{worst.from}<ChevronRight className="h-3 w-3" style={{ opacity: 0.6 }} />{worst.to}</span></span>
          <span className="tabular-nums ml-auto" style={{ color: RED, fontWeight: 700, fontSize: 14 }}>−{worst.dropPct.toFixed(0)}%</span>
        </div>
      )}
      {steps.map((step, i) => {
        const tr = i > 0 ? transitions[i - 1] : null;
        const isWorst = !!(worst && tr && tr.idx === worst.idx);
        return (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
              <span style={{ color: T2 }}>{step.label}</span>
              <span className="flex items-center gap-2">
                {tr && tr.dropPct > 0 && <Pill size="xs" tone={isWorst ? 'hot' : 'muted'} title={t('adminTraffic.vsPrevStep')}>−{tr.dropPct.toFixed(0)}%</Pill>}
                <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{fmtNum(step.value)} <span style={{ color: T3, fontWeight: 400 }}>({fmtPct((step.value / top) * 100)})</span></span>
              </span>
            </div>
            <ProgressBar pct={(step.value / top) * 100} height={10} />
          </div>
        );
      })}
    </div>
  );
}

export default function AdminGrowth() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [period, setPeriod] = useState<Period>('7');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TrafficStats | null>(null);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [signups, setSignups] = useState<SignupStats | null>(null);
  const [cockpit, setCockpit] = useState<CockpitLite | null>(null);

  const fetchLive = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_platform_traffic_live' as never);
    if (!e && data) setLive(data as unknown as LiveStats);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    const now = new Date();
    const from = new Date(now); from.setDate(from.getDate() - (period === '1' ? 0 : parseInt(period))); from.setHours(0, 0, 0, 0);
    const to = new Date(now); to.setHours(23, 59, 59, 999);
    const [tr, su, ck] = await Promise.all([
      supabase.rpc('get_platform_traffic' as never, { p_from: from.toISOString(), p_to: to.toISOString() } as never),
      supabase.rpc('admin_signup_stats' as never, { p_from: from.toISOString(), p_to: to.toISOString() } as never),
      supabase.rpc('admin_cockpit' as never, { p_include_demo: includeDemo } as never),
    ]);
    if (tr.error) setError(tr.error.message);
    setStats(tr.error ? null : (tr.data as unknown as TrafficStats));
    if (!su.error) setSignups(su.data as unknown as SignupStats);
    if (!ck.error) setCockpit(ck.data as unknown as CockpitLite);
    setLoading(false);
  }, [period, includeDemo]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { fetchLive(); const id = window.setInterval(fetchLive, 30_000); return () => clearInterval(id); }, [fetchLive]);

  const totals = stats?.totals;
  const hasData = !!totals && totals.sessions > 0;
  const isHourly = stats?.granularity === 'hour';
  const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  const pctOf = (n: number, total: number) => fmtPct(total > 0 ? (n / total) * 100 : 0);
  const channelLabel = (c: string) => (CHANNEL_KEYS.has(c) ? t(`adminTraffic.ch_${c}`) : c);
  const groupLabel = (g: string) => (GROUP_KEYS.has(g) || g === 'promo-link' ? t(`adminTraffic.sec_${g === 'promo-link' ? 'promo' : g}`) : g);
  const deviceLabel = (d: string) => (d === 'mobile' || d === 'tablet' || d === 'desktop' ? t(`adminTraffic.dev_${d}`) : t('adminTraffic.dev_unknown'));

  const seriesData = useMemo(() => (stats?.series ?? []).map((p) => ({ t: format(new Date(p.t), isHourly ? 'HH:mm' : 'dd/MM'), visitors: p.visitors, sessions: p.sessions, pageviews: p.pageviews })), [stats, isHourly]);
  const growthSeries = useMemo(() => {
    const byDay = new Map<string, { d: string; client: number; pro: number; installs: number; sessions: number }>();
    for (const s of cockpit?.series ?? []) byDay.set(s.d, { d: s.d, client: 0, pro: 0, installs: s.installs, sessions: s.sessions });
    for (const s of signups?.by_day ?? []) { const r = byDay.get(s.d); if (r) { r.client = s.client; r.pro = s.pro; } }
    return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)).map((r) => ({ ...r, label: fmtAxisDay(r.d, language) }));
  }, [cockpit, signups, language]);
  const xInterval = isHourly ? 3 : period === '90' ? 6 : period === '28' ? 2 : 0;
  const sl = cockpit?.since_launch;
  const salesN = stats ? stats.sales.tickets.n + stats.sales.tables.n + stats.sales.drinks.n : 0;
  const salesRev = stats ? stats.sales.tickets.revenue + stats.sales.tables.revenue + stats.sales.drinks.revenue : 0;
  const mx = (arr: { n?: number; sessions?: number; views?: number }[], k: 'n' | 'sessions' | 'views') => Math.max(1, ...arr.map((x) => Number(x[k] ?? 0)));

  const header = (
    <>
      {includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}
      <LiveBadge count={live?.count ?? 0} label={t('adminTraffic.liveNow')} />
      <PeriodFilter<Period> value={period} onChange={setPeriod} options={[{ key: '1', label: t('adminTraffic.periodToday') }, { key: '7', label: t('adminTraffic.days7') }, { key: '28', label: t('adminTraffic.days28') }, { key: '90', label: t('adminTraffic.days90') }]} />
      <Btn onClick={fetchAll} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>
    </>
  );

  if (loading && !stats && !signups) return <AdminPage eyebrow={t('adm.growth.eyebrow')} title={t('adm.growth.title')} subtitle={t('adm.growth.subtitle')} actions={header}><PageSkeleton tiles={4} blocks={3} /></AdminPage>;

  return (
    <AdminPage eyebrow={t('adm.growth.eyebrow')} title={t('adm.growth.title')} subtitle={t('adm.growth.subtitle')} actions={header}>
      {/* 01 · Comptes & installs */}
      <Reveal>
        <SectionHeading n={1} label={t('adm.growth.accounts')} icon={UserPlus} accent />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Stat label={t('adm.growth.totalAccounts')} value={fmtNum(signups?.total ?? 0, language)} icon={Users} highlight sub={t('adm.growth.split').replace('{c}', fmtNum(signups?.total_client ?? 0, language)).replace('{p}', fmtNum(signups?.total_pro ?? 0, language))} spark={(signups?.by_day ?? []).slice(-14).map((d) => d.n)} sparkAccent />
          <Stat label={t('adm.growth.new30')} value={fmtNum(signups?.new_30d ?? 0, language)} icon={UserPlus} delta={signups ? deltaPct(signups.new_30d, signups.prev_30d) : null} deltaVs={t('adm.growth.vsPrev30')} sub={`${t('adm.growth.new7')}: ${fmtNum(signups?.new_7d ?? 0, language)}`} />
          <Stat label={t('adm.growth.installs')} value={fmtNum((sl?.installs_client ?? 0) + (sl?.installs_pro ?? 0), language)} icon={Smartphone} sub={t('adm.growth.installsSplit').replace('{c}', fmtNum(sl?.installs_client ?? 0, language)).replace('{p}', fmtNum(sl?.installs_pro ?? 0, language))} spark={(cockpit?.series ?? []).slice(-14).map((d) => d.installs)} />
          <Stat label={t('adm.growth.activeDevices')} value={fmtNum(sl?.active_devices_7d ?? 0, language)} icon={Bell} sub={`${t('adm.growth.pushOn')}: ${fmtNum(sl?.push_subscriptions ?? 0, language)}`} />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
          <Card title={t('adm.growth.chart')} subtitle={t('adm.growth.chartHint')} icon={TrendingUp} className="xl:col-span-2">
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growthSeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs><linearGradient id="grw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RED} stopOpacity={0.3} /><stop offset="1" stopColor={RED} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis yAxisId="acq" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  {/* Les sessions sont deux ordres de grandeur au-dessus des
                      inscriptions : sur une échelle commune, la courbe qui
                      compte serait collée à zéro. */}
                  <YAxis yAxisId="sess" orientation="right" hide />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} />
                  <Area yAxisId="sess" type="monotone" dataKey="sessions" name={t('adm.growth.s.sessions')} stroke={CHART[3]} fill="transparent" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Area yAxisId="acq" type="monotone" dataKey="installs" name={t('adm.growth.s.installs')} stroke={CHART[1]} fill="transparent" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Area yAxisId="acq" type="monotone" dataKey="pro" name={t('adm.growth.s.pro')} stroke={WARN} fill="transparent" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Area yAxisId="acq" type="monotone" dataKey="client" name={t('adm.growth.s.client')} stroke={RED} fill="url(#grw)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
              <span className="inline-flex items-center gap-1.5"><Dot color={RED} />{t('adm.growth.s.client')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={WARN} />{t('adm.growth.s.pro')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[1]} />{t('adm.growth.s.installs')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[3]} />{t('adm.growth.s.sessions')}</span>
            </div>
          </Card>
          <div className="space-y-4">
            <Card title={t('adm.growth.ota')} icon={Smartphone}>
              {(cockpit?.ota ?? []).map((o) => (
                <div key={o.app_id} className="mb-3">
                  <div className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                    <span style={{ color: T1, fontWeight: 560 }}>{o.app_id === 'eu.yunoapp.pro' ? 'Yuno Pro' : 'Yuno'} <span style={{ color: T3 }}>{o.latest ?? '—'}</span></span>
                    <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{fmtPct(o.adoption_pct)}</span>
                  </div>
                  <div className="mt-1.5"><ProgressBar pct={o.adoption_pct} color={o.adoption_pct >= 60 ? POS : o.adoption_pct >= 25 ? WARN : RED} height={5} /></div>
                  <div style={{ color: T3, fontSize: 11, marginTop: 3 }}>{t('adm.growth.otaLine').replace('{n}', fmtNum(o.on_latest, language)).replace('{d}', fmtNum(o.devices, language)).replace('{v}', o.latest ?? '—')}</div>
                </div>
              ))}
              {(cockpit?.ota ?? []).length === 0 && <EmptyState text={t('adm.common.noData')} />}
            </Card>
            <Card title={t('adm.growth.byMonth')} icon={UserPlus}>
              <div style={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(signups?.by_month ?? []).map((m) => ({ ...m, label: m.m.slice(0, 7) }))} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="n" name={t('adm.common.signups')} fill={RED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {signups?.first_signup_at && <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>{t('adm.cockpit.firstSignup').replace('{d}', fmtDate(signups.first_signup_at, language))}</p>}
            </Card>
          </div>
        </div>
      </Reveal>

      {/* 02 · Audience */}
      <Reveal delay={0.1}>
        <SectionHeading n={2} label={t('adm.growth.audience')} icon={Radar} right={<span style={{ color: T3, fontSize: 11.5 }}>{t('adm.growth.audienceNote')}</span>} />
        {error ? <Card className="mt-3"><ErrorState text={error} onRetry={fetchAll} retryLabel={t('adm.common.retry')} /></Card> : !hasData ? (
          <Card className="mt-3"><EmptyState icon={Radar} text={<><strong style={{ color: T1, display: 'block', marginBottom: 4 }}>{t('adminTraffic.emptyTitle')}</strong>{t('adminTraffic.emptyBody')}</>} /></Card>
        ) : (
          <div className="space-y-4 mt-3">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label={t('adminTraffic.visitors')} value={fmtNum(totals!.visitors, language)} icon={Users} highlight spark={seriesData.map((s) => s.visitors)} sparkAccent />
              <Stat label={t('adminTraffic.sessions')} value={fmtNum(totals!.sessions, language)} icon={Activity} spark={seriesData.map((s) => s.sessions)} />
              <Stat label={t('adminTraffic.pageviews')} value={fmtNum(totals!.pageviews, language)} icon={Eye} />
              <Stat label={t('adminTraffic.avgSession')} value={fmtDur(totals!.avg_session_seconds)} icon={Clock} />
            </div>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label={t('adminTraffic.bounceRate')} value={fmtPct(totals!.bounce_rate)} sub={t('adminTraffic.bounceSub')} icon={TrendingDown} />
              <Stat label={t('adminTraffic.appSessions')} value={pctOf(totals!.native_sessions, totals!.sessions)} sub={`${fmtNum(totals!.native_sessions, language)} / ${fmtNum(totals!.sessions, language)}`} icon={AppWindow} />
              <Stat label={t('adminTraffic.loggedSessions')} value={pctOf(totals!.authed_sessions, totals!.sessions)} sub={`${fmtNum(totals!.authed_sessions, language)} / ${fmtNum(totals!.sessions, language)}`} icon={Users} />
              <Stat label={t('adminTraffic.purchases')} value={fmtNum(salesN, language)} sub={fmtEur(salesRev, language)} icon={ShoppingBag} tone={salesN > 0 ? 'pos' : undefined} />
            </div>

            <Card title={t('adminTraffic.chartTitle')} subtitle={t('adminTraffic.chartSub')} icon={TrendingUp}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={seriesData} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                    <defs><linearGradient id="tv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={RED} stopOpacity={0.28} /><stop offset="100%" stopColor={RED} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke={F_BORDER} vertical={false} />
                    <XAxis dataKey="t" axisLine={false} tickLine={false} tickMargin={8} tick={{ fill: T3, fontSize: 10.5 }} interval={xInterval} />
                    <YAxis tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ stroke: F_BORDER }} />
                    <Area type="monotone" dataKey="sessions" name={t('adminTraffic.sessions')} stroke={CHART[2]} strokeWidth={1.5} fill="transparent" dot={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="visitors" name={t('adminTraffic.visitors')} stroke={RED} strokeWidth={2.5} fill="url(#tv)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-2" style={{ fontSize: 11.5, color: T3 }}><span className="inline-flex items-center gap-1.5"><Dot color={RED} />{t('adminTraffic.visitors')}</span><span className="inline-flex items-center gap-1.5"><Dot color={CHART[2]} />{t('adminTraffic.sessions')}</span></div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title={t('adminTraffic.funnelTitle')} subtitle={t('adminTraffic.funnelSub')} icon={Compass} className="lg:col-span-2">
                <Funnel funnel={stats!.funnel} t={t} />
                <div className="mt-5 pt-4 grid grid-cols-3 gap-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  {[{ i: Ticket, l: t('adminTraffic.salesTickets'), s: stats!.sales.tickets }, { i: Crown, l: t('adminTraffic.salesTables'), s: stats!.sales.tables }, { i: Wine, l: t('adminTraffic.salesDrinks'), s: stats!.sales.drinks }].map(({ i: I, l, s }) => (
                    <div key={l}>
                      <p className="flex items-center gap-1.5 m-0" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}><I className="h-3 w-3" /> {l}</p>
                      <p className="tabular-nums mt-1 m-0" style={{ color: T1, fontSize: 17, fontWeight: 640 }}>{fmtNum(s.n, language)}</p>
                      <p className="tabular-nums m-0" style={{ color: T3, fontSize: 11.5 }}>{fmtEur(s.revenue, language)}</p>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title={t('adminTraffic.liveTitle')} subtitle={t('adminTraffic.liveSub')} icon={Radar}>
                {(live?.pages ?? []).length === 0 ? <EmptyState text={t('adminTraffic.liveEmpty')} /> : (
                  <>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {live!.pages.map((p, i) => {
                        const DevIcon = DEVICE_ICONS[p.device ?? ''] ?? Monitor;
                        return (
                          <div key={i} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                            <DevIcon className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
                            <span className="truncate flex-1" style={{ color: T2, fontSize: 12 }}>{p.path || '/'}</span>
                            {p.country && <Pill size="xs" tone="muted">{p.country}</Pill>}
                            {p.is_native && <Pill size="xs" tone="hot">{t('adm.growth.app')}</Pill>}
                            <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 10.5 }}>{p.seconds_ago < 60 ? `${p.seconds_ago}s` : `${Math.floor(p.seconds_ago / 60)}m`}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-center" style={{ color: T3, fontSize: 11 }}>{t('adminTraffic.livePv30').replace('{n}', String(live!.last30m))}{live!.native > 0 && ` · ${live!.native} ${t('adminTraffic.liveInApp')}`}</p>
                  </>
                )}
              </Card>
            </div>

            <SectionHeading n={3} label={t('adminTraffic.acquisition')} icon={Share2} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t('adminTraffic.channelsTitle')} subtitle={t('adminTraffic.channelsSub')} icon={Share2}>
                {stats!.channels.map((c, i) => <DistRow key={c.channel} label={channelLabel(c.channel)} value={fmtNum(c.sessions, language)} sub={pctOf(c.sessions, totals!.sessions)} pct={(c.sessions / mx(stats!.channels, 'sessions')) * 100} color={i === 0 ? undefined : C_MID} />)}
              </Card>
              <Card title={t('adminTraffic.referrersTitle')} icon={Globe}>
                {stats!.referrers.length === 0 ? <EmptyState text={t('adminTraffic.noReferrers')} /> : stats!.referrers.map((r) => <DistRow key={r.host} label={r.host} value={fmtNum(r.sessions, language)} pct={(r.sessions / mx(stats!.referrers, 'sessions')) * 100} color={C_MID} />)}
                {stats!.campaigns.length > 0 && (
                  <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                    <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{t('adminTraffic.campaignsTitle')}</p>
                    {stats!.campaigns.map((c, i) => <div key={i} className="flex items-center justify-between py-1" style={{ fontSize: 12 }}><span className="truncate pr-2" style={{ color: T2 }}>{c.campaign}{c.source ? <span style={{ color: T3 }}> · {c.source}</span> : null}</span><span className="tabular-nums flex-none" style={{ color: T1 }}>{fmtNum(c.sessions, language)}</span></div>)}
                  </div>
                )}
              </Card>
            </div>

            <SectionHeading n={4} label={t('adminTraffic.behavior')} icon={FileText} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t('adminTraffic.topPagesTitle')} subtitle={t('adminTraffic.topPagesSub')} icon={FileText}>
                {stats!.pages.map((p, i) => <RankRow key={p.path} index={i} label={p.path} sub={`${fmtNum(p.sessions, language)} ${t('adminTraffic.sessions').toLowerCase()}${p.avg_seconds ? ` · ${fmtDur(p.avg_seconds)}` : ''}`} value={`${fmtNum(p.views, language)} ${t('adminTraffic.views')}`} pct={(p.views / mx(stats!.pages, 'views')) * 100} leader={i === 0} />)}
              </Card>
              <Card title={t('adminTraffic.sectionsTitle')} subtitle={t('adminTraffic.sectionsSub')} icon={LayoutGrid}>
                {stats!.groups.map((g, i) => <DistRow key={g.grp} label={groupLabel(g.grp)} value={fmtNum(g.views, language)} sub={pctOf(g.views, totals!.pageviews)} pct={(g.views / mx(stats!.groups, 'views')) * 100} color={i === 0 ? undefined : C_MID} />)}
              </Card>
              <Card title={t('adminTraffic.entryTitle')} subtitle={t('adminTraffic.entrySub')} icon={MapPin}>
                {stats!.entries.map((e) => <DistRow key={e.path} label={e.path} value={fmtNum(e.sessions, language)} pct={(e.sessions / mx(stats!.entries, 'sessions')) * 100} />)}
              </Card>
              <Card title={t('adminTraffic.exitTitle')} subtitle={t('adminTraffic.exitSub')} icon={LogOut}>
                {stats!.exits.map((e) => <DistRow key={e.path} label={e.path} value={fmtNum(e.sessions, language)} pct={(e.sessions / mx(stats!.exits, 'sessions')) * 100} color={C_MID} />)}
              </Card>
            </div>

            <SectionHeading n={5} label={t('adminTraffic.audience')} icon={Users} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t('adminTraffic.devicesTitle')} icon={Smartphone}>
                {(() => { const tot = stats!.devices.reduce((s, d) => s + d.n, 0) || 1; return stats!.devices.map((d) => <DistRow key={d.k} label={deviceLabel(d.k)} value={fmtNum(d.n, language)} sub={pctOf(d.n, tot)} pct={(d.n / tot) * 100} color={d.k === 'mobile' ? undefined : C_MID} />); })()}
                <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adminTraffic.browsersTitle')}</p>
                  {stats!.browsers.slice(0, 6).map((b) => <DistRow key={b.k} label={b.k === 'app' ? t('adminTraffic.app') : b.k} value={fmtNum(b.n, language)} pct={(b.n / mx(stats!.browsers, 'n')) * 100} color={C_MID} />)}
                </div>
              </Card>
              <Card title={t('adminTraffic.countriesTitle')} icon={Globe}>
                {stats!.countries.map((c, i) => <DistRow key={c.k} label={<span className="inline-flex items-center gap-2"><Pill size="xs" tone="muted">{c.k}</Pill></span>} value={fmtNum(c.n, language)} sub={pctOf(c.n, totals!.sessions)} pct={(c.n / mx(stats!.countries, 'n')) * 100} color={i === 0 ? undefined : C_MID} />)}
                <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}><Languages className="h-3 w-3" /> {t('adminTraffic.languagesTitle')}</p>
                  <div className="flex flex-wrap gap-2">{stats!.languages.map((l) => <Pill key={l.k} tone="default">{l.k.toUpperCase()} · {fmtNum(l.n, language)}</Pill>)}</div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </Reveal>
    </AdminPage>
  );
}
