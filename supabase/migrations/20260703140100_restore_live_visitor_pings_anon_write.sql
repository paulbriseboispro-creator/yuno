-- Restore anonymous INSERT/UPDATE on live_visitor_pings.
--
-- Symptom: every event/club/organizer page an anon visitor opens fires a heartbeat
-- upsert into live_visitor_pings and gets 401 (PostgREST 42501 "new row violates
-- row-level security policy"), repeated on mount + every 15s. Confirmed against prod.
--
-- Root cause: the original anon write policies (see 20260428063511) were dropped by a
-- later cleanup and never recreated, so the "live visitors" feature — which is meant
-- to track anonymous clubbers — is blocked at the RLS layer. visitor_sessions still
-- allows anon INSERT, so the two tables drifted out of sync.
--
-- Fix: recreate the anon (+ authenticated) INSERT/UPDATE policies. SELECT stays
-- restricted to authenticated owners/admins (a visitor writes its own ping but must
-- never read the live-visitor table). Idempotent so it is safe to re-run.

ALTER TABLE public.live_visitor_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can upsert their session ping" ON public.live_visitor_pings;
DROP POLICY IF EXISTS "Anyone can update their own session ping" ON public.live_visitor_pings;

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
