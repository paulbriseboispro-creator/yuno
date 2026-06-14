-- VIP Menu Items: Detailed bottles, softs, extras for VIP service
CREATE TABLE public.vip_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'bottle' CHECK (category IN ('champagne', 'vodka', 'whisky', 'gin', 'rum', 'tequila', 'wine', 'cognac', 'soft', 'mixer', 'extra', 'other')),
  brand TEXT,
  volume_cl INTEGER, -- Volume in centiliters (e.g., 75 for standard bottle)
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- VIP Menu Item Eligibility: Which items are available/included for which zones or packs
CREATE TABLE public.vip_menu_eligibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.vip_menu_items(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES public.table_zones(id) ON DELETE CASCADE,
  pack_id UUID REFERENCES public.table_packs(id) ON DELETE CASCADE,
  is_included BOOLEAN DEFAULT false, -- true = included in price, false = available as supplement
  included_quantity INTEGER DEFAULT 0, -- How many are included (0 = just available, not included)
  custom_price NUMERIC(10, 2), -- Override price for this zone/pack (null = use default)
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT eligibility_zone_or_pack CHECK (zone_id IS NOT NULL OR pack_id IS NOT NULL)
);

-- VIP Table Orders: Customer orders via QR code menu
CREATE TABLE public.vip_table_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_reservation_id UUID NOT NULL REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID, -- Customer who placed the order
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'preparing', 'served', 'cancelled')),
  total_amount NUMERIC(10, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID, -- VIP Host who confirmed
  served_at TIMESTAMPTZ
);

-- VIP Table Order Items: Individual items in an order
CREATE TABLE public.vip_table_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.vip_table_orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.vip_menu_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  is_included BOOLEAN DEFAULT false, -- Was this item included in the reservation
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add table_id to reservations for QR code linking
ALTER TABLE public.table_reservations 
ADD COLUMN IF NOT EXISTS table_id TEXT;

-- Enable RLS
ALTER TABLE public.vip_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_menu_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_table_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_table_order_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vip_menu_items
CREATE POLICY "Venue owners can manage their menu items"
ON public.vip_menu_items FOR ALL
USING (public.is_venue_owner(auth.uid(), venue_id))
WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Active menu items are visible to authenticated users"
ON public.vip_menu_items FOR SELECT
TO authenticated
USING (is_active = true);

-- RLS Policies for vip_menu_eligibility  
CREATE POLICY "Venue owners can manage eligibility"
ON public.vip_menu_eligibility FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.vip_menu_items mi 
    WHERE mi.id = menu_item_id 
    AND public.is_venue_owner(auth.uid(), mi.venue_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.vip_menu_items mi 
    WHERE mi.id = menu_item_id 
    AND public.is_venue_owner(auth.uid(), mi.venue_id)
  )
);

CREATE POLICY "Eligibility visible to authenticated users"
ON public.vip_menu_eligibility FOR SELECT
TO authenticated
USING (true);

-- RLS Policies for vip_table_orders
CREATE POLICY "Users can view their own orders"
ON public.vip_table_orders FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Users can create orders for their reservations"
ON public.vip_table_orders FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.table_reservations tr
    WHERE tr.id = table_reservation_id
    AND tr.user_id = auth.uid()
  )
);

CREATE POLICY "Venue owners/staff can update orders"
ON public.vip_table_orders FOR UPDATE
TO authenticated
USING (public.is_venue_owner(auth.uid(), venue_id) OR user_id = auth.uid());

-- RLS Policies for vip_table_order_items
CREATE POLICY "Order items visible with order access"
ON public.vip_table_order_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.vip_table_orders o
    WHERE o.id = order_id
    AND (o.user_id = auth.uid() OR public.is_venue_owner(auth.uid(), o.venue_id))
  )
);

CREATE POLICY "Users can add items to their orders"
ON public.vip_table_order_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.vip_table_orders o
    WHERE o.id = order_id
    AND o.user_id = auth.uid()
    AND o.status = 'pending'
  )
);

-- Enable realtime for orders (VIP host notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE public.vip_table_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vip_table_order_items;

-- Indexes for performance
CREATE INDEX idx_vip_menu_items_venue ON public.vip_menu_items(venue_id);
CREATE INDEX idx_vip_menu_items_category ON public.vip_menu_items(category);
CREATE INDEX idx_vip_menu_eligibility_item ON public.vip_menu_eligibility(menu_item_id);
CREATE INDEX idx_vip_menu_eligibility_zone ON public.vip_menu_eligibility(zone_id);
CREATE INDEX idx_vip_menu_eligibility_pack ON public.vip_menu_eligibility(pack_id);
CREATE INDEX idx_vip_table_orders_reservation ON public.vip_table_orders(table_reservation_id);
CREATE INDEX idx_vip_table_orders_venue_status ON public.vip_table_orders(venue_id, status);
CREATE INDEX idx_vip_table_order_items_order ON public.vip_table_order_items(order_id);