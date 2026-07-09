import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchManifest, getStoredManifest, purgeExpiredManifests } from '@/lib/offline/manifest';
import { getOfflineDb, getDeviceId, type ManifestEntry, type StoredManifest } from '@/lib/offline/db';
import { enqueueScan, pendingCount, replayQueue, type ReplaySummary } from '@/lib/offline/queue';
import {
  validateTicketEntry,
  validateGuestListEntry,
  validateTableReservation,
} from '@/lib/scan/rules';
import type { ScanEntity, ScanVerdict } from '@/lib/scan/types';
import { useNetworkStatus } from '@/components/pro/OfflinePill';
import { isProApp } from '@/lib/native';

export interface OfflineScanResult {
  verdict: ScanVerdict;
  kind: 'ticket' | 'guest_list' | 'table' | 'not_found';
  name: string | null;
  entry: ManifestEntry | null;
  offline: true;
}

interface IndexedEntry {
  entry: ManifestEntry;
  entity: ScanEntity;
  kind: 'ticket' | 'guest_list' | 'table';
}

function buildIndex(stored: StoredManifest): Map<string, IndexedEntry> {
  const map = new Map<string, IndexedEntry>();
  const { manifest } = stored;
  const venueId = manifest.event.venue_id;

  for (const e of manifest.attendees) {
    map.set(e.qr, {
      entry: e,
      kind: 'ticket',
      entity: {
        type: 'ticket_attendee', id: e.id, ticketId: e.ticket_id || e.id,
        name: e.name, status: e.status, scanned: e.scanned, scannedAt: e.scanned_at, venueId,
      },
    });
  }
  for (const e of manifest.tickets) {
    if (map.has(e.qr)) continue; // les attendees priment (même ordre qu'online)
    map.set(e.qr, {
      entry: e,
      kind: 'ticket',
      entity: {
        type: 'ticket', id: e.id, ticketId: e.id,
        name: e.name, status: e.status, scanned: e.scanned, scannedAt: e.scanned_at, venueId,
      },
    });
  }
  for (const e of manifest.tables) {
    map.set(e.qr, {
      entry: e,
      kind: 'table',
      entity: {
        type: 'table_reservation', id: e.id,
        name: e.name, status: e.status, scanned: e.scanned, scannedAt: e.scanned_at, venueId,
      },
    });
  }
  for (const e of manifest.guest_list) {
    map.set(e.qr, {
      entry: e,
      kind: 'guest_list',
      entity: {
        type: 'guest_list_entry', id: e.id,
        name: e.name, status: e.status, scanned: e.scanned, scannedAt: e.scanned_at, venueId,
        entryDeadline: e.entry_deadline || null,
        glDeadline: e.gl_deadline || null,
        freeBeforeTime: e.free_before || null,
        eventStartAt: manifest.event.start_at,
      },
    });
  }
  return map;
}

/**
 * Orchestrateur du scan de porte offline (app Yuno Pro).
 * Manifeste pré-téléchargé (IndexedDB) + validation locale via les MÊMES
 * règles pures que le chemin online (src/lib/scan/rules.ts) + file de rejeu.
 */
