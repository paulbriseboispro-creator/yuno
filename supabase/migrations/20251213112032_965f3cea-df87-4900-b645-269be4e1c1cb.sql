-- Add floor_plan_url to venues for VIP table layout
ALTER TABLE public.venues 
ADD COLUMN IF NOT EXISTS floor_plan_url text;

-- Add deposit_type to table_packs (fixed or percentage)
ALTER TABLE public.table_packs 
ADD COLUMN IF NOT EXISTS deposit_type text NOT NULL DEFAULT 'fixed' CHECK (deposit_type IN ('fixed', 'percentage'));