-- ============================================================================
-- P0 FIX — checkout VIP cassé : reserve_table_slot insérait un TEXT dans la
-- colonne uuid `table_reservations.requested_table_id` (ligne 97 de
-- 20260714170000), sans cast. Postgres résout le type au PLAN → l'INSERT échoue
-- (42804 « column is of type uuid but expression is of type text ») quelle que
-- soit la valeur, même NULL. Les deux call-sites de create-table-checkout
-- passent par là → aucune réservation de table ne pouvait être créée.
--
-- Corps INCHANGÉ ; seul l'INSERT gagne `::uuid`. Signature identique (edge
-- functions inchangées). v_requested reste TEXT (comparé via ::text plus haut).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reserve_table_slot(
  _event_id uuid, _zone_id uuid, _capacity_zone_id uuid, _pack_id uuid,
  _user_id uuid, _user_email text, _is_guest boolean, _guest_count integer,
  _deposit numeric, _total_price numeric, _management_fee numeric,
  _status text, _qr_code text, _full_name text, _phone text, _remarks text,
  _newsletter_opt_in boolean, _sms_opt_in boolean,
  _requested_table_id text, _placement_status text, _purchase_source text,
  _fee_absorbed boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max integer;
  v_zone_name text;
  v_used integer;
  v_reservation_id uuid;
  v_requested text := NULLIF(_requested_table_id, '');
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

  IF v_requested IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_event_id::text || ':' || v_requested, 0));
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
      WHERE r.event_id = _event_id
        AND r.status IN ('pending', 'paid', 'confirmed')
        AND (
          (r.requested_table_id::text = v_requested
            AND r.placement_status IN ('requested', 'approved'))
          OR r.assigned_table_id::text = v_requested
        )
    ) THEN
      RAISE EXCEPTION
        'Cette table vient d''être réservée par quelqu''un d''autre. Choisis une autre table sur le plan.'
        USING ERRCODE = 'check_violation';
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
    NULLIF(_requested_table_id, '')::uuid, COALESCE(NULLIF(_placement_status, ''), 'none'), _purchase_source
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$function$;
