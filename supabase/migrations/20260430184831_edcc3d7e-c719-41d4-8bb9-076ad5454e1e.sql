-- ============================================
-- M3: MFA Disable Hardening
-- ============================================

-- Add cooldown tracking + audit columns
ALTER TABLE public.mfa_disable_requests
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text;

-- Index pour le rate limit (lookups par user récent)
CREATE INDEX IF NOT EXISTS idx_mfa_disable_requests_user_created
  ON public.mfa_disable_requests(user_id, created_at DESC);

-- Helper: vérifier si un user a dépassé le rate limit (3 demandes / heure)
CREATE OR REPLACE FUNCTION public.check_mfa_disable_rate_limit(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) < 3
  FROM public.mfa_disable_requests
  WHERE user_id = _user_id
    AND created_at > now() - interval '1 hour';
$$;

REVOKE EXECUTE ON FUNCTION public.check_mfa_disable_rate_limit(uuid) FROM anon, public;

-- ============================================
-- PR3 (squelette): table de réservation atomique des tickets
-- (NON branchée au checkout pour l'instant — sera branchée dans un tour ultérieur après tests)
-- ============================================

CREATE TABLE IF NOT EXISTS public.ticket_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_round_id uuid NOT NULL REFERENCES public.ticket_rounds(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_email text,
  quantity integer NOT NULL CHECK (quantity > 0),
  capacity_held integer NOT NULL CHECK (capacity_held > 0),
  stripe_session_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired','cancelled')),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  confirmed_at timestamp with time zone,
  CONSTRAINT user_or_guest_required CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ticket_reservations_round_status_expires
  ON public.ticket_reservations(ticket_round_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ticket_reservations_session
  ON public.ticket_reservations(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_reservations_status_expires
  ON public.ticket_reservations(status, expires_at);

ALTER TABLE public.ticket_reservations ENABLE ROW LEVEL SECURITY;

-- Aucune policy publique : la table n'est manipulée que par les edge functions (service role)
-- Les utilisateurs n'ont JAMAIS besoin de la lire/écrire en direct.

-- RPC atomique: réserver des places ou échouer si capacité dépassée
-- Compte tenu des réservations 'pending' non expirées + des tickets vendus
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

-- RPC: confirmer une réservation (appelée par verify-ticket-payment après webhook Stripe OK)
CREATE OR REPLACE FUNCTION public.confirm_ticket_reservation(_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id uuid;
  v_capacity integer;
  v_status text;
BEGIN
  SELECT ticket_round_id, capacity_held, status
  INTO v_round_id, v_capacity, v_status
  FROM public.ticket_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  IF v_status = 'confirmed' THEN
    RETURN; -- Idempotent
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Reservation is not pending (status=%)', v_status;
  END IF;

  UPDATE public.ticket_reservations
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = _reservation_id;

  UPDATE public.ticket_rounds
  SET tickets_sold = tickets_sold + v_capacity
  WHERE id = v_round_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_ticket_reservation(uuid) FROM anon, public;

-- RPC: annuler une réservation (timeout ou annulation explicite)
CREATE OR REPLACE FUNCTION public.cancel_ticket_reservation(_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ticket_reservations
  SET status = 'cancelled'
  WHERE id = _reservation_id
    AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_ticket_reservation(uuid) FROM anon, public;

-- Cleanup automatique des réservations expirées (à brancher au cron existant)
CREATE OR REPLACE FUNCTION public.expire_stale_ticket_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.ticket_reservations
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at <= now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_ticket_reservations() FROM anon, public;