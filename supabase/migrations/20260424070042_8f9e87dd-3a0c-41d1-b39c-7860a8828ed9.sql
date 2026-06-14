-- 1. Drop the broken duplicate policy on customer_loyalty that grants full access to public role
DROP POLICY IF EXISTS "Service role can manage customer loyalty" ON public.customer_loyalty;

-- The remaining policies are sufficient:
--   * "Service role full access customer_loyalty" (TO service_role) — for edge functions
--   * "Users can view their own loyalty" (user_id = auth.uid())
--   * "Venue owners can view all customer loyalty" (venue ownership check)

-- 2. Drop the public SELECT policy on platform_invitations.
-- Token verification happens server-side in the accept-platform-invitation edge function
-- using the service role, so no client needs SELECT access by token.
DROP POLICY IF EXISTS "Public can verify platform invitation by token" ON public.platform_invitations;

-- The remaining "Admins manage all platform invitations" policy still allows super admins
-- to manage invitations from the admin UI.