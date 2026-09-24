-- ═══════════════════════════════════════════════════════════════════════════
-- Inscription pro en libre-service (club OU organisateur) depuis la landing.
--
-- Avant : la landing (landing.yunoapp.eu) déposait une « demande d'accès »
-- dans une AUTRE base (demo_leads du projet landing), et Paul ouvrait le
-- compte à la main. Le super admin ne voyait rien, le pro attendait un jour.
--
-- Maintenant : la landing crée le compte Yuno elle-même (auth.signUp sur CE
-- projet, clé anon), puis appelle complete_pro_signup() en tant que ce
-- nouvel utilisateur, qui ouvre le club ou l'espace organisateur. Le pro
-- arrive connecté sur /get-started (yunoapp.eu), personnalisé.
--
-- Trois pièces :
--   1. pro_signups — UNE ligne par parcours (clé aléatoire tenue par le
--      navigateur), écrite étape par étape pendant le funnel. C'est ce qui
--      permet au super admin de voir le funnel ET les abandons (email saisi,
--      compte jamais créé) pour relancer.
--   2. track_pro_signup() — écriture ANONYME (anon), SECURITY DEFINER, bornée
--      et anti-flood (même visiteur haché que Yuno Links). Ne lève jamais pour
--      une valeur inattendue : une mesure ne casse pas une inscription.
--   3. complete_pro_signup() — authentifiée. Lit le brouillon, crée le club
--      (caché jusqu'au « Go live » de l'onboarding) ou le profil
--      organisateur, accorde le rôle, pré-remplit l'onboarding, reporte la
--      2FA de 7 jours (règle existante, jamais sur les pages d'argent), et
--      émet l'alerte admin_pro_signup.
--
-- Lecture super admin : admin_pro_signups() (funnel + liste + progression
-- réelle : soirée créée, Stripe, en ligne) et admin_update_pro_signup()
-- (contacté / notes). Page /admin/signups.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pro_signups (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key         text        NOT NULL UNIQUE
                                 CHECK (client_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- club | organizer = création de compte ; promoter | other = lead (pas de
  -- compte en libre-service : un promoteur entre par son club ou son agence).
  kind               text        CHECK (kind IS NULL OR kind IN ('club','organizer','promoter','other')),
  lang               text,
  first_name         text,
  last_name          text,
  email              text,
  phone              text,
  org_name           text,
  city               text,
  country            text,
  size_band          text,       -- capacité du club / taille du public
  frequency          text,       -- soirées par mois (organisateur)
  pillars            text[]      NOT NULL DEFAULT '{}',
  current_tool       text,       -- billetterie actuelle (shotgun, dice…)
  next_night         text,       -- prochaine soirée : week | month | later | unknown
  source             text,       -- landing | start | …
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  referrer_host      text,
  visitor_hash       text,
  device             text,
  geo_country        text,       -- cf-ipcountry (indicatif)
  -- Premier passage à chaque étape : {"opened": ts, "role": ts, …}
  steps              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_step          text,
  user_id            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  venue_id           text        REFERENCES public.venues(id) ON DELETE SET NULL,
  account_created_at timestamptz,
  console_opened_at  timestamptz,
  contacted_at       timestamptz,
  admin_notes        text
);

CREATE INDEX IF NOT EXISTS idx_pro_signups_created ON public.pro_signups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pro_signups_visitor ON public.pro_signups (visitor_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pro_signups_user ON public.pro_signups (user_id) WHERE user_id IS NOT NULL;

-- RLS totale, AUCUNE policy : tout passe par les RPC ci-dessous.
ALTER TABLE public.pro_signups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_signups FROM anon, authenticated;

-- ── 1. Écriture anonyme étape par étape ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.track_pro_signup(
  p_key  text,
  p_step text,
  p_data jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx      record;
  v_row      public.pro_signups%ROWTYPE;
  v_recent   integer;
  v_d        jsonb := CASE WHEN jsonb_typeof(p_data) = 'object' AND length(p_data::text) <= 4000
                           THEN p_data ELSE '{}'::jsonb END;
  v_kind     text := lower(nullif(trim(coalesce(v_d->>'kind', '')), ''));
  v_email    text := lower(nullif(trim(coalesce(v_d->>'email', '')), ''));
  v_pillars  text[];
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN; END IF;
  IF p_step NOT IN ('opened','role','structure','account','lead') THEN RETURN; END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('club','organizer','promoter','other') THEN v_kind := NULL; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    v_email := NULL;
  END IF;

  IF jsonb_typeof(v_d->'pillars') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_pillars
      FROM jsonb_array_elements_text(v_d->'pillars') x
     WHERE x IN ('tickets','guest_list','tables','drinks');
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_ctx FROM public.links_visitor_context();
    -- Anti-flood : 20 parcours neufs par visiteur et par heure.
    SELECT count(*) INTO v_recent FROM public.pro_signups
     WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour';
    IF v_recent >= 20 THEN RETURN; END IF;

    INSERT INTO public.pro_signups (client_key, visitor_hash, device, geo_country)
    VALUES (p_key, v_ctx.o_hash, v_ctx.o_device, v_ctx.o_country)
    RETURNING * INTO v_row;
  END IF;

  -- Un parcours qui a déjà produit un compte ne s'écrit plus anonymement.
  IF v_row.user_id IS NOT NULL THEN RETURN; END IF;

  UPDATE public.pro_signups SET
    updated_at    = now(),
    kind          = coalesce(v_kind, kind),
    lang          = coalesce(lower(left(nullif(v_d->>'lang', ''), 2)), lang),
    first_name    = coalesce(left(nullif(trim(v_d->>'first_name'), ''), 80), first_name),
    last_name     = coalesce(left(nullif(trim(v_d->>'last_name'), ''), 80), last_name),
    email         = coalesce(v_email, email),
    phone         = coalesce(left(nullif(trim(v_d->>'phone'), ''), 40), phone),
    org_name      = coalesce(left(nullif(regexp_replace(trim(v_d->>'org_name'), '\s+', ' ', 'g'), ''), 120), org_name),
    city          = coalesce(left(nullif(trim(v_d->>'city'), ''), 120), city),
    country       = coalesce(upper(left(nullif(trim(v_d->>'country'), ''), 2)), country),
    size_band     = coalesce(left(nullif(v_d->>'size_band', ''), 20), size_band),
    frequency     = coalesce(left(nullif(v_d->>'frequency', ''), 20), frequency),
    pillars       = coalesce(v_pillars, pillars),
    current_tool  = coalesce(left(nullif(v_d->>'current_tool', ''), 40), current_tool),
    next_night    = coalesce(left(nullif(v_d->>'next_night', ''), 20), next_night),
    source        = coalesce(source, left(nullif(v_d->>'source', ''), 60)),
    utm_source    = coalesce(utm_source, left(nullif(v_d->>'utm_source', ''), 120)),
    utm_medium    = coalesce(utm_medium, left(nullif(v_d->>'utm_medium', ''), 120)),
    utm_campaign  = coalesce(utm_campaign, left(nullif(v_d->>'utm_campaign', ''), 120)),
    referrer_host = coalesce(referrer_host, left(nullif(v_d->>'referrer_host', ''), 120)),
    steps         = CASE WHEN steps ? p_step THEN steps
                         ELSE steps || jsonb_build_object(p_step, now()) END,
    last_step     = p_step
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Promoteur / autre : pas de compte en libre-service, c'est un lead chaud.
  IF p_step = 'lead' AND v_row.email IS NOT NULL AND NOT public.is_demo_email(v_row.email) THEN
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_pro_signup_lead',
        'Nouveau lead pro (landing)',
        coalesce(nullif(trim(coalesce(v_row.first_name, '') || ' ' || coalesce(v_row.last_name, '')), ''), v_row.email)
          || coalesce(' — ' || v_row.org_name, '') || coalesce(' (' || v_row.city || ')', '')
          || ' · ' || coalesce(v_row.kind, 'other') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'email', v_row.email, 'phone', v_row.phone,
                           'org_name', v_row.org_name, 'city', v_row.city, 'lang', v_row.lang),
        'pro_signup_lead:' || v_row.id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.track_pro_signup(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_pro_signup(text, text, jsonb) TO anon, authenticated;

-- ── 2. Ouverture du compte pro (appelée par le NOUVEL utilisateur) ──────────
CREATE OR REPLACE FUNCTION public.complete_pro_signup(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_row       public.pro_signups%ROWTYPE;
  v_email     text;
  v_venue     text;
  v_created   boolean := false;
  v_name      text;
  v_city      text;
  v_pillars   text[];
  v_who       text;
  v_n         integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Une session d'accès assisté n'ouvre jamais de compte pour quelqu'un.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;
  IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
    RAISE EXCEPTION 'already_used' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind NOT IN ('club','organizer') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;

  v_name := nullif(trim(coalesce(v_row.org_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'org_name_required' USING ERRCODE = '22023';
  END IF;
  v_city := coalesce(nullif(trim(coalesce(v_row.city, '')), ''), '');
  v_pillars := coalesce(v_row.pillars, '{}');

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Identité de la personne : seulement ce qui manque (jamais écraser).
  UPDATE public.profiles SET
    first_name = coalesce(nullif(first_name, ''), v_row.first_name),
    last_name  = coalesce(nullif(last_name, ''), v_row.last_name),
    phone      = coalesce(nullif(phone, ''), v_row.phone),
    city       = coalesce(nullif(city, ''), nullif(v_city, ''))
  WHERE id = v_uid;

  IF v_row.kind = 'club' THEN
    -- Un owner = un club (OwnerVenueContext lit par owner_id en maybeSingle).
    SELECT id INTO v_venue FROM public.venues
     WHERE owner_id = v_uid AND decommissioned_at IS NULL
     ORDER BY created_at NULLS LAST LIMIT 1;

    IF v_venue IS NULL THEN
      v_venue := public.gen_venue_slug(v_name, NULL);
      -- Caché jusqu'au « Go live » de l'onboarding (étape 7).
      INSERT INTO public.venues (id, name, city, owner_id, is_hidden, menu_enabled, vip_placement_enabled)
      VALUES (
        v_venue, v_name, v_city, v_uid, true,
        CASE WHEN cardinality(v_pillars) = 0 THEN true ELSE 'drinks' = ANY(v_pillars) END,
        'tables' = ANY(v_pillars)
      );
      v_created := true;
    END IF;

    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (v_uid, 'owner'::public.app_role, v_email)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Onboarding : les piliers sont déjà choisis sur la landing → étape 1
    -- faite, le guide s'ouvre sur « Infos du club ».
    IF v_created AND cardinality(v_pillars) > 0 THEN
      INSERT INTO public.venue_onboarding (venue_id, owner_id, current_step, steps)
      VALUES (
        v_venue, v_uid, 2,
        jsonb_build_object(
          '1', jsonb_build_object('status', 'completed', 'completed_at', now(),
                 'metadata', jsonb_build_object('pillars',
                   to_jsonb(ARRAY(SELECT p FROM unnest(v_pillars) p WHERE p IN ('tickets','tables','drinks'))),
                   'source', 'pro_signup')),
          '2', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '3', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '4', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '5', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '6', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '7', jsonb_build_object('status', 'not_started', 'completed_at', null)
        )
      )
      ON CONFLICT (venue_id) DO NOTHING;
    END IF;

    -- La 2FA reste obligatoire pour un owner ; on applique le report existant
    -- (7 jours, une fois, jamais sur les pages d'argent — RequireMFA) pour
    -- qu'un club qui s'inscrit voie son dashboard avant d'installer une app
    -- d'authentification.
    UPDATE public.profiles
       SET mfa_deferred_until = now() + interval '7 days'
     WHERE id = v_uid
       AND coalesce(mfa_enabled, false) = false
       AND mfa_deferred_until IS NULL;

    IF v_created THEN
      -- L'alerte admin_pro_signup (plus riche) remplace « nouveau club ».
      DELETE FROM public.admin_notifications
       WHERE dedup_key = 'new_venue:' || v_venue AND read_at IS NULL;
    END IF;
  ELSE
    UPDATE public.profiles SET
      profile_type      = 'organizer',
      organization_name = coalesce(nullif(organization_name, ''), v_name)
    WHERE id = v_uid;

    INSERT INTO public.organizer_profiles (user_id, display_name, city)
    VALUES (v_uid, v_name, nullif(v_city, ''))
    ON CONFLICT (user_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_created := v_n > 0;

    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (v_uid, 'organizer'::public.app_role, v_email)
    ON CONFLICT (user_id, role) DO NOTHING;

    IF v_created THEN
      DELETE FROM public.admin_notifications
       WHERE dedup_key = 'new_organizer:' || v_uid::text AND read_at IS NULL;
    END IF;
  END IF;

  UPDATE public.pro_signups SET
    user_id            = v_uid,
    venue_id           = coalesce(v_venue, venue_id),
    email              = coalesce(email, lower(v_email)),
    account_created_at = coalesce(account_created_at, now()),
    steps              = CASE WHEN steps ? 'created' THEN steps
                              ELSE steps || jsonb_build_object('created', now()) END,
    last_step          = 'created',
    updated_at         = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  IF NOT public.is_demo_email(v_email) THEN
    v_who := coalesce(nullif(trim(coalesce(v_row.first_name, '') || ' ' || coalesce(v_row.last_name, '')), ''), v_email);
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_pro_signup',
        CASE WHEN v_row.kind = 'club' THEN 'Nouveau club inscrit' ELSE 'Nouvel organisateur inscrit' END,
        v_name || coalesce(' (' || nullif(v_city, '') || ')', '') || ' · ' || v_who
          || coalesce(' · ' || v_row.phone, '') || coalesce(' · via ' || v_row.source, '') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'org_name', v_name, 'city', v_city,
                           'email', v_email, 'phone', v_row.phone, 'venue_id', v_venue,
                           'user_id', v_uid, 'size_band', v_row.size_band,
                           'current_tool', v_row.current_tool, 'next_night', v_row.next_night,
                           'pillars', to_jsonb(v_row.pillars), 'lang', v_row.lang),
        'pro_signup:' || v_row.id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_row.kind,
    'venue_id', v_venue,
    'created', v_created,
    'redirect', '/get-started'
  );
END $$;

REVOKE ALL ON FUNCTION public.complete_pro_signup(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_pro_signup(text) TO authenticated;

-- ── 3. Page d'accueil personnalisée (/get-started) ──────────────────────────
-- Rend le parcours de la personne connectée (le plus récent) et horodate la
-- première ouverture de la Console — le funnel s'arrête sinon à « compte créé ».
CREATE OR REPLACE FUNCTION public.open_my_pro_signup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.pro_signups%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.pro_signups
   WHERE user_id = v_uid ORDER BY account_created_at DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_row.console_opened_at IS NULL AND NOT public.is_support_session() THEN
    UPDATE public.pro_signups
       SET console_opened_at = now(),
           steps = steps || jsonb_build_object('console', now()),
           last_step = 'console',
           updated_at = now()
     WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_row.kind,
    'first_name', v_row.first_name,
    'org_name', v_row.org_name,
    'city', v_row.city,
    'size_band', v_row.size_band,
    'frequency', v_row.frequency,
    'pillars', to_jsonb(v_row.pillars),
    'current_tool', v_row.current_tool,
    'next_night', v_row.next_night,
    'lang', v_row.lang,
    'venue_id', v_row.venue_id
  );
END $$;

REVOKE ALL ON FUNCTION public.open_my_pro_signup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_my_pro_signup() TO authenticated;

-- ── 4. Super admin : funnel, inscrits, progression réelle ──────────────────
CREATE OR REPLACE FUNCTION public.admin_pro_signups(
  p_days         integer DEFAULT 30,
  p_include_demo boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)));
  v      jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT ps.*
      FROM public.pro_signups ps
     WHERE ps.created_at >= v_from
       AND (p_include_demo OR ps.email IS NULL OR NOT public.is_demo_email(ps.email))
  ),
  prog AS (
    SELECT s.id,
           CASE
             WHEN s.kind = 'club' AND s.venue_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.venue_id = s.venue_id)
             WHEN s.kind = 'organizer' AND s.user_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.organizer_user_id = s.user_id)
             ELSE 0
           END AS events,
           CASE
             WHEN s.kind = 'club' AND s.venue_id IS NOT NULL THEN
               coalesce((SELECT vn.stripe_charges_enabled OR vn.stripe_onboarding_complete
                           FROM public.venues vn WHERE vn.id = s.venue_id), false)
             WHEN s.kind = 'organizer' AND s.user_id IS NOT NULL THEN
               coalesce((SELECT pr.stripe_connect_account_id IS NOT NULL
                           FROM public.profiles pr WHERE pr.id = s.user_id), false)
             ELSE false
           END AS payments,
           CASE
             WHEN s.kind = 'club' AND s.venue_id IS NOT NULL THEN
               coalesce((SELECT NOT vn.is_hidden FROM public.venues vn WHERE vn.id = s.venue_id), false)
             WHEN s.kind = 'organizer' AND s.user_id IS NOT NULL THEN
               EXISTS (SELECT 1 FROM public.events e
                        WHERE e.organizer_user_id = s.user_id AND e.published_at IS NOT NULL)
             ELSE false
           END AS live
      FROM s
     WHERE s.user_id IS NOT NULL
  ),
  funnel AS (
    SELECT
      count(*)                                                        AS opened,
      count(*) FILTER (WHERE s.kind IS NOT NULL)                      AS role,
      count(*) FILTER (WHERE s.steps ? 'structure' OR s.steps ? 'lead') AS structure,
      count(*) FILTER (WHERE s.email IS NOT NULL)                     AS email,
      count(*) FILTER (WHERE s.user_id IS NOT NULL)                   AS created,
      count(*) FILTER (WHERE s.console_opened_at IS NOT NULL)         AS console,
      (SELECT count(*) FROM prog WHERE prog.events > 0)               AS first_event,
      (SELECT count(*) FROM prog WHERE prog.payments)                 AS payments,
      (SELECT count(*) FROM prog WHERE prog.live)                     AS live,
      count(*) FILTER (WHERE s.user_id IS NOT NULL AND s.kind = 'club')      AS clubs,
      count(*) FILTER (WHERE s.user_id IS NOT NULL AND s.kind = 'organizer') AS organizers,
      count(*) FILTER (WHERE s.user_id IS NULL AND s.email IS NOT NULL)      AS leads,
      count(*) FILTER (WHERE s.user_id IS NULL AND s.email IS NOT NULL AND s.contacted_at IS NULL) AS to_contact
    FROM s
  ),
  days AS (
    SELECT d::date AS d
      FROM generate_series(date_trunc('day', v_from), date_trunc('day', now()), interval '1 day') d
  ),
  by_day AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'd', days.d,
             'started', (SELECT count(*) FROM s WHERE s.created_at::date = days.d AND s.kind IS NOT NULL),
             'created', (SELECT count(*) FROM s WHERE s.account_created_at::date = days.d)
           ) ORDER BY days.d), '[]'::jsonb) AS j
      FROM days
  ),
  by_source AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('source', src, 'started', started, 'created', created)
                              ORDER BY started DESC), '[]'::jsonb) AS j
      FROM (
        SELECT coalesce(nullif(s.utm_source, ''), nullif(s.source, ''), 'direct') AS src,
               count(*) FILTER (WHERE s.kind IS NOT NULL) AS started,
               count(*) FILTER (WHERE s.user_id IS NOT NULL) AS created
          FROM s GROUP BY 1
      ) x
     WHERE started > 0
  ),
  rows AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'created_at', s.created_at, 'updated_at', s.updated_at,
             'kind', s.kind, 'lang', s.lang,
             'first_name', s.first_name, 'last_name', s.last_name,
             'email', s.email, 'phone', s.phone,
             'org_name', s.org_name, 'city', s.city, 'country', coalesce(s.country, s.geo_country),
             'size_band', s.size_band, 'frequency', s.frequency, 'pillars', to_jsonb(s.pillars),
             'current_tool', s.current_tool, 'next_night', s.next_night,
             'source', s.source, 'utm_source', s.utm_source, 'utm_campaign', s.utm_campaign,
             'last_step', s.last_step,
             'user_id', s.user_id, 'venue_id', s.venue_id,
             'account_created_at', s.account_created_at, 'console_opened_at', s.console_opened_at,
             'contacted_at', s.contacted_at, 'admin_notes', s.admin_notes,
             'events', coalesce(p.events, 0), 'payments', coalesce(p.payments, false),
             'live', coalesce(p.live, false)
           ) ORDER BY coalesce(s.account_created_at, s.updated_at) DESC), '[]'::jsonb) AS j
      FROM (SELECT * FROM s WHERE s.email IS NOT NULL
             ORDER BY coalesce(s.account_created_at, s.updated_at) DESC LIMIT 300) s
      LEFT JOIN prog p ON p.id = s.id
  )
  SELECT jsonb_build_object(
    'funnel', (SELECT to_jsonb(funnel) FROM funnel),
    'by_day', (SELECT j FROM by_day),
    'by_source', (SELECT j FROM by_source),
    'rows', (SELECT j FROM rows),
    'from', v_from
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_pro_signups(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pro_signups(integer, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_update_pro_signup(
  p_id        uuid,
  p_contacted boolean DEFAULT NULL,
  p_notes     text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pro_signups SET
    contacted_at = CASE WHEN p_contacted IS NULL THEN contacted_at
                        WHEN p_contacted THEN coalesce(contacted_at, now())
                        ELSE NULL END,
    admin_notes  = CASE WHEN p_notes IS NULL THEN admin_notes
                        ELSE nullif(left(trim(p_notes), 2000), '') END
  WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_update_pro_signup(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_pro_signup(uuid, boolean, text) TO authenticated;

-- ── 5. Hygiène : un parcours anonyme sans email ne vit pas plus de 180 jours.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('pro-signups-purge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pro-signups-purge');
    PERFORM cron.schedule(
      'pro-signups-purge', '40 3 * * *',
      $$DELETE FROM public.pro_signups
         WHERE email IS NULL AND user_id IS NULL AND created_at < now() - interval '180 days'$$
    );
  END IF;
END
$cron$;
