import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EmailBlock, LiveData, TicketRow } from '@/lib/email';
import { YUNO_BLOCK_TYPES } from '@/lib/email';

export type StudioScope =
  | { kind: 'venue'; venueId: string; name: string; logoUrl?: string | null; city?: string | null }
  | { kind: 'organizer'; organizerId: string; name: string; logoUrl?: string | null; city?: string | null };

export interface StudioEvent {
  id: string;
  title: string;
  start_at: string;
}

/** Soirées à venir du scope (+ celle déjà liée à la campagne, même passée). */
export function useStudioEvents(scope: StudioScope, pinnedEventId?: string | null): StudioEvent[] {
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const scopeId = scope.kind === 'venue' ? scope.venueId : scope.organizerId;

  useEffect(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let q = supabase.from('events').select('id,title,start_at')
      .gte('start_at', todayStart.toISOString())
      .order('start_at', { ascending: true }).limit(80);
    q = scope.kind === 'venue'
      ? q.or(`venue_id.eq.${scopeId},partner_venue_id.eq.${scopeId}`)
      : q.or(`organizer_user_id.eq.${scopeId},partner_organizer_id.eq.${scopeId}`);
    q.then(({ data }) => setEvents((data || []) as StudioEvent[]));
  }, [scope.kind, scopeId]);

  useEffect(() => {
    if (!pinnedEventId) return;
    setEvents((prev) => {
      if (prev.some((e) => e.id === pinnedEventId)) return prev;
      supabase.from('events').select('id,title,start_at').eq('id', pinnedEventId).maybeSingle()
        .then(({ data }) => {
          if (data) setEvents((p) => (p.some((e) => e.id === data.id) ? p : [data as StudioEvent, ...p]));
        });
      return prev;
    });
  }, [pinnedEventId]);

  return events;
}

function euro(amount: number): string {
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace(',', '.').replace('.', ',')} €`;
}

/**
 * Données live des blocs Yuno pour le CANVAS (aperçu). Le rendu d'envoi refait
 * ses propres requêtes côté edge — ici c'est purement visuel.
 */
export function useStudioLiveData(blocks: EmailBlock[], fallbackEventId: string | null): LiveData {
  const [live, setLive] = useState<LiveData>({});

  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const b of blocks) {
      if (YUNO_BLOCK_TYPES.includes(b.type)) {
        const id = ('eventId' in b && b.eventId) || fallbackEventId || '';
        if (id) set.add(id);
      }
    }
    return [...set].sort();
  }, [blocks, fallbackEventId]);
  const idsKey = ids.join(',');

  useEffect(() => {
    if (!idsKey) { setLive({}); return; }
    let cancelled = false;
    (async () => {
      const wanted = idsKey.split(',');
      const [{ data: events }, { data: rounds }] = await Promise.all([
        supabase.from('events')
          .select('id,title,start_at,timezone,slug,poster_url,image_url,venue_id,partner_venue_id,location_name,location_city')
          .in('id', wanted),
        supabase.from('ticket_rounds')
          .select('event_id,name,description,price,max_tickets,tickets_sold,is_active,manually_sold_out,position')
          .in('event_id', wanted)
          .order('position', { ascending: true }),
      ]);
      if (cancelled || !events) return;

      const venueIds = [...new Set(events.map((e) => (e as { venue_id?: string | null; partner_venue_id?: string | null }).venue_id
        || (e as { partner_venue_id?: string | null }).partner_venue_id).filter(Boolean))] as string[];
      const { data: venues } = venueIds.length
        ? await supabase.from('venues').select('id,name,city').in('id', venueIds)
        : { data: [] as { id: string; name: string; city: string | null }[] };
      if (cancelled) return;
      const venueById = new Map((venues || []).map((v) => [v.id, v]));

      const next: LiveData = {};
      for (const raw of events) {
        const e = raw as {
          id: string; title: string; start_at: string; timezone?: string | null; slug?: string | null;
          poster_url?: string | null; image_url?: string | null;
          venue_id?: string | null; partner_venue_id?: string | null;
          location_name?: string | null; location_city?: string | null;
        };
        const venue = venueById.get(e.venue_id || e.partner_venue_id || '');
        const tz = e.timezone && e.timezone.trim() ? e.timezone : 'Europe/Paris';
        const start = new Date(e.start_at);
        const dateLabel = `${start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })}`;
        const evRounds = (rounds || []).filter((r) => (r as { event_id: string }).event_id === e.id) as Array<{
          name: string | null; description: string | null; price: number | null;
          max_tickets: number | null; tickets_sold: number | null;
          is_active: boolean | null; manually_sold_out: boolean | null;
        }>;
        const isOut = (r: typeof evRounds[number]) =>
          !!r.manually_sold_out || (r.max_tickets != null && Number(r.tickets_sold || 0) >= Number(r.max_tickets));
        const tickets: TicketRow[] = evRounds
          .filter((r) => r.is_active || isOut(r))
          .slice(0, 4)
          .map((r) => ({ n: r.name || 'Billet', s: r.description || '', p: euro(Number(r.price || 0)), out: isOut(r) }));
        const activePrices = evRounds.filter((r) => r.is_active && !isOut(r)).map((r) => Number(r.price || 0));
        const venueName = venue?.name || e.location_name || '';
        const city = venue?.city || e.location_city || '';

        next[e.id] = {
          title: e.title,
          startAt: e.start_at,
          dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
          venueLabel: city ? `${venueName} — ${city}` : venueName,
          coverUrl: e.poster_url || e.image_url || null,
          url: `https://yunoapp.eu/event/${e.slug || e.id}`,
          priceFromLabel: activePrices.length ? `Dès ${euro(Math.min(...activePrices))}` : null,
          // Tableau TOUJOURS présent : vide = « pas de billetterie » (le bloc
          // s'efface), undefined = « données pas encore résolues » (fallback).
          tickets,
          tablesLeft: null,
        };
      }
      setLive(next);
    })();
    return () => { cancelled = true; };
  }, [idsKey]);

  return live;
}

