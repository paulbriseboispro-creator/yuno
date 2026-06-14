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
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.venues WHERE id = _venue_id;
  SELECT ARRAY_AGG(id) INTO v_event_ids FROM public.events WHERE venue_id = _venue_id;

  -- Delete cloakroom_transactions (NO ACTION FK to events)
  IF v_event_ids IS NOT NULL AND array_length(v_event_ids, 1) > 0 THEN
    DELETE FROM public.cloakroom_transactions WHERE event_id = ANY(v_event_ids);
  END IF;

  -- Delete table_reservations via zones
  DELETE FROM public.table_reservations
  WHERE zone_id IN (SELECT id FROM public.table_zones WHERE venue_id = _venue_id);

  -- Nullify profiles.venue_id
  UPDATE public.profiles SET venue_id = NULL WHERE venue_id = _venue_id;

  -- Handle owner: revoke role + reset MFA
  IF v_owner_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.venues WHERE owner_id = v_owner_id AND id != _venue_id
    ) INTO v_owns_other;
    
    IF NOT v_owns_other THEN
      DELETE FROM public.user_roles WHERE user_id = v_owner_id AND role = 'owner'::app_role;
      UPDATE public.profiles SET mfa_enabled = false, mfa_enforced = false WHERE id = v_owner_id;
      DELETE FROM public.mfa_pending WHERE user_id = v_owner_id;
      DELETE FROM public.mfa_recovery_codes WHERE user_id = v_owner_id;
      DELETE FROM public.mfa_disable_requests WHERE user_id = v_owner_id;
    END IF;
  END IF;

  DELETE FROM public.owner_invitations WHERE venue_id = _venue_id;
  DELETE FROM public.manager_permissions WHERE venue_id = _venue_id;

  -- Remove staff roles for users only linked to this venue
  DELETE FROM public.user_roles 
  WHERE user_id IN (
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.role IN ('barman'::app_role, 'bouncer'::app_role, 'vip_host'::app_role, 'manager'::app_role, 'cloakroom'::app_role)
    AND ur.user_id NOT IN (
      SELECT p.id FROM public.profiles p WHERE p.venue_id IS NOT NULL AND p.venue_id != _venue_id
    )
  )
  AND role IN ('barman'::app_role, 'bouncer'::app_role, 'vip_host'::app_role, 'manager'::app_role, 'cloakroom'::app_role);

  DELETE FROM public.venues WHERE id = _venue_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count = 0 THEN
    RAISE EXCEPTION 'Venue not found: %', _venue_id;
  END IF;
END;
$function$;