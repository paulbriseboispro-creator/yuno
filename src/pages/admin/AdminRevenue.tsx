import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import { toast } from 'sonner';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, CalendarDays, Coins, Crown, Download, MapPin, RefreshCw, RotateCcw, ShoppingBag, Sparkles, Ticket, TrendingUp, UserPlus, Wine, Zap } from 'lucide-react';
import {
  AdminPage, Card, Stat, SectionHeading, PeriodFilter, Seg, Btn, Pill, RankRow, DistRow, EmptyState, ErrorState, Notice, PageSkeleton, Reveal, Dot,
  TableWrap, Th, Td, INPUT_STYLE, RED, T1, T3, F_BORDER, C_MID, CHART, RECHARTS_TOOLTIP,
} from '@/components/admin/ui';
import { fmtNum, fmtEur, fmtPct, fmtAxisDay, fmtDate, periodRange, type AdminPeriod, fmtPlural } from '@/lib/adminFormat';

interface Stats {
  totals: { gmv: number; club_revenue: number; yuno_revenue: number; refunds_total: number; refunds_count: number; tx_count: number; tickets_qty: number; ticket_sales: number; tables_booked: number; drink_orders: number; avg_order: number; take_rate: number };
  by_day: { d: string; drinks: number; tickets: number; tables: number; total: number; yuno: number; refunds: number; drink_n: number; ticket_n: number; table_n: number }[];
  top_venues: { id: string; name: string; city: string | null; revenue: number; yuno: number; tx: number }[];
  top_events: { id: string; title: string; venue_name: string | null; start_at: string; revenue: number; tickets: number; tables: number }[];
  top_organizers: { user_id: string; name: string; revenue: number; events_count: number }[];
  growth: { new_users_by_day: { d: string; n: number }[]; new_users: number; total_users: number; new_venues: number; new_events: number };
  venue_cities: { city: string; revenue: number; tx: number }[];
  subscriptions: number;
}
interface Venue { id: string; name: string }
type Mode = 'period' | 'month';
const PERIODS: AdminPeriod[] = ['7d', '30d', '90d'];

