-- ============================================================================
-- Fix: reserve_ticket_capacity aborts with 42702 "column reference
-- \"expires_at\" is ambiguous" — every ticket checkout fails.
--
-- Root cause: the function returns TABLE(reservation_id uuid, expires_at ...),
-- so `expires_at` is a PL/pgSQL OUT variable. The per-person-limit queries and
-- the capacity-sum query (added in 20260613120000) reference `expires_at`
-- UNQUALIFIED against public.ticket_reservations. PostgreSQL cannot tell the
-- OUT variable from the table column and raises 42702, which the edge function
-- masks as "Impossible de réserver les places." This breaks 100% of ticket
-- purchases (the capacity-sum query always runs).
--
-- Fix: qualify those three column references as
-- `public.ticket_reservations.expires_at`. Signature and output column names
-- are UNCHANGED, so the (un-redeployable, at-cap) create-ticket-checkout edge
-- function keeps calling it and reading `row.expires_at` exactly as before.
-- This is the only change vs the 20260613120000 definition.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reserve_ticket_capacity(
  _ticket_round_id uuid,
  _event_id uuid,
  _user_id uuid,
  _guest_email text,
  _quantity integer,
  _capacity_per_unit integer DEFAULT 1,
  _ttl_minutes integer DEFAULT 10
) RETURNS TABLE(reservation_id uuid, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max integer;
  v_sold integer;
  v_held integer;
  v_capacity_needed integer;
  v_reservation_id uuid;
  v_expires_at timestamp with time zone;
  v_password_enabled boolean;
  v_per_person_limit integer;
  v_email text := nullif(lower(btrim(coalesce(_guest_email, ''))), '');
  v_has_grant boolean;
  v_already integer;
BEGIN
  v_capacity_needed := _quantity * _capacity_per_unit;

  -- Lock the ticket_round row to serialize concurrent reservations
  SELECT max_tickets, tickets_sold INTO v_max, v_sold
  FROM public.ticket_rounds
  WHERE id = _ticket_round_id
  FOR UPDATE;

  IF v_max IS NULL THEN
    RAISE EXCEPTION 'Ticket round not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Load this event's sale controls
  SELECT sale_password_enabled, max_tickets_per_person
  INTO v_password_enabled, v_per_person_limit
  FROM public.events
  WHERE id = _event_id;

  -- Password gate: a protected sale requires a grant minted by unlock_event_sale.
  IF v_password_enabled THEN
    IF _user_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.event_sale_access
        WHERE event_id = _event_id AND user_id = _user_id
      ) INTO v_has_grant;
    ELSIF v_email IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.event_sale_access
        WHERE event_id = _event_id AND lower(guest_email) = v_email
      ) INTO v_has_grant;
    ELSE
      v_has_grant := false;
    END IF;

    IF NOT v_has_grant THEN
      RAISE EXCEPTION 'Sale is password protected' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Per-person limit: cumulative across this buyer's paid tickets + their other
  -- in-flight (pending, non-expired) reservations for this event. The row we are
  -- about to insert is not counted (it doesn't exist yet), so no double count.
  IF v_per_person_limit IS NOT NULL THEN
    IF _user_id IS NOT NULL THEN
      SELECT
        COALESCE((SELECT SUM(quantity) FROM public.tickets
                  WHERE event_id = _event_id AND user_id = _user_id AND status = 'paid'), 0)
      + COALESCE((SELECT SUM(quantity) FROM public.ticket_reservations
                  WHERE event_id = _event_id AND user_id = _user_id
                    AND status = 'pending' AND public.ticket_reservations.expires_at > now()), 0)
      INTO v_already;
    ELSIF v_email IS NOT NULL THEN
      SELECT
        COALESCE((SELECT SUM(quantity) FROM public.tickets
                  WHERE event_id = _event_id AND lower(user_email) = v_email AND status = 'paid'), 0)
      + COALESCE((SELECT SUM(quantity) FROM public.ticket_reservations
                  WHERE event_id = _event_id AND lower(guest_email) = v_email
                    AND status = 'pending' AND public.ticket_reservations.expires_at > now()), 0)
      INTO v_already;
    ELSE
      v_already := 0;
    END IF;

    IF v_already + _quantity > v_per_person_limit THEN
      RAISE EXCEPTION 'Per-person ticket limit reached (limit=%, already=%, requested=%)',
        v_per_person_limit, v_already, _quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Sum currently held (pending, non-expired) reservations for this round
  SELECT COALESCE(SUM(capacity_held), 0) INTO v_held
  FROM public.ticket_reservations
  WHERE ticket_round_id = _ticket_round_id
    AND status = 'pending'
    AND public.ticket_reservations.expires_at > now();

  IF v_sold + v_held + v_capacity_needed > v_max THEN
    RAISE EXCEPTION 'Insufficient capacity: requested=%, available=%',
      v_capacity_needed, (v_max - v_sold - v_held)
      USING ERRCODE = 'check_violation';
  END IF;

  v_expires_at := now() + (_ttl_minutes || ' minutes')::interval;

  INSERT INTO public.ticket_reservations
    (ticket_round_id, event_id, user_id, guest_email, quantity, capacity_held, expires_at)
  VALUES
    (_ticket_round_id, _event_id, _user_id, _guest_email, _quantity, v_capacity_needed, v_expires_at)
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT v_reservation_id, v_expires_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_ticket_capacity(uuid, uuid, uuid, text, integer, integer, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reserve_ticket_capacity(uuid, uuid, uuid, text, integer, integer, integer) TO authenticated;
-- service_role retains execute via the schema-wide grant.
