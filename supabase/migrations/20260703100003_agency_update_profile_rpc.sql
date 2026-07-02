-- update_agency_profile: permet au propriétaire de l'agence de modifier ses métadonnées.
-- Utilise COALESCE : seuls les champs non-NULL fournis sont mis à jour.

CREATE OR REPLACE FUNCTION public.update_agency_profile(
  p_agency_id      uuid,
  p_name           text DEFAULT NULL,
  p_city           text DEFAULT NULL,
  p_bio            text DEFAULT NULL,
  p_logo_url       text DEFAULT NULL,
  p_instagram_url  text DEFAULT NULL,
  p_whatsapp_number text DEFAULT NULL,
  p_website_url    text DEFAULT NULL,
  p_contact_email  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_agency_owner(auth.uid(), p_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.agencies
     SET name             = COALESCE(p_name,            name),
         city             = COALESCE(p_city,            city),
         bio              = COALESCE(p_bio,             bio),
         logo_url         = COALESCE(p_logo_url,        logo_url),
         instagram_url    = COALESCE(p_instagram_url,   instagram_url),
         whatsapp_number  = COALESCE(p_whatsapp_number, whatsapp_number),
         website_url      = COALESCE(p_website_url,     website_url),
         contact_email    = COALESCE(p_contact_email,   contact_email),
         updated_at       = now()
   WHERE id = p_agency_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_agency_profile(
  uuid, text, text, text, text, text, text, text, text
) TO authenticated;
