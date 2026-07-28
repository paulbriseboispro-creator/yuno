-- ============================================================================
-- Fusion d'identité agence ↔ affilié — une seule entité, deux modes de
-- distribution.
--
-- Modèle cible : `agencies` est L'IDENTITÉ (le tenant agence de promoteurs) ;
-- la ligne `affiliates` liée devient son BRAS EXTERNE (clubs non-Yuno,
-- redirection billetterie, attribution par clics). Le grand-livre Yuno
-- (contrats, agency_conversions, règlements) ne change PAS ; le bras externe
-- (affiliate_venues/events, tracking) ne change PAS. Seule l'identité fusionne.
--
-- Un chef d'agence = un humain = les deux rôles (`agency` + `affiliate`) et
-- les deux lignes liées par `affiliates.agency_id`. Les triggers provisionnent
-- automatiquement le bras manquant à l'inscription, quel que soit le point
-- d'entrée (create_agency OU invitation affilié).
-- ============================================================================

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS agency_id uuid UNIQUE REFERENCES public.agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_affiliates_agency ON public.affiliates(agency_id) WHERE agency_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Provisionne (ou relie) l'agence d'un affilié existant. Idempotent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_agency_for_affiliate(p_affiliate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aff RECORD;
  v_agency_id uuid;
  v_email text;
  v_base text;
  v_slug text;
  v_i int := 1;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE id = p_affiliate_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_aff.agency_id IS NOT NULL THEN RETURN v_aff.agency_id; END IF;

  -- Une agence par owner : réutiliser la plus ancienne si elle existe déjà.
  SELECT id INTO v_agency_id FROM agencies
  WHERE owner_user_id = v_aff.user_id
  ORDER BY created_at ASC LIMIT 1;

  IF v_agency_id IS NULL THEN
    v_base := COALESCE(NULLIF(v_aff.linktree_slug, ''),
      NULLIF(regexp_replace(lower(v_aff.name), '[^a-z0-9]+', '-', 'g'), ''), 'agence');
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM agencies WHERE slug = v_slug) LOOP
      v_slug := v_base || '-' || v_i;
      v_i := v_i + 1;
    END LOOP;

    INSERT INTO agencies (owner_user_id, name, slug, city, logo_url, bio,
                          instagram_url, whatsapp_number, website_url, is_active)
    VALUES (
      v_aff.user_id, v_aff.name, v_slug, v_aff.city, v_aff.avatar_url, v_aff.bio,
      CASE WHEN NULLIF(v_aff.instagram, '') IS NOT NULL
           THEN 'https://instagram.com/' || ltrim(v_aff.instagram, '@') END,
      NULLIF(v_aff.whatsapp, ''), NULLIF(v_aff.website, ''),
      COALESCE(v_aff.is_active, true)
    )
    RETURNING id INTO v_agency_id;
  END IF;

  UPDATE affiliates SET agency_id = v_agency_id
  WHERE id = p_affiliate_id AND agency_id IS NULL;

  SELECT email INTO v_email FROM auth.users WHERE id = v_aff.user_id;
  INSERT INTO user_roles (user_id, role, email) VALUES (v_aff.user_id, 'agency', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO user_roles (user_id, role, email) VALUES (v_aff.user_id, 'affiliate', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_agency_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Provisionne (ou relie) le bras externe d'une agence existante. Idempotent.
-- ----------------------------------------------------------------------------
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
                            is_active, created_by, agency_id)
    VALUES (
      v_ag.owner_user_id, v_ag.name, 'city_agency', v_ag.city, 0,
      v_slug, v_ag.logo_url, v_ag.bio,
      NULLIF(v_ag.whatsapp_number, ''), NULLIF(v_ag.website_url, ''),
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

REVOKE ALL ON FUNCTION public.provision_agency_for_affiliate(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provision_affiliate_for_agency(uuid) FROM PUBLIC, anon;
-- authenticated garde EXECUTE : point de guérison si un trigger a échoué en
-- silence (l'idempotence rend l'appel sans risque).
GRANT EXECUTE ON FUNCTION public.provision_agency_for_affiliate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provision_affiliate_for_agency(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Triggers : chaque nouveau bras provisionne l'autre. Jamais bloquant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_provision_agency_from_affiliate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Déjà lié (insert venant de provision_affiliate_for_agency) : rien à faire.
  IF NEW.agency_id IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM provision_agency_for_affiliate(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_affiliates_provision_agency ON public.affiliates;
CREATE TRIGGER trg_affiliates_provision_agency
  AFTER INSERT ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.trg_provision_agency_from_affiliate();

CREATE OR REPLACE FUNCTION public.trg_provision_affiliate_from_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM provision_affiliate_for_agency(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agencies_provision_affiliate ON public.agencies;
CREATE TRIGGER trg_agencies_provision_affiliate
  AFTER INSERT ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.trg_provision_affiliate_from_agency();

-- ----------------------------------------------------------------------------
-- Backfill : relier/provisionner tout l'existant, dans les deux sens.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM affiliates WHERE agency_id IS NULL LOOP
    PERFORM provision_agency_for_affiliate(r.id);
  END LOOP;

  FOR r IN
    SELECT a.id FROM agencies a
    WHERE NOT EXISTS (SELECT 1 FROM affiliates f WHERE f.agency_id = a.id)
  LOOP
    PERFORM provision_affiliate_for_agency(r.id);
  END LOOP;
END $$;
