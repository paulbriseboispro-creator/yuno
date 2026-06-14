
-- Table for event co-organization invitations
CREATE TABLE public.event_collab_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organizer_id UUID NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,
  invited_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, declined
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(event_id, organizer_id)
);

-- Enable RLS
ALTER TABLE public.event_collab_invitations ENABLE ROW LEVEL SECURITY;

-- Owners can manage invitations for their venues
CREATE POLICY "Venue owners can manage collab invitations"
ON public.event_collab_invitations
FOR ALL
TO authenticated
USING (public.is_venue_owner(auth.uid(), venue_id))
WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

-- Organizers can view and respond to their invitations
CREATE POLICY "Organizers can view their invitations"
ON public.event_collab_invitations
FOR SELECT
TO authenticated
USING (
  organizer_id IN (SELECT id FROM public.organizers WHERE user_id = auth.uid())
);

CREATE POLICY "Organizers can update their invitations"
ON public.event_collab_invitations
FOR UPDATE
TO authenticated
USING (
  organizer_id IN (SELECT id FROM public.organizers WHERE user_id = auth.uid())
)
WITH CHECK (
  organizer_id IN (SELECT id FROM public.organizers WHERE user_id = auth.uid())
);

-- Managers can view invitations for their venues
CREATE POLICY "Managers can view collab invitations"
ON public.event_collab_invitations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.manager_permissions mp
    WHERE mp.user_id = auth.uid() AND mp.venue_id = event_collab_invitations.venue_id
  )
);
