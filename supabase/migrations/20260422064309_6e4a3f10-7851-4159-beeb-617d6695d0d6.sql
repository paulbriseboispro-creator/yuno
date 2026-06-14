ALTER TABLE public.revenue_distributions
  ADD COLUMN IF NOT EXISTS primary_transfer_id text,
  ADD COLUMN IF NOT EXISTS primary_transfer_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS primary_transfer_error text,
  ADD COLUMN IF NOT EXISTS primary_transfer_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_group_id text,
  ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'destination';

CREATE INDEX IF NOT EXISTS idx_rev_dist_transfer_group ON public.revenue_distributions(transfer_group_id);