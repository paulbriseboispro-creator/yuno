-- Analytics v3 — onglet Porte & tables (phase 1).
--
-- Arrivées par tranche de 15 min (scans des trois piliers, en minutes depuis
-- midi de la nuit locale), présence / no-show PAR TYPE, guest list → achat
-- payant sous 90 jours, revenu par personne présente, tables par zone
-- (occupation, acomptes, revenu par table, dépense réelle vs minimum, no-show).

CREATE OR REPLACE FUNCTION public.get_analytics_door(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g           record;
  v_ids       uuid[];
  v_now       timestamptz := now();
  v_arrivals  jsonb;
  v_marks     jsonb;
  v_types     jsonb;
  v_gl        jsonb;
  v_tables    jsonb;
  v_totals    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  WITH ev AS (
    SELECT e.id, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           coalesce(nullif(e.timezone, ''), v.timezone, g.tz) AS tz,
           public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz)) AS night,
           (g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)) AS show_money
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = ANY(v_ids)
  ),
  -- Midi de la nuit, en timestamptz, pour mesurer chaque scan en minutes.
  noon AS (
    SELECT ev.id, ((ev.night::timestamp + interval '12 hours') AT TIME ZONE ev.tz) AS noon_ts FROM ev
  ),
  scans AS (
    -- Billets : nominatifs par personne, sinon la quantité du billet.
    SELECT t.event_id, a.entry_scanned_at AS at_ts, 1 AS heads, 'tickets'::text AS kind
      FROM public.tickets t JOIN public.ticket_attendees a ON a.ticket_id = t.id
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used') AND a.entry_scanned AND a.entry_scanned_at IS NOT NULL
    UNION ALL
    SELECT t.event_id, coalesce(t.entry_scanned_at, t.used_at), greatest(coalesce(t.quantity, 1), 1), 'tickets'
      FROM public.tickets t
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
       AND (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used')
       AND coalesce(t.entry_scanned_at, t.used_at) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = t.id)
    UNION ALL
    SELECT g2.event_id, x.entry_scanned_at, 1, 'guest_list'
      FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id
     WHERE g2.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled' AND coalesce(x.entry_scanned, false) AND x.entry_scanned_at IS NOT NULL
    UNION ALL
    SELECT r.event_id, coalesce(r.entry_scanned_at, r.checked_in_at), greatest(coalesce(r.guest_count, 1), 1), 'tables'
      FROM public.table_reservations r
     WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
       AND (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AND coalesce(r.entry_scanned_at, r.checked_in_at) IS NOT NULL
  ),
  slots AS (
    SELECT (floor(extract(epoch FROM (s.at_ts - n.noon_ts)) / 900) * 15)::int AS m, s.kind, sum(s.heads)::int AS heads
      FROM scans s JOIN noon n ON n.id = s.event_id
     WHERE s.at_ts >= n.noon_ts AND s.at_ts < n.noon_ts + interval '24 hours'
     GROUP BY 1, 2
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object('m', x.m, 'n', x.n, 'tickets', x.t, 'guest_list', x.gl, 'tables', x.tb) ORDER BY x.m)
              FROM (SELECT m, sum(heads)::int AS n, sum(heads) FILTER (WHERE kind = 'tickets')::int AS t,
                           sum(heads) FILTER (WHERE kind = 'guest_list')::int AS gl, sum(heads) FILTER (WHERE kind = 'tables')::int AS tb
                      FROM slots GROUP BY m) x), '[]'::jsonb),
    jsonb_build_object(
      'nights', (SELECT count(*) FROM ev),
      'scanned_nights', (SELECT count(DISTINCT event_id) FROM scans),
      'doors_open_m', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (ev.start_at - n.noon_ts)) / 60))
                         FROM ev JOIN noon n ON n.id = ev.id),
      'gl_deadline_m', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
                          CASE WHEN gl.entry_deadline < time '12:00' THEN extract(epoch FROM gl.entry_deadline) / 60 + 720 ELSE extract(epoch FROM gl.entry_deadline) / 60 - 720 END))
                          FROM public.guest_lists gl WHERE gl.event_id = ANY(v_ids) AND gl.entry_deadline IS NOT NULL),
      'peak_m', (SELECT x.m FROM (SELECT m, sum(heads) AS n FROM slots GROUP BY m ORDER BY n DESC, m LIMIT 1) x))
    INTO v_arrivals, v_marks;

  -- ── Présence par type (soirées terminées où la porte a scanné) ────────────
  WITH ev AS (
    SELECT e.id, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  judged AS (
    SELECT n.event_id FROM public._an3_nights(v_ids, g.scope_venue, g.money) n WHERE n.end_ts <= v_now AND n.entries > 0
  ),
  tk AS (
    SELECT t.id, t.event_id, greatest(coalesce(t.quantity, 1), 1) AS units,
           EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = t.id) AS nominative,
           (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used') AS scanned
      FROM public.tickets t WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
  ),
  tk_agg AS (
    SELECT coalesce(sum(units) FILTER (WHERE event_id IN (SELECT event_id FROM judged)), 0)::int AS expected,
           (coalesce((SELECT count(*) FROM public.ticket_attendees a JOIN tk ON tk.id = a.ticket_id WHERE a.entry_scanned AND tk.event_id IN (SELECT event_id FROM judged)), 0)
            + coalesce(sum(units) FILTER (WHERE NOT nominative AND scanned AND event_id IN (SELECT event_id FROM judged)), 0))::int AS entered,
           coalesce(sum(units), 0)::int AS expected_all
      FROM tk
  ),
  gl_agg AS (
    SELECT count(*) FILTER (WHERE g2.event_id IN (SELECT event_id FROM judged))::int AS expected,
           count(*) FILTER (WHERE coalesce(x.entry_scanned, false) AND g2.event_id IN (SELECT event_id FROM judged))::int AS entered,
           count(*)::int AS expected_all
      FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id
     WHERE g2.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled'
  ),
  tb_agg AS (
    SELECT count(*) FILTER (WHERE r.event_id IN (SELECT event_id FROM judged))::int AS booked,
           count(*) FILTER (WHERE (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AND r.event_id IN (SELECT event_id FROM judged))::int AS arrived,
           coalesce(sum(greatest(coalesce(r.guest_count, 1), 1)) FILTER (WHERE r.event_id IN (SELECT event_id FROM judged)), 0)::int AS guests_expected,
           coalesce(sum(greatest(coalesce(r.guest_count, 1), 1)) FILTER (WHERE (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AND r.event_id IN (SELECT event_id FROM judged)), 0)::int AS guests_arrived,
           count(*)::int AS booked_all
      FROM public.table_reservations r WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
  )
  SELECT jsonb_build_object(
    'judged_nights', (SELECT count(*) FROM judged),
    'tickets', (SELECT jsonb_build_object('expected', expected, 'entered', entered, 'expected_all', expected_all,
                  'rate', CASE WHEN expected >= 10 THEN round(100.0 * entered / expected, 1) END) FROM tk_agg),
    'guest_list', (SELECT jsonb_build_object('expected', expected, 'entered', entered, 'expected_all', expected_all,
                  'rate', CASE WHEN expected >= 10 THEN round(100.0 * entered / expected, 1) END) FROM gl_agg),
    'tables', (SELECT jsonb_build_object('booked', booked, 'arrived', arrived, 'booked_all', booked_all,
                  'guests_expected', guests_expected, 'guests_arrived', guests_arrived,
                  'rate', CASE WHEN booked >= 5 THEN round(100.0 * arrived / booked, 1) END) FROM tb_agg))
    INTO v_types;

  -- ── Guest list → achat payant sous 90 jours (dans la portée) ─────────────
  WITH gl_people AS (
    SELECT DISTINCT lower(trim(x.email)) AS email, e.start_at
      FROM public.guest_list_entries x JOIN public.guest_lists g2 ON g2.id = x.guest_list_id JOIN public.events e ON e.id = g2.event_id
     WHERE g2.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled' AND nullif(trim(x.email), '') IS NOT NULL
  ),
  paid AS MATERIALIZED (
    SELECT p.email, p.at_ts FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar IN ('tickets', 'tables') AND p.email IN (SELECT email FROM gl_people)
  ),
  conv AS (
    SELECT gp.email,
           EXISTS (SELECT 1 FROM paid p WHERE p.email = gp.email AND p.at_ts > gp.start_at AND p.at_ts <= gp.start_at + interval '90 days') AS converted
      FROM gl_people gp
  )
  SELECT jsonb_build_object(
    'people', count(*), 'converted', count(*) FILTER (WHERE converted),
    'rate', CASE WHEN count(*) >= 10 THEN round(100.0 * count(*) FILTER (WHERE converted) / count(*), 1) END,
    'matured', (SELECT count(*) FROM gl_people WHERE start_at <= v_now - interval '90 days'))
    INTO v_gl FROM conv;

  -- ── Tables par zone ───────────────────────────────────────────────────────
  WITH ev AS (
    SELECT e.id, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           (g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)) AS show_money
      FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  res AS (
    SELECT r.id, r.event_id, r.zone_id, r.pack_id, r.status, r.placement_status, r.guest_count,
           (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL) AS arrived,
           ev.end_ts <= v_now AS finished, ev.show_money,
           CASE WHEN ev.show_money THEN greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)) ELSE 0 END AS amount,
           CASE WHEN ev.show_money AND coalesce(r.payment_mode, 'online') <> 'on_site' THEN greatest(coalesce(r.deposit, 0), 0) ELSE 0 END AS deposit,
           coalesce(r.minimum_spend, 0) AS minimum,
           CASE WHEN ev.show_money THEN coalesce((SELECT sum(o.total_amount) FROM public.vip_table_orders o WHERE o.table_reservation_id = r.id AND o.status IS DISTINCT FROM 'cancelled'), 0) ELSE 0 END AS spent
      FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
  ),
  scanned_nights AS (
    SELECT DISTINCT event_id FROM res WHERE arrived
  ),
  zones AS (
    SELECT coalesce(z.name, '—') AS zone, z.id AS zone_id,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed'))::int AS booked,
           count(*) FILTER (WHERE res.status = 'pending' OR res.placement_status = 'requested')::int AS requests,
           coalesce(sum(greatest(coalesce(res.guest_count, 1), 1)) FILTER (WHERE res.status IN ('paid', 'confirmed')), 0)::int AS guests,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.arrived)::int AS arrived,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.finished AND NOT res.arrived AND res.event_id IN (SELECT event_id FROM scanned_nights))::int AS no_show,
           round(sum(res.amount) FILTER (WHERE res.status IN ('paid', 'confirmed')), 2) AS revenue,
           round(sum(res.deposit) FILTER (WHERE res.status IN ('paid', 'confirmed')), 2) AS deposits,
           round(sum(res.minimum) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.show_money), 2) AS minimum,
           round(sum(res.spent) FILTER (WHERE res.status IN ('paid', 'confirmed')), 2) AS spent,
           count(*) FILTER (WHERE res.status IN ('paid', 'confirmed') AND res.spent > 0)::int AS with_spend
      FROM res LEFT JOIN public.table_zones z ON z.id = res.zone_id
     GROUP BY z.id, z.name
  )
  SELECT jsonb_build_object(
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'zone', zone, 'zone_id', zone_id, 'booked', booked, 'requests', requests, 'guests', guests, 'arrived', arrived, 'no_show', no_show,
        'revenue', CASE WHEN g.money THEN revenue END, 'deposits', CASE WHEN g.money THEN deposits END,
        'revenue_per_table', CASE WHEN g.money AND booked > 0 THEN round(revenue / booked, 2) END,
        'minimum', CASE WHEN g.money THEN minimum END, 'spent', CASE WHEN g.money THEN spent END, 'with_spend', with_spend,
        'spend_vs_min', CASE WHEN g.money AND with_spend >= 3 AND minimum > 0 THEN round(spent / nullif(minimum, 0), 2) END
      ) ORDER BY coalesce(revenue, 0) DESC, booked DESC) FROM zones), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
        'booked', coalesce(sum(booked), 0), 'requests', coalesce(sum(requests), 0), 'arrived', coalesce(sum(arrived), 0), 'no_show', coalesce(sum(no_show), 0),
        'guests', coalesce(sum(guests), 0),
        'revenue', CASE WHEN g.money THEN round(coalesce(sum(revenue), 0), 2) END,
        'deposits', CASE WHEN g.money THEN round(coalesce(sum(deposits), 0), 2) END,
        'spent', CASE WHEN g.money THEN round(coalesce(sum(spent), 0), 2) END,
        'minimum', CASE WHEN g.money THEN round(coalesce(sum(minimum), 0), 2) END) FROM zones))
    INTO v_tables;

  -- ── Revenu par personne présente ─────────────────────────────────────────
  SELECT jsonb_build_object(
    'revenue', CASE WHEN g.money THEN round(coalesce(sum(n.revenue) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0), 2) END,
    'entries', coalesce(sum(n.entries) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0),
    'expected', coalesce(sum(n.expected) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0),
    'per_head', CASE WHEN g.money AND coalesce(sum(n.entries) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 0) > 0
                     THEN round(sum(n.revenue) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0) / sum(n.entries) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0), 2) END,
    'scanned_nights', count(*) FILTER (WHERE n.end_ts <= v_now AND n.entries > 0),
    'finished_nights', count(*) FILTER (WHERE n.end_ts <= v_now))
    INTO v_totals
    FROM public._an3_nights(v_ids, g.scope_venue, g.money) n;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'tz', g.tz, 'nights', cardinality(v_ids),
    'arrivals', v_arrivals, 'marks', v_marks, 'by_type', v_types, 'gl_to_paid', v_gl, 'tables', v_tables, 'totals', v_totals);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_door(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_door(text, uuid, uuid, timestamptz, timestamptz) TO authenticated;
