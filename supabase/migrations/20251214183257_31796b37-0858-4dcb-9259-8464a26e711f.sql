-- Add entry scanning fields to table_reservations (like tickets have)
ALTER TABLE public.table_reservations 
ADD COLUMN IF NOT EXISTS entry_scanned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS entry_scanned_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS entry_scanned_by uuid;