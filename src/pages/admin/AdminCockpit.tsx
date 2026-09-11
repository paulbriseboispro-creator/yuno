import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, Bot, Building2, CalendarDays, CalendarPlus, Crown, Handshake, Heart, HeartOff, LifeBuoy,
  ListChecks, Mail, MessageSquareWarning, RefreshCw, ShieldAlert, Siren, Smartphone, Sparkles, Ticket,
  TrendingUp, UserPlus, Users, Wine, Zap, Radar, type LucideIcon,
} from 'lucide-react';
import {
  AdminPage, Card, Stat, SectionHeading, Seg, Btn, Pill, ProgressBar, DistRow, EmptyState, ErrorState,
  PageSkeleton, Reveal, Dot,
  RED, POS, NEG, WARN, T1, T2, T3, BORDER, F_BORDER, C_FAINT, C_HI, C_MID, CHART, RECHARTS_TOOLTIP,
} from '@/components/admin/ui';
import { fmtNum, fmtEur, fmtUsd, fmtRelative, fmtDate, fmtAxisDay, deltaPct, fmtPct, fmtPlural } from '@/lib/adminFormat';

// ─── Types (miroir des RPC admin_cockpit / admin_activity_feed / admin_release_health) ──
interface Pulse { signups: number; sessions: number; installs: number; activity: number; guestlist: number; paid: number; gmv: number; ai_chats: number; leads: number; waitlist: number }
interface Cockpit {
  generated_at: string; include_demo: boolean;
  today: Pulse; week: Pulse; prev_week: Pulse;
  since_launch: {
    accounts: number; accounts_pro: number; accounts_client: number; first_signup_at: string | null;
    installs_client: number; installs_pro: number; active_devices_7d: number; push_subscriptions: number;
    customers: number; venues: number; organizers: number; agencies: number; events_total: number; events_upcoming: number;
    gmv: number; yuno_revenue: number; tickets: number; tables: number; drinks: number; guestlist: number;
    waitlist: number; leads: number; ai_chats_30d: number; ai_cost_30d_usd: number;
  };
  series: { d: string; signups: number; sessions: number; installs: number; activity: number; guestlist: number; paid: number; ai: number }[];
  health: {
    unread_alerts: number; urgent_alerts: number;
    deadlines: { key: string; label: string; provider: string; due_at: string; severity: string; days_left: number }[];
    undated_deadlines: number; crons_total: number; app_crashes_7d: number; ota_download_fail_7d: number; ai_errors_24h: number;
    maintenance_mode: boolean; payments_disabled: boolean; open_feedback: number; security_failures_24h: number;
    pending_support: number; pending_claims: number; uncontacted_leads: number; pending_moderation: number;
    email_quota: { used: number; free: number; credits: number; remaining: number; day_used: number; day_cap: number } | null;
  };
  ota: { app_id: string; latest: string | null; devices: number; on_latest: number; adoption_pct: number; active_7d: number }[];
  upcoming_events: { id: string; title: string; start_at: string; end_at: string; venue_name: string | null; city: string | null; organizer: string | null; is_live: boolean; ticketing: boolean; tables: boolean; tickets_sold: number; tables_booked: number; guestlist: number; views_7d: number }[];
  recent_signups: { id: string; email: string; at: string; name: string | null; city: string | null; is_pro: boolean; has_app: boolean }[];
  top_pages_7d: { group: string; views: number }[];
  sessions_split_7d: { native: number; web: number };
}
interface FeedItem { at: string; kind: string; title: string; subtitle: string; ref_type: string; ref_id: string; amount: number | null; actor: string | null }
interface HealthLite { crons: { name: string; fails_7d: number; last_start: string | null }[]; cron_failures: { name: string; at: string }[] }

