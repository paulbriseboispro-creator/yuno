-- Staff self-set PIN, promoter-style invitations (owner + organizer scope).
-- Employees are now invited by email and choose their OWN PIN after login.
-- Mirrors public.promoter_invitations (dual-scope venue_id | organizer_user_id).

CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  -- Exactly one scope is set (enforced by staff_invitations_context_check).
  venue_id TEXT REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')),
  manager_permissions JSONB,
  display_name TEXT,
  invited_by UUID NOT NULL,
  token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  accepted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitations_token_key UNIQUE (token),
  CONSTRAINT staff_invitations_context_check
    CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1)
);

-- One pending row per (email, scope, role) — a person may be invited for several roles.
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_email_venue_role_unique
  ON public.staff_invitations (email, venue_id, role) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_email_organizer_role_unique
  ON public.staff_invitations (email, organizer_user_id, role) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_invitations_token ON public.staff_invitations (token);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_venue ON public.staff_invitations (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_invitations_organizer ON public.staff_invitations (organizer_user_id) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- Owner (or a manager with the "staff" permission) manages venue-scoped invitations.
CREATE POLICY "Owners manage venue staff invitations"
  ON public.staff_invitations FOR ALL
  TO authenticated
  USING (venue_id IS NOT NULL
         AND (public.is_venue_owner(auth.uid(), venue_id)
              OR public.manager_has_permission(auth.uid(), venue_id, 'staff')))
  WITH CHECK (venue_id IS NOT NULL
         AND (public.is_venue_owner(auth.uid(), venue_id)
              OR public.manager_has_permission(auth.uid(), venue_id, 'staff')));

-- Organizer (or an org admin with manage_team) manages organizer-scoped invitations.
CREATE POLICY "Organizers manage own staff invitations"
  ON public.staff_invitations FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL
         AND (organizer_user_id = auth.uid()
              OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team')))
  WITH CHECK (organizer_user_id IS NOT NULL
         AND (organizer_user_id = auth.uid()
              OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team')));

-- The invitee can read their own pending invitation.
CREATE POLICY "Invitee can view own staff invitation"
  ON public.staff_invitations FOR SELECT
  TO authenticated
  USING (email = (SELECT email FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Super admins manage all staff invitations"
  ON public.staff_invitations FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
