
-- 1. Update save_invoice_on_creation trigger
CREATE OR REPLACE FUNCTION public.save_invoice_on_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_event_title TEXT;
  v_event_start_at TIMESTAMPTZ;
  v_event_poster_url TEXT;
  v_event_venue_id TEXT;
  v_event_partner_venue_id TEXT;
  v_event_organizer_user_id UUID;
  v_event_partner_organizer_id UUID;
  v_amount NUMERIC;
  v_service_fee NUMERIC := 0;
  v_management_fee NUMERIC := 0;
  v_insurance_fee NUMERIC := 0;
  v_customer_email TEXT;
  v_customer_name TEXT;
  v_customer_phone TEXT;
  v_event_id UUID;
  v_type TEXT;
  v_qr_code TEXT;
  v_resolved_venue_id TEXT;
  v_resolved_organizer_id UUID;
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    v_type := 'ticket';
    SELECT total_price, user_email, full_name, phone, event_id, service_fee, insurance_fee, qr_code,
           jsonb_build_array(jsonb_build_object(
             'description', 'Billet',
             'quantity', COALESCE(quantity, 1),
             'unitPrice', COALESCE(unit_price, 0),
             'total', COALESCE(quantity, 1) * COALESCE(unit_price, 0)
           ))
    INTO v_amount, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_insurance_fee, v_qr_code, v_items
    FROM public.tickets WHERE id = NEW.ticket_id;
  ELSIF NEW.table_reservation_id IS NOT NULL THEN
    v_type := 'table';
    SELECT total_price, user_email, full_name, phone, event_id, service_fee, management_fee, qr_code,
           jsonb_build_array(jsonb_build_object(
             'description', 'Table VIP',
             'quantity', 1,
             'unitPrice', COALESCE(deposit, 0),
             'total', COALESCE(deposit, 0)
           ))
    INTO v_amount, v_customer_email, v_customer_name, v_customer_phone, v_event_id, v_service_fee, v_management_fee, v_qr_code, v_items
    FROM public.table_reservations WHERE id = NEW.table_reservation_id;
  ELSIF NEW.order_id IS NOT NULL THEN
    v_type := 'order';
    SELECT total, user_email, event_id, token, items
    INTO v_amount, v_customer_email, v_event_id, v_qr_code, v_items
    FROM public.orders WHERE id = NEW.order_id;
  ELSE
    RETURN NEW;
  END IF;

  IF v_event_id IS NOT NULL THEN
    SELECT title, start_at, poster_url, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id
    INTO v_event_title, v_event_start_at, v_event_poster_url,
         v_event_venue_id, v_event_partner_venue_id, v_event_organizer_user_id, v_event_partner_organizer_id
    FROM public.events WHERE id = v_event_id;
  END IF;

  v_resolved_venue_id := COALESCE(NEW.venue_id, v_event_venue_id, v_event_partner_venue_id);
  v_resolved_organizer_id := COALESCE(NEW.organizer_user_id, v_event_organizer_user_id, v_event_partner_organizer_id);

  INSERT INTO public.invoices (
    venue_id, organizer_user_id, invoice_number, type,
    amount, total_ht, tva,
    service_fee, management_fee, insurance_fee,
    customer_email, customer_name, customer_phone,
    event_id, event_name, event_date, event_poster,
    ticket_id, table_reservation_id, order_id,
    items, qr_code
  ) VALUES (
    v_resolved_venue_id, v_resolved_organizer_id, NEW.invoice_number, v_type,
    COALESCE(v_amount, 0),
    COALESCE(v_amount, 0) / 1.2,
    COALESCE(v_amount, 0) - (COALESCE(v_amount, 0) / 1.2),
    v_service_fee, v_management_fee, v_insurance_fee,
    COALESCE(v_customer_email, ''), v_customer_name, v_customer_phone,
    v_event_id, v_event_title, v_event_start_at, v_event_poster_url,
    NEW.ticket_id, NEW.table_reservation_id, NEW.order_id,
    v_items, v_qr_code
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 2. Replace strict unique constraint with partial unique indexes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_venue_id_invoice_number_key'
  ) THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_venue_id_invoice_number_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_venue_invoicenum_uidx
  ON public.invoices (venue_id, invoice_number)
  WHERE venue_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_organizer_invoicenum_uidx
  ON public.invoices (organizer_user_id, invoice_number)
  WHERE organizer_user_id IS NOT NULL AND venue_id IS NULL;

