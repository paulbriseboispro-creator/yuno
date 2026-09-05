-- ═══════════════════════════════════════════════════════════════════════════
-- Yuno Links — le mini-linktree de la bio Instagram / TikTok (route /links).
--
-- Une page publique branchée sur la vraie base : compteurs vivants (clubs,
-- soirées du week-end), soirées à l'affiche, liste d'attente client
-- (launch_waitlist), formulaire pro relié à WhatsApp, et une mesure
-- d'audience propre (vues / clics par cible) lisible par le super admin.
--
-- Mesure SANS cookie : même modèle que le trafic plateforme (20260827100000) —
-- hash salé-jour IP+UA reconstruit côté serveur, jamais d'identifiant client.
-- Écritures UNIQUEMENT via les RPC SECURITY DEFINER ci-dessous ; lecture
-- UNIQUEMENT via les RPC gatées is_super_admin(). Les tables de mesure sont
-- en RLS totale sans policy : invisibles côté client.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Configuration de la page (une ligne, éditée depuis /admin/links) ────

CREATE TABLE IF NOT EXISTS public.links_page_config (
  id         text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.links_page_config (id, config) VALUES ('default', jsonb_build_object(
  'instagram_fr',    'https://www.instagram.com/yunoapp.fr/',
  'instagram_intl',  'https://www.instagram.com/yunoapp.eu',
  'tiktok',          '',
  'whatsapp_number', '',
  'app_store_url',   'https://apps.apple.com/us/app/yuno-nightlife-tickets/id6799487527',
  'live_cities',     jsonb_build_array('Madrid', 'Paris'),
  'waitlist_cities', jsonb_build_array('Lyon', 'Bordeaux', 'Toulouse', 'Marseille', 'Barcelona'),
  'show_featured',   true,
  'show_waitlist',   true,
  'show_pros',       true,
  'featured_limit',  6
)) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.links_page_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "links_config_public_read" ON public.links_page_config;
CREATE POLICY "links_config_public_read"
  ON public.links_page_config FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "links_config_admin_update" ON public.links_page_config;
CREATE POLICY "links_config_admin_update"
  ON public.links_page_config FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ─── 2. Mesure d'audience de la page ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.links_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  visitor_hash  text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('view', 'click', 'waitlist', 'pro_lead')),
  -- Cible d'un clic : app_store, web_app, instagram, tiktok, whatsapp, share,
  -- featured_all, event:<uuid>…
  target        text,
  lang          text,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device        text,
  browser       text,
  os            text,
  country       text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_links_events_time    ON public.links_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_links_events_visitor ON public.links_events (visitor_hash, occurred_at DESC);

ALTER TABLE public.links_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.links_events FROM anon, authenticated;

-- ─── 3. Leads pro (clubs & organisateurs) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.links_pro_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  name            text NOT NULL,
  org_name        text,
  org_type        text NOT NULL DEFAULT 'other'
                  CHECK (org_type IN ('club', 'organizer', 'promoter', 'agency', 'other')),
  city            text,
  phone           text,
  email           text,
  message         text,
  lang            text,
  visitor_hash    text,
  whatsapp_opened boolean NOT NULL DEFAULT false,
  contacted_at    timestamptz,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_links_pro_leads_created ON public.links_pro_leads (created_at DESC);

ALTER TABLE public.links_pro_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "links_leads_admin_select" ON public.links_pro_leads;
CREATE POLICY "links_leads_admin_select"
  ON public.links_pro_leads FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "links_leads_admin_update" ON public.links_pro_leads;
CREATE POLICY "links_leads_admin_update"
  ON public.links_pro_leads FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "links_leads_admin_delete" ON public.links_pro_leads;
CREATE POLICY "links_leads_admin_delete"
  ON public.links_pro_leads FOR DELETE TO authenticated
  USING (public.is_super_admin());
-- Aucune policy INSERT : l'insertion passe par submit_links_pro_lead().

-- Alerte super admin à chaque lead (même flux que la waitlist).
CREATE OR REPLACE FUNCTION public.notify_admin_links_pro_lead()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_links_pro_lead',
    'Nouveau lead pro via Yuno Links',
    NEW.name
      || COALESCE(' — ' || NEW.org_name, '')
      || COALESCE(' (' || NEW.city || ')', '')
      || ' · ' || NEW.org_type || '.',
    'high', 'links_pro_lead', NEW.id::text,
    jsonb_build_object('name', NEW.name, 'org_name', NEW.org_name, 'org_type', NEW.org_type,
                       'city', NEW.city, 'phone', NEW.phone, 'email', NEW.email),
    'links_lead:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_links_pro_lead ON public.links_pro_leads;
CREATE TRIGGER trg_notify_admin_links_pro_lead
  AFTER INSERT ON public.links_pro_leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_links_pro_lead();

-- ─── 4. Liste d'attente client : d'où vient l'inscription ───────────────────

ALTER TABLE public.launch_waitlist ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.launch_waitlist ADD COLUMN IF NOT EXISTS lang   text;

-- ─── 5. Contexte visiteur (interne) ─────────────────────────────────────────
-- Hash salé-jour IP+UA pour les anonymes, uid pseudonymisé pour les connectés,
-- device / navigateur / OS / pays depuis les en-têtes — identique au trafic
-- plateforme pour que les deux mesures parlent le même langage.

CREATE OR REPLACE FUNCTION public.links_visitor_context(
  OUT o_hash text, OUT o_device text, OUT o_browser text, OUT o_os text, OUT o_country text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_headers json;
  v_ip      text;
  v_ua      text;
  v_salt    uuid;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
    v_ip      := nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    v_ua      := nullif(left(coalesce(v_headers->>'user-agent', ''), 400), '');
    o_country := upper(nullif(left(coalesce(v_headers->>'cf-ipcountry', ''), 2), ''));
    IF o_country IN ('XX', 'T1') THEN o_country := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL; v_ua := NULL; o_country := NULL;
  END;

  IF auth.uid() IS NOT NULL THEN
    o_hash := 'u:' || md5(auth.uid()::text);
  ELSE
    INSERT INTO platform_daily_salts (day) VALUES (current_date) ON CONFLICT (day) DO NOTHING;
    SELECT salt INTO v_salt FROM platform_daily_salts WHERE day = current_date;
    o_hash := 'a:' || encode(sha256(convert_to(v_salt::text || coalesce(v_ip, '0.0.0.0') || coalesce(v_ua, ''), 'UTF8')), 'hex');
  END IF;

  SELECT t.device, t.browser, t.os INTO o_device, o_browser, o_os
  FROM public.platform_parse_ua(v_ua, false) t;
END $$;

REVOKE ALL ON FUNCTION public.links_visitor_context() FROM PUBLIC, anon, authenticated;

-- ─── 6. Écritures publiques ─────────────────────────────────────────────────

-- Une vue de page ou un clic. Fire-and-forget côté client.
CREATE OR REPLACE FUNCTION public.track_links_event(
  p_kind          text,
  p_target        text DEFAULT NULL,
  p_lang          text DEFAULT NULL,
  p_referrer_host text DEFAULT NULL,
  p_utm_source    text DEFAULT NULL,
  p_utm_medium    text DEFAULT NULL,
  p_utm_campaign  text DEFAULT NULL,
  p_meta          jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx    record;
  v_recent integer;
  v_ref    text;
BEGIN
  IF p_kind NOT IN ('view', 'click') THEN RETURN; END IF;
  -- Jamais compter l'équipe.
  IF auth.uid() IS NOT NULL AND public.is_super_admin() THEN RETURN; END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();

  -- Anti-flood : 120 événements / heure / visiteur.
  SELECT count(*) INTO v_recent
  FROM links_events
  WHERE visitor_hash = v_ctx.o_hash AND occurred_at > now() - interval '1 hour';
  IF v_recent >= 120 THEN RETURN; END IF;

  v_ref := nullif(left(lower(coalesce(p_referrer_host, '')), 120), '');
  IF v_ref IS NOT NULL AND (v_ref LIKE '%yunoapp.eu%' OR v_ref LIKE 'localhost%') THEN
    v_ref := NULL;
  END IF;

  INSERT INTO links_events (
    visitor_hash, kind, target, lang, referrer_host,
    utm_source, utm_medium, utm_campaign,
    device, browser, os, country, meta
  ) VALUES (
    v_ctx.o_hash, p_kind, left(nullif(trim(p_target), ''), 120), lower(left(nullif(p_lang, ''), 2)), v_ref,
    left(nullif(p_utm_source, ''), 120), left(nullif(p_utm_medium, ''), 120), left(nullif(p_utm_campaign, ''), 120),
    v_ctx.o_device, v_ctx.o_browser, v_ctx.o_os, v_ctx.o_country,
    CASE WHEN jsonb_typeof(p_meta) = 'object' AND length(p_meta::text) <= 2000 THEN p_meta ELSE '{}'::jsonb END
  );
END $$;

REVOKE ALL ON FUNCTION public.track_links_event(text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_links_event(text, text, text, text, text, text, text, jsonb) TO anon, authenticated;

-- Inscription à la liste d'attente client. Renvoie 'joined' ou 'already'.
-- L'email est UNIQUE dans launch_waitlist : une seconde inscription n'est pas
-- une erreur pour la personne, on lui dit simplement qu'elle y est déjà.
CREATE OR REPLACE FUNCTION public.join_links_waitlist(
  p_email     text,
  p_full_name text,
  p_city      text,
  p_lang      text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx    record;
  v_recent integer;
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_name   text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_city   text := nullif(regexp_replace(trim(coalesce(p_city, '')), '\s+', ' ', 'g'), '');
  v_first  text;
  v_last   text;
BEGIN
  IF v_email = '' OR length(v_email) > 254 OR v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) > 150 OR length(coalesce(v_city, '')) > 120 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();

  SELECT count(*) INTO v_recent
  FROM links_events
  WHERE visitor_hash = v_ctx.o_hash AND kind = 'waitlist' AND occurred_at > now() - interval '1 hour';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- « Prénom Nom » : le premier mot devient le prénom, le reste le nom.
  v_first := nullif(split_part(v_name, ' ', 1), '');
  v_last  := nullif(trim(substr(v_name, length(coalesce(v_first, '')) + 1)), '');

  BEGIN
    INSERT INTO launch_waitlist (email, first_name, last_name, city, source, lang)
    VALUES (v_email, v_first, v_last, v_city, 'links', lower(left(nullif(p_lang, ''), 2)));
  EXCEPTION WHEN unique_violation THEN
    -- Déjà inscrit·e : on complète la ville si elle manquait, sans réécrire le reste.
    UPDATE launch_waitlist SET city = coalesce(city, v_city) WHERE email = v_email;
    INSERT INTO links_events (visitor_hash, kind, target, lang, device, browser, os, country, meta)
    VALUES (v_ctx.o_hash, 'waitlist', 'already', lower(left(nullif(p_lang, ''), 2)),
            v_ctx.o_device, v_ctx.o_browser, v_ctx.o_os, v_ctx.o_country,
            jsonb_build_object('city', v_city));
    RETURN 'already';
  END;

  INSERT INTO links_events (visitor_hash, kind, target, lang, device, browser, os, country, meta)
  VALUES (v_ctx.o_hash, 'waitlist', 'joined', lower(left(nullif(p_lang, ''), 2)),
          v_ctx.o_device, v_ctx.o_browser, v_ctx.o_os, v_ctx.o_country,
          jsonb_build_object('city', v_city));
  RETURN 'joined';
END $$;

REVOKE ALL ON FUNCTION public.join_links_waitlist(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_links_waitlist(text, text, text, text) TO anon, authenticated;

-- Lead pro : enregistré en base AVANT l'ouverture de WhatsApp, pour qu'un pro
-- qui referme WhatsApp sans écrire ne soit pas perdu.
CREATE OR REPLACE FUNCTION public.submit_links_pro_lead(
  p_name     text,
  p_org_name text DEFAULT NULL,
  p_org_type text DEFAULT 'other',
  p_city     text DEFAULT NULL,
  p_phone    text DEFAULT NULL,
  p_email    text DEFAULT NULL,
  p_message  text DEFAULT NULL,
  p_lang     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx    record;
  v_recent integer;
  v_id     uuid;
  v_name   text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_type   text := lower(trim(coalesce(p_org_type, 'other')));
BEGIN
  IF v_name = '' OR length(v_name) > 150 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('club', 'organizer', 'promoter', 'agency', 'other') THEN v_type := 'other'; END IF;
  IF length(coalesce(p_org_name, '')) > 150 OR length(coalesce(p_city, '')) > 120
     OR length(coalesce(p_phone, '')) > 30 OR length(coalesce(p_email, '')) > 254
     OR length(coalesce(p_message, '')) > 1000 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();

  SELECT count(*) INTO v_recent
  FROM links_pro_leads
  WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO links_pro_leads (name, org_name, org_type, city, phone, email, message, lang, visitor_hash)
  VALUES (
    v_name,
    nullif(trim(coalesce(p_org_name, '')), ''),
    v_type,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    nullif(trim(coalesce(p_message, '')), ''),
    lower(left(nullif(p_lang, ''), 2)),
    v_ctx.o_hash
  )
  RETURNING id INTO v_id;

  INSERT INTO links_events (visitor_hash, kind, target, lang, device, browser, os, country, meta)
  VALUES (v_ctx.o_hash, 'pro_lead', v_type, lower(left(nullif(p_lang, ''), 2)),
          v_ctx.o_device, v_ctx.o_browser, v_ctx.o_os, v_ctx.o_country,
          jsonb_build_object('lead_id', v_id));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_links_pro_lead(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_links_pro_lead(text, text, text, text, text, text, text, text) TO anon, authenticated;

-- ─── 7. Lectures publiques : les chiffres vivants et l'affiche ──────────────

-- Compteurs du bandeau : clubs (Yuno + partenaires affiliés), soirées à venir,
-- soirées « ce week-end » (vendredi 00:00 → lundi 06:00, heure de Paris ; le
-- dimanche soir compte encore, le lundi bascule sur le week-end suivant).
CREATE OR REPLACE FUNCTION public.get_links_public_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now_paris timestamp := (now() AT TIME ZONE 'Europe/Paris');
  v_monday    date      := date_trunc('week', v_now_paris)::date;
  v_fri       timestamptz;
  v_mon       timestamptz;
  v_venues    integer;
  v_aff       integer;
  v_upcoming  integer;
  v_aff_up    integer;
  v_weekend   integer;
  v_aff_we    integer;
  v_cities    jsonb;
BEGIN
  -- Un lundi avant 06:00 appartient encore à la nuit du dimanche.
  IF extract(isodow FROM v_now_paris) = 1 AND extract(hour FROM v_now_paris) < 6 THEN
    v_monday := v_monday - 7;
  END IF;
  v_fri := ((v_monday + 4)::timestamp AT TIME ZONE 'Europe/Paris');
  v_mon := (((v_monday + 7)::timestamp + interval '6 hours') AT TIME ZONE 'Europe/Paris');

  SELECT count(*) INTO v_venues
  FROM venues
  WHERE coalesce(is_hidden, false) = false AND decommissioned_at IS NULL;

  SELECT count(*) INTO v_aff FROM affiliate_venues WHERE is_active = true;

  SELECT count(*) INTO v_upcoming
  FROM events
  WHERE is_active = true AND visibility = 'public' AND is_discoverable = true
    AND end_at >= now();

  SELECT count(*) INTO v_aff_up
  FROM affiliate_events
  WHERE status IN ('published', 'featured') AND event_date >= (v_now_paris::date - 1);

  SELECT count(*) INTO v_weekend
  FROM events
  WHERE is_active = true AND visibility = 'public' AND is_discoverable = true
    AND end_at >= now() AND start_at >= v_fri AND start_at < v_mon;

  SELECT count(*) INTO v_aff_we
  FROM affiliate_events
  WHERE status IN ('published', 'featured')
    AND event_date >= (v_monday + 4) AND event_date <= (v_monday + 6);

  SELECT coalesce(jsonb_agg(c ORDER BY n DESC), '[]'::jsonb) INTO v_cities
  FROM (
    SELECT city AS c, count(*) AS n
    FROM (
      SELECT city FROM venues WHERE coalesce(is_hidden, false) = false AND decommissioned_at IS NULL AND city IS NOT NULL
      UNION ALL
      SELECT city FROM affiliate_venues WHERE is_active = true AND city IS NOT NULL
    ) x
    GROUP BY city
    ORDER BY n DESC
    LIMIT 12
  ) y;

  RETURN jsonb_build_object(
    'venues',          v_venues + v_aff,
    'upcoming_events', v_upcoming + v_aff_up,
    'weekend_events',  v_weekend + v_aff_we,
    'cities',          v_cities,
    'weekend_from',    v_fri,
    'weekend_to',      v_mon
  );
END $$;

REVOKE ALL ON FUNCTION public.get_links_public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_links_public_stats() TO anon, authenticated;

-- Soirées à l'affiche : les prochaines soirées publiques, avec l'hôte de
-- l'URL propre (event_host_slug), le club, la ville, le prix d'appel et la
-- présence d'une guest list ouverte.
CREATE OR REPLACE FUNCTION public.get_links_featured_events(p_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',            e.id,
    'slug',          e.slug,
    'host',          public.event_host_slug(e.id),
    'title',         e.title,
    'poster_url',    e.poster_url,
    'start_at',      e.start_at,
    'end_at',        e.end_at,
    'timezone',      e.timezone,
    'venue_name',    coalesce(v.name, e.location_name),
    'city',          coalesce(v.city, e.location_city),
    'is_live',       (e.start_at <= now() AND e.end_at > now()),
    'min_price',     (SELECT min(tr.price) FROM ticket_rounds tr WHERE tr.event_id = e.id AND tr.is_active = true),
    'has_guest_list', EXISTS (
                        SELECT 1 FROM guest_lists gl
                        WHERE gl.event_id = e.id AND gl.is_active = true
                          AND coalesce(array_length(gl.public_entry_types, 1), 0) > 0
                      )
  ) ORDER BY e.start_at), '[]'::jsonb)
  FROM (
    SELECT e.*
    FROM events e
    WHERE e.is_active = true AND e.visibility = 'public' AND e.is_discoverable = true
      AND e.end_at >= now()
    ORDER BY e.start_at
    LIMIT greatest(1, least(coalesce(p_limit, 6), 12))
  ) e
  LEFT JOIN venues v ON v.id = e.venue_id;
$$;

REVOKE ALL ON FUNCTION public.get_links_featured_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_links_featured_events(integer) TO anon, authenticated;

-- ─── 8. Lecture admin : l'audience de la page ───────────────────────────────

CREATE OR REPLACE FUNCTION public.get_links_analytics(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from      timestamptz := p_from;
  v_to        timestamptz := p_to;
  v_gran      text;
  v_step      interval;
  v_totals    jsonb;
  v_series    jsonb;
  v_targets   jsonb;
  v_events    jsonb;
  v_langs     jsonb;
  v_countries jsonb;
  v_devices   jsonb;
  v_referrers jsonb;
  v_utm       jsonb;
  v_wl_cities jsonb;
  v_lead_types jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to <= v_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF v_to - v_from > interval '400 days' THEN v_from := v_to - interval '400 days'; END IF;
  IF v_to - v_from <= interval '3 days' THEN
    v_gran := 'hour'; v_step := interval '1 hour';
  ELSE
    v_gran := 'day'; v_step := interval '1 day';
  END IF;

  SELECT jsonb_build_object(
    'views',          count(*) FILTER (WHERE kind = 'view'),
    'visitors',       count(DISTINCT visitor_hash) FILTER (WHERE kind = 'view'),
    'clicks',         count(*) FILTER (WHERE kind = 'click'),
    'click_visitors', count(DISTINCT visitor_hash) FILTER (WHERE kind = 'click'),
    'waitlist',       count(*) FILTER (WHERE kind = 'waitlist' AND target = 'joined'),
    'pro_leads',      count(*) FILTER (WHERE kind = 'pro_lead')
  )
  INTO v_totals
  FROM links_events
  WHERE occurred_at >= v_from AND occurred_at < v_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           't', b.bucket,
           'views',    coalesce(x.views, 0),
           'visitors', coalesce(x.visitors, 0),
           'clicks',   coalesce(x.clicks, 0),
           'signups',  coalesce(x.signups, 0)
         ) ORDER BY b.bucket), '[]'::jsonb)
  INTO v_series
  FROM (SELECT generate_series(date_trunc(v_gran, v_from), v_to, v_step) AS bucket) b
  LEFT JOIN (
    SELECT date_trunc(v_gran, occurred_at) AS d,
           count(*) FILTER (WHERE kind = 'view') AS views,
           count(DISTINCT visitor_hash) FILTER (WHERE kind = 'view') AS visitors,
           count(*) FILTER (WHERE kind = 'click') AS clicks,
           count(*) FILTER (WHERE kind IN ('waitlist', 'pro_lead') AND coalesce(target, '') <> 'already') AS signups
    FROM links_events
    WHERE occurred_at >= v_from AND occurred_at < v_to
    GROUP BY 1
  ) x ON x.d = b.bucket
  WHERE b.bucket < v_to;

  -- Clics par cible (les soirées sont regroupées sous 'event').
  SELECT coalesce(jsonb_agg(jsonb_build_object('target', tg, 'clicks', n, 'visitors', v) ORDER BY n DESC), '[]'::jsonb)
  INTO v_targets
  FROM (
    SELECT CASE WHEN target LIKE 'event:%' THEN 'event' ELSE coalesce(target, 'unknown') END AS tg,
           count(*) AS n, count(DISTINCT visitor_hash) AS v
    FROM links_events
    WHERE kind = 'click' AND occurred_at >= v_from AND occurred_at < v_to
    GROUP BY 1
  ) x;

  -- Soirées cliquées depuis l'affiche.
  SELECT coalesce(jsonb_agg(jsonb_build_object('event_id', eid, 'title', title, 'clicks', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT substr(le.target, 7) AS eid, e.title, count(*) AS n
    FROM links_events le
    LEFT JOIN events e ON e.id::text = substr(le.target, 7)
    WHERE le.kind = 'click' AND le.target LIKE 'event:%'
      AND le.occurred_at >= v_from AND le.occurred_at < v_to
    GROUP BY 1, 2
    ORDER BY n DESC
    LIMIT 10
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_langs
  FROM (SELECT coalesce(lang, '?') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_countries
  FROM (SELECT coalesce(country, '?') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1
        ORDER BY n DESC LIMIT 12) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_devices
  FROM (SELECT coalesce(device, '?') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_referrers
  FROM (SELECT coalesce(referrer_host, 'direct') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1
        ORDER BY n DESC LIMIT 12) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_utm
  FROM (SELECT coalesce(utm_source, '') || CASE WHEN utm_campaign IS NOT NULL THEN ' / ' || utm_campaign ELSE '' END AS k,
               count(DISTINCT visitor_hash) AS n
        FROM links_events
        WHERE kind = 'view' AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)
          AND occurred_at >= v_from AND occurred_at < v_to
        GROUP BY 1 ORDER BY n DESC LIMIT 12) x;

  -- Villes demandées sur la liste d'attente (toute la table, pas seulement la
  -- période : c'est le carnet de commandes des prochaines ouvertures).
  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_wl_cities
  FROM (SELECT initcap(trim(city)) AS k, count(*) AS n
        FROM launch_waitlist WHERE source = 'links' AND city IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 15) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_lead_types
  FROM (SELECT org_type AS k, count(*) AS n
        FROM links_pro_leads WHERE created_at >= v_from AND created_at < v_to GROUP BY 1) x;

  RETURN jsonb_build_object(
    'granularity',  v_gran,
    'totals',       v_totals,
    'series',       v_series,
    'targets',      v_targets,
    'events',       v_events,
    'langs',        v_langs,
    'countries',    v_countries,
    'devices',      v_devices,
    'referrers',    v_referrers,
    'utm',          v_utm,
    'waitlist_cities', v_wl_cities,
    'lead_types',   v_lead_types
  );
END $$;

REVOKE ALL ON FUNCTION public.get_links_analytics(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_links_analytics(timestamptz, timestamptz) TO authenticated;

-- ─── 9. Le trafic plateforme range /links dans sa propre section ────────────

CREATE OR REPLACE FUNCTION public.platform_page_group(p_path text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_path IN ('/verify-ticket-payment','/verify-table-payment','/verify-payment')
      OR p_path LIKE '/order-confirmation%' OR p_path LIKE '/order/%'
      OR p_path LIKE '/guest/finalize%' OR p_path LIKE '/claim%'
      THEN 'purchase'
    WHEN p_path ~ '/tickets/[^/]+$' OR p_path ~ '/table/[^/]+$'
      OR p_path LIKE '%/guestlist-checkout' OR p_path IN ('/cart','/click-collect')
      THEN 'checkout'
    WHEN p_path ~ '^/events/[^/]+/[^/]+' OR p_path LIKE '/event/%'
      OR p_path ~ '^/club/[^/]+/event/' OR p_path LIKE '/affiliate-event/%'
      THEN 'event'
    WHEN p_path ~ '^/club/[^/]+' OR p_path LIKE '/affiliate-venue/%' OR p_path LIKE '/vip-menu/%'
      THEN 'venue'
    WHEN p_path IN ('/', '/home') THEN 'home'
    WHEN p_path = '/links' THEN 'links'
    WHEN p_path = '/explore' THEN 'explore'
    WHEN p_path IN ('/clubs','/events','/djs','/tickets','/vip-tables','/order-drinks','/map')
      THEN 'browse'
    WHEN p_path LIKE '/l/%' OR p_path LIKE '/p/%' OR p_path LIKE '/promo/%'
      OR p_path LIKE '/promoteur/%' OR p_path LIKE '/rp/%'
      THEN 'promo-link'
    WHEN p_path LIKE '/dj/%' THEN 'dj'
    ELSE 'other'
  END
$$;

-- ─── 10. Purge : la mesure suit la même rétention que le trafic (13 mois) ───

CREATE OR REPLACE FUNCTION public.purge_links_events()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM public.links_events WHERE occurred_at < now() - interval '13 months';
$$;

REVOKE ALL ON FUNCTION public.purge_links_events() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('links-events-purge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'links-events-purge');
    PERFORM cron.schedule('links-events-purge', '35 3 * * *',
      $cron$ SELECT public.purge_links_events(); $cron$);
  END IF;
END $$;
