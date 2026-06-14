
-- Allow users to view their own invoices (via linked orders, tickets, or table reservations)
CREATE POLICY "Users can view their own invoices"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    (order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.orders o WHERE o.id = invoices.order_id AND o.user_id = auth.uid()
    ))
    OR
    (ticket_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tickets t WHERE t.id = invoices.ticket_id AND t.user_id = auth.uid()
    ))
    OR
    (table_reservation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.table_reservations tr WHERE tr.id = invoices.table_reservation_id AND tr.user_id = auth.uid()
    ))
  );

-- Allow venue owners and managers to view invoices for their venue
CREATE POLICY "Owners and managers can view venue invoices"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.can_manage_venue(auth.uid(), venue_id)
  );
