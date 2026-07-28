-- ============================================================================
-- Report auto des réseaux du profil agence vers le bras externe : Instagram.
--
-- La synchro d'identité agencies → affiliates (20260727120100) couvrait nom,
-- ville, bio, site, WhatsApp… mais PAS Instagram : le chef d'agence renseignait
-- son insta dans Profil de l'agence et le linktree public restait muet.
--
-- Subtilité de format : agencies.instagram_url stocke une URL complète
-- (https://instagram.com/mon-agence), affiliates.instagram stocke le HANDLE
-- (le front reconstruit l'URL). D'où l'extracteur ci-dessous.
--
-- Le report reste le DÉFAUT, pas une prison : le chef d'agence peut saisir un
-- handle différent dans Linktree & externe — il tient tant que le champ
-- Instagram du profil agence n'est pas modifié à nouveau (même contrat que le
-- reste de la synchro d'identité).
-- ============================================================================

-- ── 1. Extracteur de handle ─────────────────────────────────────────────────
-- Accepte une URL instagram.com complète (avec ou sans www / querystring /
-- slash final) OU un handle nu ('@agence' / 'agence') et rend le handle nu.
CREATE OR REPLACE FUNCTION public.instagram_handle_from_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    rtrim(
      ltrim(
        regexp_replace(
          split_part(split_part(trim(COALESCE(p_url, '')), '?', 1), '#', 1),
          '^https?://(www\.)?instagram\.com/+', '', 'i'
        ),
        '@'
      ),
      '/'
    ),
    ''
  );
$$;

-- ── 2. Synchro d'identité : Instagram rejoint la liste ──────────────────────
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
  AFTER UPDATE OF name, city, logo_url, bio, website_url, whatsapp_number, instagram_url, is_active
  ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.sync_affiliate_identity_from_agency();

-- ── 3. Provisionnement : une agence neuve part avec son insta ───────────────
CREATE OR REPLACE FUNCTION public.provision_affiliate_for_agency(p_agency_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ag RECORD;
  v_aff_id uuid;
  v_email text;
  v_base text;
  v_slug text;
  v_i int := 1;
BEGIN
  SELECT * INTO v_ag FROM agencies WHERE id = p_agency_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_aff_id FROM affiliates WHERE agency_id = p_agency_id;
  IF v_aff_id IS NOT NULL THEN RETURN v_aff_id; END IF;

  -- affiliates.user_id est UNIQUE : relier la ligne existante de l'owner
  -- plutôt que d'en créer une seconde.
  SELECT id INTO v_aff_id FROM affiliates WHERE user_id = v_ag.owner_user_id;

  IF v_aff_id IS NULL THEN
    v_base := COALESCE(NULLIF(v_ag.slug, ''),
      NULLIF(regexp_replace(lower(v_ag.name), '[^a-z0-9]+', '-', 'g'), ''), 'agence');
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM affiliates WHERE linktree_slug = v_slug) LOOP
      v_slug := v_base || '-' || v_i;
      v_i := v_i + 1;
    END LOOP;

    INSERT INTO affiliates (user_id, name, type, city, commission_rate,
                            linktree_slug, avatar_url, bio, whatsapp, website,
                            instagram, is_active, created_by, agency_id)
    VALUES (
      v_ag.owner_user_id, v_ag.name, 'city_agency', v_ag.city, 0,
      v_slug, v_ag.logo_url, v_ag.bio,
      NULLIF(v_ag.whatsapp_number, ''), NULLIF(v_ag.website_url, ''),
      public.instagram_handle_from_url(v_ag.instagram_url),
      COALESCE(v_ag.is_active, true), v_ag.owner_user_id, p_agency_id
    )
    RETURNING id INTO v_aff_id;
  ELSE
    UPDATE affiliates SET agency_id = p_agency_id
    WHERE id = v_aff_id AND agency_id IS NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_ag.owner_user_id;
  INSERT INTO user_roles (user_id, role, email) VALUES (v_ag.owner_user_id, 'affiliate', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_aff_id;
END;
$$;

-- ── 4. Rattrapage : les agences déjà fusionnées récupèrent leurs réseaux ─────
-- Uniquement les champs encore vides côté affilié : un handle différencié
-- volontairement n'est pas écrasé par le rattrapage.
UPDATE affiliates a
SET instagram = public.instagram_handle_from_url(g.instagram_url)
FROM agencies g
WHERE a.agency_id = g.id
  AND NULLIF(g.instagram_url, '') IS NOT NULL
  AND NULLIF(a.instagram, '') IS NULL;

UPDATE affiliates a
SET whatsapp = NULLIF(g.whatsapp_number, '')
FROM agencies g
WHERE a.agency_id = g.id
  AND NULLIF(g.whatsapp_number, '') IS NOT NULL
  AND NULLIF(a.whatsapp, '') IS NULL;

UPDATE affiliates a
SET website = NULLIF(g.website_url, '')
FROM agencies g
WHERE a.agency_id = g.id
  AND NULLIF(g.website_url, '') IS NOT NULL
  AND NULLIF(a.website, '') IS NULL;
