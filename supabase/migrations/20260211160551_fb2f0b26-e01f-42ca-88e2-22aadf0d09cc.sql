
-- Remove the overly permissive public INSERT policy on guest_list_entries
DROP POLICY IF EXISTS "Anyone can insert guest list entries" ON public.guest_list_entries;

-- Only allow service_role (edge functions) to insert guest list entries
CREATE POLICY "Service role can insert guest list entries"
  ON public.guest_list_entries FOR INSERT
  TO service_role
  WITH CHECK (true);
