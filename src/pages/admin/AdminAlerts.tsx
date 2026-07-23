import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, isYesterday, isAfter, subDays } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Siren, Loader2, CheckCheck, RefreshCw, BellOff, ExternalLink, Plus,
  CalendarClock, Check, Trash2, ChevronRight, Radar,
} from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  type AppNotif, ADMIN_FEED_CONFIG, CATEGORY_META, PRIORITY_CONFIG,
  getNotifDef, notifLink,
} from '@/lib/notifications';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const WARN        = '#FBBF24';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const TILE_BG     = 'rgba(255,255,255,0.025)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

type TabFilter = 'all' | 'unread' | 'urgent';

interface Deadline {
  key: string;
  label: string;
  provider: string;
  description: string | null;
  console_url: string | null;
  interval_months: number;
  due_at: string | null;
  last_rotated_at: string | null;
  remind_days: number[];
  severity: 'normal' | 'high' | 'critical';
  is_active: boolean;
  is_builtin: boolean;
  notes: string | null;
}

// Jours restants avant l'échéance. Les DATE Postgres arrivent en 'YYYY-MM-DD' :
// on les compare à minuit local pour qu'« aujourd'hui » vaille bien 0 et non -1
// selon l'heure à laquelle la page est ouverte.
function daysUntil(due: string | null): number | null {
  if (!due) return null;
  const target = new Date(`${due}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function deadlineTone(days: number | null): { color: string; bg: string } {
  if (days === null) return { color: T3, bg: 'rgba(255,255,255,0.05)' };
  if (days < 0)      return { color: RED, bg: 'rgba(232,25,44,0.12)' };
  if (days <= 7)     return { color: RED, bg: 'rgba(232,25,44,0.10)' };
  if (days <= 30)    return { color: WARN, bg: 'rgba(251,191,36,0.10)' };
  return { color: POS, bg: 'rgba(52,211,153,0.08)' };
}

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
// Deux blocs qui se répondent : le registre des échéances (ce qui va casser) et
// le flux (ce qui vient de se passer). Les alertes d'échéance du flux pointent
// sur le registre, et renouveler dans le registre solde les alertes du flux.

export default function AdminAlerts() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [notifications, setNotifications] = useState<AppNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabFilter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const cfg = ADMIN_FEED_CONFIG;

  const fetchAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const [dlRes, nRes] = await Promise.all([
        supabase.from('admin_credential_deadlines' as never).select('*'),
        supabase
          .from(cfg.table as never)
          .select('*')
          .eq(cfg.filterColumn, cfg.filterValue)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
      if (dlRes.error) throw dlRes.error;
      if (nRes.error) throw nRes.error;
      setDeadlines((dlRes.data as unknown as Deadline[]) ?? []);
      setNotifications(((nRes.data as unknown as Record<string, unknown>[]) ?? []).map(mapRow));
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
        (payload) => setNotifications((prev) => [mapRow(payload.new as Record<string, unknown>), ...prev]))
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
    // Une alerte d'échéance renvoie sur cette page : inutile de naviguer sur
    // place, on laisse juste le clic marquer comme lu.
    if (link && link !== cfg.pagePath) navigate(link);
  }, [cfg, markRead, navigate]);

  // ── Actions registre ───────────────────────────────────────────────────────
  const applyDeadline = useCallback((row: Deadline) => {
    setDeadlines((prev) => prev.map((d) => (d.key === row.key ? row : d)));
  }, []);

  const markRenewed = useCallback(async (key: string) => {
    setBusyKey(key);
    const { data, error } = await supabase.rpc('admin_mark_credential_renewed' as never, { p_key: key } as never);
    setBusyKey(null);
    if (error) { toast.error(t('adminAlerts.saveError')); return; }
    applyDeadline(data as unknown as Deadline);
    // Renouveler solde les rappels côté serveur — refléter ça tout de suite.
    setNotifications((prev) => prev.map((n) =>
      n.reference_type === 'credential_deadline' && n.reference_id === key && !n.read_at
        ? { ...n, read_at: new Date().toISOString() }
        : n));
    toast.success(t('adminAlerts.renewedOk'));
  }, [applyDeadline, t]);

  const setDue = useCallback(async (key: string, due: string) => {
    if (!due) return;
    setBusyKey(key);
    const { data, error } = await supabase.rpc('admin_set_credential_due' as never, { p_key: key, p_due: due } as never);
    setBusyKey(null);
    if (error) { toast.error(t('adminAlerts.saveError')); return; }
    applyDeadline(data as unknown as Deadline);
    toast.success(t('adminAlerts.dueSet'));
  }, [applyDeadline, t]);

  const toggleActive = useCallback(async (row: Deadline, next: boolean) => {
    applyDeadline({ ...row, is_active: next });
    const { error } = await supabase.rpc('admin_upsert_credential_deadline' as never, {
      p_key: row.key,
      p_label: row.label,
      p_provider: row.provider,
      p_interval_months: row.interval_months,
      p_severity: row.severity,
      p_is_active: next,
    } as never);
    if (error) { applyDeadline(row); toast.error(t('adminAlerts.saveError')); }
  }, [applyDeadline, t]);

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

  const removeDeadline = useCallback(async (key: string) => {
    const { error } = await supabase.rpc('admin_delete_credential_deadline' as never, { p_key: key } as never);
    if (error) { toast.error(t('adminAlerts.saveError')); return; }
    setDeadlines((prev) => prev.filter((d) => d.key !== key));
    toast.success(t('adminAlerts.deleted'));
  }, [t]);

  // ── Dérivés ────────────────────────────────────────────────────────────────
  // Tri : ce qui brûle en haut, ce qui n'a pas de date juste après (c'est une
  // action à faire), le confort en bas.
  const sortedDeadlines = useMemo(() => [...deadlines].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const da = daysUntil(a.due_at);
    const db = daysUntil(b.due_at);
    if (da === null && db === null) return a.label.localeCompare(b.label);
    if (da === null) return -1;
    if (db === null) return 1;
    return da - db;
  }), [deadlines]);

  const undatedCount = deadlines.filter((d) => d.is_active && !d.due_at).length;
  const soonCount = deadlines.filter((d) => {
    const n = daysUntil(d.due_at);
    return d.is_active && n !== null && n <= 30;
  }).length;

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
    { label: t('adminAlerts.statSoon'),    value: soonCount, hint: t('adminAlerts.statSoonHint'), color: soonCount > 0 ? WARN : undefined },
    { label: t('adminAlerts.statUndated'), value: undatedCount, hint: t('adminAlerts.statUndatedHint'), color: undatedCount > 0 ? WARN : undefined },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
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
            {/* ── Registre des échéances ───────────────────────────────────── */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                    <CalendarClock className="h-4 w-4" style={{ color: T3 }} />
                    <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                      {t('adminAlerts.deadlinesTitle')}
                    </h3>
                  </div>
                  <p style={{ color: T3, fontSize: 11.5, maxWidth: 720, lineHeight: 1.5 }}>
                    {t('adminAlerts.deadlinesHint')}
                  </p>
                </div>
                <button
                  onClick={() => setAddOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl transition-colors cursor-pointer flex-none"
                  style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 12, fontWeight: 600 }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('adminAlerts.addDeadline')}
                </button>
              </div>

              <div className="space-y-2.5 mt-4">
                {sortedDeadlines.map((d) => {
                  const days = daysUntil(d.due_at);
                  const tone = deadlineTone(days);
                  const busy = busyKey === d.key;
                  return (
                    <div key={d.key} className="rounded-xl p-3.5"
                      style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, opacity: d.is_active ? 1 : 0.5 }}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-[240px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-[560]" style={{ color: T1, fontSize: 13 }}>{d.label}</p>
                            <span className="px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(255,255,255,0.045)', border: `1px solid ${F_BORDER}`, color: T3, fontSize: 10 }}>
                              {d.provider}
                            </span>
                            {d.severity === 'critical' && (
                              <span className="px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)', color: RED, fontSize: 10, fontWeight: 600 }}>
                                {t('adminAlerts.sevCritical')}
                              </span>
                            )}
                            <span style={{ color: T3, fontSize: 10.5 }}>
                              {t('adminAlerts.everyMonths').replace('{n}', String(d.interval_months))}
                            </span>
                          </div>

                          {d.description && (
                            <p style={{ color: T3, fontSize: 11.5, marginTop: 5, lineHeight: 1.5, maxWidth: 780 }}>
                              {d.description}
                            </p>
                          )}

                          <div className="flex items-center gap-2.5 mt-2.5 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg tabular-nums"
                              style={{ background: tone.bg, color: tone.color, fontSize: 11, fontWeight: 600 }}>
                              {days === null
                                ? t('adminAlerts.undated')
                                : days < 0
                                  ? t('adminAlerts.overdueBy').replace('{n}', String(-days))
                                  : t('adminAlerts.inDays').replace('{n}', String(days))}
                            </span>
                            {d.due_at && (
                              <span style={{ color: T3, fontSize: 10.5 }} className="tabular-nums">
                                {t('adminAlerts.dueOn')} {new Date(`${d.due_at}T00:00:00`).toLocaleDateString()}
                              </span>
                            )}
                            {d.last_rotated_at && (
                              <span style={{ color: T3, fontSize: 10.5 }} className="tabular-nums">
                                · {t('adminAlerts.lastDone')} {new Date(`${d.last_rotated_at}T00:00:00`).toLocaleDateString()}
                              </span>
                            )}
                            {d.console_url && (
                              <a href={d.console_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 hover:underline"
                                style={{ color: T2, fontSize: 10.5 }}>
                                {t('adminAlerts.openConsole')}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap flex-none">
                          <input
                            type="date"
                            value={d.due_at ?? ''}
                            onChange={(e) => setDue(d.key, e.target.value)}
                            aria-label={t('adminAlerts.dueOn')}
                            className="px-2 py-1.5 rounded-lg cursor-pointer"
                            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`, color: T2, fontSize: 11.5, colorScheme: 'dark' }}
                          />
                          <button
                            onClick={() => markRenewed(d.key)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.22)', color: POS, fontSize: 11.5, fontWeight: 600 }}
                            title={t('adminAlerts.doneTodayHint')}
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            {t('adminAlerts.doneToday')}
                          </button>
                          <Switch checked={d.is_active} onCheckedChange={(v) => toggleActive(d, v)} />
                          {!d.is_builtin && (
                            <button
                              onClick={() => removeDeadline(d.key)}
                              className="p-1.5 rounded-lg transition-colors cursor-pointer"
                              style={{ color: T3 }}
                              title={t('adminAlerts.delete')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

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
                      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8192C] px-1 text-[9px] font-bold text-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="urgent" className="h-7 px-3 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                    {t('notif.urgent')}
                    {urgentCount > 0 && (
                      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-400/20 px-1 text-[9px] font-bold text-orange-400">
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
                                background: unread ? 'rgba(255,255,255,0.04)' : 'transparent',
                                border: `1px solid ${unread ? BORDER : F_BORDER}`,
                              }}
                            >
                              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg mt-0.5"
                                style={{ background: unread ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.02)', border: `1px solid ${F_BORDER}` }}>
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
                                <p style={{ color: unread ? T2 : 'rgba(255,255,255,0.28)', fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
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

      <AddDeadlineDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(row) => setDeadlines((prev) => [...prev.filter((d) => d.key !== row.key), row])}
      />
    </div>
  );
}

// ─── Ajout d'une échéance maison ──────────────────────────────────────────────
// Un contrat d'assurance, un audit, un renouvellement de licence : tout ce qui
// a une date et qui casse si personne ne la regarde a sa place ici.

function AddDeadlineDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (row: Deadline) => void;
}) {
  const { t } = useLanguage();
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('');
  const [months, setMonths] = useState(12);
  const [severity, setSeverity] = useState<'normal' | 'high' | 'critical'>('high');
  const [dueAt, setDueAt] = useState('');
  const [consoleUrl, setConsoleUrl] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setLabel(''); setProvider(''); setMonths(12); setSeverity('high');
    setDueAt(''); setConsoleUrl(''); setDescription('');
  };

  const submit = async () => {
    if (!label.trim() || !provider.trim()) { toast.error(t('adminAlerts.addMissing')); return; }
    setSaving(true);
    // Clé dérivée du libellé : lisible dans la base et stable pour la dédup des
    // rappels. Un suffixe horodaté évite qu'un second « Assurance » écrase le
    // premier.
    const slug = label.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    const key = `${slug || 'echeance'}_${Date.now().toString(36)}`;
    const { data, error } = await supabase.rpc('admin_upsert_credential_deadline' as never, {
      p_key: key,
      p_label: label.trim(),
      p_provider: provider.trim(),
      p_interval_months: months,
      p_severity: severity,
      p_description: description.trim() || null,
      p_console_url: consoleUrl.trim() || null,
      p_due_at: dueAt || null,
    } as never);
    setSaving(false);
    if (error) { toast.error(t('adminAlerts.saveError')); return; }
    onCreated(data as unknown as Deadline);
    toast.success(t('adminAlerts.added'));
    reset();
    onOpenChange(false);
  };

  const field = {
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${F_BORDER}`,
    color: T1,
    fontSize: 12.5,
    colorScheme: 'dark' as const,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] border-white/[0.08] bg-[#0a0a0c]">
        <DialogHeader>
          <DialogTitle style={{ color: T1 }}>{t('adminAlerts.addTitle')}</DialogTitle>
          <DialogDescription style={{ color: T3, fontSize: 12 }}>
            {t('adminAlerts.addHint')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={t('adminAlerts.fieldLabel')}
            className="w-full px-3 py-2 rounded-lg" style={field} />
          <input value={provider} onChange={(e) => setProvider(e.target.value)}
            placeholder={t('adminAlerts.fieldProvider')}
            className="w-full px-3 py-2 rounded-lg" style={field} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span style={{ color: T3, fontSize: 11 }}>{t('adminAlerts.fieldInterval')}</span>
              <input type="number" min={1} max={60} value={months}
                onChange={(e) => setMonths(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full px-3 py-2 rounded-lg mt-1" style={field} />
            </label>
            <label className="block">
              <span style={{ color: T3, fontSize: 11 }}>{t('adminAlerts.fieldDue')}</span>
              <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg mt-1" style={field} />
            </label>
          </div>
          <label className="block">
            <span style={{ color: T3, fontSize: 11 }}>{t('adminAlerts.fieldSeverity')}</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}
              className="w-full px-3 py-2 rounded-lg mt-1" style={field}>
              <option value="normal">{t('adminAlerts.sevNormal')}</option>
              <option value="high">{t('adminAlerts.sevHigh')}</option>
              <option value="critical">{t('adminAlerts.sevCritical')}</option>
            </select>
          </label>
          <input value={consoleUrl} onChange={(e) => setConsoleUrl(e.target.value)}
            placeholder={t('adminAlerts.fieldConsole')}
            className="w-full px-3 py-2 rounded-lg" style={field} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={t('adminAlerts.fieldDescription')} rows={3}
            className="w-full px-3 py-2 rounded-lg resize-none" style={field} />
        </div>

        <DialogFooter>
          <button onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-lg cursor-pointer"
            style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 12.5 }}>
            {t('adminAlerts.cancel')}
          </button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
            style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 12.5, fontWeight: 600 }}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('adminAlerts.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
