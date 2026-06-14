-- Create ticket_rounds table for managing different pricing tiers per event
CREATE TABLE public.ticket_rounds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric NOT NULL,
  max_tickets integer NOT NULL,
  tickets_sold integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  auto_activate boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create tickets table for purchased tickets
CREATE TABLE public.tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_round_id uuid NOT NULL REFERENCES public.ticket_rounds(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_email text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  total_price numeric NOT NULL,
  service_fee numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  qr_code text,
  used boolean NOT NULL DEFAULT false,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  paid_at timestamp with time zone
);

-- Create table_zones table for VIP table zone configuration
CREATE TABLE public.table_zones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric,
  color text NOT NULL DEFAULT '#3b82f6',
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create vip_tables table for individual tables
CREATE TABLE public.vip_tables (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.table_zones(id) ON DELETE SET NULL,
  table_number text NOT NULL,
  price numeric,
  capacity integer NOT NULL DEFAULT 6,
  position_x numeric NOT NULL DEFAULT 0,
  position_y numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create table_reservations table
CREATE TABLE public.table_reservations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES public.vip_tables(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_email text NOT NULL,
  total_price numeric NOT NULL,
  service_fee numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  paid_at timestamp with time zone,
  UNIQUE(table_id, event_id)
);

-- Add ticketing fields to events table
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS ticketing_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS max_tickets integer,
ADD COLUMN IF NOT EXISTS tables_enabled boolean NOT NULL DEFAULT false;

-- Enable RLS on all new tables
ALTER TABLE public.ticket_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vip_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_reservations ENABLE ROW LEVEL SECURITY;

-- ticket_rounds policies
CREATE POLICY "Everyone can view active ticket rounds" ON public.ticket_rounds
  FOR SELECT USING (true);

CREATE POLICY "Owners can manage their venue ticket rounds" ON public.ticket_rounds
  FOR ALL USING (
    has_role(auth.uid(), 'owner'::app_role) AND 
    EXISTS (SELECT 1 FROM public.events e JOIN public.venues v ON e.venue_id = v.id WHERE e.id = event_id AND v.owner_id = auth.uid())
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role) AND 
    EXISTS (SELECT 1 FROM public.events e JOIN public.venues v ON e.venue_id = v.id WHERE e.id = event_id AND v.owner_id = auth.uid())
  );

CREATE POLICY "Super admins can manage all ticket rounds" ON public.ticket_rounds
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- tickets policies
CREATE POLICY "Users can view their own tickets" ON public.tickets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create tickets" ON public.tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can view tickets for their venue events" ON public.tickets
  FOR SELECT USING (
    has_role(auth.uid(), 'owner'::app_role) AND 
    EXISTS (SELECT 1 FROM public.events e JOIN public.venues v ON e.venue_id = v.id WHERE e.id = event_id AND v.owner_id = auth.uid())
  );

CREATE POLICY "Barmen can view tickets for their venue events" ON public.tickets
  FOR SELECT USING (
    has_role(auth.uid(), 'barman'::app_role) AND 
    EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.venue_id = get_user_venue_id(auth.uid()))
  );

CREATE POLICY "Barmen can update tickets for their venue" ON public.tickets
  FOR UPDATE USING (
    has_role(auth.uid(), 'barman'::app_role) AND 
    EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.venue_id = get_user_venue_id(auth.uid()))
  );

CREATE POLICY "Super admins can manage all tickets" ON public.tickets
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- table_zones policies
CREATE POLICY "Everyone can view table zones" ON public.table_zones
  FOR SELECT USING (true);

CREATE POLICY "Owners can manage their venue table zones" ON public.table_zones
  FOR ALL USING (has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Super admins can manage all table zones" ON public.table_zones
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- vip_tables policies
CREATE POLICY "Everyone can view vip tables" ON public.vip_tables
  FOR SELECT USING (true);

CREATE POLICY "Owners can manage their venue vip tables" ON public.vip_tables
  FOR ALL USING (has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (has_role(auth.uid(), 'owner'::app_role) AND is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Super admins can manage all vip tables" ON public.vip_tables
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- table_reservations policies
CREATE POLICY "Users can view their own reservations" ON public.table_reservations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create reservations" ON public.table_reservations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can view reservations for their venue" ON public.table_reservations
  FOR SELECT USING (
    has_role(auth.uid(), 'owner'::app_role) AND 
    EXISTS (SELECT 1 FROM public.vip_tables t JOIN public.venues v ON t.venue_id = v.id WHERE t.id = table_id AND v.owner_id = auth.uid())
  );

CREATE POLICY "Super admins can manage all reservations" ON public.table_reservations
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Enable realtime for ticket_rounds to show live availability
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_rounds;

-- Create trigger for updating ticket_rounds.updated_at
CREATE TRIGGER update_ticket_rounds_updated_at
  BEFORE UPDATE ON public.ticket_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger for updating table_zones.updated_at
CREATE TRIGGER update_table_zones_updated_at
  BEFORE UPDATE ON public.table_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger for updating vip_tables.updated_at
CREATE TRIGGER update_vip_tables_updated_at
  BEFORE UPDATE ON public.vip_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-activate next ticket round when current sells out (fixed version)
CREATE OR REPLACE FUNCTION public.auto_activate_next_round()
RETURNS TRIGGER AS $$
DECLARE
  next_round_id uuid;
BEGIN
  -- If this round just sold out
  IF NEW.tickets_sold >= NEW.max_tickets AND OLD.tickets_sold < OLD.max_tickets THEN
    -- Deactivate this round
    NEW.is_active := false;
    
    -- Find the next round to activate
    SELECT id INTO next_round_id
    FROM public.ticket_rounds
    WHERE event_id = NEW.event_id
      AND position > NEW.position
      AND auto_activate = true
      AND is_active = false
      AND tickets_sold < max_tickets
    ORDER BY position
    LIMIT 1;
    
    -- Activate the next round if found
    IF next_round_id IS NOT NULL THEN
      UPDATE public.ticket_rounds
      SET is_active = true
      WHERE id = next_round_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_auto_activate_next_round
  BEFORE UPDATE ON public.ticket_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_activate_next_round();