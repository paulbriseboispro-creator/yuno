-- Create a helper function to check if user is a manager with specific permission for a venue
CREATE OR REPLACE FUNCTION public.manager_has_permission(_user_id uuid, _venue_id text, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.manager_permissions mp
    WHERE mp.user_id = _user_id
    AND mp.venue_id = _venue_id
    AND (
      (_permission = 'events' AND mp.can_manage_events = true) OR
      (_permission = 'menu' AND mp.can_manage_menu = true) OR
      (_permission = 'staff' AND mp.can_manage_staff = true) OR
      (_permission = 'orders' AND mp.can_view_orders = true) OR
      (_permission = 'tickets' AND mp.can_manage_tickets = true) OR
      (_permission = 'tables' AND mp.can_manage_tables = true) OR
      (_permission = 'djs' AND mp.can_manage_djs = true) OR
      (_permission = 'promoters' AND mp.can_manage_promoters = true) OR
      (_permission = 'analytics' AND mp.can_view_analytics = true) OR
      (_permission = 'finance' AND mp.can_view_finance = true)
    )
  )
$$;

-- Create a helper function to check if user can manage a venue (owner OR manager with any permission)
CREATE OR REPLACE FUNCTION public.can_manage_venue(_user_id uuid, _venue_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    -- User is the venue owner
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = _venue_id AND v.owner_id = _user_id
    )
    OR
    -- User is a manager for this venue
    EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.user_id = _user_id AND mp.venue_id = _venue_id
    )
$$;

-- Drop existing events policies and recreate with manager support
DROP POLICY IF EXISTS "Owners can manage their venue events" ON public.events;
DROP POLICY IF EXISTS "Managers can manage events" ON public.events;

-- Events: Allow owners and managers with can_manage_events permission
CREATE POLICY "Owners and managers can insert events"
ON public.events
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'events')
);

CREATE POLICY "Owners and managers can update events"
ON public.events
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'events')
);

CREATE POLICY "Owners and managers can delete events"
ON public.events
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'events')
);

-- Storage policies for event-images bucket
-- First, check existing policies
DROP POLICY IF EXISTS "Venue owners can upload event images" ON storage.objects;
DROP POLICY IF EXISTS "Venue owners can update event images" ON storage.objects;
DROP POLICY IF EXISTS "Venue owners can delete event images" ON storage.objects;
DROP POLICY IF EXISTS "Owners and managers can upload event images" ON storage.objects;
DROP POLICY IF EXISTS "Owners and managers can update event images" ON storage.objects;
DROP POLICY IF EXISTS "Owners and managers can delete event images" ON storage.objects;

-- Create storage policies for event-images that allow owners AND managers
CREATE POLICY "Owners and managers can upload event images"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'event-images'
  AND auth.role() = 'authenticated'
  AND (
    -- Check if user is owner of any venue OR manager with events permission
    EXISTS (SELECT 1 FROM public.venues WHERE owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.manager_permissions WHERE user_id = auth.uid() AND can_manage_events = true)
  )
);

CREATE POLICY "Owners and managers can update event images"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'event-images'
  AND auth.role() = 'authenticated'
  AND (
    EXISTS (SELECT 1 FROM public.venues WHERE owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.manager_permissions WHERE user_id = auth.uid() AND can_manage_events = true)
  )
);

CREATE POLICY "Owners and managers can delete event images"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'event-images'
  AND auth.role() = 'authenticated'
  AND (
    EXISTS (SELECT 1 FROM public.venues WHERE owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.manager_permissions WHERE user_id = auth.uid() AND can_manage_events = true)
  )
);

-- Update drinks table policies for menu management
DROP POLICY IF EXISTS "Owners can manage their venue drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners and managers can insert drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners and managers can update drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners and managers can delete drinks" ON public.drinks;

CREATE POLICY "Owners and managers can insert drinks"
ON public.drinks
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'menu')
);

CREATE POLICY "Owners and managers can update drinks"
ON public.drinks
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'menu')
);

CREATE POLICY "Owners and managers can delete drinks"
ON public.drinks
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'menu')
);

-- Update ticket_rounds policies
DROP POLICY IF EXISTS "Owners can manage ticket rounds" ON public.ticket_rounds;
DROP POLICY IF EXISTS "Owners and managers can insert ticket rounds" ON public.ticket_rounds;
DROP POLICY IF EXISTS "Owners and managers can update ticket rounds" ON public.ticket_rounds;
DROP POLICY IF EXISTS "Owners and managers can delete ticket rounds" ON public.ticket_rounds;

CREATE POLICY "Owners and managers can insert ticket rounds"
ON public.ticket_rounds
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tickets')
    )
  )
);

CREATE POLICY "Owners and managers can update ticket rounds"
ON public.ticket_rounds
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tickets')
    )
  )
);

CREATE POLICY "Owners and managers can delete ticket rounds"
ON public.ticket_rounds
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tickets')
    )
  )
);

-- Update table_zones policies
DROP POLICY IF EXISTS "Owners can manage table zones" ON public.table_zones;
DROP POLICY IF EXISTS "Owners and managers can insert table zones" ON public.table_zones;
DROP POLICY IF EXISTS "Owners and managers can update table zones" ON public.table_zones;
DROP POLICY IF EXISTS "Owners and managers can delete table zones" ON public.table_zones;

CREATE POLICY "Owners and managers can insert table zones"
ON public.table_zones
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can update table zones"
ON public.table_zones
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can delete table zones"
ON public.table_zones
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

-- Update table_packs policies
DROP POLICY IF EXISTS "Owners can manage table packs" ON public.table_packs;
DROP POLICY IF EXISTS "Owners and managers can insert table packs" ON public.table_packs;
DROP POLICY IF EXISTS "Owners and managers can update table packs" ON public.table_packs;
DROP POLICY IF EXISTS "Owners and managers can delete table packs" ON public.table_packs;

CREATE POLICY "Owners and managers can insert table packs"
ON public.table_packs
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can update table packs"
ON public.table_packs
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can delete table packs"
ON public.table_packs
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

-- Update djs policies
DROP POLICY IF EXISTS "Owners can manage DJs" ON public.djs;
DROP POLICY IF EXISTS "Owners and managers can insert djs" ON public.djs;
DROP POLICY IF EXISTS "Owners and managers can update djs" ON public.djs;
DROP POLICY IF EXISTS "Owners and managers can delete djs" ON public.djs;

CREATE POLICY "Owners and managers can insert djs"
ON public.djs
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'djs')
);

CREATE POLICY "Owners and managers can update djs"
ON public.djs
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'djs')
);

CREATE POLICY "Owners and managers can delete djs"
ON public.djs
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'djs')
);

-- Update promoters policies
DROP POLICY IF EXISTS "Owners can manage promoters" ON public.promoters;
DROP POLICY IF EXISTS "Owners and managers can insert promoters" ON public.promoters;
DROP POLICY IF EXISTS "Owners and managers can update promoters" ON public.promoters;
DROP POLICY IF EXISTS "Owners and managers can delete promoters" ON public.promoters;

CREATE POLICY "Owners and managers can insert promoters"
ON public.promoters
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'promoters')
);

CREATE POLICY "Owners and managers can update promoters"
ON public.promoters
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'promoters')
);

CREATE POLICY "Owners and managers can delete promoters"
ON public.promoters
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'promoters')
);