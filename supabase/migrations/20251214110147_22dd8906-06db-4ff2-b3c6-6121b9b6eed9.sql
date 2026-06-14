-- Create ticket_waitlist table
CREATE TABLE public.ticket_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_round_id UUID NOT NULL REFERENCES public.ticket_rounds(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID,
  position INTEGER NOT NULL DEFAULT 1,
  notified_at TIMESTAMP WITH TIME ZONE,
  expired_at TIMESTAMP WITH TIME ZONE,
  purchased BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(ticket_round_id, email)
);

-- Enable RLS
ALTER TABLE public.ticket_waitlist ENABLE ROW LEVEL SECURITY;

-- Anyone can join waitlist
CREATE POLICY "Anyone can join waitlist" ON public.ticket_waitlist
FOR INSERT WITH CHECK (true);

-- Users can view their own waitlist entries
CREATE POLICY "Users can view their own waitlist entries" ON public.ticket_waitlist
FOR SELECT USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  OR user_id = auth.uid()
);

-- Owners can view waitlist for their events
CREATE POLICY "Owners can view waitlist for their events" ON public.ticket_waitlist
FOR SELECT USING (
  has_role(auth.uid(), 'owner'::app_role) AND EXISTS (
    SELECT 1 FROM events e 
    JOIN venues v ON e.venue_id = v.id 
    WHERE e.id = ticket_waitlist.event_id AND v.owner_id = auth.uid()
  )
);

-- Super admins can manage all
CREATE POLICY "Super admins can manage all waitlist" ON public.ticket_waitlist
FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Add insurance columns to tickets table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS has_insurance BOOLEAN DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS insurance_fee NUMERIC DEFAULT 0;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS refund_amount NUMERIC;