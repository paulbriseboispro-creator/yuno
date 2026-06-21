-- VIP bottle service: spirits that require a mixer (diluant).
-- When needs_mixer is true, the customer must pick 1..max_mixers mixers at add-to-cart.
-- The per-mixer extra cost is already carried by the mixer item's own `price` column
-- (price 0 = included, price > 0 = supplement), so no extra column is needed for cost.

ALTER TABLE public.vip_menu_items
  ADD COLUMN IF NOT EXISTS needs_mixer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_mixers integer NOT NULL DEFAULT 1;

-- A bottle can never require fewer than 1 mixer choice.
ALTER TABLE public.vip_menu_items
  DROP CONSTRAINT IF EXISTS vip_menu_items_max_mixers_check;
ALTER TABLE public.vip_menu_items
  ADD CONSTRAINT vip_menu_items_max_mixers_check CHECK (max_mixers >= 1);

COMMENT ON COLUMN public.vip_menu_items.needs_mixer IS
  'When true, the customer must select a mixer (diluant) before adding this bottle to cart.';
COMMENT ON COLUMN public.vip_menu_items.max_mixers IS
  'Maximum number of mixers the customer may select for this bottle (only relevant when needs_mixer).';
