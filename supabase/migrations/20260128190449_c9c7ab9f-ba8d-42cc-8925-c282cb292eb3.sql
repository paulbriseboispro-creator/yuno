-- Create VIP Quick Items table for venue-configurable quick add items
CREATE TABLE public.vip_quick_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  item_type TEXT DEFAULT 'bottle' CHECK (item_type IN ('bottle', 'extra', 'service')),
  default_price NUMERIC(10, 2) DEFAULT 0,
  position INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vip_quick_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Venue owners can manage their venue's quick items
CREATE POLICY "Venue owners can view their quick items"
ON public.vip_quick_items FOR SELECT
USING (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Venue owners can insert quick items"
ON public.vip_quick_items FOR INSERT
WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Venue owners can update their quick items"
ON public.vip_quick_items FOR UPDATE
USING (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Venue owners can delete their quick items"
ON public.vip_quick_items FOR DELETE
USING (public.is_venue_owner(auth.uid(), venue_id));

-- VIP Hosts (staff with vip_host role for that venue) can read quick items
CREATE POLICY "VIP Hosts can view quick items for their venue"
ON public.vip_quick_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON ur.user_id = p.id
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'vip_host'
    AND p.venue_id = vip_quick_items.venue_id
  )
);