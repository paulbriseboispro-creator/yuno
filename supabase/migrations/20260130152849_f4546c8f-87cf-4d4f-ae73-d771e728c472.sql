-- FIX: Replace the recursive "Super admins can view all profiles" policy
-- The issue: it directly queries user_roles which triggers RLS checks

DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;

-- Recreate using SECURITY DEFINER function (bypasses RLS)
CREATE POLICY "Super admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (is_super_admin());

-- Also check and fix the "Owners can view venue staff roles" policy on user_roles
-- It uses is_owner_of_any_venue which queries venues (OK), but the subquery might cause issues
DROP POLICY IF EXISTS "Owners can view venue staff roles" ON public.user_roles;

-- Recreate with a simpler, non-recursive approach
-- Owners can view roles of users who have venue_id matching owner's venues
CREATE POLICY "Owners can view venue staff roles"
  ON public.user_roles FOR SELECT
  USING (
    -- User viewing their own roles (always allowed)
    auth.uid() = user_id
    OR
    -- Or user is an owner and target user is in their venue
    (
      is_owner_of_any_venue(auth.uid()) 
      AND EXISTS (
        SELECT 1 FROM profiles p
        JOIN venues v ON p.venue_id = v.id
        WHERE p.id = user_roles.user_id
        AND v.owner_id = auth.uid()
      )
    )
  );