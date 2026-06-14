-- Update RLS policy for table_zones to also allow owners assigned via profile.venue_id
DROP POLICY IF EXISTS "Owners can manage their venue table zones" ON public.table_zones;

CREATE POLICY "Owners can manage their venue table zones" 
ON public.table_zones 
FOR ALL 
USING (
  has_role(auth.uid(), 'owner'::app_role) AND (
    is_venue_owner(auth.uid(), venue_id) OR 
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.venue_id = table_zones.venue_id
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND (
    is_venue_owner(auth.uid(), venue_id) OR 
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.venue_id = table_zones.venue_id
    )
  )
);

-- Update RLS policy for table_packs similarly
DROP POLICY IF EXISTS "Owners can manage their venue table packs" ON public.table_packs;

CREATE POLICY "Owners can manage their venue table packs" 
ON public.table_packs 
FOR ALL 
USING (
  has_role(auth.uid(), 'owner'::app_role) AND (
    is_venue_owner(auth.uid(), venue_id) OR 
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.venue_id = table_packs.venue_id
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND (
    is_venue_owner(auth.uid(), venue_id) OR 
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.venue_id = table_packs.venue_id
    )
  )
);

-- Update RLS policy for vip_tables similarly
DROP POLICY IF EXISTS "Owners can manage their venue vip tables" ON public.vip_tables;

CREATE POLICY "Owners can manage their venue vip tables" 
ON public.vip_tables 
FOR ALL 
USING (
  has_role(auth.uid(), 'owner'::app_role) AND (
    is_venue_owner(auth.uid(), venue_id) OR 
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.venue_id = vip_tables.venue_id
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND (
    is_venue_owner(auth.uid(), venue_id) OR 
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.venue_id = vip_tables.venue_id
    )
  )
);