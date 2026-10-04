-- « Me prévenir » : un troisième sujet, envoyer depuis son propre domaine
-- (Réglages d'envoi). Aujourd'hui les e-mails d'un compte CRM partent du
-- domaine vérifié de Yuno (news.yunoapp.eu).

ALTER TABLE public.crm_feature_waitlist DROP CONSTRAINT IF EXISTS crm_feature_waitlist_feature_check;
ALTER TABLE public.crm_feature_waitlist ADD CONSTRAINT crm_feature_waitlist_feature_check
  CHECK (feature IN ('instagram', 'signup_pages', 'brand_domain'));

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
  IF p_feature NOT IN ('instagram', 'signup_pages', 'brand_domain') THEN
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
