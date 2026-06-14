-- Table for inviting external (non-Yuno) organizers from a venue
CREATE TABLE IF NOT EXISTS public.organizer_claim_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  organizer_email TEXT NOT NULL,
  organizer_name TEXT,
  contact_first_name TEXT,
  contact_last_name TEXT,
  invitation_message TEXT,
  inviting_venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  invited_by_user_id UUID NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  default_split_rules JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  created_organizer_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_claim_inv_venue ON public.organizer_claim_invitations(inviting_venue_id);
CREATE INDEX IF NOT EXISTS idx_org_claim_inv_email ON public.organizer_claim_invitations(organizer_email);
CREATE INDEX IF NOT EXISTS idx_org_claim_inv_token ON public.organizer_claim_invitations(token);
CREATE INDEX IF NOT EXISTS idx_org_claim_inv_event ON public.organizer_claim_invitations(event_id);

ALTER TABLE public.organizer_claim_invitations ENABLE ROW LEVEL SECURITY;

-- Owner of the inviting venue can manage invitations
CREATE POLICY "Venue owners can view their organizer invitations"
ON public.organizer_claim_invitations
FOR SELECT
USING (
  public.is_venue_owner(auth.uid(), inviting_venue_id)
  OR public.is_super_admin()
);

CREATE POLICY "Venue owners can create organizer invitations"
ON public.organizer_claim_invitations
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), inviting_venue_id)
  AND invited_by_user_id = auth.uid()
);

CREATE POLICY "Venue owners can update their organizer invitations"
ON public.organizer_claim_invitations
FOR UPDATE
USING (
  public.is_venue_owner(auth.uid(), inviting_venue_id)
  OR public.is_super_admin()
);

CREATE POLICY "Venue owners can delete their organizer invitations"
ON public.organizer_claim_invitations
FOR DELETE
USING (
  public.is_venue_owner(auth.uid(), inviting_venue_id)
  OR public.is_super_admin()
);

-- updated_at trigger
DROP TRIGGER IF EXISTS update_organizer_claim_invitations_updated_at ON public.organizer_claim_invitations;
CREATE TRIGGER update_organizer_claim_invitations_updated_at
BEFORE UPDATE ON public.organizer_claim_invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();