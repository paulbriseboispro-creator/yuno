-- Fix infinite recursion in profiles RLS policies
-- The issue: policies on profiles table call get_user_venue_id() which queries profiles table

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Venue owners can view their venue profiles" ON public.profiles;
DROP POLICY IF EXISTS "Venue managers can view their venue profiles" ON public.profiles;

-- Create simple, non-recursive policies
-- Users can always view and update their own profile (no function calls needed)
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Super admins can view all profiles (check user_roles, not profiles)
CREATE POLICY "Super admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'::app_role
    )
  );

-- For venue owners/managers, we need to check via venues table directly
-- without calling get_user_venue_id which causes recursion
CREATE POLICY "Venue owners can view venue member profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.owner_id = auth.uid()
      AND public.profiles.venue_id = v.id
    )
  );

CREATE POLICY "Venue managers can view venue member profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.user_id = auth.uid()
      AND public.profiles.venue_id = mp.venue_id
    )
  );