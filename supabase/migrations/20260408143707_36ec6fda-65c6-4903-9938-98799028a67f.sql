
-- Make user_id nullable on tickets table for true guest checkout
ALTER TABLE public.tickets ALTER COLUMN user_id DROP NOT NULL;

-- Add guest fields and claim fields to tickets
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS claimed_by_user_id UUID;

-- Make user_id nullable on table_reservations for true guest checkout
ALTER TABLE public.table_reservations ALTER COLUMN user_id DROP NOT NULL;

-- Add guest fields and claim fields to table_reservations
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS claimed_by_user_id UUID;
