-- Admin organizer management — fix silent RLS failures on organizer_profiles.
--
-- BUG: the admin "Retirer" action on /admin/organizers deleted organizer_profiles
-- from the browser client, but organizer_profiles only had two RLS policies:
--   - public SELECT (is_public = true)
--   - "Organizers manage their own profile" (user_id = auth.uid())
-- There was NO super-admin policy, so an admin DELETE/UPDATE matched 0 rows and
-- returned no error. The public page /o/:slug stayed live while the dashboard
-- reported success. The edit (rename) path had the same silent-failure bug.
--
-- This migration brings organizer_profiles in line with its sibling tables
-- (profiles, user_roles, platform_invitations all already have super-admin
-- policies) and adds an atomic delete RPC modelled on admin_delete_venue().

-- 1. Super-admin can manage any organizer profile (fixes the rename/edit path
--    and gives defense-in-depth for any future admin client-side mutation).
DROP POLICY IF EXISTS "Super admins manage organizer profiles" ON public.organizer_profiles;
CREATE POLICY "Super admins manage organizer profiles"
  ON public.organizer_profiles FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 2. Atomic, server-side removal of an organizer account. SECURITY DEFINER so it
--    bypasses RLS entirely and either fully succeeds or fully rolls back.
CREATE OR REPLACE FUNCTION public.admin_delete_organizer(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
  v_profile_count integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Revert the profile to a default 'club' account (profile_type is NOT NULL).
  -- ROW_COUNT guards against a bogus user id so the caller gets a real error.
  UPDATE public.profiles
     SET profile_type = 'club',
         organization_name = NULL,
         onboarding_completed = false
   WHERE id = _user_id
   RETURNING email INTO v_email;

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;
  IF v_profile_count = 0 THEN
    RAISE EXCEPTION 'Organizer profile not found: %', _user_id;
  END IF;

  -- Drop the public organizer profile (the page at /o/:slug). May be 0 rows if
  -- the organizer never published a public profile — that is not an error.
  DELETE FROM public.organizer_profiles WHERE user_id = _user_id;

  -- Remove the organizer team members owned by this account.
  DELETE FROM public.org_members WHERE organizer_user_id = _user_id;

  -- Revoke the 'organizer' role so they lose dashboard access.
  DELETE FROM public.user_roles
   WHERE user_id = _user_id AND role = 'organizer'::app_role;

  -- Drop any platform invitation tied to this email.
  IF v_email IS NOT NULL THEN
    DELETE FROM public.platform_invitations
     WHERE lower(email) = lower(v_email);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_organizer(uuid) TO authenticated;
