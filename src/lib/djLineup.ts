import { supabase } from '@/integrations/supabase/client';
import { MUSIC_GENRES } from '@/lib/musicGenres';

/**
 * Handshake line-up ↔ booking (côté formulaire d'événement).
 *
 * Un DJ qui a un compte Yuno (djs.user_id renseigné) ne s'ajoute plus à
 * l'affiche d'autorité : l'enregistrement de la soirée lui envoie une demande
 * de booking (horaires, cachet, message) via create_dj_booking_request, et
 * c'est son acceptation — côté app DJ — qui l'inscrit au line-up public
 * (le RPC accept_dj_booking_request insère event_djs). Un profil roster sans
 * compte n'a personne pour valider : il reste ajouté directement.
 *
 * Ce module est partagé par OwnerEvents (scope venue + organizer) et
 * OrgEventFormDialog (app organisateur) pour que les deux formulaires parlent
 * exactement le même langage.
 */

export type LineupEntryStatus =
  /** Déjà dans event_djs (ajout direct passé ou booking accepté). */
  | 'confirmed'
  /** Ajout local d'un profil sans compte — insertion directe à la sauvegarde. */
  | 'draft_direct'
  /** Ajout local d'un DJ avec compte — demande de booking à la sauvegarde. */
  | 'draft_request'
  /** Demande de booking déjà envoyée, en attente de réponse du DJ. */
  | 'pending';

export type LineupEntry = {
  djId: string;
  djUserId: string | null;
  name: string;
  imageUrl: string | null;
  status: LineupEntryStatus;
  /** Présent quand status = 'pending' : id de la ligne dj_booking_requests. */
  requestId?: string;
  /** Brief du draft_request (HH:MM). */
  startTime?: string;
  endTime?: string;
  fee?: number | null;
  note?: string;
};

type DjRow = {
  id: string;
  user_id: string | null;
  stage_name: string | null;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
};

export function djDisplayName(d: Pick<DjRow, 'stage_name' | 'first_name' | 'last_name'>): string {
  return d.stage_name || `${d.first_name} ${d.last_name}`.trim();
}

