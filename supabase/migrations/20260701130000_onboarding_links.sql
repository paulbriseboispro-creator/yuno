-- Onboarding links: email-free, role-parameterized self-serve profile creation.
--
-- Existing invitation flows (staff_invitations, owner_invitations, dj_invitations,
-- promoter_invitations, platform_invitations…) all require the inviter to type the
-- invitee's EMAIL, then mail a token. This adds a complementary path: the inviter
-- generates a shareable link that bakes in the role + scope, and the recipient opens
-- it and creates their OWN profile (no email typed by the inviter). One reusable link
-- can onboard many people up to an optional cap; owner links are forced single-use by
-- the create-onboarding-link edge function.
--
-- Reads/writes for the public accept path go through the get_onboarding_link_public
-- RPC (render) + the accept-onboarding-link edge function (service role), so the table
-- itself stays locked down by RLS (no token enumeration).

CREATE TABLE IF NOT EXISTS public.onboarding_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  -- Role granted on redemption. Owner uses venue_id; organizer is platform-level
  -- (both scope columns null); staff/dj/promoter use venue_id XOR organizer_user_id.
  role TEXT NOT NULL CHECK (role IN (
    'owner', 'organizer', 'barman', 'bouncer', 'cloakroom', 'vip_host', 'manager', 'dj', 'promoter'
  )),
  venue_id TEXT REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Carries per-role grant config: manager_permissions, ticket/table commission,
  -- organization_name, stage_name defaults, etc.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  label TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Reuse model. max_uses NULL = unlimited (until expiry / revoke).
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses >= 1),
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '14 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT onboarding_links_token_key UNIQUE (token),
  -- A link never carries both scopes at once.
  CONSTRAINT onboarding_links_scope_check
    CHECK (NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_links_token ON public.onboarding_links (token);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_venue ON public.onboarding_links (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_links_organizer ON public.onboarding_links (organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_links_created_by ON public.onboarding_links (created_by);

-- Redemption log: one row per (link, user). The UNIQUE guard makes re-opening a link
-- idempotent — the same person can't consume a link (or its quota) twice.
CREATE TABLE IF NOT EXISTS public.onboarding_link_redemptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.onboarding_links(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  redeemed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_link_redemptions_unique UNIQUE (link_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_link_redemptions_link ON public.onboarding_link_redemptions (link_id);

-- ---------------------------------------------------------------------------
-- RLS: creators + the relevant venue/org team + super admins manage links.
-- The anonymous accept path never touches these policies (it uses the RPC +
-- service role), so this only governs the dashboard "manage my links" surface.
-- ---------------------------------------------------------------------------
ALTER TABLE public.onboarding_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators manage own onboarding links"
  ON public.onboarding_links FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Venue team manage venue onboarding links"
  ON public.onboarding_links FOR ALL
  TO authenticated
  USING (venue_id IS NOT NULL
         AND (public.is_venue_owner(auth.uid(), venue_id)
              OR public.manager_has_permission(auth.uid(), venue_id, 'staff')))
  WITH CHECK (venue_id IS NOT NULL
         AND (public.is_venue_owner(auth.uid(), venue_id)
              OR public.manager_has_permission(auth.uid(), venue_id, 'staff')));

CREATE POLICY "Organizers manage own onboarding links"
  ON public.onboarding_links FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL
         AND (organizer_user_id = auth.uid()
              OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team')))
  WITH CHECK (organizer_user_id IS NOT NULL
         AND (organizer_user_id = auth.uid()
              OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team')));

CREATE POLICY "Super admins manage all onboarding links"
  ON public.onboarding_links FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

ALTER TABLE public.onboarding_link_redemptions ENABLE ROW LEVEL SECURITY;

-- Link creators (and super admins) can see who redeemed their links. Inserts happen
-- only via the accept-onboarding-link edge function (service role bypasses RLS).
CREATE POLICY "Link owners view redemptions"
  ON public.onboarding_link_redemptions FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.onboarding_links l
      WHERE l.id = onboarding_link_redemptions.link_id
        AND (
          l.created_by = auth.uid()
          OR (l.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), l.venue_id))
          OR (l.organizer_user_id IS NOT NULL AND l.organizer_user_id = auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Public render RPC: lets the /join page show "Join Club X as Barman" without
-- exposing the table (SECURITY DEFINER, returns only safe fields + validity).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_onboarding_link_public(p_token text)
RETURNS TABLE (
  role text,
  label text,
  venue_id text,
  venue_name text,
  venue_cover text,
  organizer_user_id uuid,
  organizer_name text,
  is_valid boolean,
  invalid_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.onboarding_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM public.onboarding_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::uuid, NULL::text, false, 'not_found'::text;
    RETURN;
  END IF;

  role := link.role;
  label := link.label;
  venue_id := link.venue_id;
  organizer_user_id := link.organizer_user_id;
  is_valid := true;
  invalid_reason := NULL;

  IF (NOT link.is_active) OR (link.revoked_at IS NOT NULL) THEN
    is_valid := false; invalid_reason := 'revoked';
  ELSIF link.expires_at < now() THEN
    is_valid := false; invalid_reason := 'expired';
  ELSIF link.max_uses IS NOT NULL AND link.used_count >= link.max_uses THEN
    is_valid := false; invalid_reason := 'full';
  END IF;

  IF link.venue_id IS NOT NULL THEN
    SELECT v.name, v.cover_url INTO venue_name, venue_cover
    FROM public.venues v WHERE v.id = link.venue_id;
  END IF;

  IF link.organizer_user_id IS NOT NULL THEN
    SELECT op.display_name INTO organizer_name
    FROM public.organizer_profiles op WHERE op.user_id = link.organizer_user_id;
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_onboarding_link_public(text) TO anon, authenticated;
