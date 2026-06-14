-- Create event_notes table for storing internal notes about events
CREATE TABLE public.event_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

-- Enable RLS
ALTER TABLE public.event_notes ENABLE ROW LEVEL SECURITY;

-- Create policies - owners can manage their event notes
CREATE POLICY "Owners can manage event notes" 
ON public.event_notes 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON v.id = e.venue_id
    WHERE e.id = event_notes.event_id
    AND v.owner_id = auth.uid()
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_event_notes_updated_at
  BEFORE UPDATE ON public.event_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();