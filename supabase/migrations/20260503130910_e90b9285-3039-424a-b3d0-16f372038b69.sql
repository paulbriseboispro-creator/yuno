
-- 1. launch_waitlist: drop owner-wide SELECT (super_admin already has access)
DROP POLICY IF EXISTS "Owners can view waitlist" ON public.launch_waitlist;

-- 2. app_settings: hide sensitive password columns from clients
REVOKE SELECT (maintenance_password_hash, maintenance_password) ON public.app_settings FROM anon, authenticated;

-- 3. floor-plans storage: restrict writes to owner/organizer/admin roles (paths are flat, cannot scope by venue)
DROP POLICY IF EXISTS "Authenticated users can upload floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete floor plans" ON storage.objects;

CREATE POLICY "Owners/organizers/admins upload floor plans"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'floor-plans' AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
    )
  );

CREATE POLICY "Owners/organizers/admins update floor plans"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'floor-plans' AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
    )
  );

CREATE POLICY "Owners/organizers/admins delete floor plans"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'floor-plans' AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
    )
  );

-- 4. campaign-assets storage: same hardening
DROP POLICY IF EXISTS "Venue owners upload campaign assets" ON storage.objects;
DROP POLICY IF EXISTS "Venue owners delete own campaign assets" ON storage.objects;

CREATE POLICY "Owners/organizers/admins upload campaign assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'campaign-assets' AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
    )
  );

CREATE POLICY "Owners/organizers/admins delete campaign assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'campaign-assets' AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'organizer'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
    )
  );

-- 5. favorites: keep public counts but hide user_id correlation from anon
REVOKE SELECT (user_id) ON public.favorites FROM anon;
-- ensure owners can still read their own user_id
DROP POLICY IF EXISTS "Users can view their own favorites" ON public.favorites;
CREATE POLICY "Users can view their own favorites"
  ON public.favorites FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 6. Replace hardcoded email super-admin checks with is_super_admin()
DROP POLICY IF EXISTS "Super admins can view all feedback" ON public.feedback_issues;
DROP POLICY IF EXISTS "Super admins can update feedback" ON public.feedback_issues;
DROP POLICY IF EXISTS "Super admins can delete feedback" ON public.feedback_issues;

CREATE POLICY "Super admins can view all feedback"
  ON public.feedback_issues FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins can update feedback"
  ON public.feedback_issues FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins can delete feedback"
  ON public.feedback_issues FOR DELETE TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins can manage commissions" ON public.venue_commissions;
CREATE POLICY "Super admins can manage commissions"
  ON public.venue_commissions FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 7. djs.whatsapp_number: hide phone from anon
REVOKE SELECT (whatsapp_number) ON public.djs FROM anon;

-- 8. organizer_profiles: hide legal/billing fields from anon
REVOKE SELECT (billing_email, vat_number, siret, legal_address, legal_name) ON public.organizer_profiles FROM anon;

-- 9. client_scores: restrict from anon, authenticated users see their own + venue managers
DROP POLICY IF EXISTS "Anyone can view client scores" ON public.client_scores;
CREATE POLICY "Users see their own client scores"
  ON public.client_scores FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_manage_venue(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

-- 10. can_manage_venue: require at least one specific manager permission to be true
CREATE OR REPLACE FUNCTION public.can_manage_venue(_user_id uuid, _venue_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = _venue_id AND v.owner_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.user_id = _user_id
        AND mp.venue_id = _venue_id
        AND (
          COALESCE(mp.can_manage_events, false)
          OR COALESCE(mp.can_manage_menu, false)
          OR COALESCE(mp.can_manage_staff, false)
          OR COALESCE(mp.can_view_orders, false)
          OR COALESCE(mp.can_manage_tickets, false)
          OR COALESCE(mp.can_manage_tables, false)
          OR COALESCE(mp.can_manage_djs, false)
          OR COALESCE(mp.can_manage_promoters, false)
          OR COALESCE(mp.can_view_analytics, false)
          OR COALESCE(mp.can_view_finance, false)
        )
    );
$function$;
