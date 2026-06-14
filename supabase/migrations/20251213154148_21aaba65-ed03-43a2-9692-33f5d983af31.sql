-- Add tables_count to table_zones
ALTER TABLE public.table_zones ADD COLUMN IF NOT EXISTS tables_count integer NOT NULL DEFAULT 1;

-- Create event_table_settings table for event-specific table pricing
CREATE TABLE public.event_table_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  preset_id uuid REFERENCES public.table_pack_presets(id) ON DELETE SET NULL,
  custom_prices jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

-- Enable RLS
ALTER TABLE public.event_table_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for event_table_settings
CREATE POLICY "Everyone can view event table settings"
ON public.event_table_settings
FOR SELECT
USING (true);

CREATE POLICY "Owners can manage their venue event table settings"
ON public.event_table_settings
FOR ALL
USING (
  has_role(auth.uid(), 'owner'::app_role) AND
  EXISTS (
    SELECT 1 FROM events e
    JOIN venues v ON e.venue_id = v.id
    WHERE e.id = event_table_settings.event_id
    AND (v.owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.venue_id = e.venue_id
    ))
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND
  EXISTS (
    SELECT 1 FROM events e
    JOIN venues v ON e.venue_id = v.id
    WHERE e.id = event_table_settings.event_id
    AND (v.owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.venue_id = e.venue_id
    ))
  )
);

CREATE POLICY "Super admins can manage all event table settings"
ON public.event_table_settings
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Add trigger for updated_at
CREATE TRIGGER update_event_table_settings_updated_at
BEFORE UPDATE ON public.event_table_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();