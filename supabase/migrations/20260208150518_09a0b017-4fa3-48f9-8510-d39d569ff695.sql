-- Create a helper function to check if a user is VIP host staff at a venue
CREATE OR REPLACE FUNCTION public.is_venue_staff(_user_id uuid, _venue_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = _user_id
    AND p.venue_id = _venue_id
    AND ur.role IN ('vip_host', 'barman', 'bouncer', 'manager')
  )
$$;

-- Allow VIP host staff to see orders for their venue
CREATE POLICY "Staff can view venue orders"
ON public.vip_table_orders
FOR SELECT
USING (
  is_venue_staff(auth.uid(), venue_id)
);

-- Allow VIP host staff to update orders for their venue
CREATE POLICY "Staff can update venue orders"
ON public.vip_table_orders
FOR UPDATE
USING (
  is_venue_staff(auth.uid(), venue_id)
);
