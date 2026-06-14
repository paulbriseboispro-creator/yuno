-- Create helper function to get venue_id from table_reservation
CREATE OR REPLACE FUNCTION public.get_reservation_venue_id(_reservation_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tz.venue_id
  FROM public.table_reservations tr
  JOIN public.table_zones tz ON tz.id = tr.zone_id
  WHERE tr.id = _reservation_id
$$;

-- Create table for VIP consumption tracking
CREATE TABLE public.vip_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_reservation_id UUID REFERENCES public.table_reservations(id) ON DELETE CASCADE NOT NULL,
  venue_id TEXT NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'bottle',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  served_by UUID,
  served_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX idx_vip_consumptions_reservation ON public.vip_consumptions(table_reservation_id);
CREATE INDEX idx_vip_consumptions_venue ON public.vip_consumptions(venue_id);
CREATE INDEX idx_vip_consumptions_served_at ON public.vip_consumptions(served_at);

-- Enable RLS
ALTER TABLE public.vip_consumptions ENABLE ROW LEVEL SECURITY;

-- RLS policies for vip_consumptions
CREATE POLICY "VIP hosts can view consumptions for their venue"
  ON public.vip_consumptions
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'vip_host') AND 
    venue_id = public.get_user_venue_id(auth.uid())
  );

CREATE POLICY "VIP hosts can insert consumptions for their venue"
  ON public.vip_consumptions
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'vip_host') AND 
    venue_id = public.get_user_venue_id(auth.uid())
  );

CREATE POLICY "Owners can manage all consumptions for their venue"
  ON public.vip_consumptions
  FOR ALL
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
  );

CREATE POLICY "Managers can view consumptions for their venue"
  ON public.vip_consumptions
  FOR SELECT
  USING (
    public.can_manage_venue(auth.uid(), venue_id)
  );

-- Add table status tracking to table_reservations
ALTER TABLE public.table_reservations 
ADD COLUMN IF NOT EXISTS vip_status TEXT DEFAULT 'waiting',
ADD COLUMN IF NOT EXISTS placed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS placed_by UUID,
ADD COLUMN IF NOT EXISTS assigned_table_id TEXT,
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- Create table for floor plan layout
CREATE TABLE public.venue_floor_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL UNIQUE,
  layout JSONB NOT NULL DEFAULT '{"tables": []}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS for floor plans
ALTER TABLE public.venue_floor_plans ENABLE ROW LEVEL SECURITY;

-- RLS policies for floor plans
CREATE POLICY "Owners can manage their venue floor plan"
  ON public.venue_floor_plans
  FOR ALL
  USING (public.is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Managers can view floor plans"
  ON public.venue_floor_plans
  FOR SELECT
  USING (public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "VIP hosts can view floor plans for their venue"
  ON public.venue_floor_plans
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'vip_host') AND 
    venue_id = public.get_user_venue_id(auth.uid())
  );

-- Add RLS policies for vip_hosts to view/update table_reservations via zone
CREATE POLICY "VIP hosts can view reservations for their venue"
  ON public.table_reservations
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'vip_host') AND 
    EXISTS (
      SELECT 1 FROM public.table_zones tz 
      WHERE tz.id = table_reservations.zone_id 
      AND tz.venue_id = public.get_user_venue_id(auth.uid())
    )
  );

CREATE POLICY "VIP hosts can update reservations for their venue"
  ON public.table_reservations
  FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'vip_host') AND 
    EXISTS (
      SELECT 1 FROM public.table_zones tz 
      WHERE tz.id = table_reservations.zone_id 
      AND tz.venue_id = public.get_user_venue_id(auth.uid())
    )
  );

-- Enable realtime for vip_consumptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.vip_consumptions;