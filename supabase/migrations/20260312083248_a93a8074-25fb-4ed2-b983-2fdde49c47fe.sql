CREATE OR REPLACE FUNCTION get_user_nightlife_stats(p_user_id uuid)
RETURNS TABLE(
  nights_attended bigint,
  drinks_ordered bigint,
  most_active_hour integer,
  favorite_drink text,
  favorite_club_id text,
  favorite_club_name text,
  favorite_club_logo text,
  last_event_id uuid,
  last_event_title text,
  last_event_date timestamptz,
  last_event_venue_name text,
  next_event_id uuid,
  next_event_title text,
  next_event_date timestamptz,
  next_event_venue_name text,
  total_spent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH 
  nights AS (
    SELECT COUNT(DISTINCT DATE(e.start_at)) as cnt
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE t.user_id = p_user_id
    AND t.status = 'paid'
  ),
  drinks AS (
    SELECT COALESCE(SUM(
      COALESCE(
        (item->>'qty')::int,
        (item->>'quantity')::int,
        1
      )
    ), 0) as cnt
    FROM orders o,
    LATERAL jsonb_array_elements(o.items::jsonb) AS item
    WHERE o.user_id = p_user_id
    AND o.status = 'paid'
  ),
  active_hour AS (
    SELECT EXTRACT(HOUR FROM o.created_at)::int as hour
    FROM orders o
    WHERE o.user_id = p_user_id AND o.status = 'paid'
    GROUP BY EXTRACT(HOUR FROM o.created_at)
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  fav_drink AS (
    SELECT COALESCE(item->>'name', item->>'drink_name') as drink_name,
           SUM(COALESCE((item->>'qty')::int, (item->>'quantity')::int, 1)) as total_qty
    FROM orders o,
    LATERAL jsonb_array_elements(o.items::jsonb) AS item
    WHERE o.user_id = p_user_id
    AND o.status = 'paid'
    AND COALESCE(item->>'name', item->>'drink_name') IS NOT NULL
    GROUP BY COALESCE(item->>'name', item->>'drink_name')
    ORDER BY total_qty DESC
    LIMIT 1
  ),
  fav_club AS (
    SELECT vc.venue_id, v.name, v.logo_url
    FROM venue_customers vc
    JOIN venues v ON v.id = vc.venue_id
    WHERE vc.user_id = p_user_id
    ORDER BY vc.order_count + vc.ticket_count + vc.table_count DESC
    LIMIT 1
  ),
  last_evt AS (
    SELECT e.id, e.title, e.start_at, v.name as venue_name
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    JOIN venues v ON v.id = e.venue_id
    WHERE t.user_id = p_user_id
    AND t.status = 'paid'
    AND e.start_at < now()
    ORDER BY e.start_at DESC
    LIMIT 1
  ),
  next_evt AS (
    SELECT e.id, e.title, e.start_at, v.name as venue_name
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    JOIN venues v ON v.id = e.venue_id
    WHERE t.user_id = p_user_id
    AND t.status = 'paid'
    AND e.start_at > now()
    ORDER BY e.start_at ASC
    LIMIT 1
  ),
  spent AS (
    SELECT COALESCE(SUM(vc.total_spent), 0) as total_amt
    FROM venue_customers vc
    WHERE vc.user_id = p_user_id
  )
  SELECT 
    COALESCE((SELECT cnt FROM nights), 0)::bigint,
    COALESCE((SELECT cnt FROM drinks), 0)::bigint,
    COALESCE((SELECT hour FROM active_hour), 23)::integer,
    (SELECT drink_name FROM fav_drink)::text,
    (SELECT venue_id FROM fav_club)::text,
    (SELECT name FROM fav_club)::text,
    (SELECT logo_url FROM fav_club)::text,
    (SELECT id FROM last_evt)::uuid,
    (SELECT title FROM last_evt)::text,
    (SELECT start_at FROM last_evt)::timestamp with time zone,
    (SELECT venue_name FROM last_evt)::text,
    (SELECT id FROM next_evt)::uuid,
    (SELECT title FROM next_evt)::text,
    (SELECT start_at FROM next_evt)::timestamp with time zone,
    (SELECT venue_name FROM next_evt)::text,
    COALESCE((SELECT total_amt FROM spent), 0)::numeric;
END;
$$;