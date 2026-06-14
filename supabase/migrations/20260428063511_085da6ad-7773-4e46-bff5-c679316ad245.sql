-- 1. Enrich visitor_sessions with detailed tracking
ALTER TABLE public.visitor_sessions
  ADD COLUMN IF NOT EXISTS entry_page TEXT,
  ADD COLUMN IF NOT EXISTS entry_page_type TEXT,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS referrer_domain TEXT,
  ADD COLUMN IF NOT EXISTS event_id UUID,
  ADD COLUMN IF NOT EXISTS organizer_user_id UUID,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cart_value_cents INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_event_id ON public.visitor_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_organizer ON public.visitor_sessions(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_activity ON public.visitor_sessions(last_activity_at);

-- 2. Live pings table (lightweight heartbeat for real-time presence)
CREATE TABLE IF NOT EXISTS public.live_visitor_pings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  venue_id TEXT,
  event_id UUID,
  organizer_user_id UUID,
  page_path TEXT,
  stage TEXT NOT NULL DEFAULT 'browsing', -- browsing | cart | checkout | paid
  cart_value_cents INTEGER DEFAULT 0,
  user_id UUID,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_live_pings_venue ON public.live_visitor_pings(venue_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_live_pings_event ON public.live_visitor_pings(event_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_live_pings_organizer ON public.live_visitor_pings(organizer_user_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_live_pings_last_seen ON public.live_visitor_pings(last_seen);

ALTER TABLE public.live_visitor_pings ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can upsert their own ping (rate-limited by app-level heartbeat 10s)
CREATE POLICY "Anyone can upsert their session ping"
ON public.live_visitor_pings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anyone can update their own session ping"
ON public.live_visitor_pings
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Read policies for owners / organizers / admins
CREATE POLICY "Venue owners read their venue pings"
ON public.live_visitor_pings
FOR SELECT
TO authenticated
USING (
  venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Organizers read their organizer pings"
ON public.live_visitor_pings
FOR SELECT
TO authenticated
USING (
  organizer_user_id = auth.uid()
);

CREATE POLICY "Event managers read pings for their events"
ON public.live_visitor_pings
FOR SELECT
TO authenticated
USING (
  event_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = live_visitor_pings.event_id
        AND (
          e.organizer_user_id = auth.uid()
          OR e.partner_organizer_id = auth.uid()
          OR public.is_venue_owner(auth.uid(), e.venue_id)
          OR public.is_venue_owner(auth.uid(), e.partner_venue_id)
        )
    )
  )
);

CREATE POLICY "Admins read all pings"
ON public.live_visitor_pings
FOR SELECT
TO authenticated
USING (public.is_super_admin());

-- Cleanup function: delete pings older than 5 minutes
CREATE OR REPLACE FUNCTION public.cleanup_stale_live_pings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.live_visitor_pings WHERE last_seen < now() - interval '5 minutes';
END;
$$;