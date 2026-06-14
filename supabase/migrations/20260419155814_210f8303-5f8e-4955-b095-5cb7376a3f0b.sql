
CREATE TABLE IF NOT EXISTS public.venue_claim_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id uuid NOT NULL,
  club_name text NOT NULL,
  club_email text NOT NULL,
  club_city text,
  club_address text,
  contact_first_name text,
  contact_last_name text,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  default_split_rules jsonb NOT NULL DEFAULT '{
    "tickets": {"organizer_pct": 100, "venue_pct": 0},
    "tables":  {"organizer_pct": 0,   "venue_pct": 100},
    "drinks":  {"organizer_pct": 0,   "venue_pct": 100}
  }'::jsonb,
  invitation_message text,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  created_owner_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vci_organizer ON public.venue_claim_invitations(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_vci_email ON public.venue_claim_invitations(lower(club_email));
CREATE INDEX IF NOT EXISTS idx_vci_token ON public.venue_claim_invitations(token);
CREATE INDEX IF NOT EXISTS idx_vci_status ON public.venue_claim_invitations(status);

CREATE TRIGGER trg_venue_claim_invitations_updated_at
  BEFORE UPDATE ON public.venue_claim_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.venue_claim_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers manage their own claim invitations"
  ON public.venue_claim_invitations
  FOR ALL
  TO authenticated
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

CREATE POLICY "Admins view all claim invitations"
  ON public.venue_claim_invitations
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Public can read claim invitation by token"
  ON public.venue_claim_invitations
  FOR SELECT
  TO anon, authenticated
  USING (status = 'pending' AND expires_at > now());
