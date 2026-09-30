-- Analytics v3 — Vue d'ensemble et pacing (phase 1).
--
--   _an3_aggregate(ids, …)   : totaux ET médianes par soirée d'un lot de soirées.
--   _an3_curve(ids, …)       : cumul J-n (revenu, billets) par soirée.
--   get_analytics_overview   : 6 KPI (valeur, référence, série), soirées, breakdowns.
--   get_analytics_pacing     : courbe J-n de la soirée vs médiane + min/max des
--                              comparables, statut, repères, projection.
--
-- Sujet = UNE soirée (`p_event_id`) OU une période (`p_from` → `p_to`, en nuits
-- locales). Comparaison (`p_compare`) : `comparable` (soirée comparable
-- précédente, défaut), `median5` (médiane des 5 comparables), `yoy` (un an
-- avant), `previous` (la soirée d'avant, quelle qu'elle soit / la période
-- d'avant), `none`. Une période se compare à la période d'avant de même durée.

CREATE OR REPLACE FUNCTION public._an3_aggregate(p_ids uuid[], p_venue_id text, p_money boolean, p_scope_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH n AS (
    SELECT * FROM public._an3_nights(coalesce(p_ids, '{}'), p_venue_id, p_money)
  ),
  vis AS (
    SELECT s.event_id, count(DISTINCT coalesce(nullif(s.visitor_id, ''), s.session_id))::int AS visitors
      FROM public.visitor_sessions s WHERE s.event_id = ANY(coalesce(p_ids, '{}')) GROUP BY s.event_id
  ),
  -- Qui est venu, lu sur TOUTE la portée (c'est ce qui dit « nouveau »), puis
  -- réduit au lot ; calculé une fois pour les deux lectures ci-dessous.
  pp AS MATERIALIZED (
    SELECT p.event_id, p.email, p.pillar, p.first_event
      FROM public._an3_people(coalesce(p_scope_ids, '{}'), p_venue_id) p
     WHERE p.event_id = ANY(coalesce(p_ids, '{}'))
  ),
  ppl AS (
    SELECT p.event_id,
           count(DISTINCT p.email)::int AS customers,
           count(DISTINCT p.email) FILTER (WHERE p.pillar <> 'guest_list')::int AS buyers,
           count(DISTINCT p.email) FILTER (WHERE p.first_event = p.event_id)::int AS new_customers
      FROM pp p
     GROUP BY p.event_id
  ),
  per AS (
    SELECT n.event_id, n.revenue, n.tickets, n.cap, n.show_money, n.end_ts,
           (n.ticket_orders + n.tables + n.bar_orders) AS orders,
           n.entries, n.expected,
           coalesce(vis.visitors, 0) AS visitors,
           coalesce(ppl.customers, 0) AS customers, coalesce(ppl.buyers, 0) AS buyers, coalesce(ppl.new_customers, 0) AS new_customers,
           CASE WHEN n.show_money AND (n.ticket_orders + n.tables + n.bar_orders) > 0 THEN n.revenue / (n.ticket_orders + n.tables + n.bar_orders) END AS aov_n,
           CASE WHEN coalesce(vis.visitors, 0) >= 10 THEN 100.0 * coalesce(ppl.buyers, 0) / vis.visitors END AS conv_n,
           CASE WHEN n.end_ts <= now() AND n.entries > 0 AND n.expected > 0 THEN least(100.0, 100.0 * n.entries / n.expected) END AS att_n,
           CASE WHEN coalesce(ppl.customers, 0) >= 10 THEN 100.0 * coalesce(ppl.new_customers, 0) / ppl.customers END AS new_n,
           CASE WHEN n.cap > 0 THEN 100.0 * n.tickets / n.cap END AS fill_n
      FROM n LEFT JOIN vis ON vis.event_id = n.event_id LEFT JOIN ppl ON ppl.event_id = n.event_id
  ),
  uniq AS (
    -- Clients et nouveaux UNIQUES sur tout le lot (une personne venue deux fois compte une fois).
    SELECT count(DISTINCT p.email)::int AS customers,
           count(DISTINCT p.email) FILTER (WHERE p.pillar <> 'guest_list')::int AS buyers,
           count(DISTINCT p.email) FILTER (WHERE p.first_event = ANY(coalesce(p_ids, '{}')))::int AS new_customers
      FROM pp p
  ),
  uvis AS (
    SELECT count(DISTINCT coalesce(nullif(s.visitor_id, ''), s.session_id))::int AS visitors
      FROM public.visitor_sessions s WHERE s.event_id = ANY(coalesce(p_ids, '{}'))
  )
  SELECT jsonb_build_object(
    'nights', (SELECT count(*) FROM per),
    'money_nights', (SELECT count(*) FROM per WHERE show_money),
    'revenue', (SELECT round(coalesce(sum(revenue), 0), 2) FROM per),
    'rev_tickets', (SELECT round(coalesce(sum(n.rev_tickets), 0), 2) FROM n),
    'rev_tables', (SELECT round(coalesce(sum(n.rev_tables), 0), 2) FROM n),
    'rev_bar', (SELECT round(coalesce(sum(n.rev_bar), 0), 2) FROM n),
    'refunds', (SELECT round(coalesce(sum(n.refunds), 0), 2) FROM n),
    'tickets', (SELECT coalesce(sum(tickets), 0) FROM per),
    'tables', (SELECT coalesce(sum(n.tables), 0) FROM n),
    'gl_registered', (SELECT coalesce(sum(n.gl_registered), 0) FROM n),
    'cap', (SELECT nullif(coalesce(sum(cap) FILTER (WHERE cap > 0), 0), 0) FROM per),
    'tickets_with_cap', (SELECT coalesce(sum(tickets) FILTER (WHERE cap > 0), 0) FROM per),
    'orders', (SELECT coalesce(sum(orders) FILTER (WHERE show_money), 0) FROM per),
    'money_revenue', (SELECT round(coalesce(sum(revenue) FILTER (WHERE show_money), 0), 2) FROM per),
    'entries', (SELECT coalesce(sum(entries) FILTER (WHERE end_ts <= now() AND entries > 0), 0) FROM per),
    'expected', (SELECT coalesce(sum(expected) FILTER (WHERE end_ts <= now() AND entries > 0), 0) FROM per),
    'entries_all', (SELECT coalesce(sum(entries), 0) FROM per),
    'expected_all', (SELECT coalesce(sum(expected), 0) FROM per),
    'scanned_nights', (SELECT count(*) FROM per WHERE end_ts <= now() AND entries > 0),
    'visitors', (SELECT visitors FROM uvis),
    'buyers', (SELECT buyers FROM uniq),
    'customers', (SELECT customers FROM uniq),
    'new_customers', (SELECT new_customers FROM uniq),
    'median', jsonb_build_object(
      'revenue', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY revenue) FROM per WHERE show_money),
      'tickets', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY tickets) FROM per),
      'aov', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY aov_n) FROM per WHERE aov_n IS NOT NULL),
      'conversion', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY conv_n) FROM per WHERE conv_n IS NOT NULL),
      'attendance', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY att_n) FROM per WHERE att_n IS NOT NULL),
      'new_share', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY new_n) FROM per WHERE new_n IS NOT NULL),
      'fill', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fill_n) FROM per WHERE fill_n IS NOT NULL),
      'entries', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY entries) FROM per WHERE end_ts <= now() AND entries > 0)
    ),
    'per_night', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', per.event_id, 'title', n.title, 'start_at', n.start_at, 'end_at', n.end_ts, 'night', n.night, 'poster', n.poster,
        'money', per.show_money, 'revenue', round(per.revenue, 2), 'tickets', per.tickets, 'tables', n.tables, 'gl', n.gl_registered,
        'cap', per.cap, 'orders', per.orders,
        'entries', per.entries, 'expected', per.expected, 'scanned', (per.end_ts <= now() AND per.entries > 0),
        'visitors', per.visitors, 'buyers', per.buyers, 'customers', per.customers, 'new_customers', per.new_customers,
        'aov', round(per.aov_n::numeric, 2), 'conversion', round(per.conv_n::numeric, 1),
        'attendance', round(per.att_n::numeric, 1), 'new_share', round(per.new_n::numeric, 1), 'fill', round(per.fill_n::numeric, 1)
      ) ORDER BY n.start_at)
      FROM per JOIN n ON n.event_id = per.event_id
    ), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public._an3_aggregate(uuid[], text, boolean, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._an3_aggregate(uuid[], text, boolean, uuid[]) TO service_role;

-- Cumul J-n par soirée : `d` = nuits calendaires avant la soirée (fuseau de la
-- soirée), de `p_days` à 0 ; une vente faite pendant ou après la nuit compte à
-- d = 0. Une ligne par (soirée, d), même sans vente ce jour-là.
CREATE OR REPLACE FUNCTION public._an3_curve(p_ids uuid[], p_venue_id text, p_money boolean, p_days integer DEFAULT 30)
RETURNS TABLE (event_id uuid, d integer, revenue numeric, tickets integer, heads integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.id, public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris')) AS night,
           coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz,
           (p_money AND (p_venue_id IS NULL OR e.venue_id = p_venue_id)) AS show_money
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = ANY(coalesce(p_ids, '{}'))
  ),
  sales AS (
    SELECT p.event_id,
           greatest(0, least(p_days, ev.night - public.night_date(p.at_ts, ev.tz))) AS d,
           CASE WHEN ev.show_money THEN p.amount ELSE 0 END AS amount,
           CASE WHEN p.pillar = 'tickets' THEN p.units ELSE 0 END AS tickets,
           CASE WHEN p.pillar = 'tickets' THEN p.units WHEN p.pillar = 'guest_list' THEN 1 ELSE 0 END AS heads
      FROM public._an3_people(coalesce(p_ids, '{}'), p_venue_id) p
      JOIN ev ON ev.id = p.event_id
  ),
  grid AS (
    SELECT ev.id AS event_id, g.d FROM ev CROSS JOIN generate_series(p_days, 0, -1) AS g(d)
  ),
  daily AS (
    SELECT g.event_id, g.d,
           coalesce(sum(s.amount), 0) AS amount, coalesce(sum(s.tickets), 0)::int AS tickets, coalesce(sum(s.heads), 0)::int AS heads
      FROM grid g LEFT JOIN sales s ON s.event_id = g.event_id AND s.d = g.d
     GROUP BY g.event_id, g.d
  )
  SELECT daily.event_id, daily.d,
         round(sum(daily.amount) OVER (PARTITION BY daily.event_id ORDER BY daily.d DESC), 2),
         sum(daily.tickets) OVER (PARTITION BY daily.event_id ORDER BY daily.d DESC)::int,
         sum(daily.heads) OVER (PARTITION BY daily.event_id ORDER BY daily.d DESC)::int
    FROM daily
$$;
REVOKE ALL ON FUNCTION public._an3_curve(uuid[], text, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._an3_curve(uuid[], text, boolean, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_analytics_overview(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_compare text DEFAULT 'comparable')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g            record;
  v_now        timestamptz := now();
  v_cur        uuid[] := '{}';
  v_ref        uuid[] := '{}';
  v_ref_kind   text := 'none';
  v_comparable boolean;
  v_from       timestamptz;
  v_to         timestamptz;
  v_rfrom      timestamptz;
  v_rto        timestamptz;
  v_event      record;
  v_status     text;
  v_cur_agg    jsonb;
  v_ref_agg    jsonb;
  v_use_median boolean := false;
  v_series     jsonb := '[]'::jsonb;
  v_nights     jsonb := '[]'::jsonb;
  v_night_refs uuid[] := '{}';
  v_breakdowns jsonb;
  v_subject    jsonb;
  v_compare    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  -- ── Sujet ────────────────────────────────────────────────────────────────
  IF p_event_id IS NOT NULL THEN
    IF NOT (p_event_id = ANY(g.scope_ids)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
    SELECT e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           coalesce(nullif(e.timezone, ''), g.tz) AS tz, coalesce(e.poster_url, e.image_url) AS poster
      INTO v_event FROM public.events e WHERE e.id = p_event_id;
    v_cur := ARRAY[p_event_id];
    v_status := CASE WHEN v_event.end_ts <= v_now THEN 'past' WHEN v_event.start_at - interval '6 hours' <= v_now THEN 'live' ELSE 'upcoming' END;
    v_subject := jsonb_build_object('kind', 'event', 'event', jsonb_build_object(
      'id', v_event.id, 'title', v_event.title, 'start_at', v_event.start_at, 'end_at', v_event.end_ts, 'tz', v_event.tz,
      'status', v_status, 'poster', v_event.poster));

    IF p_compare = 'none' THEN
      v_ref := '{}';
    ELSIF p_compare = 'yoy' THEN
      SELECT coalesce(array_agg(x.id), '{}') INTO v_ref FROM (
        SELECT e.id FROM public.events e
         WHERE e.id = ANY(g.scope_ids) AND e.id <> p_event_id
           AND e.start_at BETWEEN v_event.start_at - interval '1 year' - interval '10 days'
                              AND v_event.start_at - interval '1 year' + interval '10 days'
         ORDER BY abs(extract(epoch FROM (e.start_at - (v_event.start_at - interval '1 year')))) LIMIT 1) x;
      v_ref_kind := CASE WHEN cardinality(v_ref) > 0 THEN 'yoy' ELSE 'none' END;
    ELSIF p_compare = 'median5' THEN
      SELECT coalesce(array_agg(c.event_id), '{}'), coalesce(bool_and(c.comparable), false)
        INTO v_ref, v_comparable FROM public._an3_comparables(p_event_id, g.scope_ids, 5) c;
      v_ref_kind := CASE WHEN cardinality(v_ref) = 0 THEN 'none' WHEN v_comparable THEN 'median' ELSE 'median_loose' END;
      v_use_median := true;
    ELSE
      SELECT coalesce(array_agg(c.event_id), '{}'), coalesce(bool_and(c.comparable), false)
        INTO v_ref, v_comparable FROM public._an3_comparables(p_event_id, g.scope_ids, 1) c;
      v_ref_kind := CASE WHEN cardinality(v_ref) = 0 THEN 'none' WHEN v_comparable AND p_compare <> 'previous' THEN 'comparable' ELSE 'previous' END;
    END IF;
  ELSE
    v_to := coalesce(p_to, v_now);
    v_from := coalesce(p_from, v_to - interval '30 days');
    IF v_from >= v_to THEN v_from := v_to - interval '30 days'; END IF;
    SELECT coalesce(array_agg(e.id), '{}') INTO v_cur
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = ANY(g.scope_ids) AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
       AND public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz))
           BETWEEN public.night_date(v_from, g.tz) AND public.night_date(v_to, g.tz);
    v_subject := jsonb_build_object('kind', 'period', 'from', v_from, 'to', v_to, 'tz', g.tz);

    IF p_compare = 'none' THEN
      v_ref := '{}';
    ELSE
      IF p_compare = 'yoy' THEN
        v_rfrom := v_from - interval '1 year'; v_rto := v_to - interval '1 year'; v_ref_kind := 'yoy';
      ELSE
        v_rto := v_from; v_rfrom := v_from - (v_to - v_from); v_ref_kind := 'previous_period';
      END IF;
      SELECT coalesce(array_agg(e.id), '{}') INTO v_ref
        FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
       WHERE e.id = ANY(g.scope_ids) AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
         AND public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, g.tz))
             BETWEEN public.night_date(v_rfrom, g.tz) AND public.night_date(v_rto, g.tz)
         AND coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now;
      IF cardinality(v_ref) = 0 THEN v_ref_kind := 'none'; END IF;
    END IF;
  END IF;

  -- ── Chiffres ─────────────────────────────────────────────────────────────
  v_cur_agg := public._an3_aggregate(v_cur, g.scope_venue, g.money, g.scope_ids);
  v_ref_agg := CASE WHEN cardinality(v_ref) > 0 THEN public._an3_aggregate(v_ref, g.scope_venue, g.money, g.scope_ids) ELSE NULL END;

  -- ── Séries (sparklines) ──────────────────────────────────────────────────
  IF p_event_id IS NOT NULL THEN
    -- Cumul J-n de la soirée et de la référence (médiane par d quand plusieurs).
    SELECT coalesce(jsonb_agg(jsonb_build_object('d', c.d, 'revenue', c.revenue, 'tickets', c.tickets,
             'ref_revenue', r.revenue, 'ref_tickets', r.tickets) ORDER BY c.d DESC), '[]'::jsonb)
      INTO v_series
      FROM public._an3_curve(v_cur, g.scope_venue, g.money, 30) c
      LEFT JOIN (
        SELECT x.d, percentile_cont(0.5) WITHIN GROUP (ORDER BY x.revenue) AS revenue,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY x.tickets) AS tickets
          FROM public._an3_curve(v_ref, g.scope_venue, g.money, 30) x GROUP BY x.d
      ) r ON r.d = c.d;
  END IF;

  -- ── Soirées de la période, chacune avec SA soirée comparable ─────────────
  IF p_event_id IS NULL AND cardinality(v_cur) > 0 THEN
    SELECT coalesce(array_agg(DISTINCT c.event_id), '{}') INTO v_night_refs
      FROM unnest(v_cur) AS u(id) CROSS JOIN LATERAL public._an3_comparables(u.id, g.scope_ids, 1) c;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', n.event_id, 'title', n.title, 'start_at', n.start_at, 'end_at', n.end_ts, 'night', n.night, 'poster', n.poster,
             'money', n.show_money, 'revenue', round(n.revenue, 2), 'tickets', n.tickets, 'tables', n.tables, 'gl', n.gl_registered,
             'cap', n.cap, 'entries', n.entries, 'expected', n.expected, 'scanned', (n.end_ts <= v_now AND n.entries > 0),
             'customers', n.customers,
             'ref', CASE WHEN r.event_id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', r.event_id, 'title', r.title, 'start_at', r.start_at, 'comparable', rc.comparable,
               'revenue', CASE WHEN r.show_money THEN round(r.revenue, 2) END, 'tickets', r.tickets, 'entries', r.entries) END
           ) ORDER BY n.start_at DESC), '[]'::jsonb)
      INTO v_nights
      FROM public._an3_nights(v_cur, g.scope_venue, g.money) n
      LEFT JOIN LATERAL (SELECT * FROM public._an3_comparables(n.event_id, g.scope_ids, 1) LIMIT 1) rc ON true
      LEFT JOIN public._an3_nights(v_night_refs, g.scope_venue, g.money) r ON r.event_id = rc.event_id;
  END IF;

  -- ── Breakdowns (barres horizontales) ─────────────────────────────────────
  SELECT jsonb_build_object(
    'rounds', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', x.name, 'price', x.price, 'qty', x.qty, 'revenue', x.amount, 'cap', x.cap, 'rounds', x.rounds) ORDER BY x.qty DESC)
        FROM (
          SELECT tr.name, min(tr.price) AS price, count(DISTINCT tr.id)::int AS rounds,
                 nullif(sum(nullif(tr.max_tickets, 0)), 0)::int AS cap,
                 sum(greatest(coalesce(t.quantity, 1), 1))::int AS qty,
                 CASE WHEN g.money THEN round(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                      - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 2) END AS amount
            FROM public.tickets t JOIN public.ticket_rounds tr ON tr.id = t.ticket_round_id
           WHERE t.event_id = ANY(v_cur) AND t.status IN ('paid', 'used')
           GROUP BY tr.name) x
    ), '[]'::jsonb),
    'promoters', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'name', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
               'tickets', x.tickets, 'orders', x.orders, 'revenue', x.amount) ORDER BY coalesce(x.amount, 0) DESC, x.tickets DESC)
        FROM (
          SELECT pc.promoter_id,
                 count(*)::int AS orders,
                 sum(CASE WHEN pc.ticket_id IS NOT NULL THEN greatest(coalesce(t.quantity, 1), 1) ELSE 0 END)::int AS tickets,
                 CASE WHEN g.money THEN round(sum(coalesce(pc.amount, 0)), 2) END AS amount
            FROM public.promoter_conversions pc
            LEFT JOIN public.tickets t ON t.id = pc.ticket_id
           WHERE pc.event_id = ANY(v_cur) AND pc.status IS DISTINCT FROM 'cancelled'
           GROUP BY pc.promoter_id) x
        JOIN public.promoters pr ON pr.id = x.promoter_id
    ), '[]'::jsonb),
    'sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', s.source, 'orders', s.orders, 'revenue', s.amount) ORDER BY s.orders DESC)
        FROM (
          SELECT x.source, count(*)::int AS orders,
                 CASE WHEN g.money THEN round(sum(x.amount), 2) END AS amount
            FROM (
              SELECT CASE WHEN tl.promoter_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.promoter_conversions pc WHERE pc.ticket_id = t.id) THEN 'promoter'
                          WHEN nullif(tl.utm_source, '') IS NOT NULL THEN lower(tl.utm_source)
                          WHEN tl.id IS NOT NULL THEN coalesce(nullif(tl.utm_medium, ''), 'link')
                          WHEN t.promo_code_id IS NOT NULL THEN 'promo_code'
                          ELSE coalesce(nullif(t.purchase_source, ''), 'direct') END AS source,
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                       - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) AS amount
                FROM public.tickets t LEFT JOIN public.tracked_links tl ON tl.id = t.tracked_link_id
               WHERE t.event_id = ANY(v_cur) AND t.status IN ('paid', 'used')) x
           GROUP BY x.source) s
    ), '[]'::jsonb)
  ) INTO v_breakdowns;

  v_compare := jsonb_build_object(
    'mode', p_compare, 'kind', v_ref_kind, 'n', cardinality(v_ref), 'median', v_use_median,
    'ref_event', CASE WHEN p_event_id IS NOT NULL AND cardinality(v_ref) = 1 THEN
      (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = v_ref[1]) END,
    'ref_from', v_rfrom, 'ref_to', v_rto);

  RETURN jsonb_build_object(
    'ok', true, 'money', g.money, 'tz', g.tz, 'now', v_now,
    'subject', v_subject, 'compare', v_compare,
    'current', v_cur_agg, 'reference', v_ref_agg,
    'series', v_series, 'nights', v_nights, 'breakdowns', v_breakdowns);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_overview(text, uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_overview(text, uuid, uuid, timestamptz, timestamptz, text) TO authenticated;

-- ── Pacing J-n d'une soirée ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_pacing(p_event_id uuid, p_compare text DEFAULT 'median5', p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g          record;
  v_now      timestamptz := now();
  v_event    record;
  v_ref      uuid[] := '{}';
  v_comparable boolean := false;
  v_today_d  integer;
  v_days     integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_curve    jsonb;
  v_refs     jsonb;
  v_status   text := 'unknown';
  v_cur_at_d integer;
  v_ref_at_d numeric;
  v_ref_final numeric;
  v_forecast jsonb := NULL;
  v_markers  jsonb;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
         coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz, e.published_at, e.max_tickets,
         public.night_date(e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris')) AS night
    INTO v_event FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = p_event_id;

  -- d d'aujourd'hui : nuits pleines restantes avant la soirée (0 le jour J et après).
  v_today_d := greatest(0, least(v_days, v_event.night - public.night_date(v_now, v_event.tz)));

  IF p_compare = 'none' THEN
    v_ref := '{}';
  ELSIF p_compare = 'yoy' THEN
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ref FROM (
      SELECT e.id FROM public.events e
       WHERE e.id = ANY(g.scope_ids) AND e.id <> p_event_id
         AND e.start_at BETWEEN v_event.start_at - interval '1 year' - interval '10 days' AND v_event.start_at - interval '1 year' + interval '10 days'
       ORDER BY abs(extract(epoch FROM (e.start_at - (v_event.start_at - interval '1 year')))) LIMIT 1) x;
    v_comparable := false;
  ELSE
    SELECT coalesce(array_agg(c.event_id), '{}'), coalesce(bool_and(c.comparable), false)
      INTO v_ref, v_comparable
      FROM public._an3_comparables(p_event_id, g.scope_ids, CASE WHEN p_compare IN ('comparable', 'previous') THEN 1 ELSE 5 END) c;
  END IF;

  -- La courbe de la soirée, arrêtée à aujourd'hui (les jours à venir restent NULL).
  SELECT coalesce(jsonb_agg(jsonb_build_object('d', c.d,
           'revenue', CASE WHEN c.d >= v_today_d THEN c.revenue END,
           'tickets', CASE WHEN c.d >= v_today_d THEN c.tickets END,
           'heads', CASE WHEN c.d >= v_today_d THEN c.heads END) ORDER BY c.d DESC), '[]'::jsonb)
    INTO v_curve FROM public._an3_curve(ARRAY[p_event_id], g.scope_venue, g.money, v_days) c;

  -- Les comparables : médiane, min et max par d.
  SELECT coalesce(jsonb_agg(jsonb_build_object('d', x.d,
           'tickets_med', x.t_med, 'tickets_min', x.t_min, 'tickets_max', x.t_max,
           'revenue_med', x.r_med, 'revenue_min', x.r_min, 'revenue_max', x.r_max,
           'heads_med', x.h_med) ORDER BY x.d DESC), '[]'::jsonb)
    INTO v_refs
    FROM (
      SELECT c.d,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY c.tickets) AS t_med, min(c.tickets) AS t_min, max(c.tickets) AS t_max,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY c.revenue) AS r_med, min(c.revenue) AS r_min, max(c.revenue) AS r_max,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY c.heads) AS h_med
        FROM public._an3_curve(v_ref, g.scope_venue, g.money, v_days) c GROUP BY c.d) x;

  -- Statut à aujourd'hui : billets cumulés vs médiane des comparables au même d.
  SELECT c.tickets INTO v_cur_at_d FROM public._an3_curve(ARRAY[p_event_id], g.scope_venue, g.money, v_days) c WHERE c.d = v_today_d;
  SELECT (x ->> 'tickets_med')::numeric INTO v_ref_at_d FROM jsonb_array_elements(v_refs) x WHERE (x ->> 'd')::int = v_today_d;
  SELECT (x ->> 'tickets_med')::numeric INTO v_ref_final FROM jsonb_array_elements(v_refs) x WHERE (x ->> 'd')::int = 0;
  IF cardinality(v_ref) > 0 AND v_ref_at_d IS NOT NULL AND v_ref_at_d > 0 THEN
    v_status := CASE WHEN v_cur_at_d >= 0.95 * v_ref_at_d THEN 'good'
                     WHEN v_cur_at_d >= 0.80 * v_ref_at_d THEN 'warn'
                     ELSE 'bad' END;
    -- Projection de fin = cumul ÷ part médiane vendue à J-n (fourchette sur min/max).
    IF v_ref_final > 0 AND v_today_d > 0 THEN
      v_forecast := (
        SELECT jsonb_build_object(
          'tickets', round(v_cur_at_d / nullif((x ->> 'tickets_med')::numeric / v_ref_final, 0)),
          'tickets_low', round(v_cur_at_d / nullif((x ->> 'tickets_max')::numeric / nullif((SELECT max((y ->> 'tickets_max')::numeric) FROM jsonb_array_elements(v_refs) y WHERE (y ->> 'd')::int = 0), 0), 0)),
          'tickets_high', round(v_cur_at_d / nullif((x ->> 'tickets_min')::numeric / nullif((SELECT max((y ->> 'tickets_min')::numeric) FROM jsonb_array_elements(v_refs) y WHERE (y ->> 'd')::int = 0), 0), 0)),
          'share_sold_at_d', round(100.0 * (x ->> 'tickets_med')::numeric / v_ref_final, 1))
          FROM jsonb_array_elements(v_refs) x WHERE (x ->> 'd')::int = v_today_d);
    END IF;
  ELSIF cardinality(v_ref) > 0 AND v_today_d > 0 THEN
    v_status := 'no_reference_yet';
  END IF;

  -- Repères : publication, premier billet de chaque palier après le premier, emails et push de la soirée.
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'd', m.d, 'at', m.at_ts, 'label', m.label) ORDER BY m.at_ts), '[]'::jsonb)
    INTO v_markers
    FROM (
      SELECT 'published'::text AS kind, v_event.published_at AS at_ts, NULL::text AS label,
             greatest(0, least(v_days, v_event.night - public.night_date(v_event.published_at, v_event.tz))) AS d
       WHERE v_event.published_at IS NOT NULL
      UNION ALL
      SELECT 'tier', x.first_at, x.name, greatest(0, least(v_days, v_event.night - public.night_date(x.first_at, v_event.tz)))
        FROM (
          SELECT tr.name, tr.position, min(coalesce(t.paid_at, t.created_at)) AS first_at
            FROM public.ticket_rounds tr JOIN public.tickets t ON t.ticket_round_id = tr.id AND t.status IN ('paid', 'used')
           WHERE tr.event_id = p_event_id GROUP BY tr.id, tr.name, tr.position) x
       WHERE x.position > (SELECT min(tr2.position) FROM public.ticket_rounds tr2 WHERE tr2.event_id = p_event_id)
      UNION ALL
      SELECT 'email', c.sent_at, c.name, greatest(0, least(v_days, v_event.night - public.night_date(c.sent_at, v_event.tz)))
        FROM public.email_campaigns c
       WHERE c.sent_at IS NOT NULL AND (c.event_id = p_event_id OR c.automation_trigger_event_id = p_event_id)
         AND ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
      UNION ALL
      SELECT 'push', coalesce(pc.scheduled_at, pc.created_at), pc.title, greatest(0, least(v_days, v_event.night - public.night_date(coalesce(pc.scheduled_at, pc.created_at), v_event.tz)))
        FROM public.push_campaigns pc
       WHERE pc.event_id = p_event_id AND pc.status IN ('sent', 'completed', 'done')
         AND ((g.scope_venue IS NOT NULL AND pc.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND pc.organizer_user_id = g.scope_org))
    ) m;

  RETURN jsonb_build_object(
    'ok', true, 'money', g.money,
    'event', jsonb_build_object('id', v_event.id, 'title', v_event.title, 'start_at', v_event.start_at, 'end_at', v_event.end_ts,
                                'tz', v_event.tz, 'night', v_event.night, 'cap', nullif(v_event.max_tickets, 0),
                                'status', CASE WHEN v_event.end_ts <= v_now THEN 'past' WHEN v_event.start_at - interval '6 hours' <= v_now THEN 'live' ELSE 'upcoming' END),
    'days', v_days, 'today_d', v_today_d,
    'compare', jsonb_build_object('mode', p_compare, 'n', cardinality(v_ref), 'comparable', v_comparable,
      'refs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) ORDER BY e.start_at DESC), '[]'::jsonb)
                 FROM public.events e WHERE e.id = ANY(v_ref))),
    'curve', v_curve, 'reference', v_refs,
    'status', v_status, 'at_d', jsonb_build_object('tickets', v_cur_at_d, 'ref_tickets', v_ref_at_d, 'ref_final', v_ref_final),
    'forecast', v_forecast, 'markers', v_markers);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_pacing(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_pacing(uuid, text, integer) TO authenticated;
