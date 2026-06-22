import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type HolderType = 'club' | 'dj' | 'promoter' | 'custom';

export interface Part {
  id: string;
  event_id: string;
  holder_type: HolderType;
  holder_label: string | null;
  dj_id: string | null;
  promoter_id: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  quota: number;
  quota_female: number | null;
  quota_male: number | null;
  /** Per-type allocation (e.g. 10 standard + 2 VIP). quota = quota_normal + quota_drink + quota_table. */
  quota_normal: number;
  quota_drink: number;
  quota_table: number;
  free_before_time: string;
  entry_deadline: string | null;
  includes_drink: boolean;
  visible_on_club_page: boolean;
  is_active: boolean;
  share_token: string;
  created_at: string;
  /** Resolved holder name for dj/promoter parts (club/custom resolve in the UI). */
  displayName?: string;
}

export interface PartEntry {
  id: string;
  guest_list_id: string;
  full_name: string;
  email: string;
  gender: string | null;
  status: string;
  entry_scanned: boolean;
  entry_type: string | null;
  promoter_id: string | null;
  created_at: string;
}

export interface PartScopeCtx {
  isOrganizerScope: boolean;
  venueId: string | null;
  organizerUserId: string | null;
}

const PART_COLS = 'id, event_id, holder_type, holder_label, dj_id, promoter_id, venue_id, organizer_user_id, quota, quota_female, quota_male, quota_normal, quota_drink, quota_table, free_before_time, entry_deadline, includes_drink, visible_on_club_page, is_active, share_token, created_at';

