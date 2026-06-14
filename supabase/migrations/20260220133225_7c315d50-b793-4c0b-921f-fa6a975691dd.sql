-- Allow anyone (including anonymous visitors) to view DJ profiles
CREATE POLICY "Anyone can view dj profiles"
ON public.djs
FOR SELECT
TO public
USING (true);
