
ALTER TABLE public.ticket_rounds
ADD COLUMN IF NOT EXISTS entry_deadline TIME DEFAULT NULL;

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS ticket_selling_mode TEXT DEFAULT 'rounds';
