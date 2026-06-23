-- Fee absorption (pricing refonte Phase 2) for VIP tables.
--
-- reserve_table_slot gains a trailing _fee_absorbed boolean (DEFAULT false so the
-- atomic capacity logic is otherwise untouched) and stores it on the reservation,
-- so refunds know the fan paid no separate management fee when the club absorbed it.
--
-- Drop the old 21-arg signature first (adding a parameter creates an overload, not
-- a replacement), then recreate with the extra trailing arg and re-grant.

DROP FUNCTION IF EXISTS public.reserve_table_slot(
  uuid, uuid, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, numeric,
  text, text, text, text, text, boolean, boolean, text, text, text
);

CREATE OR REPLACE FUNCTION public.reserve_table_slot(
  _event_id uuid,
  _zone_id uuid,
  _capacity_zone_id uuid,
  _pack_id uuid,
  _user_id uuid,
  _user_email text,
  _is_guest boolean,
  _guest_count integer,
  _deposit numeric,
  _total_price numeric,
  _management_fee numeric,
  _status text,
  _qr_code text,
  _full_name text,
  _phone text,
  _remarks text,
  _newsletter_opt_in boolean,
  _sms_opt_in boolean,
  _requested_table_id text,
  _placement_status text,
  _purchase_source text,
  _fee_absorbed boolean DEFAULT false
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
  IF _capacity_zone_id IS NOT NULL THEN
    SELECT tables_count, name INTO v_max, v_zone_name
    FROM public.table_zones
    WHERE id = _capacity_zone_id
    FOR UPDATE;

    IF v_max IS NOT NULL AND v_max > 0 THEN
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
    deposit, total_price, service_fee, management_fee, fee_absorbed, status, paid_at, qr_code,
    full_name, phone, remarks, newsletter_opt_in, sms_opt_in,
    requested_table_id, placement_status, purchase_source
  ) VALUES (
    _event_id, _pack_id, _zone_id, _user_id, _user_email, _is_guest, _guest_count,
    _deposit, _total_price, 0, _management_fee, _fee_absorbed, _status,
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
  text, text, text, text, text, boolean, boolean, text, text, text, boolean
) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reserve_table_slot(
  uuid, uuid, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, numeric,
  text, text, text, text, text, boolean, boolean, text, text, text, boolean
) TO authenticated;
