-- Partnership status enum
DO $$ BEGIN
  CREATE TYPE public.partnership_status AS ENUM ('pending', 'active', 'revoked', 'declined');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.partnership_initiator AS ENUM ('venue', 'organizer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.venue_organizer_partnerships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id UUID NOT NULL,
  status public.partnership_status NOT NULL DEFAULT 'pending',
  initiated_by public.partnership_initiator NOT NULL,
  invitation_message TEXT,
  -- Default split rules. Percentages must sum to 100 per item type.
  -- Shape: { tickets: { organizer_pct, venue_pct }, tables: {...}, drinks: { organizer_pct, venue_pct } }
  -- Drinks default: 0% to organizer (commission only if explicitly set in event override).
  default_split_rules JSONB NOT NULL DEFAULT jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 100, 'venue_pct', 0),
    'tables',  jsonb_build_object('organizer_pct', 0,   'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,   'venue_pct', 100)
  ),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active/pending partnership per (venue, organizer) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_org_partnership_unique_active
  ON public.venue_organizer_partnerships (venue_id, organizer_user_id)
  WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_venue_org_partnership_venue ON public.venue_organizer_partnerships (venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_org_partnership_organizer ON public.venue_organizer_partnerships (organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_venue_org_partnership_status ON public.venue_organizer_partnerships (status);

ALTER TABLE public.venue_organizer_partnerships ENABLE ROW LEVEL SECURITY;

-- Helper function: is the current user a party to this partnership?
CREATE OR REPLACE FUNCTION public.can_access_partnership(_user_id uuid, _venue_id text, _organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_venue_owner(_user_id, _venue_id)
    OR _organizer_user_id = _user_id
    OR public.is_super_admin();
$$;

-- SELECT: venue owner, organizer, or super admin
CREATE POLICY "Partnership readable by parties"
ON public.venue_organizer_partnerships
FOR SELECT
TO authenticated
USING (
  public.can_access_partnership(auth.uid(), venue_id, organizer_user_id)
);

-- INSERT: either party can initiate
CREATE POLICY "Parties can initiate partnership"
ON public.venue_organizer_partnerships
FOR INSERT
TO authenticated
WITH CHECK (
  -- If venue-initiated: caller must own the venue
  (initiated_by = 'venue' AND public.is_venue_owner(auth.uid(), venue_id))
  OR
  -- If organizer-initiated: caller must be the organizer
  (initiated_by = 'organizer' AND organizer_user_id = auth.uid())
);

-- UPDATE: either party (for accept/revoke/split adjustments)
CREATE POLICY "Parties can update partnership"
ON public.venue_organizer_partnerships
FOR UPDATE
TO authenticated
USING (
  public.can_access_partnership(auth.uid(), venue_id, organizer_user_id)
)
WITH CHECK (
  public.can_access_partnership(auth.uid(), venue_id, organizer_user_id)
);

-- DELETE: only super admin (revocation goes through UPDATE -> status='revoked')
CREATE POLICY "Super admin can delete partnership"
ON public.venue_organizer_partnerships
FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- Auto update updated_at
CREATE TRIGGER trg_venue_org_partnership_updated_at
BEFORE UPDATE ON public.venue_organizer_partnerships
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();