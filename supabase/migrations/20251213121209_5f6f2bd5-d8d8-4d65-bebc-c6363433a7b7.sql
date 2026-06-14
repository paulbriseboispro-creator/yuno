-- Add fields to ticket_rounds for free drink configuration
ALTER TABLE public.ticket_rounds 
ADD COLUMN IF NOT EXISTS includes_drink boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS drink_deadline_hours integer DEFAULT 2,
ADD COLUMN IF NOT EXISTS allowed_drink_collections text[] DEFAULT ARRAY['drink', 'shot'];

-- Add fields to tickets for drink redemption and entry tracking
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS drink_redeemed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS drink_redeemed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS drink_id text,
ADD COLUMN IF NOT EXISTS drink_name text,
ADD COLUMN IF NOT EXISTS entry_scanned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS entry_scanned_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS entry_scanned_by uuid;

-- Allow bouncers to view tickets for their venue events
CREATE POLICY "Bouncers can view tickets for their venue events"
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

-- Allow bouncers to update tickets for their venue (mark entry scanned)
CREATE POLICY "Bouncers can update tickets for their venue"
ON public.tickets
FOR UPDATE
USING (
  has_role(auth.uid(), 'bouncer'::app_role) 
  AND EXISTS (
    SELECT 1 FROM events e 
    WHERE e.id = tickets.event_id 
    AND e.venue_id = get_user_venue_id(auth.uid())
  )
);

-- Allow bouncers to view events for their venue
CREATE POLICY "Bouncers can view their venue events"
ON public.events
FOR SELECT
USING (
  has_role(auth.uid(), 'bouncer'::app_role) 
  AND venue_id = get_user_venue_id(auth.uid())
);

-- Allow bouncers to view ticket rounds
CREATE POLICY "Bouncers can view ticket rounds"
ON public.ticket_rounds
FOR SELECT
USING (
  has_role(auth.uid(), 'bouncer'::app_role) 
  AND EXISTS (
    SELECT 1 FROM events e 
    WHERE e.id = ticket_rounds.event_id 
    AND e.venue_id = get_user_venue_id(auth.uid())
  )
);

-- Allow bouncers to view venue drinks (for drink selection display)
CREATE POLICY "Bouncers can view venue drinks"
ON public.drinks
FOR SELECT
USING (
  has_role(auth.uid(), 'bouncer'::app_role) 
  AND venue_id = get_user_venue_id(auth.uid())
);