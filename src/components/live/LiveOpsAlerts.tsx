import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronRight, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { getNightWindow } from '@/lib/liveops/nightWindow';
import { getNotifDef, notifLink, getFeedConfig, type AppNotif } from '@/lib/notifications';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED    = '#E8192C';
const AMBER  = '#FCD34D';
const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.58)';
const T3     = 'rgba(255,255,255,0.36)';

interface Props {
  venueId: string;
  /** '/owner' ou '/manager' — route les deep-links des actions. */
  basePath?: string;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  urgent: { bg: 'rgba(232,25,44,0.09)', border: 'rgba(232,25,44,0.3)', color: RED },
  high:   { bg: 'rgba(252,211,77,0.07)', border: 'rgba(252,211,77,0.25)', color: AMBER },
  normal: { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.1)', color: T2 },
  low:    { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.08)', color: T3 },
};

/**
 * Alertes live ops persistées : lit les staff_notifications `liveops_%` de la
 * nuit (générées par le moteur serveur du cron 5 min), écoute la table en
 * realtime, et matérialise le dismiss en `read_at` — il survit donc au reload
 * et reste synchronisé avec la cloche de notifications. Chaque alerte porte
 * son action : ouvrir la commande/table concernée, ou pré-remplir un push
 * flash drinks quand le bar peut absorber plus.
 */
export function LiveOpsAlerts({ venueId, basePath = '/owner' }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AppNotif[]>([]);

  const fetchAlerts = useCallback(async () => {
    const { start, end } = getNightWindow();
    const { data } = await supabase
      .from('staff_notifications')
      .select('id, title, message, notification_type, priority, created_at, read_at, event_id, reference_type, reference_id, metadata')
      .eq('venue_id', venueId)
      .like('notification_type', 'liveops_%')
      .is('read_at', null)
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })
      .limit(6);
    setAlerts((data as unknown as AppNotif[]) || []);
  }, [venueId]);

  useEffect(() => {
    if (!venueId) return;
    fetchAlerts();
    const channel = supabase
      .channel(uniqueChannel('liveops-alerts'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_notifications', filter: `venue_id=eq.${venueId}` }, (payload) => {
        const type = (payload.new as { notification_type?: string })?.notification_type || '';
        if (type.startsWith('liveops_')) fetchAlerts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [venueId, fetchAlerts]);

  const dismiss = async (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    await supabase
      .from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
  };

  if (alerts.length === 0) return null;

  const feedConfig = getFeedConfig({ scope: 'venue', venueId, organizerUserId: null, basePath });

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {alerts.map(alert => {
          const style = SEVERITY_STYLE[alert.priority] ?? SEVERITY_STYLE.normal;
          const Icon = getNotifDef(alert.notification_type).icon;
          const link = feedConfig ? notifLink(alert, feedConfig) : null;
          const showFlashDrinks = alert.notification_type === 'liveops_bar_backlog' || alert.notification_type === 'liveops_door_slow';
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="flex items-start gap-3 px-4 py-3 rounded-2xl"
              style={{ background: style.bg, border: `1px solid ${style.border}` }}
            >
              <Icon className="h-4 w-4 flex-none mt-0.5" style={{ color: style.color }} />
              <div className="flex-1 min-w-0">
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{alert.title}</p>
                <p style={{ color: T2, fontSize: 12, marginTop: 2 }}>{alert.message}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {link && link !== `${basePath}/live` && (
                    <button
                      onClick={() => navigate(link)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: T2, fontSize: 11, fontWeight: 600 }}
                    >
                      {t('liveops.alert.open')}
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                  {showFlashDrinks && (
                    <button
                      onClick={() => navigate(`${basePath}/push?prefill=flash_drinks`)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer"
                      style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 11, fontWeight: 600 }}
                    >
                      <Send className="h-3 w-3" />
                      {t('liveops.alert.flashDrinks')}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-none">
                <span className="tabular-nums" style={{ color: T3, fontSize: 10.5 }}>
                  {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button onClick={() => dismiss(alert.id)} className="cursor-pointer p-1 -m-1" style={{ color: T3 }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
