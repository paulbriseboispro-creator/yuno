-- Console Yuno Tickets : une soirée sans aucune vente ne fausse plus les comparaisons
-- (audit du 28/10/2026, House Of Masquerade).
--
-- Constat : « House Of Love #1 » (Amoris) est restée active, billetterie
-- ouverte et 150 places, sans une seule vente Yuno. Elle tirait le remplissage
-- des 30 jours à 41 % (« sur 2 soirées »), servait de soirée comparée à House Of
-- Masquerade (▲ 61 pts contre une soirée vide) dans Ventes et Trafic, et le
-- brouillon inactif « Sunset to Sunrise » entrait avec elle dans « Tes 4
-- dernières soirées » de l'accueil.
--
-- Règle unique, `_tix_event_has_sales(soirée)` : une soirée a eu lieu sur Yuno
-- si elle porte au moins un billet payé, une table payée ou confirmée, ou une
-- inscription guest list non annulée (mêmes statuts que `_tix_sales`).
--   * `_tix_scope_events` : une soirée INACTIVE sans vente sort de la portée
--     d'analyse (un brouillon n'est pas une soirée) ; une soirée dépubliée après
--     des ventes reste.
--   * `_tix_ana_setup`, `tix_ana_visits__core` : la soirée comparée par défaut
--     est la précédente QUI A EU des ventes (même série d'abord).
--   * `tix_ana_sales__core` : le remplissage (billets et tables) ne compte que
--     les soirées à venir ou qui ont eu des ventes.
--   * `get_sales_overview` (accueil « Tes 4 dernières soirées », Ventes de
--     l'ancien écran, MCP) : seulement les soirées qui ont eu des ventes.
--
-- Au passage (même audit) :
--   * `tix_ana_free_detail__core` : une guest list INACTIVE sans inscrit
--     (aperçu de test, liste maison jamais ouverte) n'entre plus dans les
--     quotas (107 places au lieu de 2 pour House Of Masquerade).
--   * `get_event_report.channels` lit l'attribution figée sur la vente
--     (`attribution_source`) avant `purchase_source` : 126 ventes venues d'un
--     lien suivi étaient comptées « direct ». C'est ce que lit l'IA du pro (MCP).
--
-- Toutes les définitions partent de `pg_get_functiondef` de la prod du 28/10.

CREATE OR REPLACE FUNCTION public._tix_event_has_sales(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event AND t.status IN ('paid', 'used'))
      OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = p_event AND r.status IN ('paid', 'confirmed'))
      OR EXISTS (SELECT 1 FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                  WHERE gl.event_id = p_event AND g.status NOT IN ('cancelled', 'rejected', 'refused', 'declined'));
$function$;
REVOKE ALL ON FUNCTION public._tix_event_has_sales(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._tix_scope_events(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(id uuid, title text, start_at timestamp with time zone, end_at timestamp with time zone, tz text, max_tickets integer, money boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '6 hours'),
         COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'), e.max_tickets,
         CASE WHEN p_venue_id IS NULL THEN true ELSE e.venue_id IS NOT DISTINCT FROM p_venue_id END
    FROM public.events e
   WHERE e.external_source IS NULL
     AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') <> 'cancelled'
     AND (e.is_active OR public._tix_event_has_sales(e.id))
     AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
       OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)));
$function$;

