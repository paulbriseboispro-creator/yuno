-- SÉCURITÉ — les notifications destinées au propriétaire (2026-09-25).
--
-- `staff_notifications` s'ouvrait à tout profil rattaché au club
-- (`venue_id = get_user_venue_id(auth.uid())`) : un videur, un barman ou un
-- hôte VIP pouvait lire par PostgREST les lignes `target_role = 'owner'` —
-- ventes, virements, bilans de soirée. Les lignes « propriétaire » ne
-- s'ouvrent plus qu'au propriétaire du club (`venues.owner_id`, même s'il
-- n'a pas de `profiles.venue_id`), aux comptes au rôle `owner` rattachés au
-- club (co-propriétaires) et à ses managers ; les autres rôles
-- gardent leurs lignes (`all_staff`, `bouncer`, `vip_host`…). Realtime suit
-- la même RLS.

CREATE OR REPLACE FUNCTION public.can_read_staff_notification(_venue_id text, _target_role text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_venue_owner(auth.uid(), _venue_id)
    OR (
      _venue_id = public.get_user_venue_id(auth.uid())
      AND (
        coalesce(_target_role, '') <> 'owner'
        OR public.has_role(auth.uid(), 'owner'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.manager_permissions mp
          WHERE mp.user_id = auth.uid() AND mp.venue_id = _venue_id
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_staff_notification(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_staff_notification(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff can read own venue notifications" ON public.staff_notifications;
CREATE POLICY "Staff can read own venue notifications"
  ON public.staff_notifications FOR SELECT
  TO authenticated
  USING (public.can_read_staff_notification(venue_id, target_role));

DROP POLICY IF EXISTS "Staff can update own venue notifications" ON public.staff_notifications;
CREATE POLICY "Staff can update own venue notifications"
  ON public.staff_notifications FOR UPDATE
  TO authenticated
  USING (public.can_read_staff_notification(venue_id, target_role))
  WITH CHECK (public.can_read_staff_notification(venue_id, target_role));
