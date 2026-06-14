import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Eye, MousePointerClick, Users, ChevronDown,
  Trophy, ExternalLink, Smartphone, Monitor, Tablet,
  Share2, Search, Mail, QrCode, Link2,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AffPage, AffHeading, AffCard, KpiCard, Pill, AffAvatar, AffSpinner,
  RED, POS, WARN, T1, T2, T3, BORDER, F_BORDER, C_FAINT, C_HI, C_MID, TILE_BG,
} from '@/components/affiliate/affiliate-ui';

type Period = '7d' | '30d' | '90d' | 'all';
type SortBy = 'views' | 'clicks' | 'ctr' | 'duration';

const PERIOD_LABELS: Record<Period, string> = { '7d': '7j', '30d': '30j', '90d': '90j', all: 'Tout' };
const PERIOD_DAYS: Record<Period, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

type MemberRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  linktree_slug: string | null;
  avatar_url: string | null;
  role: string;
  is_active: boolean;
};

type RawSession = {
  visited_at: string;
  visitor_id: string | null;
  is_returning: boolean;
  duration_seconds: number | null;
  device_type: string | null;
  referrer_category: string | null;
  affiliate_member_id: string | null;
};

type RawClick = {
  clicked_at: string;
  device_type: string | null;
  referrer_category: string | null;
  affiliate_member_id: string | null;
};

type MemberStats = {
  views: number;
  uniqueVisitors: number;
  clicks: number;
  ctr: number;
  avgDuration: number;
  returningRate: number;
  dailyPoints: Array<{ date: string; views: number; clicks: number }>;
  devices: { mobile: number; desktop: number; tablet: number };
  topSource: string | null;
};

function periodFrom(p: Period): string | null {
  const days = PERIOD_DAYS[p];
  return days ? subDays(new Date(), days).toISOString() : null;
}

function fmtDuration(s: number): string {
  if (s === 0) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct', social: 'Social', paid_social: 'Social payant',
  search: 'Recherche', paid_search: 'Recherche payée', qr: 'QR Code',
  email: 'Email', referral: 'Référence', internal: 'Interne',
};

