-- ============================================================================
-- Hardening collaborations + affilié (audit 2026-07-31).
--
-- 1) Codifier le hardening du tracking : les policies UPDATE publiques de
--    20260606000010 ont été retirées de la base live (advisor, 2026-07-24) et
--    remplacées par les RPC SECURITY DEFINER flush_affiliate_session /
--    ping_affiliate_live. Mais aucune migration ne les droppait : un db reset
--    ou un nouvel environnement recréait la surface d'écriture anonyme
--    (n'importe quel anon pouvait réécrire duration/scroll de n'importe quelle
--    session). On aligne le schéma déclaré sur la prod. Les policies INSERT
--    publiques restent : la création de session/ping anonyme est voulue.
--
-- 2) Verrouiller les RPC de provisionnement de la fusion agence↔affilié :
--    elles étaient EXECUTE pour tout `authenticated` sans contrôle — n'importe
--    quel utilisateur pouvait provisionner le bras manquant d'un AUTRE tenant
--    (pas d'escalade de privilèges — les rôles atterrissent chez le tenant
--    cible — mais mutation du graphe d'identité d'autrui). On garde le point
--    de guérison self-service : le PROPRIÉTAIRE (ou super admin) peut appeler.
--    NB : la garde lit auth.role() (le rôle du JWT de la requête) et PAS
--    is_direct_client_write()/current_user — dans une fonction SECURITY
--    DEFINER, current_user est le propriétaire de la fonction et la garde
--    serait morte. Service role et cron (JWT non client) passent toujours ;
--    les triggers héritent du JWT de la requête d'origine, où le propriétaire
--    est précisément celui qui insère sa propre ligne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tracking : plus jamais d'UPDATE anonyme direct.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "affiliate_sessions_update_duration" ON public.affiliate_visitor_sessions;
DROP POLICY IF EXISTS "affiliate_live_pings_update_public" ON public.affiliate_live_pings;

-- ----------------------------------------------------------------------------
-- 2) Garde de propriété sur les RPC de provisionnement (corps inchangés par
--    ailleurs — seule la garde en tête est ajoutée).
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

  -- Requête portée par un JWT client : seul le propriétaire de la ligne (ou
  -- un super admin) peut provisionner. Service role / cron passent toujours.
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND v_aff.user_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'provision_not_owner' USING ERRCODE = '42501';
  END IF;

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

  -- Requête portée par un JWT client : seul le propriétaire de l'agence (ou
  -- un super admin) peut provisionner. Service role / cron passent toujours.
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND v_ag.owner_user_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'provision_not_owner' USING ERRCODE = '42501';
  END IF;

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
