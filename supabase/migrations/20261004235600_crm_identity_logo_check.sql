-- Yuno CRM — Réglages : save_crm_identity ne contrôle l'adresse du logo que
-- s'il change. Un logo posé autrefois depuis la Suite (adresse externe) faisait
-- échouer tout enregistrement de l'identité, même un simple changement de ville.

CREATE OR REPLACE FUNCTION public.save_crm_identity(
  p_venue_id text, p_organizer_user_id uuid, p_name text, p_city text, p_logo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_city text := NULLIF(btrim(COALESCE(p_city, '')), '');
  v_logo text := NULLIF(btrim(COALESCE(p_logo_url, '')), '');
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id)
     OR NOT public.crm_user_manages_team(auth.uid(), p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 32 THEN
    RAISE EXCEPTION 'invalid_city' USING ERRCODE = '22023';
  END IF;
  -- Un logo vient de notre stockage public, jamais d'une adresse quelconque
  -- (il part dans chaque e-mail : pas de pixel de suivi tiers).
  -- Seul un logo NOUVEAU est contrôlé : un logo d'avant (posé depuis la Suite)
  -- ne doit pas bloquer un simple changement de ville.
  IF v_logo IS NOT NULL
     AND v_logo IS DISTINCT FROM (public._crm_identity(p_venue_id, p_organizer_user_id)->>'logo_url')
     AND v_logo !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/' THEN
    RAISE EXCEPTION 'invalid_logo' USING ERRCODE = '22023';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    UPDATE public.venues
       SET name = v_name, city = v_city, logo_url = v_logo
     WHERE id = p_venue_id
       AND (name IS DISTINCT FROM v_name OR city IS DISTINCT FROM v_city OR logo_url IS DISTINCT FROM v_logo);
  ELSE
    UPDATE public.organizer_profiles
       SET display_name = v_name, city = v_city, avatar_url = v_logo
     WHERE user_id = p_organizer_user_id
       AND (display_name IS DISTINCT FROM v_name OR city IS DISTINCT FROM v_city OR avatar_url IS DISTINCT FROM v_logo);
    UPDATE public.profiles
       SET organization_name = v_name, organization_logo_url = v_logo
     WHERE id = p_organizer_user_id
       AND (organization_name IS DISTINCT FROM v_name OR organization_logo_url IS DISTINCT FROM v_logo);
  END IF;

  RETURN public.get_crm_settings(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_crm_identity(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_crm_identity(text, uuid, text, text, text) TO authenticated;
