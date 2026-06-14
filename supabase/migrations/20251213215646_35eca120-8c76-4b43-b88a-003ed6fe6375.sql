-- Fix 1: visitor_sessions - Restrict INSERT to authenticated users only
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Everyone can insert visitor sessions" ON public.visitor_sessions;

-- Create new policy that requires authentication for inserts
CREATE POLICY "Authenticated users can insert visitor sessions"
ON public.visitor_sessions
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Fix 2: security_logs - Restrict INSERT to service role only (not public)
-- The current policy "Service role can insert security_logs" has WITH CHECK (true)
-- which is too permissive. We need to restrict it properly.
DROP POLICY IF EXISTS "Service role can insert security_logs" ON public.security_logs;

-- Create a more restrictive policy - only allow inserts where user_id matches the authenticated user
-- or allow service role (edge functions) to insert for any user
CREATE POLICY "Users can insert their own security logs"
ON public.security_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);