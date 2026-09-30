-- Analytics v3 — socle commun (plan docs/designs/ANALYTICS_REBUILD_PLAN.md, phase 1).
--
-- Trois briques que toutes les RPC `get_analytics_*` partagent :
--   • night_date(ts, tz)      : la « nuit » d'un horodatage, 12:00 → 11:59 le lendemain.
--   • _an3_nights(...)        : UNE ligne par soirée avec ses chiffres (formules de
--                               fees.ts, statuts de la compta, remboursements déduits,
--                               entrées par _door_headcount). Toute RPC v3 lit ses
--                               soirées ICI, jamais dans une formule à elle.
--   • _an3_comparables(...)   : les soirées COMPARABLES d'une soirée (même jour de
--                               semaine, même série ou même type), les 5 dernières.
--   • _an3_people(...)        : une ligne par (soirée, email) : qui est venu, pour
--                               les nouveaux / habitués et les clients uniques.
-- Helpers `_an3_*` : service_role seul (appelés par les RPC SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.night_date(p_ts timestamptz, p_tz text DEFAULT 'Europe/Paris')
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ((p_ts AT TIME ZONE coalesce(nullif(p_tz, ''), 'Europe/Paris')) - interval '12 hours')::date
$$;
REVOKE ALL ON FUNCTION public.night_date(timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.night_date(timestamptz, text) TO authenticated, service_role;

-- Une ligne par soirée. `p_venue_id` non NULL = portée club : l'argent ne se
-- montre que sur les soirées que le club PORTE (venue_id = club), jamais sur
-- celles qu'il accueille ; le bar n'existe qu'en portée club.
CREATE OR REPLACE FUNCTION public._an3_nights(p_event_ids uuid[], p_venue_id text, p_money boolean)
RETURNS TABLE (
  event_id uuid, title text, start_at timestamptz, end_ts timestamptz, tz text, night date,
  poster text, weekday integer, format_key text, cap integer, show_money boolean,
  tickets integer, ticket_orders integer, tables integer, table_guests integer, tables_arrived integer,
  bar_orders integer, gl_registered integer, gl_entered integer,
  entries integer, expected integer,
  rev_tickets numeric, rev_tables numeric, rev_bar numeric, revenue numeric, refunds numeric,
  deposits numeric, customers integer, first_sale_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.id, e.title, e.start_at,
           coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts,
           coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz,
           coalesce(e.poster_url, e.image_url) AS poster,
           e.max_tickets, e.venue_id, e.recurring_template_id, e.event_type,
           (p_money AND (p_venue_id IS NULL OR e.venue_id = p_venue_id)) AS show_money
      FROM public.events e
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = ANY(p_event_ids)
  ),
  tk AS (
    SELECT t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1))::int AS sold,
           count(*)::int AS orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS amount,
           sum(least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS refunds,
           min(coalesce(t.paid_at, t.created_at)) AS first_at
      FROM public.tickets t
     WHERE t.event_id = ANY(p_event_ids) AND t.status IN ('paid', 'used')
     GROUP BY t.event_id
  ),
  tb AS (
    SELECT r.event_id,
           count(*)::int AS booked,
           sum(greatest(coalesce(r.guest_count, 0), 0))::int AS guests,
           count(*) FILTER (WHERE coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)::int AS arrived,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0)
                        - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0)
                                - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS amount,
           sum(least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0)
                              - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS refunds,
           sum(CASE WHEN coalesce(r.payment_mode, 'online') <> 'on_site' THEN greatest(coalesce(r.deposit, 0), 0) ELSE 0 END) AS deposits,
           min(coalesce(r.paid_at, r.created_at)) AS first_at
      FROM public.table_reservations r
     WHERE r.event_id = ANY(p_event_ids) AND r.status IN ('paid', 'confirmed')
     GROUP BY r.event_id
  ),
  dr AS (
    SELECT o.event_id,
           count(*)::int AS orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS amount,
           sum(least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS refunds
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.event_id = ANY(p_event_ids) AND o.status IN ('paid', 'served')
     GROUP BY o.event_id
  ),
  gl AS (
    SELECT g.event_id,
           count(*)::int AS registered,
           count(*) FILTER (WHERE coalesce(x.entry_scanned, false))::int AS entered
      FROM public.guest_list_entries x
      JOIN public.guest_lists g ON g.id = x.guest_list_id
     WHERE g.event_id = ANY(p_event_ids) AND x.status IS DISTINCT FROM 'cancelled'
     GROUP BY g.event_id
  ),
  people AS (
    SELECT p.event_id, count(DISTINCT p.email)::int AS n
      FROM (
        SELECT t.event_id, lower(trim(t.user_email)) AS email FROM public.tickets t
         WHERE t.event_id = ANY(p_event_ids) AND t.status IN ('paid', 'used')
        UNION ALL
        SELECT r.event_id, lower(trim(r.user_email)) FROM public.table_reservations r
         WHERE r.event_id = ANY(p_event_ids) AND r.status IN ('paid', 'confirmed')
        UNION ALL
        SELECT o.event_id, lower(trim(o.user_email)) FROM public.orders o
         WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
           AND o.event_id = ANY(p_event_ids) AND o.status IN ('paid', 'served')
        UNION ALL
        SELECT g.event_id, lower(trim(x.email)) FROM public.guest_list_entries x
          JOIN public.guest_lists g ON g.id = x.guest_list_id
         WHERE g.event_id = ANY(p_event_ids) AND x.status IS DISTINCT FROM 'cancelled'
      ) p
     WHERE nullif(p.email, '') IS NOT NULL
     GROUP BY p.event_id
  ),
  caps AS (
    SELECT ev.id AS event_id,
           CASE WHEN coalesce(ev.max_tickets, 0) > 0 THEN ev.max_tickets
                WHEN EXISTS (SELECT 1 FROM public.ticket_rounds tr WHERE tr.event_id = ev.id)
                 AND NOT EXISTS (SELECT 1 FROM public.ticket_rounds tr WHERE tr.event_id = ev.id AND coalesce(tr.max_tickets, 0) <= 0)
                  THEN (SELECT sum(tr.max_tickets)::int FROM public.ticket_rounds tr WHERE tr.event_id = ev.id)
                ELSE NULL END AS cap
      FROM ev
  )
  SELECT ev.id, ev.title, ev.start_at, ev.end_ts, ev.tz,
         public.night_date(ev.start_at, ev.tz),
         ev.poster,
         extract(isodow FROM (ev.start_at AT TIME ZONE ev.tz))::int,
         coalesce('tpl:' || ev.recurring_template_id::text, 'type:' || coalesce(ev.event_type, 'club')),
         caps.cap, ev.show_money,
         coalesce(tk.sold, 0), coalesce(tk.orders, 0),
         coalesce(tb.booked, 0), coalesce(tb.guests, 0), coalesce(tb.arrived, 0),
         coalesce(dr.orders, 0),
         coalesce(gl.registered, 0), coalesce(gl.entered, 0),
         coalesce((h.j ->> 'entered')::int, 0), coalesce((h.j ->> 'expected')::int, 0),
         CASE WHEN ev.show_money THEN coalesce(tk.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tb.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(dr.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tk.amount, 0) + coalesce(tb.amount, 0) + coalesce(dr.amount, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tk.refunds, 0) + coalesce(tb.refunds, 0) + coalesce(dr.refunds, 0) ELSE 0 END,
         CASE WHEN ev.show_money THEN coalesce(tb.deposits, 0) ELSE 0 END,
         coalesce(people.n, 0),
         least(tk.first_at, tb.first_at)
    FROM ev
    LEFT JOIN tk ON tk.event_id = ev.id
    LEFT JOIN tb ON tb.event_id = ev.id
    LEFT JOIN dr ON dr.event_id = ev.id
    LEFT JOIN gl ON gl.event_id = ev.id
    LEFT JOIN people ON people.event_id = ev.id
    LEFT JOIN caps ON caps.event_id = ev.id
    LEFT JOIN LATERAL (SELECT public._door_headcount(ARRAY[ev.id]) AS j) h ON true
$$;
REVOKE ALL ON FUNCTION public._an3_nights(uuid[], text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._an3_nights(uuid[], text, boolean) TO service_role;

-- Les soirées comparables d'une soirée : terminées, antérieures, même jour de
-- semaine (fuseau de la soirée) et même série récurrente si elle en a une,
-- sinon même type. Les `p_limit` dernières. `comparable = false` quand il a
-- fallu se rabattre sur les dernières soirées, quelles qu'elles soient.
CREATE OR REPLACE FUNCTION public._an3_comparables(p_event_id uuid, p_scope_ids uuid[], p_limit integer DEFAULT 5)
RETURNS TABLE (event_id uuid, rank integer, comparable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH target AS (
    SELECT e.id, e.start_at, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz,
           e.recurring_template_id, coalesce(e.event_type, 'club') AS event_type
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = p_event_id
  ),
  cands AS (
    SELECT e.id, e.start_at,
           (extract(isodow FROM (e.start_at AT TIME ZONE t.tz)) = extract(isodow FROM (t.start_at AT TIME ZONE t.tz))
            AND CASE WHEN t.recurring_template_id IS NOT NULL THEN e.recurring_template_id = t.recurring_template_id
                     ELSE coalesce(e.event_type, 'club') = t.event_type END) AS comparable
      FROM public.events e CROSS JOIN target t
     WHERE e.id = ANY(p_scope_ids) AND e.id <> t.id
       AND e.start_at < t.start_at
       AND coalesce(e.end_at, e.start_at + interval '8 hours') <= now()
       AND e.cancelled_at IS NULL AND coalesce(e.status, 'active') <> 'cancelled'
  ),
  strict AS (
    SELECT c.id, row_number() OVER (ORDER BY c.start_at DESC)::int AS rn FROM cands c WHERE c.comparable
  ),
  loose AS (
    SELECT c.id, row_number() OVER (ORDER BY c.start_at DESC)::int AS rn FROM cands c
  )
  SELECT s.id, s.rn, true FROM strict s WHERE s.rn <= greatest(p_limit, 1)
  UNION ALL
  SELECT l.id, l.rn, false FROM loose l
   WHERE l.rn <= greatest(p_limit, 1) AND NOT EXISTS (SELECT 1 FROM strict)
$$;
REVOKE ALL ON FUNCTION public._an3_comparables(uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._an3_comparables(uuid, uuid[], integer) TO service_role;

-- Qui est venu à quelle soirée : une ligne par (soirée, email), avec la date de
-- la première vente / inscription de cette personne dans la PORTÉE (toutes les
-- soirées de `p_scope_ids`) — c'est ce qui dit « nouveau » ou « habitué ».
CREATE OR REPLACE FUNCTION public._an3_people(p_scope_ids uuid[], p_venue_id text)
RETURNS TABLE (event_id uuid, email text, user_id uuid, at_ts timestamptz, pillar text, units integer, amount numeric, first_seen timestamptz, first_event uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH sale_rows AS (
    SELECT t.event_id, lower(trim(t.user_email)) AS email, t.user_id, coalesce(t.paid_at, t.created_at) AS at_ts, 'tickets'::text AS pillar, greatest(coalesce(t.quantity, 1), 1)::int AS units,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id = ANY(p_scope_ids) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT r.event_id, lower(trim(r.user_email)), r.user_id, coalesce(r.paid_at, r.created_at), 'tables', 1,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id = ANY(p_scope_ids) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT o.event_id, lower(trim(o.user_email)), o.user_id, coalesce(o.paid_at, o.created_at), 'drinks', 0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id AND o.event_id = ANY(p_scope_ids) AND o.status IN ('paid', 'served')
    UNION ALL
    SELECT g.event_id, lower(trim(x.email)), x.user_id, x.created_at, 'guest_list', 1, 0
      FROM public.guest_list_entries x JOIN public.guest_lists g ON g.id = x.guest_list_id
     WHERE g.event_id = ANY(p_scope_ids) AND x.status IS DISTINCT FROM 'cancelled'
  ),
  firsts AS (
    SELECT r.email, min(r.at_ts) AS first_seen,
           (array_agg(r.event_id ORDER BY r.at_ts ASC))[1] AS first_event
      FROM sale_rows r WHERE nullif(r.email, '') IS NOT NULL GROUP BY r.email
  )
  SELECT r.event_id, r.email, r.user_id, r.at_ts, r.pillar, r.units, r.amount, f.first_seen, f.first_event
    FROM sale_rows r JOIN firsts f ON f.email = r.email
   WHERE nullif(r.email, '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public._an3_people(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._an3_people(uuid[], text) TO service_role;
