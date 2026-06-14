-- Function to atomically increment venue_customer stats
CREATE OR REPLACE FUNCTION public.increment_venue_customer_stats(
  p_venue_id text,
  p_user_id uuid,
  p_order_delta int DEFAULT 0,
  p_ticket_delta int DEFAULT 0,
  p_table_delta int DEFAULT 0,
  p_spent_delta numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE venue_customers
  SET 
    order_count = COALESCE(order_count, 0) + p_order_delta,
    ticket_count = COALESCE(ticket_count, 0) + p_ticket_delta,
    table_count = COALESCE(table_count, 0) + p_table_delta,
    total_spent = COALESCE(total_spent, 0) + p_spent_delta,
    last_visit_at = now(),
    updated_at = now()
  WHERE venue_id = p_venue_id AND user_id = p_user_id;
END;
$$;