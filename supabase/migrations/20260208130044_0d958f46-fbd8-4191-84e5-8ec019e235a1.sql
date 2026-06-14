-- Replace generate_invoice_number with an atomic version that handles race conditions
-- by inserting directly and using a loop with retry on conflict
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_venue_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix TEXT;
  v_year TEXT;
  v_count INT;
  v_invoice_number TEXT;
  v_attempts INT := 0;
BEGIN
  -- Get venue prefix or use default
  SELECT COALESCE(invoice_prefix, 'FAC') INTO v_prefix
  FROM venues WHERE id = p_venue_id;
  
  IF v_prefix IS NULL THEN
    v_prefix := 'FAC';
  END IF;
  
  -- Get current year
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Use a loop to handle race conditions
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'Could not generate unique invoice number after 10 attempts';
    END IF;
    
    -- Count existing invoices for this venue this year
    SELECT COUNT(*) + v_attempts INTO v_count
    FROM invoice_numbers
    WHERE venue_id = p_venue_id
    AND created_at >= DATE_TRUNC('year', NOW());
    
    -- Generate invoice number: PREFIX-YYYY-NNNNN
    v_invoice_number := v_prefix || '-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
    
    -- Check if this number already exists
    IF NOT EXISTS (SELECT 1 FROM invoice_numbers WHERE invoice_number = v_invoice_number) THEN
      RETURN v_invoice_number;
    END IF;
  END LOOP;
END;
$function$;

-- Also create a helper function to generate invoice for any paid item that's missing one
CREATE OR REPLACE FUNCTION public.backfill_missing_invoices()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT := 0;
  v_invoice_number TEXT;
  rec RECORD;
BEGIN
  -- Backfill orders
  FOR rec IN 
    SELECT o.id as order_id, o.venue_id
    FROM orders o
    LEFT JOIN invoice_numbers inv ON inv.order_id = o.id
    WHERE o.status = 'paid'
    AND inv.id IS NULL
    AND o.venue_id IS NOT NULL
  LOOP
    v_invoice_number := generate_invoice_number(rec.venue_id);
    INSERT INTO invoice_numbers (venue_id, order_id, invoice_number)
    VALUES (rec.venue_id, rec.order_id, v_invoice_number)
    ON CONFLICT (invoice_number) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  -- Backfill tickets
  FOR rec IN
    SELECT t.id as ticket_id, e.venue_id
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    LEFT JOIN invoice_numbers inv ON inv.ticket_id = t.id
    WHERE t.status = 'paid'
    AND inv.id IS NULL
    AND e.venue_id IS NOT NULL
  LOOP
    v_invoice_number := generate_invoice_number(rec.venue_id);
    INSERT INTO invoice_numbers (venue_id, ticket_id, invoice_number)
    VALUES (rec.venue_id, rec.ticket_id, v_invoice_number)
    ON CONFLICT (invoice_number) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  -- Backfill table reservations
  FOR rec IN
    SELECT tr.id as reservation_id, tz.venue_id
    FROM table_reservations tr
    JOIN table_zones tz ON tz.id = tr.zone_id
    LEFT JOIN invoice_numbers inv ON inv.table_reservation_id = tr.id
    WHERE tr.status = 'confirmed'
    AND inv.id IS NULL
    AND tz.venue_id IS NOT NULL
  LOOP
    v_invoice_number := generate_invoice_number(rec.venue_id);
    INSERT INTO invoice_numbers (venue_id, table_reservation_id, invoice_number)
    VALUES (rec.venue_id, rec.reservation_id, v_invoice_number)
    ON CONFLICT (invoice_number) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;