
-- 1) Fix event_waitlist RLS: drop the SELECT policy that references auth.users
DROP POLICY IF EXISTS "Users can view own waitlist entries" ON public.event_waitlist;

-- Recreate SELECT policy without referencing auth.users
CREATE POLICY "Users can view own waitlist entries"
ON public.event_waitlist
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR lower(email) = lower(auth.jwt()->>'email')
);

-- Also allow owners to continue managing
-- (existing "Owners can manage event waitlist" policy is fine)

-- 2) Add show_in_orders column
ALTER TABLE public.event_waitlist
ADD COLUMN IF NOT EXISTS show_in_orders boolean NOT NULL DEFAULT true;

-- 3) Add unique index on (event_id, user_id) to prevent duplicate account signups
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_waitlist_event_user
ON public.event_waitlist (event_id, user_id)
WHERE user_id IS NOT NULL;
