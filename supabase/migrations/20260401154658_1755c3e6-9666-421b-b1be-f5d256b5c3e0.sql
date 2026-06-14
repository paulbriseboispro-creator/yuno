
-- Phase 1: Add placement columns to venues and table_reservations
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS vip_placement_enabled boolean DEFAULT false;

ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS requested_table_id text;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS placement_status text DEFAULT 'none';
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS placement_reviewed_by uuid;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS placement_reviewed_at timestamptz;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS placement_note text;

-- Add background image to floor plans
ALTER TABLE public.venue_floor_plans ADD COLUMN IF NOT EXISTS background_image_url text;
