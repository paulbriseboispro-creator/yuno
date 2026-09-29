import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getMyCoorgEvents, partyKeyOf, type CoorgScope } from '@/lib/coorg';
import { mergeCollabNights, type CollabNight } from '@/lib/collabHubNav';

type Side = 'venue' | 'organizer';

interface EventRow {
  id: string; title: string; poster_url: string | null; start_at: string; end_at: string;
  is_active: boolean; organizer_user_id: string | null; partner_organizer_id: string | null;
  venue_id: string | null; partner_venue_id: string | null; collab_paused_at: string | null;
}

/**
 * Toutes les soirées à plusieurs de la portée, en UNE liste : les contrats
 * club × organisateur (lus dans `events` + `event_collab_contracts`, comme
 * avant) et les co-organisations (`get_my_coorg_events`), fusionnés par soirée.
 * Le scope est l'ORGANISATION côté orga (`useActingOrganizer`), jamais le compte.
 */
export function useCollabNights(side: Side, scope: CoorgScope | null) {
  const [nights, setNights] = useState<CollabNight[]>([]);
  const [loading, setLoading] = useState(true);
  const scopeId = scope?.venueId ?? scope?.organizerUserId ?? null;

  const load = useCallback(async () => {
    if (!scope || !scopeId) { setLoading(false); return; }
    const filter = side === 'venue'
      ? `partner_venue_id.eq.${scopeId},and(venue_id.eq.${scopeId},partner_organizer_id.not.is.null)`
      : `partner_organizer_id.eq.${scopeId},and(organizer_user_id.eq.${scopeId},partner_venue_id.not.is.null)`;

    const [{ data: rows, error }, coorgRows] = await Promise.all([
      supabase.from('events')
        .select('id, title, poster_url, start_at, end_at, is_active, organizer_user_id, partner_organizer_id, venue_id, partner_venue_id, collab_paused_at')
        .or(filter)
        .order('start_at', { ascending: false }),
      getMyCoorgEvents(scope).catch(() => []),
    ]);
    if (error) console.error(error);
    const events = (rows ?? []) as EventRow[];
    const ids = events.map((e) => e.id);

    // Nom de l'AUTRE partie : l'organisateur pour un club, le club pour un orga.
    // organizer_profiles (public) et venues : jamais `profiles` (RLS).
    const orgIds = [...new Set(events.map((e) => e.organizer_user_id ?? e.partner_organizer_id).filter(Boolean) as string[])];
    const venueIds = [...new Set(events.map((e) => e.venue_id ?? e.partner_venue_id).filter(Boolean) as string[])];
    const [orgs, venues, contracts] = await Promise.all([
      side === 'venue' && orgIds.length
        ? supabase.from('organizer_profiles').select('user_id, display_name').in('user_id', orgIds)
        : Promise.resolve({ data: [] as { user_id: string; display_name: string | null }[] }),
      side === 'organizer' && venueIds.length
        ? supabase.from('venues').select('id, name').in('id', venueIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ids.length
        // event_collab_contracts n'est pas dans les types générés : requête liée à `supabase`.
        ? supabase.from('event_collab_contracts' as never).select('event_id, status').in('event_id' as never, ids as never)
        : Promise.resolve({ data: [] }),
    ]);
    const orgName = new Map(((orgs.data ?? []) as { user_id: string; display_name: string | null }[]).map((o) => [o.user_id, o.display_name ?? '']));
    const venueName = new Map(((venues.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
    // Le contrat VIVANT gagne : un contrat refusé puis refait ne doit pas
    // écraser le bon statut de la carte.
    const contract = new Map<string, string>();
    for (const c of (contracts.data as unknown as { event_id: string; status: string }[] | null) ?? []) {
      const prev = contract.get(c.event_id);
      if (!prev || prev === 'cancelled') contract.set(c.event_id, c.status);
    }

    const collab: CollabNight[] = events.map((e) => {
      const partner = side === 'venue'
        ? orgName.get((e.organizer_user_id ?? e.partner_organizer_id) as string)
        : venueName.get((e.venue_id ?? e.partner_venue_id) as string);
      const initiatedByMe = side === 'venue'
        ? e.venue_id === scopeId && !!e.partner_organizer_id
        : e.organizer_user_id === scopeId && !!e.partner_venue_id;
      return {
        eventId: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at, posterUrl: e.poster_url,
        partners: partner ? [partner] : [],
        collab: { contractStatus: contract.get(e.id) ?? null, initiatedByMe, paused: !!e.collab_paused_at, isActive: e.is_active },
        coorg: null,
      };
    });

    const me = partyKeyOf(scope);
    const coorg: CollabNight[] = (coorgRows ?? []).map((r) => ({
      eventId: r.event_id, title: r.title, startAt: r.start_at, endAt: r.end_at, posterUrl: r.poster_url,
      partners: (r.parties ?? []).filter((p) => p.key !== me).map((p) => p.name).filter(Boolean),
      collab: null,
      coorg: { pendingInvites: r.pending_invites ?? 0, dealStatus: r.deal_status, settlementStatus: r.settlement_status },
    }));

    setNights(mergeCollabNights(collab, coorg));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, scopeId]);

  useEffect(() => {
    void load();
    if (!scopeId) return;
    const col = side === 'venue' ? ['partner_venue_id', 'venue_id'] : ['partner_organizer_id', 'organizer_user_id'];
    const ch = supabase.channel(`collab-nights-${side}-${scopeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `${col[0]}=eq.${scopeId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `${col[1]}=eq.${scopeId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [side, scopeId, load]);

  return { nights, loading, reload: load };
}
