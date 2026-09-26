-- ═══════════════════════════════════════════════════════════════════════════
-- Démo → vrai compte : le prospect crée SON compte depuis la démo.
--
-- Paul envoie un lien d'aperçu démo (/preview?token=…, lecture seule) à un
-- prospect. Jusqu'ici la démo montrait Yuno, puis le prospect repartait :
-- pour ouvrir un compte il fallait qu'il retrouve la landing, ou que Paul
-- l'invite à la main. Désormais le super admin PRÉPARE le compte au moment
-- où il crée le lien (club ou organisateur, prénom, nom de la structure,
-- email, ville, piliers, aide à la configuration), et la démo porte une
-- barre en haut « Crée le compte de <orga> » personnalisée.
--
-- Le compte n'est PAS créé d'avance : il naît quand le prospect clique, avec
-- SON email et SON mot de passe — jamais un compte orphelin, jamais un mot de
-- passe envoyé. Le moteur est celui de l'inscription pro en libre-service
-- (20260924120000) : le brouillon est une ligne `pro_signups`
-- (source = 'demo_preview'), l'ouverture passe par complete_pro_signup().
-- Le prospect atterrit sur /get-started comme un inscrit de la landing, et le
-- super admin le voit dans /admin/signups (funnel, source « demo »).
--
-- Pièces :
--   1. demo_preview_links.signup_id / signup_offer_support.
--   2. admin_set_demo_link_signup()  — super admin : prépare / modifie / retire.
--   3. admin_demo_link_signups()     — super admin : état de chaque brouillon.
--   4. demo_preview_link_signup()    — service_role : lu par l'edge de redeem
--      APRÈS vérification du mot de passe du lien (la clé du brouillon et
--      l'email pré-rempli ne sortent jamais sans ce mot de passe).
--   5. complete_demo_preview_signup() — authentifiée : le NOUVEAU compte ouvre
--      son club / son espace orga, et accepte (ou non) l'aide de l'équipe.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.demo_preview_links
  ADD COLUMN IF NOT EXISTS signup_id uuid NULL
    REFERENCES public.pro_signups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signup_offer_support boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_demo_preview_links_signup
  ON public.demo_preview_links (signup_id)
  WHERE signup_id IS NOT NULL;

COMMENT ON COLUMN public.demo_preview_links.signup_id IS
  'Brouillon de compte pro (pro_signups, source demo_preview) préparé par le super admin : la démo affiche la barre « Crée ton compte » personnalisée.';
COMMENT ON COLUMN public.demo_preview_links.signup_offer_support IS
  'Le dialogue de création propose au prospect d''ouvrir l''accès assisté (configuration par l''équipe Yuno).';

-- ── 1. Préparer / modifier / retirer le compte d'un lien (super admin) ──────
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

  IF v_kind NOT IN ('club', 'organizer') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
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
         signup_offer_support = v_support
   WHERE id = v_link.id;

  RETURN jsonb_build_object('signup_id', v_row.id, 'kind', v_row.kind, 'org_name', v_row.org_name);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_demo_link_signup(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_demo_link_signup(uuid, jsonb) TO authenticated;

-- ── 2. État des brouillons (super admin) ────────────────────────────────────
-- pro_signups n'a aucune policy : la fenêtre « Accès démo » lit par ici.
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
             'kind', s.kind,
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

REVOKE ALL ON FUNCTION public.admin_demo_link_signups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_demo_link_signups() TO authenticated;

-- ── 3. Lecture par l'edge de redeem (service_role seul) ─────────────────────
-- Appelée APRÈS verify_demo_preview_password : le porteur a prouvé le mot de
-- passe du lien. Horodate la première ouverture de la démo (steps.demo_opened)
-- et compte les ouvertures suivantes : le super admin voit que la démo a été
-- regardée avant la création du compte.
CREATE OR REPLACE FUNCTION public.demo_preview_link_signup(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.demo_preview_links%ROWTYPE;
  v_row  public.pro_signups%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.demo_preview_links WHERE token = p_token;
  IF NOT FOUND OR v_link.signup_id IS NULL
     OR v_link.venue_id IS NOT NULL OR v_link.organizer_user_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE id = v_link.signup_id FOR UPDATE;
  IF NOT FOUND OR v_row.kind NOT IN ('club', 'organizer') THEN
    RETURN NULL;
  END IF;

  -- Compte déjà ouvert : la barre devient « Ton compte est prêt ». Ni clé ni
  -- email : il n'y a plus rien à créer.
  IF v_row.user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'created', true,
      'kind', v_row.kind,
      'first_name', v_row.first_name,
      'org_name', v_row.org_name
    );
  END IF;

  UPDATE public.pro_signups SET
    steps = CASE WHEN steps ? 'demo_opened'
                 THEN jsonb_set(steps, '{demo_opens}',
                                to_jsonb(coalesce((steps->>'demo_opens')::int, 1) + 1))
                 ELSE steps || jsonb_build_object('demo_opened', now(), 'demo_opens', 1) END,
    last_step = CASE WHEN last_step IS NULL OR last_step = 'prepared' THEN 'demo_opened' ELSE last_step END,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'created', false,
    'key', v_row.client_key,
    'kind', v_row.kind,
    'first_name', v_row.first_name,
    'last_name', v_row.last_name,
    'email', v_row.email,
    'org_name', v_row.org_name,
    'city', v_row.city,
    'offer_support', v_link.signup_offer_support
  );
END $$;

REVOKE ALL ON FUNCTION public.demo_preview_link_signup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_preview_link_signup(text) TO service_role;

-- ── 4. Ouverture du compte par le prospect (le NOUVEL utilisateur) ──────────
-- Enveloppe de complete_pro_signup : mêmes règles (idempotente, un club par
-- owner, refusée en session support, refusée si le parcours appartient à un
-- autre compte), plus trois verrous propres à la démo :
--   • le brouillon doit venir d'un lien d'aperçu (source demo_preview) ;
--   • un compte démo @womber.fr n'ouvre jamais rien — l'onglet du prospect
--     était connecté à owner@womber.fr une seconde plus tôt ;
--   • l'accès assisté n'est ouvert que si Paul l'a proposé ET que le prospect
--     a coché la case (consentement donné ici, comme à l'acceptation d'une
--     invitation : accept_support_offer_from_invitation).
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

REVOKE ALL ON FUNCTION public.complete_demo_preview_signup(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_demo_preview_signup(text, boolean) TO authenticated;
