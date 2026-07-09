import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ScanEntity } from '@/lib/scan/types';

/**
 * Persistance locale du scan offline (app Yuno Pro uniquement).
 * Trois stores :
 *  - manifests     : le manifeste de scan d'un événement (PII — purgé à la
 *                    déconnexion, à la fin de l'event +24 h, TTL absolu 48 h)
 *  - local_scans   : set des QR validés localement (anti double-scan qui
 *                    survit au kill de l'app)
 *  - pending_queue : scans en attente de rejeu vers sync_offline_scans
 */

export interface ManifestEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  venue_id: string;
  alcohol_free?: boolean | null;
}

export interface ManifestEntry {
  id: string;
  qr: string;
  name: string | null;
  status: string;
  scanned: boolean;
  scanned_at: string | null;
  // billets
  ticket_id?: string;
  qty?: number;
  round?: string | null;
  drink?: boolean | null;
  // guest list
  entry_deadline?: string | null;
  entry_type?: string | null;
  gl_deadline?: string | null;
  free_before?: string | null;
  gl_drink?: boolean | null;
  // tables
  guests?: number | null;
  zone?: string | null;
  pack?: string | null;
  deposit?: number | null;
  total?: number | null;
}

export interface ScanManifest {
  generated_at: string;
  event: ManifestEvent;
  attendees: ManifestEntry[];
  tickets: ManifestEntry[];
  guest_list: ManifestEntry[];
  tables: ManifestEntry[];
}

export interface StoredManifest {
  eventId: string;
  venueId: string;
  fetchedAt: string;
  manifest: ScanManifest;
}

export interface LocalScan {
  qr: string;
  eventId: string;
  entityType: ScanEntity['type'];
  entityId: string;
  scannedAt: string;
  synced: boolean;
}

export interface PendingScan {
  client_id: string;
  entity_type: ScanEntity['type'];
  entity_id: string;
  qr: string;
  scanned_at: string;
  device_id: string;
  event_id: string;
  attempts: number;
}

interface OfflineDB extends DBSchema {
  manifests: { key: string; value: StoredManifest };
  local_scans: { key: string; value: LocalScan; indexes: { by_event: string } };
  pending_queue: { key: string; value: PendingScan; indexes: { by_event: string } };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function getOfflineDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>('yuno-pro-offline', 1, {
      upgrade(db) {
        db.createObjectStore('manifests', { keyPath: 'eventId' });
        const scans = db.createObjectStore('local_scans', { keyPath: 'qr' });
        scans.createIndex('by_event', 'eventId');
        const queue = db.createObjectStore('pending_queue', { keyPath: 'client_id' });
        queue.createIndex('by_event', 'event_id');
      },
    });
  }
  return dbPromise;
}

/** Identifiant stable du device pour l'audit des scans offline. */
export function getDeviceId(): string {
  const KEY = 'yuno_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

/** Purge complète (déconnexion staff) — manifestes, sets locaux, file d'attente. */
export async function purgeAllOfflineData(): Promise<void> {
  try {
    const db = await getOfflineDb();
    await Promise.all([
      db.clear('manifests'),
      db.clear('local_scans'),
      db.clear('pending_queue'),
    ]);
  } catch {
    // IDB indisponible : rien à purger.
  }
}
