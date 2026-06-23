import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Bell, ChevronRight, CheckCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { type AppNotif, type FeedConfig, getNotifDef, PRIORITY_CONFIG } from '@/lib/notifications';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);
const PREVIEW_LIMIT = 6;

function mapRow(n: any): AppNotif {
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    notification_type: n.notification_type,
    priority: n.priority ?? 'normal',
    created_at: n.created_at,
    read_at: n.read_at,
    event_id: n.event_id ?? null,
    reference_type: n.reference_type ?? null,
    reference_id: n.reference_id ?? null,
    metadata: n.metadata ?? {},
  };
}

/**
 * Bell button + preview popover. Self-contained: given a scope-aware FeedConfig
 * it tracks the unread count (live), shows the latest few notifications in a
 * dropdown on click, and links through to the full inbox. Used both on the
 * shared dashboard header cluster and on every sub-page header.
 */
export function NotificationsBell({ config }: { config: FeedConfig | null }) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotif[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedOnce = useRef(false);

  const table = config?.table;
  const filterColumn = config?.filterColumn;
  const filterValue = config?.filterValue;

  // Live unread count (last 30 days), kept in sync via realtime.
  useEffect(() => {
    if (!config || !table || !filterColumn || !filterValue) return;
    let active = true;

    const fetchCount = async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { count } = await (supabase.from(table as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq(filterColumn, filterValue)
        .is('read_at', null)
        .gte('created_at', since.toISOString());
      if (active) setUnread(count ?? 0);
    };

    fetchCount();

    const channel = supabase
      .channel(`bell_${config.channelKey}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: config.realtimeFilter }, () => {
        setUnread((p) => p + 1);
        loadedOnce.current = false; // force a refresh of the preview list next open
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: config.realtimeFilter }, () => {
        fetchCount();
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [table, filterColumn, filterValue, config?.channelKey, config?.realtimeFilter]);

  const fetchPreview = useCallback(async () => {
    if (!table || !filterColumn || !filterValue) return;
    setLoading(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await (supabase.from(table as any) as any)
        .select('*')
        .eq(filterColumn, filterValue)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(PREVIEW_LIMIT);
      setItems((data ?? []).map(mapRow));
      loadedOnce.current = true;
    } finally {
      setLoading(false);
    }
  }, [table, filterColumn, filterValue]);

  // Load the preview the first time the popover opens (and after new arrivals).
  useEffect(() => {
    if (open && !loadedOnce.current) fetchPreview();
  }, [open, fetchPreview]);

  const markAllRead = useCallback(async () => {
    if (!table || !filterColumn || !filterValue || unread === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from(table as any) as any)
      .update({ read_at: new Date().toISOString(), read_by: user?.id })
      .eq(filterColumn, filterValue)
      .is('read_at', null);
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }, [table, filterColumn, filterValue, unread]);

  const markOneRead = useCallback(async (id: string) => {
    if (!table) return;
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from(table as any) as any)
      .update({ read_at: new Date().toISOString(), read_by: user?.id })
      .eq('id', id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnread((p) => Math.max(0, p - 1));
  }, [table]);

  // No feed available for this scope (e.g. owner without a venue yet).
  if (!config) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={t('header.notifications')}
            >
              <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8192C] px-1 text-[9px] font-bold text-white leading-none">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">{t('header.notifications')}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[340px] max-w-[calc(100vw-1.5rem)] p-0 overflow-hidden border-white/[0.08] bg-[#0a0a0c]/95 backdrop-blur-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-2.5">
          <p className="text-sm font-semibold text-white/90">{t('notif.previewTitle')}</p>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-white/80 transition-colors cursor-pointer"
            >
              <CheckCheck className="h-3 w-3" />
              {t('notif.markAllRead')}
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-[min(60vh,380px)] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="space-y-1.5 p-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-white/[0.025] animate-pulse" style={{ opacity: 1 - (i - 1) * 0.25 }} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
                <Bell className="h-5 w-5 text-white/20" />
              </div>
              <p className="text-xs font-medium text-white/55">{t('notif.previewEmpty')}</p>
              <p className="text-[11px] text-white/30">{t('notif.previewEmptyDesc')}</p>
            </div>
          ) : (
            <div className="p-1.5">
              {items.map((n) => {
                const def = getNotifDef(n.notification_type);
                const Icon = def.icon;
                const p = PRIORITY_CONFIG[n.priority] ?? PRIORITY_CONFIG.normal;
                const isUnread = !n.read_at;
                return (
                  <button
                    key={n.id}
                    onClick={() => isUnread && markOneRead(n.id)}
                    className={[
                      'group flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      isUnread ? 'bg-white/[0.035] hover:bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                    ].join(' ')}
                  >
                    <div className={[
                      'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border',
                      isUnread ? 'bg-white/[0.06] border-white/[0.10]' : 'bg-white/[0.02] border-white/[0.05]',
                    ].join(' ')}>
                      <Icon className={`h-3.5 w-3.5 ${isUnread ? p.icon : 'text-white/25'}`} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`truncate text-[13px] font-medium leading-snug ${isUnread ? 'text-white/95' : 'text-white/45'}`}>
                          {n.title}
                        </p>
                        {isUnread && <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${p.dot}`} />}
                      </div>
                      <p className={`truncate text-[11px] leading-snug ${isUnread ? 'text-white/55' : 'text-white/30'}`}>
                        {n.message}
                      </p>
                      <span className="mt-0.5 text-[10px] text-white/25 tabular-nums">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dfLocale(language) })}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <Link
          to={config.pagePath}
          onClick={() => setOpen(false)}
          className="flex items-center justify-center gap-1 border-t border-white/[0.06] px-3.5 py-2.5 text-xs font-medium text-white/60 hover:text-white hover:bg-white/[0.03] transition-colors cursor-pointer"
        >
          {t('notif.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
