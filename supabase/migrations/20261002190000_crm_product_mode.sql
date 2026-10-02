-- ============================================================================
-- Yuno CRM — lot 3 : le mode produit du compte et les lectures de la Console CRM.
-- Plan : docs/designs/YUNO_CRM_PLAN.md §5.1.
--
-- 1. `product` ('suite' | 'crm') sur le club et sur l'organisation : c'est LUI
--    qui décide de la Console montrée (barre, accueil, pages), jamais l'hôte
--    ni le build. Écrit à l'inscription (complete_pro_signup) ou par le super
--    admin (set_account_product) ; un client ne le change jamais lui-même.
-- 2. L'inscription libre-service porte le produit (track_pro_signup lit
--    `product`, complete_pro_signup crée un club / une organisation « crm »
--    sans piliers de vente ni guide de mise en vente).
-- 3. Lectures de la Console CRM, toutes sur la billetterie connectée :
--    get_crm_overview (accueil), get_crm_nights (soirées), get_crm_night_report
--    (bilan d'une soirée : courbe J-N comparée, tarifs, public, emails, UTM).
--    Porte : crm_scope_allowed (club : can_manage_venue ; organisation : le
--    fondateur ou un membre d'équipe éditeur+ ; super admin ; service_role).
-- ============================================================================

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'suite';
ALTER TABLE public.organizer_profiles ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'suite';
ALTER TABLE public.pro_signups ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'suite';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_product_check') THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_product_check CHECK (product IN ('suite', 'crm'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizer_profiles_product_check') THEN
    ALTER TABLE public.organizer_profiles ADD CONSTRAINT organizer_profiles_product_check CHECK (product IN ('suite', 'crm'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pro_signups_product_check') THEN
    ALTER TABLE public.pro_signups ADD CONSTRAINT pro_signups_product_check CHECK (product IN ('suite', 'crm'));
  END IF;
END $$;

-- organizer_profiles est en droits PAR COLONNE pour authenticated (identité
-- légale privée) : une colonne ajoutée doit être accordée explicitement.
GRANT SELECT (product) ON public.organizer_profiles TO authenticated;

-- Un client ne choisit pas son produit (ni à la création, ni après) : seuls le
-- service_role, le super admin et les fonctions SECURITY DEFINER (current_user
-- = propriétaire) l'écrivent. INVOKER : lit le rôle réel de l'instruction.
CREATE OR REPLACE FUNCTION public.guard_account_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_super_admin()
     AND NEW.product IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN 'suite' ELSE OLD.product END) THEN
    RAISE EXCEPTION 'product is set by Yuno only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_venue_product ON public.venues;
CREATE TRIGGER trg_guard_venue_product
  BEFORE INSERT OR UPDATE OF product ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_product();
DROP TRIGGER IF EXISTS trg_guard_organizer_product ON public.organizer_profiles;
CREATE TRIGGER trg_guard_organizer_product
  BEFORE INSERT OR UPDATE OF product ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_product();

-- Bascule manuelle (super admin) : un compte CRM qui passe à la billetterie
-- Yuno garde tout (contacts, segments, modèles) ; seul le produit change.
CREATE OR REPLACE FUNCTION public.set_account_product(p_venue_id text, p_organizer_user_id uuid, p_product text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_product NOT IN ('suite', 'crm') THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    UPDATE public.venues SET product = p_product WHERE id = p_venue_id;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    UPDATE public.organizer_profiles SET product = p_product WHERE user_id = p_organizer_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_account_product(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_account_product(text, uuid, text) TO authenticated, service_role;

-- ── 2. Inscription libre-service ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.track_pro_signup(p_key text, p_step text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx      record;
  v_row      public.pro_signups%ROWTYPE;
  v_recent   integer;
  v_d        jsonb := CASE WHEN jsonb_typeof(p_data) = 'object' AND length(p_data::text) <= 4000
                           THEN p_data ELSE '{}'::jsonb END;
  v_kind     text := lower(nullif(trim(coalesce(v_d->>'kind', '')), ''));
  v_email    text := lower(nullif(trim(coalesce(v_d->>'email', '')), ''));
  v_product  text := lower(nullif(trim(coalesce(v_d->>'product', '')), ''));
  v_pillars  text[];
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN; END IF;
  IF p_step NOT IN ('opened','role','structure','account','lead') THEN RETURN; END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('club','organizer','promoter','other') THEN v_kind := NULL; END IF;
  IF v_product IS NOT NULL AND v_product NOT IN ('suite','crm') THEN v_product := NULL; END IF;
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
    product       = coalesce(v_product, product),
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
END $function$;

CREATE OR REPLACE FUNCTION public.complete_pro_signup(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_crm       boolean;
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

  v_crm := coalesce(v_row.product, 'suite') = 'crm';
  v_name := nullif(trim(coalesce(v_row.org_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'org_name_required' USING ERRCODE = '22023';
  END IF;
  v_city := coalesce(nullif(trim(coalesce(v_row.city, '')), ''), '');
  v_pillars := CASE WHEN v_crm THEN '{}'::text[] ELSE coalesce(v_row.pillars, '{}') END;

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
      -- Caché jusqu'au « Go live » de l'onboarding (étape 7). Un club Yuno CRM
      -- ne vend rien chez Yuno : ni carte, ni placement VIP.
      INSERT INTO public.venues (id, name, city, owner_id, is_hidden, menu_enabled, vip_placement_enabled, product)
      VALUES (
        v_venue, v_name, v_city, v_uid, true,
        CASE WHEN v_crm THEN false WHEN cardinality(v_pillars) = 0 THEN true ELSE 'drinks' = ANY(v_pillars) END,
        NOT v_crm AND 'tables' = ANY(v_pillars),
        CASE WHEN v_crm THEN 'crm' ELSE 'suite' END
      );
      v_created := true;
    END IF;

    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (v_uid, 'owner'::public.app_role, v_email)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Onboarding : les piliers sont déjà choisis sur la landing → étape 1
    -- faite, le guide s'ouvre sur « Infos du club ». (Pas de piliers en CRM.)
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

    INSERT INTO public.organizer_profiles (user_id, display_name, city, product)
    VALUES (v_uid, v_name, nullif(v_city, ''), CASE WHEN v_crm THEN 'crm' ELSE 'suite' END)
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
        CASE WHEN v_row.kind = 'club' THEN 'Nouveau club inscrit' ELSE 'Nouvel organisateur inscrit' END
          || CASE WHEN v_crm THEN ' (Yuno CRM)' ELSE '' END,
        v_name || coalesce(' (' || nullif(v_city, '') || ')', '') || ' · ' || v_who
          || coalesce(' · ' || v_row.phone, '') || coalesce(' · via ' || v_row.source, '') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'product', v_row.product, 'org_name', v_name, 'city', v_city,
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
    'product', v_row.product,
    'venue_id', v_venue,
    'created', v_created,
    'redirect', '/get-started'
  );
END $function$;

-- ── 3. Lectures de la Console CRM ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
    COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND (
            p_organizer_user_id = auth.uid()
            OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'editor')))
    )));
$$;
REVOKE ALL ON FUNCTION public.crm_scope_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_allowed(text, uuid) TO authenticated, service_role;

-- Accueil : connexion, base, ventes 90 j, prochaines et dernières soirées.
CREATE OR REPLACE FUNCTION public.get_crm_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn jsonb;
  v_base jsonb;
  v_sales jsonb;
  v_upcoming jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('provider', c.provider, 'status', c.status, 'external_org_name', c.external_org_name,
                            'last_ok_at', c.last_ok_at, 'initial_import_done_at', c.initial_import_done_at,
                            'running', c.locked_until IS NOT NULL AND c.locked_until > now(), 'stats', c.stats)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;

  WITH subs AS (
    SELECT lower(s.email) AS em, bool_or(s.opted_in AND s.opted_out_at IS NULL) AS ok,
           bool_or(COALESCE(s.source, '') LIKE 'connector:%') AS from_ticketing
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     GROUP BY lower(s.email)
  ), buyers AS (
    SELECT DISTINCT lower(t.buyer_email) AS em
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred')
  )
  SELECT jsonb_build_object(
           'contacts', (SELECT count(*) FROM (SELECT em FROM subs UNION SELECT em FROM buyers) u),
           'reachable', (SELECT count(*) FROM subs WHERE ok AND NOT public.is_email_suppressed(em)),
           'reachable_from_ticketing', (SELECT count(*) FROM subs WHERE ok AND from_ticketing),
           'buyers', (SELECT count(*) FROM buyers)
         ) INTO v_base;

  SELECT jsonb_build_object(
           'tickets', COALESCE(sum(GREATEST(t.quantity, 1)), 0),
           'revenue', COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0),
           'buyers', count(DISTINCT lower(t.buyer_email)),
           'nights', count(DISTINCT t.event_id)
         ) INTO v_sales
    FROM public.external_tickets t
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND t.status IN ('valid', 'transferred')
     AND COALESCE(t.purchased_at, t.first_seen_at) > now() - interval '90 days';

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'start_at'), '[]'::jsonb) INTO v_upcoming FROM (
    SELECT jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
             'cover_url', COALESCE(e.poster_url, e.image_url), 'url', e.external_ticket_url,
             'sold_out', e.tickets_sold_out, 'cancelled', e.cancelled_at IS NOT NULL,
             'tickets', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')),
             'tickets_today', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
                            AND COALESCE(t.purchased_at, t.first_seen_at) >= date_trunc('day', now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')),
             'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred'))
           ) AS x
      FROM public.events e
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at > now()
     ORDER BY e.start_at ASC
     LIMIT 5
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'start_at' DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
             'cover_url', COALESCE(e.poster_url, e.image_url),
             'tickets', COALESCE(sum(GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 0),
             'buyers', count(DISTINCT lower(t.buyer_email)) FILTER (WHERE t.status IN ('valid', 'transferred')),
             'scanned', count(*) FILTER (WHERE t.scanned_at IS NOT NULL),
             'revenue', COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 2), 0)
           ) AS x
      FROM public.events e
      LEFT JOIN public.external_tickets t ON t.event_id = e.id
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now()
     GROUP BY e.id
     ORDER BY e.start_at DESC
     LIMIT 5
  ) q;

  RETURN jsonb_build_object('connection', v_conn, 'base', v_base, 'sales_90d', v_sales,
                            'upcoming', v_upcoming, 'recent', v_recent);
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_overview(text, uuid) TO authenticated, service_role;

