import { supabase } from '@/integrations/supabase/client';
import { getOfflineDb, type PendingScan } from './db';

/**
 * File d'attente des scans offline + rejeu vers le RPC sync_offline_scans.
 * Politique « premier scan gagne » côté serveur : les résultats 'applied' et
 * 'conflict' sortent de la file (le conflit est remonté une fois à l'UI).
 *
 * Deux sortes d'échec, jamais confondues :
 *  - DÉFINITIF (billet introuvable, remboursé pendant la coupure, mauvaise
 *    soirée) : le serveur a tranché, l'item sort de la file et remonte comme
 *    refus — le garder bloquerait le compteur « en attente » pour toujours ;
 *  - RÉESSAYABLE (réseau, wifi captif, serveur) : 3 essais rapprochés, puis un
 *    essai toutes les 2 min. Avant, après 3 échecs l'item n'était PLUS JAMAIS
 *    rejoué : l'entrée n'existait pas côté serveur, un autre téléphone pouvait
 *    refaire entrer le même QR et le promoteur perdait sa commission.
 */

/** Réponses du serveur qui ne changeront pas en réessayant. */
const PERMANENT_ERRORS = new Set(['not_found', 'not_valid', 'event_mismatch', 'unknown_entity_type']);
const RETRY_PAUSE_MS = 2 * 60 * 1000;

const isDue = (item: PendingScan, now: number) =>
  item.attempts < MAX_ATTEMPTS || now - (item.last_attempt_at ?? 0) >= RETRY_PAUSE_MS;

export interface SyncResultItem {
  client_id: string;
  status: 'applied' | 'conflict' | 'error';
  server_scanned_at?: string;
  conflict_scanned_at?: string;
  message?: string;
}

export interface ReplaySummary {
  applied: number;
  conflicts: SyncResultItem[];
  errors: number;
  /** Refusés définitivement par le serveur (retirés de la file). */
  rejected: SyncResultItem[];
  remaining: number;
}

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;

export async function enqueueScan(item: Omit<PendingScan, 'attempts'>): Promise<void> {
  const db = await getOfflineDb();
  await db.put('pending_queue', { ...item, attempts: 0 });
}

export async function pendingCount(eventId?: string): Promise<number> {
  try {
    const db = await getOfflineDb();
    if (eventId) return (await db.getAllFromIndex('pending_queue', 'by_event', eventId)).length;
    return await db.count('pending_queue');
  } catch {
    return 0;
  }
}

let replaying = false;

/** Rejoue la file (batchs mono-event de 50). No-op si offline ou déjà en cours. */
export async function replayQueue(): Promise<ReplaySummary | null> {
  if (replaying || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  replaying = true;
  try {
    const db = await getOfflineDb();
    const now = Date.now();
    const all = (await db.getAll('pending_queue')).filter((i) => isDue(i, now));
    if (all.length === 0) return { applied: 0, conflicts: [], errors: 0, rejected: [], remaining: await pendingCount() };

    const summary: ReplaySummary = { applied: 0, conflicts: [], errors: 0, rejected: [], remaining: 0 };

    // Batchs par event (le RPC autorise par event).
    const byEvent = new Map<string, PendingScan[]>();
    for (const item of all) {
      const list = byEvent.get(item.event_id) || [];
      list.push(item);
      byEvent.set(item.event_id, list);
    }

    for (const [, items] of byEvent) {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.rpc('sync_offline_scans' as never, {
          p_scans: batch.map(({ attempts: _a, ...rest }) => rest),
        } as never);

        if (error) {
          // Échec réseau/serveur du batch entier : incrémenter les tentatives.
          for (const item of batch) {
            await db.put('pending_queue', { ...item, attempts: item.attempts + 1, last_attempt_at: Date.now() });
          }
          summary.errors += batch.length;
          continue;
        }

        const results = (data as unknown as SyncResultItem[]) || [];
        for (const res of results) {
          const item = batch.find((b) => b.client_id === res.client_id);
          if (!item) continue;
          if (res.status === 'applied' || res.status === 'conflict') {
            await db.delete('pending_queue', res.client_id);
            // Marquer le scan local comme synchronisé.
            const local = await db.get('local_scans', item.qr);
            if (local) await db.put('local_scans', { ...local, synced: true });
            if (res.status === 'applied') summary.applied++;
            else summary.conflicts.push(res);
          } else if (res.message && PERMANENT_ERRORS.has(res.message)) {
            await db.delete('pending_queue', res.client_id);
            summary.rejected.push(res);
          } else {
            await db.put('pending_queue', { ...item, attempts: item.attempts + 1, last_attempt_at: Date.now() });
            summary.errors++;
          }
        }
      }
    }

    summary.remaining = await pendingCount();
    return summary;
  } catch {
    return null;
  } finally {
    replaying = false;
  }
}
