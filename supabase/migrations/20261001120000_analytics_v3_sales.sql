-- Analytics v3 — onglet Ventes (phase 1).
--
--   _an3_subject_ids     : les soirées du sujet (UNE soirée, ou une période en nuits locales).
--   get_analytics_sales  : paliers (quantité, CA, remplissage, temps pour épuiser),
--                          part last-minute (7 j / 48 h / jour J), délai d'achat,
--                          heatmap jour × heure des achats, petites courbes par soirée.

CREATE OR REPLACE FUNCTION public._an3_subject_ids(p_scope_ids uuid[], p_tz text, p_event_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_event_id IS NOT NULL THEN
      CASE WHEN p_event_id = ANY(coalesce(p_scope_ids, '{}')) THEN ARRAY[p_event_id] ELSE '{}'::uuid[] END
    ELSE coalesce((
      SELECT array_agg(e.id)
        FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
       WHERE e.id = ANY(coalesce(p_scope_ids, '{}')) AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
         AND public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, p_tz))
             BETWEEN public.night_date(coalesce(p_from, coalesce(p_to, now()) - interval '30 days'), p_tz)
                 AND public.night_date(coalesce(p_to, now()), p_tz)), '{}'::uuid[])
  END
$$;
REVOKE ALL ON FUNCTION public._an3_subject_ids(uuid[], text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._an3_subject_ids(uuid[], text, uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_analytics_sales(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g        record;
  v_ids    uuid[];
  v_now    timestamptz := now();
  v_rounds jsonb;
  v_last   jsonb;
  v_lead   jsonb;
  v_heat   jsonb;
  v_small  jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- ── Paliers ───────────────────────────────────────────────────────────────
  WITH ev AS (
    SELECT e.id, e.published_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz,
           public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz)) AS night,
           (g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)) AS show_money
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  tx AS (
    SELECT t.id, t.event_id, t.ticket_round_id, coalesce(t.paid_at, t.created_at) AS at_ts,
           greatest(coalesce(t.quantity, 1), 1) AS units,
           CASE WHEN ev.show_money THEN greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) ELSE 0 END AS amount,
           sum(greatest(coalesce(t.quantity, 1), 1)) OVER (PARTITION BY t.ticket_round_id ORDER BY coalesce(t.paid_at, t.created_at), t.id) AS cum
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.status IN ('paid', 'used')
  ),
  per_round AS (
    SELECT tr.id, tr.event_id, tr.name, tr.price, coalesce(tr.position, 0) AS position, nullif(tr.max_tickets, 0) AS cap,
           tr.is_active, coalesce(tr.manually_sold_out, false) AS manual_sold_out,
           coalesce(sum(tx.units), 0)::int AS qty, round(coalesce(sum(tx.amount), 0), 2) AS amount,
           min(tx.at_ts) AS first_sale_at,
           min(tx.at_ts) FILTER (WHERE nullif(tr.max_tickets, 0) IS NOT NULL AND tx.cum >= tr.max_tickets) AS sold_out_at,
           ev.published_at AS opened_at
      FROM public.ticket_rounds tr JOIN ev ON ev.id = tr.event_id
      LEFT JOIN tx ON tx.ticket_round_id = tr.id
     GROUP BY tr.id, tr.event_id, tr.name, tr.price, tr.position, tr.max_tickets, tr.is_active, tr.manually_sold_out, ev.published_at
  )
  SELECT CASE WHEN p_event_id IS NOT NULL THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'price', r.price, 'qty', r.qty, 'revenue', CASE WHEN g.money THEN r.amount END, 'cap', r.cap,
        'sell_through', CASE WHEN r.cap > 0 THEN round(100.0 * r.qty / r.cap, 1) END,
        'status', CASE WHEN r.manual_sold_out OR (r.cap > 0 AND r.qty >= r.cap) THEN 'sold_out' WHEN r.is_active THEN 'on_sale' ELSE 'closed' END,
        'first_sale_at', r.first_sale_at, 'sold_out_at', r.sold_out_at, 'opened_at', r.opened_at,
        'hours_to_sell_out', CASE WHEN r.sold_out_at IS NOT NULL AND coalesce(r.opened_at, r.first_sale_at) IS NOT NULL
                                  THEN round(extract(epoch FROM (r.sold_out_at - coalesce(r.opened_at, r.first_sale_at))) / 3600.0, 1) END
      ) ORDER BY r.position, r.price) FROM per_round r), '[]'::jsonb)
  ELSE
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'name', x.name, 'price', x.price, 'qty', x.qty, 'revenue', CASE WHEN g.money THEN x.amount END, 'rounds', x.rounds,
        'sold_out_rounds', x.sold_out_rounds, 'sell_through', x.sell_through,
        'hours_to_sell_out', x.hours_med
      ) ORDER BY x.qty DESC)
      FROM (
        SELECT r.name, min(r.price) AS price, sum(r.qty)::int AS qty, round(sum(r.amount), 2) AS amount, count(*)::int AS rounds,
               count(*) FILTER (WHERE r.sold_out_at IS NOT NULL)::int AS sold_out_rounds,
               CASE WHEN sum(r.cap) FILTER (WHERE r.cap > 0) > 0 THEN round(100.0 * sum(r.qty) FILTER (WHERE r.cap > 0) / sum(r.cap) FILTER (WHERE r.cap > 0), 1) END AS sell_through,
               round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (r.sold_out_at - coalesce(r.opened_at, r.first_sale_at))) / 3600.0)
                 FILTER (WHERE r.sold_out_at IS NOT NULL AND coalesce(r.opened_at, r.first_sale_at) IS NOT NULL))::numeric, 1) AS hours_med
          FROM per_round r GROUP BY r.name) x), '[]'::jsonb)
  END INTO v_rounds;

  -- ── Last-minute, délai d'achat, heatmap ───────────────────────────────────
  WITH ev AS (
    SELECT e.id, e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz,
           public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz)) AS night
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  sales AS (
    SELECT p.event_id, p.at_ts, p.units, p.pillar, ev.tz,
           (ev.night - public.night_date(p.at_ts, ev.tz)) AS d,
           (ev.start_at - p.at_ts) AS before
      FROM public._an3_people(v_ids, g.scope_venue) p JOIN ev ON ev.id = p.event_id
     WHERE p.pillar IN ('tickets', 'tables')
  ),
  tickets_only AS (SELECT * FROM sales WHERE pillar = 'tickets')
  SELECT
    jsonb_build_object(
      'units', coalesce(sum(units), 0),
      'last_7d', coalesce(sum(units) FILTER (WHERE d <= 7), 0),
      'last_48h', coalesce(sum(units) FILTER (WHERE before <= interval '48 hours'), 0),
      'day_of', coalesce(sum(units) FILTER (WHERE d <= 0), 0)),
    jsonb_build_object(
      'median_days', percentile_disc(0.5) WITHIN GROUP (ORDER BY greatest(d, 0)),
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'd0', 'units', coalesce(sum(units) FILTER (WHERE d <= 0), 0)),
        jsonb_build_object('key', 'd1_2', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 1 AND 2), 0)),
        jsonb_build_object('key', 'd3_6', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 3 AND 6), 0)),
        jsonb_build_object('key', 'd7_13', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 7 AND 13), 0)),
        jsonb_build_object('key', 'd14_29', 'units', coalesce(sum(units) FILTER (WHERE d BETWEEN 14 AND 29), 0)),
        jsonb_build_object('key', 'd30', 'units', coalesce(sum(units) FILTER (WHERE d >= 30), 0))))
    INTO v_last, v_lead
    FROM tickets_only;

  WITH ev AS (
    SELECT e.id, coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  cells AS (
    SELECT extract(isodow FROM (p.at_ts AT TIME ZONE ev.tz))::int AS w,
           extract(hour FROM (p.at_ts AT TIME ZONE ev.tz))::int AS h,
           sum(CASE WHEN p.pillar = 'tickets' THEN p.units ELSE 1 END)::int AS n
      FROM public._an3_people(v_ids, g.scope_venue) p JOIN ev ON ev.id = p.event_id
     WHERE p.pillar IN ('tickets', 'tables')
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(n) FROM cells), 0),
    'cells', coalesce((SELECT jsonb_agg(jsonb_build_object('w', w, 'h', h, 'n', n) ORDER BY w, h) FROM cells), '[]'::jsonb),
    'by_weekday', coalesce((SELECT jsonb_agg(jsonb_build_object('w', w, 'n', n) ORDER BY w) FROM (SELECT w, sum(n)::int AS n FROM cells GROUP BY w) x), '[]'::jsonb),
    'by_hour', coalesce((SELECT jsonb_agg(jsonb_build_object('h', h, 'n', n) ORDER BY h) FROM (SELECT h, sum(n)::int AS n FROM cells GROUP BY h) x), '[]'::jsonb))
    INTO v_heat;

  -- ── Petites courbes (période : les 12 dernières soirées) ──────────────────
  IF p_event_id IS NULL THEN
    WITH last12 AS (
      SELECT e.id, e.title, e.start_at, coalesce(e.max_tickets, 0) AS cap
        FROM public.events e WHERE e.id = ANY(v_ids) ORDER BY e.start_at DESC LIMIT 12
    ),
    curve AS (
      SELECT c.event_id, jsonb_agg(jsonb_build_object('d', c.d, 'tickets', c.tickets, 'revenue', c.revenue) ORDER BY c.d DESC) AS pts,
             max(c.tickets) AS final_tickets, max(c.revenue) AS final_revenue
        FROM public._an3_curve((SELECT array_agg(id) FROM last12), g.scope_venue, g.money, 14) c GROUP BY c.event_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'start_at', l.start_at, 'cap', nullif(l.cap, 0),
             'tickets', curve.final_tickets, 'revenue', CASE WHEN g.money THEN curve.final_revenue END, 'curve', curve.pts) ORDER BY l.start_at DESC), '[]'::jsonb)
      INTO v_small FROM last12 l LEFT JOIN curve ON curve.event_id = l.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'tz', g.tz, 'nights', cardinality(v_ids),
    'rounds', v_rounds, 'last_minute', v_last, 'lead_time', v_lead, 'heatmap', v_heat, 'small_multiples', v_small);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_sales(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_sales(text, uuid, uuid, timestamptz, timestamptz) TO authenticated;
