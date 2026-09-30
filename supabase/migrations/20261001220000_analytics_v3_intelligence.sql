-- Analytics v3, phase 3 — l'intelligence (spec §4.4, §4.8, §7, §9).
--
--   get_analytics_rfm        : les six segments en langage club (Piliers, Fidèles,
--                              Gros dépensiers occasionnels, Nouveaux prometteurs,
--                              À risque, Perdus) — taille, revenu — depuis
--                              _venue_customer_rfm / get_organizer_customer_segments.
--   get_analytics_cohorts    : mois de la première soirée × part du revenu aux
--                              mois 1, 2, 3 et 6.
--   get_analytics_insights   : 0 à 3 constats par règles (jamais sous 20
--                              observations), chacun avec son onglet-preuve.
--   get_analytics_tonight    : les grands chiffres de la nuit en cours.
--   get_analytics_benchmarks : médianes anonymisées de Yuno, seulement si au
--                              moins 5 clubs contribuent (démo exclue).

-- ── RFM en langage club ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_rfm(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g record;
  v_rows jsonb;
  v_total int;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  -- Mêmes règles RFM que la page Clients (jamais recalculées ici), regroupées :
  --   champions → piliers · loyal → fidèles · promising (récent, peu fréquent, dépense haute)
  --   → gros dépensiers occasionnels · new → nouveaux prometteurs · at_risk → à risque
  --   · dormant + lost → perdus.
  WITH base AS (
    SELECT r.email, r.rfm_segment, coalesce(r.total_spent, 0) AS spent, coalesce(r.visit_nights, 0) AS nights, r.last_visit_at
      FROM public._venue_customer_rfm(g.scope_venue) r WHERE g.scope_venue IS NOT NULL
    UNION ALL
    SELECT r.email, r.rfm_segment, coalesce(r.total_spent, 0), coalesce(r.visit_nights, 0), r.last_visit_at
      FROM public.get_organizer_customer_segments(g.scope_org) r WHERE g.scope_org IS NOT NULL
  ),
  mapped AS (
    SELECT CASE b.rfm_segment
             WHEN 'champions' THEN 'pillars' WHEN 'loyal' THEN 'loyal' WHEN 'promising' THEN 'big_occasional'
             WHEN 'new' THEN 'new_promising' WHEN 'at_risk' THEN 'at_risk' ELSE 'lost' END AS seg,
           b.rfm_segment AS raw, b.spent, b.nights
      FROM base b
  )
  SELECT jsonb_agg(jsonb_build_object('segment', x.seg, 'n', x.n, 'revenue', CASE WHEN g.money THEN x.spent END, 'raw', x.raws) ORDER BY x.ord), coalesce(sum(x.n), 0)
    INTO v_rows, v_total
    FROM (
      SELECT s.seg, s.ord, coalesce(count(m.seg), 0)::int AS n, round(coalesce(sum(m.spent), 0), 2) AS spent,
             coalesce(array_agg(DISTINCT m.raw) FILTER (WHERE m.raw IS NOT NULL), '{}') AS raws
        FROM (VALUES ('pillars', 1), ('loyal', 2), ('big_occasional', 3), ('new_promising', 4), ('at_risk', 5), ('lost', 6)) s(seg, ord)
        LEFT JOIN mapped m ON m.seg = s.seg
       GROUP BY s.seg, s.ord) x;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'total', v_total, 'segments', coalesce(v_rows, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_rfm(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_rfm(text, uuid) TO authenticated;

-- ── Cohortes ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_cohorts(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g record; v_rows jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  WITH pp AS MATERIALIZED (
    SELECT p.email, p.at_ts, p.amount, p.first_seen FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar <> 'guest_list'
  ),
  cohort AS (
    SELECT date_trunc('month', pp.first_seen AT TIME ZONE g.tz)::date AS month, pp.email,
           (extract(year FROM age(date_trunc('month', pp.at_ts AT TIME ZONE g.tz), date_trunc('month', pp.first_seen AT TIME ZONE g.tz))) * 12
            + extract(month FROM age(date_trunc('month', pp.at_ts AT TIME ZONE g.tz), date_trunc('month', pp.first_seen AT TIME ZONE g.tz))))::int AS m,
           pp.amount
      FROM pp
     WHERE pp.first_seen >= (date_trunc('month', now() AT TIME ZONE g.tz) - make_interval(months => greatest(p_months, 1)))
  ),
  agg AS (
    SELECT month, count(DISTINCT email)::int AS people,
           round(sum(amount) FILTER (WHERE m = 0), 2) AS m0,
           round(sum(amount) FILTER (WHERE m = 1), 2) AS m1, round(sum(amount) FILTER (WHERE m = 2), 2) AS m2,
           round(sum(amount) FILTER (WHERE m = 3), 2) AS m3, round(sum(amount) FILTER (WHERE m = 6), 2) AS m6,
           count(DISTINCT email) FILTER (WHERE m = 1)::int AS p1, count(DISTINCT email) FILTER (WHERE m = 2)::int AS p2,
           count(DISTINCT email) FILTER (WHERE m = 3)::int AS p3, count(DISTINCT email) FILTER (WHERE m = 6)::int AS p6,
           (date_trunc('month', now() AT TIME ZONE g.tz)::date - month) / 30 AS age_months
      FROM cohort GROUP BY month
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(a.month, 'YYYY-MM'), 'people', a.people, 'masked', a.people < 10,
    'm0', CASE WHEN g.money AND a.people >= 10 THEN a.m0 END,
    'm1', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 1 THEN coalesce(a.m1, 0) END,
    'm2', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 2 THEN coalesce(a.m2, 0) END,
    'm3', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 3 THEN coalesce(a.m3, 0) END,
    'm6', CASE WHEN g.money AND a.people >= 10 AND a.age_months >= 6 THEN coalesce(a.m6, 0) END,
    'r1', CASE WHEN a.people >= 10 AND a.age_months >= 1 THEN round(100.0 * a.p1 / a.people, 1) END,
    'r2', CASE WHEN a.people >= 10 AND a.age_months >= 2 THEN round(100.0 * a.p2 / a.people, 1) END,
    'r3', CASE WHEN a.people >= 10 AND a.age_months >= 3 THEN round(100.0 * a.p3 / a.people, 1) END,
    'r6', CASE WHEN a.people >= 10 AND a.age_months >= 6 THEN round(100.0 * a.p6 / a.people, 1) END
  ) ORDER BY a.month), '[]'::jsonb) INTO v_rows FROM agg a;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_cohorts(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_cohorts(text, uuid, integer) TO authenticated;

-- ── Insights par règles ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_insights(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_compare text DEFAULT 'median5')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g        record;
  v_ids    uuid[];
  v_out    jsonb := '[]'::jsonb;
  v_pace   jsonb;
  v_sales  jsonb;
  v_door   jsonb;
  v_src    jsonb;
  v_row    jsonb;
  v_ev     record;
  v_n      numeric; v_m numeric; v_a numeric; v_b numeric;
  v_top    jsonb; v_worst jsonb;
  v_pillars int;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);

  -- 1. Rythme (soirée à venir, ≥ 3 comparables).
  IF p_event_id IS NOT NULL THEN
    v_pace := public.get_analytics_pacing(p_event_id, CASE WHEN p_compare IN ('comparable', 'previous') THEN 'median5' ELSE p_compare END, 30);
    IF (v_pace ->> 'ok')::boolean AND (v_pace #>> '{compare,n}')::int >= 3 AND (v_pace #>> '{event,status}') <> 'past'
       AND (v_pace #>> '{at_d,ref_tickets}')::numeric >= 20 AND v_pace ->> 'status' IN ('bad', 'warn') THEN
      v_n := (v_pace #>> '{at_d,tickets}')::numeric; v_m := (v_pace #>> '{at_d,ref_tickets}')::numeric;
      v_out := v_out || jsonb_build_object('key', 'pacing_behind', 'level', CASE WHEN v_pace ->> 'status' = 'bad' THEN 'critical' ELSE 'warn' END, 'tab', 'sales',
        'params', jsonb_build_object('d', (v_pace ->> 'today_d')::int, 'pct', round(100.0 * (v_m - v_n) / v_m), 'n', (v_pace #>> '{compare,n}')::int, 'tickets', v_n, 'ref', round(v_m)));
    ELSIF (v_pace ->> 'ok')::boolean AND (v_pace #>> '{compare,n}')::int >= 3 AND (v_pace #>> '{event,status}') <> 'past'
       AND (v_pace #>> '{at_d,ref_tickets}')::numeric >= 20 AND v_pace ->> 'status' = 'good'
       AND (v_pace #>> '{at_d,tickets}')::numeric >= 1.15 * (v_pace #>> '{at_d,ref_tickets}')::numeric THEN
      v_n := (v_pace #>> '{at_d,tickets}')::numeric; v_m := (v_pace #>> '{at_d,ref_tickets}')::numeric;
      v_out := v_out || jsonb_build_object('key', 'pacing_ahead', 'level', 'info', 'tab', 'sales',
        'params', jsonb_build_object('d', (v_pace ->> 'today_d')::int, 'pct', round(100.0 * (v_n - v_m) / v_m), 'n', (v_pace #>> '{compare,n}')::int));
    END IF;
  END IF;

  -- 2. Paliers (soirée) : un palier épuisé en moins de 24 h.
  v_sales := public.get_analytics_sales(p_venue_id, p_organizer_user_id, p_event_id, p_from, p_to);
  IF (v_sales ->> 'ok')::boolean THEN
    IF p_event_id IS NOT NULL THEN
      SELECT x INTO v_row FROM jsonb_array_elements(v_sales -> 'rounds') x
       WHERE (x ->> 'status') = 'sold_out' AND (x ->> 'hours_to_sell_out')::numeric < 24 AND (x ->> 'qty')::int >= 20
       ORDER BY (x ->> 'hours_to_sell_out')::numeric LIMIT 1;
      IF v_row IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('key', 'tier_gone_fast', 'level', 'info', 'tab', 'sales',
          'params', jsonb_build_object('name', v_row ->> 'name', 'hours', round((v_row ->> 'hours_to_sell_out')::numeric), 'qty', (v_row ->> 'qty')::int));
      END IF;
    END IF;
    -- 4. Timing : ≥ 20 achats, un jour qui pèse ≥ 25 %.
    IF (v_sales #>> '{heatmap,total}')::int >= 20 THEN
      SELECT x INTO v_row FROM jsonb_array_elements(v_sales #> '{heatmap,by_weekday}') x ORDER BY (x ->> 'n')::int DESC LIMIT 1;
      IF v_row IS NOT NULL AND (v_row ->> 'n')::numeric >= 0.25 * (v_sales #>> '{heatmap,total}')::numeric THEN
        SELECT y INTO v_top FROM jsonb_array_elements(v_sales #> '{heatmap,by_hour}') y ORDER BY (y ->> 'n')::int DESC LIMIT 1;
        v_out := v_out || jsonb_build_object('key', 'buy_timing', 'level', 'info', 'tab', 'sales',
          'params', jsonb_build_object('weekday', (v_row ->> 'w')::int, 'hour', (v_top ->> 'h')::int, 'pct', round(100.0 * (v_row ->> 'n')::numeric / (v_sales #>> '{heatmap,total}')::numeric), 'n', (v_sales #>> '{heatmap,total}')::int));
      END IF;
    END IF;
  END IF;

  -- 3 et 8. Canal et tunnel.
  v_src := public.get_analytics_sources(p_venue_id, p_organizer_user_id, p_event_id, p_from, p_to);
  IF (v_src ->> 'ok')::boolean THEN
    IF (v_src #>> '{totals,sessions}')::int >= 100 AND (v_src #>> '{totals,orders}')::int >= 20 THEN
      -- Une source qui pèse ≥ 20 % des visites mais moins de la moitié de cette part en ventes.
      SELECT x INTO v_row FROM jsonb_array_elements(v_src -> 'sources') x
       WHERE (x ->> 'sessions')::numeric >= 0.2 * (v_src #>> '{totals,sessions}')::numeric
         AND (x ->> 'orders')::numeric / (v_src #>> '{totals,orders}')::numeric < 0.5 * ((x ->> 'sessions')::numeric / (v_src #>> '{totals,sessions}')::numeric)
       ORDER BY (x ->> 'sessions')::int DESC LIMIT 1;
      IF v_row IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('key', 'channel_gap', 'level', 'warn', 'tab', 'sources',
          'params', jsonb_build_object('source', v_row ->> 'source',
            'visits_pct', round(100.0 * (v_row ->> 'sessions')::numeric / (v_src #>> '{totals,sessions}')::numeric),
            'sales_pct', round(100.0 * (v_row ->> 'orders')::numeric / (v_src #>> '{totals,orders}')::numeric)));
      END IF;
    END IF;
    SELECT (x ->> 'n')::numeric INTO v_a FROM jsonb_array_elements(v_src -> 'funnel') x WHERE x ->> 'step' = 'checkout';
    SELECT (x ->> 'n')::numeric INTO v_b FROM jsonb_array_elements(v_src -> 'funnel') x WHERE x ->> 'step' = 'paid';
    IF v_a >= 20 AND v_b IS NOT NULL AND v_b / v_a < 0.6 THEN
      v_out := v_out || jsonb_build_object('key', 'checkout_leak', 'level', 'warn', 'tab', 'sources',
        'params', jsonb_build_object('pct', round(100.0 * v_b / v_a), 'checkouts', v_a::int));
    END IF;
  END IF;

  -- 6 et 7. Porte et tables.
  v_door := public.get_analytics_door(p_venue_id, p_organizer_user_id, p_event_id, p_from, p_to);
  IF (v_door ->> 'ok')::boolean THEN
    v_a := (v_door #>> '{by_type,guest_list,rate}')::numeric; v_b := (v_door #>> '{by_type,tickets,rate}')::numeric;
    IF v_a IS NOT NULL AND v_b IS NOT NULL AND (v_door #>> '{by_type,guest_list,expected}')::int >= 20 AND (v_door #>> '{by_type,tickets,expected}')::int >= 20
       AND v_b - v_a >= 20 THEN
      v_out := v_out || jsonb_build_object('key', 'guest_list_no_show', 'level', 'warn', 'tab', 'door',
        'params', jsonb_build_object('gl', round(v_a), 'tickets', round(v_b), 'factor', round(v_b / greatest(v_a, 1), 1)));
    END IF;
    SELECT x INTO v_top FROM jsonb_array_elements(v_door #> '{tables,zones}') x WHERE (x ->> 'spend_vs_min') IS NOT NULL ORDER BY (x ->> 'spend_vs_min')::numeric DESC LIMIT 1;
    SELECT x INTO v_worst FROM jsonb_array_elements(v_door #> '{tables,zones}') x WHERE (x ->> 'spend_vs_min') IS NOT NULL ORDER BY (x ->> 'spend_vs_min')::numeric ASC LIMIT 1;
    IF v_top IS NOT NULL AND v_worst IS NOT NULL AND (v_top ->> 'zone') <> (v_worst ->> 'zone')
       AND (v_top ->> 'spend_vs_min')::numeric >= 1.2 AND (v_worst ->> 'spend_vs_min')::numeric <= 0.9 THEN
      v_out := v_out || jsonb_build_object('key', 'zone_minimums', 'level', 'info', 'tab', 'door',
        'params', jsonb_build_object('top', v_top ->> 'zone', 'top_x', (v_top ->> 'spend_vs_min')::numeric, 'low', v_worst ->> 'zone', 'low_x', (v_worst ->> 'spend_vs_min')::numeric));
    END IF;
  END IF;

  -- 5. Audience : des piliers / fidèles qui n'ont pas encore pris leur place pour une soirée à venir.
  IF p_event_id IS NOT NULL AND g.money THEN
    SELECT e.id, e.title, e.start_at INTO v_ev FROM public.events e WHERE e.id = p_event_id;
    IF v_ev.start_at > now() THEN
      SELECT count(*) INTO v_pillars FROM (
        SELECT r.email FROM public._venue_customer_rfm(g.scope_venue) r WHERE g.scope_venue IS NOT NULL AND r.rfm_segment IN ('champions', 'loyal')
        UNION
        SELECT r.email FROM public.get_organizer_customer_segments(g.scope_org) r WHERE g.scope_org IS NOT NULL AND r.rfm_segment IN ('champions', 'loyal')
      ) x
      WHERE nullif(x.email, '') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(x.email))
        AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr WHERE tr.event_id = p_event_id AND tr.status IN ('paid', 'confirmed') AND lower(tr.user_email) = lower(x.email));
      IF v_pillars >= 20 THEN
        v_out := v_out || jsonb_build_object('key', 'pillars_not_booked', 'level', 'info', 'tab', 'audience',
          'params', jsonb_build_object('n', v_pillars, 'title', v_ev.title, 'event_id', v_ev.id));
      END IF;
    END IF;
  END IF;

  -- Au plus trois, du plus grave au plus doux.
  SELECT coalesce(jsonb_agg(x ORDER BY CASE x ->> 'level' WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END), '[]'::jsonb)
    INTO v_out FROM (SELECT x FROM jsonb_array_elements(v_out) x
                     ORDER BY CASE x ->> 'level' WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END LIMIT 3) y;
  RETURN jsonb_build_object('ok', true, 'insights', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_insights(text, uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_insights(text, uuid, uuid, timestamptz, timestamptz, text) TO authenticated;

-- ── Ce soir ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_tonight(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g record; v_ids uuid[]; v_now timestamptz := now(); v_night date; v_res jsonb; v_alerts jsonb := '[]'::jsonb;
  v_last15 int; v_prev15 int; v_late int;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_night := public.night_date(v_now, g.tz);
  SELECT coalesce(array_agg(e.id), '{}') INTO v_ids FROM public.events e
   WHERE e.id = ANY(g.scope_ids) AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
     AND public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), g.tz)) = v_night;
  IF cardinality(v_ids) = 0 THEN
    -- La prochaine soirée, pour dire quand ça commence.
    RETURN jsonb_build_object('ok', true, 'live', false, 'night', v_night,
      'next', (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e
                WHERE e.id = ANY(g.scope_ids) AND e.start_at > v_now AND e.cancelled_at IS NULL ORDER BY e.start_at LIMIT 1));
  END IF;

  -- Arrivées des 15 dernières minutes vs les 15 d'avant (pic à la porte).
  WITH scans AS (
    SELECT coalesce(t.entry_scanned_at, t.used_at) AS at_ts, greatest(coalesce(t.quantity, 1), 1) AS heads FROM public.tickets t
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used') AND coalesce(t.entry_scanned_at, t.used_at) IS NOT NULL
    UNION ALL
    SELECT x.entry_scanned_at, 1 FROM public.guest_list_entries x JOIN public.guest_lists gl ON gl.id = x.guest_list_id
     WHERE gl.event_id = ANY(v_ids) AND x.entry_scanned_at IS NOT NULL
    UNION ALL
    SELECT coalesce(r.entry_scanned_at, r.checked_in_at), greatest(coalesce(r.guest_count, 1), 1) FROM public.table_reservations r
     WHERE r.event_id = ANY(v_ids) AND coalesce(r.entry_scanned_at, r.checked_in_at) IS NOT NULL
  )
  SELECT coalesce(sum(heads) FILTER (WHERE at_ts >= v_now - interval '15 minutes'), 0),
         coalesce(sum(heads) FILTER (WHERE at_ts >= v_now - interval '30 minutes' AND at_ts < v_now - interval '15 minutes'), 0)
    INTO v_last15, v_prev15 FROM scans;

  -- Tables promises non honorées : réservées, heure limite d'arrivée passée, personne.
  SELECT count(*) INTO v_late FROM public.table_reservations r
    JOIN public.events e ON e.id = r.event_id LEFT JOIN public.table_packs p ON p.id = r.pack_id
   WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
     AND NOT (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
     AND p.arrival_deadline ~ '^\d{1,2}:\d{2}'
     AND ((v_night::timestamp + (CASE WHEN p.arrival_deadline::time < time '12:00' THEN interval '1 day' ELSE interval '0' END) + p.arrival_deadline::time) AT TIME ZONE coalesce(nullif(e.timezone, ''), g.tz)) < v_now;

  IF v_last15 >= 20 AND v_last15 >= 2 * greatest(v_prev15, 1) THEN
    v_alerts := v_alerts || jsonb_build_object('key', 'door_peak', 'level', 'warn', 'params', jsonb_build_object('n', v_last15));
  END IF;
  IF v_late > 0 THEN
    v_alerts := v_alerts || jsonb_build_object('key', 'tables_late', 'level', 'warn', 'params', jsonb_build_object('n', v_late));
  END IF;

  SELECT jsonb_build_object(
    'ok', true, 'live', true, 'night', v_night, 'money', g.money, 'now', v_now,
    'events', (SELECT jsonb_agg(jsonb_build_object('id', n.event_id, 'title', n.title, 'start_at', n.start_at, 'end_at', n.end_ts) ORDER BY n.start_at) FROM public._an3_nights(v_ids, g.scope_venue, g.money) n),
    'entries', coalesce(sum(n.entries), 0), 'expected', coalesce(sum(n.expected), 0),
    'cap', nullif(coalesce(sum(n.cap) FILTER (WHERE n.cap > 0), 0), 0),
    'revenue', CASE WHEN g.money THEN round(coalesce(sum(n.revenue), 0), 2) END,
    'rev_tickets', CASE WHEN g.money THEN round(coalesce(sum(n.rev_tickets), 0), 2) END,
    'rev_bar', CASE WHEN g.money THEN round(coalesce(sum(n.rev_bar), 0), 2) END,
    'rev_tables', CASE WHEN g.money THEN round(coalesce(sum(n.rev_tables), 0), 2) END,
    'tickets', coalesce(sum(n.tickets), 0), 'bar_orders', coalesce(sum(n.bar_orders), 0),
    'tables_booked', coalesce(sum(n.tables), 0), 'tables_arrived', coalesce(sum(n.tables_arrived), 0),
    'gl_registered', coalesce(sum(n.gl_registered), 0), 'gl_entered', coalesce(sum(n.gl_entered), 0),
    'last15', v_last15, 'prev15', v_prev15, 'alerts', v_alerts)
    INTO v_res FROM public._an3_nights(v_ids, g.scope_venue, g.money) n;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_tonight(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_tonight(text, uuid) TO authenticated;

-- ── Benchmarks Yuno anonymisés ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_benchmarks(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g record; v_n int; v_res jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  -- Un club contribue s'il a ≥ 3 soirées terminées avec ≥ 20 billets sur 90 jours (démo exclue).
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
  nights AS (
    SELECT e.venue_id, n.*
      FROM public.events e CROSS JOIN d
      JOIN LATERAL public._an3_nights(ARRAY[e.id], e.venue_id, true) n ON true
     WHERE e.venue_id IS NOT NULL AND NOT (e.venue_id = ANY(d.dv))
       AND e.start_at >= now() - interval '90 days' AND coalesce(e.end_at, e.start_at + interval '8 hours') <= now()
       AND e.cancelled_at IS NULL
  ),
  per_venue AS (
    SELECT venue_id,
           count(*) FILTER (WHERE tickets >= 20) AS nights_ok,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN expected > 0 AND entries > 0 THEN 100.0 * entries / expected END) AS attendance,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN cap > 0 THEN 100.0 * tickets / cap END) AS fill,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN entries > 0 THEN revenue / entries END) AS per_head
      FROM nights GROUP BY venue_id
  ),
  contributors AS (SELECT * FROM per_venue WHERE nights_ok >= 3)
  SELECT count(*), jsonb_build_object(
      'attendance', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY attendance)::numeric, 1),
      'fill', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fill)::numeric, 1),
      'per_head', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY per_head)::numeric, 2))
    INTO v_n, v_res FROM contributors;

  RETURN jsonb_build_object('ok', true, 'contributors', v_n, 'ready', v_n >= 5, 'medians', CASE WHEN v_n >= 5 THEN v_res END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_benchmarks(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_benchmarks(text, uuid) TO authenticated;
