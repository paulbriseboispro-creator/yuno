-- ============================================================================
-- CRITIQUE #2 — VIP host reservation write hardening
--
-- Problem: the policy "VIP hosts can update reservations for their venue"
-- (migration 20260128183859) had a USING clause but NO WITH CHECK. A vip_host
-- authenticates with a 4-digit PIN (24h localStorage session) and could, via a
-- crafted client call with the anon key + their session, UPDATE *any* column of
-- any reservation in their venue's zones — including total_price, deposit,
-- minimum_spend, service_fee, management_fee, status (flip pending -> paid
-- without paying), paid_at, refund_amount. That is a financial-integrity and
-- privilege hole.
--
-- The legitimate vip_host write path (src/hooks/useVipHost.tsx) only ever sets
-- vip_status, assigned_table_id, placed_at, placed_by, finished_at. Everything
-- else is owner / bouncer / edge-function territory.
--
-- Fix (defense in depth, no frontend change required):
--   1. A BEFORE UPDATE trigger that, when the caller is acting *purely* as a
--      vip_host (not the venue owner, co-event partner, super admin, or the
--      service_role edge functions), allows ONLY the five service columns to
--      change. Allow-list (not deny-list) so any financial column added later
--      is protected automatically.
--   2. Add the missing WITH CHECK to the UPDATE policy so a host cannot move a
--      reservation into a zone outside their own venue either.
--
-- Why a trigger and not just column GRANTs / WITH CHECK: RLS WITH CHECK can only
-- inspect the NEW row, never compare it to OLD, so it cannot express "this
-- column did not change". Column GRANTs are role-wide and would also constrain
-- owners (who share the `authenticated` role). A trigger scoped by has_role is
-- the precise, owner-safe enforcement point.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_vip_host_reservation_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- The only columns a pure vip_host may change. Mirrors useVipHost.tsx.
  v_allowed text[] := ARRAY[
    'vip_status', 'assigned_table_id', 'placed_at', 'placed_by', 'finished_at'
  ];
  v_venue text;
  v_old jsonb;
  v_new jsonb;
  k text;
BEGIN
  -- Non-host sessions are unrestricted here. has_role() returns false when
  -- auth.uid() is NULL, so the service_role edge-function path (which
  -- legitimately writes every column) short-circuits immediately.
  IF NOT public.has_role(auth.uid(), 'vip_host') THEN
    RETURN NEW;
  END IF;

  -- A user who also owns this venue / is a co-event partner / is a super admin
  -- keeps full write access even while holding the vip_host role (owners can
  -- and do operate the VIP host dashboard).
  SELECT venue_id INTO v_venue FROM public.table_zones WHERE id = NEW.zone_id;
  IF v_venue IS NOT NULL AND public.is_venue_owner(auth.uid(), v_venue) THEN
    RETURN NEW;
  END IF;
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.event_id IS NOT NULL
     AND (public.is_event_partner_venue_owner(auth.uid(), NEW.event_id)
          OR public.is_event_partner_organizer(auth.uid(), NEW.event_id)) THEN
    RETURN NEW;
  END IF;

  -- Pure vip_host: strip the allow-listed keys from both row images and reject
  -- if anything else changed.
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH k IN ARRAY v_allowed LOOP
    v_old := v_old - k;
    v_new := v_new - k;
  END LOOP;

  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION
      'A VIP host may only change service fields (vip_status, table placement). Financial and identity fields are read-only for this role.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_vip_host_reservation_columns ON public.table_reservations;
CREATE TRIGGER trg_enforce_vip_host_reservation_columns
  BEFORE UPDATE ON public.table_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_vip_host_reservation_columns();

-- Add the missing WITH CHECK so a host cannot relocate a reservation into a
-- zone outside their own venue. USING clause unchanged from 20260128183859.
DROP POLICY IF EXISTS "VIP hosts can update reservations for their venue" ON public.table_reservations;
CREATE POLICY "VIP hosts can update reservations for their venue"
  ON public.table_reservations
  FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'vip_host') AND
    EXISTS (
      SELECT 1 FROM public.table_zones tz
      WHERE tz.id = table_reservations.zone_id
        AND tz.venue_id = public.get_user_venue_id(auth.uid())
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'vip_host') AND
    EXISTS (
      SELECT 1 FROM public.table_zones tz
      WHERE tz.id = table_reservations.zone_id
        AND tz.venue_id = public.get_user_venue_id(auth.uid())
    )
  );