export interface SavedSegment { id: string; name: string; description?: string | null }

export function useSavedSegments(scope: StudioScope): SavedSegment[] {
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const venueId = scope.kind === 'venue' ? scope.venueId : null;
  useEffect(() => {
    if (!venueId) { setSegments([]); return; }
    supabase
      .from('venue_segments' as never)
      .select('id, name, description')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSegments(((data as unknown) as SavedSegment[]) || []));
  }, [venueId]);
  return segments;
}

export interface ImportedList { id: string; name: string; createdAt: string; count: number }

/**
 * Listes importées de la portée — un fichier importé reste un segment à part.
 * Disponible aux DEUX portées, contrairement aux segments sauvegardés qui sont
 * venue-only. L'effectif est recompté en direct (un désabonnement le fait
 * baisser), jamais lu dans le rapport d'import figé.
 */
export function useImportedLists(scope: StudioScope): ImportedList[] {
  const [lists, setLists] = useState<ImportedList[]>([]);
  const scopeId = scope.kind === 'venue' ? scope.venueId : scope.organizerId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let q = supabase.from('email_list_imports' as never)
        .select('id, filename, list_name, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      q = scope.kind === 'venue' ? q.eq('venue_id', scopeId) : q.eq('organizer_user_id', scopeId);
      const { data } = await q;
      if (cancelled) return;
      const rows = ((data as unknown) || []) as Array<{
        id: string; filename: string | null; list_name: string | null; created_at: string;
      }>;
      const counted = await Promise.all(rows.map(async (r) => {
        const { count } = await supabase.from('newsletter_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('import_id', r.id)
          .eq('opted_in', true);
        return {
          id: r.id,
          // Le nom donné par le pro à l'import ; à défaut (imports d'avant
          // le champ), le nom de fichier sans son extension.
          name: (r.list_name || '').trim()
            || (r.filename || '').replace(/\.[a-z0-9]+$/i, '').trim()
            || 'Import',
          createdAt: r.created_at,
          count: count || 0,
        };
      }));
      // Un lot dont plus personne n'est abonné n'est pas une cible : on ne
      // propose pas une case qui n'ajoute personne.
      if (!cancelled) setLists(counted.filter((l) => l.count > 0));
    })();
    return () => { cancelled = true; };
  }, [scope.kind, scopeId]);

  return lists;
}

export interface AudienceCount { gross: number; net: number; suppressed: number }

/**
 * Net réel de destinataires. La RPC lit la campagne SAUVEGARDÉE : on recompte
 * après chaque autosave abouti (saveSeq), pas à chaque frappe.
 */
export function useAudienceCount(campaignId: string | null, saveSeq: number, enabled: boolean): {
  count: AudienceCount | null; loading: boolean;
} {
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!campaignId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    supabase.rpc('count_campaign_audience' as never, { p_campaign_id: campaignId } as never)
      .then(({ data }) => {
        if (cancelled) return;
        const d = (data as unknown) as AudienceCount | null;
        setCount(d && typeof d.net === 'number' ? d : { gross: 0, net: 0, suppressed: 0 });
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [campaignId, saveSeq, enabled]);
  return { count, loading };
}

export interface SendProgress {
  status: string;
  paused_reason?: string | null;
  error_message?: string | null;
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  suppressed: number;
  opens: number;
  clicks: number;
  daily_cap?: number;
  daily_used?: number;
}

export function useSendProgress(campaignId: string | null, active: boolean): SendProgress | null {
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!campaignId || !active) return;
    let cancelled = false;
    const tick = () => {
      supabase.rpc('get_campaign_send_progress' as never, { p_campaign_id: campaignId } as never)
        .then(({ data }) => {
          if (!cancelled && data) setProgress((data as unknown) as SendProgress);
        });
    };
    tick();
    timer.current = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [campaignId, active]);
  return progress;
}
