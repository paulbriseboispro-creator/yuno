-- Allow anonymous visitors to insert their own session row.
-- Required so analytics capture public/unauthenticated traffic on venue/event pages.
-- SELECT remains restricted to owners/staff/super-admin.
DROP POLICY IF EXISTS "Authenticated users can insert visitor sessions" ON public.visitor_sessions;

CREATE POLICY "Anyone can insert visitor sessions"
ON public.visitor_sessions
FOR INSERT
TO anon, authenticated
WITH CHECK (true);