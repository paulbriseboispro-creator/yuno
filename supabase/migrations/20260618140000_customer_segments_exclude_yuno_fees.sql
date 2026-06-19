-- ───────────────────────────────────────────────────────────────────────────
-- Customer segments: club revenue must NEVER include Yuno fees.
--
-- get_venue_customer_segments computed revenue_30d / revenue_90d /
-- revenue_prev_90d / avg_basket from the RAW charged amounts (tickets.total_price,
-- orders.total, table_reservations.total_price). Those amounts include Yuno's
-- service / insurance / management fees, which are 100% retained by Yuno and are
-- NOT club revenue. Counting them inflated the customer-base revenue and growth
-- shown on the Clients analytics page.
--
-- This re-creates the function with the SAME shape, subtracting Yuno fees from
-- each activity amount so the figures match the canonical model in
-- src/utils/fees.ts and supabase/functions/owner-assistant.
--
-- NOTE: venue_customers.total_spent (lifetime CLV, loyalty points, customer
-- tiers, leaderboard, campaign segments) is intentionally NOT touched here — it
-- is maintained separately and feeds threshold-based behavior + historical
-- balances, so it needs its own migration + backfill.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_customer_segments(p_venue_id TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, email TEXT, first_name TEXT, last_name TEXT, phone TEXT,
  first_visit_at TIMESTAMPTZ, last_visit_at TIMESTAMPTZ, total_spent NUMERIC,
  ticket_count INTEGER, order_count INTEGER, table_count INTEGER,
  is_banned BOOLEAN, banned_at TIMESTAMPTZ, ban_reason TEXT, notes TEXT,
  revenue_30d NUMERIC, revenue_90d NUMERIC, revenue_prev_90d NUMERIC,
  avg_basket NUMERIC, visit_nights INTEGER, visits_per_month NUMERIC,
  last_activity_at TIMESTAMPTZ, preferred_dow INTEGER, preferred_event_title TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH venue_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
  ),
  -- Club revenue = amount charged − Yuno fees. Yuno's cut is never counted.
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, ve.start_at, ve.title, count(*) AS cnt
    FROM activity a JOIN venue_events ve ON ve.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, ve.start_at, ve.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  )
  SELECT
    vc.id, vc.user_id, vc.email, vc.first_name, vc.last_name, vc.phone,
    vc.first_visit_at, vc.last_visit_at, vc.total_spent,
    vc.ticket_count, vc.order_count, vc.table_count,
    vc.is_banned, vc.banned_at, vc.ban_reason, vc.notes,
    ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
    COALESCE(ag.visit_nights, 0)::int AS visit_nights,
    CASE
      WHEN ag.first_activity_at IS NULL THEN 0
      ELSE round(
        ag.visit_nights::numeric /
        greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
        2)
    END AS visits_per_month,
    ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title
  FROM venue_customers vc
  LEFT JOIN agg ag ON ag.em = lower(vc.email)
  LEFT JOIN pref_event pe ON pe.em = lower(vc.email)
  LEFT JOIN pref_dow pd ON pd.em = lower(vc.email)
  WHERE vc.venue_id = p_venue_id
  ORDER BY vc.last_visit_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_venue_customer_segments(TEXT) TO authenticated;
