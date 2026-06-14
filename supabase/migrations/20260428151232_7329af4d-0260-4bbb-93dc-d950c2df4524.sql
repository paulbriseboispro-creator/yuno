CREATE POLICY "Public can view active venue subscription plan"
ON public.venue_subscriptions
FOR SELECT
TO anon, authenticated
USING (status IN ('active', 'trialing'));