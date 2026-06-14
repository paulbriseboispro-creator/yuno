-- Restrict anonymous UPDATE on visitor_sessions to only allow updating duration_seconds
-- Drop the overly permissive anon update policy
DROP POLICY IF EXISTS "Anon can update visitor sessions" ON public.visitor_sessions;

-- Recreate with restrictions: only duration_seconds can be changed, and must be reasonable
-- We use a trigger to enforce that only duration_seconds changes
CREATE OR REPLACE FUNCTION public.validate_visitor_session_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- For anon updates, only allow duration_seconds to change
  -- Prevent manipulation of business-critical fields
  IF NEW.added_to_cart IS DISTINCT FROM OLD.added_to_cart
     OR NEW.completed_order IS DISTINCT FROM OLD.completed_order
     OR NEW.proceeded_to_checkout IS DISTINCT FROM OLD.proceeded_to_checkout
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.venue_id IS DISTINCT FROM OLD.venue_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
  THEN
    -- Check if caller is authenticated (has a valid user)
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Anonymous users can only update duration_seconds';
    END IF;
  END IF;
  
  -- Validate duration_seconds is reasonable (0 to 24 hours)
  IF NEW.duration_seconds IS NOT NULL AND (NEW.duration_seconds < 0 OR NEW.duration_seconds > 86400) THEN
    NEW.duration_seconds := LEAST(GREATEST(NEW.duration_seconds, 0), 86400);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_visitor_session_update_trigger
  BEFORE UPDATE ON public.visitor_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_visitor_session_update();

-- Re-add anon update policy (still needed for sendBeacon) but now protected by trigger
CREATE POLICY "Anon can update visitor session duration"
  ON public.visitor_sessions
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);