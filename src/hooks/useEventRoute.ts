import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * Résout l'event courant depuis l'URL — ancienne (`/club/:slug/event/:eventId/...`)
 * OU propre (`/events/:host/:eventSlug/...`) — et fournit le `basePath` pour
 * construire tous les liens du tunnel (billets, checkout, table, waitlist, guest list).
 *
 * L'eventId (UUID) reste la clé de toutes les requêtes. Il vient, dans l'ordre :
 *   1. du param `:eventId` (ancienne route) — synchrone,
 *   2. de `location.state.eventId` passé par la page précédente — synchrone,
 *   3. sinon résolu depuis `:host` + `:eventSlug` via `resolve_event_path` (RPC anon).
 *
 * Passe toujours `{ state: { eventId } }` quand tu navigues d'une étape à l'autre :
 * le tunnel reste synchrone (aucun RPC), la résolution ne sert qu'aux liens directs.
 */
export function useEventRoute() {
  const params = useParams();
  const location = useLocation();
  const host = params.host;
  const eventSlug = params.eventSlug;
  const venueSlug = params.slug;          // ancienne route /club/:slug/...
  const eventIdParam = params.eventId;    // ancienne route .../event/:eventId
  const stateEventId = (location.state as { eventId?: string } | null)?.eventId;
  const isClean = !!(host && eventSlug);

  const [eventId, setEventId] = useState<string | undefined>(eventIdParam || stateEventId);
  const [resolving, setResolving] = useState<boolean>(isClean && !eventIdParam && !stateEventId);

  useEffect(() => {
    if (eventIdParam || stateEventId) {
      setEventId(eventIdParam || stateEventId);
      setResolving(false);
      return;
    }
    if (!host || !eventSlug) {
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    (async () => {
      const { data } = await supabase.rpc('resolve_event_path', { p_host: host, p_slug: eventSlug } as never);
      const row = Array.isArray(data) ? (data[0] as { event_id?: string } | undefined) : undefined;
      if (cancelled) return;
      setEventId(row?.event_id);
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [host, eventSlug, eventIdParam, stateEventId]);

  // Base pour tous les liens du tunnel. Propre quand on est sur /events/:host/:eventSlug,
  // sinon l'ancienne forme /club/:slug/event/:eventId (préservée pour la preview owner,
  // que usePreviewNavigate réécrit en /owner/preview/...).
  const basePath = isClean
    ? `/events/${host}/${eventSlug}`
    : `/club/${venueSlug}/event/${eventIdParam}`;

  return { eventId, basePath, resolving, isClean, venueSlug, host, eventSlug };
}
