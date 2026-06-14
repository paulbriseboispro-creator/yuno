-- Create feedback/issues table for tracking problems
CREATE TABLE public.feedback_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id),
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'bug', -- 'bug', 'feature', 'complaint', 'other'
  priority text NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  status text NOT NULL DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
  reported_by uuid REFERENCES auth.users(id),
  assigned_to uuid REFERENCES auth.users(id),
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.feedback_issues ENABLE ROW LEVEL SECURITY;

-- Allow everyone to insert feedback (for reporting issues)
CREATE POLICY "Anyone can create feedback"
ON public.feedback_issues FOR INSERT
WITH CHECK (true);

-- Super admins can view all feedback (we'll use a specific email check)
CREATE POLICY "Super admins can view all feedback"
ON public.feedback_issues FOR SELECT
USING (
  auth.jwt() ->> 'email' IN ('antoine.music@outlook.fr')
);

-- Super admins can update feedback
CREATE POLICY "Super admins can update feedback"
ON public.feedback_issues FOR UPDATE
USING (
  auth.jwt() ->> 'email' IN ('antoine.music@outlook.fr')
);

-- Super admins can delete feedback
CREATE POLICY "Super admins can delete feedback"
ON public.feedback_issues FOR DELETE
USING (
  auth.jwt() ->> 'email' IN ('antoine.music@outlook.fr')
);

-- Create commission tracking table
CREATE TABLE public.venue_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_revenue numeric NOT NULL DEFAULT 0,
  commission_rate numeric NOT NULL DEFAULT 5, -- percentage
  commission_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'invoiced', 'paid'
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.venue_commissions ENABLE ROW LEVEL SECURITY;

-- Super admins only
CREATE POLICY "Super admins can manage commissions"
ON public.venue_commissions FOR ALL
USING (
  auth.jwt() ->> 'email' IN ('antoine.music@outlook.fr')
);

-- Create trigger for updated_at
CREATE TRIGGER update_feedback_issues_updated_at
BEFORE UPDATE ON public.feedback_issues
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_venue_commissions_updated_at
BEFORE UPDATE ON public.venue_commissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() ->> 'email' IN ('antoine.music@outlook.fr')
$$;

-- Add super admin policies for venues (full CRUD)
CREATE POLICY "Super admins can manage all venues"
ON public.venues FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Super admin can view all orders
CREATE POLICY "Super admins can view all orders"
ON public.orders FOR SELECT
USING (is_super_admin());

-- Super admin can view all profiles
CREATE POLICY "Super admins can view all profiles"
ON public.profiles FOR SELECT
USING (is_super_admin());

-- Super admin can update all profiles
CREATE POLICY "Super admins can update all profiles"
ON public.profiles FOR UPDATE
USING (is_super_admin());

-- Super admin can view all user roles
CREATE POLICY "Super admins can view all user roles"
ON public.user_roles FOR SELECT
USING (is_super_admin());

-- Super admin can manage user roles
CREATE POLICY "Super admins can manage user roles"
ON public.user_roles FOR INSERT
WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update user roles"
ON public.user_roles FOR UPDATE
USING (is_super_admin());

CREATE POLICY "Super admins can delete user roles"
ON public.user_roles FOR DELETE
USING (is_super_admin());

-- Super admin can view all visitor sessions
CREATE POLICY "Super admins can view all visitor sessions"
ON public.visitor_sessions FOR SELECT
USING (is_super_admin());

-- Super admin can view all events
CREATE POLICY "Super admins can view all events"
ON public.events FOR SELECT
USING (is_super_admin());

-- Super admin can manage all events
CREATE POLICY "Super admins can manage all events"
ON public.events FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Super admin can view all drinks
CREATE POLICY "Super admins can view all drinks"
ON public.drinks FOR SELECT
USING (is_super_admin());

-- Super admin can manage all drinks
CREATE POLICY "Super admins can manage all drinks"
ON public.drinks FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());