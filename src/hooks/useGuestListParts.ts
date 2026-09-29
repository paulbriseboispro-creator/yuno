import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';

/** 'organizer' = la part d'ALLOCATION de l'organisateur, accordée par le club
 *  (modèle demande/validation) — distincte de la part MAISON 'club'.
 *  'agency' = l'ENVELOPPE accordée à une agence de promoteurs, répartie ensuite
 *  entre ses promoteurs (partition/pool — voir agency_distribution_mode). */
export type HolderType = 'club' | 'dj' | 'promoter' | 'custom' | 'organizer' | 'agency';

export interface Part {
  id: string;
  event_id: string;
  holder_type: HolderType;
  holder_label: string | null;
  dj_id: string | null;
  promoter_id: string | null;
  agency_id: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  /** partition | pool — propre aux parts 'agency' (NULL ailleurs). */
  agency_distribution_mode: string | null;
  /** NULL = allocation illimitée (parts déléguées uniquement). */
  quota: number | null;
  quota_female: number | null;
  quota_male: number | null;
  /** Per-type allocation (e.g. 10 standard + 2 VIP). quota = quota_normal + quota_drink + quota_table. */
  quota_normal: number;
  quota_drink: number;
  quota_table: number;
  /** Type primaire historique — sert de repli quand public_entry_types est NULL. */
  entry_kind: string;
  /** Types proposés sur le lien public (canal 1). NULL = repli historique. */
  public_entry_types: string[] | null;
  free_before_time: string;
  entry_deadline: string | null;
  includes_drink: boolean;
  visible_on_club_page: boolean;
  /** Affiche le compteur « X places restantes » sur les pages publiques. */
  show_remaining: boolean;
  is_active: boolean;
  /** « Complet » posé à la main sur CETTE part : plus aucune inscription en
   *  libre-service (lien public, lien de part, lien nominatif), mais la part
   *  reste active et ses invités restent gérables. Voir lib/soldOut.ts. */
  manually_sold_out: boolean;
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

const PART_COLS = 'id, event_id, holder_type, holder_label, dj_id, promoter_id, agency_id, venue_id, organizer_user_id, agency_distribution_mode, quota, quota_female, quota_male, quota_normal, quota_drink, quota_table, entry_kind, public_entry_types, free_before_time, entry_deadline, includes_drink, visible_on_club_page, show_remaining, is_active, manually_sold_out, share_token, created_at';

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
  // Soirée dont les parts sont réellement chargées. Au changement de soirée,
  // `loading` vaut encore `false` (état de la soirée précédente) pendant un
  // rendu : la page montait alors ses sous-composants (demandes, enveloppe
  // agence…), les démontait au `setLoading(true)` puis les remontait — chaque
  // requête partait deux fois. On ne se dit prêt que pour la soirée chargée.
  const [loadedEventId, setLoadedEventId] = useState<string | null>(null);
  const partIdsRef = useRef<Set<string>>(new Set());
  // Seule la DERNIÈRE lecture écrit à l'écran : ouvrir la page sur `?event=`
  // lance d'abord la soirée par défaut, puis la bonne ; la plus lente des deux
  // gagnait, et le sélecteur disait « Triple » sous les parts d'une autre soirée.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    if (!eventId) { setParts([]); setEntriesByPart({}); setLoading(false); setLoadedEventId(eventId); return; }
    setLoading(true);
    try {
      // Cast client : agency_id / agency_distribution_mode ne sont pas encore dans
      // les types générés (gen types après migration). Comme partout dans le repo.
      const { data: rows } = await (supabase as any).from('guest_lists').select(PART_COLS).eq('event_id', eventId);
      const list = ((rows || []) as Part[]).slice().sort(orderParts);

      // Noms des DJ, des promoteurs et inscriptions : trois lectures INDÉPENDANTES,
      // lancées ensemble. En série (5 allers-retours), la page restait vide plusieurs
      // secondes sur un réseau lent — on croyait la guest list cassée.
      const djIds = list.filter(p => p.holder_type === 'dj' && p.dj_id).map(p => p.dj_id!) as string[];
      const promoterIds = list.filter(p => p.holder_type === 'promoter' && p.promoter_id).map(p => p.promoter_id!) as string[];
      const ids = list.map(p => p.id);

      const [djNames, promoterNames, entries] = await Promise.all([
        (async () => {
          const names: Record<string, string> = {};
          if (!djIds.length) return names;
          const { data: djRows } = await supabase.from('djs').select('id, stage_name, first_name, last_name').in('id', djIds);
          (djRows || []).forEach(d => {
            names[d.id] = d.stage_name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'DJ';
          });
          return names;
        })(),
        (async () => {
          const names: Record<string, string> = {};
          if (!promoterIds.length) return names;
          const { data: promoRows } = await supabase.from('promoters').select('id, user_id').in('id', promoterIds);
          const userIds = (promoRows || []).map(p => p.user_id);
          const { data: profiles } = userIds.length
            ? await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds)
            : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
          const profileMap = new Map((profiles || []).map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
          (promoRows || []).forEach(p => { names[p.id] = profileMap.get(p.user_id) || ''; });
          return names;
        })(),
        (async () => {
          if (!ids.length) return [] as PartEntry[];
          const { data } = await supabase
            .from('guest_list_entries')
            .select('id, guest_list_id, full_name, email, gender, status, entry_scanned, entry_type, promoter_id, created_at')
            .in('guest_list_id', ids)
            .order('created_at', { ascending: false });
          return (data || []) as PartEntry[];
        })(),
      ]);

      if (request !== requestRef.current) return;
      const resolved = list.map(p => ({
        ...p,
        displayName:
          p.holder_type === 'dj' ? (p.dj_id ? djNames[p.dj_id] : undefined)
          : p.holder_type === 'promoter' ? (p.promoter_id ? (promoterNames[p.promoter_id] || p.holder_label || undefined) : undefined)
          : undefined,
      }));
      setParts(resolved);
      partIdsRef.current = new Set(ids);
      const grouped: Record<string, PartEntry[]> = {};
      entries.forEach(e => { (grouped[e.guest_list_id as string] ||= []).push(e); });
      setEntriesByPart(grouped);
    } finally {
      // Jamais un chargement éternel : une lecture qui lève rend quand même la page.
      // « Prêt » seulement pour la soirée réellement chargée (la page ne monte
      // ses boîtes qu'à ce moment-là, une seule fois).
      if (request === requestRef.current) { setLoading(false); setLoadedEventId(eventId); }
    }
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
  // Co-soirée org-led : venue_id de l'event est NULL, le club physique est
  // partner_venue_id — sans le fallback, la part naît avec venue_id NULL et le
  // scan EN LIGNE du videur du club répond « Billet introuvable » (l'offline,
  // lui, passe — bug indiagnosticable le soir même).
  const resolveHost = useCallback(async (): Promise<{ venue_id: string | null; organizer_user_id: string | null }> => {
    if (ctx.isOrganizerScope) {
      const { data: ev } = await supabase.from('events').select('venue_id, partner_venue_id').eq('id', eventId).maybeSingle();
      return { venue_id: ev?.venue_id ?? ev?.partner_venue_id ?? null, organizer_user_id: ctx.organizerUserId ?? null };
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

  const createDjPart = useCallback((djId: string, quota: number | null, extra?: Record<string, unknown>) =>
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

  const createPromoterPart = useCallback((promoterId: string, label: string, quota: number | null, extra?: Record<string, unknown>) =>
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

  const createCustomPart = useCallback((label: string, quota: number | null, extra?: Record<string, unknown>) =>
    insertPart({ holder_type: 'custom', holder_label: label.trim(), quota, ...extra }), [insertPart]);

  const updatePart = useCallback(async (id: string, payload: TablesUpdate<'guest_lists'>) => {
    const { error } = await supabase.from('guest_lists').update(payload).eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  const deletePart = useCallback(async (id: string) => {
    const { error } = await supabase.from('guest_lists').delete().eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  // « Complet » d'une part : enregistré au clic, hors du formulaire (comme la
  // visibilité), parce qu'on le bascule un soir de rush, pas en configurant.
  const setSoldOut = useCallback(async (id: string, soldOut: boolean) => {
    const { error } = await supabase.from('guest_lists').update({ manually_sold_out: soldOut }).eq('id', id);
    if (error) throw error;
    setParts(prev => prev.map(p => p.id === id ? { ...p, manually_sold_out: soldOut } : p));
  }, []);

  const setActive = useCallback(async (id: string, active: boolean) => {
    const { error } = await supabase.from('guest_lists').update({ is_active: active }).eq('id', id);
    if (error) throw error;
    setParts(prev => prev.map(p => p.id === id ? { ...p, is_active: active } : p));
  }, []);

  return {
    parts, entriesByPart, loading: loading || loadedEventId !== eventId, reload: load,
    createClubPart, createDjPart, createDjPartsBulk, createPromoterPart, createPromoterPartsBulk, createCustomPart,
    updatePart, deletePart, setActive, setSoldOut,
  };
}
