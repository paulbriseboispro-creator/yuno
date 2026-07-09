import { supabase } from '@/integrations/supabase/client';
import { getOfflineDb, type ScanManifest, type StoredManifest } from './db';

/**
 * Gestion du manifeste de scan offline : fetch via le RPC sécurisé
 * get_event_scan_manifest, stockage IndexedDB, purge automatique.
 */

/** TTL absolu d'un manifeste (PII) : purgé au-delà, même si l'event est actif. */
const MANIFEST_TTL_MS = 48 * 60 * 60 * 1000;
/** Rétention après la fin de l'événement. */
const AFTER_EVENT_MS = 24 * 60 * 60 * 1000;

export async function fetchManifest(eventId: string): Promise<StoredManifest> {
  const { data, error } = await supabase.rpc('get_event_scan_manifest' as never, {
    p_event_id: eventId,
  } as never);
  if (error) throw error;
  const manifest = data as unknown as ScanManifest;
  const stored: StoredManifest = {
    eventId,
    venueId: manifest.event.venue_id,
    fetchedAt: new Date().toISOString(),
    manifest,
  };
  const db = await getOfflineDb();
  await db.put('manifests', stored);
  return stored;
}

export async function getStoredManifest(eventId: string): Promise<StoredManifest | undefined> {
  try {
    const db = await getOfflineDb();
    return await db.get('manifests', eventId);
  } catch {
    return undefined;
  }
}

/**
 * Purge les manifestes expirés : fin d'event +24 h, ou TTL 48 h.
 * Nettoie aussi les scans locaux/queue des events purgés (déjà synchronisés
 * ou définitivement obsolètes).
 */
export async function purgeExpiredManifests(): Promise<void> {
  try {
    const db = await getOfflineDb();
    const all = await db.getAll('manifests');
    const now = Date.now();
    for (const m of all) {
      const fetchedAge = now - new Date(m.fetchedAt).getTime();
      const eventEnded = m.manifest?.event?.end_at
        ? now - new Date(m.manifest.event.end_at).getTime() > AFTER_EVENT_MS
        : false;
      if (fetchedAge > MANIFEST_TTL_MS || eventEnded) {
        await db.delete('manifests', m.eventId);
        // Nettoyer les traces locales de cet event.
        const scans = await db.getAllFromIndex('local_scans', 'by_event', m.eventId);
        for (const s of scans) await db.delete('local_scans', s.qr);
      }
    }
  } catch {
    // IDB indisponible : ignorer.
  }
}
