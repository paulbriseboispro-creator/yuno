
CREATE OR REPLACE FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON v.id = e.partner_venue_id OR v.id = e.venue_id
    WHERE e.id = _event_id
      AND v.owner_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_event_partner_organizer(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        OR e.partner_organizer_id = _user_id
        OR public.is_org_team_member(_user_id, COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  )
$$;

DROP POLICY IF EXISTS "Partner venue can view event tickets" ON public.tickets;
CREATE POLICY "Partner venue can view event tickets"
ON public.tickets FOR SELECT
USING (public.is_event_partner_venue_owner(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue can update event tickets" ON public.tickets;
CREATE POLICY "Partner venue can update event tickets"
ON public.tickets FOR UPDATE
USING (public.is_event_partner_venue_owner(auth.uid(), event_id))
WITH CHECK (public.is_event_partner_venue_owner(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner organizer can view event tickets" ON public.tickets;
CREATE POLICY "Partner organizer can view event tickets"
ON public.tickets FOR SELECT
USING (public.is_event_partner_organizer(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner organizer can update event tickets" ON public.tickets;
CREATE POLICY "Partner organizer can update event tickets"
ON public.tickets FOR UPDATE
USING (public.is_event_partner_organizer(auth.uid(), event_id))
WITH CHECK (public.is_event_partner_organizer(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue can view event reservations" ON public.table_reservations;
CREATE POLICY "Partner venue can view event reservations"
ON public.table_reservations FOR SELECT
USING (event_id IS NOT NULL AND public.is_event_partner_venue_owner(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue can update event reservations" ON public.table_reservations;
CREATE POLICY "Partner venue can update event reservations"
ON public.table_reservations FOR UPDATE
USING (event_id IS NOT NULL AND public.is_event_partner_venue_owner(auth.uid(), event_id))
WITH CHECK (event_id IS NOT NULL AND public.is_event_partner_venue_owner(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner organizer can view event reservations" ON public.table_reservations;
CREATE POLICY "Partner organizer can view event reservations"
ON public.table_reservations FOR SELECT
USING (event_id IS NOT NULL AND public.is_event_partner_organizer(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner organizer can update event reservations" ON public.table_reservations;
CREATE POLICY "Partner organizer can update event reservations"
ON public.table_reservations FOR UPDATE
USING (event_id IS NOT NULL AND public.is_event_partner_organizer(auth.uid(), event_id))
WITH CHECK (event_id IS NOT NULL AND public.is_event_partner_organizer(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue can view co-event invoices" ON public.invoices;
CREATE POLICY "Partner venue can view co-event invoices"
ON public.invoices FOR SELECT
USING (event_id IS NOT NULL AND public.is_event_partner_venue_owner(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner organizer can view co-event invoices" ON public.invoices;
CREATE POLICY "Partner organizer can view co-event invoices"
ON public.invoices FOR SELECT
USING (event_id IS NOT NULL AND public.is_event_partner_organizer(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner venue can view co-event invoice_numbers" ON public.invoice_numbers;
CREATE POLICY "Partner venue can view co-event invoice_numbers"
ON public.invoice_numbers FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = invoice_numbers.ticket_id
      AND public.is_event_partner_venue_owner(auth.uid(), t.event_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.table_reservations tr
    WHERE tr.id = invoice_numbers.table_reservation_id
      AND tr.event_id IS NOT NULL
      AND public.is_event_partner_venue_owner(auth.uid(), tr.event_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = invoice_numbers.order_id
      AND o.event_id IS NOT NULL
      AND public.is_event_partner_venue_owner(auth.uid(), o.event_id)
  )
);

DROP POLICY IF EXISTS "Partner organizer can view co-event invoice_numbers" ON public.invoice_numbers;
CREATE POLICY "Partner organizer can view co-event invoice_numbers"
ON public.invoice_numbers FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = invoice_numbers.ticket_id
      AND public.is_event_partner_organizer(auth.uid(), t.event_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.table_reservations tr
    WHERE tr.id = invoice_numbers.table_reservation_id
      AND tr.event_id IS NOT NULL
      AND public.is_event_partner_organizer(auth.uid(), tr.event_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = invoice_numbers.order_id
      AND o.event_id IS NOT NULL
      AND public.is_event_partner_organizer(auth.uid(), o.event_id)
  )
);

DROP POLICY IF EXISTS "Partner organizer can view co-event conversions" ON public.promoter_conversions;
CREATE POLICY "Partner organizer can view co-event conversions"
ON public.promoter_conversions FOR SELECT
USING (event_id IS NOT NULL AND public.is_event_partner_organizer(auth.uid(), event_id));
