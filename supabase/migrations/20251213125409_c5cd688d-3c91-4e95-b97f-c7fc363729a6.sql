-- Add drink cutoff time option to ticket_rounds
-- This allows owners to set a specific time limit for free drink redemption
ALTER TABLE public.ticket_rounds 
ADD COLUMN IF NOT EXISTS drink_cutoff_time TIME DEFAULT NULL;

-- Add a column to specify which method to use: 'hours_after_start' or 'fixed_time'
ALTER TABLE public.ticket_rounds 
ADD COLUMN IF NOT EXISTS drink_deadline_type TEXT DEFAULT 'hours_after_start' CHECK (drink_deadline_type IN ('hours_after_start', 'fixed_time'));

COMMENT ON COLUMN public.ticket_rounds.drink_cutoff_time IS 'Fixed time limit for drink redemption (e.g., 02:00 for 2AM)';
COMMENT ON COLUMN public.ticket_rounds.drink_deadline_type IS 'Type of deadline: hours_after_start uses drink_deadline_hours, fixed_time uses drink_cutoff_time';