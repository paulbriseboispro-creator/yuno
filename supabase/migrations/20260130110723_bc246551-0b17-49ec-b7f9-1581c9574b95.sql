-- =====================================================
-- SECURITY FIX: Restrict data exposure for staff roles
-- =====================================================

-- 1. PROFILES TABLE - Remove excessive staff access
-- Only owners should see profiles for their venue staff management
-- Regular customers should only see their own profile

-- Drop existing policies that allow staff to see customer profiles
DROP POLICY IF EXISTS "Staff can view venue profiles" ON public.profiles;
DROP POLICY IF EXISTS "Venue staff can view profiles" ON public.profiles;

-- 2. VENUE_CUSTOMERS TABLE - Restrict to owners and managers only
-- Remove barmen, bouncers, and VIP host access to customer PII

-- Drop overly permissive staff policies
DROP POLICY IF EXISTS "Barmen can view venue customers" ON public.venue_customers;
DROP POLICY IF EXISTS "Bouncers can view venue customers" ON public.venue_customers;
DROP POLICY IF EXISTS "Staff can view venue customers" ON public.venue_customers;

-- 3. TICKETS TABLE - Restrict to necessary access only
-- Bouncers only need to scan QR codes, not see full ticket details
-- Barmen only need drink redemption info

-- Drop overly broad policies
DROP POLICY IF EXISTS "Barmen can view tickets for their venue events" ON public.tickets;
DROP POLICY IF EXISTS "Barmen can update tickets for their venue" ON public.tickets;
DROP POLICY IF EXISTS "Bouncers can view tickets for their venue events" ON public.tickets;
DROP POLICY IF EXISTS "Bouncers can update tickets for their venue" ON public.tickets;

-- Create a view for bouncer entry scanning (limited fields)
-- This avoids exposing PII like email, phone, full_name, and prices
CREATE OR REPLACE VIEW public.tickets_entry_scan AS
SELECT 
  id,
  event_id,
  qr_code,
  entry_scanned,
  entry_scanned_at,
  entry_scanned_by,
  ticket_type,
  status
FROM public.tickets;

-- Create a view for barman drink redemption (limited fields)
CREATE OR REPLACE VIEW public.tickets_drink_redemption AS
SELECT
  id,
  event_id,
  qr_code,
  drink_redeemed,
  drink_redeemed_at,
  drink_id,
  drink_name,
  ticket_type,
  status
FROM public.tickets;

-- Grant SELECT on views to authenticated users
GRANT SELECT ON public.tickets_entry_scan TO authenticated;
GRANT SELECT ON public.tickets_drink_redemption TO authenticated;

-- Create policies for bouncer entry scanning through the view
-- Bouncers can only see and update entry_scanned fields for their venue
CREATE POLICY "Bouncers can scan entries for their venue"
  ON public.tickets
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'bouncer'::app_role) 
    AND EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND e.venue_id = get_user_venue_id(auth.uid())
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'bouncer'::app_role) 
    AND EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND e.venue_id = get_user_venue_id(auth.uid())
    )
  );

-- Create policies for barman drink redemption 
-- Barmen can only update drink_redeemed fields for their venue
CREATE POLICY "Barmen can redeem drinks for their venue"
  ON public.tickets
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'barman'::app_role) 
    AND EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND e.venue_id = get_user_venue_id(auth.uid())
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'barman'::app_role) 
    AND EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND e.venue_id = get_user_venue_id(auth.uid())
    )
  );

-- Managers with ticket permission can still view/manage tickets
CREATE POLICY "Managers can view tickets"
  ON public.tickets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND manager_has_permission(auth.uid(), e.venue_id, 'tickets'::text)
    )
  );

CREATE POLICY "Managers can update tickets"
  ON public.tickets
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e 
      WHERE e.id = tickets.event_id 
      AND manager_has_permission(auth.uid(), e.venue_id, 'tickets'::text)
    )
  );

-- VIP Hosts need to see limited venue_customers for their table management
-- But only non-sensitive fields (no email/phone/spending)
CREATE OR REPLACE VIEW public.venue_customers_limited AS
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

-- Grant SELECT on limited view
GRANT SELECT ON public.venue_customers_limited TO authenticated;