type SeriesKey = 'signups' | 'sessions' | 'installs' | 'activity' | 'ai';
type FeedFamily = 'all' | 'clients' | 'sales' | 'pros' | 'ai' | 'system';
const FEED_KINDS: Record<FeedFamily, string[] | null> = {
  all: null,
  clients: ['signup', 'install', 'guestlist', 'follow', 'unfollow', 'waitlist'],
  sales: ['ticket', 'table', 'order'],
  pros: ['organizer', 'venue', 'agency', 'event_created', 'event_published', 'lead', 'support'],
  ai: ['ai_client', 'ai_owner', 'ai_agency'],
  system: ['alert', 'feedback'],
};
const KIND_ICON: Record<string, LucideIcon> = {
  signup: UserPlus, event_created: CalendarPlus, event_published: CalendarDays, guestlist: ListChecks, ticket: Ticket, table: Crown,
  order: Wine, ai_client: Bot, ai_owner: Bot, ai_agency: Bot, lead: Handshake, waitlist: Mail, organizer: Sparkles, venue: Building2,
  agency: Handshake, install: Smartphone, feedback: MessageSquareWarning, support: LifeBuoy, follow: Heart, unfollow: HeartOff, alert: Siren,
};
const KIND_COLOR: Record<string, string> = {
  ticket: RED, table: WARN, order: RED, alert: NEG, unfollow: T3, feedback: WARN, ai_client: C_HI, ai_owner: C_HI, ai_agency: C_HI,
};

function feedLink(item: FeedItem): string | null {
  switch (item.ref_type) {
    case 'user': return `/admin/people/${item.ref_id}`;
    case 'event': return `/admin/events?q=${encodeURIComponent(item.title)}`;
    case 'venue': return `/admin/venues/${item.ref_id}`;
    case 'organizer': return `/admin/people/${item.ref_id}`;
    case 'agency': return '/admin/agencies';
    case 'ai': return '/admin/ai';
    case 'lead': return '/admin/links';
    case 'waitlist': return '/admin/links?tab=waitlist';
    case 'feedback': return '/admin/feedback';
    case 'alert': return '/admin/alerts';
    case 'device': return '/admin/system';
    default: return null;
  }
}