CREATE OR REPLACE FUNCTION public._tix_ana_setup(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid, p_seg text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_rules record;
  v_eh integer;
  v_now timestamptz := now();
  v_today date;
  v_mode text;
  v_n integer;
  v_start timestamptz; v_end timestamptz;
  v_d0 date; v_m0 date;
  v_ev_id uuid; v_ev_title text; v_ev_start timestamptz; v_ev_night date; v_ev_upcoming boolean; v_ev_series text;
  v_pev_id uuid; v_pev_title text; v_pev_start timestamptz; v_pev_night date;
  v_seg text := CASE WHEN p_seg IN ('hab', 'occ', 'nou', 'end', 'none') THEN p_seg ELSE 'all' END;
  v_labels jsonb;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  v_eh := v_rules.night_end_hour;
  v_today := public._crm_night_date(v_now, v_tz, v_eh);

  -- La base des personnes ne sert ici qu'à filtrer un segment.
  IF v_seg <> 'all' THEN
    PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id);
  ELSE
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, 'suite');
  END IF;

  DROP TABLE IF EXISTS _aev;
  CREATE TEMP TABLE _aev ON COMMIT DROP AS
  SELECT e.id, e.title, COALESCE(public._crm_night_series(e.title), e.title) AS series, e.start_at,
         e.end_at > v_now AS upcoming,
         public._crm_night_date(e.start_at, e.tz, v_eh) AS night,
         NULL::integer AS left_tickets,
         CASE WHEN COALESCE(e.max_tickets, 0) > 0 THEN jsonb_build_array(jsonb_build_object('quantity', e.max_tickets))
              ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('quantity', CASE WHEN COALESCE(r.max_tickets, 0) > 0 THEN r.max_tickets END)), '[]'::jsonb)
                      FROM public.ticket_rounds r WHERE r.event_id = e.id) END AS deals
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e;

  IF p_event IS NOT NULL THEN
    SELECT id, title, start_at, night, upcoming, series
      INTO v_ev_id, v_ev_title, v_ev_start, v_ev_night, v_ev_upcoming, v_ev_series
      FROM _aev WHERE id = p_event;
    IF v_ev_id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;
    SELECT id, title, start_at, night INTO v_pev_id, v_pev_title, v_pev_start, v_pev_night
      FROM _aev
     WHERE start_at < v_ev_start AND id <> v_ev_id AND public._tix_event_has_sales(id)
     ORDER BY (series = v_ev_series) DESC, start_at DESC LIMIT 1;
    v_mode := 'event'; v_n := 22;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_end := date_trunc('hour', v_now) + interval '1 hour';
    v_start := v_end - make_interval(hours => v_n);
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
  END IF;

  DROP TABLE IF EXISTS _atk_all;
  CREATE TEMP TABLE _atk_all ON COMMIT DROP AS
  SELECT q.*,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start AND q.bought_at < v_end
                                 THEN floor(extract(epoch FROM q.bought_at - v_start) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 AND v_today THEN q.nd - v_d0 END
           WHEN 'month' THEN CASE WHEN q.nd >= v_m0 AND q.nd <= v_today
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0)) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0))::int END
           ELSE CASE WHEN q.event_id = v_ev_id THEN 21 - LEAST(21, GREATEST(0, v_ev_night - q.nd)) END
         END AS ci,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start - make_interval(hours => v_n) AND q.bought_at < v_start
                                 THEN floor(extract(epoch FROM q.bought_at - (v_start - make_interval(hours => v_n))) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 - v_n AND v_d0 - 1 THEN q.nd - (v_d0 - v_n) END
           WHEN 'month' THEN CASE WHEN q.nd >= (v_m0 - interval '12 months')::date AND q.nd < v_m0
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0 - interval '12 months')) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0 - interval '12 months'))::int END
           ELSE CASE WHEN q.event_id = v_pev_id THEN 21 - LEAST(21, GREATEST(0, v_pev_night - q.nd)) END
         END AS pi
    FROM (
      SELECT t.id, t.email, t.quantity AS qty, t.amount,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS ok, t.status = 'refunded' AS refunded,
             t.purchased_at AS bought_at, t.event_id, t.pillar,
             t.deal_name AS deal, t.order_ref AS ord, t.price, t.src,
             t.scanned_at, t.age, t.city,
             public._crm_night_date(t.purchased_at, v_tz, v_eh) AS nd,
             extract(hour FROM t.purchased_at AT TIME ZONE v_tz)::int AS hr
        FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
    ) q;
  CREATE INDEX ON _atk_all (event_id);
  CREATE INDEX ON _atk_all (email);

  DROP TABLE IF EXISTS _atk;
  IF v_seg = 'all' THEN
    CREATE TEMP TABLE _atk ON COMMIT DROP AS SELECT * FROM _atk_all;
  ELSE
    CREATE TEMP TABLE _atk ON COMMIT DROP AS
    SELECT a.* FROM _atk_all a JOIN _cp p ON p.email = a.email AND p.lifecycle = v_seg;
  END IF;

  SELECT jsonb_agg(CASE v_mode
           WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
           WHEN 'day' THEN to_jsonb(v_d0 + g)
           WHEN 'month' THEN to_jsonb((v_m0 + make_interval(months => g))::date)
           ELSE to_jsonb(v_ev_night - (21 - g)) END ORDER BY g)
    INTO v_labels FROM generate_series(0, v_n - 1) g;

  RETURN jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', v_seg, 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'money', public._tix_money(p_venue_id, p_organizer_user_id),
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - 21) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night, 'upcoming', v_ev_upcoming,
        'days_left', GREATEST(0, v_ev_night - v_today)) END,
    'prev_event', CASE WHEN v_pev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_pev_id, 'title', v_pev_title, 'start_at', v_pev_start, 'night', v_pev_night) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_sales__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text, p_pillar text DEFAULT 'all'::text, p_compare uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_today date;
  v_pillar text := CASE WHEN p_pillar IN ('tickets', 'tables', 'guestlist', 'refunds') THEN p_pillar ELSE 'all' END;
  v_side text := CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END;
  v_series jsonb; v_tot jsonb; v_msg jsonb; v_fill jsonb; v_seg_share numeric;
  v_target uuid; v_refs uuid[]; v_goal jsonb;
  v_heat jsonb; v_tariffs jsonb; v_events jsonb; v_other jsonb;
  v_heat_from date; v_heat_to date;
  v_cur_from date; v_prev_from date; v_prev_to date;
  v_cut int;
  v_payout jsonb; v_tables jsonb; v_gl jsonb; v_refunds jsonb;
  v_cmp jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;
  m := m || jsonb_build_object('pillar', v_pillar);

  -- « Comparer avec » (lot 2) : une soirée choisie remplace la précédente de la
  -- série, sur les mêmes cases J-21 → J. Elle doit être de la portée (_aev).
  IF p_compare IS NOT NULL AND m->>'mode' = 'event' AND p_compare IS DISTINCT FROM (m->'event'->>'id')::uuid THEN
    SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night)
      INTO v_cmp FROM _aev e WHERE e.id = p_compare;
    IF v_cmp IS NOT NULL THEN
      UPDATE _atk_all SET pi = CASE WHEN event_id = p_compare
                                    THEN 21 - LEAST(21, GREATEST(0, (v_cmp->>'night')::date - nd)) END;
      UPDATE _atk SET pi = CASE WHEN event_id = p_compare
                                THEN 21 - LEAST(21, GREATEST(0, (v_cmp->>'night')::date - nd)) END;
      m := jsonb_set(m, '{prev_event}', v_cmp);
    END IF;
  END IF;

  -- Un pilier : l'écran ne lit plus que ses ventes. Une table VIP compte pour
  -- UNE vente (elle n'a pas de place de billetterie), une inscription guest
  -- list aussi (elle n'est pas une vente). `_atk_all` reste entier : la jauge,
  -- la courbe et l'objectif lisent les billets de la soirée.
  IF v_pillar IN ('tickets', 'tables', 'guestlist') THEN
    DELETE FROM _atk WHERE pillar <> v_pillar;
    IF v_pillar = 'tables' THEN UPDATE _atk SET qty = 1; END IF;
    IF v_pillar = 'guestlist' THEN UPDATE _atk SET ok = true; END IF;
  END IF;

  v_cut := CASE WHEN m->>'mode' = 'event' AND COALESCE((m->'event'->>'upcoming')::boolean, false)
                THEN 21 - COALESCE((m->'event'->>'days_left')::int, 0) ELSE v_n - 1 END;

  WITH cur AS MATERIALIZED (
    SELECT a.ci AS g, round(sum(a.amount), 2) AS revenue, sum(a.qty) AS tickets,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci
  ), prv AS MATERIALIZED (
    SELECT a.pi AS g, round(sum(a.amount), 2) AS revenue, sum(a.qty) AS tickets,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid
      FROM _atk a WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.pi
  )
  SELECT jsonb_agg(jsonb_build_object(
           'revenue', COALESCE(c.revenue, 0),
           'tickets', COALESCE(c.tickets, 0),
           'prev_revenue', COALESCE(p.revenue, 0),
           'prev_tickets', COALESCE(p.tickets, 0),
           'paid_tickets', COALESCE(c.paid, 0),
           'prev_paid_tickets', COALESCE(p.paid, 0)
         ) ORDER BY g.g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g(g)
    LEFT JOIN cur c ON c.g = g.g
    LEFT JOIN prv p ON p.g = g.g;

  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL), 0),
           'paid_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL AND COALESCE(price, 0) > 0), 0),
           'free_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL AND price = 0), 0),
           'prev_paid_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut AND COALESCE(price, 0) > 0), 0),
           'prev_free_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut AND price = 0), 0),
           'buyers', count(DISTINCT email) FILTER (WHERE ok AND ci IS NOT NULL),
           'tables', count(*) FILTER (WHERE ok AND ci IS NOT NULL AND pillar = 'tables'),
           'prev_tables', count(*) FILTER (WHERE ok AND pi <= v_cut AND pillar = 'tables'),
           'table_money', jsonb_build_object(
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL AND pillar = 'tables'), 2), 0),
               'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut AND pillar = 'tables'), 2), 0)),
           'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut), 2), 0),
           'prev_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut), 0),
           'has_prev', bool_or(pi IS NOT NULL),
           'prev_same_day', v_cut < v_n - 1,
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

  -- Ce qui a fait vendre : la part venue d'un message Yuno. En euros quand il
  -- y en a ; sinon (guest list, portée sans l'argent) en ventes.
  SELECT jsonb_build_object(
           'share', CASE WHEN sum(amount) > 0 THEN round(100 * COALESCE(sum(amount) FILTER (WHERE src IN ('em', 'sm')), 0) / sum(amount), 1)
                         WHEN sum(qty) > 0 THEN round(100 * COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm')), 0) / sum(qty), 1) END,
           'basis', CASE WHEN sum(amount) > 0 THEN 'amount' ELSE 'count' END,
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE src IN ('em', 'sm')), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm')), 0),
           'by', jsonb_build_object(
             'em', COALESCE(sum(qty) FILTER (WHERE src = 'em'), 0),
             'sm', COALESCE(sum(qty) FILTER (WHERE src = 'sm'), 0),
             'dm', COALESCE(sum(qty) FILTER (WHERE src = 'dm'), 0)))
    INTO v_msg FROM _atk WHERE ok AND ci IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal, 'price', d.price, 'tickets', d.tickets, 'revenue', d.revenue,
                                               'units', d.units, 'pillar', d.pillar)
                            ORDER BY (d.pillar = 'tables'), d.tickets DESC, d.revenue DESC), '[]'::jsonb)
    INTO v_tariffs FROM (
      SELECT COALESCE(a.deal, '—') AS deal, a.pillar, round(avg(a.price), 2) AS price, sum(a.qty) AS tickets,
             round(sum(a.amount), 2) AS revenue, count(*) AS units
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1, 2 ORDER BY (a.pillar = 'tables'), 4 DESC, 5 DESC LIMIT 8) d;

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
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(s.sold, 0)::int) AS cap,
           (e.upcoming OR EXISTS (SELECT 1 FROM _atk_all x WHERE x.event_id = e.id AND NOT x.refunded)) AS counted
      FROM _aev e
      LEFT JOIN (SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok GROUP BY 1) s ON s.event_id = e.id
  ), cur AS (
    SELECT * FROM capx WHERE cap > 0 AND counted AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'event'->>'id')::uuid
                                              ELSE night BETWEEN v_cur_from AND v_today END
  ), prv AS (
    SELECT * FROM capx WHERE cap > 0 AND counted AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'prev_event'->>'id')::uuid
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

  -- Objectif et courbe (billets) : seulement pour « Tout » et « Billets ».
  IF v_pillar IN ('all', 'tickets') THEN
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
  END IF;

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
  ), hc AS MATERIALIZED (
    SELECT h.r, h.c, count(*) AS n, round(sum(h.amount), 2) AS amount FROM h WHERE h.c IS NOT NULL GROUP BY h.r, h.c
  )
  SELECT jsonb_build_object(
           'cells', (SELECT jsonb_agg((SELECT jsonb_agg(jsonb_build_object(
                         'n', COALESCE(x.n, 0),
                         'amount', COALESCE(x.amount, 0)) ORDER BY cc)
                       FROM generate_series(0, 7) cc LEFT JOIN hc x ON x.r = rr AND x.c = cc) ORDER BY rr)
                     FROM generate_series(0, 6) rr),
           'outside', (SELECT count(*) FROM h WHERE h.c IS NULL),
           'days30', v_heat_from IS NOT NULL)
    INTO v_heat;

  -- Soirées qui ont vendu dans la fenêtre (les 7 premières, puis le reste),
  -- avec leur porte et leur bilan (toute la soirée, tous piliers).
  WITH per AS (
    SELECT a.event_id, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid,
           sum(a.qty) FILTER (WHERE a.price = 0) AS free,
           count(*) FILTER (WHERE a.pillar = 'tables') AS tables
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL AND a.event_id IS NOT NULL GROUP BY 1
  ), tot AS (
    SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), ttot AS (
    SELECT event_id, count(*) AS sold FROM _atk_all WHERE ok AND pillar = 'tables' AND event_id IS NOT NULL GROUP BY 1
  ), nrev AS (
    SELECT event_id, round(sum(amount), 2) AS revenue FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), djf AS (
    SELECT s.event_id, round(sum(s.fee), 2) AS fees
      FROM public.dj_sets s
     WHERE s.event_id IN (SELECT id FROM _aev) AND COALESCE(s.fee, 0) > 0
       AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id))
     GROUP BY 1
  ), rows AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming, p.tickets, p.revenue, COALESCE(t.sold, 0) AS sold,
           COALESCE(p.paid, 0) AS paid, COALESCE(p.free, 0) AS free, COALESCE(p.tables, 0) AS tables,
           COALESCE(nr.revenue, 0) AS night_revenue, COALESCE(dj.fees, 0) AS dj_fees, COALESCE(tt.sold, 0) AS tables_sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(t.sold, 0)::int) AS cap,
           (SELECT COALESCE(t2.sold, 0) FROM _aev e2 LEFT JOIN tot t2 ON t2.event_id = e2.id
             WHERE e2.start_at < e.start_at AND e2.id <> e.id AND NOT e2.upcoming
             ORDER BY (e2.series = e.series) DESC, e2.start_at DESC LIMIT 1) AS prev_sold,
           row_number() OVER (ORDER BY p.revenue DESC, p.tickets DESC) AS rk
      FROM per p JOIN _aev e ON e.id = p.event_id LEFT JOIN tot t ON t.event_id = e.id
      LEFT JOIN nrev nr ON nr.event_id = e.id LEFT JOIN djf dj ON dj.event_id = e.id LEFT JOIN ttot tt ON tt.event_id = e.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'start_at', start_at, 'night', night, 'upcoming', upcoming,
           'state', CASE WHEN night = v_today THEN 'tonight' WHEN upcoming THEN 'presale' ELSE 'past' END,
           'tickets', tickets, 'paid', paid, 'free', free, 'tables', tables, 'revenue', revenue, 'sold', sold, 'cap', cap, 'prev_sold', prev_sold,
           -- Pilier Tables VIP : le remplissage se lit en tables, pas en places.
           'tables_fill', CASE WHEN v_pillar = 'tables' THEN jsonb_build_object('sold', tables_sold, 'cap', public._tix_event_tables_total(id)) END,
           -- La porte d'une soirée passée : entrées et attendus, en personnes.
           'door', CASE WHEN NOT upcoming THEN (
               SELECT jsonb_build_object('entered', (h->>'entered')::int, 'expected', (h->>'expected')::int,
                                         'measured', public._crm_door_measured((h->>'expected')::bigint, (h->>'entered')::bigint))
                 FROM (SELECT public._door_headcount(ARRAY[id], NULL) AS h) z) END,
           -- Le bilan de toute la soirée : CA − cachets DJ (la seule dépense connue).
           'balance', jsonb_build_object('revenue', night_revenue,
                                       'fees', jsonb_build_object('amount', dj_fees),
                                       'rest', jsonb_build_object('amount', night_revenue - dj_fees))
         ) ORDER BY start_at DESC) FILTER (WHERE rk <= 7), '[]'::jsonb),
         CASE WHEN count(*) > 7 THEN jsonb_build_object('count', count(*) FILTER (WHERE rk > 7),
                'tickets', sum(tickets) FILTER (WHERE rk > 7), 'revenue', sum(revenue) FILTER (WHERE rk > 7)) END
    INTO v_events, v_other
    FROM rows;

  -- ── « Ce que vous touchez » (Tout) ────────────────────────────────────
  -- Ventes de la fenêtre (billets et tables), remboursées comprises.
  -- Volume brut − remboursements = le CA du héros ; − Stripe = le net.
  IF v_pillar = 'all' THEN
    WITH ev AS MATERIALIZED (
      SELECT s.id, s.money FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) s
    ), s AS (
      SELECT a.event_id, a.pillar, a.refunded, x.gross, x.charged, x.on_site,
             CASE WHEN a.refunded THEN x.gross ELSE LEAST(GREATEST(x.refund_amount, 0), x.gross) END AS refund
        FROM _atk a
        JOIN ev ON ev.id = a.event_id AND ev.money
        LEFT JOIN public.tickets t ON a.pillar = 'tickets' AND t.id = a.id
        LEFT JOIN public.table_reservations tr ON a.pillar = 'tables' AND tr.id = a.id
        CROSS JOIN LATERAL (SELECT
          CASE a.pillar
            WHEN 'tickets' THEN GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
            ELSE GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.service_fee, 0)
                          - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END, 0) END AS gross,
          CASE a.pillar WHEN 'tickets' THEN COALESCE(t.refund_amount, 0) ELSE COALESCE(tr.refund_amount, 0) END AS refund_amount,
          -- Ce qui passe par Stripe : le billet ; d'une table, l'acompte payé en ligne.
          CASE a.pillar
            WHEN 'tickets' THEN COALESCE(t.total_price, 0)
            ELSE CASE WHEN COALESCE(tr.payment_mode, 'online') = 'online'
                      THEN COALESCE(tr.deposit, tr.total_price, 0) + COALESCE(tr.service_fee, 0) ELSE 0 END END AS charged,
          -- Le reste d'une table, réglé au club le soir même.
          CASE WHEN a.pillar = 'tables' AND NOT a.refunded
               THEN CASE WHEN COALESCE(tr.payment_mode, 'online') = 'online'
                         THEN GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.deposit, tr.total_price, 0), 0)
                         ELSE COALESCE(tr.total_price, 0) END
               ELSE 0 END AS on_site) x
       WHERE a.ci IS NOT NULL AND a.pillar IN ('tickets', 'tables') AND (a.ok OR a.refunded)
    ), pc AS MATERIALIZED (
      -- La part se lit une fois par soirée et par pilier, pas vente par vente.
      SELECT k.event_id, k.pillar, public._tix_party_pct(k.event_id, k.pillar, v_side) AS pct,
             EXISTS (SELECT 1 FROM public.events e
                      WHERE e.id = k.event_id AND COALESCE(e.venue_id, e.partner_venue_id) IS NOT NULL
                        AND COALESCE(e.organizer_user_id, e.partner_organizer_id) IS NOT NULL) AS shared
        FROM (SELECT DISTINCT event_id, pillar FROM s) k
    ), sx AS (
      SELECT s.*, CASE WHEN s.charged > 0 THEN round(s.charged * 0.015 + 0.25, 2) ELSE 0 END AS stripe,
             pc.pct, pc.shared
        FROM s JOIN pc ON pc.event_id = s.event_id AND pc.pillar = s.pillar
    )
    SELECT jsonb_build_object(
             'gross', jsonb_build_object('amount', COALESCE(round(sum(gross), 2), 0), 'n', count(*)),
             'refunds', jsonb_build_object('amount', COALESCE(round(sum(refund), 2), 0), 'n', count(*) FILTER (WHERE refund > 0)),
             'stripe', jsonb_build_object('amount', COALESCE(round(sum(stripe), 2), 0), 'n', count(*) FILTER (WHERE stripe > 0)),
             'net', jsonb_build_object('amount', COALESCE(round(sum(gross - refund - stripe), 2), 0)),
             'on_site', jsonb_build_object('amount', COALESCE(round(sum(on_site), 2), 0)),
             'share', CASE WHEN bool_or(shared OR pct IS NULL) THEN jsonb_build_object(
                 'amount', COALESCE(round(sum((gross - refund - stripe) * pct / 100) FILTER (WHERE pct IS NOT NULL), 2), 0),
                 'nights', count(DISTINCT event_id) FILTER (WHERE shared AND pct IS NOT NULL),
                 'unknown', count(DISTINCT event_id) FILTER (WHERE pct IS NULL)) END)
      INTO v_payout FROM sx;
  END IF;

  -- ── Tables VIP ────────────────────────────────────────────────────────
  IF v_pillar = 'tables' THEN
    WITH s AS (
      SELECT a.ci, a.pi, a.event_id, tr.total_price, tr.deposit, tr.minimum_spend, tr.guest_count,
             COALESCE(tr.payment_mode, 'online') AS mode
        FROM _atk a JOIN public.table_reservations tr ON tr.id = a.id
       WHERE a.ok
    ), capx AS (
      SELECT e.id, e.night, public._tix_event_tables_total(e.id) AS cap,
             (SELECT count(*) FROM _atk_all x WHERE x.event_id = e.id AND x.ok AND x.pillar = 'tables') AS sold,
             (e.upcoming OR EXISTS (SELECT 1 FROM _atk_all x WHERE x.event_id = e.id AND NOT x.refunded)) AS counted
        FROM _aev e
       WHERE CASE WHEN m->>'mode' = 'event' THEN e.id IN ((m->'event'->>'id')::uuid, (m->'prev_event'->>'id')::uuid)
                  ELSE e.night BETWEEN v_prev_from AND v_today END
    ), cur AS (
      SELECT * FROM capx WHERE cap > 0 AND counted AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'event'->>'id')::uuid
                                                ELSE night BETWEEN v_cur_from AND v_today END
    ), prv AS (
      SELECT * FROM capx WHERE cap > 0 AND counted AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'prev_event'->>'id')::uuid
                                                ELSE night BETWEEN v_prev_from AND v_prev_to END
    )
    SELECT jsonb_build_object(
             'n', count(*) FILTER (WHERE ci IS NOT NULL),
             'prev_n', count(*) FILTER (WHERE pi <= v_cut),
             'guests', round(avg(GREATEST(COALESCE(guest_count, 1), 1)) FILTER (WHERE ci IS NOT NULL), 1),
             'min_spend', jsonb_build_object('amount', round(avg(NULLIF(minimum_spend, 0)) FILTER (WHERE ci IS NOT NULL), 2)),
             'engaged', jsonb_build_object('amount', COALESCE(round(sum(total_price) FILTER (WHERE ci IS NOT NULL), 2), 0)),
             'deposits', jsonb_build_object('amount', COALESCE(round(sum(COALESCE(deposit, total_price)) FILTER (WHERE ci IS NOT NULL AND mode = 'online'), 2), 0)),
             'online_n', count(*) FILTER (WHERE ci IS NOT NULL AND mode = 'online'),
             'on_site_n', count(*) FILTER (WHERE ci IS NOT NULL AND mode <> 'online'),
             'fill', (SELECT jsonb_build_object('sold', sum(sold), 'cap', sum(cap), 'nights', count(*)) FROM cur),
             'prev_fill', (SELECT jsonb_build_object('sold', sum(sold), 'cap', sum(cap)) FROM prv))
      INTO v_tables FROM s;
  END IF;

  -- ── Guest list : venus sur une porte mesurée ──────────────────────────
  IF v_pillar = 'guestlist' THEN
    WITH ev AS (
      SELECT a.event_id, count(*) AS signups, count(*) FILTER (WHERE a.scanned_at IS NOT NULL) AS came
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1
    ), evx AS (
      SELECT ev.*, e.upcoming,
             CASE WHEN NOT e.upcoming THEN (SELECT public._crm_door_measured((h->>'expected')::bigint, (h->>'entered')::bigint)
                                              FROM (SELECT public._door_headcount(ARRAY[ev.event_id], NULL) AS h) z) END AS measured
        FROM ev JOIN _aev e ON e.id = ev.event_id
    )
    SELECT jsonb_build_object(
             'nights', count(*),
             'nights_measured', count(*) FILTER (WHERE measured),
             'signups_measured', COALESCE(sum(signups) FILTER (WHERE measured), 0),
             'came', COALESCE(sum(came) FILTER (WHERE measured), 0),
             'per_night', CASE WHEN count(*) > 0 THEN round(sum(signups)::numeric / count(*), 1) END)
      INTO v_gl FROM evx;
  END IF;

  -- ── Remboursements, à la date du remboursement ────────────────────────
  IF v_pillar = 'refunds' THEN
    DROP TABLE IF EXISTS _arf;
    CREATE TEMP TABLE _arf ON COMMIT DROP AS
    SELECT r.*, public._tix_bucket(r.refunded_at, r.event_id, m, false) AS ci,
                public._tix_bucket(r.refunded_at, r.event_id, m, true) AS pi
      FROM public._tix_refund_rows(p_venue_id, p_organizer_user_id) r;
    -- Un segment : `_cp` n'existe que dans ce cas (_tix_ana_setup).
    IF (m->>'seg') <> 'all' THEN
      DELETE FROM _arf r WHERE NOT EXISTS (SELECT 1 FROM _cp p WHERE p.email = r.email AND p.lifecycle = m->>'seg');
    END IF;

    WITH cur AS (SELECT ci AS g, sum(amount) AS a, count(*) AS n FROM _arf WHERE ci IS NOT NULL GROUP BY 1),
         prv AS (SELECT pi AS g, sum(amount) AS a, count(*) AS n FROM _arf WHERE pi IS NOT NULL GROUP BY 1)
    SELECT jsonb_build_object(
      'series', (SELECT jsonb_agg(jsonb_build_object(
                    'revenue', COALESCE(round(c.a, 2), 0), 'tickets', COALESCE(c.n, 0),
                    'prev_revenue', COALESCE(round(p.a, 2), 0), 'prev_tickets', COALESCE(p.n, 0)) ORDER BY g.g)
                   FROM generate_series(0, v_n - 1) g(g) LEFT JOIN cur c ON c.g = g.g LEFT JOIN prv p ON p.g = g.g),
      'totals', (SELECT jsonb_build_object(
                    'revenue', COALESCE(round(sum(amount) FILTER (WHERE ci IS NOT NULL), 2), 0),
                    'n', count(*) FILTER (WHERE ci IS NOT NULL),
                    'full', count(*) FILTER (WHERE ci IS NOT NULL AND full_refund),
                    'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE pi <= v_cut), 2), 0),
                    'prev_n', count(*) FILTER (WHERE pi <= v_cut),
                    'tickets_n', count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'tickets'),
                    'tables_n', count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'tables'),
                    'has_prev', bool_or(pi IS NOT NULL))
                   FROM _arf),
      'reasons', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', x.reason, 'n', x.n, 'revenue', x.a) ORDER BY x.n DESC, x.a DESC), '[]'::jsonb)
                    FROM (SELECT reason, count(*) AS n, round(sum(amount), 2) AS a FROM _arf WHERE ci IS NOT NULL
                           GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 6) x),
      'events', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', e.id, 'title', e.title, 'start_at', e.start_at, 'upcoming', e.upcoming,
                    'state', CASE WHEN e.night = v_today THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
                    'n', x.n, 'revenue', x.a,
                    'sales', (SELECT count(*) FROM _atk_all s WHERE s.event_id = e.id AND s.pillar IN ('tickets', 'tables') AND (s.ok OR s.refunded)))
                    ORDER BY x.n DESC, x.a DESC), '[]'::jsonb)
                   FROM (SELECT event_id, count(*) AS n, round(sum(amount), 2) AS a FROM _arf WHERE ci IS NOT NULL
                          GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 8) x JOIN _aev e ON e.id = x.event_id))
      INTO v_refunds;
  END IF;

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
    'payout', v_payout,
    'tables_block', v_tables,
    'gl_block', v_gl,
    'refunds_block', v_refunds,
    'sends', public._tix_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_visits__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_compare uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh int;
  v_now timestamptz := now();
  v_today date;
  v_mode text; v_n int;
  v_start timestamptz; v_d0 date; v_m0 date;
  v_from timestamptz; v_to timestamptz; v_pfrom timestamptz;
  v_ids uuid[];
  v_ev record; v_cev record;
  v_ev_id uuid; v_ev_title text; v_ev_start timestamptz; v_ev_end timestamptz;
  v_cev_id uuid; v_cev_title text; v_cev_start timestamptz;
  v_ev_night date; v_cev_night date;
  v_left int := 0; v_D int := 21;
  v_lat double precision; v_lon double precision;
  m jsonb; v_labels jsonb; r jsonb; v_keep jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) s;
  v_eh := COALESCE(v_eh, 6);
  v_today := public._crm_night_date(v_now, v_tz, v_eh);
  SELECT COALESCE(array_agg(e.id), '{}') INTO v_ids FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e;

  IF p_event IS NOT NULL THEN
    -- ── Une soirée : depuis sa publication, contre la soirée comparée ──────
    SELECT e.id, e.title, e.start_at, e.end_at, e.tz, COALESCE(public._crm_night_series(e.title), e.title) AS series
      INTO v_ev FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = p_event;
    IF v_ev.id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;
    v_ev_night := public._crm_night_date(v_ev.start_at, v_ev.tz, v_eh);
    v_ev_id := v_ev.id; v_ev_title := v_ev.title; v_ev_start := v_ev.start_at; v_ev_end := v_ev.end_at;
    IF p_compare IS NOT NULL AND p_compare <> p_event THEN
      SELECT e.id, e.title, e.start_at INTO v_cev_id, v_cev_title, v_cev_start
        FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = p_compare;
    END IF;
    IF v_cev_id IS NULL THEN
      SELECT e.id, e.title, e.start_at INTO v_cev_id, v_cev_title, v_cev_start
        FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
       WHERE e.start_at < v_ev.start_at AND e.id <> v_ev.id AND public._tix_event_has_sales(e.id)
       ORDER BY (COALESCE(public._crm_night_series(e.title), e.title) = v_ev.series) DESC, e.start_at DESC LIMIT 1;
    END IF;
    IF v_cev_id IS NOT NULL THEN
      v_cev_night := public._crm_night_date(v_cev_start, (SELECT e.tz FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e WHERE e.id = v_cev_id), v_eh);
    END IF;
    v_left := CASE WHEN v_ev_end > v_now THEN GREATEST(0, v_ev_night - v_today) ELSE 0 END;
    -- La courbe commence à la plus ancienne visite des deux soirées (60 jours au plus, 7 au moins).
    SELECT LEAST(60, GREATEST(7, COALESCE(max(x.d), 0))) INTO v_D FROM (
      SELECT v_ev_night - public._crm_night_date(s.visited_at, v_tz, v_eh) AS d FROM public.visitor_sessions s WHERE s.event_id = v_ev_id
      UNION ALL
      SELECT v_cev_night - public._crm_night_date(s.visited_at, v_tz, v_eh) FROM public.visitor_sessions s WHERE v_cev_id IS NOT NULL AND s.event_id = v_cev_id
    ) x;
    v_mode := 'event'; v_n := v_D + 1;
    SELECT jsonb_agg(to_jsonb(v_ev_night - (v_D - g)) ORDER BY g) INTO v_labels FROM generate_series(0, v_D) g;
    SELECT s.latitude, s.longitude INTO v_lat, v_lon
      FROM public.events e JOIN public.venues s ON s.id = COALESCE(e.venue_id, e.partner_venue_id) WHERE e.id = v_ev_id;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_to := date_trunc('hour', v_now) + interval '1 hour';
    v_from := v_to - make_interval(hours => v_n);
    v_pfrom := v_from - make_interval(hours => v_n);
    v_start := v_from;
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
    v_from := (v_m0::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_to := ((v_today + 1)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_pfrom := ((v_m0 - interval '12 months')::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
    v_from := (v_d0::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_to := ((v_today + 1)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
    v_pfrom := ((v_d0 - v_n)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz;
  END IF;

  IF v_mode <> 'event' THEN
    SELECT jsonb_agg(CASE v_mode
             WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
             WHEN 'day' THEN to_jsonb(v_d0 + g)
             ELSE to_jsonb((v_m0 + make_interval(months => g))::date) END ORDER BY g)
      INTO v_labels FROM generate_series(0, v_n - 1) g;
  END IF;

  m := jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', 'all', 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'money', public._tix_money(p_venue_id, p_organizer_user_id),
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - v_D) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night,
        'upcoming', v_ev_end > v_now, 'days_left', v_left) END,
    'prev_event', CASE WHEN v_cev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_cev_id, 'title', v_cev_title, 'start_at', v_cev_start, 'night', v_cev_night) END);

  WITH
  -- ── Les visites lues : la période et celle d'avant, ou la soirée et la soirée comparée ──
  raw AS MATERIALIZED (
    SELECT s.session_id, s.visited_at, s.event_id, s.user_id,
           COALESCE(s.visitor_id, s.session_id) AS visitor,
           (s.event_id IS NULL) AS page,
           COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS cat,
           public._tix_ref_domain(s.referrer_domain) AS domain,
           NULLIF(lower(btrim(s.utm_source)), '') AS us, NULLIF(lower(btrim(s.utm_medium)), '') AS um,
           NULLIF(btrim(s.utm_campaign), '') AS uc, s.landing_page_full AS landing,
           CASE WHEN s.duration_seconds > 0 THEN LEAST(s.duration_seconds, 7200) END AS dur,
           CASE WHEN s.duration_seconds > 0 THEN LEAST(GREATEST(COALESCE(s.scroll_depth_max, 0), 0), 100) END AS scroll,
           CASE WHEN s.duration_seconds > 0 THEN LEAST(GREATEST(COALESCE(s.pages_viewed, 1), 1), 50) END AS pages,
           COALESCE(s.completed_order, false) AS done,
           COALESCE(s.is_returning, false) AS ret,
           COALESCE(NULLIF(s.device_type, ''), 'unknown') AS device,
           CASE WHEN s.user_agent ~* 'instagram' THEN 'instagram'
                WHEN s.user_agent ~* 'FBAN|FBAV|FB_IAB' THEN 'facebook'
                WHEN s.user_agent ~* 'musical_ly|BytedanceWebview|TikTok' THEN 'tiktok' END AS inapp,
           NULLIF(lower(left(btrim(s.language), 2)), '') AS lang,
           NULLIF(btrim(s.city), '') AS city, NULLIF(upper(btrim(s.country_code)), '') AS cc,
           s.latitude AS lat, s.longitude AS lon,
           CASE WHEN v_mode = 'event' THEN s.event_id = v_ev_id ELSE s.visited_at >= v_from END AS cur,
           CASE WHEN v_mode = 'event'
                THEN s.event_id = v_cev_id
                     AND (v_left = 0 OR v_cev_night - public._crm_night_date(s.visited_at, v_tz, v_eh) >= v_left)
                ELSE s.visited_at < v_from END AS prev,
           CASE WHEN v_mode = 'event' THEN
             (CASE WHEN s.event_id = v_ev_id THEN v_ev_night ELSE v_cev_night END) - public._crm_night_date(s.visited_at, v_tz, v_eh) END AS d
      FROM public.visitor_sessions s
     WHERE CASE WHEN v_mode = 'event'
                THEN s.event_id = v_ev_id OR (v_cev_id IS NOT NULL AND s.event_id = v_cev_id)
                ELSE s.visited_at >= v_pfrom AND s.visited_at < v_to
                     AND (s.event_id = ANY (v_ids)
                       OR (s.event_id IS NULL AND p_venue_id IS NOT NULL AND s.venue_id = p_venue_id AND s.entry_page_type = 'venue_page')
                       OR (s.event_id IS NULL AND p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id
                           AND s.entry_page_type = 'organizer_profile')) END
  ),
  -- Les liens suivis des soirées lues et de la page : une ligne par (soirée, utm_source, utm_medium).
  lmap AS MATERIALIZED (
    SELECT DISTINCT ON (t.event_id, lower(btrim(t.utm_source)), COALESCE(NULLIF(lower(btrim(t.utm_medium)), ''), ''))
           t.id, t.event_id, lower(btrim(t.utm_source)) AS net_k, COALESCE(NULLIF(lower(btrim(t.utm_medium)), ''), '') AS med_k,
           COALESCE(NULLIF(btrim(t.partner_name), ''), CASE WHEN t.utm_medium = 'party_link' THEN NULL ELSE NULLIF(btrim(t.label), '') END) AS label,
           NULLIF(lower(btrim(t.utm_source)), '') AS net, NULLIF(lower(btrim(t.utm_medium)), '') AS med
      FROM public.tracked_links t
     WHERE NULLIF(btrim(t.utm_source), '') IS NOT NULL
       AND (t.event_id IN (SELECT DISTINCT event_id FROM raw WHERE event_id IS NOT NULL)
         OR (t.event_id IS NULL AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))))
     ORDER BY t.event_id, lower(btrim(t.utm_source)), COALESCE(NULLIF(lower(btrim(t.utm_medium)), ''), ''),
              t.archived_at IS NULL DESC, t.created_at DESC
  ),
  -- Le lien suivi d'où vient la visite : même soirée (ou la page), même utm_source / utm_medium.
  v AS MATERIALIZED (
    SELECT r0.*, tl.id AS link_id, tl.label AS link_label, tl.net AS link_net, tl.med AS link_med,
           public._tix_visit_family(r0.cat, tl.net, tl.med, tl.id IS NOT NULL, r0.us, r0.um, r0.landing) AS fam,
           CASE WHEN r0.cur AND v_mode <> 'event' THEN CASE v_mode
             WHEN 'hour' THEN floor(extract(epoch FROM r0.visited_at - v_start) / 3600)::int
             WHEN 'day' THEN public._crm_night_date(r0.visited_at, v_tz, v_eh) - v_d0
             ELSE ((extract(year FROM public._crm_night_date(r0.visited_at, v_tz, v_eh)) - extract(year FROM v_m0)) * 12
                   + extract(month FROM public._crm_night_date(r0.visited_at, v_tz, v_eh)) - extract(month FROM v_m0))::int END END AS ci
      FROM raw r0
      LEFT JOIN lmap tl ON r0.us IS NOT NULL AND tl.net_k = r0.us AND tl.med_k = COALESCE(r0.um, '')
                       AND tl.event_id IS NOT DISTINCT FROM r0.event_id
  ),
  c AS MATERIALIZED (SELECT * FROM v WHERE cur),
  p AS MATERIALIZED (SELECT * FROM v WHERE prev),
  -- Première visite d'une personne sur vos pages (soirées de la portée, page du club), 25 mois.
  firsts AS MATERIALIZED (
    SELECT COALESCE(s.visitor_id, s.session_id) AS visitor, min(s.visited_at) AS first_at
      FROM public.visitor_sessions s
     WHERE COALESCE(s.visitor_id, s.session_id) IN (SELECT visitor FROM v)
       AND s.visited_at > v_now - interval '25 months'
       AND (s.event_id = ANY (v_ids)
         OR (s.event_id IS NULL AND p_venue_id IS NOT NULL AND s.venue_id = p_venue_id AND s.entry_page_type = 'venue_page')
         OR (s.event_id IS NULL AND p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id
             AND s.entry_page_type = 'organizer_profile'))
     GROUP BY 1
  ),
  tot AS (
    SELECT (SELECT count(*) FROM c) AS visits,
           (SELECT count(DISTINCT visitor) FROM c) AS visitors,
           (SELECT count(DISTINCT c.visitor) FROM c JOIN firsts f ON f.visitor = c.visitor
             WHERE CASE WHEN v_mode = 'event' THEN f.first_at >= (SELECT min(visited_at) FROM c) ELSE f.first_at >= v_from END) AS new_visitors,
           (SELECT count(DISTINCT visitor) FROM c WHERE ret) AS ret_visitors,
           (SELECT count(*) FROM c WHERE ret) AS ret_visits,
           (SELECT count(*) FROM c WHERE dur IS NOT NULL) AS measured,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur))::int FROM c WHERE dur IS NOT NULL) AS median_s,
           (SELECT round(avg(pages), 1) FROM c WHERE pages IS NOT NULL) AS pages,
           (SELECT count(*) FROM c WHERE done) AS orders,
           (SELECT count(*) FROM p) AS prev_visits,
           (SELECT count(DISTINCT visitor) FROM p) AS prev_visitors,
           (SELECT count(DISTINCT p.visitor) FROM p JOIN firsts f ON f.visitor = p.visitor
             WHERE CASE WHEN v_mode = 'event' THEN f.first_at >= (SELECT min(visited_at) FROM p) ELSE f.first_at >= v_pfrom END) AS prev_new,
           (SELECT count(*) FROM p WHERE dur IS NOT NULL) AS prev_measured,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur))::int FROM p WHERE dur IS NOT NULL) AS prev_median_s,
           (SELECT count(*) FROM p WHERE done) AS prev_orders
  ),
  -- ── Sources : la famille, puis le site, le lien ou la campagne ─────────
  kid AS (
    SELECT c.*,
           CASE WHEN c.link_id IS NOT NULL THEN 'l:' || c.link_id::text
                WHEN c.fam IN ('lk', 'ms') AND c.uc IS NOT NULL THEN 'c:' || c.uc
                WHEN c.fam IN ('lk', 'ms') AND c.us IS NOT NULL THEN 'u:' || c.us
                WHEN c.fam IN ('so', 'se', 'ot') AND c.domain IS NOT NULL AND c.domain <> 'yunoapp.eu' THEN 'd:' || c.domain
                WHEN c.fam IN ('so', 'se', 'ot') AND c.us IS NOT NULL THEN 'u:' || c.us END AS kkey,
           COALESCE(c.link_label, c.uc, CASE WHEN c.domain <> 'yunoapp.eu' THEN c.domain END, c.us) AS klabel
      FROM c
  ),
  fam_rows AS (
    SELECT fam, count(*) AS visits, count(DISTINCT visitor) AS visitors,
           count(*) FILTER (WHERE dur IS NOT NULL) AS measured,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) FILTER (WHERE dur IS NOT NULL))::int AS median_s,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY scroll) FILTER (WHERE scroll IS NOT NULL))::int AS median_scroll,
           count(*) FILTER (WHERE dur IS NOT NULL AND dur < 10) AS short,
           count(*) FILTER (WHERE done) AS orders
      FROM c GROUP BY fam
  ),
  kid_rows AS MATERIALIZED (
    SELECT fam, kkey, max(klabel) AS label, max(link_net) AS net, max(link_med) AS med,
           bool_or(link_id IS NOT NULL) AS is_link,
           count(*) AS visits, count(DISTINCT visitor) AS visitors,
           count(*) FILTER (WHERE dur IS NOT NULL) AS measured,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) FILTER (WHERE dur IS NOT NULL))::int AS median_s,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY scroll) FILTER (WHERE scroll IS NOT NULL))::int AS median_scroll,
           count(*) FILTER (WHERE done) AS orders,
           row_number() OVER (PARTITION BY fam ORDER BY count(*) DESC, kkey) AS rk
      FROM kid WHERE kkey IS NOT NULL GROUP BY fam, kkey
  ),
  prev_fam AS (SELECT fam, count(*) AS visits, count(*) FILTER (WHERE done) AS orders FROM p GROUP BY fam),
  -- ── Le tunnel de la page d'une soirée (une session = son étape la plus avancée) ──
  fn AS MATERIALIZED (
    SELECT f.session_id, f.step, f.pillar, f.ref_id, f.reason,
           CASE f.step WHEN 'viewed' THEN 1 WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3
                       WHEN 'details' THEN 4 WHEN 'payment' THEN 4 WHEN 'purchased' THEN 5 END AS rk
      FROM public.event_funnel_events f
     WHERE CASE WHEN v_mode = 'event' THEN f.event_id = v_ev_id
                ELSE f.event_id = ANY (v_ids) AND f.created_at >= v_from AND f.created_at < v_to END
  ),
  fsess AS (
    SELECT session_id, COALESCE(max(rk), 1) AS rk, bool_or(step = 'failed') AS failed,
           bool_or(step = 'shared') AS shared, bool_or(step = 'waitlist') AS waitlist,
           bool_or(step = 'opened' AND ref_id = 'lineup') AS o_lineup, bool_or(step = 'opened' AND ref_id = 'plan') AS o_plan,
           bool_or(step = 'opened' AND ref_id = 'video') AS o_video, bool_or(step = 'soldout_seen') AS soldout_seen
      FROM fn GROUP BY session_id
  ),
  funnel AS (
    SELECT count(*) FILTER (WHERE rk >= 1) AS viewed, count(*) FILTER (WHERE rk >= 2) AS selected,
           count(*) FILTER (WHERE rk >= 3) AS checkout, count(*) FILTER (WHERE rk >= 4) AS details,
           count(*) FILTER (WHERE rk >= 5) AS purchased,
           count(*) FILTER (WHERE failed) AS failed, count(*) FILTER (WHERE failed AND rk < 5) AS failed_open,
           count(*) FILTER (WHERE shared) AS shared, count(*) FILTER (WHERE waitlist) AS waitlist,
           count(*) FILTER (WHERE o_lineup) AS o_lineup, count(*) FILTER (WHERE o_plan) AS o_plan,
           count(*) FILTER (WHERE o_video) AS o_video,
           count(*) FILTER (WHERE soldout_seen AND rk < 5) AS soldout_left
      FROM fsess
  ),
  fail_reasons AS (
    SELECT COALESCE(NULLIF(reason, ''), 'server') AS reason, count(DISTINCT session_id) AS n
      FROM fn WHERE step = 'failed' GROUP BY 1
  ),
  -- Le billet le plus choisi sans être payé (sessions qui n'ont pas acheté).
  unpaid AS (
    SELECT fn.pillar, fn.ref_id, count(DISTINCT fn.session_id) AS n
      FROM fn JOIN fsess s ON s.session_id = fn.session_id AND s.rk < 5
     WHERE fn.step = 'selected' AND fn.pillar IN ('tickets', 'tables') AND fn.ref_id IS NOT NULL
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1
  ),
  -- ── Les soirées de la période ───────────────────────────────────────────
  nights AS (
    SELECT c.event_id, count(*) AS visits, count(DISTINCT c.visitor) AS visitors,
           count(*) FILTER (WHERE c.dur IS NOT NULL) AS measured,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.dur) FILTER (WHERE c.dur IS NOT NULL))::int AS median_s,
           count(*) FILTER (WHERE c.done) AS orders,
           -- Visites arrivées une fois la billetterie « Complet » (null : jamais complète).
           CASE WHEN max(so.sold_out_at) IS NOT NULL THEN count(*) FILTER (WHERE c.visited_at >= so.sold_out_at) END AS after_full
      FROM c LEFT JOIN public.event_sold_out_marks so ON so.event_id = c.event_id
     WHERE c.event_id IS NOT NULL AND v_mode <> 'event' GROUP BY 1 ORDER BY 2 DESC LIMIT 12
  ),
  -- ── La page du club / de l'organisateur (règle de tix_ana_traffic_detail) ──
  -- La soirée ouverte ensuite depuis la page du club : la visite suivante du même
  -- visiteur, sur une page soirée de la portée, dans les 30 minutes.
  pg_next AS (
    SELECT nx.event_id, count(*) AS n
      FROM v p0
      JOIN LATERAL (
        SELECT b.event_id FROM public.visitor_sessions b
         WHERE b.visitor_id = p0.visitor AND b.event_id = ANY (v_ids)
           AND b.visited_at > p0.visited_at AND b.visited_at < p0.visited_at + interval '30 minutes'
         ORDER BY b.visited_at LIMIT 1) nx ON true
     WHERE p0.page AND p0.cur AND v_mode <> 'event'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 6
  ),
  pg AS (
    SELECT v.*, (v.done OR EXISTS (
             SELECT 1 FROM public.visitor_sessions b
              WHERE b.visitor_id = v.visitor AND COALESCE(b.completed_order, false)
                AND b.event_id = ANY (v_ids)
                AND b.visited_at >= v.visited_at AND b.visited_at < v.visited_at + interval '24 hours')) AS ordered
      FROM v WHERE v.page AND v_mode <> 'event'
  ),
  -- ── Les liens suivis : clics, personnes, téléphone, commandes ──────────
  lk AS MATERIALIZED (
    SELECT t.id, t.event_id, t.created_at,
           COALESCE(NULLIF(btrim(t.partner_name), ''), CASE WHEN t.utm_medium = 'party_link' THEN NULL ELSE NULLIF(btrim(t.label), '') END) AS label,
           NULLIF(lower(btrim(t.utm_source)), '') AS net, NULLIF(lower(btrim(t.utm_medium)), '') AS med,
           t.target_kind
      FROM public.tracked_links t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND CASE WHEN v_mode = 'event' THEN t.event_id = v_ev_id
                ELSE t.event_id = ANY (v_ids) OR t.event_id IS NULL END
  ),
  clk AS (
    SELECT k.tracked_link_id AS id, count(*) AS clicks,
           count(DISTINCT COALESCE(k.visitor_id, k.ip_hash, k.id::text)) AS people,
           count(*) FILTER (WHERE k.device_type = 'mobile') AS mobile,
           count(*) FILTER (WHERE k.device_type IS NOT NULL) AS dev_known
      FROM public.tracked_link_clicks k
     WHERE k.tracked_link_id IN (SELECT id FROM lk)
       AND (v_mode = 'event' OR (k.clicked_at >= v_from AND k.clicked_at < v_to))
     GROUP BY 1
  ),
  lsales AS (
    SELECT x.link_id AS id, count(*) AS orders FROM (
      SELECT t.tracked_link_id AS link_id, COALESCE(t.paid_at, t.created_at) AS at
        FROM public.tickets t WHERE t.tracked_link_id IN (SELECT id FROM lk) AND t.status IN ('paid', 'used')
      UNION ALL
      SELECT r.tracked_link_id, COALESCE(r.paid_at, r.created_at)
        FROM public.table_reservations r WHERE r.tracked_link_id IN (SELECT id FROM lk) AND r.status IN ('paid', 'confirmed')
    ) x WHERE v_mode = 'event' OR (x.at >= v_from AND x.at < v_to) GROUP BY 1
  ),
  lvis AS (
    SELECT link_id AS id, count(*) AS visits,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) FILTER (WHERE dur IS NOT NULL))::int AS median_s,
           count(*) FILTER (WHERE dur IS NOT NULL) AS measured
      FROM c WHERE link_id IS NOT NULL GROUP BY 1
  ),
  links AS (
    SELECT lk.*, e.title AS event_title, e.start_at AS event_start,
           COALESCE(k.clicks, 0) AS clicks, COALESCE(k.people, 0) AS people,
           COALESCE(k.mobile, 0) AS mobile, COALESCE(k.dev_known, 0) AS dev_known,
           COALESCE(s.orders, 0) AS orders, COALESCE(vv.visits, 0) AS visits, vv.median_s, COALESCE(vv.measured, 0) AS measured
      FROM lk
      LEFT JOIN public.events e ON e.id = lk.event_id
      LEFT JOIN clk k ON k.id = lk.id
      LEFT JOIN lsales s ON s.id = lk.id
      LEFT JOIN lvis vv ON vv.id = lk.id
     WHERE COALESCE(k.clicks, 0) > 0 OR COALESCE(s.orders, 0) > 0
     ORDER BY COALESCE(k.clicks, 0) DESC, COALESCE(s.orders, 0) DESC LIMIT 12
  ),
  -- ── Le pont vers Ventes : les commandes nées de ces visites, et le CA club
  -- des ventes Yuno de la période (ou de la soirée), le chiffre du héros de
  -- Ventes (règle de fees.ts / _tix_sales, remboursement déduit ; rien pour une
  -- soirée qu'un club ne fait qu'accueillir).
  bridge AS (
    SELECT (SELECT count(*) FROM c WHERE c.done) AS orders,
           COALESCE(sum(CASE WHEN se.money THEN x.gross - LEAST(GREATEST(x.refund, 0), x.gross) ELSE 0 END), 0) AS revenue
      FROM (
        SELECT t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
               GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0) AS gross,
               COALESCE(t.refund_amount, 0) AS refund
          FROM public.tickets t WHERE t.event_id = ANY (v_ids) AND t.status IN ('paid', 'used')
        UNION ALL
        SELECT r.event_id, COALESCE(r.paid_at, r.created_at),
               GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                 - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0),
               COALESCE(r.refund_amount, 0)
          FROM public.table_reservations r WHERE r.event_id = ANY (v_ids) AND r.status IN ('paid', 'confirmed')
      ) x
      JOIN public._tix_scope_events(p_venue_id, p_organizer_user_id) se ON se.id = x.event_id
     WHERE CASE WHEN v_mode = 'event' THEN x.event_id = v_ev_id ELSE x.at >= v_from AND x.at < v_to END
  ),
  -- ── Une soirée : distance au club, artistes, déjà venus ────────────────
  dist AS (
    SELECT count(*) AS known,
           count(*) FILTER (WHERE km < 30) AS near, count(*) FILTER (WHERE km >= 30 AND km < 150) AS mid,
           count(*) FILTER (WHERE km >= 150) AS far
      FROM (SELECT 6371 * 2 * asin(sqrt(power(sin(radians(c.lat - v_lat) / 2), 2)
                     + cos(radians(v_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lon - v_lon) / 2), 2))) AS km
              FROM c WHERE v_mode = 'event' AND v_lat IS NOT NULL AND c.lat IS NOT NULL AND c.lon IS NOT NULL) x
  ),
  artists AS (
    SELECT a.id, a.name, a.photo_url, count(k.id) AS clicks
      FROM public.guest_artist_link_clicks k
      JOIN public.event_guest_artists a ON a.id = k.artist_id
     WHERE CASE WHEN v_mode = 'event' THEN k.event_id = v_ev_id
                ELSE k.event_id = ANY (v_ids) AND k.clicked_at >= v_from AND k.clicked_at < v_to END
     GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 8
  ),
  connected AS (
    SELECT DISTINCT c.user_id, min(c.visited_at) AS at FROM c WHERE c.user_id IS NOT NULL AND v_mode = 'event' GROUP BY 1
  ),
  known_before AS (
    SELECT count(*) AS connected,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.tickets t JOIN public.events e ON e.id = t.event_id
              WHERE t.user_id = cn.user_id AND t.status IN ('paid', 'used') AND e.id = ANY (v_ids)
                AND e.id <> v_ev_id AND e.start_at < cn.at)
             OR EXISTS (
             SELECT 1 FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
              WHERE r.user_id = cn.user_id AND r.status IN ('paid', 'confirmed') AND e.id = ANY (v_ids)
                AND e.id <> v_ev_id AND e.start_at < cn.at)) AS came
      FROM connected cn
  )
  SELECT jsonb_build_object(
    'meta', m,
    'totals', (SELECT to_jsonb(tot) FROM tot),
    'series', CASE WHEN v_mode <> 'event' THEN (
      SELECT jsonb_agg(jsonb_build_object('v', COALESCE(a.v, '{}'::jsonb), 'u', COALESCE(a.u, '{}'::jsonb), 'visitors', COALESCE(b.u, 0)) ORDER BY g)
        FROM generate_series(0, v_n - 1) g
        LEFT JOIN (SELECT ci, jsonb_object_agg(fam, n) AS v, jsonb_object_agg(fam, u) AS u
                     FROM (SELECT ci, fam, count(*) AS n, count(DISTINCT visitor) AS u FROM c WHERE ci IS NOT NULL GROUP BY 1, 2) x
                    GROUP BY ci) a ON a.ci = g
        LEFT JOIN (SELECT ci, count(DISTINCT visitor) AS u FROM c WHERE ci IS NOT NULL GROUP BY 1) b ON b.ci = g) END,
    'curve', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
      'cur', (SELECT jsonb_agg(CASE WHEN v_left > 0 AND (v_D - g) < v_left THEN NULL
                                    ELSE (SELECT count(*) FROM c WHERE c.d >= v_D - g) END ORDER BY g)
                FROM generate_series(0, v_D) g),
      'prev', CASE WHEN v_cev_id IS NOT NULL THEN (
                SELECT jsonb_agg((SELECT count(*) FROM v WHERE v.event_id = v_cev_id AND v.d >= v_D - g) ORDER BY g)
                  FROM generate_series(0, v_D) g) END) END,
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'k', f.fam, 'visits', f.visits, 'visitors', f.visitors, 'measured', f.measured,
               'median_s', f.median_s, 'median_scroll', f.median_scroll, 'short', f.short, 'orders', f.orders,
               'prev_visits', COALESCE(pf.visits, 0), 'prev_orders', COALESCE(pf.orders, 0),
               'kids', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'key', k.kkey, 'label', k.label, 'link', k.is_link, 'net', k.net, 'med', k.med,
                          'visits', k.visits, 'visitors', k.visitors, 'measured', k.measured,
                          'median_s', k.median_s, 'median_scroll', k.median_scroll, 'orders', k.orders) ORDER BY k.visits DESC)
                          FROM kid_rows k WHERE k.fam = f.fam AND k.rk <= 8), '[]'::jsonb)) ORDER BY f.visits DESC)
        FROM fam_rows f LEFT JOIN prev_fam pf ON pf.fam = f.fam), '[]'::jsonb),
    'engagement', jsonb_build_object(
      'measured', (SELECT count(*) FROM c WHERE dur IS NOT NULL),
      'dur', (SELECT jsonb_build_array(
                count(*) FILTER (WHERE dur < 10), count(*) FILTER (WHERE dur >= 10 AND dur < 60),
                count(*) FILTER (WHERE dur >= 60 AND dur < 180), count(*) FILTER (WHERE dur >= 180 AND dur < 600),
                count(*) FILTER (WHERE dur >= 600)) FROM c WHERE dur IS NOT NULL),
      'scroll', (SELECT jsonb_build_array(
                count(*), count(*) FILTER (WHERE scroll >= 25), count(*) FILTER (WHERE scroll >= 50),
                count(*) FILTER (WHERE scroll >= 75), count(*) FILTER (WHERE scroll >= 90)) FROM c WHERE dur IS NOT NULL),
      'artist_clicks', (SELECT COALESCE(sum(clicks), 0) FROM artists),
      'shares', (SELECT shared FROM funnel),
      -- Ouvertures mesurées depuis le 27/10 (étape « opened ») : null tant qu'aucune n'est relevée.
      'opened', (SELECT CASE WHEN o_lineup + o_plan + o_video > 0 THEN jsonb_build_object(
                   'lineup', o_lineup, 'plan', o_plan, 'video', o_video, 'measured', o_lineup + o_plan + o_video) END FROM funnel)),
    'funnel', (SELECT jsonb_build_object(
        'viewed', viewed, 'selected', selected, 'checkout', checkout, 'details', details, 'purchased', purchased,
        'failed', failed, 'failed_open', failed_open, 'shared', shared, 'waitlist', waitlist,
        'reasons', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'n', n) ORDER BY n DESC) FROM fail_reasons), '[]'::jsonb),
        'unpaid', (SELECT jsonb_build_object('pillar', u.pillar, 'n', u.n,
                     'name', COALESCE((SELECT tr.name FROM public.ticket_rounds tr WHERE u.pillar = 'tickets' AND tr.id::text = u.ref_id),
                                      (SELECT tp.name FROM public.table_packs tp WHERE u.pillar = 'tables' AND tp.id::text = u.ref_id)))
                     FROM unpaid u))
      FROM funnel),
    'heat', (SELECT jsonb_agg(row_j ORDER BY dd) FROM (
        SELECT dd, jsonb_agg(COALESCE(h.n, 0) ORDER BY hh) AS row_j
          FROM generate_series(0, 6) dd CROSS JOIN generate_series(0, 23) hh
          LEFT JOIN (SELECT (extract(isodow FROM visited_at AT TIME ZONE v_tz)::int - 1) AS d,
                            extract(hour FROM visited_at AT TIME ZONE v_tz)::int AS h, count(*) AS n
                       FROM c GROUP BY 1, 2) h ON h.d = dd AND h.h = hh
         GROUP BY dd) x),
    'devices', (SELECT jsonb_build_object(
        'mobile', count(*) FILTER (WHERE device = 'mobile'), 'desktop', count(*) FILTER (WHERE device = 'desktop'),
        'tablet', count(*) FILTER (WHERE device = 'tablet'), 'unknown', count(*) FILTER (WHERE device NOT IN ('mobile', 'desktop', 'tablet')))
      FROM c),
    'in_app', (SELECT jsonb_build_object(
        'instagram', count(*) FILTER (WHERE inapp = 'instagram'), 'facebook', count(*) FILTER (WHERE inapp = 'facebook'),
        'tiktok', count(*) FILTER (WHERE inapp = 'tiktok'),
        'visits', count(*) FILTER (WHERE inapp IS NOT NULL), 'orders', count(*) FILTER (WHERE inapp IS NOT NULL AND done),
        'other_visits', count(*) FILTER (WHERE inapp IS NULL), 'other_orders', count(*) FILTER (WHERE inapp IS NULL AND done))
      FROM c),
    'langs', jsonb_build_object(
      'known', (SELECT count(*) FROM c WHERE lang IS NOT NULL),
      'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('l', lang, 'n', n) ORDER BY n DESC)
                         FROM (SELECT lang, count(*) AS n FROM c WHERE lang IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 4) x), '[]'::jsonb)),
    'cities', jsonb_build_object(
      'known', (SELECT count(*) FROM c WHERE cc IS NOT NULL),
      'france', (SELECT count(*) FROM c WHERE cc = 'FR'),
      'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC)
                         FROM (SELECT city, count(*) AS n FROM c WHERE cc = 'FR' AND city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x), '[]'::jsonb),
      'abroad', COALESCE((SELECT jsonb_agg(jsonb_build_object('cc', cc, 'n', n) ORDER BY n DESC)
                            FROM (SELECT cc, count(*) AS n FROM c WHERE cc IS NOT NULL AND cc <> 'FR' GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x), '[]'::jsonb)),
    'nights', CASE WHEN v_mode <> 'event' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'start_at', e.start_at, 'upcoming', COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now,
               'state', CASE WHEN COALESCE(e.end_at, e.start_at + interval '6 hours') <= v_now THEN 'past'
                             WHEN public._crm_night_date(e.start_at, v_tz, v_eh) = v_today THEN 'tonight' ELSE 'presale' END,
               'visits', n.visits, 'visitors', n.visitors, 'measured', n.measured, 'median_s', n.median_s, 'orders', n.orders,
               'after_full', n.after_full) ORDER BY n.visits DESC)
        FROM nights n JOIN public.events e ON e.id = n.event_id), '[]'::jsonb) END,
    'page', CASE WHEN v_mode <> 'event' THEN jsonb_build_object(
      'kind', CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
      'visits', (SELECT count(*) FROM pg WHERE cur), 'prev_visits', (SELECT count(*) FROM pg WHERE prev),
      'visitors', (SELECT count(DISTINCT visitor) FROM pg WHERE cur),
      'returning', (SELECT count(*) FROM pg WHERE cur AND ret),
      'ordered', (SELECT count(*) FROM pg WHERE cur AND ordered),
      'series', (SELECT jsonb_agg(COALESCE(b.n, 0) ORDER BY g) FROM generate_series(0, v_n - 1) g
                   LEFT JOIN (SELECT ci, count(*) AS n FROM pg WHERE cur GROUP BY 1) b ON b.ci = g),
      'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', x.cat, 'visits', x.n, 'ordered', x.o) ORDER BY x.n DESC)
                             FROM (SELECT cat, count(*) AS n, count(*) FILTER (WHERE ordered) AS o FROM pg WHERE cur GROUP BY 1) x), '[]'::jsonb),
      'next', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'n', x.n) ORDER BY x.n DESC)
                          FROM pg_next x JOIN public.events e ON e.id = x.event_id), '[]'::jsonb),
      'next_total', (SELECT count(*) FROM v p0 WHERE p0.page AND p0.cur AND p0.visitor IS NOT NULL)) END,
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'label', l.label, 'net', l.net, 'med', l.med, 'target', l.target_kind,
        'event_id', l.event_id, 'event_title', l.event_title, 'event_start', l.event_start, 'created_at', l.created_at,
        'clicks', l.clicks, 'people', l.people, 'mobile', l.mobile, 'dev_known', l.dev_known, 'orders', l.orders,
        'visits', l.visits, 'measured', l.measured, 'median_s', l.median_s)) FROM links l), '[]'::jsonb),
    'hours', CASE WHEN v_mode = 'event' THEN (
      SELECT jsonb_agg(COALESCE(h.n, 0) ORDER BY hh) FROM generate_series(0, 23) hh
        LEFT JOIN (SELECT extract(hour FROM visited_at AT TIME ZONE v_tz)::int AS h, count(*) AS n FROM c GROUP BY 1) h ON h.h = hh) END,
    'distance', CASE WHEN v_mode = 'event' AND v_lat IS NOT NULL THEN (SELECT to_jsonb(dist) FROM dist) END,
    'artists', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'photo', a.photo_url, 'clicks', a.clicks) ORDER BY a.clicks DESC) FROM artists a), '[]'::jsonb),
    'known_before', CASE WHEN v_mode = 'event' THEN (SELECT to_jsonb(known_before) FROM known_before) END,
    'bridge', (SELECT jsonb_build_object('orders', orders, 'revenue', round(revenue, 2)) FROM bridge),
    -- La demande qui reste (une soirée) : visites après « Complet », billets épuisés vus sans achat.
    'demand', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
      'sold_out_at', (SELECT so.sold_out_at FROM public.event_sold_out_marks so WHERE so.event_id = v_ev_id),
      'after_full', (SELECT count(*) FROM c, public.event_sold_out_marks so WHERE so.event_id = v_ev_id AND c.visited_at >= so.sold_out_at),
      'soldout_seen', (SELECT soldout_left FROM funnel)) END,
    -- Repères du graphique : e-mails, SMS et push envoyés (règle de l'onglet Ventes).
    'sends', CASE WHEN v_mode <> 'event' THEN public._tix_ana_sends(p_venue_id, p_organizer_user_id, m) ELSE '[]'::jsonb END
  ) INTO r;

  -- ── À retenir : des constats, chacun avec son seuil (textes ya.tr.tk.*) ──
  IF v_mode <> 'event' AND (r->'totals'->>'visits')::int >= 30 THEN
    WITH s AS (
      SELECT x->>'k' AS k, (x->>'visits')::int AS visits, (x->>'orders')::int AS orders,
             (x->>'measured')::int AS measured, (x->>'short')::int AS short
        FROM jsonb_array_elements(r->'sources') x
    ), t AS (SELECT (r->'totals'->>'visits')::numeric AS visits), top AS (
      SELECT s.* FROM s ORDER BY visits DESC LIMIT 1
    ), best AS (
      SELECT s.* FROM s, top, t
       WHERE s.k <> top.k AND s.visits >= 30 AND s.visits >= 0.05 * t.visits AND top.visits >= 30 AND top.orders > 0
         AND s.orders::numeric / s.visits >= 1.3 * top.orders::numeric / top.visits
       ORDER BY s.orders::numeric / s.visits DESC LIMIT 1
    )
    SELECT jsonb_agg(z) INTO v_keep FROM (
      SELECT jsonb_build_object('k', 'top', 'fam', top.k, 'pct', round(100 * top.visits / t.visits)) AS z
        FROM top, t WHERE top.visits / t.visits >= 0.25
      UNION ALL
      SELECT jsonb_build_object('k', 'best_conv', 'fam', best.k, 'top', top.k,
               'pct', round(100 * best.visits / t.visits),
               'conv', round(100.0 * best.orders / best.visits, 1), 'top_conv', round(100.0 * top.orders / top.visits, 1),
               'ratio', round((best.orders::numeric / best.visits) / (top.orders::numeric / top.visits), 1))
        FROM best, top, t
      UNION ALL
      SELECT jsonb_build_object('k', 'after_full', 'n', (x->>'after_full')::int, 'title', x->>'title')
        FROM (SELECT x FROM jsonb_array_elements(r->'nights') x
               WHERE (x->>'after_full')::int >= 30 ORDER BY (x->>'after_full')::int DESC LIMIT 1) n
      UNION ALL
      SELECT jsonb_build_object('k', 'short', 'pct', round(100.0 * e.short / e.measured),
               'fams', (SELECT jsonb_agg(k ORDER BY sh DESC) FROM (
                          SELECT k, short::numeric / measured AS sh FROM s WHERE measured >= 10 ORDER BY 2 DESC LIMIT 2) q))
        FROM (SELECT sum(short) AS short, sum(measured) AS measured FROM s) e
       WHERE e.measured >= 30 AND e.short::numeric / e.measured >= 0.2
    ) q;
  END IF;

  RETURN r || jsonb_build_object('keep', COALESCE(v_keep, '[]'::jsonb), 'has_any', (r->'totals'->>'visits')::int > 0 OR (r->'totals'->>'prev_visits')::int > 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_is_org boolean := p_organizer_user_id is not null;
  v_tz     text := 'Europe/Paris';
  v_from   timestamptz;
  v_by_end boolean := false;
  v_limit  integer;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if v_is_org then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
  end if;

  -- Périodes en temps (24 h, 48 h, 7 j, 30 j, 90 j) : les soirées TERMINÉES
  -- dont la fin tombe dans la fenêtre ; la période d'avant = le même nombre de
  -- soirées juste avant (règle inchangée : on ne compare qu'à nombre égal).
  v_by_end := p_period in ('d1', 'd2', 'd7', 'd30', 'd90');
  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    when 'd1'    then v_now - interval '24 hours'
    when 'd2'    then v_now - interval '48 hours'
    when 'd7'    then v_now - interval '7 days'
    when 'd30'   then v_now - interval '30 days'
    when 'd90'   then v_now - interval '90 days'
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') as end_ts, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      -- Une soirée sans aucune vente Yuno n'est pas « une dernière soirée ».
      and public._tix_event_has_sales(e.id)
    order by e.start_at desc
    limit 1000
  ),
  cur_n as (
    select count(*)::integer as n from scope s
    where (v_limit is null or s.rn <= v_limit)
      and (v_from is null or (case when v_by_end then s.end_ts else s.start_at end) >= v_from)
  ),
  -- Période courante = les N premières ; précédente = les N suivantes.
  -- « Tout » n'a pas de période précédente.
  nights as materialized (
    select s.*, case when s.rn <= c.n then 'cur' else 'prev' end as bucket
    from scope s cross join cur_n c
    where s.rn <= c.n
       or (p_period <> 'all' and c.n > 0 and s.rn > c.n and s.rn <= 2 * c.n)
  ),

  tk as (
    select t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           count(*) as orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) as amount,
           sum(case when coalesce(t.total_price, 0) > 0 then round(t.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as entered
    from public.tickets t
    join nights n on n.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),
  tb as (
    select r.event_id,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount,
           sum(case when coalesce(r.payment_mode, 'online') <> 'on_site' and coalesce(r.total_price, 0) > 0
                    then round(r.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           count(*) filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as arrived,
           sum(greatest(coalesce(r.guest_count, 0), 1))
             filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as entered
    from public.table_reservations r
    join nights n on n.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),
  dr as (
    select o.event_id,
           count(*) as orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount,
           sum(case when coalesce(o.total, 0) > 0 then round(o.total * 0.015 + 0.25, 2) else 0 end) as stripe
    from public.orders o
    join nights n on n.id = o.event_id
    where not v_is_org
      and o.status in ('paid', 'served')
    group by o.event_id
  ),
  gl as (
    select g.event_id,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id
    where e2.status <> 'cancelled'
    group by g.event_id
  ),
  caps as (
    select n.id as event_id,
           -- Même capacité que get_event_report : un palier illimité rend la
           -- jauge sans capacité (pas un remplissage au-delà de 100 %).
           case when coalesce(n.max_tickets, 0) > 0 then n.max_tickets
                when exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id)
                 and not exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id and coalesce(tr.max_tickets, 0) <= 0)
                  then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = n.id)
                else null end as cap
    from nights n
  ),
  -- Personnes distinctes par soirée et par période (tous piliers).
  people as (
    select n.bucket, n.id as event_id, lower(trim(x.email)) as email
    from nights n
    join lateral (
      select t.user_email as email from public.tickets t where t.event_id = n.id and t.status in ('paid', 'used')
      union all
      select r.user_email from public.table_reservations r where r.event_id = n.id and r.status in ('paid', 'confirmed')
      union all
      select o.user_email from public.orders o where not v_is_org and o.event_id = n.id and o.status in ('paid', 'served')
      union all
      select e2.email from public.guest_list_entries e2 join public.guest_lists g on g.id = e2.guest_list_id
       where g.event_id = n.id and e2.status <> 'cancelled'
    ) x on true
    where nullif(trim(x.email), '') is not null
  ),
  per_night as (
    select n.id, n.title, n.start_at, n.poster, n.bucket, n.rn, n.show_money,
           coalesce(tk.sold, 0) as tickets, coalesce(tk.orders, 0) as ticket_orders,
           coalesce(tb.booked, 0) as tables, coalesce(tb.guests, 0) as table_guests, coalesce(tb.arrived, 0) as tables_arrived,
           coalesce(dr.orders, 0) as bar_orders,
           coalesce(gl.registered, 0) as gl_registered, coalesce(gl.entered, 0) as gl_entered,
           coalesce(tk.entered, 0) + coalesce(tb.entered, 0) + coalesce(gl.entered, 0) as entries,
           coalesce(tk.entered, 0) as ticket_entries,
           case when n.show_money then coalesce(tk.amount, 0) else 0 end as rev_tickets,
           case when n.show_money then coalesce(tb.amount, 0) else 0 end as rev_tables,
           case when n.show_money then coalesce(dr.amount, 0) else 0 end as rev_bar,
           case when n.show_money then coalesce(tk.stripe, 0) + coalesce(tb.stripe, 0) + coalesce(dr.stripe, 0) else 0 end as stripe,
           caps.cap,
           (select count(distinct p.email) from people p where p.event_id = n.id) as customers
    from nights n
    left join tk on tk.event_id = n.id
    left join tb on tb.event_id = n.id
    left join dr on dr.event_id = n.id
    left join gl on gl.event_id = n.id
    left join caps on caps.event_id = n.id
  ),
  totals as (
    select b.bucket,
           count(pn.id) as nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar), 0) as revenue,
           coalesce(sum(pn.rev_tickets), 0) as rev_tickets,
           coalesce(sum(pn.rev_tables), 0) as rev_tables,
           coalesce(sum(pn.rev_bar), 0) as rev_bar,
           coalesce(sum(pn.stripe), 0) as stripe,
           coalesce(sum(pn.entries), 0) as entries,
           coalesce(sum(pn.ticket_entries), 0) as ticket_entries,
           coalesce(sum(pn.tickets), 0) as tickets,
           coalesce(sum(pn.ticket_orders), 0) as ticket_orders,
           coalesce(sum(pn.tables), 0) as tables,
           coalesce(sum(pn.table_guests), 0) as table_guests,
           coalesce(sum(pn.tables_arrived), 0) as tables_arrived,
           coalesce(sum(pn.bar_orders), 0) as bar_orders,
           coalesce(sum(pn.gl_registered), 0) as gl_registered,
           coalesce(sum(pn.gl_entered), 0) as gl_entered,
           coalesce(sum(pn.cap) filter (where pn.cap > 0), 0) as ticket_cap,
           coalesce(sum(pn.tickets) filter (where pn.cap > 0), 0) as tickets_with_cap,
           -- Dénominateurs justes (revue du 25/09) : la dépense par tête ne
           -- compte que les soirées dont on voit l'argent ET où la porte a
           -- scanné ; la présence, que les soirées où la porte a scanné (sans
           -- scan, « pas scanné » ne veut pas dire « pas venu ») ; prix moyens
           -- sur les soirées dont on voit l'argent.
           count(pn.id) filter (where pn.show_money) as money_nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar) filter (where pn.show_money and pn.entries > 0), 0) as spend_revenue,
           coalesce(sum(pn.entries) filter (where pn.show_money and pn.entries > 0), 0) as spend_entries,
           coalesce(sum(pn.entries) filter (where pn.entries > 0), 0) as presence_entries,
           coalesce(sum(pn.tickets + pn.table_guests + pn.gl_registered) filter (where pn.entries > 0), 0) as presence_expected,
           coalesce(sum(pn.gl_registered) filter (where pn.gl_entered > 0), 0) as gl_presence_registered,
           coalesce(sum(pn.gl_entered) filter (where pn.gl_entered > 0), 0) as gl_presence_entered,
           coalesce(sum(pn.tables) filter (where pn.tables_arrived > 0), 0) as tables_presence_booked,
           coalesce(sum(pn.tables_arrived) filter (where pn.tables_arrived > 0), 0) as tables_presence_arrived,
           coalesce(sum(pn.tickets) filter (where pn.show_money), 0) as money_tickets,
           coalesce(sum(pn.tables) filter (where pn.show_money), 0) as money_tables,
           coalesce(sum(pn.bar_orders) filter (where pn.show_money), 0) as money_bar_orders,
           (select count(distinct p.email) from people p where p.bucket = b.bucket) as customers
    from (values ('cur'), ('prev')) b(bucket)
    left join per_night pn on pn.bucket = b.bucket
    group by b.bucket
  ),
  -- Détail des piliers, période courante seulement.
  rounds_list as (
    select tr.name,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           sum(case when n.show_money then
               greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
               else 0 end) as amount
    from public.tickets t
    join nights n on n.id = t.event_id and n.bucket = 'cur'
    join public.ticket_rounds tr on tr.id = t.ticket_round_id
    where t.status in ('paid', 'used')
    group by tr.name
    order by 2 desc
    limit 12
  ),
  packs_list as (
    select coalesce(p.name, '—') as name,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(case when n.show_money then
               greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
               else 0 end) as amount
    from public.table_reservations r
    join nights n on n.id = r.event_id and n.bucket = 'cur'
    left join public.table_packs p on p.id = r.pack_id
    where r.status in ('paid', 'confirmed')
    group by 1
    order by 4 desc, 2 desc
    limit 12
  ),
  -- Montant d'un produit = sa part du CA CLUB de la commande (fees.ts : total
  -- − frais Yuno, remboursement déduit), au prorata du prix carte : la somme
  -- des produits retombe exactement sur le CA du bar, jamais au-dessus.
  order_lines as (
    select o.id as order_id,
           it.value ->> 'name' as name,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1) as qty,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1)
             * greatest(coalesce((it.value ->> 'price')::numeric, 0), 0) as gross,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)) as order_net
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur' and n.show_money
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    where not v_is_org and o.status in ('paid', 'served')
      and nullif(it.value ->> 'name', '') is not null
  ),
  products_list as (
    select l.name,
           sum(l.qty) as qty,
           round(sum(case when t.gross_total > 0 then l.order_net * l.gross / t.gross_total else 0 end), 2) as amount
    from order_lines l
    join (select order_id, sum(gross) as gross_total from order_lines group by 1) t on t.order_id = l.order_id
    group by 1
    order by 2 desc
    limit 10
  ),
  bar_service as (
    select percentile_cont(0.5) within group (
             order by extract(epoch from (o.served_at - coalesce(o.paid_at, o.created_at))) / 60.0
           ) as median_min,
           count(*) as sample
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur'
    where not v_is_org and o.status = 'served' and o.served_at is not null
      and o.served_at > coalesce(o.paid_at, o.created_at)
      and o.served_at < coalesce(o.paid_at, o.created_at) + interval '3 hours'
  ),
  holders_list as (
    select case g.holder_type
             when 'club' then 'club' when 'organizer' then 'organizer' else coalesce(nullif(g.holder_label, ''), g.holder_type)
           end as name,
           g.holder_type as kind,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id and n.bucket = 'cur'
    where e2.status <> 'cancelled'
    group by 1, 2
    order by 3 desc
    limit 12
  ),
  -- Déjà vendu pour les soirées À VENIR (renvoie vers les prochaines soirées).
  upcoming as (
    select count(distinct e.id) as nights,
           coalesce(sum(
             case when (v_is_org and v_money) or (not v_is_org and v_money and e.venue_id = p_venue_id) then x.amount else 0 end
           ), 0) as amount
    from public.events e
    left join lateral (
      select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0),
                                  greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'has_bar', not v_is_org,
    'period', p_period,
    'generated_at', v_now,
    'current', (select to_jsonb(t) - 'bucket' from totals t where t.bucket = 'cur'),
    'previous', case when p_period = 'all' then null
                     -- Une comparaison n'a de sens qu'à nombre de soirées égal.
                     else (select case when t.nights > 0 and t.nights = (select n from cur_n) then to_jsonb(t) - 'bucket' end
                           from totals t where t.bucket = 'prev') end,
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pn.id, 'title', pn.title, 'start_at', pn.start_at, 'poster', pn.poster,
               'revenue', case when pn.show_money then pn.rev_tickets + pn.rev_tables + pn.rev_bar end,
               'rev_tickets', case when pn.show_money then pn.rev_tickets end,
               'rev_tables', case when pn.show_money then pn.rev_tables end,
               'rev_bar', case when pn.show_money then pn.rev_bar end,
               'entries', pn.entries, 'customers', pn.customers,
               'tickets', pn.tickets, 'ticket_cap', pn.cap, 'tables', pn.tables,
               'table_guests', pn.table_guests, 'tables_arrived', pn.tables_arrived,
               'bar_orders', pn.bar_orders,
               'gl_registered', pn.gl_registered, 'gl_entered', pn.gl_entered
             ) order by pn.start_at desc)
      from per_night pn where pn.bucket = 'cur'
    ), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'sold', r.sold,
                         'amount', case when v_money then r.amount end)) from rounds_list r), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'booked', p.booked, 'guests', p.guests,
                        'amount', case when v_money then p.amount end)) from packs_list p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty,
                           'amount', case when v_money then p.amount end)) from products_list p), '[]'::jsonb),
    'bar_service_min', (select case when b.sample >= 5 then round(b.median_min::numeric, 1) end from bar_service b),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('name', h.name, 'kind', h.kind,
                          'registered', h.registered, 'entered', h.entered)) from holders_list h), '[]'::jsonb),
    'upcoming', (select jsonb_build_object('nights', u.nights, 'amount', case when v_money then u.amount end) from upcoming u)
  ) into v_result;

  -- Sans l'argent, aucun montant ne sort, même agrégé.
  if not v_money then
    v_result := jsonb_set(v_result, '{current}',
      (v_result -> 'current') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    if v_result -> 'previous' is not null and jsonb_typeof(v_result -> 'previous') = 'object' then
      v_result := jsonb_set(v_result, '{previous}',
        (v_result -> 'previous') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    end if;
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_free_detail__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh integer;
  v_today date;
  v_n integer := CASE p_period WHEN '24h' THEN 1 WHEN '48h' THEN 2 WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_from date;
  v_out jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r;
  v_today := public._crm_night_date(now(), v_tz, COALESCE(v_eh, 6));
  v_from := v_today - (v_n - 1);

  -- Soirées : celles de la période (commencées) et celles à venir (pour les quotas).
  DROP TABLE IF EXISTS _fev;
  CREATE TEMP TABLE _fev ON COMMIT DROP AS
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.money,
         public._crm_night_date(ev.start_at, ev.tz, COALESCE(v_eh, 6)) AS night,
         ev.start_at <= now() AS started, ev.end_at <= now() AS over
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) ev
   WHERE CASE WHEN p_event IS NOT NULL THEN ev.id = p_event
              ELSE public._crm_night_date(ev.start_at, ev.tz, COALESCE(v_eh, 6)) >= v_from END;

  -- Ventes valides de la portée (billets, tables, guest list) : la porte mesurée
  -- se juge sur toutes les entrées valides de la soirée, comme l'onglet Gratuits.
  DROP TABLE IF EXISTS _fsale;
  CREATE TEMP TABLE _fsale ON COMMIT DROP AS
  SELECT t.id, t.event_id, t.pillar, t.email, t.amount, t.price, t.purchased_at AS at, t.scanned_at,
         public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0 AS paid
    FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
   WHERE t.status = 'valid';
  CREATE INDEX ON _fsale (email);
  CREATE INDEX ON _fsale (event_id);

  DROP TABLE IF EXISTS _fdoor;
  CREATE TEMP TABLE _fdoor ON COMMIT DROP AS
  SELECT e.id,
         e.over AND public._crm_door_measured(count(s.id), count(s.id) FILTER (WHERE s.scanned_at IS NOT NULL)) AS known
    FROM _fev e LEFT JOIN _fsale s ON s.event_id = e.id
   GROUP BY e.id, e.over;

  -- Les listes et leurs inscrits.
  DROP TABLE IF EXISTS _flist;
  CREATE TEMP TABLE _flist ON COMMIT DROP AS
  SELECT gl.id, gl.event_id, gl.quota, COALESCE(gl.manually_sold_out, false) AS closed,
         COALESCE('pr:' || gl.promoter_id::text, 'dj:' || gl.dj_id::text, 'gp:' || gl.guest_pass_id::text,
                  COALESCE(NULLIF(gl.holder_type, ''), 'club') || ':' || COALESCE(NULLIF(btrim(gl.holder_label), ''), '')) AS hkey,
         CASE WHEN gl.promoter_id IS NOT NULL THEN 'promoter' WHEN gl.dj_id IS NOT NULL THEN 'dj'
              WHEN gl.guest_pass_id IS NOT NULL THEN 'guest'
              WHEN gl.holder_type = 'organizer' THEN 'organizer'
              WHEN gl.holder_type IN ('club', 'venue') THEN 'club' ELSE 'custom' END AS htype,
         COALESCE(
           (SELECT NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')
              FROM public.promoters p WHERE p.id = gl.promoter_id),
           (SELECT NULLIF(btrim(d.stage_name), '') FROM public.djs d WHERE d.id = gl.dj_id),
           (SELECT NULLIF(btrim(h.guest_name), '') FROM public.event_guest_passes h WHERE h.id = gl.guest_pass_id),
           NULLIF(btrim(gl.holder_label), '')) AS hlabel
    FROM public.guest_lists gl
    JOIN _fev e ON e.id = gl.event_id
   -- Une liste fermée sans inscrit (aperçu de test, liste jamais ouverte) n'a pas de quota.
   WHERE gl.is_active
      OR EXISTS (SELECT 1 FROM public.guest_list_entries g
                  WHERE g.guest_list_id = gl.id AND g.status NOT IN ('cancelled', 'rejected', 'refused', 'declined'));

  DROP TABLE IF EXISTS _fent;
  CREATE TEMP TABLE _fent ON COMMIT DROP AS
  SELECT g.id, g.guest_list_id AS list_id, l.event_id, lower(NULLIF(btrim(g.email), '')) AS email,
         (COALESCE(g.entry_scanned, false) OR g.status = 'entered') AS came,
         e.start_at, e.started, e.over, e.night, COALESCE(d.known, false) AS known,
         l.hkey, l.quota, l.closed
    FROM public.guest_list_entries g
    JOIN _flist l ON l.id = g.guest_list_id
    JOIN _fev e ON e.id = l.event_id
    LEFT JOIN _fdoor d ON d.id = e.id
   WHERE g.status NOT IN ('cancelled', 'rejected', 'refused', 'declined');
  CREATE INDEX ON _fent (email);

  -- Remplissage de chaque liste, et « complète » (quota atteint ou fermée à la main).
  DROP TABLE IF EXISTS _ffill;
  CREATE TEMP TABLE _ffill ON COMMIT DROP AS
  SELECT l.id, l.event_id, l.hkey, l.quota, l.closed, count(f.id) AS entries,
         (l.closed OR (l.quota IS NOT NULL AND l.quota > 0 AND count(f.id) >= l.quota)) AS is_full
    FROM _flist l LEFT JOIN _fent f ON f.list_id = l.id
   GROUP BY l.id, l.event_id, l.hkey, l.quota, l.closed;

  -- Chaque invité d'une soirée passée de la période : payait-il avant, a-t-il payé après ?
  DROP TABLE IF EXISTS _fconv;
  CREATE TEMP TABLE _fconv ON COMMIT DROP AS
  SELECT f.id, f.email, f.hkey,
         EXISTS (SELECT 1 FROM _fsale s WHERE s.email = f.email AND s.paid AND s.at < f.start_at) AS paid_before,
         EXISTS (SELECT 1 FROM _fsale s WHERE s.email = f.email AND s.paid AND s.at > f.start_at) AS paid_after
    FROM _fent f
   WHERE f.over AND f.email IS NOT NULL;

  WITH
  -- 1. Quotas
  q AS (
    SELECT count(*) AS lists,
           count(*) FILTER (WHERE quota IS NOT NULL AND quota > 0) AS capped,
           COALESCE(sum(quota) FILTER (WHERE quota IS NOT NULL AND quota > 0), 0) AS quota,
           COALESCE(sum(LEAST(entries, quota)) FILTER (WHERE quota IS NOT NULL AND quota > 0), 0) AS filled,
           count(*) FILTER (WHERE is_full) AS full_lists
      FROM _ffill
  ),
  qev AS (
    SELECT e.id, e.title, e.start_at, NOT e.started AS upcoming,
           count(f.id) AS lists, COALESCE(sum(f.quota) FILTER (WHERE f.quota > 0), 0) AS quota,
           COALESCE(sum(f.entries), 0) AS entries, count(*) FILTER (WHERE f.is_full) AS full_lists
      FROM _fev e JOIN _ffill f ON f.event_id = e.id
     GROUP BY e.id, e.title, e.start_at, e.started
  ),
  -- 2. Détenteurs
  hl AS (
    SELECT l.hkey, min(l.htype) AS htype, min(l.hlabel) AS hlabel,
           count(DISTINCT l.id) AS lists, count(DISTINCT l.event_id) AS nights,
           COALESCE(sum(ff.quota) FILTER (WHERE ff.quota > 0), 0) AS quota
      FROM _flist l JOIN _ffill ff ON ff.id = l.id
     GROUP BY l.hkey
  ),
  he AS (
    SELECT hkey, count(*) AS entries,
           count(*) FILTER (WHERE known) AS k_entries,
           count(*) FILTER (WHERE known AND came) AS k_came,
           count(*) FILTER (WHERE known AND NOT came) AS k_noshow,
           count(*) FILTER (WHERE NOT started) AS upcoming
      FROM _fent GROUP BY hkey
  ),
  hc AS (
    SELECT hkey, count(DISTINCT email) FILTER (WHERE NOT paid_before) AS eligible,
           count(DISTINCT email) FILTER (WHERE NOT paid_before AND paid_after) AS converted
      FROM _fconv GROUP BY hkey
  ),
  -- 3. Un invité vaut-il un client payant ? (soirées à porte mesurée)
  came AS (
    SELECT DISTINCT f.event_id, f.email FROM _fent f WHERE f.known AND f.came AND f.email IS NOT NULL
  ),
  guest_night AS (
    SELECT (SELECT count(*) FROM came) AS n,
           COALESCE((SELECT sum(s.amount) FROM _fsale s JOIN came c ON c.event_id = s.event_id AND c.email = s.email
                      WHERE s.pillar = 'tables'), 0) AS spend
  ),
  payers AS (
    SELECT DISTINCT s.event_id, s.email
      FROM _fsale s JOIN _fdoor d ON d.id = s.event_id AND d.known
     WHERE s.paid AND s.pillar = 'tickets' AND s.scanned_at IS NOT NULL AND s.email IS NOT NULL
  ),
  paid_night AS (
    SELECT (SELECT count(*) FROM payers) AS n,
           COALESCE((SELECT sum(s.amount) FROM _fsale s JOIN payers p ON p.event_id = s.event_id AND p.email = s.email
                      WHERE s.pillar IN ('tickets', 'tables')), 0) AS spend
  ),
  guest_later AS (
    SELECT COALESCE(sum(s.amount), 0) AS spend
      FROM came c
      JOIN _fev e ON e.id = c.event_id
      JOIN _fsale s ON s.email = c.email AND s.paid AND s.at > e.start_at AND s.at <= e.start_at + interval '90 days'
  ),
  -- 4. Absents
  ns AS (
    SELECT count(*) FILTER (WHERE known AND NOT came) AS noshow,
           count(*) FILTER (WHERE known) AS k_entries,
           count(*) FILTER (WHERE known AND NOT came AND (closed OR (quota > 0 AND (SELECT ff.entries FROM _ffill ff WHERE ff.id = _fent.list_id) >= quota))) AS noshow_full,
           count(*) FILTER (WHERE over AND NOT known) AS unmeasured
      FROM _fent
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('period', p_period, 'days', v_n, 'from', v_from, 'to', v_today, 'event', p_event,
                               'money', public._tix_money(p_venue_id, p_organizer_user_id)),
    'quotas', (SELECT jsonb_build_object(
        'lists', q.lists, 'capped', q.capped, 'quota', q.quota, 'filled', q.filled, 'full_lists', q.full_lists,
        'fill', CASE WHEN q.quota >= 10 THEN round(100.0 * q.filled / q.quota, 1) END,
        'nights', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', x.id, 'title', x.title, 'start_at', x.start_at, 'upcoming', x.upcoming, 'lists', x.lists,
            'quota', x.quota, 'entries', x.entries, 'full_lists', x.full_lists,
            'fill', CASE WHEN x.quota >= 10 THEN round(100.0 * LEAST(x.entries, x.quota) / x.quota, 1) END)
            ORDER BY x.upcoming DESC, CASE WHEN x.upcoming THEN x.start_at END ASC, x.start_at DESC)
            FROM (SELECT * FROM qev ORDER BY upcoming DESC, start_at DESC LIMIT 16) x), '[]'::jsonb))
      FROM q),
    'holders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', hl.hkey, 'type', hl.htype, 'label', hl.hlabel, 'lists', hl.lists, 'nights', hl.nights, 'quota', hl.quota,
        'entries', COALESCE(he.entries, 0), 'upcoming', COALESCE(he.upcoming, 0),
        'k_entries', COALESCE(he.k_entries, 0), 'came', COALESCE(he.k_came, 0), 'noshow', COALESCE(he.k_noshow, 0),
        'showup', CASE WHEN COALESCE(he.k_entries, 0) >= 10 THEN round(100.0 * he.k_came / he.k_entries, 1) END,
        'eligible', COALESCE(hc.eligible, 0), 'converted', COALESCE(hc.converted, 0),
        'conv_pct', CASE WHEN COALESCE(hc.eligible, 0) >= 10 THEN round(100.0 * hc.converted / hc.eligible, 1) END)
        ORDER BY COALESCE(he.entries, 0) DESC, hl.hlabel)
        FROM hl LEFT JOIN he ON he.hkey = hl.hkey LEFT JOIN hc ON hc.hkey = hl.hkey), '[]'::jsonb),
    'worth', (SELECT jsonb_build_object(
        'guests', g.n, 'payers', p.n,
        'guest_night', jsonb_build_object('amount', CASE WHEN g.n >= 10 THEN round(g.spend / g.n, 2) END),
        'paid_night', jsonb_build_object('amount', CASE WHEN p.n >= 10 THEN round(p.spend / p.n, 2) END),
        'guest_later', jsonb_build_object('amount', CASE WHEN g.n >= 10 THEN round(gl.spend / g.n, 2) END),
        'revenue', round(g.spend + gl.spend, 2))
        FROM guest_night g, paid_night p, guest_later gl),
    'noshow', (SELECT jsonb_build_object(
        'noshow', ns.noshow, 'k_entries', ns.k_entries, 'held_full', ns.noshow_full, 'unmeasured', ns.unmeasured,
        'rate', CASE WHEN ns.k_entries >= 10 THEN round(100.0 * ns.noshow / ns.k_entries, 1) END,
        'lost', jsonb_build_object('amount', CASE WHEN g.n >= 10 THEN round(ns.noshow * g.spend / g.n, 2) END))
        FROM ns, guest_night g)
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_report(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  e            record;
  v_tz         text;
  v_day_start  timestamptz;
  v_scope_venue text := null;
  v_scope_org  uuid := null;
  v_money      boolean := false;
  v_scope_ids  uuid[];
  v_result     jsonb;
  v_take       jsonb := '[]'::jsonb;
  v_tx_total   integer;
  v_expected   integer;
  v_entered    integer;
  v_heads_d0   integer;
  v_heads      integer;
  v_row        record;
  v_ref        record;
  v_ref_d      integer;
  v_ref_final  integer;
  v_ref_at     integer;
  v_pace       jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select ev.*, coalesce(ev.timezone, v.timezone, 'Europe/Paris') as tz, v.name as venue_name
    into e
  from public.events ev
  left join public.venues v on v.id = coalesce(ev.venue_id, ev.partner_venue_id)
  where ev.id = p_event_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── Portée + droit de voir l'argent ───────────────────────────────────
  if e.venue_id is not null and (public.can_manage_venue(v_uid, e.venue_id) or public.is_super_admin()) then
    v_scope_venue := e.venue_id;
  elsif e.partner_venue_id is not null and public.can_manage_venue(v_uid, e.partner_venue_id) then
    v_scope_venue := e.partner_venue_id;
  elsif e.organizer_user_id is not null and (
          v_uid = e.organizer_user_id
          or public.is_super_admin()
          or public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) then
    v_scope_org := e.organizer_user_id;
  elsif e.partner_organizer_id is not null and (
          v_uid = e.partner_organizer_id
          or public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) then
    v_scope_org := e.partner_organizer_id;
  -- Co-hôte accepté : la soirée se lit dans SA portée (orga d'abord).
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
                   and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) then
    select c.organizer_user_id into v_scope_org from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
       and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     order by (c.organizer_user_id = v_uid) desc limit 1;
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
                   and public.can_manage_venue(v_uid, c.venue_id)) then
    select c.venue_id into v_scope_venue from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
       and public.can_manage_venue(v_uid, c.venue_id)
     limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope_venue is not null then
    -- Club hôte, ou club CO-HÔTE quand l'organisateur principal partage les
    -- montants (« Tout », défaut) ; jamais un club qui ne fait qu'accueillir.
    v_money := (coalesce(v_scope_venue = e.venue_id, false)
                or public.coorg_cohost_sees_money(p_event_id, 'venue:' || v_scope_venue)) and (
      public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = v_scope_venue and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = v_scope_venue
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      ));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where (x.venue_id = v_scope_venue or x.partner_venue_id = v_scope_venue or x.id in (select public.cohost_event_ids_venue(v_scope_venue))) and x.external_source is null;
  else
    v_money := (v_uid = v_scope_org
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, v_scope_org, 'view_finance'))
      -- Un co-hôte voit l'argent si l'organisateur principal le partage (défaut)
      -- ou s'il a une part dans un accord actif (coorg_sees_event_money).
      and (public.is_super_admin() or public.coorg_sees_event_money(p_event_id, 'org:' || v_scope_org::text));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where (x.organizer_user_id = v_scope_org or x.partner_organizer_id = v_scope_org or x.id in (select public.cohost_event_ids_org(v_scope_org))) and x.external_source is null;
  end if;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  with
  -- ── Les ventes de la soirée, une ligne par transaction ────────────────
  tx as materialized (
    select 'tickets'::text as pillar, t.id, lower(t.user_email) as email, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(coalesce(t.quantity, 1), 1) as heads,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(nullif(nullif(t.attribution_source, ''), 'direct'), nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id, t.ticket_round_id as line_id
    from public.tickets t
    where t.event_id = p_event_id and t.status in ('paid', 'used')
    union all
    select 'tables', r.id, lower(r.user_email), r.user_id,
           coalesce(r.paid_at, r.created_at),
           1,
           greatest(coalesce(r.guest_count, 0), 1),
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(nullif(nullif(r.attribution_source, ''), 'direct'), nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id, r.pack_id
    from public.table_reservations r
    where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
    union all
    select 'drinks', o.id, lower(o.user_email), o.user_id,
           coalesce(o.paid_at, o.created_at),
           1,
           0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(nullif(nullif(o.attribution_source, ''), 'direct'), nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id, null::uuid
    from public.orders o
    where o.event_id = p_event_id and o.status in ('paid', 'served')
      and v_scope_venue is not null and o.venue_id = v_scope_venue
  ),
  gle as materialized (
    select g.id, lower(nullif(btrim(g.email), '')) as email, g.user_id, g.created_at as at_ts,
           g.guest_list_id as line_id, g.tracked_link_id
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = p_event_id and g.status <> 'cancelled'
  ),
  vis as materialized (
    select s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.completed_order, false) as done
    from public.visitor_sessions s
    where s.event_id = p_event_id
  ),

  -- ── Contacts de la soirée, et ceux déjà vus à une soirée PRÉCÉDENTE ────
  people as (
    select distinct email from (
      select email from tx where pillar in ('tickets', 'tables') and email is not null
      union all
      select email from gle where email is not null
    ) p
  ),
  prior_events as materialized (
    select x.id from public.events x
    where x.id = any(v_scope_ids) and x.id <> p_event_id and x.start_at < e.start_at
  ),
  seen_before as (
    select distinct p.email
    from people p
    where exists (select 1 from public.tickets t
                  where t.event_id in (select id from prior_events)
                    and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
       or exists (select 1 from public.table_reservations r
                  where r.event_id in (select id from prior_events)
                    and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
       or exists (select 1 from public.guest_list_entries g
                  join public.guest_lists gl on gl.id = g.guest_list_id
                  where gl.event_id in (select id from prior_events)
                    and g.status <> 'cancelled' and lower(g.email) = p.email)
  ),

  -- ── Série jour par jour, clé d = jours calendaires avant la soirée ─────
  day_rows as (
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date as d,
           case when pillar = 'tickets' then units else 0 end as tickets,
           case when pillar = 'tables' then 1 else 0 end as tables,
           0 as guests, amount, 0 as visits,
           heads as people
    from tx
    union all
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date, 0, 0, 1, 0, 0, 1 from gle
    union all
    select (e.start_at at time zone v_tz)::date - (visited_at at time zone v_tz)::date, 0, 0, 0, 0, 1, 0 from vis
  ),
  series as (
    select d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
           sum(amount) as amount, sum(visits) as visits, sum(people) as people
    from day_rows group by d
  ),

  -- ── Messages qui parlaient de CETTE soirée ────────────────────────────
  emails as (
    select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
           coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
           coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
           ec.automation_id is not null as auto
    from public.email_campaigns ec
    where (ec.event_id = p_event_id or ec.automation_trigger_event_id = p_event_id)
      and ec.status in ('sent', 'sending', 'paused')
      and ((v_scope_venue is not null and ec.venue_id = v_scope_venue)
        or (v_scope_org is not null and ec.organizer_user_id = v_scope_org))
    order by ec.sent_at desc nulls last
    limit 30
  ),
  email_clicks as (
    select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
    from public.email_campaign_events ece
    where ece.campaign_id in (select id from emails)
      and ece.event_type = 'clicked' and ece.recipient_email is not null
    group by 1, 2
  ),
  email_attr as (
    select c.campaign_id,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from email_clicks c
    join (
      select pillar, id, email, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, email, at_ts, 0 from gle
    ) x on x.email = c.email and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  ),
  pushes as (
    select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
           coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key
    from public.push_campaigns pc
    where pc.event_id = p_event_id
      and pc.status in ('sent', 'sending', 'completed')
      and ((v_scope_venue is not null and pc.venue_id = v_scope_venue)
        or (v_scope_org is not null and pc.venue_id is null and pc.agency_id is null))
    order by pc.created_at desc
    limit 30
  ),
  push_clicks as (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
    from public.push_campaign_events pce
    where pce.campaign_id in (select id from pushes)
      and pce.event_type = 'clicked' and pce.user_id is not null
    group by 1, 2
  ),
  push_attr as (
    select c.campaign_id,
           count(*) as clicks,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from push_clicks c
    left join (
      select pillar, id, user_id, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, user_id, at_ts, 0 from gle
    ) x on x.user_id = c.user_id and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  )

  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'money', v_money,
    'scope', case when v_scope_venue is not null then 'venue' else 'organizer' end,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', e.end_at,
      'poster', coalesce(e.poster_url, e.image_url), 'status', e.status,
      'cancelled', e.cancelled_at is not null,
      'publishedAt', e.published_at, 'createdAt', e.created_at,
      'venueName', e.venue_name,
      'entryTarget', e.entry_target,
      'phase', case when v_now >= e.end_at then 'after' when v_now >= e.start_at then 'live' else 'before' end
    ),

    -- 1. Où en sont mes ventes ?
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (select coalesce(sum(units), 0) from tx where pillar = 'tickets'),
        'today', (select coalesce(sum(units), 0) from tx where pillar = 'tickets' and at_ts >= v_day_start),
        'orders', (select count(*) from tx where pillar = 'tickets'),
        'capacity', case
          when coalesce(e.max_tickets, 0) > 0 then e.max_tickets
          when exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id)
           and not exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id and coalesce(tr.max_tickets, 0) <= 0)
            then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = p_event_id)
          else null end,
        'enabled', coalesce(e.ticketing_enabled, false),
        'soldOut', coalesce(e.tickets_sold_out, false)
      ),
      'tables', jsonb_build_object(
        'booked', (select count(*) from tx where pillar = 'tables'),
        'today', (select count(*) from tx where pillar = 'tables' and at_ts >= v_day_start),
        'guests', (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0)
                   from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed')),
        'capacity', nullif((
          select coalesce(sum(p.tables_count), 0)
          from public.table_packs p
          where p.is_active
            and (p.event_id = p_event_id
                 or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                     and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
            and not (p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])))
        ), 0),
        'enabled', coalesce(e.tables_enabled, false),
        'soldOut', coalesce(e.tables_sold_out, false)
      ),
      'guestList', jsonb_build_object(
        'registered', (select count(*) from gle),
        'today', (select count(*) from gle where at_ts >= v_day_start),
        'capacity', (
          select case when count(*) > 0 and count(*) filter (where coalesce(gl.quota, 0) <= 0) = 0
                      then sum(gl.quota) else null end
          from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active
        ),
        'enabled', exists (select 1 from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active),
        'soldOut', coalesce(e.guest_list_sold_out, false)
      ),
      'drinks', case when v_scope_venue is not null then jsonb_build_object(
        'orders', (select count(*) from tx where pillar = 'drinks'),
        'today', (select count(*) from tx where pillar = 'drinks' and at_ts >= v_day_start)
      ) else null end,
      'revenue', case when v_money then jsonb_build_object(
        'total', round((select coalesce(sum(amount), 0) from tx)::numeric, 2),
        'today', round((select coalesce(sum(amount), 0) from tx where at_ts >= v_day_start)::numeric, 2),
        'tickets', round((select coalesce(sum(amount), 0) from tx where pillar = 'tickets')::numeric, 2),
        'tables', round((select coalesce(sum(amount), 0) from tx where pillar = 'tables')::numeric, 2),
        'drinks', round((select coalesce(sum(amount), 0) from tx where pillar = 'drinks')::numeric, 2)
      ) else null end,
      'visits', jsonb_build_object(
        'total', (select count(*) from vis),
        'today', (select count(*) from vis where visited_at >= v_day_start),
        'withOrder', (select count(*) from vis where done)
      ),
      -- La porte : personnes scannées (billets en quantité, convives d'une
      -- table scannée ou arrivée, inscrits guest list) et attendus. Même
      -- définition que « Entrées » dans get_sales_overview.
      'door', jsonb_build_object(
        'entered',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used')
              and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
              and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled' and coalesce(g2.entry_scanned, false)),
        'expected',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled')
      )
    ),

    'lines', coalesce((
      select jsonb_agg(l.obj order by l.pillar_ord, l.ord)
      from (
        -- Paliers de billets
        select 1 as pillar_ord, coalesce(tr.position, 0) * 1000 + row_number() over (order by tr.position, tr.created_at) as ord,
               jsonb_build_object(
                 'pillar', 'tickets', 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0),
                 'capacity', nullif(tr.max_tickets, 0),
                 'status', case
                   when coalesce(e.tickets_sold_out, false) or coalesce(tr.manually_sold_out, false)
                     or (coalesce(tr.max_tickets, 0) > 0 and coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0) >= tr.max_tickets)
                     then 'sold_out'
                   when tr.is_active then 'on_sale'
                   when coalesce(tr.auto_activate, false) then 'upcoming'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tickets' and line_id = tr.id), 0)::numeric, 2) else null end
               ) as obj
        from public.ticket_rounds tr where tr.event_id = p_event_id
        union all
        -- Formules de table (de la soirée, ou du club quand elles ne sont pas event-scopées)
        select 2, coalesce(p.position, 0) * 1000 + row_number() over (order by p.position, p.created_at),
               jsonb_build_object(
                 'pillar', 'tables', 'id', p.id, 'name', p.name, 'price', p.base_price,
                 'sold', (select count(*) from tx where pillar = 'tables' and line_id = p.id),
                 'capacity', nullif(p.tables_count, 0),
                 'status', case
                   when coalesce(e.tables_sold_out, false) or p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])) then 'sold_out'
                   when coalesce(p.tables_count, 0) > 0 and (select count(*) from tx where pillar = 'tables' and line_id = p.id) >= p.tables_count then 'sold_out'
                   when coalesce(e.tables_enabled, false) then 'on_sale'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tables' and line_id = p.id), 0)::numeric, 2) else null end
               )
        from public.table_packs p
        where p.is_active
          and (p.event_id = p_event_id
               or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                   and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
        union all
        -- Parts de guest list
        select 3, row_number() over (order by gl.created_at),
               jsonb_build_object(
                 'pillar', 'guestList', 'id', gl.id,
                 'name', nullif(btrim(coalesce(gl.holder_label, '')), ''),
                 'holderType', gl.holder_type,
                 'price', null,
                 'sold', (select count(*) from gle where line_id = gl.id),
                 'capacity', nullif(gl.quota, 0),
                 'status', case
                   when coalesce(e.guest_list_sold_out, false) or coalesce(gl.manually_sold_out, false) then 'sold_out'
                   when coalesce(gl.quota, 0) > 0 and (select count(*) from gle where line_id = gl.id) >= gl.quota then 'sold_out'
                   when gl.is_active then 'on_sale'
                   else 'closed' end,
                 'amount', null
               )
        from public.guest_lists gl where gl.event_id = p_event_id
      ) l
    ), '[]'::jsonb),

    -- 2. Comment évoluent-elles ?
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
               'amount', case when v_money then round(s.amount::numeric, 2) else null end,
               'visits', s.visits, 'people', s.people
             ) order by s.d desc)
      from series s
    ), '[]'::jsonb),

    -- 3. Est-ce qu'on voit ma soirée ?
    'visitSources', coalesce((
      select jsonb_agg(jsonb_build_object('source', v.source, 'sessions', v.sessions, 'orders', v.orders) order by v.sessions desc)
      from (select source, count(*) as sessions, count(*) filter (where done) as orders
            from vis group by source order by 2 desc limit 8) v
    ), '[]'::jsonb),

    -- 4. Qui achète ?
    'audience', jsonb_build_object(
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables') and email is not null),
      'priorEvents', (select count(*) from prior_events)
    ),

    -- 5. Qu'est-ce qui a fait vendre ?
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
               'amount', case when v_money then round(c.amount::numeric, 2) else null end) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct',
                                    'link', 'partner', 'instagram', 'social', 'whatsapp', 'marketplace', 'promo_code') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
               'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
               'amount', case when v_money then round(k.amount::numeric, 2) else null end
             ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
      from (
        select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
               (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
               (select count(*) from gle where gle.tracked_link_id = tl.id) as entries,
               (select coalesce(sum(amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
        from public.tracked_links tl
        where tl.event_id = p_event_id
           or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
           or tl.id in (select tracked_link_id from gle where tracked_link_id is not null)
      ) k
      where k.n > 0 or k.entries > 0 or coalesce(k.clicks_count, 0) > 0
    ), '[]'::jsonb),
    -- Repères de la courbe J-N : publication, ouverture d'un tarif (première
    -- vente d'un palier qui n'est pas le premier), emails et push de la soirée.
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object('kind', mk.kind, 'd', mk.d, 'at', mk.at_ts, 'label', mk.label)
                       order by mk.at_ts)
      from (
        select 'published'::text as kind, e.published_at as at_ts, null::text as label,
               (e.start_at at time zone v_tz)::date - (e.published_at at time zone v_tz)::date as d
        where e.published_at is not null
        union all
        select 'round', r.first_at, r.name,
               (e.start_at at time zone v_tz)::date - (r.first_at at time zone v_tz)::date
        from (
          select tr.name, min(tx.at_ts) as first_at,
                 row_number() over (order by min(tx.at_ts)) as rn
          from public.ticket_rounds tr
          join tx on tx.pillar = 'tickets' and tx.line_id = tr.id
          where tr.event_id = p_event_id
          group by tr.id, tr.name
        ) r
        where r.rn > 1
        union all
        select 'email', em.sent_at, em.title,
               (e.start_at at time zone v_tz)::date - (em.sent_at at time zone v_tz)::date
        from emails em where em.sent_at is not null
        union all
        select 'push', pu.sent_at, pu.title,
               (e.start_at at time zone v_tz)::date - (pu.sent_at at time zone v_tz)::date
        from pushes pu where pu.sent_at is not null
      ) mk
      where mk.at_ts <= v_now
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(m.obj order by m.sent_at desc nulls last)
      from (
        select em.sent_at, jsonb_build_object(
                 'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                 'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               ) as obj
        from emails em left join email_attr a on a.campaign_id = em.id
        union all
        select pu.sent_at, jsonb_build_object(
                 'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                 'templateKey', pu.template_key,
                 'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               )
        from pushes pu left join push_attr a on a.campaign_id = pu.id
      ) m
    ), '[]'::jsonb)
  )
  into v_result;

  -- ── À retenir : 0 à 3 constats, chacun avec son seuil et sa section ──────
  -- Clé + paramètres ; le texte est traduit côté front (er.tk.*). Une base
  -- mince ne dit rien : chaque constat porte un minimum de volume.
  v_entered  := coalesce((v_result #>> '{totals,door,entered}')::int, 0);
  v_expected := coalesce((v_result #>> '{totals,door,expected}')::int, 0);
  v_tx_total := coalesce((v_result #>> '{totals,tickets,orders}')::int, 0)
              + coalesce((v_result #>> '{totals,tables,booked}')::int, 0)
              + coalesce((v_result #>> '{totals,guestList,registered}')::int, 0);

  -- 1. Soirée passée : la porte n'a pas vu tout le monde.
  if v_result #>> '{event,phase}' = 'after' and v_expected >= 30 and v_entered > 0
     and v_entered::numeric / v_expected < 0.7 then
    v_take := v_take || jsonb_build_object('key', 'no_show', 'tone', 'bad', 'section', 'sales',
      'params', jsonb_build_object('pct', round(100.0 * v_entered / v_expected), 'missing', v_expected - v_entered));
  end if;

  -- 2. Un message a fait une bonne part des ventes.
  select m.value into v_row from jsonb_array_elements(v_result -> 'messages') m
   order by (m.value ->> 'orders')::int + (m.value ->> 'entries')::int desc limit 1;
  if found and v_tx_total >= 10
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) >= 5
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int)::numeric / v_tx_total >= 0.2 then
    v_take := v_take || jsonb_build_object('key', 'msg_drove', 'tone', 'good', 'section', 'reach',
      'params', jsonb_build_object('kind', v_row.value ->> 'kind', 'title', v_row.value ->> 'title',
        'n', (v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int,
        'pct', round(100.0 * ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) / v_tx_total)));
  end if;

  -- 3. Beaucoup de visites, peu d'achats.
  if coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 100
     and (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int < 0.02 then
    v_take := v_take || jsonb_build_object('key', 'low_conversion', 'tone', 'bad', 'section', 'reach',
      'params', jsonb_build_object('visits', (v_result #>> '{totals,visits,total}')::int,
        'pct', round(100.0 * (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int, 1)));
  end if;

  -- 4. Soirée passée : une grosse part des attendus a acheté le jour J.
  select coalesce(sum((x.value ->> 'people')::int) filter (where (x.value ->> 'd')::int <= 0), 0),
         coalesce(sum((x.value ->> 'people')::int), 0)
    into v_heads_d0, v_heads
  from jsonb_array_elements(v_result -> 'series') x;
  if v_result #>> '{event,phase}' = 'after' and v_heads >= 30 and v_heads_d0::numeric / v_heads >= 0.3 then
    v_take := v_take || jsonb_build_object('key', 'day_of', 'tone', 'info', 'section', 'curve',
      'params', jsonb_build_object('pct', round(100.0 * v_heads_d0 / v_heads)));
  end if;

  -- 5. D'où viennent les visites.
  select s.value into v_row from jsonb_array_elements(v_result -> 'visitSources') s
   order by (s.value ->> 'sessions')::int desc limit 1;
  if found and coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 30
     and (v_row.value ->> 'sessions')::numeric / (v_result #>> '{totals,visits,total}')::int >= 0.5 then
    v_take := v_take || jsonb_build_object('key', 'visit_source', 'tone', 'info', 'section', 'reach',
      'params', jsonb_build_object('source', v_row.value ->> 'source',
        'pct', round(100.0 * (v_row.value ->> 'sessions')::int / (v_result #>> '{totals,visits,total}')::int)));
  end if;

  -- 6. Public neuf ou public d'habitués (seulement s'il y a eu des soirées avant).
  if coalesce((v_result #>> '{audience,people}')::int, 0) >= 20
     and coalesce((v_result #>> '{audience,priorEvents}')::int, 0) >= 1 then
    if (v_result #>> '{audience,new}')::numeric / (v_result #>> '{audience,people}')::int >= 0.6 then
      v_take := v_take || jsonb_build_object('key', 'mostly_new', 'tone', 'info', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,new}')::int / (v_result #>> '{audience,people}')::int)));
    elsif (v_result #>> '{audience,returning}')::numeric / (v_result #>> '{audience,people}')::int >= 0.5 then
      v_take := v_take || jsonb_build_object('key', 'mostly_returning', 'tone', 'good', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,returning}')::int / (v_result #>> '{audience,people}')::int)));
    end if;
  end if;

  -- ── Rythme : la dernière soirée TERMINÉE de la portée (≥ 20 attendus), et
  --    la part de ses attendus qu'elle avait au même J-N. Le front applique
  --    cette part aux attendus d'aujourd'hui pour dire où finira la soirée.
  if v_result #>> '{event,phase}' = 'before' then
    v_ref_d := (e.start_at at time zone v_tz)::date - (v_now at time zone v_tz)::date;
    for v_ref in
      select x.id, x.title, x.start_at, coalesce(x.timezone, v.timezone, 'Europe/Paris') as tz
      from public.events x
      left join public.venues v on v.id = coalesce(x.venue_id, x.partner_venue_id)
      where x.id = any(v_scope_ids) and x.id <> p_event_id
        and x.cancelled_at is null and x.end_at < v_now and x.start_at < e.start_at
      order by x.start_at desc
      limit 6
    loop
      select coalesce(sum(h.n), 0),
             -- Jours ENTIERS avant ce J-N (strictement) : aujourd'hui n'est pas
             -- fini ici, on ne le compare pas à une journée complète là-bas.
             coalesce(sum(h.n) filter (where (v_ref.start_at at time zone v_ref.tz)::date - (h.at_ts at time zone v_ref.tz)::date > v_ref_d), 0)
        into v_ref_final, v_ref_at
      from (
        select greatest(coalesce(t.quantity, 1), 1) as n, coalesce(t.paid_at, t.created_at) as at_ts
        from public.tickets t where t.event_id = v_ref.id and t.status in ('paid', 'used')
        union all
        select greatest(coalesce(r.guest_count, 0), 1), coalesce(r.paid_at, r.created_at)
        from public.table_reservations r where r.event_id = v_ref.id and r.status in ('paid', 'confirmed')
        union all
        select 1, g.created_at
        from public.guest_list_entries g join public.guest_lists gl on gl.id = g.guest_list_id
        where gl.event_id = v_ref.id and g.status <> 'cancelled'
      ) h;
      if v_ref_final >= 20 then
        v_pace := jsonb_build_object('refId', v_ref.id, 'refTitle', v_ref.title, 'd', v_ref_d,
                                     'final', v_ref_final, 'atSameD', v_ref_at);
        exit;
      end if;
    end loop;
  end if;
  v_result := v_result || jsonb_build_object('pace', v_pace);

  v_result := v_result || jsonb_build_object('takeaways',
    coalesce((select jsonb_agg(x.value) from (select value from jsonb_array_elements(v_take) limit 3) x), '[]'::jsonb));

  return v_result;
end;
$function$;
