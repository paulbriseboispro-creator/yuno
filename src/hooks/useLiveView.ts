import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import {
  geocodeCached, geocodePlace,
  type LiveBurst, type LiveFeedItem, type LiveLocation, type LivePoint, type LiveSnapshot,
} from '@/lib/liveView';

/**
 * Vue en direct : un seul aller-retour (`get_live_view`) rappelé toutes les
 * quelques secondes tant que l'onglet est visible, plus une écoute Realtime
 * sur les tables de vente qui force un rappel immédiat — c'est ce qui fait
 * qu'une vente apparaît à la seconde, pas au prochain tick.
 *
 * Le hook fait aussi le DIFF entre deux snapshots : les nouveaux faits du
 * flux sont marqués « frais » quelques secondes (pour l'animation) et ceux
 * qui portent des coordonnées deviennent des « bursts » sur le globe.
 */

const POLL_MS = 4000;
const FRESH_MS = 8000;
const BURST_MS = 4500;

export interface LiveScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

export interface UseLiveViewResult {
  snapshot: LiveSnapshot | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  freshIds: Set<string>;
  bursts: LiveBurst[];
  refresh: () => void;
}

function withCoords<T extends { lat: number | null; lng: number | null; city: string | null; country: string | null }>(row: T): T {
  if (row.lat != null && row.lng != null) return row;
  const c = geocodeCached(row.city, row.country);
  return c ? { ...row, lng: c[0], lat: c[1] } : row;
}

function fillCoords(snap: LiveSnapshot): LiveSnapshot {
  return {
    ...snap,
    points: snap.points.map(withCoords),
    feed: snap.feed.map(withCoords),
    locations: snap.locations.map(withCoords),
  };
}

export function useLiveView(scope: LiveScope, paused: boolean): UseLiveViewResult {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const active = !!(venueId || organizerUserId);

  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const [bursts, setBursts] = useState<LiveBurst[]>([]);

  const seenRef = useRef<Set<string> | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const geoQueueRef = useRef<Set<string>>(new Set());

  const fetchOnce = useCallback(async () => {
    if (!active || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcError } = await supabase.rpc('get_live_view' as any, {
        p_venue_id: venueId,
        p_organizer_user_id: organizerUserId,
      });
      if (rpcError) throw rpcError;
      const raw = data as (LiveSnapshot & { ok: boolean; reason?: string }) | null;
      if (!raw || !raw.ok) {
        setError(raw?.reason === 'forbidden' ? 'forbidden' : 'error');
        return;
      }
      const snap = fillCoords(raw);

      // Diff du flux : nouveaux ids → frais + bursts (jamais au premier chargement).
      const seen = seenRef.current;
      const nowPerf = performance.now();
      if (seen) {
        const fresh: string[] = [];
        const newBursts: LiveBurst[] = [];
        for (const item of snap.feed) {
          if (seen.has(item.id)) continue;
          fresh.push(item.id);
          if (item.lat != null && item.lng != null) {
            newBursts.push({ id: item.id, kind: item.kind, lat: item.lat, lng: item.lng, bornAt: nowPerf });
          } else if (item.kind !== 'visit' && snap.home) {
            // Une vente sans localisation connue éclate sur le club lui-même.
            newBursts.push({ id: item.id, kind: item.kind, lat: snap.home.lat, lng: snap.home.lng, bornAt: nowPerf });
          }
        }
        if (fresh.length) {
          setFreshIds((prev) => { const next = new Set(prev); fresh.forEach((id) => next.add(id)); return next; });
          window.setTimeout(() => {
            setFreshIds((prev) => { const next = new Set(prev); fresh.forEach((id) => next.delete(id)); return next; });
          }, FRESH_MS);
        }
        if (newBursts.length) {
          setBursts((prev) => [...prev, ...newBursts]);
          window.setTimeout(() => {
            const ids = new Set(newBursts.map((b) => b.id));
            setBursts((prev) => prev.filter((b) => !ids.has(b.id)));
          }, BURST_MS);
        }
      }
      const nextSeen = seen ?? new Set<string>();
      snap.feed.forEach((item) => nextSeen.add(item.id));
      seenRef.current = nextSeen;

      setSnapshot(snap);
      setError(null);
      setLastUpdatedAt(Date.now());

      // Géocodage de secours, borné : 4 lieux par tick, jamais deux fois le même.
      const missing: Array<LivePoint | LiveFeedItem | LiveLocation> = [
        ...snap.points, ...snap.locations, ...snap.feed,
      ].filter((r) => (r.lat == null || r.lng == null) && !!r.city);
      let budget = 4;
      for (const row of missing) {
        const key = `${row.city}|${row.country ?? ''}`;
        if (geoQueueRef.current.has(key)) continue;
        if (budget-- <= 0) break;
        geoQueueRef.current.add(key);
        geocodePlace(row.city, row.country).then((c) => {
          if (!c) return;
          setSnapshot((prev) => (prev ? fillCoords(prev) : prev));
        });
      }
    } catch (e) {
      setError((e as Error)?.message ? 'error' : 'error');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [active, venueId, organizerUserId]);

  // Boucle de rappel : visible + non mise en pause.
  useEffect(() => {
    if (!active) { setLoading(false); return; }
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      timerRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        if (!pausedRef.current && document.visibilityState !== 'hidden') await fetchOnce();
        schedule();
      }, POLL_MS);
    };
    seenRef.current = null;
    setSnapshot(null);
    setLoading(true);
    fetchOnce().then(schedule);
    const onVisible = () => { if (document.visibilityState === 'visible' && !pausedRef.current) fetchOnce(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, fetchOnce]);

  // Reprise après pause : un rappel immédiat.
  useEffect(() => { if (!paused && active) fetchOnce(); }, [paused, active, fetchOnce]);

  // Realtime : les ventes déclenchent un rappel immédiat (débordé à 300 ms).
  const watchKey = useMemo(() => {
    if (!snapshot) return '';
    return JSON.stringify([snapshot.watch.eventIds, snapshot.watch.guestListIds, venueId]);
  }, [snapshot, venueId]);

  useEffect(() => {
    if (!active || !watchKey) return;
    const [eventIds, guestListIds] = JSON.parse(watchKey) as [string[], string[], string | null];
    let debounce: number | null = null;
    const kick = () => {
      if (pausedRef.current) return;
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => fetchOnce(), 300);
    };
    const channel = supabase.channel(uniqueChannel('live-view'));
    if (eventIds.length) {
      const inList = `event_id=in.(${eventIds.join(',')})`;
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: inList }, kick);
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'table_reservations', filter: inList }, kick);
    }
    if (guestListIds.length) {
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guest_list_entries', filter: `guest_list_id=in.(${guestListIds.join(',')})` }, kick);
    }
    if (venueId) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `venue_id=eq.${venueId}` }, kick);
    }
    channel.subscribe();
    return () => {
      if (debounce) window.clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [active, watchKey, venueId, fetchOnce]);

  return { snapshot, loading, error, lastUpdatedAt, freshIds, bursts, refresh: fetchOnce };
}
