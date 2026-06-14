
ALTER TABLE public.upsell_cart_rules
  ADD COLUMN IF NOT EXISTS reward_collection TEXT,
  ADD COLUMN IF NOT EXISTS reward_drink_id TEXT,
  ADD COLUMN IF NOT EXISTS free_qty INTEGER NOT NULL DEFAULT 1;
