CREATE OR REPLACE FUNCTION public.admin_delete_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Required because table_reservations.zone_id FK has NO ACTION
  DELETE FROM public.table_reservations
  WHERE zone_id IN (
    SELECT id FROM public.table_zones WHERE venue_id = _venue_id
  );

  DELETE FROM public.venues
  WHERE id = _venue_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count = 0 THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;
END;
$$;