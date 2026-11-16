import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, isYesterday, isAfter, subDays } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Siren, Loader2, CheckCheck, RefreshCw, BellOff, ChevronRight, Radar,
} from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  type AppNotif, ADMIN_FEED_CONFIG, ADMIN_HIDDEN_TYPES, CATEGORY_META, PRIORITY_CONFIG,
  getNotifDef, notifLink,
} from '@/lib/notifications';
import { AdminCoorgTransfersCard } from '@/components/admin/AdminCoorgTransfersCard';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const T1          = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2          = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3          = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER      = 'rgb(var(--ink)/0.085)';
const F_BORDER    = 'rgb(var(--ink)/0.055)';
const TILE_BG     = 'rgb(var(--ink)/0.025)';
const CARD_BG     = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

type TabFilter = 'all' | 'unread' | 'urgent';

// Registre des échéances retiré de l'admin : ses alertes ne s'affichent plus.
const shown = (n: AppNotif) => !(ADMIN_HIDDEN_TYPES as readonly string[]).includes(n.notification_type);

function mapRow(n: Record<string, unknown>): AppNotif {
  return {
    id: n.id as string,
    title: n.title as string,
    message: n.message as string,
    notification_type: n.notification_type as string,
    priority: (n.priority as AppNotif['priority']) ?? 'normal',
    created_at: n.created_at as string,
    read_at: (n.read_at as string) ?? null,
    event_id: (n.event_id as string) ?? null,
    reference_type: (n.reference_type as string) ?? null,
    reference_id: (n.reference_id as string) ?? null,
    metadata: (n.metadata as Record<string, unknown>) ?? {},
  };
}