-- Soirées importées, la plus récente d'abord, avec leurs chiffres.
CREATE OR REPLACE FUNCTION public.get_crm_nights(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 60, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_total integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.events e
   WHERE e.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  WITH ev AS (
    SELECT e.* FROM public.events e
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     ORDER BY e.start_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
  ), firsts AS (
    -- Première soirée de chaque acheteur dans la portée (billetterie connectée).
    SELECT DISTINCT ON (lower(t.buyer_email)) lower(t.buyer_email) AS em, t.event_id
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred') AND t.event_id IS NOT NULL
     ORDER BY lower(t.buyer_email), COALESCE(t.purchased_at, t.first_seen_at)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'event_id', ev.id, 'title', ev.title, 'start_at', ev.start_at, 'end_at', ev.end_at,
           'cover_url', COALESCE(ev.poster_url, ev.image_url), 'url', ev.external_ticket_url,
           'cancelled', ev.cancelled_at IS NOT NULL, 'sold_out', ev.tickets_sold_out,
           'upcoming', ev.end_at > now(),
           'tickets', st.tickets, 'revenue', st.revenue, 'buyers', st.buyers,
           'new_buyers', (SELECT count(*) FROM firsts f WHERE f.event_id = ev.id),
           'scanned', st.scanned, 'refunded', st.refunded,
           'first_sale_at', st.first_sale_at
         ) ORDER BY ev.start_at DESC), '[]'::jsonb) INTO v
    FROM ev
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 0) AS tickets,
             COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 2), 0) AS revenue,
             count(DISTINCT lower(t.buyer_email)) FILTER (WHERE t.status IN ('valid', 'transferred')) AS buyers,
             count(*) FILTER (WHERE t.scanned_at IS NOT NULL) AS scanned,
             count(*) FILTER (WHERE t.status IN ('refunded', 'cancelled')) AS refunded,
             min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_sale_at
        FROM public.external_tickets t WHERE t.event_id = ev.id
    ) st ON true;

  RETURN jsonb_build_object('total', v_total, 'nights', v);
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_nights(text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_nights(text, uuid, integer, integer) TO authenticated, service_role;

-- Bilan d'une soirée de billetterie connectée.
CREATE OR REPLACE FUNCTION public.get_crm_night_report(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.events%ROWTYPE;
  v_tz text;
  v_prev uuid;
  v_totals jsonb;
  v_curve jsonb;
  v_prev_curve jsonb;
  v_prev_info jsonb;
  v_deals jsonb;
  v_audience jsonb;
  v_campaigns jsonb;
  v_utm jsonb;
  v_ext jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR e.external_source IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.crm_scope_allowed(e.venue_id, e.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');

  SELECT jsonb_build_object('left_tickets', ee.left_tickets, 'deals_offered', jsonb_array_length(COALESCE(ee.deals, '[]'::jsonb)),
                            'launched_at', ee.launched_at, 'published_at', ee.published_at, 'artists', ee.artists, 'genres', ee.genres)
    INTO v_ext FROM public.external_events ee WHERE ee.event_id = e.id LIMIT 1;

  -- Totaux. Nouveaux = première soirée de la personne dans la portée.
  WITH mine AS (
    SELECT t.* FROM public.external_tickets t WHERE t.event_id = e.id
  ), scope_first AS (
    SELECT lower(t.buyer_email) AS em, min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_at
      FROM public.external_tickets t
     WHERE t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred')
       AND ((e.venue_id IS NOT NULL AND t.venue_id = e.venue_id)
         OR (e.organizer_user_id IS NOT NULL AND t.organizer_user_id = e.organizer_user_id))
       AND lower(t.buyer_email) IN (SELECT lower(m.buyer_email) FROM mine m WHERE m.buyer_email IS NOT NULL)
     GROUP BY lower(t.buyer_email)
  ), my_buyers AS (
    SELECT lower(m.buyer_email) AS em, min(COALESCE(m.purchased_at, m.first_seen_at)) AS at
      FROM mine m WHERE m.buyer_email IS NOT NULL AND m.status IN ('valid', 'transferred')
     GROUP BY lower(m.buyer_email)
  )
  SELECT jsonb_build_object(
    'tickets', (SELECT COALESCE(sum(GREATEST(quantity, 1)), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'revenue', (SELECT COALESCE(round(sum(COALESCE(price, 0) * GREATEST(quantity, 1)), 2), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'fees', (SELECT COALESCE(round(sum(COALESCE(fees, 0) * GREATEST(quantity, 1)), 2), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'buyers', (SELECT count(*) FROM my_buyers),
    'new_buyers', (SELECT count(*) FROM my_buyers b JOIN scope_first f ON f.em = b.em WHERE f.first_at >= b.at),
    'scanned', (SELECT count(*) FROM mine WHERE scanned_at IS NOT NULL),
    'scan_known', (SELECT bool_or(scanned_at IS NOT NULL) FROM mine),
    'refunded', (SELECT count(*) FROM mine WHERE status IN ('refunded', 'cancelled')),
    'with_email', (SELECT count(*) FROM mine WHERE buyer_email IS NOT NULL),
    'all_tickets', (SELECT count(*) FROM mine),
    'optin_buyers', (SELECT count(DISTINCT lower(buyer_email)) FROM mine WHERE newsletter_optin IS TRUE AND status IN ('valid', 'transferred'))
  ) INTO v_totals;

  -- Courbe J-N : billets vendus par jour calendaire avant la soirée (fuseau de la soirée).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'tickets', n) ORDER BY d DESC), '[]'::jsonb) INTO v_curve FROM (
    SELECT GREATEST(((e.start_at AT TIME ZONE v_tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date), 0) AS d,
           sum(GREATEST(t.quantity, 1)) AS n
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
     GROUP BY 1
  ) c;

  -- Soirée de comparaison : la précédente de la portée (billetterie connectée).
  SELECT p.id INTO v_prev FROM public.events p
   WHERE p.external_source IS NOT NULL AND p.id <> e.id AND p.start_at < e.start_at AND p.cancelled_at IS NULL
     AND ((e.venue_id IS NOT NULL AND p.venue_id = e.venue_id)
       OR (e.organizer_user_id IS NOT NULL AND p.organizer_user_id = e.organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = p.id)
   ORDER BY p.start_at DESC LIMIT 1;
  IF v_prev IS NOT NULL THEN
    SELECT jsonb_build_object('event_id', p.id, 'title', p.title, 'start_at', p.start_at,
             'tickets', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t WHERE t.event_id = p.id AND t.status IN ('valid', 'transferred')),
             'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0) FROM public.external_tickets t WHERE t.event_id = p.id AND t.status IN ('valid', 'transferred')))
      INTO v_prev_info FROM public.events p WHERE p.id = v_prev;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'tickets', n) ORDER BY d DESC), '[]'::jsonb) INTO v_prev_curve FROM (
      SELECT GREATEST(((p.start_at AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'Europe/Paris'))::date
                     - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'Europe/Paris'))::date), 0) AS d,
             sum(GREATEST(t.quantity, 1)) AS n
        FROM public.external_tickets t JOIN public.events p ON p.id = t.event_id
       WHERE t.event_id = v_prev AND t.status IN ('valid', 'transferred')
       GROUP BY 1
    ) c;
  END IF;

  -- Tarifs.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_deals FROM (
    SELECT jsonb_build_object('name', COALESCE(t.deal_name, '—'),
             'tickets', sum(GREATEST(t.quantity, 1)),
             'revenue', round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2)) AS x
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
     GROUP BY COALESCE(t.deal_name, '—')
  ) q;

  -- Public (ce que la billetterie a transmis ; la couverture est rendue).
  SELECT jsonb_build_object(
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC) FROM (
                SELECT initcap(lower(t.city)) AS city, count(DISTINCT lower(COALESCE(t.buyer_email, t.external_id))) AS n
                  FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND NULLIF(btrim(t.city), '') IS NOT NULL
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 6) c), '[]'::jsonb),
    'ages', COALESCE((SELECT jsonb_agg(jsonb_build_object('band', band, 'n', n) ORDER BY band) FROM (
                SELECT CASE WHEN t.age < 21 THEN '18-20' WHEN t.age < 25 THEN '21-24' WHEN t.age < 30 THEN '25-29'
                            WHEN t.age < 35 THEN '30-34' ELSE '35+' END AS band, count(*) AS n
                  FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.age IS NOT NULL
                 GROUP BY 1) a), '[]'::jsonb),
    'genders', COALESCE((SELECT jsonb_object_agg(g, n) FROM (
                SELECT t.gender AS g, count(*) AS n FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.gender IS NOT NULL
                 GROUP BY 1) g), '{}'::jsonb),
    'with_city', (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND NULLIF(btrim(t.city), '') IS NOT NULL),
    'with_age', (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.age IS NOT NULL)
  ) INTO v_audience;

  -- Emails de la soirée et ventes attribuées (1er clic → achat de CETTE soirée < 72 h).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sent_at' DESC NULLS LAST), '[]'::jsonb) INTO v_campaigns FROM (
    SELECT jsonb_build_object(
             'campaign_id', c.id, 'name', c.name, 'subject', c.subject, 'sent_at', c.sent_at, 'status', c.status,
             'automation', c.automation_id IS NOT NULL,
             'recipients', COALESCE(c.total_recipients, c.recipients_count, 0),
             'opens', COALESCE(c.opens_count, 0), 'clicks', COALESCE(c.clicks_count, 0),
             'attributed_tickets', COALESCE(att.tickets, 0), 'attributed_revenue', COALESCE(att.revenue, 0)
           ) AS x
      FROM public.email_campaigns c
      LEFT JOIN LATERAL (
        SELECT sum(GREATEST(t.quantity, 1)) AS tickets, round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2) AS revenue
          FROM (SELECT lower(ce.recipient_email) AS em, min(ce.created_at) AS click_at
                  FROM public.email_campaign_events ce
                 WHERE ce.campaign_id = c.id AND ce.event_type = 'clicked' AND ce.recipient_email IS NOT NULL
                 GROUP BY 1) k
          JOIN public.external_tickets t ON t.event_id = e.id AND lower(t.buyer_email) = k.em
               AND t.status IN ('valid', 'transferred')
               AND COALESCE(t.purchased_at, t.first_seen_at) >= k.click_at
               AND COALESCE(t.purchased_at, t.first_seen_at) < k.click_at + interval '72 hours'
      ) att ON true
     WHERE (c.event_id = e.id OR c.automation_trigger_event_id = e.id)
       AND c.status IN ('sent', 'sending', 'completed')
  ) q;

  -- Sources UTM rapportées par la billetterie.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_utm FROM (
    SELECT jsonb_build_object('source', COALESCE(t.utm->>'utm_source', '—'), 'medium', t.utm->>'utm_medium',
             'tickets', sum(GREATEST(t.quantity, 1)),
             'revenue', round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2)) AS x
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.utm IS NOT NULL
     GROUP BY COALESCE(t.utm->>'utm_source', '—'), t.utm->>'utm_medium'
     ORDER BY sum(GREATEST(t.quantity, 1)) DESC LIMIT 8
  ) q;

  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                'timezone', v_tz, 'cover_url', COALESCE(e.poster_url, e.image_url),
                                'url', e.external_ticket_url, 'cancelled', e.cancelled_at IS NOT NULL,
                                'sold_out', e.tickets_sold_out, 'location_city', e.location_city,
                                'entry_target', e.entry_target, 'external', v_ext),
    'totals', v_totals, 'curve', v_curve,
    'compare', CASE WHEN v_prev IS NULL THEN NULL ELSE jsonb_build_object('event', v_prev_info, 'curve', v_prev_curve) END,
    'deals', v_deals, 'audience', v_audience, 'campaigns', v_campaigns, 'utm', v_utm
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_night_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_night_report(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
