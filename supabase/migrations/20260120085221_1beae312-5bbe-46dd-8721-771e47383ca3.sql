-- Create table for individual ticket attendees (for nominative tickets)
CREATE TABLE public.ticket_attendees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  qr_code TEXT NOT NULL,
  entry_scanned BOOLEAN DEFAULT false,
  entry_scanned_at TIMESTAMP WITH TIME ZONE,
  entry_scanned_by UUID,
  drink_redeemed BOOLEAN DEFAULT false,
  drink_redeemed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ticket_attendees ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX idx_ticket_attendees_ticket_id ON public.ticket_attendees(ticket_id);
CREATE INDEX idx_ticket_attendees_qr_code ON public.ticket_attendees(qr_code);

-- RLS Policies
-- Users can view attendees for their own tickets
CREATE POLICY "Users can view their own ticket attendees"
ON public.ticket_attendees
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id AND t.user_id = auth.uid()
  )
);

-- Staff can view all attendees for their venue's events
CREATE POLICY "Staff can view venue ticket attendees"
ON public.ticket_attendees
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.events e ON t.event_id = e.id
    JOIN public.profiles p ON p.venue_id = e.venue_id
    WHERE t.id = ticket_id AND p.id = auth.uid()
  )
);

-- Allow insert via service role (edge function)
CREATE POLICY "Service role can insert attendees"
ON public.ticket_attendees
FOR INSERT
WITH CHECK (true);

-- Allow update for scanning (staff with venue access)
CREATE POLICY "Staff can update ticket attendees"
ON public.ticket_attendees
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    JOIN public.events e ON t.event_id = e.id
    JOIN public.profiles p ON p.venue_id = e.venue_id
    WHERE t.id = ticket_id AND p.id = auth.uid()
  )
);