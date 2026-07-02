-- get_agency_upcoming_events: événements à venir chez tous les clubs partenaires actifs.
-- assign_agency_promoter_to_event: contourne la RLS venue-only de promoter_event_assignments.

CREATE OR REPLACE FUNCTION public.get_agency_upcoming_events(
  p_agency_id  uuid,
  p_days_ahead int DEFAULT 30
)
RETURNS TABLE(
  event_id               uuid,
  title                  text,
  start_at               timestamptz,
  venue_id               text,
  venue_name             text,
  organizer_user_id      uuid,
  is_active              boolean,
  assigned_promoter_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    e.id,
    e.title,
    e.start_at,
    e.venue_id,
    v.name                 AS venue_name,
    e.organizer_user_id,
    e.is_active,
    COUNT(DISTINCT pea.promoter_id) FILTER (
      WHERE pea.promoter_id IN (
        SELECT p.id FROM public.promoters p WHERE p.agency_id = p_agency_id
      )
    )                      AS assigned_promoter_count
  FROM public.agency_venue_contracts avc
  JOIN public.events e
    ON (avc.venue_id IS NOT NULL AND e.venue_id = avc.venue_id)
    OR (avc.organizer_user_id IS NOT NULL AND e.organizer_user_id = avc.organizer_user_id)
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN public.promoter_event_assignments pea ON pea.event_id = e.id
  WHERE avc.agency_id = p_agency_id
    AND avc.status    = 'active'
    AND e.start_at   >= now()
    AND e.start_at   <= now() + (p_days_ahead || ' days')::interval
    AND public.is_agency_owner(auth.uid(), p_agency_id)
  GROUP BY e.id, e.title, e.start_at, e.venue_id, v.name, e.organizer_user_id, e.is_active
  ORDER BY e.start_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_upcoming_events(uuid, int) TO authenticated;

-- Assigne (ou désassigne) un promoteur de l'agence à un événement.
-- Nécessaire car la RLS de promoter_event_assignments vérifie le propriétaire de venue,
-- pas le propriétaire d'agence.
CREATE OR REPLACE FUNCTION public.assign_agency_promoter_to_event(
  p_promoter_id uuid,
  p_event_id    uuid,
  p_assign      boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
  SELECT agency_id INTO v_agency_id
    FROM public.promoters
   WHERE id = p_promoter_id;

  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'promoter not found or not agency-managed';
  END IF;

  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_assign THEN
    INSERT INTO public.promoter_event_assignments(promoter_id, event_id)
         VALUES (p_promoter_id, p_event_id)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.promoter_event_assignments
          WHERE promoter_id = p_promoter_id
            AND event_id    = p_event_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_agency_promoter_to_event(uuid, uuid, boolean) TO authenticated;
