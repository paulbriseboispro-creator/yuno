
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS cancellation_insurance_enabled boolean NOT NULL DEFAULT true;