const SOURCE_ICONS: Record<string, React.ElementType> = {
  social: Share2, paid_social: Share2, search: Search, paid_search: Search,
  qr: QrCode, email: Mail, direct: Link2, referral: ExternalLink, internal: Link2,
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function MiniDualChart({ data }: { data: Array<{ date: string; views: number; clicks: number }> }) {
  const visible = data.slice(-30);
  const maxViews = Math.max(...visible.map(d => d.views), 1);
  const maxClicks = Math.max(...visible.map(d => d.clicks), 1);
  const hasData = visible.some(d => d.views > 0 || d.clicks > 0);

  if (!hasData) {
    return <div className="flex items-center justify-center h-20"><p style={{ color: T3, fontSize: 11.5 }}>Aucune activité sur cette période</p></div>;
  }

  return (
    <div className="space-y-2.5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: RED }} />
          <span style={{ color: T3, fontSize: 11 }}>Vues</span>
          <span className="ml-auto tabular-nums" style={{ color: T2, fontSize: 11, fontWeight: 600 }}>{visible.reduce((s, d) => s + d.views, 0)}</span>
        </div>
        <div className="flex items-end gap-px h-14">
          {visible.map(({ date, views }) => (
            <div key={date} className="flex-1 flex items-end group relative">
              <div className="w-full rounded-sm" style={{ height: `${(views / maxViews) * 100}%`, minHeight: views > 0 ? '2px' : '1px', background: RED, opacity: 0.85 }} />
              <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col text-xs px-2 py-1 rounded whitespace-nowrap z-20 pointer-events-none"
                style={{ background: '#1a1a1d', border: `1px solid ${BORDER}`, color: T1 }}>
                <span style={{ color: T3 }}>{format(new Date(date), 'd MMM', { locale: fr })}</span>
                <span style={{ color: RED }}>{views} vues</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: C_HI }} />
          <span style={{ color: T3, fontSize: 11 }}>Clics billetterie</span>
          <span className="ml-auto tabular-nums" style={{ color: T2, fontSize: 11, fontWeight: 600 }}>{visible.reduce((s, d) => s + d.clicks, 0)}</span>
        </div>
        <div className="flex items-end gap-px h-8">
          {visible.map(({ date, clicks }) => (
            <div key={date} className="flex-1 flex items-end">
              <div className="w-full rounded-sm" style={{ height: `${(clicks / maxClicks) * 100}%`, minHeight: clicks > 0 ? '2px' : '1px', background: C_HI }} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between mt-1">
        <span style={{ color: T3, fontSize: 10.5 }}>{visible.length > 0 ? format(new Date(visible[0].date), 'd MMM', { locale: fr }) : ''}</span>
        <span style={{ color: T3, fontSize: 10.5 }}>Auj.</span>
      </div>
    </div>
  );
}

function DeviceBreakdown({ devices, total }: { devices: { mobile: number; desktop: number; tablet: number }; total: number }) {
  const items = [
    { label: 'Mobile', val: devices.mobile, Icon: Smartphone, color: C_HI },
    { label: 'Desktop', val: devices.desktop, Icon: Monitor, color: C_MID },
    { label: 'Tablette', val: devices.tablet, Icon: Tablet, color: 'rgba(255,255,255,0.22)' },
  ].filter(d => d.val > 0);

  if (items.length === 0) return <p style={{ color: T3, fontSize: 11.5 }}>Pas de données</p>;

  return (
    <div className="space-y-2.5">
      {items.map(({ label, val, Icon, color }) => {
        const pct = total > 0 ? (val / total) * 100 : 0;
        return (
          <div key={label} className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 flex-none" style={{ color: T2 }} />
            <span className="flex-none" style={{ color: T3, fontSize: 11, width: 56 }}>{label}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="flex-none text-right tabular-nums" style={{ color: T3, fontSize: 11, width: 36 }}>{Math.round(pct)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-7 h-7 rounded-full flex items-center justify-center tabular-nums"
        style={{ background: RED, color: '#fff', fontSize: 12, fontWeight: 800, boxShadow: `0 0 14px -4px ${RED}aa` }}>1</div>
    );
  }
  if (rank === 2 || rank === 3) {
    return (
      <div className="w-7 h-7 rounded-full flex items-center justify-center tabular-nums"
        style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 12, fontWeight: 700 }}>{rank}</div>
    );
  }
  return <span className="block text-center tabular-nums" style={{ color: T3, fontSize: 13, fontWeight: 500, width: 28 }}>{rank}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AffiliatePromotersTracking() {
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [sessions, setSessions] = useState<RawSession[]>([]);
  const [clicks, setClicks] = useState<RawClick[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('30d');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('views');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
    if (!aff) { setLoading(false); return; }

    const { data: memberRows } = await supabase
      .from('affiliate_members')
      .select('id, first_name, last_name, linktree_slug, avatar_url, role, is_active')
      .eq('affiliate_id', aff.id)
      .order('created_at', { ascending: true });

    setMembers((memberRows ?? []) as MemberRow[]);

    if (!memberRows || memberRows.length === 0) { setLoading(false); return; }

    const from = periodFrom(period);

    let sessQ = supabase
      .from('affiliate_visitor_sessions')
      .select('visited_at, visitor_id, is_returning, duration_seconds, device_type, referrer_category, affiliate_member_id')
      .eq('affiliate_id', aff.id)
      .eq('is_internal', false)
      .not('affiliate_member_id', 'is', null)
      .limit(10000);
    if (from) sessQ = sessQ.gte('visited_at', from);
    const { data: sessRows } = await sessQ;
    setSessions((sessRows ?? []) as RawSession[]);

    let clickQ = supabase
      .from('affiliate_clicks')
      .select('clicked_at, device_type, referrer_category, affiliate_member_id')
      .eq('affiliate_id', aff.id)
      .eq('is_internal', false)
      .not('affiliate_member_id', 'is', null)
      .limit(10000);
    if (from) clickQ = clickQ.gte('clicked_at', from);
    const { data: clickRows } = await clickQ;
    setClicks((clickRows ?? []) as RawClick[]);

    setLoading(false);
  }, [user, period]);

  useEffect(() => { load(); }, [load]);

  const statsMap = useMemo(() => {
    const map = new Map<string, MemberStats>();
    const chartDays = Math.min(PERIOD_DAYS[period] ?? 60, 60);

    for (const member of members) {
      const mSessions = sessions.filter(s => s.affiliate_member_id === member.id);
      const mClicks = clicks.filter(c => c.affiliate_member_id === member.id);

      const views = mSessions.length;
      const uniqueVisitors = new Set(mSessions.map(s => s.visitor_id).filter(Boolean)).size;
      const clickCount = mClicks.length;
      const ctr = views > 0 ? (clickCount / views) * 100 : 0;
      const durations = mSessions.map(s => s.duration_seconds ?? 0).filter(d => d > 0);
      const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const returningRate = views > 0 ? (mSessions.filter(s => s.is_returning).length / views) * 100 : 0;

      const dayMap = new Map<string, { views: number; clicks: number }>();
      for (let i = chartDays - 1; i >= 0; i--) {
        dayMap.set(format(subDays(new Date(), i), 'yyyy-MM-dd'), { views: 0, clicks: 0 });
      }
      mSessions.forEach(s => { const e = dayMap.get(s.visited_at.slice(0, 10)); if (e) e.views++; });
      mClicks.forEach(c => { const e = dayMap.get(c.clicked_at.slice(0, 10)); if (e) e.clicks++; });
      const dailyPoints = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }));

      const devices = { mobile: 0, desktop: 0, tablet: 0 };
      mSessions.forEach(s => {
        const dt = s.device_type?.toLowerCase();
        if (dt === 'mobile') devices.mobile++;
        else if (dt === 'desktop') devices.desktop++;
        else if (dt === 'tablet') devices.tablet++;
      });

      const srcMap = new Map<string, number>();
      mSessions.forEach(s => { if (s.referrer_category) srcMap.set(s.referrer_category, (srcMap.get(s.referrer_category) ?? 0) + 1); });
      const topSource = srcMap.size > 0 ? [...srcMap.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

      map.set(member.id, { views, uniqueVisitors, clicks: clickCount, ctr, avgDuration, returningRate, dailyPoints, devices, topSource });
    }

    return map;
  }, [members, sessions, clicks, period]);

  const rankedMembers = useMemo(() => {
    const getValue = (m: MemberRow): number => {
      const s = statsMap.get(m.id);
      if (!s) return 0;
      if (sortBy === 'views') return s.views;
      if (sortBy === 'clicks') return s.clicks;
      if (sortBy === 'ctr') return s.ctr;
      return s.avgDuration;
    };
    const active = members.filter(m => m.is_active).sort((a, b) => getValue(b) - getValue(a));
    const inactive = members.filter(m => !m.is_active).sort((a, b) => getValue(b) - getValue(a));
    return [...active, ...inactive];
  }, [members, statsMap, sortBy]);

  const kpis = useMemo(() => {
    const active = members.filter(m => m.is_active);
    let totalViews = 0, totalClicks = 0;
    let bestMember: MemberRow | null = null, bestViews = 0;

    for (const m of active) {
      const s = statsMap.get(m.id);
      if (!s) continue;
      totalViews += s.views;
      totalClicks += s.clicks;
      if (s.views > bestViews) { bestViews = s.views; bestMember = m; }
    }

    const globalCtr = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;
    const bestName = bestMember
      ? [bestMember.first_name, bestMember.last_name].filter(Boolean).join(' ') || 'Promoteur'
      : null;

    return { activeCount: active.length, totalCount: members.length, totalViews, totalClicks, globalCtr, bestName, bestViews };
  }, [members, statsMap]);

  const maxViews = useMemo(() => Math.max(...members.map(m => statsMap.get(m.id)?.views ?? 0), 1), [members, statsMap]);

  const COLS = '40px 1fr 100px 100px 72px 96px 88px 32px';

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title="Suivi Promoteurs"
          subtitle="Performances individuelles de chaque membre de votre équipe."
          right={
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
              {(['7d', '30d', '90d', 'all'] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                  style={period === p ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` } : { color: T3 }}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Users} label="Promoteurs actifs" value={kpis.activeCount} hint={`${kpis.totalCount} au total`} />
        <KpiCard icon={Eye} label="Vues totales" value={kpis.totalViews.toLocaleString()} tone="red" hint="sur tous les linktrees" />
        <KpiCard icon={MousePointerClick} label="Clics billetterie" value={kpis.totalClicks.toLocaleString()} tone="pos" hint={`${fmtPct(kpis.globalCtr)} CTR global`} />
        <KpiCard icon={Trophy} label="Top promoteur" value={kpis.bestName ?? '—'} hint={kpis.bestViews > 0 ? `${kpis.bestViews.toLocaleString()} vues` : 'Aucune donnée'} />
      </div>

      {/* Leaderboard */}
      <AffCard padding={0}>
        {/* Column headers */}
        <div className="grid items-center px-5 py-3 gap-2" style={{ gridTemplateColumns: COLS, borderBottom: `1px solid ${F_BORDER}` }}>
          <span style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>#</span>
          <span style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Promoteur</span>
          {([
            { key: 'views', label: 'Vues' }, { key: 'clicks', label: 'Clics' },
            { key: 'ctr', label: 'CTR' }, { key: 'duration', label: 'Durée moy.' },
          ] as { key: SortBy; label: string }[]).map(col => (
            <button key={col.key} onClick={() => setSortBy(col.key)}
              className="text-left flex items-center gap-1 transition-colors"
              style={{ color: sortBy === col.key ? T1 : T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {col.label}
              {sortBy === col.key && <span style={{ color: RED, fontSize: 9 }}>▼</span>}
            </button>
          ))}
          <span style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Retour</span>
          <span />
        </div>

        {rankedMembers.length === 0 ? (
          <div className="text-center py-16">
            <Users className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
            <p style={{ color: T2, fontSize: 13 }}>Aucun promoteur dans votre équipe.</p>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>Invitez des promoteurs depuis la page Équipe.</p>
          </div>
        ) : (
          <div>
            {rankedMembers.map((member, idx) => {
              const stats = statsMap.get(member.id) ?? {
                views: 0, uniqueVisitors: 0, clicks: 0, ctr: 0, avgDuration: 0, returningRate: 0,
                dailyPoints: [], devices: { mobile: 0, desktop: 0, tablet: 0 }, topSource: null,
              };
              const isExpanded = expandedId === member.id;
              const activeRank = member.is_active ? rankedMembers.filter(m => m.is_active).indexOf(member) + 1 : null;
              const displayName = [member.first_name, member.last_name].filter(Boolean).join(' ') || `Promoteur ${idx + 1}`;
              const barWidth = maxViews > 0 ? (stats.views / maxViews) * 100 : 0;
              const ctrColor = stats.ctr >= 10 ? POS : stats.ctr >= 5 ? WARN : stats.ctr > 0 ? RED : T3;
              const SourceIcon = stats.topSource ? (SOURCE_ICONS[stats.topSource] ?? Link2) : Link2;

              return (
                <div key={member.id}>
                  <button className="w-full text-left transition-colors"
                    style={{ borderBottom: `1px solid ${F_BORDER}`, background: isExpanded ? 'rgba(255,255,255,0.025)' : 'transparent', opacity: member.is_active ? 1 : 0.45 }}
                    onClick={() => setExpandedId(isExpanded ? null : member.id)}>
                    <div className="grid items-center px-5 py-4 gap-2" style={{ gridTemplateColumns: COLS }}>
                      {/* Rank */}
                      <div className="flex items-center justify-center">
                        {activeRank !== null ? <RankBadge rank={activeRank} /> : <span className="block text-center" style={{ color: T3, fontSize: 13, width: 28 }}>—</span>}
                      </div>

                      {/* Promoter info */}
                      <div className="flex items-center gap-3 min-w-0">
                        <AffAvatar src={member.avatar_url} fallback={(member.first_name ?? displayName).slice(0, 1)} size={36} />
                        <div className="min-w-0">
                          <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>{displayName}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {member.linktree_slug && (
                              <span className="truncate" style={{ color: T3, fontSize: 11, maxWidth: 110 }}>/promo/{member.linktree_slug}</span>
                            )}
                            <Pill tone={member.role === 'manager' ? 'red' : 'muted'}>{member.role === 'manager' ? 'Manager' : 'Promoteur'}</Pill>
                            {!member.is_active && <Pill tone="muted">Inactif</Pill>}
                          </div>
                        </div>
                      </div>

                      {/* Views + relative bar */}
                      <div>
                        <p className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{stats.views.toLocaleString()}</p>
                        <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', width: 64 }}>
                          <div className="h-full rounded-full" style={{ width: `${barWidth}%`, background: `linear-gradient(90deg,${RED}88,${RED})` }} />
                        </div>
                      </div>

                      {/* Clicks + unique */}
                      <div>
                        <p className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{stats.clicks.toLocaleString()}</p>
                        <p className="tabular-nums" style={{ color: T3, fontSize: 11, marginTop: 1 }}>{stats.uniqueVisitors} uniques</p>
                      </div>

                      {/* CTR */}
                      <div><p className="tabular-nums" style={{ color: ctrColor, fontSize: 13.5, fontWeight: 620 }}>{stats.views > 0 ? fmtPct(stats.ctr) : '—'}</p></div>

                      {/* Avg duration */}
                      <div><p className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{fmtDuration(stats.avgDuration)}</p></div>

                      {/* Returning rate */}
                      <div><p className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{stats.views > 0 ? fmtPct(stats.returningRate) : '—'}</p></div>

                      {/* Chevron */}
                      <div className="flex items-center justify-center">
                        <ChevronDown className="h-4 w-4 transition-transform duration-200" style={{ color: T3, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-4" style={{ background: 'rgba(0,0,0,0.25)', borderBottom: `1px solid ${F_BORDER}` }}>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Chart */}
                        <div className="lg:col-span-2 rounded-xl p-4" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                          <p style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>Activité</p>
                          <MiniDualChart data={stats.dailyPoints} />
                        </div>

                        {/* Side panels */}
                        <div className="space-y-3">
                          <div className="rounded-xl p-4" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                            <p style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>Appareils</p>
                            <DeviceBreakdown devices={stats.devices} total={stats.views} />
                          </div>

                          <div className="rounded-xl p-4" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                            <p style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Source principale</p>
                            {stats.topSource ? (
                              <div className="flex items-center gap-2">
                                <SourceIcon className="h-4 w-4 flex-none" style={{ color: T2 }} />
                                <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{SOURCE_LABELS[stats.topSource] ?? stats.topSource}</span>
                              </div>
                            ) : <p style={{ color: T3, fontSize: 13 }}>Pas de données</p>}

                            <div className="mt-3 pt-3 grid grid-cols-2 gap-2" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                              <div>
                                <p style={{ color: T3, fontSize: 11 }}>Scroll moy.</p>
                                <p style={{ color: T1, fontSize: 13, fontWeight: 600, marginTop: 1 }}>—</p>
                              </div>
                              <div>
                                <p style={{ color: T3, fontSize: 11 }}>Visites uniques</p>
                                <p className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, marginTop: 1 }}>{stats.uniqueVisitors}</p>
                              </div>
                            </div>

                            {member.linktree_slug && (
                              <a href={`https://yunoapp.eu/promo/${member.linktree_slug}`} target="_blank" rel="noopener noreferrer"
                                className="mt-3 inline-flex items-center gap-1.5 transition-colors" style={{ color: RED, fontSize: 12, fontWeight: 600 }}
                                onClick={e => e.stopPropagation()}>
                                <ExternalLink className="h-3 w-3" /> Voir la page publique
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AffCard>
    </AffPage>
  );
}
