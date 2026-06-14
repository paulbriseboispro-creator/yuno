-- Allow venue staff to create orders
CREATE POLICY "Staff can create orders for venue"
ON public.vip_table_orders
FOR INSERT
WITH CHECK (is_venue_staff(auth.uid(), venue_id));

-- Allow venue staff to add items to orders
CREATE POLICY "Staff can add items to orders"
ON public.vip_table_order_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM vip_table_orders o
    WHERE o.id = vip_table_order_items.order_id
    AND is_venue_staff(auth.uid(), o.venue_id)
  )
);