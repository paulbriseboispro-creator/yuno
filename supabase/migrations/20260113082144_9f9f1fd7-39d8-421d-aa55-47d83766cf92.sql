-- Add 'manager' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- Create drink catalog table (global database of drinks)
CREATE TABLE public.drink_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'drink', -- 'drink', 'shot', 'soft'
  image_url text,
  description text,
  alc_pct numeric,
  brand text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.drink_catalog ENABLE ROW LEVEL SECURITY;

-- Everyone can read drink catalog
CREATE POLICY "Anyone can view drink catalog"
  ON public.drink_catalog FOR SELECT
  USING (true);

-- Only super admin (owner@womber.fr) can manage catalog
CREATE POLICY "Super admin can manage drink catalog"
  ON public.drink_catalog FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Create drink requests table (owner requests for new drinks)
CREATE TABLE public.drink_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE NOT NULL,
  requested_by uuid REFERENCES auth.users(id) NOT NULL,
  drink_name text NOT NULL,
  category text NOT NULL DEFAULT 'drink',
  brand text,
  description text,
  image_url text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  admin_notes text,
  catalog_drink_id uuid REFERENCES public.drink_catalog(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.drink_requests ENABLE ROW LEVEL SECURITY;

-- Owners can create and view their own requests
CREATE POLICY "Owners can manage their drink requests"
  ON public.drink_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.venues v 
      WHERE v.id = drink_requests.venue_id 
      AND v.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.venues v 
      WHERE v.id = drink_requests.venue_id 
      AND v.owner_id = auth.uid()
    )
  );

-- Super admin can view and manage all requests
CREATE POLICY "Super admin can manage all drink requests"
  ON public.drink_requests FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Create manager_permissions table
CREATE TABLE public.manager_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  can_manage_events boolean DEFAULT false,
  can_manage_menu boolean DEFAULT false,
  can_manage_staff boolean DEFAULT false,
  can_manage_promoters boolean DEFAULT false,
  can_manage_djs boolean DEFAULT false,
  can_manage_tables boolean DEFAULT false,
  can_manage_tickets boolean DEFAULT false,
  can_view_analytics boolean DEFAULT false,
  can_view_orders boolean DEFAULT false,
  can_view_finance boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(venue_id, user_id)
);

-- Enable RLS
ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;

-- Owners can manage their venue's manager permissions
CREATE POLICY "Owners can manage manager permissions"
  ON public.manager_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.venues v 
      WHERE v.id = manager_permissions.venue_id 
      AND v.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.venues v 
      WHERE v.id = manager_permissions.venue_id 
      AND v.owner_id = auth.uid()
    )
  );

-- Managers can view their own permissions
CREATE POLICY "Managers can view their own permissions"
  ON public.manager_permissions FOR SELECT
  USING (user_id = auth.uid());

-- Add indexes for performance
CREATE INDEX idx_drink_catalog_name ON public.drink_catalog(name);
CREATE INDEX idx_drink_catalog_category ON public.drink_catalog(category);
CREATE INDEX idx_drink_requests_venue ON public.drink_requests(venue_id);
CREATE INDEX idx_drink_requests_status ON public.drink_requests(status);
CREATE INDEX idx_manager_permissions_venue ON public.manager_permissions(venue_id);
CREATE INDEX idx_manager_permissions_user ON public.manager_permissions(user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_drink_catalog_updated_at
  BEFORE UPDATE ON public.drink_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_drink_requests_updated_at
  BEFORE UPDATE ON public.drink_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_manager_permissions_updated_at
  BEFORE UPDATE ON public.manager_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();