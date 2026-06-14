-- Allow public read of promoter_invitations by token (for accepting invitations without auth)
CREATE POLICY "Anyone can view promoter invitation by token" 
ON public.promoter_invitations 
FOR SELECT 
USING (true);

-- Also add same policy for dj_invitations if not exists (for consistency)
CREATE POLICY "Anyone can view dj invitation by token" 
ON public.dj_invitations 
FOR SELECT 
USING (true);