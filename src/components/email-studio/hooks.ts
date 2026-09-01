import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  EmailBlock, EmailTemplate, EmailTemplateRow, LiveData, TemplateContent, TicketRow,
} from '@/lib/email';
import { rowToTemplate, templateContentToRow, YUNO_BLOCK_TYPES } from '@/lib/email';

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

export interface ImportedList {
  id: string;
  /** Nom affiché : celui du pro, sinon le nom de fichier sans extension. */
  name: string;
  /** Ce vers quoi on retombe si le pro efface son nom. */
  fallbackName: string;
  createdAt: string;
  count: number;
}

/**
 * Listes importées de la portée — un fichier importé reste un segment à part.
 * Disponible aux DEUX portées, contrairement aux segments sauvegardés qui sont
 * venue-only. L'effectif est recompté en direct (un désabonnement le fait
 * baisser), jamais lu dans le rapport d'import figé.
 */
export function useImportedLists(scope: StudioScope): {
  lists: ImportedList[];
  rename: (id: string, name: string) => Promise<boolean>;
} {
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
        // Le nom donné par le pro à l'import ; à défaut (imports d'avant
        // le champ, ou nom effacé), le nom de fichier sans son extension.
        const fallbackName = (r.filename || '').replace(/\.[a-z0-9]+$/i, '').trim() || 'Import';
        return {
          id: r.id,
          name: (r.list_name || '').trim() || fallbackName,
          fallbackName,
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

  // Renommage : `email_list_imports` n'a aucune policy d'écriture, la RPC
  // SECURITY DEFINER est le seul chemin. Un nom vide remet la valeur à NULL,
  // donc l'affichage retombe sur le nom de fichier.
  const rename = useCallback(async (id: string, name: string) => {
    const { data, error } = await supabase.rpc('rename_email_list_import' as never, {
      p_import_id: id, p_name: name,
    } as never);
    if (error) return false;
    const applied = ((data as unknown) as string | null) || '';
    setLists((prev) => prev.map((l) => (
      l.id === id ? { ...l, name: applied.trim() || l.fallbackName } : l
    )));
    return true;
  }, []);

  return { lists, rename };
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

// ── Modèles d'email ──────────────────────────────────────────────────────────

/**
 * Modèles enregistrés de la portée. Le hook porte AUSSI les écritures : la
 * galerie et la boîte de dialogue « enregistrer comme modèle » partagent la
 * même liste et le même rafraîchissement, sans dupliquer les requêtes.
 */
export function useEmailTemplates(scope: StudioScope) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const scopeId = scope.kind === 'venue' ? scope.venueId : scope.organizerId;
  const scopeKind = scope.kind;

  const load = useCallback(async () => {
    const q = supabase.from('email_campaign_templates')
      .select('id,name,description,type,subject,preheader,blocks_json,theme_json,social_links_json,logo_url,use_count,last_used_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(60);
    const { data } = scopeKind === 'venue'
      ? await q.eq('venue_id', scopeId)
      : await q.eq('organizer_user_id', scopeId);
    setTemplates(((data || []) as unknown as EmailTemplateRow[]).map(rowToTemplate));
    setLoading(false);
  }, [scopeKind, scopeId]);

  useEffect(() => { void load(); }, [load]);

  /** Crée un modèle depuis le design courant. Renvoie l'id, ou null en échec. */
  const create = useCallback(async (
    name: string, description: string, content: TemplateContent,
  ): Promise<string | null> => {
    const { data: auth } = await supabase.auth.getUser();
    const payload: Record<string, unknown> = {
      ...templateContentToRow(content),
      name: name.trim().slice(0, 80),
      description: description.trim().slice(0, 240),
      created_by: auth.user?.id || null,
    };
    if (scopeKind === 'venue') payload.venue_id = scopeId;
    else payload.organizer_user_id = scopeId;
    const { data, error } = await supabase.from('email_campaign_templates')
      .insert(payload as never).select('id').single();
    if (error || !data) return null;
    await load();
    return (data as { id: string }).id;
  }, [scopeKind, scopeId, load]);

  /** Remplace le design d'un modèle existant (et son libellé si fourni). */
  const overwrite = useCallback(async (
    id: string, content: TemplateContent, name?: string, description?: string,
  ): Promise<boolean> => {
    const payload: Record<string, unknown> = { ...templateContentToRow(content) };
    if (name != null) payload.name = name.trim().slice(0, 80);
    if (description != null) payload.description = description.trim().slice(0, 240);
    const { error } = await supabase.from('email_campaign_templates')
      .update(payload as never).eq('id', id);
    if (error) return false;
    await load();
    return true;
  }, [load]);

  /** Copie un modèle sous un nouveau nom — le point de départ d'une variante. */
  const duplicate = useCallback(async (tpl: EmailTemplate, name: string): Promise<boolean> => {
    const id = await create(name, tpl.description, tpl);
    return id != null;
  }, [create]);

  const rename = useCallback(async (id: string, name: string, description: string): Promise<boolean> => {
    const { error } = await supabase.from('email_campaign_templates')
      .update({ name: name.trim().slice(0, 80), description: description.trim().slice(0, 240) } as never)
      .eq('id', id);
    if (error) return false;
    await load();
    return true;
  }, [load]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('email_campaign_templates').delete().eq('id', id);
    if (error) return false;
    setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    return true;
  }, []);

  /** Compteur d'utilisation — best-effort : il ne doit jamais bloquer une création. */
  const bumpUsage = useCallback(async (id: string) => {
    await supabase.rpc('bump_email_template_usage' as never, { p_template_id: id } as never);
  }, []);

  return { templates, loading, reload: load, create, overwrite, duplicate, rename, remove, bumpUsage };
}
