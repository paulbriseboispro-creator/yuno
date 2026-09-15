-- get_email_send_time_insights : une fonction STABLE ne peut pas créer de table
-- temporaire (0A000, attrapé par `supabase db lint --linked`). Même calcul,
-- en CTE : ouvertures des 120 derniers jours de la portée, par heure et par
-- jour de semaine (Europe/Paris), meilleure fenêtre de 2 h et meilleur jour
-- à partir de 30 ouvertures.
CREATE OR REPLACE FUNCTION public.get_email_send_time_insights(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  WITH opens AS (
    SELECT extract(hour from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer AS h,
           extract(isodow from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer AS d
      FROM public.email_campaign_events ev
      JOIN public.email_campaigns c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened'
       AND ev.created_at > now() - interval '120 days'
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  ),
  by_hour AS (
    SELECT g.h, count(o.h) AS n FROM generate_series(0, 23) AS g(h) LEFT JOIN opens o ON o.h = g.h GROUP BY g.h
  ),
  by_dow AS (
    SELECT g.d, count(o.d) AS n FROM generate_series(1, 7) AS g(d) LEFT JOIN opens o ON o.d = g.d GROUP BY g.d
  ),
  windows AS (
    -- Fenêtre glissante de 2 h : l'heure h compte ses ouvertures et celles de h+1.
    SELECT a.h, a.n + b.n AS n
      FROM by_hour a JOIN by_hour b ON b.h = (a.h + 1) % 24
  ),
  totals AS (SELECT count(*) AS sample FROM opens)
  SELECT jsonb_build_object(
    'sample', t.sample,
    'by_hour', (SELECT jsonb_agg(n ORDER BY h) FROM by_hour),
    'by_dow', (SELECT jsonb_agg(n ORDER BY d) FROM by_dow),
    'best_hour', CASE WHEN t.sample >= 30 THEN (SELECT h FROM windows ORDER BY n DESC, h ASC LIMIT 1) END,
    'best_dow', CASE WHEN t.sample >= 30 THEN (SELECT d FROM by_dow ORDER BY n DESC, d ASC LIMIT 1) END
  ) INTO result
  FROM totals t;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_send_time_insights(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_send_time_insights(text, uuid) TO authenticated, service_role;
