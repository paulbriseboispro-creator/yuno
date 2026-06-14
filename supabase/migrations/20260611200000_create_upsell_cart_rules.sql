
CREATE TABLE IF NOT EXISTS public.upsell_cart_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL,
  trigger_collection TEXT,
  trigger_min_qty INTEGER NOT NULL DEFAULT 1,
  discount_percent NUMERIC,
  addon_drink_id TEXT,
  addon_fixed_price NUMERIC,
  reward_collection TEXT,
  reward_drink_id TEXT,
  free_qty INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upsell_cart_rules_venue_id_idx
  ON public.upsell_cart_rules (venue_id);

ALTER TABLE public.upsell_cart_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue owner full access on upsell_cart_rules"
  ON public.upsell_cart_rules
  FOR ALL
  USING (
    venue_id IN (
      SELECT v.id::text FROM public.venues v WHERE v.owner_id = auth.uid()
    )
  );

CREATE POLICY "public read active upsell_cart_rules"
  ON public.upsell_cart_rules
  FOR SELECT
  USING (is_active = true);
