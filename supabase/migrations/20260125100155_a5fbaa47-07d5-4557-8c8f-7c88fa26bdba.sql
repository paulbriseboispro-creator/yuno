-- Allow owners to view the launch waitlist
CREATE POLICY "Owners can view waitlist"
  ON public.launch_waitlist
  FOR SELECT
  USING (
    has_role(auth.uid(), 'owner'::app_role)
  );

-- Allow owners to export waitlist data (they only need SELECT)
-- No delete policy for owners - only super admins can delete