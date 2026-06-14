-- Add purchase source tracking for collaboration analytics
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS purchase_source TEXT;

ALTER TABLE public.table_reservations
  ADD COLUMN IF NOT EXISTS purchase_source TEXT;

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_tickets_event_source
  ON public.tickets (event_id, purchase_source) WHERE purchase_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_table_reservations_event_source
  ON public.table_reservations (event_id, purchase_source) WHERE purchase_source IS NOT NULL;

COMMENT ON COLUMN public.tickets.purchase_source IS
  'Source of the purchase: venue_profile, organizer_profile, explore, direct, promoter, dj_profile';
COMMENT ON COLUMN public.table_reservations.purchase_source IS
  'Source of the purchase: venue_profile, organizer_profile, explore, direct, promoter, dj_profile';