-- Fix the save_invoice_on_creation function to handle orders without events
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
BEGIN
  -- Determine type and fetch related data
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
  
  -- Fetch event data if available
  IF v_event_id IS NOT NULL THEN
    SELECT title, start_at, poster_url
    INTO v_event_title, v_event_start_at, v_event_poster_url
    FROM public.events WHERE id = v_event_id;
  END IF;
  
  -- Insert into invoices table
  INSERT INTO public.invoices (
    venue_id,
    invoice_number,
    type,
    amount,
    total_ht,
    tva,
    service_fee,
    management_fee,
    insurance_fee,
    customer_email,
    customer_name,
    customer_phone,
    event_id,
    event_name,
    event_date,
    event_poster,
    ticket_id,
    table_reservation_id,
    order_id,
    items,
    qr_code
  ) VALUES (
    NEW.venue_id,
    NEW.invoice_number,
    v_type,
    COALESCE(v_amount, 0),
    COALESCE(v_amount, 0) / 1.2,
    COALESCE(v_amount, 0) - (COALESCE(v_amount, 0) / 1.2),
    v_service_fee,
    v_management_fee,
    v_insurance_fee,
    COALESCE(v_customer_email, ''),
    v_customer_name,
    v_customer_phone,
    v_event_id,
    v_event_title,
    v_event_start_at,
    v_event_poster_url,
    NEW.ticket_id,
    NEW.table_reservation_id,
    NEW.order_id,
    v_items,
    v_qr_code
  )
  ON CONFLICT (venue_id, invoice_number) DO NOTHING;
  
  RETURN NEW;
END;
$function$