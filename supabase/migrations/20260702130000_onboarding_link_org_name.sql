-- Personalize platform-level organizer onboarding links.
--
-- Owner links already carry a name (the venue exists → venue_name). Organizer
-- links are platform-level (no scope), so the /join page had nothing to show.
-- The super-admin now sets an organization name at generation time, stored in
-- onboarding_links.config->>'organization_name'. Surface it through the existing
-- organizer_name output column so /join can greet "Join <Org> as Organizer".
-- Same signature as before → CREATE OR REPLACE (no DROP needed).

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

  -- Platform-level organizer creation link: use the name the admin chose.
  IF link.role = 'organizer' AND organizer_name IS NULL THEN
    organizer_name := NULLIF(link.config->>'organization_name', '');
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_onboarding_link_public(text) TO anon, authenticated;
