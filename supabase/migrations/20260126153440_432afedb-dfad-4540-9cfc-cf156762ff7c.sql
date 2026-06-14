-- Fix the get_user_nightlife_stats function to resolve column ambiguity
-- and count paid tickets instead of only scanned ones
CREATE OR REPLACE FUNCTION public.get_user_nightlife_stats(p_user_id uuid)
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
  last_event_date timestamp with time zone,
  last_event_venue_name text,
  next_event_id uuid,
  next_event_title text,
  next_event_date timestamp with time zone,
  next_event_venue_name text,
  total_spent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- Count distinct nights from tickets (paid, not just scanned)
  nights AS (
    SELECT COUNT(DISTINCT DATE(e.start_at)) as cnt
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE t.user_id = p_user_id
    AND t.status = 'paid'
  ),
  -- Sum drinks from venue_customers
  drinks AS (
    SELECT COALESCE(SUM(vc.order_count), 0) as cnt
    FROM venue_customers vc
    WHERE vc.user_id = p_user_id
  ),
  -- Most active hour from orders
  active_hour AS (
    SELECT EXTRACT(HOUR FROM o.created_at)::int as hour
    FROM orders o
    WHERE o.user_id = p_user_id AND o.status = 'paid'
    GROUP BY EXTRACT(HOUR FROM o.created_at)
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  -- Favorite drink category
  fav_drink AS (
    SELECT vc.favorite_drink_category
    FROM venue_customers vc
    WHERE vc.user_id = p_user_id 
    AND vc.favorite_drink_category IS NOT NULL
    GROUP BY vc.favorite_drink_category
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  -- Favorite club based on activity
  fav_club AS (
    SELECT vc.venue_id, v.name, v.logo_url
    FROM venue_customers vc
    JOIN venues v ON v.id = vc.venue_id
    WHERE vc.user_id = p_user_id
    ORDER BY vc.order_count + vc.ticket_count + vc.table_count DESC
    LIMIT 1
  ),
  -- Last attended event (paid ticket, event in past)
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
  -- Next booked event (paid ticket, event in future)
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
  -- Total spent (use alias total_amt to avoid ambiguity with venue_customers.total_spent)
  spent AS (
    SELECT COALESCE(SUM(vc.total_spent), 0) as total_amt
    FROM venue_customers vc
    WHERE vc.user_id = p_user_id
  )
  SELECT 
    COALESCE((SELECT cnt FROM nights), 0)::bigint,
    COALESCE((SELECT cnt FROM drinks), 0)::bigint,
    COALESCE((SELECT hour FROM active_hour), 23)::integer,
    (SELECT favorite_drink_category FROM fav_drink)::text,
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

-- Backfill customer_loyalty records for existing customers with purchases
-- This creates loyalty records for users who have spent money but don't have loyalty records yet
INSERT INTO customer_loyalty (venue_id, user_id, venue_customer_id, total_points_earned, current_balance, tier)
SELECT 
  vc.venue_id,
  vc.user_id,
  vc.id,
  FLOOR(vc.total_spent)::integer,
  FLOOR(vc.total_spent)::integer,
  CASE 
    WHEN vc.total_spent >= 1000 THEN 'platinum'
    WHEN vc.total_spent >= 500 THEN 'gold'
    WHEN vc.total_spent >= 200 THEN 'silver'
    ELSE 'bronze'
  END
FROM venue_customers vc
WHERE vc.user_id IS NOT NULL
AND vc.total_spent > 0
AND NOT EXISTS (
  SELECT 1 FROM customer_loyalty cl 
  WHERE cl.venue_id = vc.venue_id AND cl.user_id = vc.user_id
);