-- Drop the existing constraint that prevents null/null
ALTER TABLE public.vip_menu_eligibility DROP CONSTRAINT IF EXISTS eligibility_zone_or_pack;

-- Add new constraint that allows all null (global) or at least one specified
-- This allows: (null, null) for global, (zone, null), (null, pack), (zone, pack)
-- But requires is_included=false when both are null (global extra availability)
ALTER TABLE public.vip_menu_eligibility ADD CONSTRAINT eligibility_valid_config 
CHECK (
  -- Global availability: both null, must be for purchase (not included)
  ((zone_id IS NULL AND pack_id IS NULL AND is_included = false))
  OR
  -- Zone or pack specific: at least one must be set
  (zone_id IS NOT NULL OR pack_id IS NOT NULL)
);

-- Add unique constraint to prevent duplicate global availability per item
CREATE UNIQUE INDEX IF NOT EXISTS vip_menu_eligibility_global_unique 
ON public.vip_menu_eligibility (menu_item_id) 
WHERE zone_id IS NULL AND pack_id IS NULL;

-- Add unique constraint for zone/pack combinations per item
CREATE UNIQUE INDEX IF NOT EXISTS vip_menu_eligibility_combo_unique 
ON public.vip_menu_eligibility (menu_item_id, COALESCE(zone_id, '00000000-0000-0000-0000-000000000000'), COALESCE(pack_id, '00000000-0000-0000-0000-000000000000'))
WHERE zone_id IS NOT NULL OR pack_id IS NOT NULL;