-- ═══════════════════════════════════════════════════════════════════════════
-- Démo → vrai compte : ASSOCIATION = le compte Association de Yuno.
--
-- 20260927140000 séparait l'association de l'organisateur mais gardait le
-- statut `bde_verified` comme une case à part. Or depuis 20260927100000
-- (association_accounts), ce drapeau EST le compte « Association » (loi 1901 :
-- BDE, asso culturelle, collectif — plus de modération). Préparer une
-- association = ouvrir un compte Association : complete_demo_preview_signup
-- pose bde_verified dès que le lien porte signup_association, et la case à
-- part (signup_bde_verified) disparaît. Corps repris de l'état LIVE
-- (20260927140000).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_set_demo_link_signup(
  p_link_id uuid,
  p_data    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    public.demo_preview_links%ROWTYPE;
  v_row     public.pro_signups%ROWTYPE;
  v_d       jsonb := CASE WHEN jsonb_typeof(p_data) = 'object' THEN p_data ELSE NULL END;
  v_kind    text;
  v_org     text;
  v_first   text;
  v_last    text;
  v_email   text;
  v_phone   text;
  v_city    text;
  v_pillars text[] := '{}';
  v_support boolean;
  v_assoc   boolean := false;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_link FROM public.demo_preview_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = '22023';
  END IF;
  -- Un lien VITRINE a déjà son propre parcours (« Activer mon compte »).
  IF v_link.venue_id IS NOT NULL OR v_link.organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'showcase_link' USING ERRCODE = '22023';
  END IF;

  IF v_link.signup_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.pro_signups WHERE id = v_link.signup_id FOR UPDATE;
  END IF;

  v_kind := lower(nullif(trim(coalesce(v_d->>'kind', '')), ''));

  -- Retrait : un brouillon jamais utilisé disparaît, un compte créé reste
  -- (c'est l'historique du funnel) mais n'est plus relié au lien.
  IF v_d IS NULL OR v_kind IS NULL THEN
    UPDATE public.demo_preview_links SET signup_id = NULL WHERE id = v_link.id;
    IF v_row.id IS NOT NULL AND v_row.user_id IS NULL THEN
      DELETE FROM public.pro_signups WHERE id = v_row.id;
    END IF;
    RETURN jsonb_build_object('removed', true);
  END IF;

  IF v_row.id IS NOT NULL AND v_row.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'account_already_created' USING ERRCODE = '22023';
  END IF;

  IF v_kind NOT IN ('club', 'organizer', 'association') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- Une association EST un compte organisateur (pro_signups.kind, que lit
  -- complete_pro_signup) ; ce qui la distingue vit sur le lien.
  IF v_kind = 'association' THEN
    v_assoc := true;
    v_kind := 'organizer';
  END IF;

  v_org   := left(nullif(regexp_replace(trim(coalesce(v_d->>'org_name', '')), '\s+', ' ', 'g'), ''), 120);
  v_first := left(nullif(trim(coalesce(v_d->>'first_name', '')), ''), 80);
  v_last  := left(nullif(trim(coalesce(v_d->>'last_name', '')), ''), 80);
  v_email := lower(nullif(trim(coalesce(v_d->>'email', '')), ''));
  v_phone := left(nullif(trim(coalesce(v_d->>'phone', '')), ''), 40);
  v_city  := left(nullif(trim(coalesce(v_d->>'city', '')), ''), 120);
  v_support := coalesce((v_d->>'offer_support')::boolean, true);

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'org_name_required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  -- Un compte démo ne s'ouvre jamais par ce chemin.
  IF v_email IS NOT NULL AND public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_email' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_d->'pillars') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_pillars
      FROM jsonb_array_elements_text(v_d->'pillars') x
     WHERE x IN ('tickets', 'guest_list', 'tables', 'drinks');
  END IF;
  -- Le bar n'existe qu'au club.
  IF v_kind = 'organizer' THEN
    v_pillars := array_remove(v_pillars, 'drinks');
  END IF;

  IF v_row.id IS NULL THEN
    INSERT INTO public.pro_signups (
      client_key, kind, lang, first_name, last_name, email, phone, org_name, city,
      pillars, source, utm_source, utm_medium, utm_campaign, last_step
    ) VALUES (
      -- 64 caractères hexadécimaux : la regex de client_key, sans extension.
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      v_kind, v_link.language, v_first, v_last, v_email, v_phone, v_org, v_city,
      v_pillars, 'demo_preview', 'demo', 'preview_link', left(v_link.label, 120), 'prepared'
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.pro_signups SET
      kind       = v_kind,
      lang       = v_link.language,
      first_name = v_first,
      last_name  = v_last,
      email      = v_email,
      phone      = v_phone,
      org_name   = v_org,
      city       = v_city,
      pillars    = v_pillars,
      updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.demo_preview_links
     SET signup_id = v_row.id,
         signup_offer_support = v_support,
         signup_association = v_assoc
   WHERE id = v_link.id;

  RETURN jsonb_build_object('signup_id', v_row.id,
                            'kind', CASE WHEN v_assoc THEN 'association' ELSE v_row.kind END,
                            'org_name', v_row.org_name);
END $$;

CREATE OR REPLACE FUNCTION public.admin_demo_link_signups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'link_id', l.id,
             'signup_id', s.id,
             'kind', CASE WHEN l.signup_association AND s.kind = 'organizer'
                          THEN 'association' ELSE s.kind END,
             'first_name', s.first_name,
             'last_name', s.last_name,
             'email', s.email,
             'phone', s.phone,
             'org_name', s.org_name,
             'city', s.city,
             'pillars', to_jsonb(s.pillars),
             'offer_support', l.signup_offer_support,
             'steps', s.steps,
             'user_id', s.user_id,
             'venue_id', s.venue_id,
             'account_created_at', s.account_created_at,
             'console_opened_at', s.console_opened_at
           ))
      FROM public.demo_preview_links l
      JOIN public.pro_signups s ON s.id = l.signup_id
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.complete_demo_preview_signup(
  p_key          text,
  p_support_help boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text;
  v_row     public.pro_signups%ROWTYPE;
  v_link    public.demo_preview_links%ROWTYPE;
  v_res     jsonb;
  v_admin   uuid;
  v_grant   uuid;
  v_helped  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL OR public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_account' USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key;
  IF NOT FOUND OR v_row.source IS DISTINCT FROM 'demo_preview' THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_link FROM public.demo_preview_links WHERE signup_id = v_row.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;

  v_res := public.complete_pro_signup(p_key);

  -- Compte ASSOCIATION : le drapeau que pose admin_set_organizer_bde_verified
  -- (« Association » dans /admin/organizers) est posé ici, dans la même
  -- transaction que l'ouverture — jamais une association ouverte sans son
  -- statut (plancher 0,49 €, 2 000 emails offerts, TVA des reçus à 0 %).
  IF v_link.signup_association AND v_res->>'kind' = 'organizer' THEN
    UPDATE public.organizer_profiles
       SET bde_verified = true,
           bde_verified_at = coalesce(bde_verified_at, now())
     WHERE user_id = v_uid;
    v_res := v_res || jsonb_build_object('association', true);
  END IF;

  IF p_support_help AND v_link.signup_offer_support THEN
    BEGIN
      SELECT id INTO v_grant
        FROM public.admin_support_grants
       WHERE target_user_id = v_uid
         AND status IN ('pending', 'active')
         AND (expires_at IS NULL OR expires_at > now())
       LIMIT 1;

      IF v_grant IS NULL THEN
        v_admin := v_link.created_by;
        IF v_admin IS NULL THEN
          SELECT ur.user_id INTO v_admin
            FROM public.user_roles ur
           WHERE ur.role = 'admin'
           ORDER BY ur.created_at
           LIMIT 1;
        END IF;

        IF v_admin IS NOT NULL THEN
          INSERT INTO public.admin_support_grants
            (target_user_id, requested_by, status, reason, approved_at, initiated_by)
          VALUES (
            v_uid, v_admin, 'active',
            'Accepté à l''ouverture du compte depuis la démo : configuration par l''équipe Yuno.',
            now(), 'client'
          )
          RETURNING id INTO v_grant;

          INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
          VALUES (v_grant, v_uid, v_uid, 'help_accepted_at_signup');
        END IF;
      END IF;
      v_helped := v_grant IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      -- L'aide est un plus : son échec ne défait jamais le compte ouvert.
      v_grant := NULL;
      v_helped := false;
    END;
  END IF;

  RETURN v_res || jsonb_build_object('support_help', v_helped);
END $$;

ALTER TABLE public.demo_preview_links DROP COLUMN IF EXISTS signup_bde_verified;

COMMENT ON COLUMN public.demo_preview_links.signup_association IS
  'Compte préparé pour une ASSOCIATION : compte organisateur ouvert avec le statut Association (organizer_profiles.bde_verified).';
