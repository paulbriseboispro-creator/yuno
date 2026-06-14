-- =============================================
-- PLATFORM INVITATIONS (admin invites orga/BDE)
-- =============================================
CREATE TABLE IF NOT EXISTS public.platform_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('organizer', 'bde', 'private_organizer')),
  organization_name TEXT,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invitations_email ON public.platform_invitations(email);
CREATE INDEX IF NOT EXISTS idx_platform_invitations_token ON public.platform_invitations(token);
CREATE INDEX IF NOT EXISTS idx_platform_invitations_status ON public.platform_invitations(status);

ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all platform invitations"
  ON public.platform_invitations FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- =============================================
-- ORG MEMBERS (multi-admin teams)
-- =============================================
CREATE TABLE IF NOT EXISTS public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'scanner')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitation_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invitation_status TEXT NOT NULL DEFAULT 'pending' CHECK (invitation_status IN ('pending', 'accepted', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_members_orga_member
  ON public.org_members(organizer_user_id, member_user_id)
  WHERE member_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_members_orga ON public.org_members(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_member ON public.org_members(member_user_id);

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers manage their team"
  ON public.org_members FOR ALL
  TO authenticated
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

CREATE POLICY "Members view their membership"
  ON public.org_members FOR SELECT
  TO authenticated
  USING (member_user_id = auth.uid());

-- Helper: check if user is a team member of an organizer
CREATE OR REPLACE FUNCTION public.is_org_team_member(_user_id UUID, _organizer_user_id UUID, _min_role TEXT DEFAULT 'scanner')
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organizer_user_id = _organizer_user_id
      AND member_user_id = _user_id
      AND invitation_status = 'accepted'
      AND CASE _min_role
        WHEN 'admin' THEN role = 'admin'
        WHEN 'editor' THEN role IN ('admin', 'editor')
        ELSE TRUE
      END
  )
$$;

-- =============================================
-- ORGANIZER PROFILES (public pages)
-- =============================================
CREATE TABLE IF NOT EXISTS public.organizer_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  slug TEXT UNIQUE,
  bio TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  instagram_url TEXT,
  website_url TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizer_profiles_slug ON public.organizer_profiles(slug);

ALTER TABLE public.organizer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public organizer profiles are viewable"
  ON public.organizer_profiles FOR SELECT
  USING (is_public = true);

CREATE POLICY "Organizers manage their own profile"
  ON public.organizer_profiles FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Slug generator
CREATE OR REPLACE FUNCTION public.generate_organizer_profile_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(NEW.display_name, '[^a-zA-Z0-9\-]', '-', 'g'),
        '-+', '-', 'g'
      )
    ) || '-' || SUBSTRING(NEW.user_id::text FROM 1 FOR 4);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizer_profiles_slug_trigger ON public.organizer_profiles;
CREATE TRIGGER organizer_profiles_slug_trigger
  BEFORE INSERT ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_organizer_profile_slug();

DROP TRIGGER IF EXISTS organizer_profiles_updated_at ON public.organizer_profiles;
CREATE TRIGGER organizer_profiles_updated_at
  BEFORE UPDATE ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- EVENTS: access codes
-- =============================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS access_code TEXT,
  ADD COLUMN IF NOT EXISTS requires_access_code BOOLEAN NOT NULL DEFAULT false;

-- =============================================
-- EVENTS: quality check trigger for is_discoverable
-- =============================================
CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only auto-evaluate organizer-owned events; club events keep their existing behavior
  IF NEW.organizer_user_id IS NOT NULL AND NEW.venue_id IS NULL THEN
    IF NEW.visibility = 'public'
       AND NEW.poster_url IS NOT NULL
       AND LENGTH(COALESCE(NEW.title, '')) >= 10
       AND LENGTH(COALESCE(NEW.description, '')) >= 50
       AND NEW.start_at IS NOT NULL
       AND NEW.start_at > now()
       AND NEW.is_active = true
    THEN
      NEW.is_discoverable := true;
    ELSE
      NEW.is_discoverable := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_quality_check_trigger ON public.events;
CREATE TRIGGER events_quality_check_trigger
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.evaluate_event_discoverability();

-- =============================================
-- EVENTS RLS: allow team members to manage organizer's events
-- =============================================
DROP POLICY IF EXISTS "Org team can view events" ON public.events;
CREATE POLICY "Org team can view events"
  ON public.events FOR SELECT
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND public.is_org_team_member(auth.uid(), organizer_user_id, 'scanner')
  );

DROP POLICY IF EXISTS "Org team editors can update events" ON public.events;
CREATE POLICY "Org team editors can update events"
  ON public.events FOR UPDATE
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND public.is_org_team_member(auth.uid(), organizer_user_id, 'editor')
  )
  WITH CHECK (
    organizer_user_id IS NOT NULL
    AND public.is_org_team_member(auth.uid(), organizer_user_id, 'editor')
  );