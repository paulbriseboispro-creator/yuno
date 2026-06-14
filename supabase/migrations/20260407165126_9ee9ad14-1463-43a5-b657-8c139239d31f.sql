ALTER TABLE public.event_collab_invitations
ADD CONSTRAINT event_collab_invitations_venue_id_fkey
FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;