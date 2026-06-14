
CREATE OR REPLACE FUNCTION public.admin_delete_venue(_venue_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_event_ids uuid[];
  v_deleted_count integer;
  v_owns_other boolean;
BEGIN
  -- 1. Auth check
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- 2. Get owner_id and event IDs
  SELECT owner_id INTO v_owner_id FROM public.venues WHERE id = _venue_id;
  SELECT ARRAY_AGG(id) INTO v_event_ids FROM public.events WHERE venue_id = _venue_id;

  -- 3. Nullify profiles.venue_id for all users linked to this venue
  UPDATE public.profiles SET venue_id = NULL WHERE venue_id = _venue_id;

  -- 4. Remove owner role if they don't own other venues
  IF v_owner_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.venues WHERE owner_id = v_owner_id AND id != _venue_id
    ) INTO v_owns_other;
    
    IF NOT v_owns_other THEN
      DELETE FROM public.user_roles WHERE user_id = v_owner_id AND role = 'owner'::app_role;
    END IF;
  END IF;

  -- 5. Delete rows in tables with NO ACTION FK to events
  IF v_event_ids IS NOT NULL AND array_length(v_event_ids, 1) > 0 THEN
    DELETE FROM public.orders WHERE event_id = ANY(v_event_ids);
    DELETE FROM public.cloakroom_transactions WHERE event_id = ANY(v_event_ids);
    DELETE FROM public.staff_notifications WHERE event_id = ANY(v_event_ids);
    DELETE FROM public.vip_consumptions WHERE table_reservation_id IN (
      SELECT tr.id FROM public.table_reservations tr
      JOIN public.table_zones tz ON tz.id = tr.zone_id
      WHERE tz.venue_id = _venue_id
    );
    DELETE FROM public.vip_upsell_stats WHERE event_id = ANY(v_event_ids);
  END IF;

  -- 6. Delete table_reservations (NO ACTION FK via zone_id)
  DELETE FROM public.table_reservations
  WHERE zone_id IN (SELECT id FROM public.table_zones WHERE venue_id = _venue_id);

  -- 7. Delete owner_invitations for this venue
  DELETE FROM public.owner_invitations WHERE venue_id = _venue_id;

  -- 8. Delete manager_permissions for this venue
  DELETE FROM public.manager_permissions WHERE venue_id = _venue_id;

  -- 9. Remove staff roles for users who were only linked to this venue
  DELETE FROM public.user_roles 
  WHERE user_id IN (
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.role IN ('barman'::app_role, 'bouncer'::app_role, 'vip_host'::app_role, 'manager'::app_role, 'cloakroom'::app_role)
    AND ur.user_id NOT IN (
      SELECT p.id FROM public.profiles p WHERE p.venue_id IS NOT NULL AND p.venue_id != _venue_id
    )
  )
  AND role IN ('barman'::app_role, 'bouncer'::app_role, 'vip_host'::app_role, 'manager'::app_role, 'cloakroom'::app_role);

  -- 10. Delete the venue (CASCADE handles events, drinks, tickets, etc.)
  DELETE FROM public.venues WHERE id = _venue_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count = 0 THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;
END;
$function$;
