/**
 * Aujourd'hui › Toutes les alertes (`/admin/today/alerts`), réécrit avec le kit.
 * Le flux des alertes plateforme des 30 derniers jours (`admin_notifications`,
 * portée `platform`), en direct, groupé par jour : filtrer, ouvrir (la page qui
 * règle la cause, lien de `notifLink`), marquer lu, relancer le balayage.
 * Les virements à trancher vivent dans Argent › À régler (une seule place).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCheck, Radar, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  type AppNotif, ADMIN_FEED_CONFIG, ADMIN_HIDDEN_TYPES, CATEGORY_META, getNotifDef, notifLink,
} from '@/lib/notifications';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Badge, Card, EmptyState, ErrorState, Kpi, KpiRow, Page, Tabs, useAdminT, useTab } from '@/admin/ui';

const cfg = ADMIN_FEED_CONFIG;
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

const isUrgent = (n: AppNotif) => n.priority === 'urgent' || n.priority === 'high';

/** Aujourd'hui / hier / cette semaine / plus ancien. */
function dayGroup(iso: string, now = new Date()): 'today' | 'yesterday' | 'week' | 'older' {
  const d = new Date(iso);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const t = d.getTime();
  if (t >= start.getTime()) return 'today';
  if (t >= start.getTime() - 86_400_000) return 'yesterday';
  if (t >= start.getTime() - 6 * 86_400_000) return 'week';
  return 'older';
}
const GROUP_KEY = { today: 'notif.today', yesterday: 'notif.yesterday', week: 'notif.thisWeek', older: 'notif.older' } as const;

