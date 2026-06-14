-- Fix RLS for owners updating/deleting events (same logic as INSERT)
DROP POLICY IF EXISTS "Owners can update their venue events" ON public.events;
DROP POLICY IF EXISTS "Owners can delete their venue events" ON public.events;

CREATE POLICY "Owners can update their venue events"
ON public.events
FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role)
  AND (
    is_venue_owner(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.venue_id = public.events.venue_id
    )
  )
);

CREATE POLICY "Owners can delete their venue events"
ON public.events
FOR DELETE
USING (
  has_role(auth.uid(), 'owner'::app_role)
  AND (
    is_venue_owner(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.venue_id = public.events.venue_id
    )
  )
);

-- Create ticket presets table for clubs to save reusable pricing templates
CREATE TABLE public.ticket_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  total_capacity integer NOT NULL DEFAULT 200,
  rounds jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ticket_presets ENABLE ROW LEVEL SECURITY;

-- Owners can manage their venue presets
CREATE POLICY "Owners can manage their venue ticket presets"
ON public.ticket_presets
FOR ALL
USING (
  has_role(auth.uid(), 'owner'::app_role)
  AND (
    is_venue_owner(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.venue_id = public.ticket_presets.venue_id
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role)
  AND (
    is_venue_owner(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.venue_id = public.ticket_presets.venue_id
    )
  )
);

-- Super admins can manage all presets
CREATE POLICY "Super admins can manage all ticket presets"
ON public.ticket_presets
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Add updated_at trigger
CREATE TRIGGER update_ticket_presets_updated_at
BEFORE UPDATE ON public.ticket_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();