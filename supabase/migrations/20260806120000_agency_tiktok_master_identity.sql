-- ============================================================
-- TikTok rejoint l'identité MAÎTRE de l'agence.
-- Le profil agence (/agency-app/profile) devient l'unique endroit où
-- l'identité publique s'édite : agencies.tiktok_url est ajouté, propagé
-- vers affiliates.tiktok (handle) par la synchro d'identité existante.
-- ============================================================

ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS tiktok_url text;

-- Extracteur de handle TikTok (miroir d'instagram_handle_from_url) :
-- accepte une URL complète, "@handle" ou un handle nu.
CREATE OR REPLACE FUNCTION public.tiktok_handle_from_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    rtrim(
      ltrim(
        regexp_replace(
          split_part(split_part(trim(COALESCE(p_url, '')), '?', 1), '#', 1),
          '^https?://(www\.)?tiktok\.com/+', '', 'i'
        ),
        '@'
      ),
      '/'
    ),
    ''
  );
$$;

-- Back-fill : les bras externes qui ont déjà un handle TikTok le remontent
-- vers l'agence AVANT que la synchro maître ne devienne écrasante — sinon le
-- premier enregistrement du profil agence effacerait leur TikTok existant.
UPDATE public.agencies a
SET tiktok_url = 'https://www.tiktok.com/@' || ltrim(aff.tiktok, '@')
FROM public.affiliates aff
WHERE aff.agency_id = a.id
  AND a.tiktok_url IS NULL
  AND NULLIF(trim(aff.tiktok), '') IS NOT NULL;

-- ── RPC de profil : nouvelle signature avec p_tiktok_url ────────────────────
-- L'ancienne signature à 9 args est supprimée : deux overloads rendraient le
-- dispatch PostgREST ambigu selon le nombre de params nommés envoyés.
DROP FUNCTION IF EXISTS public.update_agency_profile(
  uuid, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.update_agency_profile(
  p_agency_id       uuid,
  p_name            text DEFAULT NULL,
  p_city            text DEFAULT NULL,
  p_bio             text DEFAULT NULL,
  p_logo_url        text DEFAULT NULL,
  p_instagram_url   text DEFAULT NULL,
  p_whatsapp_number text DEFAULT NULL,
  p_website_url     text DEFAULT NULL,
  p_contact_email   text DEFAULT NULL,
  p_tiktok_url      text DEFAULT NULL
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
         tiktok_url       = COALESCE(p_tiktok_url,      tiktok_url),
         updated_at       = now()
   WHERE id = p_agency_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_agency_profile(
  uuid, text, text, text, text, text, text, text, text, text
) TO authenticated;

-- ── Synchro d'identité : TikTok rejoint la liste ────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_affiliate_identity_from_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE affiliates SET
    name       = NEW.name,
    city       = NEW.city,
    avatar_url = NEW.logo_url,
    bio        = NEW.bio,
    website    = NEW.website_url,
    whatsapp   = NEW.whatsapp_number,
    instagram  = public.instagram_handle_from_url(NEW.instagram_url),
    tiktok     = public.tiktok_handle_from_url(NEW.tiktok_url),
    is_active  = NEW.is_active
  WHERE agency_id = NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- La synchro d'identité ne doit jamais faire échouer la mise à jour du profil.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agencies_sync_affiliate_identity ON public.agencies;
CREATE TRIGGER trg_agencies_sync_affiliate_identity
  AFTER UPDATE OF name, city, logo_url, bio, website_url, whatsapp_number, instagram_url, tiktok_url, is_active
  ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.sync_affiliate_identity_from_agency();
