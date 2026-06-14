-- Add new columns to table_reservations for customer information and management fee
ALTER TABLE public.table_reservations
ADD COLUMN IF NOT EXISTS full_name text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS remarks text,
ADD COLUMN IF NOT EXISTS newsletter_opt_in boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS management_fee numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS qr_code text UNIQUE;

-- Create index for QR code lookup
CREATE INDEX IF NOT EXISTS idx_table_reservations_qr_code ON public.table_reservations(qr_code);

-- Comment for documentation
COMMENT ON COLUMN public.table_reservations.management_fee IS 'Processing fee (7% of deposit) paid to platform';
COMMENT ON COLUMN public.table_reservations.qr_code IS 'Unique QR code for bouncer validation';