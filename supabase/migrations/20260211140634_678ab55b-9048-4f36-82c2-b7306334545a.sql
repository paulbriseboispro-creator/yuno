-- Fix: Owner SELECT policy on table_reservations uses vip_tables.table_id,
-- but pack-based reservations use zone_id (table_id is NULL).
-- Replace with a policy that checks via both table_id AND zone_id.

DROP POLICY IF EXISTS "Owners can view reservations for their venue" ON public.table_reservations;

CREATE POLICY "Owners can view reservations for their venue"
ON public.table_reservations
FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) AND (
    -- Check via events → venues (most reliable, works for all reservation types)
    EXISTS (
      SELECT 1 FROM events e
      JOIN venues v ON e.venue_id = v.id
      WHERE e.id = table_reservations.event_id
      AND v.owner_id = auth.uid()
    )
  )
);