-- 3. Backfill missing invoice_numbers for paid tickets / confirmed reservations / paid orders
DO $$
DECLARE
  rec RECORD;
  v_invoice_number TEXT;
  v_resolved_venue TEXT;
  v_resolved_organizer UUID;
BEGIN
  FOR rec IN
    SELECT t.id AS ticket_id, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.invoice_numbers inu ON inu.ticket_id = t.id
    WHERE t.status = 'paid' AND inu.id IS NULL
  LOOP
    v_resolved_venue := COALESCE(rec.venue_id, rec.partner_venue_id);
    v_resolved_organizer := COALESCE(rec.organizer_user_id, rec.partner_organizer_id);

    IF v_resolved_venue IS NOT NULL THEN
      v_invoice_number := public.generate_invoice_number(v_resolved_venue::text, NULL::uuid);
    ELSIF v_resolved_organizer IS NOT NULL THEN
      v_invoice_number := public.generate_invoice_number(NULL::text, v_resolved_organizer::uuid);
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.invoice_numbers (venue_id, organizer_user_id, ticket_id, invoice_number)
    VALUES (v_resolved_venue, v_resolved_organizer, rec.ticket_id, v_invoice_number)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR rec IN
    SELECT tr.id AS reservation_id, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    LEFT JOIN public.invoice_numbers inu ON inu.table_reservation_id = tr.id
    WHERE tr.status = 'confirmed' AND inu.id IS NULL
  LOOP
    v_resolved_venue := COALESCE(rec.venue_id, rec.partner_venue_id);
    v_resolved_organizer := COALESCE(rec.organizer_user_id, rec.partner_organizer_id);

    IF v_resolved_venue IS NOT NULL THEN
      v_invoice_number := public.generate_invoice_number(v_resolved_venue::text, NULL::uuid);
    ELSIF v_resolved_organizer IS NOT NULL THEN
      v_invoice_number := public.generate_invoice_number(NULL::text, v_resolved_organizer::uuid);
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.invoice_numbers (venue_id, organizer_user_id, table_reservation_id, invoice_number)
    VALUES (v_resolved_venue, v_resolved_organizer, rec.reservation_id, v_invoice_number)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR rec IN
    SELECT o.id AS order_id, o.venue_id,
           e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    FROM public.orders o
    LEFT JOIN public.events e ON e.id = o.event_id
    LEFT JOIN public.invoice_numbers inu ON inu.order_id = o.id
    WHERE o.status = 'paid' AND inu.id IS NULL
  LOOP
    v_resolved_venue := COALESCE(rec.venue_id, rec.partner_venue_id);
    v_resolved_organizer := COALESCE(rec.organizer_user_id, rec.partner_organizer_id);

    IF v_resolved_venue IS NOT NULL THEN
      v_invoice_number := public.generate_invoice_number(v_resolved_venue::text, NULL::uuid);
    ELSIF v_resolved_organizer IS NOT NULL THEN
      v_invoice_number := public.generate_invoice_number(NULL::text, v_resolved_organizer::uuid);
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.invoice_numbers (venue_id, organizer_user_id, order_id, invoice_number)
    VALUES (v_resolved_venue, v_resolved_organizer, rec.order_id, v_invoice_number)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 4. Backfill purchase_source NULL → 'direct'
UPDATE public.tickets SET purchase_source = 'direct'
WHERE purchase_source IS NULL AND status IN ('paid', 'pending');

UPDATE public.table_reservations SET purchase_source = 'direct'
WHERE purchase_source IS NULL AND status IN ('confirmed', 'pending');
