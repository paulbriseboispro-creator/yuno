-- Create invoices table to store complete invoice data with 2-year retention
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Invoice type
  type TEXT NOT NULL CHECK (type IN ('ticket', 'table', 'order')),
  
  -- Amounts
  amount NUMERIC NOT NULL DEFAULT 0,
  total_ht NUMERIC NOT NULL DEFAULT 0,
  tva NUMERIC NOT NULL DEFAULT 0,
  service_fee NUMERIC DEFAULT 0,
  management_fee NUMERIC DEFAULT 0,
  insurance_fee NUMERIC DEFAULT 0,
  
  -- Customer info (stored for historical reference)
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  
  -- Event info (stored for historical reference)
  event_id UUID,
  event_name TEXT,
  event_date TIMESTAMP WITH TIME ZONE,
  event_poster TEXT,
  
  -- Reference to original record (may be deleted later)
  ticket_id UUID,
  table_reservation_id UUID,
  order_id UUID,
  
  -- Items stored as JSON for historical reference
  items JSONB,
  
  -- QR code for invoice
  qr_code TEXT,
  
  -- Retention date (auto-delete after 2 years)
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '2 years'),
  
  UNIQUE(venue_id, invoice_number)
);

-- Create index for faster queries
CREATE INDEX idx_invoices_venue_id ON public.invoices(venue_id);
CREATE INDEX idx_invoices_created_at ON public.invoices(created_at DESC);
CREATE INDEX idx_invoices_expires_at ON public.invoices(expires_at);
CREATE INDEX idx_invoices_type ON public.invoices(type);

-- Enable RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Owners and managers can view their venue's invoices
CREATE POLICY "Venue owners can view invoices"
  ON public.invoices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = invoices.venue_id
      AND v.owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.venue_id = invoices.venue_id
      AND mp.user_id = auth.uid()
      AND mp.can_view_finance = true
    )
  );

-- Only system can insert invoices (via edge functions)
CREATE POLICY "System can insert invoices"
  ON public.invoices
  FOR INSERT
  WITH CHECK (true);

-- Create function to cleanup expired invoices (older than 2 years)
CREATE OR REPLACE FUNCTION public.cleanup_expired_invoices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.invoices
  WHERE expires_at < now();
END;
$$;

-- Create function to save invoice data when invoice_number is created
CREATE OR REPLACE FUNCTION public.save_invoice_on_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_data RECORD;
  v_items JSONB;
  v_event_data RECORD;
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
    INTO v_event_data
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
    v_event_data.title,
    v_event_data.start_at,
    v_event_data.poster_url,
    NEW.ticket_id,
    NEW.table_reservation_id,
    NEW.order_id,
    v_items,
    v_qr_code
  )
  ON CONFLICT (venue_id, invoice_number) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-save invoice data
CREATE TRIGGER save_invoice_trigger
  AFTER INSERT ON public.invoice_numbers
  FOR EACH ROW
  EXECUTE FUNCTION public.save_invoice_on_creation();