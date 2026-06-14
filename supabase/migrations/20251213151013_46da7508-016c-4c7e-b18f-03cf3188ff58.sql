-- Create table for VIP pack presets
CREATE TABLE public.table_pack_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id text NOT NULL,
  name text NOT NULL,
  packs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add foreign key constraint
ALTER TABLE public.table_pack_presets
  ADD CONSTRAINT table_pack_presets_venue_id_fkey 
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.table_pack_presets ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Owners can manage their venue table pack presets"
  ON public.table_pack_presets
  FOR ALL
  USING (
    has_role(auth.uid(), 'owner'::app_role) AND (
      is_venue_owner(auth.uid(), venue_id) OR
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.venue_id = table_pack_presets.venue_id
      )
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role) AND (
      is_venue_owner(auth.uid(), venue_id) OR
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.venue_id = table_pack_presets.venue_id
      )
    )
  );

CREATE POLICY "Super admins can manage all table pack presets"
  ON public.table_pack_presets
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Create trigger for updated_at
CREATE TRIGGER update_table_pack_presets_updated_at
  BEFORE UPDATE ON public.table_pack_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();