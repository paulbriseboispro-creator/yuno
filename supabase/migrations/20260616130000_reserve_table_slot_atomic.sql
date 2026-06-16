-- ============================================================================
-- CRITIQUE #1 — Atomic VIP table slot reservation (anti-oversell)
--
-- Problem: create-table-checkout enforced zone capacity with a non-transactional
-- "COUNT(...) then INSERT": it counted active reservations in the zone, then
-- (much later, after Stripe work) inserted the reservation. With no row lock and
-- no unique constraint, two concurrent checkouts for the last table of a zone
-- both pass the count and both create paid reservations -> two parties paid for
-- one physical table. The 30-min pending-cleanup cron does not help once both
-- are paid.
--
-- Fix: mirror the proven reserve_ticket_capacity pattern. A SECURITY DEFINER
-- function locks the zone row FOR UPDATE, re-counts holders under the lock, and
-- inserts the reservation in the same transaction. Concurrent callers serialize
-- on the zone row, so the (N+1)th caller sees the full count and is rejected.
--
-- Deploy order matters: push this migration BEFORE deploying the updated
-- create-table-checkout edge function. With the migration alone, the old edge
-- function keeps working (it just isn't atomic yet); the new edge function
-- requires this RPC to exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reserve_table_slot(
  _event_id uuid,
  _zone_id uuid,               -- zone stored on the reservation
  _capacity_zone_id uuid,      -- zone whose tables_count governs capacity (effective zone)
  _pack_id uuid,
  _user_id uuid,
  _user_email text,
  _is_guest boolean,
  _guest_count integer,
  _deposit numeric,
  _total_price numeric,
  _management_fee numeric,
  _status text,                -- 'pending' (prod) or 'paid' (test mode)
  _qr_code text,
  _full_name text,
  _phone text,
  _remarks text,
  _newsletter_opt_in boolean,
  _sms_opt_in boolean,
  _requested_table_id text,
  _placement_status text,
  _purchase_source text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max integer;
  v_zone_name text;
  v_used integer;
  v_reservation_id uuid;
BEGIN
  -- Serialize concurrent checkouts on the governing zone. Counting and the
  -- subsequent INSERT happen while we hold this row lock, so two callers racing
  -- for the last table cannot both pass.
  IF _capacity_zone_id IS NOT NULL THEN
    SELECT tables_count, name INTO v_max, v_zone_name
    FROM public.table_zones
    WHERE id = _capacity_zone_id
    FOR UPDATE;

    IF v_max IS NOT NULL AND v_max > 0 THEN
      -- Holders = reservations on this zone for this event in a slot-holding
      -- status. Mirrors the prior inline guard (pending in checkout, paid,
      -- confirmed). Pending rows older than ~30min are flushed by the cron.
      SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
      WHERE event_id = _event_id
        AND zone_id = _capacity_zone_id
        AND status IN ('pending', 'paid', 'confirmed');

      IF v_used >= v_max THEN
        RAISE EXCEPTION
          'La zone "%" est complète (%/% tables réservées). Choisis une autre zone ou réessaie plus tard.',
          v_zone_name, v_used, v_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, pack_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, status, paid_at, qr_code,
    full_name, phone, remarks, newsletter_opt_in, sms_opt_in,
    requested_table_id, placement_status, purchase_source
  ) VALUES (
    _event_id, _pack_id, _zone_id, _user_id, _user_email, _is_guest, _guest_count,
    _deposit, _total_price, 0, _management_fee, _status,
    CASE WHEN _status = 'paid' THEN now() ELSE NULL END, _qr_code,
    _full_name, _phone, _remarks, _newsletter_opt_in, _sms_opt_in,
    NULLIF(_requested_table_id, ''), COALESCE(NULLIF(_placement_status, ''), 'none'), _purchase_source
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_table_slot(
  uuid, uuid, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, numeric,
  text, text, text, text, text, boolean, boolean, text, text, text
) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reserve_table_slot(
  uuid, uuid, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, numeric,
  text, text, text, text, text, boolean, boolean, text, text, text
) TO authenticated;
-- service_role (the create-table-checkout edge function) retains execute via the
-- schema-wide grant.
