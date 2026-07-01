-- Système d'agence autonome — Phase 1 (5) : onboarding via RPC (pas de nouvelle
-- edge function → contourne le cap 402). L'utilisateur crée son agence et reçoit
-- le rôle 'agency' ; un super admin peut la créer pour le compte d'un tiers.

CREATE OR REPLACE FUNCTION public.create_agency(
  p_name text,
  p_owner_user_id uuid DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_contact_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_id uuid;
  v_email text;
BEGIN
  v_owner := COALESCE(p_owner_user_id, auth.uid());

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no owner resolved';
  END IF;
  IF v_owner <> auth.uid() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized to create an agency for another user';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'agency name required';
  END IF;

  INSERT INTO public.agencies (owner_user_id, name, city, slug, contact_email)
  VALUES (v_owner, trim(p_name), p_city, NULLIF(trim(COALESCE(p_slug, '')), ''), p_contact_email)
  RETURNING id INTO v_id;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_owner;

  INSERT INTO public.user_roles (user_id, role, email)
  VALUES (v_owner, 'agency', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_agency(text, uuid, text, text, text) TO authenticated;
