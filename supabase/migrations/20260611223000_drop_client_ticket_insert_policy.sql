-- SECURITY FIX: remove the client-side INSERT policy on public.tickets.
--
-- Tickets are ALWAYS created server-side by edge functions (create-ticket-checkout
-- and friends) using the service role, which bypasses RLS. The old policy:
--
--   CREATE POLICY "Users can create tickets" ON public.tickets
--     FOR INSERT WITH CHECK (auth.uid() = user_id);
--
-- only checked that the row's user_id matched the caller. It placed NO constraint
-- on status, total_price or qr_code, so any authenticated user could insert a row
-- straight from the browser with status='paid', total_price=0 and a self-chosen
-- qr_code, completely bypassing Stripe. At the door the bouncer only checks
-- status='paid' + entry_scanned=false, so a forged row scans as a valid free ticket.
--
-- No legitimate client code path inserts into public.tickets (verified across the
-- frontend), so dropping this policy closes the hole with zero functional impact.
-- Server-side inserts via the service role are unaffected (RLS does not apply to
-- the service role).

DROP POLICY IF EXISTS "Users can create tickets" ON public.tickets;
