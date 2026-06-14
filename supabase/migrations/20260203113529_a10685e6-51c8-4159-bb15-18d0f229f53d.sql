-- Add checked_in_at column to track when bouncer scanned the VIP customer
ALTER TABLE public.table_reservations 
ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- Add index for faster queries on checked_in status
CREATE INDEX IF NOT EXISTS idx_table_reservations_checked_in 
ON public.table_reservations(checked_in_at) 
WHERE checked_in_at IS NOT NULL;

-- Comment for clarity
COMMENT ON COLUMN public.table_reservations.checked_in_at IS 'Timestamp when bouncer scanned the VIP customer at entry. NULL means not yet arrived.';