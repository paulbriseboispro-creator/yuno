-- Remove the remaining recursive policy on public.profiles
-- This policy references public.profiles inside its own USING clause, triggering 42P17

DROP POLICY IF EXISTS "Venue staff can view assigned user profiles" ON public.profiles;