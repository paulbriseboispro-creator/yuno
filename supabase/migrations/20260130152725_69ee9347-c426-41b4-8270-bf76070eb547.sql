-- FIX: Remove all recursive policies on user_roles and profiles
-- The issue: policies call has_role() which queries user_roles, or query profiles inside profiles policies

-- ============================================
-- STEP 1: Drop problematic policies on user_roles
-- ============================================

DROP POLICY IF EXISTS "Owners can view their venue user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Owners can delete manager roles" ON public.user_roles;

-- ============================================
-- STEP 2: Drop problematic policies on profiles that might still cause issues
-- ============================================

DROP POLICY IF EXISTS "Venue owners can view customer profiles" ON public.profiles;
DROP POLICY IF EXISTS "Venue owners can view venue member profiles" ON public.profiles;
DROP POLICY IF EXISTS "Venue managers can view venue member profiles" ON public.profiles;
DROP POLICY IF EXISTS "Owners can view their venue profiles" ON public.profiles;
DROP POLICY IF EXISTS "Owners can update their venue profiles" ON public.profiles;

-- ============================================
-- STEP 3: Recreate simple, non-recursive policies for user_roles
-- ============================================

-- Users can always view their own roles (simple, no function calls)
-- This policy might already exist, so we use IF NOT EXISTS pattern
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_roles' 
    AND policyname = 'Users can view their own roles'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id)';
  END IF;
END
$$;

-- Owners can view roles of users in their venue (using SECURITY DEFINER function to avoid recursion)
CREATE OR REPLACE FUNCTION public.get_owner_venue_ids(_owner_id uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.venues WHERE owner_id = _owner_id
$$;

CREATE OR REPLACE FUNCTION public.get_venue_user_ids(_venue_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE venue_id = _venue_id
$$;

-- Check if user is venue owner (no recursion)
CREATE OR REPLACE FUNCTION public.is_owner_of_any_venue(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.venues WHERE owner_id = _user_id)
$$;

-- Owners can view user_roles for their venue's staff
CREATE POLICY "Owners can view venue staff roles"
  ON public.user_roles FOR SELECT
  USING (
    is_owner_of_any_venue(auth.uid()) 
    AND user_id IN (
      SELECT get_venue_user_ids(vid) 
      FROM get_owner_venue_ids(auth.uid()) AS vid
    )
  );

-- Owners can delete manager roles for their venue (simplified)
CREATE POLICY "Owners can remove manager roles"
  ON public.user_roles FOR DELETE
  USING (
    role = 'manager'::app_role
    AND is_owner_of_any_venue(auth.uid())
    AND user_id IN (
      SELECT mp.user_id 
      FROM manager_permissions mp
      JOIN venues v ON mp.venue_id = v.id
      WHERE v.owner_id = auth.uid()
    )
  );

-- ============================================
-- STEP 4: Recreate simple policies for profiles 
-- ============================================

-- Owners can view profiles of staff assigned to their venues
CREATE POLICY "Owners view venue staff profiles"
  ON public.profiles FOR SELECT
  USING (
    is_owner_of_any_venue(auth.uid())
    AND venue_id IN (SELECT get_owner_venue_ids(auth.uid()))
  );

-- Owners can update profiles of staff assigned to their venues  
CREATE POLICY "Owners update venue staff profiles"
  ON public.profiles FOR UPDATE
  USING (
    is_owner_of_any_venue(auth.uid())
    AND venue_id IN (SELECT get_owner_venue_ids(auth.uid()))
  );

-- Managers can view profiles in their managed venue
CREATE POLICY "Managers view venue profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM manager_permissions mp
      WHERE mp.user_id = auth.uid()
      AND profiles.venue_id = mp.venue_id
    )
  );