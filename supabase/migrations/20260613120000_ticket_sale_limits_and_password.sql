-- ============================================================================
-- Ticket sale controls: per-person purchase limit + password-gated access
--
-- Two owner/organizer-configurable controls for ticket sales, designed for
-- limited "hype" drops:
--   1. max_tickets_per_person — cap total tickets one person can buy for an event
--   2. password-gated sale     — buyers must enter a password to access the sale
--
-- Server-side enforcement lives in Postgres (NOT the edge function), because the
-- project is at its edge-function cap and create-ticket-checkout cannot be
-- redeployed. We hook into reserve_ticket_capacity (the atomic reservation RPC
-- the checkout already calls) WITHOUT changing its signature, so the existing
-- edge function keeps working unchanged.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Event-level config columns ──────────────────────────────────────────
-- max_tickets_per_person: NULL = no limit. Counts cumulative across all orders.
-- sale_password_enabled: public-readable flag that drives the buyer-side gate.
-- The actual password hash never lives on `events` (clients SELECT * on it), it
-- lives in the protected table below.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS max_tickets_per_person integer
    CHECK (max_tickets_per_person IS NULL OR max_tickets_per_person > 0),
  ADD COLUMN IF NOT EXISTS sale_password_enabled boolean NOT NULL DEFAULT false;

-- ── 2. Protected password store (RPC-only, never client-readable) ──────────
CREATE TABLE IF NOT EXISTS public.event_sale_protection (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.event_sale_protection ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only SECURITY DEFINER RPCs (and service_role) touch it.
-- A bcrypt hash must never be reachable by anon/authenticated SELECT.

-- ── 3. Sale access grants (minted after a correct password) ────────────────
-- One row per (event, identity). Authenticated buyers are keyed by user_id,
-- guests by lowercased email. reserve_ticket_capacity requires a matching grant
-- when the event is password-protected.
CREATE TABLE IF NOT EXISTS public.event_sale_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_email text,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sale_access_user_or_guest CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_sale_access_user
  ON public.event_sale_access(event_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_sale_access_guest
  ON public.event_sale_access(event_id, lower(guest_email)) WHERE guest_email IS NOT NULL;

ALTER TABLE public.event_sale_access ENABLE ROW LEVEL SECURITY;
-- No public policies: grants are written by unlock_event_sale (SECURITY DEFINER)
-- and read by reserve_ticket_capacity (SECURITY DEFINER). Clients never touch it.

-- ── 4. RPC: owner/organizer sets or clears the sale password ───────────────
-- Passing NULL or an empty/blank password clears protection. Re-setting a
-- password invalidates all previously minted grants for the event.
CREATE OR REPLACE FUNCTION public.set_event_sale_password(
  p_event_id uuid,
  p_password text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pw text := nullif(btrim(coalesce(p_password, '')), '');
BEGIN
  IF NOT public.can_manage_event_tables(auth.uid(), p_event_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this event' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_pw IS NULL THEN
    -- Clear protection
    DELETE FROM public.event_sale_protection WHERE event_id = p_event_id;
    DELETE FROM public.event_sale_access WHERE event_id = p_event_id;
    UPDATE public.events SET sale_password_enabled = false WHERE id = p_event_id;
    RETURN;
  END IF;

  INSERT INTO public.event_sale_protection (event_id, password_hash, updated_at)
  VALUES (p_event_id, crypt(v_pw, gen_salt('bf', 10)), now())
  ON CONFLICT (event_id)
  DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();

  -- A new/changed password revokes prior access — buyers must re-enter it.
  DELETE FROM public.event_sale_access WHERE event_id = p_event_id;

  UPDATE public.events SET sale_password_enabled = true WHERE id = p_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_event_sale_password(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_event_sale_password(uuid, text) TO authenticated;

-- ── 5. RPC: buyer unlocks a protected sale ─────────────────────────────────
-- Returns true when the sale is open to the caller (correct password, or the
-- event isn't protected at all). On success it mints a grant: by user_id for
-- authenticated callers, by guest_email when an email is supplied. Safe to call
-- repeatedly (idempotent upsert). Public on purpose — it is the gate itself.
CREATE OR REPLACE FUNCTION public.unlock_event_sale(
  p_event_id uuid,
  p_password text,
  p_guest_email text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_uid uuid := auth.uid();
  v_email text := nullif(lower(btrim(coalesce(p_guest_email, ''))), '');
BEGIN
  SELECT password_hash INTO v_hash
  FROM public.event_sale_protection
  WHERE event_id = p_event_id;

  -- Not protected → nothing to unlock.
  IF v_hash IS NULL THEN
    RETURN true;
  END IF;

  -- Wrong password → no grant, no leak.
  IF crypt(coalesce(p_password, ''), v_hash) <> v_hash THEN
    RETURN false;
  END IF;

  -- Correct password → mint a grant for whichever identity we have.
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.event_sale_access (event_id, user_id)
    VALUES (p_event_id, v_uid)
    ON CONFLICT (event_id, user_id) WHERE user_id IS NOT NULL DO NOTHING;
  ELSIF v_email IS NOT NULL THEN
    INSERT INTO public.event_sale_access (event_id, guest_email)
    VALUES (p_event_id, v_email)
    ON CONFLICT (event_id, lower(guest_email)) WHERE guest_email IS NOT NULL DO NOTHING;
  END IF;
  -- Anonymous caller with no email still gets `true` (so the UI can reveal the
  -- tickets); the grant is minted later at checkout once the email is known.

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unlock_event_sale(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.unlock_event_sale(uuid, text, text) TO anon, authenticated;

-- ── 6. Reservation RPC: add per-person limit + password grant enforcement ──
-- Same signature as before so create-ticket-checkout calls it unchanged.
-- New checks run BEFORE capacity is held.
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
                    AND status = 'pending' AND expires_at > now()), 0)
      INTO v_already;
    ELSIF v_email IS NOT NULL THEN
      SELECT
        COALESCE((SELECT SUM(quantity) FROM public.tickets
                  WHERE event_id = _event_id AND lower(user_email) = v_email AND status = 'paid'), 0)
      + COALESCE((SELECT SUM(quantity) FROM public.ticket_reservations
                  WHERE event_id = _event_id AND lower(guest_email) = v_email
                    AND status = 'pending' AND expires_at > now()), 0)
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
    AND expires_at > now();

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
