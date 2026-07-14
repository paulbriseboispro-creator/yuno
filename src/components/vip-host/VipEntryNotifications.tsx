import { useState } from 'react';
import { StaffNotification } from '@/hooks/useStaffNotifications';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const INNER_BG = 'rgba(255,255,255,0.032)';
import { 
  Crown, Users, MapPin, Clock, CheckCircle2, 
  Bell, BellOff, Sparkles 
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr, es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';

interface VipEntryNotificationsProps {
  notifications: StaffNotification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onPlaceGuest: (reservationId: string) => void;
}

export function VipEntryNotifications({ 
  notifications, 
  onMarkAsRead, 
  onMarkAllAsRead,
  onPlaceGuest 
}: VipEntryNotificationsProps) {
  const { language, t } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : undefined;

  // Filter to only show VIP entry notifications
  const entryNotifications = notifications.filter(
    n => n.notificationType === 'vip_entry' && !n.readAt
  );

  if (entryNotifications.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: T3 }}>
        <BellOff className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
        <p className="text-sm">{t('vip.noNewArrivals')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Crown className="w-4 h-4 shrink-0" style={{ color: RED }} />
          <h3 className="min-w-0 truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('vip.newArrivals')}</h3>
          <span className="h-5 shrink-0 px-1.5 text-xs rounded-full flex items-center tabular-nums" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}>
            {entryNotifications.length}
          </span>
        </div>
        {entryNotifications.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 shrink-0 text-xs h-10"
            onClick={onMarkAllAsRead}
          >
            <span className="truncate">{t('vip.markAllRead')}</span>
          </Button>
        )}
      </div>

      <ScrollArea className="max-h-[400px]">
        <div className="space-y-2">
          {entryNotifications.map((notification) => {
            const metadata = notification.metadata || {};
            const timeAgo = formatDistanceToNow(new Date(notification.createdAt), { 
              addSuffix: true, 
              locale 
            });

            return (
              <div
                key={notification.id}
                className="p-3 transition-all"
                style={notification.priority === 'high' || notification.priority === 'urgent'
                  ? { border: '1px solid rgba(232,25,44,0.5)', background: 'rgba(232,25,44,0.05)', borderRadius: 14 }
                  : { border: `1px solid ${BORDER}`, background: INNER_BG, borderRadius: 14 }
                }
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                    <Sparkles className="w-5 h-5" style={{ color: RED }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="truncate" style={{ color: T1, fontWeight: 600 }}>
                        {metadata.guest_name || 'VIP Guest'}
                      </h4>
                      {notification.priority === 'high' && (
                        <span className="shrink-0 text-[10px] px-1.5 rounded-full" style={{ color: RED, border: `1px solid ${RED}` }}>
                          VIP
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-2" style={{ color: T3 }}>
                      <span className="flex items-center gap-1 tabular-nums">
                        <Users className="w-3 h-3" />
                        {metadata.guest_count || 1} pers.
                      </span>
                      {metadata.zone_name && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {metadata.zone_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeAgo}
                      </span>
                    </div>

                    {metadata.deposit && (
                      <div className="text-xs mb-2" style={{ color: T3 }}>
                        {t('vip.deposit')}: <span className="font-medium tabular-nums" style={{ color: T1 }}>{metadata.deposit}€</span>
                        {metadata.pack_name && ` • ${metadata.pack_name}`}
                      </div>
                    )}

                    {/* h-10 : cible tactile utilisable dans le noir, doigts en mouvement. */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-10 min-w-0 text-xs"
                        onClick={() => {
                          if (notification.referenceId) {
                            onPlaceGuest(notification.referenceId);
                          }
                          onMarkAsRead(notification.id);
                        }}
                      >
                        <MapPin className="w-3 h-3 mr-1 shrink-0" />
                        <span className="truncate">{t('vip.place')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 min-w-0 text-xs"
                        onClick={() => onMarkAsRead(notification.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1 shrink-0" />
                        <span className="truncate">{t('vip.ok')}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
