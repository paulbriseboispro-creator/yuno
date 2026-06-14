-- Allow authenticated users to update their own visitor sessions
CREATE POLICY "Authenticated users can update visitor sessions"
ON public.visitor_sessions
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Allow anon users to update visitor sessions (for sendBeacon/keepalive calls)
CREATE POLICY "Anon can update visitor sessions"
ON public.visitor_sessions
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Backfill completed_order from actual paid orders
UPDATE visitor_sessions vs
SET completed_order = true
FROM orders o
WHERE o.venue_id = vs.venue_id
AND o.status IN ('paid', 'served')
AND o.user_id IS NOT NULL
AND vs.user_id = o.user_id
AND vs.completed_order = false;

-- Also backfill added_to_cart and proceeded_to_checkout for sessions that have completed orders
-- If someone completed an order, they must have added to cart and proceeded to checkout
UPDATE visitor_sessions
SET added_to_cart = true, proceeded_to_checkout = true
WHERE completed_order = true
AND (added_to_cart = false OR proceeded_to_checkout = false);