export function useOfflineScanning(eventId: string | null, venueId: string | null) {
  const online = useNetworkStatus();
  const enabled = isProApp() && !!eventId;

  const [stored, setStored] = useState<StoredManifest | null>(null);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSummary, setLastSummary] = useState<ReplaySummary | null>(null);
  const indexRef = useRef<Map<string, IndexedEntry> | null>(null);

  const index = useMemo(() => {
    if (!stored) return null;
    const map = buildIndex(stored);
    indexRef.current = map;
    return map;
  }, [stored]);

  const refreshPending = useCallback(async () => {
    setPending(await pendingCount(eventId || undefined));
  }, [eventId]);

  const refreshManifest = useCallback(async () => {
    if (!enabled || !eventId) return;
    setRefreshing(true);
    try {
      const fresh = await fetchManifest(eventId);
      setStored(fresh);
    } catch {
      // Offline ou refus : garder le manifeste local existant.
      const local = await getStoredManifest(eventId);
      if (local) setStored(local);
    } finally {
      setRefreshing(false);
    }
  }, [enabled, eventId]);

  const replay = useCallback(async () => {
    const summary = await replayQueue();
    if (summary) {
      setLastSummary(summary);
      await refreshPending();
    }
    return summary;
  }, [refreshPending]);

  // Chargement initial + purge des manifestes expirés.
  useEffect(() => {
    if (!enabled || !eventId) return;
    purgeExpiredManifests();
    getStoredManifest(eventId).then((local) => { if (local) setStored(local); });
    refreshManifest();
    refreshPending();
  }, [enabled, eventId, refreshManifest, refreshPending]);

  // Refresh périodique du manifeste (5 min online) + rejeu de la file.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      if (navigator.onLine) {
        refreshManifest();
        replay();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [enabled, refreshManifest, replay]);

  // Rejeu au retour du réseau + au resume de l'app + toutes les 30 s si file non vide.
  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => replay();
    window.addEventListener('online', onOnline);

    let resumeCleanup: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) => {
      const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) { replay(); refreshManifest(); }
      });
      resumeCleanup = () => { sub.then((s) => s.remove()); };
    }).catch(() => {});

    const drain = setInterval(async () => {
      if (navigator.onLine && (await pendingCount()) > 0) replay();
    }, 30 * 1000);

    return () => {
      window.removeEventListener('online', onOnline);
      resumeCleanup?.();
      clearInterval(drain);
    };
  }, [enabled, replay, refreshManifest]);

  /**
   * Validation locale d'un QR contre le manifeste. Même ordre de règles que
   * le chemin online ; enregistre le scan localement + en file de rejeu.
   */
  const scanOffline = useCallback(async (qr: string): Promise<OfflineScanResult> => {
    const map = indexRef.current;
    const hit = map?.get(qr.trim());
    if (!hit || !eventId || !venueId) {
      return { verdict: { status: 'not_found' } as ScanVerdict, kind: 'not_found', name: null, entry: null, offline: true };
    }

    // Le set local prime sur le manifeste (scans offline précédents non synchronisés).
    const db = await getOfflineDb();
    const local = await db.get('local_scans', qr.trim());
    const entity: ScanEntity = local
      ? ({ ...hit.entity, scanned: true, scannedAt: local.scannedAt } as ScanEntity)
      : hit.entity;

    const ctx = { venueId, now: new Date(), mode: 'entry' as const };
    const verdict =
      entity.type === 'guest_list_entry' ? validateGuestListEntry(entity, ctx)
      : entity.type === 'table_reservation' ? validateTableReservation(entity, ctx)
      : validateTicketEntry(entity, ctx);

    if (verdict.status === 'success') {
      const scannedAt = new Date().toISOString();
      await db.put('local_scans', {
        qr: qr.trim(), eventId, entityType: entity.type, entityId: entity.id, scannedAt, synced: false,
      });
      await enqueueScan({
        client_id: crypto.randomUUID(),
        entity_type: entity.type,
        entity_id: entity.id,
        qr: qr.trim(),
        scanned_at: scannedAt,
        device_id: getDeviceId(),
        event_id: eventId,
      });
      await refreshPending();
      // Tentative de rejeu immédiate si le réseau est revenu entre-temps.
      if (navigator.onLine) replay();
    }

    return { verdict, kind: hit.kind, name: hit.entry.name, entry: hit.entry, offline: true };
  }, [eventId, venueId, refreshPending, replay]);

  const manifestAgeMs = stored ? Date.now() - new Date(stored.fetchedAt).getTime() : null;

  return {
    enabled,
    online,
    manifestReady: !!index,
    manifestAgeMs,
    manifestCount: index?.size ?? 0,
    pending,
    refreshing,
    lastSummary,
    scanOffline,
    refreshManifest,
    replay,
  };
}