// Club part first, then by creation order — the host list always leads the stack.
function orderParts(a: Part, b: Part) {
  if (a.holder_type === 'club' && b.holder_type !== 'club') return -1;
  if (b.holder_type === 'club' && a.holder_type !== 'club') return 1;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

/**
 * Loads every guest-list "part" for an event (club / DJ / promoter / custom rows on
 * guest_lists) with their entries grouped per part, and exposes the create/update/
 * delete mutations. Replaces the three separate fetchers + the DJ section's loader.
 */
export function useGuestListParts(eventId: string, ctx: PartScopeCtx) {
  const [parts, setParts] = useState<Part[]>([]);
  const [entriesByPart, setEntriesByPart] = useState<Record<string, PartEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const partIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!eventId) { setParts([]); setEntriesByPart({}); setLoading(false); return; }
    setLoading(true);

    const { data: rows } = await supabase.from('guest_lists').select(PART_COLS).eq('event_id', eventId);
    const list = ((rows || []) as Part[]).slice().sort(orderParts);

    // Resolve holder display names for dj/promoter parts in two batched queries.
    const djIds = list.filter(p => p.holder_type === 'dj' && p.dj_id).map(p => p.dj_id!) as string[];
    const promoterIds = list.filter(p => p.holder_type === 'promoter' && p.promoter_id).map(p => p.promoter_id!) as string[];

    const djNames: Record<string, string> = {};
    if (djIds.length) {
      const { data: djRows } = await supabase.from('djs').select('id, stage_name, first_name, last_name').in('id', djIds);
      (djRows || []).forEach(d => {
        djNames[d.id] = d.stage_name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'DJ';
      });
    }
    const promoterNames: Record<string, string> = {};
    if (promoterIds.length) {
      const { data: promoRows } = await supabase.from('promoters').select('id, user_id').in('id', promoterIds);
      const userIds = (promoRows || []).map(p => p.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds)
        : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
      const profileMap = new Map((profiles || []).map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
      (promoRows || []).forEach(p => { promoterNames[p.id] = profileMap.get(p.user_id) || ''; });
    }

    const resolved = list.map(p => ({
      ...p,
      displayName:
        p.holder_type === 'dj' ? (p.dj_id ? djNames[p.dj_id] : undefined)
        : p.holder_type === 'promoter' ? (p.promoter_id ? (promoterNames[p.promoter_id] || p.holder_label || undefined) : undefined)
        : undefined,
    }));
    setParts(resolved);

    const ids = resolved.map(p => p.id);
    partIdsRef.current = new Set(ids);
    if (ids.length) {
      const { data: entries } = await supabase
        .from('guest_list_entries')
        .select('id, guest_list_id, full_name, email, gender, status, entry_scanned, entry_type, promoter_id, created_at')
        .in('guest_list_id', ids)
        .order('created_at', { ascending: false });
      const grouped: Record<string, PartEntry[]> = {};
      (entries || []).forEach(e => {
        const k = e.guest_list_id as string;
        (grouped[k] ||= []).push(e as PartEntry);
      });
      setEntriesByPart(grouped);
    } else {
      setEntriesByPart({});
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: reload entries when any entry on one of our parts changes. RLS scopes
  // the stream to rows the owner/organizer can already read, so this stays cheap.
  useEffect(() => {
    if (!eventId) return;
    const refresh = async (guestListId: string) => {
      if (!partIdsRef.current.has(guestListId)) return;
      const { data } = await supabase
        .from('guest_list_entries')
        .select('id, guest_list_id, full_name, email, gender, status, entry_scanned, entry_type, promoter_id, created_at')
        .in('guest_list_id', [...partIdsRef.current])
        .order('created_at', { ascending: false });
      const grouped: Record<string, PartEntry[]> = {};
      (data || []).forEach(e => { (grouped[e.guest_list_id as string] ||= []).push(e as PartEntry); });
      setEntriesByPart(grouped);
    };
    const channel = supabase.channel(`owner-gl-parts-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_list_entries' }, (payload) => {
        const gid = (payload.new as { guest_list_id?: string })?.guest_list_id
          || (payload.old as { guest_list_id?: string })?.guest_list_id;
        if (gid) refresh(gid);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  // Resolve the host columns (venue_id / organizer_user_id) every part inherits.
  const resolveHost = useCallback(async (): Promise<{ venue_id: string | null; organizer_user_id: string | null }> => {
    if (ctx.isOrganizerScope) {
      const { data: ev } = await supabase.from('events').select('venue_id').eq('id', eventId).maybeSingle();
      return { venue_id: ev?.venue_id ?? null, organizer_user_id: ctx.organizerUserId ?? null };
    }
    return { venue_id: ctx.venueId ?? null, organizer_user_id: null };
  }, [ctx.isOrganizerScope, ctx.venueId, ctx.organizerUserId, eventId]);

  const insertPart = useCallback(async (extra: Record<string, unknown>) => {
    const host = await resolveHost();
    const { error } = await supabase.from('guest_lists').insert({
      event_id: eventId,
      venue_id: host.venue_id,
      organizer_user_id: host.organizer_user_id,
      free_before_time: '02:00',
      includes_drink: false,
      visible_on_club_page: false,
      is_active: true,
      ...extra,
    });
    if (error) throw error;
    await load();
  }, [eventId, resolveHost, load]);

  const createClubPart = useCallback((payload: Record<string, unknown>) =>
    insertPart({ holder_type: 'club', ...payload }), [insertPart]);

  const createDjPart = useCallback((djId: string, quota: number, extra?: Record<string, unknown>) =>
    insertPart({ holder_type: 'dj', dj_id: djId, quota, ...extra }), [insertPart]);

  // Bulk-create one DJ part per id (for "distribute a preset to the whole lineup"),
  // with a single reload. Callers must pass only DJs that don't already have a part
  // (the (event, dj) unique index would otherwise abort the whole insert).
  const createDjPartsBulk = useCallback(async (djIds: string[], quota: number, extra?: Record<string, unknown>) => {
    if (!djIds.length) return 0;
    const host = await resolveHost();
    const rows = djIds.map(djId => ({
      event_id: eventId, venue_id: host.venue_id, organizer_user_id: host.organizer_user_id,
      holder_type: 'dj', dj_id: djId, quota,
      free_before_time: '02:00', includes_drink: false, visible_on_club_page: false, is_active: true,
      ...extra,
    }));
    const { error } = await supabase.from('guest_lists').insert(rows);
    if (error) throw error;
    await load();
    return rows.length;
  }, [eventId, resolveHost, load]);

  const createPromoterPart = useCallback((promoterId: string, label: string, quota: number, extra?: Record<string, unknown>) =>
    insertPart({ holder_type: 'promoter', promoter_id: promoterId, holder_label: label, quota, ...extra }), [insertPart]);

  // Bulk-create one promoter part per item (distribute a preset to all / selected
  // promoters), single reload. Pass only promoters without a part yet.
  const createPromoterPartsBulk = useCallback(async (items: { id: string; label: string }[], quota: number, extra?: Record<string, unknown>) => {
    if (!items.length) return 0;
    const host = await resolveHost();
    const rows = items.map(it => ({
      event_id: eventId, venue_id: host.venue_id, organizer_user_id: host.organizer_user_id,
      holder_type: 'promoter', promoter_id: it.id, holder_label: it.label, quota,
      free_before_time: '02:00', includes_drink: false, visible_on_club_page: false, is_active: true,
      ...extra,
    }));
    const { error } = await supabase.from('guest_lists').insert(rows);
    if (error) throw error;
    await load();
    return rows.length;
  }, [eventId, resolveHost, load]);

  const createCustomPart = useCallback((label: string, quota: number, extra?: Record<string, unknown>) =>
    insertPart({ holder_type: 'custom', holder_label: label.trim(), quota, ...extra }), [insertPart]);

  const updatePart = useCallback(async (id: string, payload: Record<string, unknown>) => {
    const { error } = await supabase.from('guest_lists').update(payload).eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  const deletePart = useCallback(async (id: string) => {
    const { error } = await supabase.from('guest_lists').delete().eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  const setActive = useCallback(async (id: string, active: boolean) => {
    const { error } = await supabase.from('guest_lists').update({ is_active: active }).eq('id', id);
    if (error) throw error;
    setParts(prev => prev.map(p => p.id === id ? { ...p, is_active: active } : p));
  }, []);

  return {
    parts, entriesByPart, loading, reload: load,
    createClubPart, createDjPart, createDjPartsBulk, createPromoterPart, createPromoterPartsBulk, createCustomPart,
    updatePart, deletePart, setActive,
  };
}
