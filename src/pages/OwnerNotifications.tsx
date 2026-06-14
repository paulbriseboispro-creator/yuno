import { useState, useEffect, useCallback, useRef } from 'react';
import { formatDistanceToNow, isToday, isYesterday, isAfter, subDays } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);
import {
  Bell, BellOff, CheckCheck, RefreshCw,
  ShoppingCart, Ticket, Crown, Users, Star,
  Heart, Zap, BarChart3, Mail, Calendar,
  AlertCircle, Info, Radio, TrendingUp,
  ChevronRight, UserCheck, AlertTriangle, Receipt,
} from 'lucide-react';

import { OwnerHeader } from '@/components/OwnerHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useVenueContext } from '@/hooks/useVenueContext';
import { supabase } from '@/integrations/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OwnerNotif {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  target_role: string;
  created_at: string;
  read_at: string | null;
  event_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
}

type TabFilter = 'all' | 'unread' | 'urgent';

// ─── Notification catalogue ───────────────────────────────────────────────────

interface NotifDef {
  icon: React.ElementType;
  category: string;
  label: string;
}

const NOTIF_CATALOGUE: Record<string, NotifDef> = {
  // 💰 Revenue
  new_order:      { icon: ShoppingCart, category: 'revenue',    label: 'notif.type.new_order' },
  ticket_sale:    { icon: Ticket,       category: 'revenue',    label: 'notif.type.ticket_sale' },
  table_booked:   { icon: Crown,        category: 'revenue',    label: 'notif.type.table_booked' },
  promoter_sale:  { icon: TrendingUp,   category: 'revenue',    label: 'notif.type.promoter_sale' },
  refund_issued:  { icon: Receipt,      category: 'revenue',    label: 'notif.type.refund_issued' },
  // 🎟️ Capacity
  ticket_round_warning:  { icon: AlertTriangle, category: 'capacity', label: 'notif.type.ticket_round_warning' },
  ticket_round_sold_out: { icon: Ticket,        category: 'capacity', label: 'notif.type.ticket_round_sold_out' },
  tables_warning:        { icon: AlertTriangle, category: 'capacity', label: 'notif.type.tables_warning' },
  tables_sold_out:       { icon: Crown,         category: 'capacity', label: 'notif.type.tables_sold_out' },
  // 📅 Events
  event_starting: { icon: Radio,     category: 'events', label: 'notif.type.event_starting' },
  event_ended:    { icon: BarChart3, category: 'events', label: 'notif.type.event_ended' },
  // 🤝 People
  connection_accepted: { icon: UserCheck, category: 'people', label: 'notif.type.connection_accepted' },
  staff_login:         { icon: Users,     category: 'people', label: 'notif.type.staff_login' },
  favorite_added:      { icon: Heart,     category: 'people', label: 'notif.type.favorite_added' },
  // 📧 Marketing
  campaign_sent: { icon: Mail, category: 'marketing', label: 'notif.type.campaign_sent' },
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  revenue:   { label: 'notif.cat.revenue',    color: 'text-emerald-400' },
  capacity:  { label: 'notif.cat.capacity',   color: 'text-orange-400'  },
  events:    { label: 'notif.cat.events',     color: 'text-blue-400'    },
  people:    { label: 'notif.cat.people',     color: 'text-purple-400'  },
  marketing: { label: 'notif.cat.marketing',  color: 'text-pink-400'    },
};

