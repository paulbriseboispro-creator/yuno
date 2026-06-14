-- Add legal information columns to venues table
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS siret TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS legal_address TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS invoice_prefix TEXT DEFAULT 'FAC';

-- Create invoice_numbers table for tracking unique invoice IDs
CREATE TABLE IF NOT EXISTS public.invoice_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT REFERENCES public.venues(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  table_reservation_id UUID REFERENCES public.table_reservations(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on invoice_numbers
ALTER TABLE public.invoice_numbers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own invoices
CREATE POLICY "Users can view own invoices"
  ON public.invoice_numbers
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.tickets WHERE id = invoice_numbers.ticket_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.table_reservations WHERE id = invoice_numbers.table_reservation_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.orders WHERE id = invoice_numbers.order_id AND user_id = auth.uid())
  );

-- Policy: System can insert invoices (via service role)
CREATE POLICY "Service role can insert invoices"
  ON public.invoice_numbers
  FOR INSERT
  WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_invoice_numbers_ticket ON public.invoice_numbers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_invoice_numbers_table ON public.invoice_numbers(table_reservation_id);
CREATE INDEX IF NOT EXISTS idx_invoice_numbers_order ON public.invoice_numbers(order_id);

-- Function to generate next invoice number for a venue
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_venue_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix TEXT;
  v_year TEXT;
  v_count INT;
  v_invoice_number TEXT;
BEGIN
  -- Get venue prefix or use default
  SELECT COALESCE(invoice_prefix, 'FAC') INTO v_prefix
  FROM venues WHERE id = p_venue_id;
  
  IF v_prefix IS NULL THEN
    v_prefix := 'FAC';
  END IF;
  
  -- Get current year
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Count existing invoices for this venue this year
  SELECT COUNT(*) + 1 INTO v_count
  FROM invoice_numbers
  WHERE venue_id = p_venue_id
  AND created_at >= DATE_TRUNC('year', NOW());
  
  -- Generate invoice number: PREFIX-YYYY-NNNNN
  v_invoice_number := v_prefix || '-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
  
  RETURN v_invoice_number;
END;
$$;