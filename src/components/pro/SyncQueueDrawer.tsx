import { useEffect, useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { RefreshCw, CloudOff, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { getOfflineDb, type PendingScan } from '@/lib/offline/db';
import type { ReplaySummary } from '@/lib/offline/queue';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Tiroir de synchronisation du scan offline (app Yuno Pro) : liste des scans
 * en attente de rejeu, bouton « Synchroniser maintenant », résumé du dernier
 * rejeu (appliqués / conflits « déjà scanné sur un autre appareil »).
 */
export function SyncQueueDrawer({
  open,
  onOpenChange,
  eventId,
  pending,
  lastSummary,
  onSync,
  online,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  pending: number;
  lastSummary: ReplaySummary | null;
  onSync: () => Promise<unknown>;
  online: boolean;
}) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<PendingScan[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open || !eventId) return;
    getOfflineDb()
      .then((db) => db.getAllFromIndex('pending_queue', 'by_event', eventId))
      .then((rows) => setItems(rows.sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))))
      .catch(() => setItems([]));
  }, [open, eventId, pending]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  };

  const timeFmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const typeLabel = (type: PendingScan['entity_type']) =>
    type === 'guest_list_entry' ? t('offline.type.guestList')
    : type === 'table_reservation' ? t('offline.type.table')
    : t('offline.type.ticket');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="bg-[#0a0a0c] border-white/10">
        <DrawerHeader>
          <DrawerTitle className="text-white">{t('offline.drawer.title')}</DrawerTitle>
          <DrawerDescription>
            {pending > 0
              ? t('offline.drawer.pending').replace('{count}', String(pending))
              : t('offline.drawer.empty')}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4 max-h-[50vh] overflow-y-auto">
          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.client_id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <CloudOff className="h-3.5 w-3.5 flex-none text-white/40" />
                    <span className="truncate text-sm text-white/80">{typeLabel(item.entity_type)}</span>
                  </span>
                  <span className="flex-none text-xs tabular-nums text-white/40">{timeFmt(item.scanned_at)}</span>
                </li>
              ))}
            </ul>
          )}

          {lastSummary && (lastSummary.applied > 0 || lastSummary.conflicts.length > 0) && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
              {lastSummary.applied > 0 && (
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t('offline.drawer.applied').replace('{count}', String(lastSummary.applied))}
                </p>
              )}
              {lastSummary.conflicts.map((c) => (
                <p key={c.client_id} className="flex items-center gap-2 text-sm text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 flex-none" />
                  {t('offline.drawer.conflict').replace(
                    '{time}',
                    c.conflict_scanned_at ? timeFmt(c.conflict_scanned_at) : '—',
                  )}
                </p>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!online || syncing || pending === 0}
            onClick={handleSync}
          >
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {online ? t('offline.drawer.syncNow') : t('offline.drawer.waitingNetwork')}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
