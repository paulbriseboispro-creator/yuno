
-- Migration: Advanced ticketing features

-- 1. Events table: sales timing columns
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS presale_start_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS public_sale_start_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN DEFAULT false;

-- 2. Event-level waitlist table
CREATE TABLE public.event_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  presale_access BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, email)
);

ALTER TABLE public.event_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join event waitlist" ON public.event_waitlist
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own waitlist entries" ON public.event_waitlist
  FOR SELECT USING (
    auth.uid() = user_id 
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "Owners can manage event waitlist" ON public.event_waitlist
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM events e 
      JOIN venues v ON v.id = e.venue_id 
      WHERE e.id = event_id AND v.owner_id = auth.uid()
    )
  );

-- 3. Group ticket columns on ticket_rounds
ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_size INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS group_label TEXT DEFAULT NULL;

-- 4. Ticket upgrade paths table
CREATE TABLE public.ticket_upgrade_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_round_id UUID NOT NULL REFERENCES public.ticket_rounds(id) ON DELETE CASCADE,
  target_round_id UUID NOT NULL REFERENCES public.ticket_rounds(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, source_round_id, target_round_id)
);

ALTER TABLE public.ticket_upgrade_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view upgrade paths" ON public.ticket_upgrade_paths
  FOR SELECT USING (true);

CREATE POLICY "Owners can manage upgrade paths" ON public.ticket_upgrade_paths
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM events e 
      JOIN venues v ON v.id = e.venue_id 
      WHERE e.id = event_id AND v.owner_id = auth.uid()
    )
  );

-- 5. Upgrade tracking on tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS upgraded_from_ticket_id UUID REFERENCES public.tickets(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_upgrade BOOLEAN DEFAULT false;
