-- Yuno CRM : la mesure de la landing (crm.yunoapp.eu), SANS cookie.
--
--   • crm_landing_events : un événement par ligne — visit (une page vue),
--     section_view (profondeur de lecture, une fois par section et par page vue),
--     click (CTA, FAQ, contact) et signup_start (ouverture du parcours). Le
--     visiteur n'est qu'une empreinte salée DU JOUR (links_visitor_context : IP +
--     navigateur + sel quotidien, le même modèle que links_events) : rien n'est
--     stocké sur l'appareil, rien ne permet de suivre quelqu'un d'un jour à l'autre.
--     RLS active, AUCUNE policy : écriture par la seule RPC, lecture par l'Admin.
--   • track_crm_landing_event (anon) : SECURITY DEFINER, anti-flood 300 / heure /
--     visiteur, valeurs bornées, l'équipe n'est jamais comptée, et elle NE LÈVE
--     JAMAIS (une mesure ne casse pas une page).
--   • purge à 180 jours (cron quotidien).
--   • crm_admin_landing(démo, jours) : visites, visiteurs-jours, profondeur de
--     lecture par section, clics, sources → inscriptions, par jointure avec
--     pro_signups (même empreinte, même jour). Le test A/B n'existe pas.

CREATE TABLE IF NOT EXISTS public.crm_landing_events (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  day           date NOT NULL DEFAULT current_date,
  visitor_hash  text NOT NULL,
  pv            text,
  kind          text NOT NULL CHECK (kind IN ('visit', 'section_view', 'click', 'signup_start')),
  page          text,
  section       text,
  target        text,
  lang          text,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device        text,
  country       text
);
CREATE INDEX IF NOT EXISTS crm_landing_events_at_idx ON public.crm_landing_events (at DESC);
CREATE INDEX IF NOT EXISTS crm_landing_events_visitor_idx ON public.crm_landing_events (visitor_hash, at DESC);
ALTER TABLE public.crm_landing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_landing_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_crm_landing_event(
  p_kind text, p_page text DEFAULT NULL, p_section text DEFAULT NULL, p_target text DEFAULT NULL, p_lang text DEFAULT NULL,
  p_referrer_host text DEFAULT NULL, p_utm_source text DEFAULT NULL, p_utm_medium text DEFAULT NULL, p_utm_campaign text DEFAULT NULL,
  p_pv text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_ref text;
  v_clean text := '^[a-z0-9_:./-]{1,80}$';
BEGIN
  BEGIN
    IF p_kind NOT IN ('visit', 'section_view', 'click', 'signup_start') THEN RETURN; END IF;
    IF auth.uid() IS NOT NULL AND public.is_super_admin() THEN RETURN; END IF;
    SELECT * INTO v_ctx FROM public.links_visitor_context();
    IF (SELECT count(*) FROM public.crm_landing_events
         WHERE visitor_hash = v_ctx.o_hash AND at > now() - interval '1 hour') >= 300 THEN RETURN; END IF;
    -- Une section n'est comptée qu'une fois par page vue.
    IF p_kind = 'section_view' AND p_pv IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.crm_landing_events WHERE visitor_hash = v_ctx.o_hash AND pv = p_pv AND kind = 'section_view' AND section = p_section) THEN
      RETURN;
    END IF;
    v_ref := nullif(left(lower(coalesce(p_referrer_host, '')), 120), '');
    IF v_ref IS NOT NULL AND (v_ref LIKE '%yunoapp.eu%' OR v_ref LIKE 'localhost%' OR v_ref LIKE '%.localhost%') THEN v_ref := NULL; END IF;
    INSERT INTO public.crm_landing_events (visitor_hash, pv, kind, page, section, target, lang, referrer_host,
                                           utm_source, utm_medium, utm_campaign, device, country)
    VALUES (v_ctx.o_hash,
            CASE WHEN p_pv ~ '^[a-z0-9]{6,40}$' THEN p_pv END,
            p_kind,
            CASE WHEN lower(p_page) ~ v_clean THEN lower(p_page) END,
            CASE WHEN lower(p_section) ~ v_clean THEN lower(p_section) END,
            CASE WHEN lower(p_target) ~ v_clean THEN lower(p_target) END,
            CASE WHEN lower(p_lang) IN ('en', 'fr', 'es') THEN lower(p_lang) END,
            v_ref,
            left(nullif(trim(p_utm_source), ''), 80), left(nullif(trim(p_utm_medium), ''), 80), left(nullif(trim(p_utm_campaign), ''), 80),
            v_ctx.o_device, v_ctx.o_country);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.track_crm_landing_event(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_crm_landing_event(text, text, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_landing_events_purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.crm_landing_events WHERE at < now() - interval '180 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_landing_events_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_landing_events_purge() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('crm-landing-events-purge'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('crm-landing-events-purge', '29 4 * * *', $$SELECT public.crm_landing_events_purge();$$);

-- ── Lecture admin ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_landing(p_include_demo boolean DEFAULT false, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END;
  v_start timestamptz := now() - v_days * interval '1 day';
  v_out jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  WITH ev AS MATERIALIZED (
    SELECT * FROM public.crm_landing_events WHERE at >= v_start
  ), visits AS (
    SELECT * FROM ev WHERE kind = 'visit'
  ), src AS (
    -- Source d'une visite : utm_source, sinon le site d'où l'on vient, sinon direct.
    SELECT v.*, COALESCE(v.utm_source, v.referrer_host, 'direct') AS source FROM visits v
  ), su AS (
    SELECT p.visitor_hash, p.created_at::date AS d, p.account_created_at IS NOT NULL AS created
      FROM public.pro_signups p
     WHERE p.product = 'crm' AND p.created_at >= v_start AND p.visitor_hash IS NOT NULL
       AND (p_include_demo OR p.email IS NULL OR NOT public.is_demo_email(p.email))
  ), vday AS (
    SELECT DISTINCT ON (visitor_hash, day) visitor_hash, day, source FROM src ORDER BY visitor_hash, day, at
  )
  SELECT jsonb_build_object(
    'at', now(), 'days', v_days,
    'visits', (SELECT count(*) FROM visits),
    'visitor_days', (SELECT count(DISTINCT (visitor_hash, day)) FROM visits),
    'signup_starts', (SELECT count(DISTINCT (visitor_hash, day)) FROM ev WHERE kind = 'signup_start'),
    'sections', COALESCE((SELECT jsonb_agg(jsonb_build_object('section', s.section, 'n', s.n) ORDER BY s.n DESC)
                  FROM (SELECT section, count(DISTINCT COALESCE(pv, visitor_hash || day::text)) AS n FROM ev
                         WHERE kind = 'section_view' AND section IS NOT NULL GROUP BY section) s), '[]'::jsonb),
    'page_views', (SELECT count(DISTINCT COALESCE(pv, visitor_hash || day::text)) FROM visits),
    'clicks', COALESCE((SELECT jsonb_agg(jsonb_build_object('target', c.target, 'section', c.section, 'n', c.n) ORDER BY c.n DESC)
                  FROM (SELECT target, section, count(*) AS n FROM ev WHERE kind = 'click' AND target IS NOT NULL
                         GROUP BY target, section ORDER BY count(*) DESC LIMIT 30) c), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', x.source, 'visits', x.visits, 'visitors', x.visitors,
                  'starts', x.starts, 'signups', x.signups, 'created', x.created) ORDER BY x.visits DESC)
                  FROM (SELECT vd.source,
                               (SELECT count(*) FROM src s WHERE s.source = vd.source) AS visits,
                               count(*) AS visitors,
                               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ev e WHERE e.kind = 'signup_start' AND e.visitor_hash = vd.visitor_hash AND e.day = vd.day)) AS starts,
                               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM su WHERE su.visitor_hash = vd.visitor_hash AND su.d = vd.day)) AS signups,
                               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM su WHERE su.visitor_hash = vd.visitor_hash AND su.d = vd.day AND su.created)) AS created
                          FROM vday vd GROUP BY vd.source ORDER BY count(*) DESC LIMIT 20) x), '[]'::jsonb),
    'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('t', d, 'visits',
                  (SELECT count(*) FROM visits v WHERE v.day = d::date),
                  'visitors', (SELECT count(DISTINCT visitor_hash) FROM visits v WHERE v.day = d::date)) ORDER BY d)
                  FROM generate_series((now() - (v_days - 1) * interval '1 day')::date, now()::date, interval '1 day') d), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_object_agg(COALESCE(device, 'unknown'), n) FROM (SELECT device, count(*) n FROM visits GROUP BY device) z), '{}'::jsonb),
    'langs', COALESCE((SELECT jsonb_object_agg(COALESCE(lang, 'unknown'), n) FROM (SELECT lang, count(*) n FROM visits GROUP BY lang) z), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_landing(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_landing(boolean, integer) TO authenticated, service_role;
