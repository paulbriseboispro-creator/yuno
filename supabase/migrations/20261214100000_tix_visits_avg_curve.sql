-- Yuno Tickets › Analyses › Trafic d'une soirée : comparer aussi à la MOYENNE
-- des soirées précédentes (demande de Paul, 13/11).
--
-- La courbe d'une soirée (`curve` de tix_ana_visits, mode soirée) gagne :
--   'avg'        : visites cumulées MOYENNES au même jour avant la soirée
--                  (même axe J-n → J-0 que `cur` / `prev`, une décimale) ;
--   'avg_day'    : la même moyenne, jour par jour (visites du seul jour J-k) ;
--   'avg_nights' : les soirées moyennées (id, titre, date), la plus récente d'abord.
-- Soirées moyennées = les 10 dernières soirées TERMINÉES de la portée avant
-- celle-ci, avec des ventes et au moins une visite mesurée. Moins de deux
-- soirées : rien (null), l'écran ne propose pas la moyenne.
--
-- Le « par jour » de la soirée et de la soirée comparée se déduit de leurs
-- courbes cumulées côté écran ; la moyenne a sa série par jour ici, car les
-- soirées moyennées peuvent avoir des visites plus anciennes que le début de
-- l'axe (elles sont dans le cumul du premier point, pas dans son jour).
--
-- Modifie la définition VIVANTE par repères exacts (même méthode que _mcp_tool) :
-- un repère introuvable lève, rien n'est changé à moitié.

DO $mig$
DECLARE
  d text;
  a text; b text;
BEGIN
  d := pg_get_functiondef('public.tix_ana_visits__core(text,uuid,text,uuid,uuid)'::regprocedure);
  IF position('avg_nights' IN d) > 0 THEN RETURN; END IF;

  -- 1. Variables.
  a := $r$m jsonb; v_labels jsonb; r jsonb; v_keep jsonb := '[]'::jsonb;$r$;
  b := $r$m jsonb; v_labels jsonb; r jsonb; v_keep jsonb := '[]'::jsonb;
  v_avg_ids uuid[] := '{}'; v_avg jsonb;$r$;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION 'tix_visits_avg: repère DECLARE introuvable'; END IF;
  d := replace(d, a, b);

  -- 2. La moyenne, calculée une fois l'axe connu (v_D), en fin de branche « soirée ».
  a := $r$      FROM public.events e JOIN public.venues s ON s.id = COALESCE(e.venue_id, e.partner_venue_id) WHERE e.id = v_ev_id;
  ELSIF p_period IN ('24h', '48h') THEN$r$;
  b := $r$      FROM public.events e JOIN public.venues s ON s.id = COALESCE(e.venue_id, e.partner_venue_id) WHERE e.id = v_ev_id;
    -- La moyenne des dernières soirées terminées de la portée (10 au plus, avec ventes et visites),
    -- au même jour avant LEUR soirée. Deux soirées au moins.
    SELECT COALESCE(array_agg(x.id), '{}') INTO v_avg_ids FROM (
      SELECT e.id FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
       WHERE e.id <> v_ev_id AND e.start_at < v_ev_start
         AND COALESCE(e.end_at, e.start_at + interval '8 hours') < v_now
         AND public._tix_event_has_sales(e.id)
         AND EXISTS (SELECT 1 FROM public.visitor_sessions s WHERE s.event_id = e.id)
       ORDER BY e.start_at DESC LIMIT 10) x;
    IF cardinality(v_avg_ids) >= 2 THEN
      WITH an AS MATERIALIZED (
        SELECT e.id, e.title, e.start_at, public._crm_night_date(e.start_at, e.tz, v_eh) AS night
          FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = ANY (v_avg_ids)
      ), ad AS MATERIALIZED (
        SELECT an.night - public._crm_night_date(s.visited_at, v_tz, v_eh) AS d, count(*) AS n
          FROM public.visitor_sessions s JOIN an ON an.id = s.event_id GROUP BY 1
      )
      SELECT jsonb_build_object(
        'nights', (SELECT jsonb_agg(jsonb_build_object('id', an.id, 'title', an.title, 'start_at', an.start_at) ORDER BY an.start_at DESC) FROM an),
        'cum', (SELECT jsonb_agg(round(COALESCE((SELECT sum(ad.n) FROM ad WHERE ad.d >= v_D - g), 0)::numeric / cardinality(v_avg_ids), 1) ORDER BY g)
                  FROM generate_series(0, v_D) g),
        'day', (SELECT jsonb_agg(round(COALESCE((SELECT sum(ad.n) FROM ad WHERE ad.d = v_D - g), 0)::numeric / cardinality(v_avg_ids), 1) ORDER BY g)
                  FROM generate_series(0, v_D) g))
        INTO v_avg;
    END IF;
  ELSIF p_period IN ('24h', '48h') THEN$r$;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION 'tix_visits_avg: repère fin de branche soirée introuvable'; END IF;
  d := replace(d, a, b);

  -- 3. La sortie : trois clés de plus dans `curve`.
  a := $r$                SELECT jsonb_agg((SELECT count(*) FROM v WHERE v.event_id = v_cev_id AND v.d >= v_D - g) ORDER BY g)
                  FROM generate_series(0, v_D) g) END) END,$r$;
  b := $r$                SELECT jsonb_agg((SELECT count(*) FROM v WHERE v.event_id = v_cev_id AND v.d >= v_D - g) ORDER BY g)
                  FROM generate_series(0, v_D) g) END,
      'avg', v_avg->'cum', 'avg_day', v_avg->'day', 'avg_nights', v_avg->'nights') END,$r$;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION 'tix_visits_avg: repère curve introuvable'; END IF;
  d := replace(d, a, b);

  EXECUTE d;
END
$mig$;
