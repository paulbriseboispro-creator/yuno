-- =====================================================
-- FIX: Convert views to use security_invoker = on
-- This ensures views respect the querying user's RLS policies
-- =====================================================

-- Drop and recreate views with security_invoker
DROP VIEW IF EXISTS public.tickets_entry_scan;
DROP VIEW IF EXISTS public.tickets_drink_redemption;
DROP VIEW IF EXISTS public.venue_customers_limited;

-- Recreate tickets_entry_scan with security_invoker
CREATE VIEW public.tickets_entry_scan 
WITH (security_invoker = on)
AS
SELECT 
  t.id,
  t.event_id,
  t.qr_code,
  t.entry_scanned,
  t.entry_scanned_at,
  t.entry_scanned_by,
  t.ticket_type,
  t.status,
  e.venue_id
FROM public.tickets t
JOIN public.events e ON e.id = t.event_id;

-- Recreate tickets_drink_redemption with security_invoker
CREATE VIEW public.tickets_drink_redemption
WITH (security_invoker = on)
AS
SELECT
  t.id,
  t.event_id,
  t.qr_code,
  t.drink_redeemed,
  t.drink_redeemed_at,
  t.drink_id,
  t.drink_name,
  t.ticket_type,
  t.status,
  e.venue_id
FROM public.tickets t
JOIN public.events e ON e.id = t.event_id;

-- Recreate venue_customers_limited with security_invoker
CREATE VIEW public.venue_customers_limited
WITH (security_invoker = on)
AS
SELECT
  id,
  user_id,
  venue_id,
  first_name,
  last_name,
  is_banned,
  customer_segment,
  first_visit_at,
  last_visit_at
FROM public.venue_customers;

-- Grant SELECT on views to authenticated users
GRANT SELECT ON public.tickets_entry_scan TO authenticated;
GRANT SELECT ON public.tickets_drink_redemption TO authenticated;
GRANT SELECT ON public.venue_customers_limited TO authenticated;

-- Now add SELECT policies for bouncers and barmen to use the limited views
-- (They still need SELECT on the base table for the views to work through RLS)

-- Bouncer can SELECT only for entry scanning purpose (limited by view fields)
CREATE POLICY "Bouncers can view tickets for entry scan"
  ON public.tickets
  FOR SELECT
  USING (
    has_role(auth.uid(), 'bouncer'::app_role) 
    AND EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND e.venue_id = get_user_venue_id(auth.uid())
    )
  );

-- Barmen can SELECT only for drink redemption purpose (limited by view fields)
CREATE POLICY "Barmen can view tickets for drink redemption"
  ON public.tickets
  FOR SELECT
  USING (
    has_role(auth.uid(), 'barman'::app_role) 
    AND EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND e.venue_id = get_user_venue_id(auth.uid())
    )
  );

-- VIP Hosts can view limited customer info for their venue
CREATE POLICY "VIP hosts can view limited customer info"
  ON public.venue_customers
  FOR SELECT
  USING (
    has_role(auth.uid(), 'vip_host'::app_role) 
    AND venue_id = get_user_venue_id(auth.uid())
  );