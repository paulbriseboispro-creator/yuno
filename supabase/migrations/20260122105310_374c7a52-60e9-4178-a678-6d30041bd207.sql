-- Add avatar_url and city columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city text;

-- Create function to get user nightlife stats
CREATE OR REPLACE FUNCTION public.get_user_nightlife_stats(p_user_id uuid)
RETURNS TABLE(
  nights_attended bigint,
  drinks_ordered bigint,
  most_active_hour int,
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
  -- Count distinct nights from used tickets
  nights AS (
    SELECT COUNT(DISTINCT DATE(e.start_at)) as cnt
    FROM tickets t
    JOIN ticket_attendees ta ON ta.ticket_id = t.id
    JOIN events e ON e.id = t.event_id
    WHERE t.user_id = p_user_id
    AND ta.entry_scanned = true
  ),
  -- Sum drinks ordered across all venues
  drinks AS (
    SELECT COALESCE(SUM(order_count), 0) as cnt
    FROM venue_customers
    WHERE user_id = p_user_id
  ),
  -- Find most active hour from orders
  active_hour AS (
    SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*) as cnt
    FROM orders
    WHERE user_id = p_user_id AND status = 'paid'
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY cnt DESC
    LIMIT 1
  ),
  -- Find favorite drink category
  fav_drink AS (
    SELECT favorite_drink_category
    FROM venue_customers
    WHERE user_id = p_user_id AND favorite_drink_category IS NOT NULL
    GROUP BY favorite_drink_category
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  -- Find favorite club (most visits)
  fav_club AS (
    SELECT vc.venue_id, v.name, v.logo_url
    FROM venue_customers vc
    JOIN venues v ON v.id = vc.venue_id
    WHERE vc.user_id = p_user_id
    ORDER BY vc.order_count + vc.ticket_count + vc.table_count DESC
    LIMIT 1
  ),
  -- Last attended event
  last_evt AS (
    SELECT e.id, e.title, e.start_at, v.name as venue_name
    FROM tickets t
    JOIN ticket_attendees ta ON ta.ticket_id = t.id
    JOIN events e ON e.id = t.event_id
    JOIN venues v ON v.id = e.venue_id
    WHERE t.user_id = p_user_id
    AND ta.entry_scanned = true
    ORDER BY e.start_at DESC
    LIMIT 1
  ),
  -- Next booked event
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
  -- Total spent
  spent AS (
    SELECT COALESCE(SUM(total_spent), 0) as total
    FROM venue_customers
    WHERE user_id = p_user_id
  )
  SELECT 
    COALESCE((SELECT cnt FROM nights), 0),
    COALESCE((SELECT cnt FROM drinks), 0),
    COALESCE((SELECT hour FROM active_hour), 23),
    (SELECT favorite_drink_category FROM fav_drink),
    (SELECT venue_id FROM fav_club),
    (SELECT name FROM fav_club),
    (SELECT logo_url FROM fav_club),
    (SELECT id FROM last_evt),
    (SELECT title FROM last_evt),
    (SELECT start_at FROM last_evt),
    (SELECT venue_name FROM last_evt),
    (SELECT id FROM next_evt),
    (SELECT title FROM next_evt),
    (SELECT start_at FROM next_evt),
    (SELECT venue_name FROM next_evt),
    COALESCE((SELECT total FROM spent), 0);
END;
$$;