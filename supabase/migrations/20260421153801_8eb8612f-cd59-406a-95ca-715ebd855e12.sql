CREATE OR REPLACE FUNCTION public.prevent_partnership_revoke_with_active_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_blocking_count integer;
  v_titles text;
BEGIN
  IF NEW.status = 'revoked'::partnership_status AND (OLD.status IS NULL OR OLD.status <> 'revoked'::partnership_status) THEN
    SELECT COUNT(*), STRING_AGG(e.title, ', ')
    INTO v_blocking_count, v_titles
    FROM public.events e
    WHERE e.start_at > now()
      AND e.is_active = true
      AND (
        (e.venue_id = NEW.venue_id AND e.partner_organizer_id = NEW.organizer_user_id)
        OR (e.organizer_user_id = NEW.organizer_user_id AND e.partner_venue_id = NEW.venue_id)
      )
      AND (
        EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND t.status = 'paid')
        OR EXISTS (
          SELECT 1 FROM public.table_reservations tr
          JOIN public.table_zones tz ON tz.id = tr.zone_id
          WHERE tr.event_id = e.id AND tr.status = 'confirmed' AND tz.venue_id = NEW.venue_id
        )
      );

    IF v_blocking_count > 0 THEN
      RAISE EXCEPTION 'PARTNERSHIP_REVOKE_BLOCKED: % soirée(s) future(s) ont des ventes en cours: %. Termine ou annule ces soirées avant de révoquer le partenariat.', v_blocking_count, v_titles
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;