-- Allow anyone to count favorites per venue (for follower counts)
CREATE POLICY "Anyone can count venue favorites"
ON public.favorites
FOR SELECT
USING (true);

-- Drop the old restrictive policy since the new one covers it
DROP POLICY IF EXISTS "Users can view their own favorites" ON public.favorites;