/** Date + deux HH:MM → créneau ISO, l'heure de fin roulant après minuit. */
export function buildLineupSlot(day: Date, hhmmStart: string, hhmmEnd: string): { start: string; end: string } {
  const [sh, sm] = hhmmStart.split(':').map(Number);
  const [eh, em] = hhmmEnd.split(':').map(Number);
  const start = new Date(day); start.setHours(sh || 0, sm || 0, 0, 0);
  const end = new Date(day); end.setHours(eh || 0, em || 0, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Charge l'état du line-up d'une soirée : les DJs confirmés (event_djs) et les
 * demandes de booking encore en attente pour cette soirée.
 */
export async function loadLineupEntries(eventId: string): Promise<LineupEntry[]> {
  const entries: LineupEntry[] = [];

  const { data: eventDjs } = await supabase
    .from('event_djs')
    .select('dj_id')
    .eq('event_id', eventId);
  const confirmedIds = (eventDjs || []).map((d) => d.dj_id);

  if (confirmedIds.length > 0) {
    const { data: djRows } = await supabase
      .from('djs')
      .select('id, user_id, stage_name, first_name, last_name, profile_image_url')
      .in('id', confirmedIds);
    const byId = new Map<string, DjRow>(((djRows || []) as DjRow[]).map((d) => [d.id, d]));
    for (const id of confirmedIds) {
      const d = byId.get(id);
      entries.push({
        djId: id,
        djUserId: d?.user_id ?? null,
        name: d ? djDisplayName(d) : '—',
        imageUrl: d?.profile_image_url ?? null,
        status: 'confirmed',
      });
    }
  }

  const { data: requests } = await supabase
    .from('dj_booking_requests')
    .select('id, dj_user_id')
    .eq('event_id', eventId)
    .eq('status', 'pending');

  const pendingUserIds = (requests || []).map((r) => r.dj_user_id);
  if (pendingUserIds.length > 0) {
    const { data: djRows } = await supabase
      .from('djs')
      .select('id, user_id, stage_name, first_name, last_name, profile_image_url')
      .in('user_id', pendingUserIds);
    const byUser = new Map<string, DjRow>();
    for (const d of (djRows || []) as DjRow[]) {
      if (d.user_id && !byUser.has(d.user_id)) byUser.set(d.user_id, d);
    }
    for (const r of requests || []) {
      const d = byUser.get(r.dj_user_id);
      entries.push({
        djId: d?.id ?? r.dj_user_id,
        djUserId: r.dj_user_id,
        name: d ? djDisplayName(d) : 'DJ',
        imageUrl: d?.profile_image_url ?? null,
        status: 'pending',
        requestId: r.id,
      });
    }
  }

  return entries;
}

export type SaveLineupArgs = {
  eventId: string;
  /** Date locale de la soirée, 'yyyy-MM-dd' (sert de requested_date + base du créneau). */
  eventLocalDate: string;
  scope: { venueId?: string | null; organizerUserId?: string | null };
  entries: LineupEntry[];
  /** État chargé à l'ouverture du formulaire — sert à détecter les demandes retirées. */
  initialEntries: LineupEntry[];
  /** Genres musicaux de la soirée — transmis comme brief au DJ. */
  eventGenres?: string[];
};

export type SaveLineupResult = {
  /** dj_ids nouvellement inscrits en direct (pour la notification aux followers). */
  addedDirectIds: string[];
  /** Nombre de demandes de booking envoyées. */
  requestsSent: number;
  /** dj_ids présents dans event_djs après sauvegarde (diff send-event-update). */
  directIds: string[];
  /** Échecs par DJ (demande refusée par le serveur : doublon, droits...). */
  errors: Array<{ name: string; message: string }>;
};

/**
 * Persiste le line-up d'une soirée déjà enregistrée :
 *  - DJs confirmés + ajouts directs → delete + reinsert event_djs (sémantique historique) ;
 *  - demandes retirées du formulaire → cancel_dj_booking_request ;
 *  - nouveaux DJs avec compte → create_dj_booking_request (le DJ validera).
 */
export async function saveLineup(args: SaveLineupArgs): Promise<SaveLineupResult> {
  const { eventId, eventLocalDate, scope, entries, initialEntries, eventGenres } = args;
  const result: SaveLineupResult = { addedDirectIds: [], requestsSent: 0, directIds: [], errors: [] };

  // 1. Lignes event_djs (confirmés + ajouts directs).
  const directIds = entries
    .filter((e) => e.status === 'confirmed' || e.status === 'draft_direct')
    .map((e) => e.djId);
  const initialDirectIds = new Set(
    initialEntries.filter((e) => e.status === 'confirmed').map((e) => e.djId),
  );
  await supabase.from('event_djs').delete().eq('event_id', eventId);
  if (directIds.length > 0) {
    await supabase
      .from('event_djs')
      .insert(directIds.map((djId) => ({ event_id: eventId, dj_id: djId })));
  }
  result.directIds = directIds;
  result.addedDirectIds = directIds.filter((id) => !initialDirectIds.has(id));

  // 2. Demandes en attente retirées du formulaire → annulation.
  const keptRequestIds = new Set(
    entries.filter((e) => e.status === 'pending' && e.requestId).map((e) => e.requestId as string),
  );
  for (const e of initialEntries) {
    if (e.status !== 'pending' || !e.requestId || keptRequestIds.has(e.requestId)) continue;
    const { error } = await supabase.rpc('cancel_dj_booking_request', { p_id: e.requestId });
    if (error) result.errors.push({ name: e.name, message: error.message });
  }

  // 3. Nouveaux DJs avec compte → demande de booking liée à la soirée.
  const genres = (eventGenres || []).filter((g) => (MUSIC_GENRES as readonly string[]).includes(g));
  for (const e of entries) {
    if (e.status !== 'draft_request' || !e.djUserId) continue;
    const slot = buildLineupSlot(
      new Date(`${eventLocalDate}T00:00:00`),
      e.startTime || '22:00',
      e.endTime || '04:00',
    );
    const { error } = await supabase.rpc('create_dj_booking_request', {
      p_dj_user_id: e.djUserId,
      p_requested_date: eventLocalDate,
      p_start: slot.start,
      p_end: slot.end,
      p_agreed_fee: e.fee ?? undefined,
      p_message: e.note || undefined,
      p_event_id: eventId,
      p_requested_genres: genres.length ? genres : undefined,
      p_venue_id: scope.venueId ?? undefined,
      p_organizer_user_id: scope.organizerUserId ?? undefined,
    });
    if (error) result.errors.push({ name: e.name, message: error.message });
    else result.requestsSent += 1;
  }

  return result;
}
