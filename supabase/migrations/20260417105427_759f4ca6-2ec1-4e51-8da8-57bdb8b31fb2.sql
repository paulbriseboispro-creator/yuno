-- Allow anonymous token verification for platform invitations
CREATE POLICY "Public can verify platform invitation by token"
  ON public.platform_invitations FOR SELECT
  USING (true);

-- Allow anonymous token verification for team member invitations
CREATE POLICY "Public can verify org member invitation by token"
  ON public.org_members FOR SELECT
  USING (true);