-- Yuno CRM — Analyses › Ventes : une soirée encore en vente se compare à la
-- précédente au même jour (J-k), pas à toute sa vente. Sinon une soirée à
-- J-6 affichait « -75 % » face à une soirée terminée.

CREATE OR REPLACE FUNCTION public.crm_ana_sales__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL, p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  m jsonb;
  v_n int;
  v_today date;
  v_series jsonb; v_tot jsonb; v_msg jsonb; v_deals jsonb; v_fill jsonb; v_ref jsonb; v_seg_share numeric;
  v_target uuid; v_refs uuid[]; v_goal jsonb;
  v_heat jsonb; v_tariffs jsonb; v_events jsonb; v_other jsonb;
  v_heat_from date; v_heat_to date;
  v_cur_from date; v_prev_from date; v_prev_to date;
  v_cut int;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;

  -- Une soirée encore en vente se compare à la précédente AU MÊME JOUR (J-k) :
  -- au-delà d'aujourd'hui, la précédente n'est pas dans les totaux.
  v_cut := CASE WHEN m->>'mode' = 'event' AND COALESCE((m->'event'->>'upcoming')::boolean, false)
                THEN 21 - COALESCE((m->'event'->>'days_left')::int, 0) ELSE v_n - 1 END;

  SELECT jsonb_agg(jsonb_build_object(
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk a WHERE a.ok AND a.ci = g), 0),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk a WHERE a.ok AND a.ci = g), 0),
           'prev_revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk a WHERE a.ok AND a.pi = g), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk a WHERE a.ok AND a.pi = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL), 0),
           'buyers', count(DISTINCT email) FILTER (WHERE ok AND ci IS NOT NULL),
           'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut), 2), 0),
           'prev_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut), 0),
           'has_prev', bool_or(pi IS NOT NULL),
           'prev_same_day', v_cut < v_n - 1,
           -- Remboursés : part des billets de la fenêtre rendus (montant brut).
           'refund_pct', CASE WHEN sum(amount) FILTER (WHERE ci IS NOT NULL) > 0
                              THEN round(100 * sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL)
                                         / sum(amount) FILTER (WHERE ci IS NOT NULL), 1) END,
           'prev_refund_pct', CASE WHEN sum(amount) FILTER (WHERE pi <= v_cut) > 0
                                   THEN round(100 * sum(amount) FILTER (WHERE refunded AND pi <= v_cut)
                                              / sum(amount) FILTER (WHERE pi <= v_cut), 1) END,
           'refunds', jsonb_build_object(
               'amount', COALESCE(round(sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL), 2), 0),
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ci IS NOT NULL), 2), 0))
         )
    INTO v_tot FROM _atk;

  -- Ce qui a fait vendre : la part venue d'un message Yuno (UTM).
  SELECT jsonb_build_object(
           'share', CASE WHEN sum(amount) > 0 THEN round(100 * sum(amount) FILTER (WHERE src IN ('em', 'sm', 'dm')) / sum(amount), 1) END,
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE src IN ('em', 'sm', 'dm')), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm', 'dm')), 0),
           'by', jsonb_build_object(
             'em', COALESCE(sum(qty) FILTER (WHERE src = 'em'), 0),
             'sm', COALESCE(sum(qty) FILTER (WHERE src = 'sm'), 0),
             'dm', COALESCE(sum(qty) FILTER (WHERE src = 'dm'), 0)))
    INTO v_msg FROM _atk WHERE ok AND ci IS NOT NULL;

  -- Tarifs de la fenêtre.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal, 'price', d.price, 'tickets', d.tickets, 'revenue', d.revenue)
                            ORDER BY d.tickets DESC), '[]'::jsonb)
    INTO v_tariffs FROM (
      SELECT COALESCE(a.deal, '—') AS deal, round(avg(a.price), 2) AS price, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 8) d;

  -- Remplissage des soirées TENUES dans la fenêtre (nuit déjà venue), contre
  -- celles de la fenêtre d'avant ; pour une soirée, elle contre la précédente.
  -- Une soirée encore en vente ne tire pas le remplissage vers le bas.
  IF m->>'mode' = 'hour' THEN
    v_cur_from := public._crm_night_date((m->>'start')::timestamptz, m->>'tz', (m->>'night_end_hour')::int);
    v_prev_from := public._crm_night_date((m->>'start')::timestamptz - make_interval(hours => v_n), m->>'tz', (m->>'night_end_hour')::int);
  ELSIF m->>'mode' = 'month' THEN
    v_cur_from := (m->>'start')::date;
    v_prev_from := ((m->>'start')::date - interval '12 months')::date;
  ELSIF m->>'mode' = 'day' THEN
    v_cur_from := (m->>'start')::date;
    v_prev_from := v_cur_from - v_n;
  END IF;
  v_prev_to := v_cur_from - 1;
  WITH capx AS (
    SELECT e.id, e.night, COALESCE(s.sold, 0) AS sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(s.sold, 0)::int) AS cap
      FROM _aev e
      LEFT JOIN (SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok GROUP BY 1) s ON s.event_id = e.id
  ), cur AS (
    SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'event'->>'id')::uuid
                                              ELSE night BETWEEN v_cur_from AND v_today END
  ), prv AS (
    SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'prev_event'->>'id')::uuid
                                              ELSE night BETWEEN v_prev_from AND v_prev_to END
  )
  SELECT jsonb_build_object(
           'sold', (SELECT sum(sold) FROM cur), 'cap', (SELECT sum(cap) FROM cur), 'nights', (SELECT count(*) FROM cur),
           'prev_sold', (SELECT sum(sold) FROM prv), 'prev_cap', (SELECT sum(cap) FROM prv))
    INTO v_fill;

  IF (m->>'seg') <> 'all' THEN
    SELECT CASE WHEN (SELECT sum(amount) FROM _atk_all WHERE ok AND ci IS NOT NULL) > 0
                THEN round(100 * (SELECT sum(amount) FROM _atk WHERE ok AND ci IS NOT NULL)
                           / (SELECT sum(amount) FROM _atk_all WHERE ok AND ci IS NOT NULL), 1) END
      INTO v_seg_share;
  END IF;

  -- Objectif et courbe : la soirée choisie, sinon la prochaine, sinon la dernière.
  v_target := (m->'event'->>'id')::uuid;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  END IF;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM _aev ORDER BY start_at DESC LIMIT 1;
  END IF;
  IF v_target IS NOT NULL THEN
    SELECT array_agg(id ORDER BY ord) INTO v_refs FROM (
      SELECT e.id, row_number() OVER (ORDER BY (e.series = t.series) DESC, e.start_at DESC) AS ord
        FROM _aev e, _aev t
       WHERE t.id = v_target AND e.id <> t.id AND NOT e.upcoming AND e.start_at < t.start_at
         AND EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
    ) r WHERE ord <= 2;
    v_goal := jsonb_build_object(
      'target', public._crm_ana_curve(v_target, v_today),
      'refs', COALESCE((SELECT jsonb_agg(public._crm_ana_curve(x, v_today) ORDER BY o) FROM unnest(v_refs) WITH ORDINALITY u(x, o)), '[]'::jsonb),
      'week_sold', COALESCE((SELECT sum(qty) FROM _atk_all WHERE event_id = v_target AND ok AND nd > v_today - 7), 0));
  END IF;

  -- Quand achètent-ils : jour (règle de nuit) × tranche de 2 h, 10 h → 2 h.
  IF m->>'mode' = 'hour' THEN
    v_heat_from := v_today - 29; v_heat_to := v_today;
  END IF;
  WITH h AS (
    SELECT (extract(isodow FROM a.nd)::int - 1) AS r,
           CASE WHEN a.hr >= 10 THEN (a.hr - 10) / 2 WHEN a.hr < 2 THEN 7 END AS c,
           a.qty, a.amount
      FROM _atk a
     WHERE a.ok
       AND CASE WHEN v_heat_from IS NOT NULL THEN a.nd BETWEEN v_heat_from AND v_heat_to ELSE a.ci IS NOT NULL END
  )
  SELECT jsonb_build_object(
           'cells', (SELECT jsonb_agg((SELECT jsonb_agg(jsonb_build_object(
                         'n', COALESCE((SELECT count(*) FROM h WHERE h.r = rr AND h.c = cc), 0),
                         'amount', COALESCE((SELECT round(sum(h.amount), 2) FROM h WHERE h.r = rr AND h.c = cc), 0)) ORDER BY cc)
                       FROM generate_series(0, 7) cc) ORDER BY rr)
                     FROM generate_series(0, 6) rr),
           'outside', (SELECT count(*) FROM h WHERE h.c IS NULL),
           'days30', v_heat_from IS NOT NULL)
    INTO v_heat;

  -- Soirées qui ont vendu dans la fenêtre (les 7 premières, puis le reste).
  WITH per AS (
    SELECT a.event_id, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL AND a.event_id IS NOT NULL GROUP BY 1
  ), tot AS (
    SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), rows AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming, p.tickets, p.revenue, COALESCE(t.sold, 0) AS sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(t.sold, 0)::int) AS cap,
           (SELECT COALESCE(t2.sold, 0) FROM _aev e2 LEFT JOIN tot t2 ON t2.event_id = e2.id
             WHERE e2.start_at < e.start_at AND e2.id <> e.id AND NOT e2.upcoming
             ORDER BY (e2.series = e.series) DESC, e2.start_at DESC LIMIT 1) AS prev_sold,
           row_number() OVER (ORDER BY p.revenue DESC, p.tickets DESC) AS rk
      FROM per p JOIN _aev e ON e.id = p.event_id LEFT JOIN tot t ON t.event_id = e.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'start_at', start_at, 'night', night, 'upcoming', upcoming,
           'state', CASE WHEN night = v_today THEN 'tonight' WHEN upcoming THEN 'presale' ELSE 'past' END,
           'tickets', tickets, 'revenue', revenue, 'sold', sold, 'cap', cap, 'prev_sold', prev_sold
         ) ORDER BY start_at DESC) FILTER (WHERE rk <= 7), '[]'::jsonb),
         CASE WHEN count(*) > 7 THEN jsonb_build_object('count', count(*) FILTER (WHERE rk > 7),
                'tickets', sum(tickets) FILTER (WHERE rk > 7), 'revenue', sum(revenue) FILTER (WHERE rk > 7)) END
    INTO v_events, v_other
    FROM rows;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'totals', v_tot,
    'msg', v_msg,
    'tariffs', v_tariffs,
    'fill', v_fill,
    'seg_share', v_seg_share,
    'goal', v_goal,
    'heat', v_heat,
    'events', v_events,
    'events_other', v_other,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_ana_sales__core(text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_sales__core(text, uuid, text, uuid, text) TO service_role;