function getNotifDef(type: string): NotifDef {
  return NOTIF_CATALOGUE[type] ?? { icon: Info, category: 'other', label: type };
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  urgent: {
    dot: 'bg-[#E8192C]',
    badge: 'bg-[rgba(232,25,44,0.15)] text-[#E8192C] border-[rgba(232,25,44,0.25)]',
    glow: 'shadow-[0_0_12px_rgba(232,25,44,0.18)]',
    icon: 'text-[#E8192C]',
    label: 'notif.prio.urgent',
  },
  high: {
    dot: 'bg-orange-400',
    badge: 'bg-orange-400/10 text-orange-400 border-orange-400/20',
    glow: 'shadow-[0_0_8px_rgba(251,146,60,0.12)]',
    icon: 'text-orange-400',
    label: 'notif.prio.high',
  },
  normal: {
    dot: 'bg-blue-400',
    badge: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    glow: '',
    icon: 'text-blue-400',
    label: 'notif.prio.normal',
  },
  low: {
    dot: 'bg-white/20',
    badge: 'bg-white/5 text-white/30 border-white/10',
    glow: '',
    icon: 'text-white/30',
    label: 'notif.prio.low',
  },
};

// ─── Grouping helpers ─────────────────────────────────────────────────────────

function groupByTime(notifications: OwnerNotif[]) {
  const now = new Date();
  const groups: { label: string; items: OwnerNotif[] }[] = [
    { label: 'notif.today',     items: [] },
    { label: 'notif.yesterday', items: [] },
    { label: 'notif.thisWeek',  items: [] },
    { label: 'notif.older',     items: [] },
  ];
  for (const n of notifications) {
    const d = new Date(n.created_at);
    if (isToday(d))                        groups[0].items.push(n);
    else if (isYesterday(d))               groups[1].items.push(n);
    else if (isAfter(d, subDays(now, 7)))  groups[2].items.push(n);
    else                                   groups[3].items.push(n);
  }
  return groups.filter(g => g.items.length > 0);
}

// ─── Notification card ────────────────────────────────────────────────────────

