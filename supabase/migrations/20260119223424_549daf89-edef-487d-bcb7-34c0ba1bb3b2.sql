-- Create venue_customers table to track customers per venue
CREATE TABLE public.venue_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  first_visit_at TIMESTAMPTZ DEFAULT now(),
  last_visit_at TIMESTAMPTZ DEFAULT now(),
  total_spent NUMERIC(10,2) DEFAULT 0,
  ticket_count INTEGER DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  table_count INTEGER DEFAULT 0,
  is_banned BOOLEAN DEFAULT false,
  banned_at TIMESTAMPTZ,
  banned_by UUID,
  ban_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id, user_id)
);

-- Create customer_incidents table to track issues with customers
CREATE TABLE public.customer_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_customer_id UUID NOT NULL REFERENCES public.venue_customers(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('refund', 'warning', 'ban', 'unban', 'note')),
  reason TEXT NOT NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  table_reservation_id UUID REFERENCES public.table_reservations(id) ON DELETE SET NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes for efficient queries
CREATE INDEX idx_venue_customers_venue ON public.venue_customers(venue_id);
CREATE INDEX idx_venue_customers_email ON public.venue_customers(email);
CREATE INDEX idx_venue_customers_user ON public.venue_customers(user_id);
CREATE INDEX idx_venue_customers_banned ON public.venue_customers(venue_id, is_banned) WHERE is_banned = true;
CREATE INDEX idx_customer_incidents_customer ON public.customer_incidents(venue_customer_id);
CREATE INDEX idx_customer_incidents_venue ON public.customer_incidents(venue_id);

-- Add refund columns to tickets table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS refunded_by UUID;

-- Add refund columns to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_by UUID;

-- Add refund columns to table_reservations
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS refunded_by UUID;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2);

-- Add can_view_customers permission to manager_permissions
ALTER TABLE public.manager_permissions ADD COLUMN IF NOT EXISTS can_view_customers BOOLEAN DEFAULT false;

-- Enable RLS on new tables
ALTER TABLE public.venue_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_incidents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for venue_customers

-- Owners can manage their venue customers
CREATE POLICY "Owners can manage venue customers"
ON public.venue_customers
FOR ALL
USING (is_venue_owner(auth.uid(), venue_id))
WITH CHECK (is_venue_owner(auth.uid(), venue_id));

-- Managers with permission can view customers
CREATE POLICY "Managers can view customers"
ON public.venue_customers
FOR SELECT
USING (manager_has_permission(auth.uid(), venue_id, 'analytics'));

-- Bouncers can view customers for their venue (to check ban status)
CREATE POLICY "Bouncers can view venue customers"
ON public.venue_customers
FOR SELECT
USING (
  has_role(auth.uid(), 'bouncer') AND 
  venue_id = get_user_venue_id(auth.uid())
);

-- Barmen can view customers for their venue
CREATE POLICY "Barmen can view venue customers"
ON public.venue_customers
FOR SELECT
USING (
  has_role(auth.uid(), 'barman') AND 
  venue_id = get_user_venue_id(auth.uid())
);

-- Super admins can manage all customers
CREATE POLICY "Super admins can manage all customers"
ON public.venue_customers
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- RLS Policies for customer_incidents

-- Owners can manage incidents for their venue
CREATE POLICY "Owners can manage incidents"
ON public.customer_incidents
FOR ALL
USING (is_venue_owner(auth.uid(), venue_id))
WITH CHECK (is_venue_owner(auth.uid(), venue_id));

-- Managers with permission can view incidents
CREATE POLICY "Managers can view incidents"
ON public.customer_incidents
FOR SELECT
USING (manager_has_permission(auth.uid(), venue_id, 'analytics'));

-- Bouncers can insert incidents for their venue
CREATE POLICY "Bouncers can insert incidents"
ON public.customer_incidents
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'bouncer') AND 
  venue_id = get_user_venue_id(auth.uid())
);

-- Bouncers can view incidents for their venue
CREATE POLICY "Bouncers can view incidents"
ON public.customer_incidents
FOR SELECT
USING (
  has_role(auth.uid(), 'bouncer') AND 
  venue_id = get_user_venue_id(auth.uid())
);

-- Barmen can insert incidents for their venue
CREATE POLICY "Barmen can insert incidents"
ON public.customer_incidents
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'barman') AND 
  venue_id = get_user_venue_id(auth.uid())
);

-- Super admins can manage all incidents
CREATE POLICY "Super admins can manage all incidents"
ON public.customer_incidents
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Create function to update venue_customer updated_at
CREATE OR REPLACE FUNCTION public.update_venue_customer_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for venue_customers
CREATE TRIGGER update_venue_customers_updated_at
BEFORE UPDATE ON public.venue_customers
FOR EACH ROW
EXECUTE FUNCTION public.update_venue_customer_updated_at();

-- Create function to get or create venue customer
CREATE OR REPLACE FUNCTION public.get_or_create_venue_customer(
  p_venue_id TEXT,
  p_user_id UUID,
  p_email TEXT,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  -- Try to find existing customer
  SELECT id INTO v_customer_id
  FROM venue_customers
  WHERE venue_id = p_venue_id AND user_id = p_user_id;
  
  -- If not found, create new customer
  IF v_customer_id IS NULL THEN
    INSERT INTO venue_customers (venue_id, user_id, email, first_name, last_name, phone)
    VALUES (p_venue_id, p_user_id, p_email, p_first_name, p_last_name, p_phone)
    RETURNING id INTO v_customer_id;
  ELSE
    -- Update last visit and contact info if provided
    UPDATE venue_customers
    SET 
      last_visit_at = now(),
      first_name = COALESCE(p_first_name, first_name),
      last_name = COALESCE(p_last_name, last_name),
      phone = COALESCE(p_phone, phone)
    WHERE id = v_customer_id;
  END IF;
  
  RETURN v_customer_id;
END;
$$;

-- Create function to check if customer is banned
CREATE OR REPLACE FUNCTION public.is_customer_banned(p_venue_id TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_banned FROM venue_customers WHERE venue_id = p_venue_id AND user_id = p_user_id),
    false
  );
$$;