-- ============================================================================
-- Comptes vitrine ORGANISATEUR — les liens d'aperçu savent viser un orga.
--
-- Après venue_id (20260826102000), demo_preview_links gagne organizer_user_id :
-- le lien ouvre une session lecture seule DANS le compte fantôme de l'orga
-- (page publique /o/:slug + dashboard /organizer-app). Un lien vise un club OU
-- un orga, jamais les deux.
--
-- FK vers auth.users (PAS organizer_profiles) : le handoff re-parente la PK
-- organizer_profiles.user_id, une FK vers elle sans ON UPDATE CASCADE ferait
-- échouer la réclamation (même piège que organizer_slug_aliases).
-- ============================================================================

ALTER TABLE public.demo_preview_links
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.demo_preview_links
  ADD CONSTRAINT demo_preview_links_one_showcase_target
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_demo_preview_links_org
  ON public.demo_preview_links (organizer_user_id)
  WHERE organizer_user_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_demo_preview_link_public(text);
DROP FUNCTION IF EXISTS public.create_demo_preview_link(text, text, text[], text, timestamptz, text);
DROP FUNCTION IF EXISTS public.verify_demo_preview_password(text, text);

-- RPC 1 — rendu public du gate (anon). Le nom/slug de la vitrine ne sont
-- révélés qu'au porteur du token (64 hex).
CREATE OR REPLACE FUNCTION public.get_demo_preview_link_public(p_token text)
RETURNS TABLE (
  label text,
  target_accounts text[],
  language text,
  venue_id text,
  venue_name text,
  venue_slug text,
  organizer_user_id uuid,
  organizer_name text,
  organizer_slug text,
  is_valid boolean,
  invalid_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.demo_preview_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM public.demo_preview_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::text[], NULL::text,
                        NULL::text, NULL::text, NULL::text,
                        NULL::uuid, NULL::text, NULL::text,
                        false, 'not_found'::text;
    RETURN;
  END IF;

  label := link.label;
  target_accounts := link.target_accounts;
  language := link.language;
  venue_id := link.venue_id;
  venue_name := NULL;
  venue_slug := NULL;
  organizer_user_id := link.organizer_user_id;
  organizer_name := NULL;
  organizer_slug := NULL;
  is_valid := true;
  invalid_reason := NULL;

  IF link.venue_id IS NOT NULL THEN
    SELECT v.name, COALESCE(NULLIF(v.slug, ''), v.id)
      INTO venue_name, venue_slug
      FROM public.venues v WHERE v.id = link.venue_id;
  END IF;

  IF link.organizer_user_id IS NOT NULL THEN
    SELECT op.display_name, op.slug
      INTO organizer_name, organizer_slug
      FROM public.organizer_profiles op WHERE op.user_id = link.organizer_user_id;
  END IF;

  IF (NOT link.is_active) OR (link.revoked_at IS NOT NULL) THEN
    is_valid := false; invalid_reason := 'revoked';
  ELSIF link.expires_at IS NOT NULL AND link.expires_at < now() THEN
    is_valid := false; invalid_reason := 'expired';
  ELSIF link.failed_attempts > 10 THEN
    is_valid := false; invalid_reason := 'locked';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_demo_preview_link_public(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_demo_preview_link_public(text) TO anon, authenticated;

-- RPC 2 — création (super admin only). Une cible vitrine (club OU orga) force
-- le mono-rôle correspondant.
CREATE OR REPLACE FUNCTION public.create_demo_preview_link(
  p_label text,
  p_password text,
  p_target_accounts text[],
  p_language text DEFAULT 'en',
  p_expires_at timestamptz DEFAULT NULL,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accounts text[] := p_target_accounts;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'label required';
  END IF;
  IF length(coalesce(p_password, '')) < 4 THEN
    RAISE EXCEPTION 'password too short';
  END IF;
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'one showcase target only';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venues v
       WHERE v.id = p_venue_id AND v.showcase_shadow_owner_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'venue is not a showcase';
    END IF;
    v_accounts := ARRAY['owner'];
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organizer_profiles op
       WHERE op.user_id = p_organizer_user_id AND op.is_showcase_shadow
    ) THEN
      RAISE EXCEPTION 'organizer is not a showcase';
    END IF;
    v_accounts := ARRAY['organizer'];
  ELSE
    IF v_accounts IS NULL OR cardinality(v_accounts) = 0 THEN
      RAISE EXCEPTION 'at least one role required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_accounts) a
      WHERE a NOT IN ('owner','organizer','bde','promoter','agency','dj',
                      'affiliate','bouncer','barman','cloakroom','vip_host')
    ) THEN
      RAISE EXCEPTION 'invalid target_account';
    END IF;
  END IF;

  IF coalesce(p_language, 'en') NOT IN ('en','fr','es') THEN
    RAISE EXCEPTION 'invalid language';
  END IF;

  INSERT INTO public.demo_preview_links
    (label, target_accounts, target_account, language, password_hash, created_by,
     expires_at, venue_id, organizer_user_id)
  VALUES (
    btrim(p_label),
    v_accounts,
    v_accounts[1],
    coalesce(p_language, 'en'),
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    auth.uid(),
    p_expires_at,
    p_venue_id,
    p_organizer_user_id
  )
  RETURNING demo_preview_links.id, demo_preview_links.token INTO id, token;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_demo_preview_link(text, text, text[], text, timestamptz, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_demo_preview_link(text, text, text[], text, timestamptz, text, uuid) TO authenticated;

-- RPC 3 — vérification du mot de passe (service role only).
CREATE OR REPLACE FUNCTION public.verify_demo_preview_password(p_token text, p_password text)
RETURNS TABLE (ok boolean, target_accounts text[], language text, venue_id text, organizer_user_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.demo_preview_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM public.demo_preview_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, NULL::text, NULL::uuid, 'not_found'::text; RETURN;
  END IF;
  IF (NOT link.is_active) OR (link.revoked_at IS NOT NULL) THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, NULL::text, NULL::uuid, 'revoked'::text; RETURN;
  END IF;
  IF link.expires_at IS NOT NULL AND link.expires_at < now() THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, NULL::text, NULL::uuid, 'expired'::text; RETURN;
  END IF;
  IF link.failed_attempts > 10 THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, NULL::text, NULL::uuid, 'locked'::text; RETURN;
  END IF;

  IF extensions.crypt(coalesce(p_password, ''), link.password_hash) <> link.password_hash THEN
    UPDATE public.demo_preview_links
      SET failed_attempts = failed_attempts + 1
      WHERE id = link.id;
    RETURN QUERY SELECT false, NULL::text[], NULL::text, NULL::text, NULL::uuid, 'wrong_password'::text; RETURN;
  END IF;

  UPDATE public.demo_preview_links
    SET used_count = used_count + 1,
        last_used_at = now(),
        failed_attempts = 0
    WHERE id = link.id;

  RETURN QUERY SELECT true, link.target_accounts, link.language, link.venue_id, link.organizer_user_id, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_demo_preview_password(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_demo_preview_password(text, text) TO service_role;