function NotifCard({ notif, onMarkRead }: { notif: OwnerNotif; onMarkRead: (id: string) => void }) {
  const { t, language } = useLanguage();
  const def = getNotifDef(notif.notification_type);
  const Icon = def.icon;
  const p = PRIORITY_CONFIG[notif.priority] ?? PRIORITY_CONFIG.normal;
  const isUnread = !notif.read_at;
  const catMeta = CATEGORY_META[def.category];

  // Extra stats panel for event_ended
  const isEventEnded = notif.notification_type === 'event_ended';
  const meta = notif.metadata;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={[
        'group relative flex gap-3 rounded-xl border p-4 transition-all duration-200 cursor-default',
        isUnread
          ? `bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.12] ${notif.priority === 'urgent' || notif.priority === 'high' ? p.glow : ''}`
          : 'bg-transparent border-white/[0.03] hover:bg-white/[0.02]',
      ].join(' ')}
    >
      {isUnread && (
        <span className={`absolute top-4 right-4 h-1.5 w-1.5 rounded-full ${p.dot} flex-shrink-0`} />
      )}

      {/* Icon */}
      <div className={[
        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border mt-0.5',
        isUnread ? 'bg-white/[0.06] border-white/[0.10]' : 'bg-white/[0.02] border-white/[0.05]',
      ].join(' ')}>
        <Icon className={`h-4 w-4 ${isUnread ? p.icon : 'text-white/25'}`} />
      </div>

      {/* Body */}
      <div className="flex flex-1 min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium leading-snug ${isUnread ? 'text-white' : 'text-white/45'}`}>
            {notif.title}
          </p>
          <span className="text-[11px] text-white/25 tabular-nums flex-shrink-0">
            {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: dfLocale(language) })}
          </span>
        </div>

        <p className={`text-xs leading-relaxed ${isUnread ? 'text-white/60' : 'text-white/28'}`}>
          {notif.message}
        </p>

        {/* Event ended stats panel */}
        {isEventEnded && meta && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {[
              { label: t('notif.statTickets'),   value: meta.tickets_sold as number,    sub: `${meta.scan_rate ?? 0}% ${t('notif.scanned')}` },
              { label: t('notif.statOrders'), value: meta.orders_count as number,    sub: `${Number(meta.order_revenue ?? 0).toFixed(0)} €` },
              { label: t('notif.statTotal'),  value: `${Number(meta.total_revenue ?? 0).toFixed(2)} €`, sub: `${t('notif.tablesPrefix')}: ${meta.table_reservations ?? 0}` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-center">
                <p className="text-sm font-semibold text-white/80 tabular-nums">{s.value}</p>
                <p className="text-[9px] text-white/40 mt-0.5">{s.label}</p>
                <p className="text-[9px] text-white/25">{s.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Chips */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {notif.priority !== 'normal' && notif.priority !== 'low' && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${p.badge}`}>
              {notif.priority === 'urgent' && <Zap className="h-2.5 w-2.5" />}
              {notif.priority === 'high'   && <AlertCircle className="h-2.5 w-2.5" />}
              {t(p.label)}
            </span>
          )}
          {catMeta && (
            <span className={`text-[10px] ${isUnread ? catMeta.color : 'text-white/25'}`}>
              {t(catMeta.label)}
            </span>
          )}
        </div>
      </div>

      {/* Mark read button */}
      {isUnread && (
        <button
          onClick={() => onMarkRead(notif.id)}
          className="flex-shrink-0 self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/[0.08] text-white/30 hover:text-white/60 cursor-pointer"
          title="Marquer comme lu"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: TabFilter }) {
  const { t } = useLanguage();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
        <BellOff className="h-6 w-6 text-white/20" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-white/60">
          {tab === 'unread' ? t('notif.emptyUpToDate') : tab === 'urgent' ? t('notif.emptyNoUrgent') : t('notif.emptyNone')}
        </p>
        <p className="text-xs text-white/30">
          {tab === 'unread'
            ? t('notif.emptyUpToDateDesc')
            : tab === 'urgent'
            ? t('notif.emptyNoUrgentDesc')
            : t('notif.emptyNoneDesc')}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OwnerNotifications() {
  const { t } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();

  const [notifications, setNotifications] = useState<OwnerNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabFilter>('all');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const mapRow = (n: any): OwnerNotif => ({
    id: n.id,
    title: n.title,
    message: n.message,
    notification_type: n.notification_type,
    priority: n.priority ?? 'normal',
    target_role: n.target_role,
    created_at: n.created_at,
    read_at: n.read_at,
    event_id: n.event_id ?? null,
    reference_type: n.reference_type ?? null,
    reference_id: n.reference_id ?? null,
    metadata: n.metadata ?? {},
  });

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!venueId) return;
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await supabase
        .from('staff_notifications')
        .select('*')
        .eq('venue_id', venueId)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(150);
      setNotifications((data ?? []).map(mapRow));
    } catch (e) {
      console.error('Error fetching owner notifications:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (!venueId) return;
    fetchNotifications();
    channelRef.current = supabase
      .channel(`owner_notifications_page_${venueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_notifications', filter: `venue_id=eq.${venueId}` },
        (payload) => setNotifications(prev => [mapRow(payload.new), ...prev])
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'staff_notifications', filter: `venue_id=eq.${venueId}` },
        (payload) => setNotifications(prev => prev.map(n => n.id === (payload.new as any).id ? mapRow(payload.new) : n))
      )
      .subscribe();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [venueId, fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('staff_notifications')
        .update({ read_at: new Date().toISOString(), read_by: user?.id })
        .eq('id', id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    } catch (e) { console.error(e); }
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!venueId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const unread = notifications.filter(n => !n.read_at);
      if (!unread.length) return;
      await supabase.from('staff_notifications')
        .update({ read_at: new Date().toISOString(), read_by: user?.id })
        .in('id', unread.map(n => n.id));
      setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    } catch (e) { console.error(e); }
  }, [venueId, notifications]);

  const filtered = notifications.filter(n => {
    if (tab === 'unread')  return !n.read_at;
    if (tab === 'urgent')  return n.priority === 'urgent' || n.priority === 'high';
    return true;
  });

  const unreadCount  = notifications.filter(n => !n.read_at).length;
  const urgentCount  = notifications.filter(n => !n.read_at && (n.priority === 'urgent' || n.priority === 'high')).length;
  const groups       = groupByTime(filtered);

  // ── Category breakdown for stats ─────────────────────────────────────────
  const categoryCounts = Object.entries(CATEGORY_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    color: meta.color,
    count: notifications.filter(n => getNotifDef(n.notification_type).category === key).length,
    unread: notifications.filter(n => !n.read_at && getNotifDef(n.notification_type).category === key).length,
  })).filter(c => c.count > 0);

  if (venueLoading) {
    return <div className="min-h-screen dashboard-gradient-bg pb-24"><OwnerHeader title="Notifications" showBackButton /></div>;
  }

  return (
    <div className="min-h-screen dashboard-gradient-bg pb-24">
      <OwnerHeader
        title="Notifications"
        showBackButton
        rightContent={
          unreadCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAllAsRead}
              className="h-8 gap-1.5 px-3 text-xs text-white/50 hover:text-white/90 cursor-pointer"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t('notif.markAllRead')}
            </Button>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-2xl px-3 sm:px-4 pt-4 space-y-4">

        {/* Top stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: t('notif.total'),     value: notifications.length, sub: t('notif.last30days') },
            { label: t('notif.unread'),  value: unreadCount,  sub: t('notif.toProcess'),       accent: unreadCount > 0 },
            { label: t('notif.urgent'),  value: urgentCount,  sub: t('notif.highPriority'),  danger: urgentCount > 0 },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-center">
              <p className={`text-xl font-bold tabular-nums ${s.danger ? 'text-[#E8192C]' : s.accent ? 'text-white' : 'text-white/80'}`}>
                {s.value}
              </p>
              <p className="text-[10px] font-medium text-white/60 mt-0.5">{s.label}</p>
              <p className="text-[9px] text-white/25 mt-0.5 hidden sm:block">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Category pills */}
        {categoryCounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {categoryCounts.map(c => (
              <div key={c.key}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${c.unread > 0 ? 'bg-[#E8192C]' : 'bg-white/20'}`} />
                <span className={`text-[11px] font-medium ${c.unread > 0 ? c.color : 'text-white/35'}`}>{t(c.label)}</span>
                <span className="text-[10px] text-white/30 tabular-nums">{c.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tabs + refresh */}
        <div className="flex items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={v => setTab(v as TabFilter)} className="flex-1">
            <TabsList className="h-8 bg-white/[0.04] border border-white/[0.06] p-0.5 gap-0.5">
              <TabsTrigger value="all"
                className="h-7 flex-1 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                {t('notif.tabAll')}
              </TabsTrigger>
              <TabsTrigger value="unread"
                className="h-7 flex-1 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                {t('notif.unread')}
                {unreadCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8192C] px-1 text-[9px] font-bold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="urgent"
                className="h-7 flex-1 text-xs data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/50 cursor-pointer">
                {t('notif.urgent')}
                {urgentCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-400/20 px-1 text-[9px] font-bold text-orange-400">
                    {urgentCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="ghost" size="icon"
            className="h-8 w-8 flex-shrink-0 text-white/30 hover:text-white/70 cursor-pointer"
            onClick={() => fetchNotifications(true)} disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-2 pt-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-20 rounded-xl border border-white/[0.05] bg-white/[0.02] animate-pulse"
                style={{ opacity: 1 - (i - 1) * 0.2 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="space-y-5 pt-1">
            <AnimatePresence mode="popLayout">
              {groups.map(group => (
                <motion.section key={group.label} layout>
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-white/22">
                    {t(group.label)}
                  </p>
                  <div className="space-y-1.5">
                    {group.items.map(notif => (
                      <NotifCard key={notif.id} notif={notif} onMarkRead={markAsRead} />
                    ))}
                  </div>
                </motion.section>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
