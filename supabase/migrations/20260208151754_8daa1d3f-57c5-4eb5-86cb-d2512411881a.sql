
-- Fix RLS on vip_table_order_items: allow staff to see order items
DROP POLICY IF EXISTS "Order items visible with order access" ON public.vip_table_order_items;
CREATE POLICY "Order items visible with order access" ON public.vip_table_order_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM vip_table_orders o
    WHERE o.id = vip_table_order_items.order_id
    AND (
      o.user_id = auth.uid()
      OR is_venue_owner(auth.uid(), o.venue_id)
      OR is_venue_staff(auth.uid(), o.venue_id)
    )
  )
);

-- Allow clients to see consumptions for their own reservations
CREATE POLICY "Clients can view their own consumptions"
ON public.vip_consumptions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM table_reservations tr
    WHERE tr.id = vip_consumptions.table_reservation_id
    AND tr.user_id = auth.uid()
  )
);
