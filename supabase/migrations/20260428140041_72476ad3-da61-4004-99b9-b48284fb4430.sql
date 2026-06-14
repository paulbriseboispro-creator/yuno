-- Allow organizer-only analytics sessions by making venue optional for visitor tracking
ALTER TABLE public.visitor_sessions
  ALTER COLUMN venue_id DROP NOT NULL;

-- Backfill device type for historical analytics rows created before detailed tracking existed
UPDATE public.visitor_sessions
SET device_type = CASE
  WHEN user_agent ~* '(ipad|tablet|playbook|silk)' THEN 'tablet'
  WHEN user_agent ~* '(mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile)' THEN 'mobile'
  ELSE 'desktop'
END
WHERE device_type IS NULL
  AND user_agent IS NOT NULL;

-- Backfill a conservative source category for historical rows
UPDATE public.visitor_sessions
SET referrer_category = CASE
  WHEN COALESCE(referrer, '') = '' AND COALESCE(referrer_domain, '') = '' THEN 'direct'
  WHEN COALESCE(referrer_domain, '') ~* '(yunoapp\.eu|yuno-bar-buddy|lovable\.app)' THEN 'internal'
  WHEN COALESCE(referrer_domain, '') ~* '(google|bing|duckduckgo|yahoo|ecosia|qwant|baidu)\.' THEN 'search'
  WHEN COALESCE(referrer_domain, '') ~* '(instagram|facebook|fb\.com|tiktok|twitter|x\.com|snapchat|linkedin|pinterest|youtube|reddit|threads)' THEN 'social'
  WHEN COALESCE(referrer_domain, '') ~* '(mail|gmail|outlook|yahoo\.mail)' THEN 'email'
  ELSE 'referral'
END
WHERE referrer_category IS NULL;

-- Let organizers read the analytics sessions that belong to their ecosystem.
-- This covers directly-tagged organizer pages, event pages, and host/partner venues for organizer events.
CREATE POLICY "Organizers can view relevant visitor sessions"
ON public.visitor_sessions
FOR SELECT
TO authenticated
USING (
  organizer_user_id = auth.uid()
  OR (
    event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = visitor_sessions.event_id
        AND (e.organizer_user_id = auth.uid() OR e.partner_organizer_id = auth.uid())
    )
  )
  OR (
    venue_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE (e.venue_id = visitor_sessions.venue_id OR e.partner_venue_id = visitor_sessions.venue_id)
        AND (e.organizer_user_id = auth.uid() OR e.partner_organizer_id = auth.uid())
    )
  )
);

-- Same access model for live visitor pings used by the Pulse tab.
CREATE POLICY "Organizers can view relevant venue pings"
ON public.live_visitor_pings
FOR SELECT
TO authenticated
USING (
  organizer_user_id = auth.uid()
  OR (
    event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = live_visitor_pings.event_id
        AND (e.organizer_user_id = auth.uid() OR e.partner_organizer_id = auth.uid())
    )
  )
  OR (
    venue_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE (e.venue_id = live_visitor_pings.venue_id OR e.partner_venue_id = live_visitor_pings.venue_id)
        AND (e.organizer_user_id = auth.uid() OR e.partner_organizer_id = auth.uid())
    )
  )
);