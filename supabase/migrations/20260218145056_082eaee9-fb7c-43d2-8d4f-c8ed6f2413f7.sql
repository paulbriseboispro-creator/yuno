
-- Add service_fee column to orders table for storing Yuno service fees on drink orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_fee numeric DEFAULT 0;
