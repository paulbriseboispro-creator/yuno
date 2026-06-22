-- Classement des plus gros events passés d'un DJ (page « tous les events passés »).
-- Les favoris d'events passés sont purgés (FavoritesContext), donc on classe par
-- AFFLUENCE RÉELLE persistante = billets payés (quantité) + inscrits guest list
-- + tables payées. Top 5, events passés publics, respecte show_on_profile.

CREATE OR REPLACE FUNCTION public.get_dj_top_past_events(p_slug text)
RETURNS TABLE (
  id            uuid,
  title         text,
  start_at      timestamptz,
  poster_url    text,
  venue_id      text,
  venue_name    text,
  venue_city    text,
  interest_count int
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT q.id, q.title, q.start_at, q.poster_url, q.venue_id, q.venue_name, q.venue_city, q.interest_count
  FROM (
    SELECT DISTINCT e.id, e.title, e.start_at, e.poster_url, e.venue_id,
      COALESCE(v.name, e.location_name) AS venue_name,
      COALESCE(v.city, e.location_city) AS venue_city,
      (
        COALESCE((SELECT SUM(t.quantity) FROM public.tickets t
                   WHERE t.event_id = e.id AND t.paid_at IS NOT NULL), 0)
        + COALESCE((SELECT COUNT(*) FROM public.guest_list_entries gle
                     JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
                    WHERE gl.event_id = e.id), 0)
        + COALESCE((SELECT COUNT(*) FROM public.table_reservations tr
                    WHERE tr.event_id = e.id AND tr.paid_at IS NOT NULL), 0)
      )::int AS interest_count
    FROM public.event_djs ed
    JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_user
    JOIN public.events e ON e.id = ed.event_id
      AND e.is_active = true AND e.visibility = 'public' AND e.end_at < now()
    LEFT JOIN public.venues v   ON v.id = e.venue_id
    LEFT JOIN public.dj_sets ds ON ds.dj_id = ed.dj_id AND ds.event_id = e.id
    WHERE (ds.id IS NULL OR ds.show_on_profile = true)
  ) q
  WHERE q.interest_count > 0
  ORDER BY q.interest_count DESC, q.start_at DESC
  LIMIT 5;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_top_past_events(text) TO anon, authenticated;
