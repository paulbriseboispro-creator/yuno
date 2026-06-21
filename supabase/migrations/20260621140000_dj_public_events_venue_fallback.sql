-- Les events organisateur n'ont pas de venue_id (ils utilisent events.location_name/city).
-- On affiche ce lieu comme label de venue, sinon les gigs orga d'un DJ apparaissent sans
-- endroit sur sa page publique + son EPK. Recrée la fonction (même signature, corps enrichi).
CREATE OR REPLACE FUNCTION public.get_dj_public_events(p_slug text)
RETURNS TABLE (
  id         uuid,
  title      text,
  start_at   timestamptz,
  end_at     timestamptz,
  poster_url text,
  venue_id   text,
  venue_name text,
  venue_city text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT e.id, e.title, e.start_at, e.end_at, e.poster_url, e.venue_id,
         COALESCE(v.name, e.location_name) AS venue_name,
         COALESCE(v.city, e.location_city) AS venue_city
  FROM public.event_djs ed
  JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_user
  JOIN public.events e ON e.id = ed.event_id AND e.is_active = true AND e.visibility = 'public'
  LEFT JOIN public.venues v ON v.id = e.venue_id
  ORDER BY e.start_at ASC;
END; $$;