export default function AdminCockpit() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [data, setData] = useState<Cockpit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<HealthLite | null | 'error'>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedFamily, setFeedFamily] = useState<FeedFamily>('all');
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedMore, setFeedMore] = useState(true);
  const [series, setSeries] = useState<SeriesKey>('signups');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    const { data: d, error: e } = await supabase.rpc('admin_cockpit' as never, { p_include_demo: includeDemo } as never);
    if (e) { setError(e.message); setLoading(false); setRefreshing(false); return; }
    setData(d as unknown as Cockpit);
    setLoading(false); setRefreshing(false);
    // Santé technique en différé : l'historique des crons coûte 2-3 s, il ne
    // doit jamais retenir la page.
    supabase.rpc('admin_release_health' as never).then(({ data: h, error: he }) => {
      if (he || !h) { setHealth('error'); return; }
      const hh = h as unknown as HealthLite;
      setHealth({ crons: hh.crons ?? [], cron_failures: hh.cron_failures ?? [] });
    });
  }, [includeDemo]);

  const loadFeed = useCallback(async (family: FeedFamily, before: string | null) => {
    setFeedLoading(true);
    const { data: f, error: e } = await supabase.rpc('admin_activity_feed' as never, {
      p_limit: 50, p_before: before, p_include_demo: includeDemo, p_kinds: FEED_KINDS[family],
    } as never);
    setFeedLoading(false);
    if (e) { setFeedMore(false); return; }
    const rows = (f as unknown as FeedItem[]) ?? [];
    setFeed((prev) => (before ? [...prev, ...rows] : rows));
    setFeedMore(rows.length === 50);
  }, [includeDemo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFeed([]); loadFeed(feedFamily, null); }, [feedFamily, loadFeed]);

  const chart = useMemo(() => (data?.series ?? []).map((s) => ({ ...s, label: fmtAxisDay(s.d, language) })), [data, language]);
  const sparks = useMemo(() => {
    const s = data?.series ?? [];
    return {
      signups: s.map((x) => x.signups), sessions: s.map((x) => x.sessions), installs: s.map((x) => x.installs),
      activity: s.map((x) => x.activity), ai: s.map((x) => x.ai),
    };
  }, [data]);

  if (loading && !data) {
    return <AdminPage eyebrow={t('adm.cockpit.eyebrow')} title={t('adm.cockpit.title')}><PageSkeleton tiles={6} blocks={3} /></AdminPage>;
  }
  if (error || !data) {
    return <AdminPage eyebrow={t('adm.cockpit.eyebrow')} title={t('adm.cockpit.title')}><Card><ErrorState text={error ?? t('adm.common.error')} onRetry={() => load()} retryLabel={t('adm.common.retry')} /></Card></AdminPage>;
  }

  const { week, prev_week: prev, today, since_launch: sl, health: h } = data;
  const issues = [
    h.urgent_alerts > 0, h.deadlines.some((d) => d.days_left <= 14), h.app_crashes_7d > 0, h.ai_errors_24h > 0,
    h.maintenance_mode, h.payments_disabled, h.security_failures_24h > 0, h.pending_support > 0, h.pending_claims > 0,
    h.uncontacted_leads > 0, h.pending_moderation > 0, health !== null && health !== 'error' && health.cron_failures.length > 0,
  ].filter(Boolean).length;

  const pulseTiles: { key: keyof Pulse; label: string; icon: LucideIcon; spark: number[]; money?: boolean; highlight?: boolean }[] = [
    { key: 'signups', label: t('adm.common.signups'), icon: UserPlus, spark: sparks.signups, highlight: true },
    { key: 'installs', label: t('adm.common.installs'), icon: Smartphone, spark: sparks.installs },
    { key: 'sessions', label: t('adm.common.sessions'), icon: Radar, spark: sparks.sessions },
    { key: 'activity', label: t('adm.cockpit.activity'), icon: Activity, spark: sparks.activity },
    { key: 'gmv', label: t('adm.common.gmv'), icon: Zap, spark: [], money: true },
    { key: 'ai_chats', label: t('adm.cockpit.aiChats'), icon: Bot, spark: sparks.ai },
    { key: 'leads', label: t('adm.cockpit.leads'), icon: Handshake, spark: [] },
    { key: 'waitlist', label: t('adm.cockpit.waitlist'), icon: Mail, spark: [] },
  ];

  const groupLabel = (g: string) => { const k = `adm.cockpit.g.${g}`; const v = t(k); return v === k ? g : v; };
  const maxPageViews = Math.max(...data.top_pages_7d.map((p) => p.views), 1);

  // Journal groupé par jour
  const dayKey = (iso: string) => new Date(iso).toDateString();
  const todayKey = new Date().toDateString();
  const yesterdayKey = new Date(Date.now() - 86_400_000).toDateString();
  const groups: { key: string; label: string; items: FeedItem[] }[] = [];
  for (const item of feed) {
    const k = dayKey(item.at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== k) {
      g = { key: k, label: k === todayKey ? t('adm.common.today') : k === yesterdayKey ? t('adm.cockpit.yesterday') : fmtDate(item.at, language, 'long'), items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  const seriesOptions: { key: SeriesKey; label: string }[] = [
    { key: 'signups', label: t('adm.cockpit.series.signups') }, { key: 'sessions', label: t('adm.cockpit.series.sessions') },
    { key: 'installs', label: t('adm.cockpit.series.installs') }, { key: 'activity', label: t('adm.cockpit.series.activity') },
    { key: 'ai', label: t('adm.cockpit.series.ai') },
  ];
  const otherSeries = seriesOptions.filter((o) => o.key !== series).slice(0, 2);

  return (
    <AdminPage
      eyebrow={<>{t('adm.cockpit.eyebrow')} · {t('adm.common.generatedAt').replace('{t}', fmtRelative(data.generated_at, language))}</>}
      title={t('adm.cockpit.title')}
      subtitle={includeDemo ? t('adm.cockpit.subtitleDemo') : t('adm.cockpit.subtitle')}
      actions={<>
        {includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}
        {issues > 0 && <Btn to="/admin/system" icon={ShieldAlert} variant="danger">{t('adm.cockpit.goSystem')}</Btn>}
        <Btn onClick={() => load(true)} loading={refreshing} icon={RefreshCw}>{t('adm.common.refresh')}</Btn>
      </>}
    >
      {/* 01 · Pouls */}
      <Reveal>
        <SectionHeading n={1} label={t('adm.cockpit.pulse')} icon={Activity} accent right={<span style={{ color: T3, fontSize: 11.5 }}>{t('adm.cockpit.pulseHint')}</span>} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          {pulseTiles.map((p) => {
            const cur = Number(week[p.key] ?? 0), before = Number(prev[p.key] ?? 0), td = Number(today[p.key] ?? 0);
            return (
              <Stat key={p.key} label={p.label} icon={p.icon} highlight={p.highlight} compact
                value={p.money ? fmtEur(cur, language, { compact: true }) : fmtNum(cur, language)}
                delta={deltaPct(cur, before)} deltaVs={t('adm.common.vsLastWeek')}
                sub={t('adm.cockpit.todayN').replace('{n}', p.money ? fmtEur(td, language, { compact: true }) : fmtNum(td, language))}
                spark={p.spark.length > 1 ? p.spark.slice(-14) : undefined} />
            );
          })}
        </div>
      </Reveal>

      {/* 02 · Depuis le lancement */}
      <Reveal delay={0.05}>
        <SectionHeading n={2} label={t('adm.cockpit.sinceLaunch')} icon={TrendingUp}
          right={sl.first_signup_at ? <span style={{ color: T3, fontSize: 11.5 }}>{t('adm.cockpit.firstSignup').replace('{d}', fmtDate(sl.first_signup_at, language))}</span> : undefined} />
        <Card className="mt-3" pad="18px 22px">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-5">
            {[
              { l: t('adm.common.accounts'), v: fmtNum(sl.accounts, language), d: t('adm.cockpit.accountsSplit').replace('{c}', fmtNum(sl.accounts_client, language)).replace('{p}', fmtNum(sl.accounts_pro, language)) },
              { l: t('adm.common.installs'), v: fmtNum(sl.installs_client + sl.installs_pro, language), d: `${t('adm.cockpit.installsSplit').replace('{c}', fmtNum(sl.installs_client, language)).replace('{p}', fmtNum(sl.installs_pro, language))} · ${t('adm.cockpit.activeDevices').replace('{n}', fmtNum(sl.active_devices_7d, language))}` },
              { l: t('adm.common.customers'), v: fmtNum(sl.customers, language), d: `${t('adm.cockpit.customersHint')} · ${t('adm.cockpit.pushUsers').replace('{n}', fmtNum(sl.push_subscriptions, language))}` },
              { l: t('adm.cockpit.events'), v: fmtNum(sl.events_total, language), d: t('adm.cockpit.eventsSplit').replace('{u}', fmtNum(sl.events_upcoming, language)) },
              { l: t('adm.cockpit.pros'), v: `${fmtNum(sl.venues, language)} · ${fmtNum(sl.organizers, language)} · ${fmtNum(sl.agencies, language)}`, d: `${t('adm.cockpit.waitlist')} ${fmtNum(sl.waitlist, language)} · ${t('adm.cockpit.leads').toLowerCase()} ${fmtNum(sl.leads, language)}` },
              { l: t('adm.common.gmv'), v: fmtEur(sl.gmv, language, { compact: true }), d: t('adm.cockpit.pillars').replace('{t}', fmtNum(sl.tickets, language)).replace('{ta}', fmtNum(sl.tables, language)).replace('{d}', fmtNum(sl.drinks, language)).replace('{g}', fmtNum(sl.guestlist, language)) },
              { l: t('adm.common.yunoRevenue'), v: fmtEur(sl.yuno_revenue, language, { compact: true }), d: sl.gmv > 0 ? fmtPct((sl.yuno_revenue / sl.gmv) * 100, 1) : '—', red: true },
              { l: t('adm.cockpit.aiCost'), v: fmtUsd(sl.ai_cost_30d_usd, language), d: fmtPlural(sl.ai_chats_30d, language, t('adm.cockpit.aiCostHintOne'), t('adm.cockpit.aiCostHint')) },
            ].map((f, i) => (
              <div key={i} className={i % 4 !== 0 ? 'md:border-l md:pl-4' : ''} style={{ borderColor: BORDER }}>
                <div style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{f.l}</div>
                <div className="tabular-nums mt-2" style={{ color: f.red ? RED : T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', lineHeight: 1 }}>{f.v}</div>
                <div style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.35 }}>{f.d}</div>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 03 · Graphique */}
        <Reveal delay={0.1} className="xl:col-span-2">
          <Card title={t('adm.cockpit.chart')} subtitle={t('adm.cockpit.chartHint')} icon={TrendingUp}
            right={<Seg<SeriesKey> size="sm" value={series} onChange={setSeries} options={seriesOptions} />}>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ckMain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RED} stopOpacity={0.35} /><stop offset="1" stopColor={RED} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis yAxisId="main" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  {/* Les séries de contexte ont leur propre échelle : sinon une
                      série 100 fois plus grosse colle la série mise en avant à zéro. */}
                  <YAxis yAxisId="ctx" orientation="right" hide />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ stroke: BORDER }} />
                  {otherSeries.map((o, i) => (
                    <Area key={o.key} yAxisId="ctx" type="monotone" dataKey={o.key} name={o.label} stroke={CHART[i + 2]} fill="transparent" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  ))}
                  <Area yAxisId="main" type="monotone" dataKey={series} name={seriesOptions.find((o) => o.key === series)?.label} stroke={RED} fill="url(#ckMain)" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: RED }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
              <span className="inline-flex items-center gap-1.5"><Dot color={RED} />{seriesOptions.find((o) => o.key === series)?.label}</span>
              {otherSeries.map((o, i) => <span key={o.key} className="inline-flex items-center gap-1.5"><Dot color={CHART[i + 2]} />{o.label}</span>)}
            </div>
          </Card>
        </Reveal>

        {/* 04 · Santé */}
        <Reveal delay={0.15}>
          <Card title={t('adm.cockpit.health')} subtitle={issues === 0 ? t('adm.cockpit.healthOk') : fmtPlural(issues, language, t('adm.cockpit.healthIssuesOne'), t('adm.cockpit.healthIssues'))} icon={ShieldAlert} accent={issues > 0}
            right={<Btn to="/admin/system" size="sm" icon={Activity}>{t('adm.cockpit.goSystem')}</Btn>} style={{ height: '100%' }}>
            <div className="space-y-1">
              {h.maintenance_mode && <HealthRow to="/admin/system" label={t('adm.cockpit.h.maintenance')} value="" tone="neg" />}
              {h.payments_disabled && <HealthRow to="/admin/system" label={t('adm.cockpit.h.payments')} value="" tone="neg" />}
              <HealthRow to="/admin/alerts" label={t('adm.cockpit.h.alerts')} value={fmtNum(h.unread_alerts, language)} sub={h.urgent_alerts > 0 ? t('adm.cockpit.h.urgent').replace('{n}', String(h.urgent_alerts)) : undefined} tone={h.urgent_alerts > 0 ? 'neg' : h.unread_alerts > 0 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/alerts" label={t('adm.cockpit.h.deadlines')} value={fmtNum(h.deadlines.length, language)} sub={h.undated_deadlines > 0 ? t('adm.cockpit.h.undated').replace('{n}', String(h.undated_deadlines)) : undefined} tone={h.deadlines.some((d) => d.days_left <= 7) ? 'neg' : h.deadlines.length > 0 ? 'warn' : 'ok'} />
              {h.deadlines.slice(0, 3).map((d) => (
                <div key={d.key} className="flex items-center justify-between gap-2 pl-4" style={{ fontSize: 11.5 }}>
                  <span className="truncate" style={{ color: T3 }}>{d.label}</span>
                  <Pill size="xs" tone={d.days_left < 0 ? 'neg' : d.days_left <= 7 ? 'hot' : 'accent'}>{d.days_left < 0 ? t('adm.cockpit.h.overdue') : t('adm.cockpit.h.daysLeft').replace('{n}', String(d.days_left))}</Pill>
                </div>
              ))}
              <HealthRow to="/admin/system" label={t('adm.cockpit.h.crons')}
                value={health === null ? t('adm.cockpit.h.cronsLoading') : health === 'error' ? '—' : health.cron_failures.length > 0 ? t('adm.cockpit.h.cronsFailed').replace('{n}', String(health.cron_failures.length)) : t('adm.cockpit.h.cronsOk').replace('{n}', String(h.crons_total)).replace('{t}', fmtRelative(health.crons.reduce<string | null>((m, c) => (c.last_start && (!m || c.last_start > m) ? c.last_start : m), null), language))}
                tone={health === null ? 'muted' : health === 'error' ? 'warn' : health.cron_failures.length > 0 ? 'neg' : 'ok'} />
              <HealthRow to="/admin/system" label={t('adm.cockpit.h.crashes')} value={fmtNum(h.app_crashes_7d, language)} tone={h.app_crashes_7d > 0 ? 'neg' : 'ok'} />
              <HealthRow to="/admin/system" label={t('adm.cockpit.h.otaFail')} value={fmtNum(h.ota_download_fail_7d, language)} tone={h.ota_download_fail_7d > 10 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/ai" label={t('adm.cockpit.h.aiErrors')} value={fmtNum(h.ai_errors_24h, language)} tone={h.ai_errors_24h > 0 ? 'neg' : 'ok'} />
              <HealthRow to="/admin/audit" label={t('adm.cockpit.h.security')} value={fmtNum(h.security_failures_24h, language)} tone={h.security_failures_24h > 5 ? 'neg' : h.security_failures_24h > 0 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/feedback" label={t('adm.cockpit.h.feedback')} value={fmtNum(h.open_feedback, language)} tone={h.open_feedback > 0 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/support" label={t('adm.cockpit.h.support')} value={fmtNum(h.pending_support, language)} tone={h.pending_support > 0 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/demo-access" label={t('adm.cockpit.h.claims')} value={fmtNum(h.pending_claims, language)} tone={h.pending_claims > 0 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/links" label={t('adm.cockpit.h.leads')} value={fmtNum(h.uncontacted_leads, language)} tone={h.uncontacted_leads > 0 ? 'warn' : 'ok'} />
              <HealthRow to="/admin/events" label={t('adm.cockpit.h.moderation')} value={fmtNum(h.pending_moderation, language)} tone={h.pending_moderation > 0 ? 'warn' : 'ok'} />
              {h.email_quota && (
                <div className="pt-2">
                  <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
                    <Link to="/admin/marketing" style={{ color: T2 }}>{t('adm.cockpit.h.quota')}</Link>
                    <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{fmtNum(h.email_quota.used, language)} / {fmtNum(h.email_quota.free + h.email_quota.credits, language)}</span>
                  </div>
                  <div className="mt-1.5"><ProgressBar pct={(h.email_quota.used / Math.max(1, h.email_quota.free + h.email_quota.credits)) * 100} color={C_MID} height={4} /></div>
                </div>
              )}
              <div className="pt-2">
                <div style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>{t('adm.cockpit.h.ota')}</div>
                {data.ota.map((o) => (
                  <div key={o.app_id} className="mb-2">
                    <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
                      <span style={{ color: T2 }}>{o.app_id === 'eu.yunoapp.pro' ? 'Yuno Pro' : 'Yuno'} <span style={{ color: T3 }}>{o.latest ?? '—'}</span></span>
                      <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{fmtPct(o.adoption_pct)}</span>
                    </div>
                    <div className="mt-1"><ProgressBar pct={o.adoption_pct} color={o.adoption_pct >= 60 ? POS : o.adoption_pct >= 25 ? WARN : RED} height={4} /></div>
                    <div style={{ color: T3, fontSize: 10.5, marginTop: 3 }}>{t('adm.cockpit.h.otaLine').replace('{n}', fmtNum(o.on_latest, language)).replace('{v}', fmtNum(o.devices, language)).replace('{a}', fmtNum(o.active_7d, language))}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </Reveal>
      </div>

      {/* 05 · Prochaines soirées */}
      <Reveal delay={0.2}>
        <Card title={t('adm.cockpit.upcoming')} subtitle={t('adm.cockpit.upcomingHint')} icon={CalendarDays} right={<Btn to="/admin/events" size="sm">{t('adm.common.viewAll')}</Btn>} flush>
          {data.upcoming_events.length === 0 ? <EmptyState icon={CalendarDays} text={t('adm.cockpit.noUpcoming')} /> : (
            <div className="px-3 pb-2">
              {data.upcoming_events.map((e) => (
                <Link key={e.id} to={`/admin/events?q=${encodeURIComponent(e.title)}`} className="grid items-center gap-3 px-3 py-3 rounded-xl transition-colors hover:bg-white/[0.03]"
                  style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderBottom: `1px solid ${F_BORDER}` }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{e.title}</span>
                      {e.is_live && <Pill size="xs" tone="pos">{t('adm.common.live')}</Pill>}
                    </div>
                    <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {fmtDate(e.start_at, language, 'datetime')}{e.venue_name ? ` · ${e.venue_name}` : ''}{e.city ? ` · ${e.city}` : ''}{e.organizer ? ` · ${e.organizer}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {e.ticketing && <Pill size="xs" icon={Ticket}>{fmtNum(e.tickets_sold, language)}</Pill>}
                    {e.tables && <Pill size="xs" icon={Crown}>{fmtNum(e.tables_booked, language)}</Pill>}
                    <Pill size="xs" icon={ListChecks}>{fmtNum(e.guestlist, language)}</Pill>
                    <Pill size="xs" tone="muted">{fmtPlural(e.views_7d, language, t('adm.cockpit.views7dOne'), t('adm.cockpit.views7d'))}</Pill>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 06 · Journal */}
        <Reveal delay={0.25} className="xl:col-span-2">
          <Card title={t('adm.cockpit.feed')} subtitle={t('adm.cockpit.feedHint')} icon={ListChecks}
            right={<Seg<FeedFamily> size="sm" value={feedFamily} onChange={setFeedFamily} options={(['all', 'clients', 'sales', 'pros', 'ai', 'system'] as FeedFamily[]).map((k) => ({ key: k, label: t(`adm.cockpit.f.${k}`) }))} />}>
            {feed.length === 0 && !feedLoading ? <EmptyState text={t('adm.cockpit.feedEmpty')} /> : (
              <div>
                {groups.map((g) => (
                  <div key={g.key} className="mb-3">
                    <div className="sticky top-0 py-1" style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', background: '#0a0a0c' }}>{g.label}</div>
                    {g.items.map((item, i) => {
                      const Icon = KIND_ICON[item.kind] ?? Activity;
                      const color = KIND_COLOR[item.kind] ?? T2;
                      const href = feedLink(item);
                      const kindLabel = (() => { const k = `adm.cockpit.k.${item.kind}`; const v = t(k); return v === k ? item.kind : v; })();
                      const row = (
                        <div className="flex items-start gap-3 py-2" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-none mt-0.5" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                            <Icon className="w-3.5 h-3.5" style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span style={{ color: T3, fontSize: 11 }}>{kindLabel}</span>
                              {item.amount !== null && item.amount !== undefined && item.kind !== 'ai_client' && item.kind !== 'ai_owner' && item.kind !== 'ai_agency' && <Pill size="xs" tone={item.amount > 0 ? 'hot' : 'muted'}>{fmtEur(item.amount, language)}</Pill>}
                            </div>
                            <div className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 520 }}>{item.title || item.actor || '—'}</div>
                            {item.subtitle && <div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{item.subtitle}</div>}
                          </div>
                          <span className="flex-none tabular-nums" style={{ color: T3, fontSize: 11 }} title={fmtDate(item.at, language, 'datetime')}>{fmtRelative(item.at, language)}</span>
                        </div>
                      );
                      return href ? <Link key={`${item.kind}-${item.ref_id}-${i}`} to={href} className="block hover:opacity-90">{row}</Link> : <div key={`${item.kind}-${item.ref_id}-${i}`}>{row}</div>;
                    })}
                  </div>
                ))}
                {feedMore && <div className="pt-2 text-center"><Btn onClick={() => loadFeed(feedFamily, feed[feed.length - 1]?.at ?? null)} loading={feedLoading} size="sm">{t('adm.cockpit.loadMore')}</Btn></div>}
              </div>
            )}
          </Card>
        </Reveal>

        <div className="space-y-4">
          {/* 07 · Derniers comptes */}
          <Reveal delay={0.3}>
            <Card title={t('adm.cockpit.recentSignups')} icon={Users} right={<Btn to="/admin/people" size="sm">{t('adm.common.viewAll')}</Btn>}>
              {data.recent_signups.length === 0 ? <EmptyState text={t('adm.common.empty')} /> : data.recent_signups.map((u) => (
                <Link key={u.id} to={`/admin/people/${u.id}`} className="flex items-center justify-between gap-3 py-2 hover:opacity-90" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  <div className="min-w-0">
                    <div className="truncate" style={{ color: T1, fontSize: 13 }}>{u.name ?? u.email}</div>
                    <div className="truncate" style={{ color: T3, fontSize: 11 }}>{u.name ? `${u.email}` : ''}{u.city ? ` · ${u.city}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    <Pill size="xs" tone={u.is_pro ? 'hot' : 'muted'}>{u.is_pro ? t('adm.cockpit.pro') : t('adm.cockpit.client')}</Pill>
                    {u.has_app && <Pill size="xs" tone="pos" icon={Smartphone}>{t('adm.cockpit.hasApp')}</Pill>}
                    <span className="tabular-nums" style={{ color: T3, fontSize: 11 }}>{fmtRelative(u.at, language)}</span>
                  </div>
                </Link>
              ))}
            </Card>
          </Reveal>

          {/* 08 · Pages vues */}
          <Reveal delay={0.35}>
            <Card title={t('adm.cockpit.pages7d')} icon={Radar} subtitle={t('adm.cockpit.split').replace('{a}', fmtNum(data.sessions_split_7d.native, language)).replace('{w}', fmtNum(data.sessions_split_7d.web, language))} right={<Btn to="/admin/growth" size="sm">{t('adm.common.details')}</Btn>}>
              {data.top_pages_7d.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : data.top_pages_7d.slice(0, 8).map((p, i) => (
                <DistRow key={p.group} label={groupLabel(p.group)} value={fmtNum(p.views, language)} pct={(p.views / maxPageViews) * 100} color={i === 0 ? `linear-gradient(90deg,${RED}88,${RED})` : undefined} />
              ))}
            </Card>
          </Reveal>
        </div>
      </div>
    </AdminPage>
  );
}

function HealthRow({ to, label, value, sub, tone }: { to: string; label: string; value: string; sub?: string; tone: 'ok' | 'warn' | 'neg' | 'muted' }) {
  const color = tone === 'neg' ? NEG : tone === 'warn' ? WARN : tone === 'ok' ? POS : T3;
  return (
    <Link to={to} className="flex items-center justify-between gap-3 py-[5px] hover:opacity-90" style={{ fontSize: 12.5 }}>
      <span className="flex items-center gap-2 min-w-0">
        <Dot color={color} size={7} />
        <span className="truncate" style={{ color: tone === 'neg' ? T1 : T2 }}>{label}</span>
      </span>
      <span className="flex items-center gap-2 flex-none">
        {sub && <span style={{ color: tone === 'neg' ? NEG : WARN, fontSize: 11 }}>{sub}</span>}
        <span className="tabular-nums" style={{ color: tone === 'ok' || tone === 'muted' ? T3 : T1, fontWeight: 600 }}>{value}</span>
      </span>
    </Link>
  );
}
