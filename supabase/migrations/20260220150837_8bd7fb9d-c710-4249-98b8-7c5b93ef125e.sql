
CREATE OR REPLACE FUNCTION public.get_visitor_stats(
  p_venue_id text,
  p_start timestamptz,
  p_end timestamptz,
  p_compare_start timestamptz,
  p_compare_end timestamptz
)
RETURNS TABLE(
  current_visits bigint,
  current_converted bigint,
  previous_visits bigint,
  previous_converted bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_start AND visited_at < p_end),
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_start AND visited_at < p_end AND completed_order = true),
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_compare_start AND visited_at < p_compare_end),
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_compare_start AND visited_at < p_compare_end AND completed_order = true);
$$;