function monthOptions(lang: string): { key: string; label: string; from: Date; to: Date }[] {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    out.push({ key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`, label: from.toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-GB', { month: 'long', year: 'numeric' }), from, to });
  }
  return out;
}

export default function AdminRevenue() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [mode, setMode] = useState<Mode>('period');
  const [period, setPeriod] = useState<AdminPeriod>('30d');
  const months = useMemo(() => monthOptions(language), [language]);
  const [month, setMonth] = useState(months[0].key);
  const [venueId, setVenueId] = useState<string>('all');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: vs }, { data: demo }] = await Promise.all([
        supabase.from('venues').select('id, name').is('decommissioned_at', null).order('name'),
        supabase.rpc('demo_venue_ids' as never),
      ]);
      const demoSet = new Set<string>((demo as unknown as string[] | null) ?? []);
      setVenues(((vs ?? []) as Venue[]).filter((v) => includeDemo || !demoSet.has(v.id)));
    })();
  }, [includeDemo]);

  const range = useMemo(() => {
    if (mode === 'month') { const m = months.find((x) => x.key === month) ?? months[0]; return { from: m.from, to: m.to }; }
    return periodRange(period);
  }, [mode, month, months, period]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: e } = await supabase.rpc('admin_platform_analytics' as never, { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_venue_id: venueId === 'all' ? null : venueId } as never);
    if (e) setError(e.message); else setStats(data as unknown as Stats);
    setLoading(false);
  }, [range, venueId]);
  useEffect(() => { load(); }, [load]);

  const chart = useMemo(() => (stats?.by_day ?? []).map((d) => ({ ...d, label: fmtAxisDay(d.d, language) })), [stats, language]);
  const growthChart = useMemo(() => (stats?.growth.new_users_by_day ?? []).map((d) => ({ ...d, label: fmtAxisDay(d.d, language) })), [stats, language]);

  const exportCsv = () => {
    if (!stats) return;
    const sep = ';';
    const num = (n: number) => (language === 'fr' ? n.toFixed(2).replace('.', ',') : n.toFixed(2));
    const rows = [[t('adm.revenue.col.club'), t('adm.revenue.col.city'), t('adm.revenue.col.tx'), t('adm.revenue.col.revenue'), t('adm.revenue.col.yuno')].join(sep)];
    for (const v of stats.top_venues) rows.push([`"${v.name.replace(/"/g, '""')}"`, `"${(v.city ?? '').replace(/"/g, '""')}"`, v.tx, num(v.revenue), num(v.yuno)].join(sep));
    rows.push([t('adm.revenue.total'), '', stats.totals.tx_count, num(stats.totals.club_revenue), num(stats.totals.yuno_revenue)].join(sep));
    const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `yuno-revenus-${mode === 'month' ? month : period}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success(t('adm.revenue.exported'));
  };

  const header = (
    <>
      {includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}
      <Seg<Mode> size="sm" value={mode} onChange={setMode} options={[{ key: 'period', label: t('adm.revenue.mode.period') }, { key: 'month', label: t('adm.revenue.mode.month') }]} />
      {mode === 'period'
        ? <PeriodFilter<AdminPeriod> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p, label: t(`adm.common.period.${p}`) }))} />
        : <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...INPUT_STYLE, width: 'auto', minWidth: 170 }}>{months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>}
      <select value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ ...INPUT_STYLE, width: 'auto', minWidth: 160 }}>
        <option value="all">{t('adm.revenue.allClubs')}</option>
        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <Btn onClick={exportCsv} icon={Download} disabled={!stats}>{t('adm.revenue.exportCsv')}</Btn>
      <Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>
    </>
  );

  if (loading && !stats) return <AdminPage eyebrow={t('adm.revenue.eyebrow')} title={t('adm.revenue.title')} subtitle={t('adm.revenue.subtitle')} actions={header}><PageSkeleton tiles={8} blocks={2} /></AdminPage>;
  if (error || !stats) return <AdminPage eyebrow={t('adm.revenue.eyebrow')} title={t('adm.revenue.title')} actions={header}><Card><ErrorState text={error ?? t('adm.common.error')} onRetry={load} retryLabel={t('adm.common.retry')} /></Card></AdminPage>;

  const tot = stats.totals;
  const mix = [{ name: t('adminAnalytics.drinks'), value: chart.reduce((s, d) => s + d.drinks, 0) }, { name: t('adminAnalytics.tickets'), value: chart.reduce((s, d) => s + d.tickets, 0) }, { name: t('adminAnalytics.tables'), value: chart.reduce((s, d) => s + d.tables, 0) }].filter((m) => m.value > 0);
  const mixTotal = mix.reduce((s, m) => s + m.value, 0) || 1;
  const txTotal = chart.reduce((a, d) => a + (d.drink_n || 0) + (d.ticket_n || 0) + (d.table_n || 0), 0);
  const empty = tot.tx_count === 0;

  return (
    <AdminPage eyebrow={t('adm.revenue.eyebrow')} title={t('adm.revenue.title')} subtitle={t('adm.revenue.subtitle')} actions={header}>
      {empty && <Notice icon={Coins}>{t('adm.revenue.noSales')}</Notice>}

      <Reveal>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label={t('adminAnalytics.gmv')} value={fmtEur(tot.gmv, language, { compact: true })} icon={Coins} highlight />
          <Stat label={t('adminAnalytics.yunoRevenue')} value={fmtEur(tot.yuno_revenue, language, { compact: true })} icon={Zap} sub={`${t('adminAnalytics.takeRate')} ${fmtPct(tot.take_rate, 1)}`} />
          <Stat label={t('adminAnalytics.clubRevenue')} value={fmtEur(tot.club_revenue, language, { compact: true })} icon={Building2} />
          <Stat label={t('adminAnalytics.refunds')} value={fmtEur(tot.refunds_total, language, { compact: true })} icon={RotateCcw} tone={tot.refunds_total > 0 ? 'neg' : undefined} sub={`${fmtNum(tot.refunds_count, language)} ${t('adminAnalytics.refundsCount')}`} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Stat label={t('adminAnalytics.totalTransactions')} value={fmtNum(tot.tx_count, language)} icon={ShoppingBag} sub={`${t('adminAnalytics.avgOrder')} ${fmtEur(tot.avg_order, language)}`} />
          <Stat label={t('adminAnalytics.ticketsSold')} value={fmtNum(tot.tickets_qty, language)} icon={Ticket} sub={`${fmtPlural(tot.tickets_qty, language, t('adm.revenue.ticketsQtyOne'), t('adm.revenue.ticketsQty'))} ${fmtPlural(tot.ticket_sales, language, t('adm.revenue.salesQtyOne'), t('adm.revenue.salesQty'))}`} />
          <Stat label={t('adminAnalytics.tablesBooked')} value={fmtNum(tot.tables_booked, language)} icon={Crown} />
          <Stat label={t('adminAnalytics.drinkOrders')} value={fmtNum(tot.drink_orders, language)} icon={Wine} />
        </div>
      </Reveal>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Reveal delay={0.05} className="xl:col-span-2">
          <Card title={t('adm.revenue.byDay')} subtitle={t('adm.revenue.byDayHint')} icon={TrendingUp}>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <defs><linearGradient id="rv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RED} stopOpacity={0.3} /><stop offset="1" stopColor={RED} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} interval={chart.length > 40 ? 10 : chart.length > 14 ? 4 : 0} />
                  <YAxis tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtEur(Number(v), language, { compact: true })} />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} formatter={(v) => fmtEur(Number(v), language)} />
                  <Area type="monotone" dataKey="drinks" name={t('adminAnalytics.drinks')} stackId="a" stroke={CHART[2]} fill={CHART[3]} strokeWidth={1} isAnimationActive={false} />
                  <Area type="monotone" dataKey="tickets" name={t('adminAnalytics.tickets')} stackId="a" stroke={RED} fill="url(#rv)" strokeWidth={1.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="tables" name={t('adminAnalytics.tables')} stackId="a" stroke={CHART[4]} fill="rgba(252,211,77,0.15)" strokeWidth={1} isAnimationActive={false} />
                  <Area type="monotone" dataKey="yuno" name={t('adminAnalytics.yunoRevenue')} stroke={CHART[1]} fill="transparent" strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
              <span className="inline-flex items-center gap-1.5"><Dot color={RED} />{t('adminAnalytics.tickets')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[2]} />{t('adminAnalytics.drinks')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[4]} />{t('adminAnalytics.tables')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[1]} />{t('adminAnalytics.yunoRevenue')}</span>
            </div>
          </Card>
        </Reveal>
        <Reveal delay={0.1}>
          <Card title={t('adm.revenue.mix')} icon={Coins}>
            {mix.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : (
              <>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={mix} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none" isAnimationActive={false}>{mix.map((_, i) => <Cell key={i} fill={[CHART[2], RED, CHART[4]][i % 3]} />)}</Pie><Tooltip contentStyle={RECHARTS_TOOLTIP} formatter={(v) => fmtEur(Number(v), language)} /></PieChart>
                  </ResponsiveContainer>
                </div>
                {mix.map((m, i) => <DistRow key={m.name} label={<span className="inline-flex items-center gap-2"><Dot color={[CHART[2], RED, CHART[4]][i % 3]} />{m.name}</span>} value={fmtEur(m.value, language)} sub={fmtPct((m.value / mixTotal) * 100)} pct={(m.value / mixTotal) * 100} color={[CHART[2], RED, CHART[4]][i % 3]} />)}
              </>
            )}
            {txTotal > 0 && (<>
              <div className="mt-4" style={{ height: 90 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                    <XAxis dataKey="label" hide /><YAxis tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="drink_n" name={t('adminAnalytics.drinks')} stackId="b" fill={CHART[2]} isAnimationActive={false} /><Bar dataKey="ticket_n" name={t('adminAnalytics.tickets')} stackId="b" fill={RED} isAnimationActive={false} /><Bar dataKey="table_n" name={t('adminAnalytics.tables')} stackId="b" fill={CHART[4]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('adm.revenue.txPerDay')}</p>
            </>)}
          </Card>
        </Reveal>
      </div>

      {/* Tableau du mois / clubs */}
      <Reveal delay={0.15}>
        <Card title={t('adm.revenue.monthTable')} subtitle={t('adm.revenue.monthHint')} icon={Building2} flush right={<Btn size="sm" onClick={exportCsv} icon={Download}>{t('adm.revenue.exportCsv')}</Btn>}>
          {stats.top_venues.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : (
            <TableWrap minWidth={640}>
              <thead><tr><Th>{t('adm.revenue.col.club')}</Th><Th>{t('adm.revenue.col.city')}</Th><Th right>{t('adm.revenue.col.tx')}</Th><Th right>{t('adm.revenue.col.revenue')}</Th><Th right>{t('adm.revenue.col.yuno')}</Th></tr></thead>
              <tbody>
                {stats.top_venues.map((v) => <tr key={v.id}><Td strong>{v.name}</Td><Td muted>{v.city ?? '—'}</Td><Td right>{fmtNum(v.tx, language)}</Td><Td right strong>{fmtEur(v.revenue, language)}</Td><Td right style={{ color: RED, fontWeight: 620 }}>{fmtEur(v.yuno, language)}</Td></tr>)}
                <tr><Td strong>{t('adm.revenue.total')}</Td><Td /><Td right strong>{fmtNum(tot.tx_count, language)}</Td><Td right strong>{fmtEur(tot.club_revenue, language)}</Td><Td right style={{ color: RED, fontWeight: 700 }}>{fmtEur(tot.yuno_revenue, language)}</Td></tr>
              </tbody>
            </TableWrap>
          )}
        </Card>
      </Reveal>

      {/* Classements */}
      <Reveal delay={0.2}>
        <SectionHeading n={2} label={t('adminAnalytics.leaderboards')} icon={Sparkles} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-3">
          <Card title={t('adminAnalytics.topVenues')} subtitle={t('adminAnalytics.topVenuesSub')} icon={Building2}>
            {stats.top_venues.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : stats.top_venues.slice(0, 8).map((v, i) => <RankRow key={v.id} index={i} label={v.name} sub={v.city ?? undefined} value={fmtEur(v.revenue, language, { compact: true })} pct={(v.revenue / (stats.top_venues[0]?.revenue || 1)) * 100} leader={i === 0} to={`/admin/venues/${v.id}`} />)}
          </Card>
          <Card title={t('adminAnalytics.topEvents')} subtitle={t('adminAnalytics.topEventsSub')} icon={CalendarDays}>
            {stats.top_events.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : stats.top_events.slice(0, 8).map((e, i) => <RankRow key={e.id} index={i} label={e.title} sub={`${e.venue_name ?? ''} · ${fmtDate(e.start_at, language)} · ${fmtNum(e.tickets, language)} ${t('adminAnalytics.tickets').toLowerCase()}`} value={fmtEur(e.revenue, language, { compact: true })} pct={(e.revenue / (stats.top_events[0]?.revenue || 1)) * 100} leader={i === 0} to={`/admin/events?q=${encodeURIComponent(e.title)}`} />)}
          </Card>
          <Card title={t('adminAnalytics.topOrganizers')} subtitle={t('adminAnalytics.topOrganizersSub')} icon={Sparkles}>
            {stats.top_organizers.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : stats.top_organizers.map((o, i) => <RankRow key={o.user_id} index={i} label={o.name} sub={t('adm.revenue.eventsN').replace('{n}', fmtNum(o.events_count, language))} value={fmtEur(o.revenue, language, { compact: true })} pct={(o.revenue / (stats.top_organizers[0]?.revenue || 1)) * 100} leader={i === 0} to={`/admin/people/${o.user_id}`} />)}
          </Card>
          <Card title={t('adminAnalytics.geo')} subtitle={t('adminAnalytics.geoSub')} icon={MapPin}>
            {stats.venue_cities.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : stats.venue_cities.map((c, i) => <DistRow key={c.city} label={c.city} value={fmtEur(c.revenue, language, { compact: true })} sub={t('adm.revenue.mobileDesktop').replace('{n}', fmtNum(c.tx, language))} pct={(c.revenue / (stats.venue_cities[0]?.revenue || 1)) * 100} color={i === 0 ? undefined : C_MID} />)}
          </Card>
        </div>
      </Reveal>

      {/* Croissance */}
      <Reveal delay={0.25}>
        <SectionHeading n={3} label={t('adminAnalytics.growth')} icon={UserPlus} right={<span style={{ color: T3, fontSize: 11.5 }}>{t('adm.revenue.growthHint')}</span>} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat compact label={t('adminAnalytics.newUsers')} value={fmtNum(stats.growth.new_users, language)} icon={UserPlus} highlight />
            <Stat compact label={t('adminAnalytics.totalUsers')} value={fmtNum(stats.growth.total_users, language)} icon={UserPlus} />
            <Stat compact label={t('adminAnalytics.newVenues')} value={fmtNum(stats.growth.new_venues, language)} icon={Building2} />
            <Stat compact label={t('adminAnalytics.newEvents')} value={fmtNum(stats.growth.new_events, language)} icon={CalendarDays} />
          </div>
          <Card title={t('adminAnalytics.newUsersChart')} subtitle={t('adminAnalytics.newUsersSub')} icon={UserPlus} className="xl:col-span-2">
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growthChart} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <defs><linearGradient id="gu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RED} stopOpacity={0.3} /><stop offset="1" stopColor={RED} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} interval={growthChart.length > 40 ? 10 : growthChart.length > 14 ? 4 : 0} />
                  <YAxis tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} />
                  <Area type="monotone" dataKey="n" name={t('adminAnalytics.newUsers')} stroke={RED} fill="url(#gu)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </Reveal>
      <p style={{ color: T3, fontSize: 11 }}>{includeDemo ? t('adm.common.demoIncluded') : t('adm.common.realOnlyNote')}{T1 && ''}</p>
    </AdminPage>
  );
}
