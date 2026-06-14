ALTER TABLE public.revenue_distributions
  ADD COLUMN IF NOT EXISTS stripe_fee_estimated_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_fee_real_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_fee_charge_id text;