function groupByTime(items: AppNotif[]) {
  const now = new Date();
  const groups: { label: string; items: AppNotif[] }[] = [
    { label: 'notif.today',     items: [] },
    { label: 'notif.yesterday', items: [] },
    { label: 'notif.thisWeek',  items: [] },
    { label: 'notif.older',     items: [] },
  ];
  for (const n of items) {
    const d = new Date(n.created_at);
    if (isToday(d))                       groups[0].items.push(n);
    else if (isYesterday(d))              groups[1].items.push(n);
    else if (isAfter(d, subDays(now, 7))) groups[2].items.push(n);
    else                                  groups[3].items.push(n);
  }
  return groups.filter((g) => g.items.length > 0);
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// Le flux (ce qui vient de se passer) et les virements à trancher. Les alertes
// d'échéance (registre retiré de l'admin) sont masquées du flux.

export default function AdminAlerts() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AppNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabFilter>('all');
  const [sweeping, setSweeping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const cfg = ADMIN_FEED_CONFIG;

  const fetchAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const nRes = await
        supabase
          .from(cfg.table as never)
          .select('*')
          .eq(cfg.filterColumn, cfg.filterValue)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(200);
      if (nRes.error) throw nRes.error;
      setNotifications(((nRes.data as unknown as Record<string, unknown>[]) ?? []).map(mapRow).filter(shown));
    } catch (e) {
      console.error('AdminAlerts fetch error:', e);
      toast.error(t('adminAlerts.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cfg.table, cfg.filterColumn, cfg.filterValue, t]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live : une alerte émise pendant qu'on regarde la page doit apparaître seule.
  useEffect(() => {
    channelRef.current = supabase
      .channel(`admin_alerts_${cfg.channelKey}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: cfg.table, filter: cfg.realtimeFilter },
        (payload) => {
          const row = mapRow(payload.new as Record<string, unknown>);
          if (shown(row)) setNotifications((prev) => [row, ...prev]);
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: cfg.table, filter: cfg.realtimeFilter },
        (payload) => setNotifications((prev) => prev.map((n) =>
          n.id === (payload.new as { id: string }).id ? mapRow(payload.new as Record<string, unknown>) : n)))
      .subscribe();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [cfg.table, cfg.channelKey, cfg.realtimeFilter]);

  // ── Actions flux ───────────────────────────────────────────────────────────
  const markRead = useCallback(async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from(cfg.table as never)
      .update({ read_at: new Date().toISOString(), read_by: user?.id ?? null } as never)
      .eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }, [cfg.table]);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read_at);
    if (!unread.length) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from(cfg.table as never)
      .update({ read_at: new Date().toISOString(), read_by: user?.id ?? null } as never)
      .in('id', unread.map((n) => n.id));
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }, [cfg.table, notifications]);

  const openNotif = useCallback((n: AppNotif) => {
    if (!n.read_at) markRead(n.id);
    const link = notifLink(n, cfg);
    // Une alerte qui renvoie sur cette page : on laisse juste le clic marquer comme lu.
    if (link && link !== cfg.pagePath) navigate(link);
  }, [cfg, markRead, navigate]);

    // Le balayage tourne tout seul chaque matin. Le bouton sert à ne pas attendre
  // demain après avoir daté une échéance ou remis un cron d'aplomb.
  const runSweep = useCallback(async () => {
    setSweeping(true);
    const { data, error } = await supabase.rpc('run_admin_alert_sweep' as never);
    setSweeping(false);
    if (error) { toast.error(t('adminAlerts.sweepError')); return; }
    const emitted = (data as unknown as { emitted?: number } | null)?.emitted ?? 0;
    toast.success(emitted > 0
      ? t('adminAlerts.sweepFound').replace('{n}', String(emitted))
      : t('adminAlerts.sweepClean'));
    fetchAll(true);
  }, [fetchAll, t]);

  // ── Dérivés ────────────────────────────────────────────────────────────────
  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const urgentCount = notifications.filter((n) => !n.read_at && (n.priority === 'urgent' || n.priority === 'high')).length;

  const filtered = notifications.filter((n) => {
    if (tab === 'unread') return !n.read_at;
    if (tab === 'urgent') return n.priority === 'urgent' || n.priority === 'high';
    return true;
  });
  const groups = groupByTime(filtered);

  const stats = [
    { label: t('adminAlerts.statTotal'),   value: notifications.length, hint: t('notif.last30days') },
    { label: t('adminAlerts.statUnread'),  value: unreadCount, hint: t('notif.toProcess'), color: unreadCount > 0 ? T1 : undefined },
    { label: t('adminAlerts.statUrgent'),  value: urgentCount, hint: t('notif.highPriority'), color: urgentCount > 0 ? RED : undefined },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: 'var(--sf-000000)' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
            <Siren className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('adminAlerts.title')}
            </h1>
            <p style={{ color: T3, fontSize: 12.5, marginTop: 6, maxWidth: 720 }}>
              {t('adminAlerts.subtitle')}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl p-3.5"
              style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <p className="tabular-nums" style={{ color: s.color ?? T2, fontSize: 24, fontWeight: 700, lineHeight: 1 }}>
                {s.value}
              </p>
              <p style={{ color: T2, fontSize: 11.5, fontWeight: 600, marginTop: 7 }}>{s.label}</p>
              <p style={{ color: T3, fontSize: 10.5, marginTop: 2 }}>{s.hint}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
          </div>
        ) : (
          <>
            <AdminCoorgTransfersCard />

            {/* ── Flux ─────────────────────────────────────────────────────── */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {t('adminAlerts.feedTitle')}
                </h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button onClick={markAllRead}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                      style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 11.5 }}>
                      <CheckCheck className="h-3.5 w-3.5" />
                      {t('notif.markAllRead')}
                    </button>
                  )}
                  <button onClick={runSweep} disabled={sweeping}
                    title={t('adminAlerts.sweepHint')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 11.5 }}>
                    {sweeping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
                    {t('adminAlerts.sweepNow')}
                  </button>
                  <button onClick={() => fetchAll(true)} disabled={refreshing}
                    className="p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T3 }}>
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)} className="mt-3.5">
                <TabsList className="h-8 bg-white/[0.04] border border-white/[0.06] p-0.5 gap-0.5">
                  <TabsTrigger value="all" className="h-7 px-3 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                    {t('notif.tabAll')}
                  </TabsTrigger>
                  <TabsTrigger value="unread" className="h-7 px-3 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                    {t('notif.unread')}
                    {unreadCount > 0 && (
                      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8192C] px-1 text-[9px] font-bold text-snow">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="urgent" className="h-7 px-3 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                    {t('notif.urgent')}
                    {urgentCount > 0 && (
                      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold" style={{ background: 'rgba(252,211,77,0.18)', color: 'var(--acc-fcd34d)' }}>
                        {urgentCount}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                    <BellOff className="h-5 w-5" style={{ color: T3 }} />
                  </div>
                  <p style={{ color: T2, fontSize: 13, fontWeight: 500 }}>
                    {tab === 'unread' ? t('notif.emptyUpToDate') : tab === 'urgent' ? t('notif.emptyNoUrgent') : t('adminAlerts.feedEmpty')}
                  </p>
                  <p style={{ color: T3, fontSize: 11.5 }}>{t('adminAlerts.feedEmptyHint')}</p>
                </div>
              ) : (
                <div className="space-y-5 mt-4">
                  {groups.map((group) => (
                    <section key={group.label}>
                      <p style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                        {t(group.label)}
                      </p>
                      <div className="space-y-1.5">
                        {group.items.map((n) => {
                          const def = getNotifDef(n.notification_type);
                          const Icon = def.icon;
                          const p = PRIORITY_CONFIG[n.priority] ?? PRIORITY_CONFIG.normal;
                          const cat = CATEGORY_META[def.category];
                          const unread = !n.read_at;
                          return (
                            <div
                              key={n.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => openNotif(n)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotif(n); }
                              }}
                              className="group flex gap-3 rounded-xl p-3.5 transition-colors cursor-pointer"
                              style={{
                                background: unread ? 'rgb(var(--ink)/0.04)' : 'transparent',
                                border: `1px solid ${unread ? BORDER : F_BORDER}`,
                              }}
                            >
                              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg mt-0.5"
                                style={{ background: unread ? 'rgb(var(--ink)/0.055)' : 'rgb(var(--ink)/0.02)', border: `1px solid ${F_BORDER}` }}>
                                <Icon className={`h-4 w-4 ${unread ? p.icon : 'text-white/25'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-3">
                                  <p style={{ color: unread ? T1 : T3, fontSize: 13, fontWeight: 560, lineHeight: 1.35 }}>
                                    {n.title}
                                  </p>
                                  <div className="flex items-center gap-2 flex-none">
                                    <span className="tabular-nums" style={{ color: T3, fontSize: 10.5 }}>
                                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dfLocale(language) })}
                                    </span>
                                    {unread && <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />}
                                  </div>
                                </div>
                                <p style={{ color: unread ? T2 : 'rgb(var(--ink)/var(--ink-a28,0.28))', fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                                  {n.message}
                                </p>
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                  {n.priority !== 'normal' && n.priority !== 'low' && (
                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${p.badge}`}>
                                      {t(p.label)}
                                    </span>
                                  )}
                                  {cat && (
                                    <span className={`text-[10px] ${unread ? cat.color : 'text-white/25'}`}>
                                      {t(cat.label)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {unread && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                                  title={t('notif.markRead')}
                                  aria-label={t('notif.markRead')}
                                  className="flex h-6 w-6 flex-none items-center justify-center self-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                  style={{ color: T3 }}
                                >
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}
