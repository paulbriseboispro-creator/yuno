-- Add last tickets threshold to ticket_rounds
ALTER TABLE public.ticket_rounds 
ADD COLUMN IF NOT EXISTS last_tickets_threshold integer DEFAULT 20;

-- Add comment for clarity
COMMENT ON COLUMN public.ticket_rounds.last_tickets_threshold IS 'Percentage of remaining tickets to show "Last Tickets" badge (e.g., 20 means show when 20% or less remaining)';