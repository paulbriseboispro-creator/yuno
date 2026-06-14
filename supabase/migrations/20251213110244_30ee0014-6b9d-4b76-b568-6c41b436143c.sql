-- Create table_packs table for VIP table packages within zones
CREATE TABLE public.table_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.table_zones(id) ON DELETE CASCADE NOT NULL,
  venue_id text NOT NULL,
  name text NOT NULL,
  description text,
  base_price numeric NOT NULL,
  base_capacity integer NOT NULL DEFAULT 6,
  extra_person_price numeric DEFAULT 0,
  max_extra_persons integer DEFAULT 0,
  deposit numeric DEFAULT 0,
  included_items text,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.table_packs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Everyone can view active table packs"
ON public.table_packs
FOR SELECT
USING (is_active = true);

CREATE POLICY "Owners can manage their venue table packs"
ON public.table_packs
FOR ALL
USING (has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id))
WITH CHECK (has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Super admins can manage all table packs"
ON public.table_packs
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Add trigger for updated_at
CREATE TRIGGER update_table_packs_updated_at
BEFORE UPDATE ON public.table_packs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update table_reservations to store pack info and guest count
ALTER TABLE public.table_reservations 
ADD COLUMN pack_id uuid REFERENCES public.table_packs(id),
ADD COLUMN zone_id uuid REFERENCES public.table_zones(id),
ADD COLUMN guest_count integer DEFAULT 1,
ADD COLUMN deposit numeric DEFAULT 0;

-- Make table_id nullable since we're now zone/pack based
ALTER TABLE public.table_reservations 
ALTER COLUMN table_id DROP NOT NULL;