import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { motion } from 'framer-motion';

import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import {
  type AppNotif, getNotifDef, notifLink, PRIORITY_CONFIG,
} from '@/lib/notifications';
import {
  AffPage, AffHeading, AffCard, AffSpinner, RED, T1, T2, T3, BORDER, C_FAINT,
} from '@/components/affiliate/affiliate-ui';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

function mapRow(n: Record<string, unknown>): AppNotif {
  return {
    id: String(n.id),
    title: String(n.title ?? ''),
    message: String(n.message ?? ''),
    notification_type: String(n.notification_type ?? ''),
    priority: (n.priority as AppNotif['priority']) ?? 'normal',
    created_at: String(n.created_at),
    read_at: (n.read_at as string | null) ?? null,
    event_id: null,
    reference_type: (n.reference_type as string | null) ?? null,
    reference_id: (n.reference_id as string | null) ?? null,
    metadata: (n.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * Boîte de réception de l'espace affilié : la version pleine page de la
 * cloche du header. Liens promo soumis, linktrees à valider, assignations,
 * messages de l'agence — tout ce que le flux affilié émet.
 */
export default function AffiliateInbox() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const shell = useAffiliateShell();
  const config = shell?.feedConfig ?? null;

  const [items, setItems] = useState<AppNotif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!config) return;
    let active = true;
    (async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - 60);
      const { data } = await supabase
        .from('affiliate_app_notifications')
        .select('*')
        .eq('feed_key', config.filterValue)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);
      if (active) {
        setItems((data ?? []).map(mapRow));
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [config?.filterValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = items.filter(n => !n.read_at).length;

  const markOneRead = useCallback(async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from('affiliate_app_notifications')
      .update({ read_at: new Date().toISOString(), read_by: user?.id })
      .eq('id', id);
    setItems(prev => prev.map(n => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!config || unread === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from('affiliate_app_notifications')
      .update({ read_at: new Date().toISOString(), read_by: user?.id })
      .eq('feed_key', config.filterValue)
      .is('read_at', null);
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }, [config, unread]);

  const handleRowClick = useCallback((n: AppNotif) => {
    if (!config) return;
    if (!n.read_at) markOneRead(n.id);
    const link = notifLink(n, config);
    if (link) navigate(link);
  }, [config, markOneRead, navigate]);

  if (loading) return <AffSpinner />;

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <AffHeading
            title={t('aff.inbox.title')}
            subtitle={unread > 0 ? `${unread} ${t('aff.inbox.unread')}` : t('aff.inbox.subtitle')}
          />
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 cursor-pointer transition-colors mb-1"
              style={{ color: T3, fontSize: 12.5, fontWeight: 500 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = T1)}
              onMouseLeave={(e) => (e.currentTarget.style.color = T3)}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t('notif.markAllRead')}
            </button>
          )}
        </div>
      </motion.div>

      {items.length === 0 ? (
        <AffCard padding={32}>
          <div className="flex flex-col items-center justify-center gap-2 text-center py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
              <Bell className="h-5 w-5" style={{ color: T3 }} />
            </div>
            <p style={{ color: T2, fontSize: 13.5, fontWeight: 600 }}>{t('aff.inbox.empty')}</p>
            <p style={{ color: T3, fontSize: 12 }}>{t('aff.inbox.emptyDesc')}</p>
          </div>
        </AffCard>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <AffCard padding={8}>
            <div className="space-y-1">
              {items.map((n) => {
                const def = getNotifDef(n.notification_type);
                const Icon = def.icon;
                const p = PRIORITY_CONFIG[n.priority] ?? PRIORITY_CONFIG.normal;
                const isUnread = !n.read_at;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowClick(n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(n); }
                    }}
                    className="group flex w-full cursor-pointer gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                    style={isUnread ? { background: 'rgba(255,255,255,0.035)' } : undefined}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isUnread ? 'rgba(255,255,255,0.035)' : 'transparent')}
                  >
                    <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: isUnread ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}>
                      <Icon className={`h-4 w-4 ${isUnread ? p.icon : ''}`} style={isUnread ? undefined : { color: T3 }} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate" style={{ color: isUnread ? T1 : T3, fontSize: 13.5, fontWeight: 600 }}>
                          {n.title}
                        </p>
                        {isUnread && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: RED }} />}
                      </div>
                      <p style={{ color: isUnread ? T2 : T3, fontSize: 12, lineHeight: 1.45 }}>
                        {n.message}
                      </p>
                      <span className="tabular-nums" style={{ color: T3, fontSize: 10.5, marginTop: 3 }}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dfLocale(language) })}
                      </span>
                    </div>
                    {isUnread && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); markOneRead(n.id); }}
                        title={t('notif.markRead')}
                        aria-label={t('notif.markRead')}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center self-center rounded-md transition-colors cursor-pointer"
                        style={{ color: T3 }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = T1; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = T3; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </AffCard>
        </motion.div>
      )}
    </AffPage>
  );
}
