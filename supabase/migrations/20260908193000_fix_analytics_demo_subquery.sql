-- `/admin/analytics` levait `operator does not exist: text = text[]`.
--
-- Introduit par `20260908180000` : dans les compteurs de croissance j'avais
-- écrit `v.id = ANY ((SELECT dv FROM d))`. Une sous-requête entre parenthèses
-- est lue par Postgres comme la forme ENSEMBLISTE de ANY — il compare donc un
-- `text` à des lignes de type `text[]`. Les trois branches du CTE `tx` étaient
-- correctes (elles reçoivent le tableau par CROSS JOIN), seuls `new_venues` et
-- `new_events` étaient touchés.
--
-- Rien ne l'a signalé au push : plpgsql ne prépare ses requêtes qu'au premier
-- appel réel. C'est `supabase db lint --linked` qui l'a sorti.
--
-- Correctif : passer par EXISTS sur le CTE d'une ligne, sans ambiguïté de forme.
CREATE OR REPLACE FUNCTION public.admin_platform_analytics(
  p_from timestamptz, p_to timestamptz, p_venue_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$



DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH d AS MATERIALIZED (
    -- Une seule évaluation de la porte démo pour toute la requête : dans un
    -- WHERE, ces fonctions STABLE sont rappelées par ligne (32 s mesurées).
    SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de
  ),
  tx AS (
    -- Une ligne par transaction payée dans la période, avec décomposition fees.
    SELECT o.created_at, 'drinks'::text AS kind, o.venue_id, o.event_id,
      o.total::numeric AS charged,
      (o.total::numeric - COALESCE(o.service_fee, 0)::numeric) AS club_gross,
      COALESCE(o.service_fee, 0)::numeric AS yuno_fee,
      COALESCE(o.refund_amount, 0)::numeric AS refunded,
      (o.refunded_at IS NOT NULL) AS has_refund,
      1 AS qty
    FROM orders o
    CROSS JOIN d
    WHERE o.status IN ('paid', 'served', 'refunded')
      AND o.created_at >= p_from AND o.created_at <= p_to
      AND (p_venue_id IS NULL OR o.venue_id = p_venue_id)
      AND (o.status <> 'refunded' OR o.refunded_at IS NOT NULL)
      AND NOT COALESCE(o.venue_id = ANY (d.dv), false)
      AND NOT public.is_demo_email(o.user_email)
    UNION ALL
    SELECT t.created_at, 'tickets', COALESCE(e.venue_id, e.partner_venue_id), t.event_id,
      t.total_price::numeric,
      (t.total_price::numeric - COALESCE(t.service_fee, 0)::numeric - COALESCE(t.insurance_fee, 0)::numeric),
      COALESCE(t.service_fee, 0)::numeric + COALESCE(t.insurance_fee, 0)::numeric,
      COALESCE(t.refund_amount, 0)::numeric,
      (t.refunded_at IS NOT NULL),
      COALESCE(t.quantity, 1)
    FROM tickets t CROSS JOIN d LEFT JOIN events e ON e.id = t.event_id
    WHERE t.paid_at IS NOT NULL
      AND t.created_at >= p_from AND t.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
      AND NOT COALESCE(t.event_id = ANY (d.de), false)
      AND NOT public.is_demo_email(t.user_email)
    UNION ALL
    SELECT tr.created_at, 'tables', COALESCE(e.venue_id, e.partner_venue_id), tr.event_id,
      tr.total_price::numeric,
      (tr.total_price::numeric - COALESCE(tr.service_fee, 0)::numeric - COALESCE(tr.management_fee, 0)::numeric),
      COALESCE(tr.service_fee, 0)::numeric + COALESCE(tr.management_fee, 0)::numeric,
      COALESCE(tr.refund_amount, 0)::numeric,
      (tr.refunded_at IS NOT NULL),
      1
    FROM table_reservations tr CROSS JOIN d LEFT JOIN events e ON e.id = tr.event_id
    WHERE tr.paid_at IS NOT NULL
      AND tr.created_at >= p_from AND tr.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
      AND NOT COALESCE(tr.event_id = ANY (d.de), false)
      AND NOT public.is_demo_email(tr.user_email)
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') gs(d)
  ),
  by_day AS (
    SELECT days.d,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'drinks'), 0) AS drinks,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'tickets'), 0) AS tickets,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'tables'), 0) AS tables,
      COALESCE(sum(tx.yuno_fee), 0) AS yuno,
      COALESCE(sum(tx.refunded), 0) AS refunds,
      count(tx.*) FILTER (WHERE tx.kind = 'drinks') AS drink_n,
      count(tx.*) FILTER (WHERE tx.kind = 'tickets') AS ticket_n,
      count(tx.*) FILTER (WHERE tx.kind = 'tables') AS table_n
    FROM days LEFT JOIN tx ON date(tx.created_at) = days.d
    GROUP BY days.d ORDER BY days.d
  ),
  new_users AS (
    -- Tous les nouveaux comptes (profile_type ne distingue que club/organizer,
    -- il n'existe pas de valeur 'customer' — un client = un profil sans rôle pro).
    SELECT days.d, count(p.id) AS n
    FROM days LEFT JOIN profiles p
      ON date(p.created_at) = days.d
     AND NOT public.is_demo_email(p.email)
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
    GROUP BY days.d ORDER BY days.d
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'gmv', round(COALESCE(sum(charged), 0), 2),
        'club_revenue', round(COALESCE(sum(club_gross), 0), 2),
        'yuno_revenue', round(COALESCE(sum(yuno_fee), 0), 2),
        'refunds_total', round(COALESCE(sum(refunded), 0), 2),
        'refunds_count', count(*) FILTER (WHERE has_refund),
        'tx_count', count(*),
        'tickets_qty', COALESCE(sum(qty) FILTER (WHERE kind = 'tickets'), 0),
        'ticket_sales', count(*) FILTER (WHERE kind = 'tickets'),
        'tables_booked', count(*) FILTER (WHERE kind = 'tables'),
        'drink_orders', count(*) FILTER (WHERE kind = 'drinks'),
        'avg_order', CASE WHEN count(*) > 0 THEN round(sum(charged) / count(*), 2) ELSE 0 END,
        'take_rate', CASE WHEN COALESCE(sum(charged), 0) > 0
          THEN round(sum(yuno_fee) / sum(charged) * 100, 2) ELSE 0 END
      ) FROM tx
    ),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'd', to_char(d, 'YYYY-MM-DD'),
      'drinks', round(drinks, 2), 'tickets', round(tickets, 2), 'tables', round(tables, 2),
      'total', round(drinks + tickets + tables, 2),
      'yuno', round(yuno, 2), 'refunds', round(refunds, 2),
      'drink_n', drink_n, 'ticket_n', ticket_n, 'table_n', table_n
    )) FROM by_day), '[]'::jsonb),
    'top_venues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.venue_id, 'name', COALESCE(v.name, s.venue_id), 'city', v.city,
        'revenue', round(s.revenue, 2), 'yuno', round(s.yuno, 2), 'tx', s.tx
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT venue_id, sum(club_gross) AS revenue, sum(yuno_fee) AS yuno, count(*) AS tx
        FROM tx WHERE venue_id IS NOT NULL
        GROUP BY venue_id ORDER BY sum(club_gross) DESC LIMIT 10
      ) s LEFT JOIN venues v ON v.id = s.venue_id
    ), '[]'::jsonb),
    'top_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.event_id, 'title', COALESCE(e.title, s.event_id::text),
        'venue_name', COALESCE(v.name, e.venue_id), 'start_at', e.start_at,
        'revenue', round(s.revenue, 2), 'tickets', s.tickets, 'tables', s.tables
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT event_id, sum(club_gross) AS revenue,
          COALESCE(sum(qty) FILTER (WHERE kind = 'tickets'), 0) AS tickets,
          count(*) FILTER (WHERE kind = 'tables') AS tables
        FROM tx WHERE event_id IS NOT NULL
        GROUP BY event_id ORDER BY sum(club_gross) DESC LIMIT 10
      ) s
      LEFT JOIN events e ON e.id = s.event_id
      LEFT JOIN venues v ON v.id = e.venue_id
    ), '[]'::jsonb),
    'top_organizers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.organizer_user_id,
        'name', COALESCE(op.display_name, 'Organizer'),
        'revenue', round(s.revenue, 2), 'events_count', s.events_count
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT e.organizer_user_id, sum(t.club_gross) AS revenue, count(DISTINCT t.event_id) AS events_count
        FROM tx t JOIN events e ON e.id = t.event_id
        WHERE e.organizer_user_id IS NOT NULL
        GROUP BY e.organizer_user_id ORDER BY sum(t.club_gross) DESC LIMIT 8
      ) s
      LEFT JOIN organizer_profiles op ON op.user_id::text = s.organizer_user_id::text
    ), '[]'::jsonb),
    'growth', jsonb_build_object(
      'new_users_by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(d, 'YYYY-MM-DD'), 'n', n
      )) FROM new_users), '[]'::jsonb),
      'new_users', (SELECT count(*) FROM profiles p
        WHERE p.created_at >= p_from AND p.created_at <= p_to
          AND NOT public.is_demo_email(p.email)
          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
      'total_users', (SELECT count(*) FROM profiles p
        WHERE NOT public.is_demo_email(p.email)
          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
      'new_venues', (SELECT count(*) FROM venues v
        WHERE v.created_at >= p_from AND v.created_at <= p_to
          AND NOT EXISTS (SELECT 1 FROM d WHERE v.id = ANY (d.dv))),
      'new_events', (SELECT count(*) FROM events e
        WHERE e.created_at >= p_from AND e.created_at <= p_to
          AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
          AND NOT EXISTS (SELECT 1 FROM d WHERE e.id = ANY (d.de)))
    ),
    'venue_cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', s.city, 'revenue', round(s.revenue, 2), 'tx', s.tx)
        ORDER BY s.revenue DESC)
      FROM (
        SELECT v.city, sum(t.club_gross) AS revenue, count(*) AS tx
        FROM tx t JOIN venues v ON v.id = t.venue_id
        WHERE v.city IS NOT NULL
        GROUP BY v.city ORDER BY sum(t.club_gross) DESC LIMIT 10
      ) s
    ), '[]'::jsonb),
    'subscriptions', (
      SELECT count(*) FROM venue_subscriptions vs WHERE vs.status IN ('active', 'trialing')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
