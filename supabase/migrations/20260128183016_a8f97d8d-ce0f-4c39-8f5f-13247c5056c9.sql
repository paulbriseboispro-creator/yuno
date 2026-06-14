-- Add drink-related columns to ticket_presets
ALTER TABLE public.ticket_presets
ADD COLUMN IF NOT EXISTS includes_drink boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS drink_deadline_type text DEFAULT 'fixed_time',
ADD COLUMN IF NOT EXISTS drink_deadline_hours integer DEFAULT 2,
ADD COLUMN IF NOT EXISTS drink_cutoff_time text DEFAULT '02:00';