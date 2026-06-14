-- Add included_bottles_quota to table_packs
-- This defines how many bottle "slots" are included in this pack
ALTER TABLE public.table_packs
ADD COLUMN included_bottles_quota INTEGER NOT NULL DEFAULT 0;

-- Comment explaining the logic
COMMENT ON COLUMN public.table_packs.included_bottles_quota IS 'Total number of bottle slots included in this pack. Each menu item can cost 1+ slots.';

-- Rename column in vip_menu_eligibility for clarity (included_quantity -> slots_cost)
-- This represents how many slots this item "costs" from the pack quota
-- We'll keep the column name but add a comment for documentation
COMMENT ON COLUMN public.vip_menu_eligibility.included_quantity IS 'How many bottle slots this item costs from the pack quota. E.g., 1 = standard bottle, 2 = premium bottle counts as 2.';