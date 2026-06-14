
CREATE TABLE public.event_scarcity_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL UNIQUE,
  low_stock_enabled BOOLEAN DEFAULT true,
  low_stock_percent INTEGER DEFAULT 80,
  low_stock_label TEXT DEFAULT 'few_left',
  show_remaining_count BOOLEAN DEFAULT false,
  display_cap_enabled BOOLEAN DEFAULT false,
  display_cap_value INTEGER DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.event_scarcity_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage scarcity settings"
ON public.event_scarcity_settings
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM events e
    JOIN venues v ON v.id = e.venue_id
    WHERE e.id = event_id AND v.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM events e
    JOIN venues v ON v.id = e.venue_id
    WHERE e.id = event_id AND v.owner_id = auth.uid()
  )
);

CREATE POLICY "Anyone can read scarcity settings"
ON public.event_scarcity_settings
FOR SELECT TO anon, authenticated
USING (true);
