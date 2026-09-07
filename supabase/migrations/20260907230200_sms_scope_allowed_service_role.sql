-- La garde de portée SMS doit laisser passer le service_role : les edge
-- functions (worker, cron) lisent le rapport et le comptage sans auth.uid().
CREATE OR REPLACE FUNCTION public.sms_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid())
    ));
$$;
