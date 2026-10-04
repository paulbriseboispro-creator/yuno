-- ============================================================================
-- Yuno CRM — « Me prévenir à l'ouverture » des fonctions à venir (Instagram,
-- pages d'inscription). Une ligne par (espace, fonction, personne) ; lue par
-- la personne elle-même et, plus tard, par le tableau de bord admin du CRM
-- pour annoncer l'ouverture (e-mail + notification).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_feature_waitlist (
  scope_key         text NOT NULL,
  venue_id          text,
  organizer_user_id uuid,
  feature           text NOT NULL CHECK (feature IN ('instagram', 'signup_pages')),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  notified_at       timestamptz,
  PRIMARY KEY (scope_key, feature, user_id)
);
ALTER TABLE public.crm_feature_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_feature_waitlist FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_feature_waitlist_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT array_agg(feature ORDER BY feature) FROM public.crm_feature_waitlist
                    WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND user_id = auth.uid()), '{}');
END;
$$;
REVOKE ALL ON FUNCTION public.crm_feature_waitlist_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_feature_waitlist_get(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_feature_waitlist_set(p_venue_id text, p_organizer_user_id uuid, p_feature text, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_feature NOT IN ('instagram', 'signup_pages') THEN
    RAISE EXCEPTION 'unknown_feature' USING ERRCODE = '22023';
  END IF;
  IF p_on THEN
    INSERT INTO public.crm_feature_waitlist (scope_key, venue_id, organizer_user_id, feature, user_id)
    VALUES (public.crm_scope_key(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id, p_feature, auth.uid())
    ON CONFLICT (scope_key, feature, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.crm_feature_waitlist
     WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND feature = p_feature AND user_id = auth.uid();
  END IF;
  RETURN p_on;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_feature_waitlist_set(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_feature_waitlist_set(text, uuid, text, boolean) TO authenticated;