export default function AlertsPage() {
  const { t, lang } = useAdminT();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AppNotif[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'refresh' | 'sweep' | null>(null);
  const tabs = useMemo(() => [
    { value: 'all', label: t('notif.tabAll') },
    { value: 'unread', label: t('notif.unread'), count: rows ? rows.filter((n) => !n.read_at).length : undefined },
    { value: 'urgent', label: t('notif.urgent'), count: rows ? rows.filter(isUrgent).length : undefined },
  ], [rows, t]);
  const [tab, setTab] = useTab(tabs);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const { data, error: e } = await supabase.from(cfg.table as never).select('*')
      .eq(cfg.filterColumn, cfg.filterValue).gte('created_at', since.toISOString())
      .order('created_at', { ascending: false }).limit(200);
    if (e) { setError(e); return; }
    setError(null);
    setRows(((data as unknown as Record<string, unknown>[]) ?? []).map(mapRow).filter(shown));
  }, []);

  useEffect(() => { void load(); }, [load]);

  // En direct : une alerte émise pendant qu'on regarde la page apparaît seule.
  useEffect(() => {
    const ch = supabase.channel(`admin_alerts_page_${cfg.channelKey}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: cfg.table, filter: cfg.realtimeFilter }, (p) => {
        const row = mapRow(p.new as Record<string, unknown>);
        if (shown(row)) setRows((prev) => (prev ? [row, ...prev] : [row]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: cfg.table, filter: cfg.realtimeFilter }, (p) => {
        const row = mapRow(p.new as Record<string, unknown>);
        setRows((prev) => prev?.map((n) => (n.id === row.id ? row : n)) ?? prev);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const { data: { user } } = await supabase.auth.getUser();
    const at = new Date().toISOString();
    await supabase.from(cfg.table as never).update({ read_at: at, read_by: user?.id ?? null } as never).in('id', ids);
    setRows((prev) => prev?.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? at } : n)) ?? prev);
  }, []);

  const open = (n: AppNotif) => {
    if (!n.read_at) void markRead([n.id]);
    const link = notifLink(n, cfg);
    if (link && link !== cfg.pagePath) navigate(link);
  };

  // Le balayage tourne chaque matin ; le bouton évite d'attendre demain.
  const sweep = async () => {
    setBusy('sweep');
    const { data, error: e } = await supabase.rpc('run_admin_alert_sweep' as never);
    setBusy(null);
    if (e) { toast.error(t('adminAlerts.sweepError')); return; }
    const n = (data as unknown as { emitted?: number } | null)?.emitted ?? 0;
    toast.success(n > 0 ? t('adminAlerts.sweepFound').replace('{n}', String(n)) : t('adminAlerts.sweepClean'));
    void load();
  };

  const unread = rows?.filter((n) => !n.read_at) ?? [];
  const urgent = rows?.filter((n) => !n.read_at && isUrgent(n)) ?? [];
  const list = (rows ?? []).filter((n) => (tab === 'unread' ? !n.read_at : tab === 'urgent' ? isUrgent(n) : true));
  const groups = (['today', 'yesterday', 'week', 'older'] as const)
    .map((g) => ({ g, items: list.filter((n) => dayGroup(n.created_at) === g) }))
    .filter((x) => x.items.length > 0);

  return (
    <Page title={t('adm.today.al.title')} subtitle={t('adm.today.al.sub')}
      actions={(
        <>
          <button type="button" className="a-btn" onClick={() => void markRead(unread.map((n) => n.id))} disabled={!unread.length}>
            <CheckCheck className="h-3.5 w-3.5" />{t('notif.markAllRead')}
          </button>
          <button type="button" className="a-btn" onClick={() => void sweep()} disabled={busy === 'sweep'} title={t('adminAlerts.sweepHint')}>
            <Radar className="h-3.5 w-3.5" />{t('adminAlerts.sweepNow')}
          </button>
          <button type="button" className="a-btn a-btn--icon" aria-label={t('adm.today.refresh')} disabled={busy === 'refresh'}
            onClick={async () => { setBusy('refresh'); await load(); setBusy(null); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </>
      )}>
      <KpiRow>
        <Kpi label={t('adminAlerts.statTotal')} hint={t('notif.last30days')} loading={!rows} value={fmtNum(rows?.length ?? 0, lang)} />
        <Kpi label={t('adminAlerts.statUnread')} hint={t('notif.toProcess')} loading={!rows} value={fmtNum(unread.length, lang)} />
        <Kpi label={t('adminAlerts.statUrgent')} hint={t('notif.highPriority')} loading={!rows} value={fmtNum(urgent.length, lang)} />
      </KpiRow>

      <div className="flex flex-col gap-4">
        <Tabs items={tabs} value={tab} onChange={setTab} />
        {error && !rows ? <Card><ErrorState onRetry={() => void load()} /></Card>
          : !rows ? <div className="a-card flex flex-col gap-0">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="border-b p-4 last:border-b-0"><div className="a-skel h-4 w-1/3" /><div className="a-skel mt-2 h-3 w-2/3" /></div>)}</div>
            : groups.length === 0 ? (
              <Card><EmptyState title={tab === 'unread' ? t('notif.emptyUpToDate') : tab === 'urgent' ? t('notif.emptyNoUrgent') : t('adminAlerts.feedEmpty')} body={t('adminAlerts.feedEmptyHint')} /></Card>
            ) : groups.map(({ g, items }) => (
              <section key={g} className="flex flex-col gap-2">
                <h2 className="a-t3 text-[12px] font-medium">{t(GROUP_KEY[g])}</h2>
                <div className="a-card overflow-hidden">
                  {items.map((n) => {
                    const def = getNotifDef(n.notification_type);
                    const Icon = def.icon;
                    const cat = CATEGORY_META[def.category];
                    const isNew = !n.read_at;
                    return (
                      <button key={n.id} type="button" onClick={() => open(n)}
                        className="a-focus flex w-full items-start gap-3 border-0 border-b bg-transparent px-4 py-3 text-left font-[inherit] last:border-b-0 hover:bg-[var(--a-subtle)]"
                        style={{ cursor: 'pointer' }}>
                        <span className="grid h-8 w-8 flex-none place-items-center rounded-lg" style={{ background: 'var(--a-subtle)', color: isNew ? 'var(--a-text)' : 'var(--a-text-3)' }}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            {isNew && <span aria-label={t('notif.unread')} className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: 'var(--a-accent)' }} />}
                            <span className={`min-w-0 flex-1 truncate text-[13.5px] ${isNew ? 'a-t1 font-medium' : 'a-t2'}`}>{n.title}</span>
                            <span className="a-t3 a-num flex-none text-[12px]">{fmtRelative(n.created_at, lang)}</span>
                          </span>
                          <span className="a-t2 mt-0.5 line-clamp-2 block text-[13px] leading-snug">{n.message}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {n.priority === 'urgent' && <Badge tone="negative">{t('notif.urgent')}</Badge>}
                            {n.priority === 'high' && <Badge tone="warning">{t('adm.today.al.high')}</Badge>}
                            {cat && <Badge>{t(cat.label)}</Badge>}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
        <p className="a-t3 text-[12px]">
          {t('adm.today.al.foot')} <Link to="/admin/today/feedback" className="underline">{t('adm.nav2.today.feedback')}</Link>.{' '}
          {t('adm.today.al.transfers')} : <Link to="/admin/money/issues" className="underline">{t('adm.nav2.money.issues')}</Link>.
        </p>
      </div>
    </Page>
  );
}
