-- Update RLS policies for ticket_presets to allow managers with tickets permission
DROP POLICY IF EXISTS "Owners can manage ticket presets" ON public.ticket_presets;
DROP POLICY IF EXISTS "Managers can view ticket presets" ON public.ticket_presets;
DROP POLICY IF EXISTS "Managers can manage ticket presets" ON public.ticket_presets;

CREATE POLICY "Owners and managers can view ticket presets"
ON public.ticket_presets FOR SELECT
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tickets')
);

CREATE POLICY "Owners and managers can insert ticket presets"
ON public.ticket_presets FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tickets')
);

CREATE POLICY "Owners and managers can update ticket presets"
ON public.ticket_presets FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tickets')
);

CREATE POLICY "Owners and managers can delete ticket presets"
ON public.ticket_presets FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tickets')
);

-- Update RLS policies for table_pack_presets to allow managers with tables permission
DROP POLICY IF EXISTS "Owners can manage table pack presets" ON public.table_pack_presets;
DROP POLICY IF EXISTS "Managers can view table pack presets" ON public.table_pack_presets;
DROP POLICY IF EXISTS "Managers can manage table pack presets" ON public.table_pack_presets;

CREATE POLICY "Owners and managers can view table pack presets"
ON public.table_pack_presets FOR SELECT
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can insert table pack presets"
ON public.table_pack_presets FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can update table pack presets"
ON public.table_pack_presets FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

CREATE POLICY "Owners and managers can delete table pack presets"
ON public.table_pack_presets FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), venue_id)
  OR public.manager_has_permission(auth.uid(), venue_id, 'tables')
);

-- Also update event_table_settings for managers
DROP POLICY IF EXISTS "Owners can manage event table settings" ON public.event_table_settings;
DROP POLICY IF EXISTS "Managers can manage event table settings" ON public.event_table_settings;

CREATE POLICY "Owners and managers can view event table settings"
ON public.event_table_settings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tables')
    )
  )
);

CREATE POLICY "Owners and managers can insert event table settings"
ON public.event_table_settings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tables')
    )
  )
);

CREATE POLICY "Owners and managers can update event table settings"
ON public.event_table_settings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tables')
    )
  )
);

CREATE POLICY "Owners and managers can delete event table settings"
ON public.event_table_settings FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
    AND (
      public.is_venue_owner(auth.uid(), e.venue_id)
      OR public.manager_has_permission(auth.uid(), e.venue_id, 'tables')
    )
  )
);